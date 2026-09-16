/* ────────────────────────────────────────────────────────────────
   Corridor disruption intelligence, from open news (GDELT DOC 2.0).

   Raw news is a terrible operational feed. "Strike" matches a cricket
   report, a stock market piece and a pay dispute at a port, and the
   same pay dispute arrives forty times from forty outlets. A queue
   full of that is worse than no queue at all.

   So the value here is not the fetch — it is the filter. Five stages:

     1. RELEVANCE   disruption vocabulary, minus an exclusion list that
                    kills the sport/markets/idiom false positives
     2. GEO         resolve to a known logistics node, or discard;
                    a protest we cannot place on a corridor is noise
     3. CATEGORY    what kind of disruption, which drives severity
     4. DEDUPE      collapse the same story across outlets into one
                    item, and keep the count
     5. SCORE       corroboration × category weight × recency

   Stage 4 is what makes it usable: forty outlets reporting one port
   strike becomes a single item with `corroboration: 40`, which is a
   far stronger signal than forty separate rows.
   ──────────────────────────────────────────────────────────────── */

import { NODES } from './mock/seed'

export type DisruptionKind =
  | 'protest' | 'strike' | 'flood' | 'accident' | 'closure' | 'port' | 'weather'

export interface RawArticle {
  url: string
  title: string
  /** GDELT format: 20260916T053000Z */
  seendate: string
  domain: string
  language?: string
  sourcecountry?: string
}

export interface Disruption {
  id: string
  kind: DisruptionKind
  title: string
  /** Node codes this story plausibly affects. */
  nodes: string[]
  placeLabel: string
  seenAt: string
  /** How many distinct outlets carried the same story. */
  corroboration: number
  sources: Array<{ domain: string; url: string }>
  severity: 'high' | 'medium' | 'low'
  score: number
  live: boolean
}

/* ── 1. Relevance vocabulary ──────────────────────────────────── */

const KIND_TERMS: Array<[DisruptionKind, RegExp]> = [
  ['strike', /\b(strike|hartal|bandh|walkout|work stoppage|go-slow|lockout|protest by (?:truckers|drivers|workers))\b/i],
  ['protest', /\b(protest|dharna|agitation|demonstration|roadblock|rasta roko|blockade|gherao)\b/i],
  ['flood', /\b(flood|flooding|waterlogg\w+|inundat\w+|cloudburst|landslide|washed away)\b/i],
  ['accident', /\b(accident|collision|pile-?up|derail\w*|overturn\w*|truck crash)\b/i],
  ['closure', /\b(highway closed|road closed|route closed|diversion|traffic (?:ban|restriction)|curfew|shut(?:down)? of (?:nh|sh)|bridge closed)\b/i],
  ['port', /\b(port (?:strike|congestion|closure|shut)|terminal (?:strike|congestion)|berth\w* delay|customs (?:strike|go-slow)|container backlog)\b/i],
  ['weather', /\b(cyclone|heavy rain|red alert|orange alert|dense fog|heatwave|storm surge|imd warning)\b/i],
]

/**
 * Terms that make a headline irrelevant no matter what else it matched.
 * Almost all GDELT false positives for freight come through these.
 */
const EXCLUSIONS = [
  /\b(cricket|ipl|t20|odi|football|hockey|kabaddi|match|innings|wicket|goal)\b/i,
  /\b(strike (?:a|the) deal|strike rate|strikes? gold|air ?strike|drone strike|missile|lightning strike)\b/i,
  /\b(stock|sensex|nifty|share price|ipo|market cap|bourses)\b/i,
  /\b(film|movie|box office|actor|actress|trailer|album|celebrity)\b/i,
  /\b(hunger strike by (?:one|a lone)|candle ?light)\b/i,
  /\b(election rally|campaign|manifesto|poll survey)\b/i,
]

/* ── 2. Geography ─────────────────────────────────────────────── */

/** Common aliases so "Bombay"/"Gurgaon" resolve like the official names. */
const ALIASES: Record<string, string[]> = {
  BOM: ['mumbai', 'bombay', 'navi mumbai', 'thane'],
  DEL: ['delhi', 'new delhi', 'ncr', 'gurugram', 'gurgaon', 'noida', 'faridabad', 'ghaziabad'],
  MAA: ['chennai', 'madras'],
  BLR: ['bengaluru', 'bangalore'],
  CCU: ['kolkata', 'calcutta', 'howrah'],
  HYD: ['hyderabad', 'secunderabad'],
  AMD: ['ahmedabad', 'amdavad'],
  NSA: ['jnpt', 'jnpa', 'nhava sheva', 'uran'],
  MUN: ['mundra'],
  IXY: ['kandla', 'deendayal'],
  COK: ['kochi', 'cochin', 'ernakulam'],
  VTZ: ['visakhapatnam', 'vizag'],
  TUT: ['tuticorin', 'thoothukudi'],
  GAU: ['guwahati'],
  PNQ: ['pune', 'pimpri'],
  LUH: ['ludhiana'],
  JAI: ['jaipur'],
  LKO: ['lucknow'],
  KNU: ['kanpur'],
  NAG: ['nagpur'],
  IDR: ['indore'],
  RPR: ['raipur'],
  BBI: ['bhubaneswar', 'cuttack'],
  PAT: ['patna'],
  STV: ['surat'],
  HAL: ['haldia'],
  PRD: ['paradip'],
  CJB: ['coimbatore'],
  TKD: ['tughlakabad'],
  DER: ['dadri'],
}

const GAZETTEER: Array<[string, string[]]> = NODES.map((n) => [
  n.code,
  [...new Set([n.name.toLowerCase(), ...(ALIASES[n.code] ?? []), n.state.toLowerCase()])],
])

function resolveNodes(title: string): string[] {
  const t = ` ${title.toLowerCase()} `
  const hits: string[] = []
  for (const [code, names] of GAZETTEER) {
    // Longer names first so "navi mumbai" does not also fire a weaker match.
    if (names.some((n) => n.length > 3 && t.includes(` ${n}`))) hits.push(code)
  }
  return hits
}

/* ── 3-5. Pipeline ────────────────────────────────────────────── */

const KIND_WEIGHT: Record<DisruptionKind, number> = {
  port: 32, strike: 28, closure: 26, flood: 24, protest: 18, accident: 14, weather: 12,
}

/**
 * Content words of a headline, with outlet furniture stripped.
 *
 * Exact fingerprints are too brittle for real news: the same story runs as
 * "Truckers strike at JNPT enters second day" and "JNPT truckers strike second
 * day at Nhava Sheva". Those share most of their vocabulary but no exact key,
 * so stories are clustered by overlap instead of by equality.
 */
/**
 * Crude suffix stripping. Without it "disrupt" and "disrupts" are different
 * tokens and two reports of the same flood stay separate — which is precisely
 * the duplication this stage exists to remove.
 */
function stem(w: string) {
  return w
    .replace(/(ing|ed|es|s)$/, (m, _g, off: number) => (off >= 4 ? '' : m))
    .replace(/(.)\1$/, '$1')
}

function tokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/\|.*$/, '')                     // " | Times of India"
      .replace(/[-–—:]\s*[^-–—:]{0,28}$/, '')    // trailing outlet tag
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOP.has(w))
      .map(stem)
      .filter((w) => w.length > 2),
  )
}

/** Jaccard overlap of two token sets. */
function similarity(a: Set<string>, b: Set<string>) {
  let shared = 0
  for (const t of a) if (b.has(t)) shared++
  const union = a.size + b.size - shared
  return union ? shared / union : 0
}

/** Above this, two headlines are treated as the same story. */
const SAME_STORY = 0.45

const STOP = new Set([
  'after', 'amid', 'over', 'from', 'with', 'into', 'says', 'said', 'will',
  'their', 'there', 'this', 'that', 'these', 'those', 'have', 'been', 'india',
  'indian', 'news', 'update', 'latest', 'live',
])

function parseSeen(seendate: string): string {
  // 20260916T053000Z → ISO
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(seendate)
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : new Date().toISOString()
}

/**
 * Turn raw articles into a ranked, de-duplicated disruption list.
 * Pure, so the same filter runs over live and simulated input.
 */
export function filterDisruptions(
  articles: RawArticle[], now = Date.now(), live = true,
): Disruption[] {
  const buckets: Array<{
    kind: DisruptionKind; title: string; nodes: string[]; seen: number
    toks: Set<string>; sources: Map<string, string>
  }> = []

  for (const a of articles) {
    const title = (a.title ?? '').trim()
    if (!title) continue

    // 1. relevance
    if (EXCLUSIONS.some((re) => re.test(title))) continue
    const kindHit = KIND_TERMS.find(([, re]) => re.test(title))
    if (!kindHit) continue

    // 2. geography — unplaceable disruption is not actionable
    const nodes = resolveNodes(title)
    if (!nodes.length) continue

    // 3-4. cluster by story, not by article
    const toks = tokens(title)
    if (toks.size < 3) continue
    const seen = Date.parse(parseSeen(a.seendate))

    // Merge into the closest existing story above the threshold, if any.
    let best: typeof buckets[number] | null = null
    let bestScore = SAME_STORY
    for (const b of buckets) {
      if (b.kind !== kindHit[0]) continue
      const sim = similarity(toks, b.toks)
      if (sim >= bestScore) { best = b; bestScore = sim }
    }

    if (best) {
      best.sources.set(a.domain, a.url)
      if (seen < best.seen) { best.seen = seen; best.title = title }
      for (const n of nodes) if (!best.nodes.includes(n)) best.nodes.push(n)
      // Keep the shared vocabulary so the cluster does not drift as it grows.
      for (const t of [...best.toks]) if (!toks.has(t) && best.sources.size > 2) best.toks.delete(t)
    } else {
      buckets.push({
        kind: kindHit[0], title, nodes, seen, toks,
        sources: new Map([[a.domain, a.url]]),
      })
    }
  }

  // 5. score
  const out: Disruption[] = buckets.map((b, i) => {
    const corroboration = b.sources.size
    const ageHrs = Math.max(0, (now - b.seen) / 3_600_000)
    const recency = Math.max(0.2, 1 - ageHrs / 72)
    // Corroboration matters but with diminishing returns — forty outlets is
    // not forty times more serious than four, it is just better confirmed.
    const score = Math.round(KIND_WEIGHT[b.kind] * (1 + Math.log2(corroboration)) * recency)
    return {
      id: `DSR-${[...b.toks].sort().slice(0, 3).join('-') || 'x'}-${i}`,
      kind: b.kind,
      title: b.title,
      nodes: b.nodes,
      placeLabel: b.nodes.map((c) => NODES.find((n) => n.code === c)?.name ?? c).join(', '),
      seenAt: new Date(b.seen).toISOString(),
      corroboration,
      sources: [...b.sources.entries()].map(([domain, url]) => ({ domain, url })),
      severity: score >= 45 ? 'high' : score >= 22 ? 'medium' : 'low',
      score, live,
    }
  })

  return out.sort((a, b) => b.score - a.score)
}

/** The query the proxy sends upstream. Kept here so filter and fetch agree. */
export const GDELT_QUERY =
  '(protest OR bandh OR hartal OR blockade OR "road closed" OR "highway closed" '
  + 'OR strike OR flood OR waterlogging OR landslide OR cyclone OR "dense fog" '
  + 'OR "port congestion" OR curfew) sourcecountry:india sourcelang:english'

/* ── Fetch ────────────────────────────────────────────────────── */

import { OSINT_BASE } from './index'

/** Headlines used when the proxy is not running. Marked `live: false`. */
const SIMULATED: Array<Omit<RawArticle, 'seendate'> & { hoursAgo: number }> = [
  { title: 'Truckers strike at JNPT enters second day, container backlog grows at Nhava Sheva', domain: 'thehindubusinessline.com', url: '#', hoursAgo: 6 },
  { title: 'JNPT truckers strike continues, Nhava Sheva backlog mounts', domain: 'economictimes.indiatimes.com', url: '#', hoursAgo: 5 },
  { title: 'Container backlog grows as truckers strike at JNPT enters day two', domain: 'livemint.com', url: '#', hoursAgo: 4 },
  { title: 'Heavy rain and waterlogging disrupt traffic across Chennai', domain: 'thehindu.com', url: '#', hoursAgo: 9 },
  { title: 'Chennai waterlogging after overnight rain disrupts city traffic', domain: 'newindianexpress.com', url: '#', hoursAgo: 8 },
  { title: 'Farmers block NH-44 near Ludhiana in protest over procurement delays', domain: 'tribuneindia.com', url: '#', hoursAgo: 20 },
  { title: 'Dense fog warning issued for Delhi and western Uttar Pradesh', domain: 'indiatoday.in', url: '#', hoursAgo: 3 },
  { title: 'Landslide closes highway near Guwahati, traffic diverted', domain: 'assamtribune.com', url: '#', hoursAgo: 14 },
  { title: 'Customs go-slow reported at Kolkata port, clearances delayed', domain: 'business-standard.com', url: '#', hoursAgo: 11 },
  // Noise the filter is expected to reject.
  { title: 'Kohli strikes century as India beat Australia in Mumbai T20', domain: 'espncricinfo.com', url: '#', hoursAgo: 2 },
  { title: 'Sensex crashes 900 points as markets strike a sour note', domain: 'moneycontrol.com', url: '#', hoursAgo: 1 },
  { title: 'Protest march held in Paris over pension reform', domain: 'lemonde.fr', url: '#', hoursAgo: 7 },
]

function simulatedArticles(now: number): RawArticle[] {
  const stamp = (ms: number) =>
    new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  return SIMULATED.map((a) => ({
    url: a.url, title: a.title, domain: a.domain,
    seendate: stamp(now - a.hoursAgo * 3_600_000),
  }))
}

export interface DisruptionFeed {
  items: Disruption[]
  live: boolean
  fetchedAt: string | null
}

/**
 * Pull the corridor disruption feed. Falls back to a simulated set when the
 * proxy is not running, so the screen works in a bare `npm run dev`.
 */
export async function fetchDisruptions(now = Date.now()): Promise<DisruptionFeed> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 6000)
  try {
    const res = await fetch(`${OSINT_BASE}/disruptions`, { signal: ctrl.signal })
    if (res.ok) {
      const body = await res.json() as { fetchedAt: string | null; articles: RawArticle[] }
      if (Array.isArray(body.articles) && body.articles.length) {
        return { items: filterDisruptions(body.articles, now, true), live: true, fetchedAt: body.fetchedAt }
      }
    }
  } catch {
    // Proxy down or blocked — fall through to the simulated set.
  } finally { clearTimeout(timer) }

  return { items: filterDisruptions(simulatedArticles(now), now, false), live: false, fetchedAt: null }
}

/** Disruptions touching any of the given nodes, worst first. */
export const disruptionsFor = (items: Disruption[], nodes: string[]) =>
  items.filter((d) => d.nodes.some((n) => nodes.includes(n)))
