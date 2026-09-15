/**
 * ULIP credential-holding proxy.
 *
 * The ULIP gateway authenticates with a username/password that mints a
 * bearer token. Neither may ever reach a browser, so the web and mobile
 * clients talk to this process instead, and it talks to ULIP.
 *
 *   Browser  ──POST /api/ulip/FASTAG/01──▶  this proxy  ──▶  ULIP gateway
 *
 * Run:
 *   ULIP_USERNAME=… ULIP_PASSWORD=… ULIP_ENV=staging node server/ulip-proxy.mjs
 *
 * Then start the app with VITE_ULIP_MODE=live (see src/data/index.ts).
 */
import { createServer } from 'node:http'

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

/* ── Endpoint allow-list: only real ULIP codes, e.g. FASTAG/01 ──── */
const ENDPOINT_RE = /^[A-Z]+\/\d{2}$/

const send = (res, status, payload) => {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {})

  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/health') {
    return send(res, 200, { ok: true, env: ENV, tokenCached: !!token })
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
})
