/**
 * ULIP credential-holding proxy.
 *
 * The ULIP gateway authenticates with a username/password that mints a
 * bearer token. Neither may ever reach a browser, so the web and mobile
 * clients talk to this process instead, and it talks to ULIP.
 *
 *   Browser  ──POST /api/ulip/FASTAG/01──▶  this proxy  ──▶  ULIP gateway
 *
 * It also fronts two open-source intelligence feeds, for reasons specific to
 * each: aisstream.io is WebSocket-only and forbids direct browser connections,
 * and GDELT rate-limits to roughly one request every five seconds per IP. Both
 * want exactly one upstream consumer with a shared cache — a server, not N tabs.
 *
 *   GET /api/osint/disruptions   filtered news, 10-minute cache
 *   GET /api/osint/vessels       AIS snapshot (needs AISSTREAM_API_KEY)
 *
 * Run:
 *   ULIP_USERNAME=… ULIP_PASSWORD=… ULIP_ENV=staging node server/ulip-proxy.mjs
 *
 * Then start the app with VITE_ULIP_MODE=live (see src/data/index.ts).
 */
import { createServer } from 'node:http'
import dns from 'node:dns'

/* Some upstreams (GDELT among them) publish AAAA records that are not
   reachable from every network. curl falls back to IPv4 via happy eyeballs;
   undici does not always, and the symptom is a bare UND_ERR_CONNECT_TIMEOUT.
   Preferring IPv4 costs nothing here and removes that whole failure mode. */
dns.setDefaultResultOrder('ipv4first')

const PORT = Number(process.env.PORT ?? 8787)
const ENV = process.env.ULIP_ENV === 'production' ? 'production' : 'staging'
const BASE = ENV === 'production'
  ? 'https://www.ulip.dpiit.gov.in/ulip/v1.0.0'
  : 'https://www.ulipstaging.dpiit.gov.in/ulip/v1.0.0'

const USERNAME = process.env.ULIP_USERNAME
const PASSWORD = process.env.ULIP_PASSWORD
const ORIGIN = process.env.ALLOWED_ORIGIN ?? 'http://localhost:5173'

if (!USERNAME || !PASSWORD) {
  console.error('✖ Set ULIP_USERNAME and ULIP_PASSWORD (from your approved goulip.in account).')
  process.exit(1)
}

/* ── Token cache. Documented idle expiry is ~30 minutes. ─────────── */
const IDLE_MS = 30 * 60_000
let token = null
let issuedAt = 0
let inflight = null

async function getToken(force = false) {
  if (!force && token && Date.now() - issuedAt < IDLE_MS - 60_000) return token
  if (inflight) return inflight
  inflight = (async () => {
    const res = await fetch(`${BASE}/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
    })
    const body = await res.json().catch(() => null)
    const t = body?.token ?? body?.response?.token
    if (!res.ok || !t) throw new Error(body?.message ?? `login failed (HTTP ${res.status})`)
    token = t
    issuedAt = Date.now()
    console.log(`→ ULIP token refreshed (${ENV})`)
    return t
  })()
  try { return await inflight } finally { inflight = null }
}

/* ── GDELT: one upstream call at a time, cached ──────────────────
   GDELT asks for no more than a request every five seconds and returns
   429 otherwise. One server with a cache satisfies that for any number
   of browser tabs. */

const GDELT_URL = 'https://api.gdeltproject.org/api/v2/doc/doc'
const GDELT_QUERY =
  '(protest OR bandh OR hartal OR blockade OR "road closed" OR "highway closed" '
  + 'OR strike OR flood OR waterlogging OR landslide OR cyclone OR "dense fog" '
  + 'OR "port congestion" OR curfew) sourcecountry:india sourcelang:english'

const GDELT_TTL_MS = 10 * 60_000
const GDELT_MIN_GAP_MS = 6_000
let gdeltCache = { at: 0, articles: [] }
let gdeltLastCall = 0
let gdeltInflight = null

async function getDisruptions() {
  if (Date.now() - gdeltCache.at < GDELT_TTL_MS) return gdeltCache
  if (gdeltInflight) return gdeltInflight

  gdeltInflight = (async () => {
    const wait = GDELT_MIN_GAP_MS - (Date.now() - gdeltLastCall)
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    gdeltLastCall = Date.now()

    const url = `${GDELT_URL}?query=${encodeURIComponent(GDELT_QUERY)}`
      + '&mode=artlist&maxrecords=250&format=json&timespan=2d&sort=datedesc'
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'ulip-platform/1.0' } })
      if (!res.ok) {
        console.warn(`GDELT ${res.status} — serving ${gdeltCache.articles.length} cached articles`)
        return gdeltCache   // stale beats empty
      }
      const body = await res.json().catch(() => null)
      const articles = Array.isArray(body?.articles) ? body.articles : []
      gdeltCache = { at: Date.now(), articles }
      console.log(`→ GDELT refreshed: ${articles.length} articles`)
      return gdeltCache
    } catch (err) {
      console.warn('GDELT fetch failed:', err.message, err.cause?.code ?? err.cause?.message ?? '')
      return gdeltCache
    } finally { gdeltInflight = null }
  })()
  return gdeltInflight
}

/* ── AIS: one upstream socket, snapshot served over HTTP ─────────
   aisstream.io is WebSocket-only and states that direct browser
   connections are not permitted. The socket therefore lives here. */

const AIS_KEY = process.env.AISSTREAM_API_KEY
const AIS_BBOX = [[[5, 66], [25, 93]]]   // Indian waters
const AIS_STALE_MS = 30 * 60_000

const vessels = new Map()   // mmsi -> record
let aisSocket = null
let aisRetry = 0

function startAis() {
  if (!AIS_KEY) return
  let WS
  try {
    WS = globalThis.WebSocket
  } catch { WS = null }
  if (!WS) {
    console.warn('AIS: no WebSocket in this Node build; run Node 22+ or install ws')
    return
  }

  const sock = new WS('wss://stream.aisstream.io/v0/stream')
  aisSocket = sock

  sock.onopen = () => {
    aisRetry = 0
    sock.send(JSON.stringify({
      APIKey: AIS_KEY,
      BoundingBoxes: AIS_BBOX,
      FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
    }))
    console.log('→ AIS stream subscribed (Indian waters)')
  }

  sock.onmessage = (ev) => {
    let msg
    try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)) } catch { return }
    const meta = msg.MetaData ?? {}
    const mmsi = String(meta.MMSI ?? '')
    if (!mmsi) return
    const prev = vessels.get(mmsi) ?? {}

    if (msg.MessageType === 'PositionReport') {
      const p = msg.Message?.PositionReport ?? {}
      vessels.set(mmsi, {
        ...prev, mmsi,
        name: (meta.ShipName ?? prev.name ?? '').trim() || `MMSI ${mmsi}`,
        lat: p.Latitude, lon: p.Longitude,
        sog: p.Sog ?? 0, cog: p.Cog ?? 0,
        navStatus: NAV_STATUS[p.NavigationalStatus] ?? 'Unknown',
        updatedAt: new Date().toISOString(), live: true,
      })
    } else if (msg.MessageType === 'ShipStaticData') {
      const d = msg.Message?.ShipStaticData ?? {}
      vessels.set(mmsi, {
        ...prev, mmsi,
        name: (meta.ShipName ?? prev.name ?? '').trim() || `MMSI ${mmsi}`,
        imo: d.ImoNumber ? `IMO${d.ImoNumber}` : prev.imo,
        destination: (d.Destination ?? '').trim() || prev.destination,
        shipType: SHIP_TYPE[d.Type] ?? prev.shipType ?? 'Unknown',
        updatedAt: new Date().toISOString(), live: true,
      })
    }
  }

  sock.onclose = () => {
    // Exponential backoff; the feed is nice to have, never load-bearing.
    const delay = Math.min(60_000, 2 ** aisRetry * 1000)
    aisRetry++
    console.warn(`AIS socket closed, reconnecting in ${delay / 1000}s`)
    setTimeout(startAis, delay)
  }
  sock.onerror = () => { try { sock.close() } catch { /* already closing */ } }
}

const NAV_STATUS = {
  0: 'Under way using engine', 1: 'At anchor', 2: 'Not under command',
  3: 'Restricted manoeuvrability', 5: 'Moored', 7: 'Fishing',
  8: 'Under way sailing',
}
const SHIP_TYPE = {
  70: 'General cargo', 71: 'General cargo', 79: 'General cargo',
  80: 'Tanker', 89: 'Tanker', 30: 'Fishing', 60: 'Passenger',
  74: 'Container', 76: 'Container', 77: 'Container',
}

function vesselSnapshot() {
  const cutoff = Date.now() - AIS_STALE_MS
  const out = []
  for (const [mmsi, v] of vessels) {
    if (!v.lat || !v.lon) continue
    if (Date.parse(v.updatedAt) < cutoff) { vessels.delete(mmsi); continue }
    out.push(v)
  }
  return out
}

/* ── Endpoint allow-list: only real ULIP codes, e.g. FASTAG/01 ──── */
const ENDPOINT_RE = /^[A-Z]+\/\d{2}$/

const send = (res, status, payload) => {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {})

  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/health') {
    return send(res, 200, {
      ok: true, env: ENV, tokenCached: !!token,
      osint: {
        gdeltCachedArticles: gdeltCache.articles.length,
        aisConfigured: !!AIS_KEY,
        aisVessels: vessels.size,
      },
    })
  }

  if (url.pathname === '/api/osint/disruptions' && req.method === 'GET') {
    const { at, articles } = await getDisruptions()
    // Raw articles go to the client; filtering is shared code so the same
    // pipeline runs over live and simulated input.
    return send(res, 200, { fetchedAt: at ? new Date(at).toISOString() : null, articles })
  }

  if (url.pathname === '/api/osint/vessels' && req.method === 'GET') {
    if (!AIS_KEY) {
      return send(res, 200, { configured: false, vessels: [] })
    }
    return send(res, 200, { configured: true, vessels: vesselSnapshot() })
  }

  const endpoint = url.pathname.replace(/^\/api\/ulip\//, '')
  if (req.method !== 'POST' || !ENDPOINT_RE.test(endpoint)) {
    return send(res, 404, { response: null, error: 'true', code: '404', message: 'Unknown endpoint' })
  }

  let payload = {}
  try {
    const chunks = []
    for await (const c of req) chunks.push(c)
    payload = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
  } catch {
    return send(res, 400, { response: null, error: 'true', code: '400', message: 'Invalid JSON body' })
  }

  const call = async (t) => fetch(`${BASE}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${t}` },
    body: JSON.stringify(payload),
  })

  try {
    let upstream = await call(await getToken())
    if (upstream.status === 401 || upstream.status === 403) upstream = await call(await getToken(true))
    const body = await upstream.json().catch(() => null)
    if (!body) return send(res, 502, { response: null, error: 'true', code: '502', message: 'Source system not responding' })
    return send(res, upstream.status, body)
  } catch (err) {
    console.error(`✖ ${endpoint}:`, err.message)
    return send(res, 502, { response: null, error: 'true', code: '502', message: err.message })
  }
}).listen(PORT, () => {
  console.log(`ULIP proxy → ${BASE}`)
  console.log(`listening on http://localhost:${PORT}  (allowing origin ${ORIGIN})`)
  console.log(AIS_KEY
    ? 'AIS: key present, opening stream'
    : 'AIS: no AISSTREAM_API_KEY — /api/osint/vessels will report unconfigured')
  startAis()
})
