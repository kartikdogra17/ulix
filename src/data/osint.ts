/* ────────────────────────────────────────────────────────────────
   Open-source intelligence.

   ULIP tells you what the government's own systems know about your
   consignment. It does not tell you that Delhi is about to bar your
   truck from entering, or that the corridor you are dispatching onto
   is fogged in. That information is public — it just lives outside
   the gateway.

   SCOPE, deliberately narrow: environmental, regulatory and
   infrastructure signals about PLACES and RULES. This layer does not
   profile people. No driver social media, no counterparty dossiers,
   no scraping of individuals — a logistics control tower has no
   business doing any of that, and the useful signal is all in the
   public environmental and regulatory feeds anyway.

   Sources
     Open-Meteo Air Quality  PM2.5 / PM10, free, no key, CORS-open
     Open-Meteo Forecast     precipitation, wind, visibility
     CPCB                    AQI breakpoints (computed locally)
     CAQM                    GRAP stage thresholds and vehicle curbs

   This is the ONLY live data in the build. Everything sourced from
   ULIP itself is simulated, and the UI labels which is which.
   ──────────────────────────────────────────────────────────────── */

const AQ_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality'
const WX_URL = 'https://api.open-meteo.com/v1/forecast'

const CACHE_PREFIX = 'ulip.osint.'
const TTL_MS = 30 * 60_000

/* ── CPCB AQI ─────────────────────────────────────────────────── */

export type AqiCategory =
  | 'Good' | 'Satisfactory' | 'Moderate' | 'Poor' | 'Very Poor' | 'Severe'

/** CPCB sub-index breakpoints: [concLo, concHi, aqiLo, aqiHi]. */
const PM25_BP: Array<[number, number, number, number]> = [
  [0, 30, 0, 50], [30, 60, 51, 100], [60, 90, 101, 200],
  [90, 120, 201, 300], [120, 250, 301, 400], [250, 500, 401, 500],
]
const PM10_BP: Array<[number, number, number, number]> = [
  [0, 50, 0, 50], [50, 100, 51, 100], [100, 250, 101, 200],
  [250, 350, 201, 300], [350, 430, 301, 400], [430, 600, 401, 500],
]

function subIndex(conc: number, bp: Array<[number, number, number, number]>) {
  for (const [cLo, cHi, iLo, iHi] of bp) {
    if (conc <= cHi) return Math.round(iLo + ((iHi - iLo) / (cHi - cLo)) * (conc - cLo))
  }
  return 500
}

/** CPCB AQI is the worst pollutant sub-index, not an average. */
export function cpcbAqi(pm25: number, pm10: number) {
  return Math.min(500, Math.max(subIndex(pm25, PM25_BP), subIndex(pm10, PM10_BP)))
}

export function aqiCategory(aqi: number): AqiCategory {
  if (aqi <= 50) return 'Good'
  if (aqi <= 100) return 'Satisfactory'
  if (aqi <= 200) return 'Moderate'
  if (aqi <= 300) return 'Poor'
  if (aqi <= 400) return 'Very Poor'
  return 'Severe'
}

/* ── GRAP (CAQM) ──────────────────────────────────────────────── */

export type GrapStage = 0 | 1 | 2 | 3 | 4

/** CAQM invokes stages on AQI thresholds; enforcement is by notification. */
export function grapStage(aqi: number): GrapStage {
  if (aqi > 450) return 4
  if (aqi > 400) return 3
  if (aqi > 300) return 2
  if (aqi > 200) return 1
  return 0
}

export const GRAP_LABEL: Record<GrapStage, string> = {
  0: 'Not invoked', 1: 'Stage I — Poor', 2: 'Stage II — Very Poor',
  3: 'Stage III — Severe', 4: 'Stage IV — Severe+',
}

/** Freight-relevant curbs only; the full GRAP schedule is much broader. */
export const GRAP_FREIGHT_CURBS: Record<GrapStage, string[]> = {
  0: [],
  1: ['Enforcement of PUC norms tightened', 'Overage diesel vehicles challaned on sight'],
  2: ['Parking charges raised to deter road trips', 'Diesel gensets restricted at warehouses'],
  3: [
    'BS-IV and older diesel medium goods vehicles barred in Delhi (non-essential)',
    'BS-IV diesel LCVs registered outside Delhi barred from entering (non-essential)',
    'BS-III petrol and BS-IV diesel LMVs restricted',
  ],
  4: [
    'Entry of BS-IV and older diesel trucks into Delhi banned except essential commodities',
    'Non-Delhi registered BS-IV and older LCVs and MGVs barred',
    'Only CNG, LNG, electric and BS-VI diesel goods vehicles permitted to enter',
  ],
}

export type Eligibility = 'allowed' | 'essential_only' | 'barred'

export interface EligibilityVerdict {
  status: Eligibility
  reason: string
  /** GRAP stage the verdict was computed against. */
  stage: GrapStage
}

/**
 * Join the live stage to the vehicle's own record.
 *
 * `bsNorm` and `fuel` come straight from VAHAN/01 (`rcNormsDesc`,
 * `rcFuelDesc`) — which is the whole point: neither ULIP nor CAQM can
 * answer "can THIS truck enter Delhi today", but together they can.
 */
export function ncrEligibility(
  stage: GrapStage, bsNorm: string, fuel: string, carriesEssentials = false,
): EligibilityVerdict {
  const clean = fuel === 'Electric' || fuel === 'CNG' || fuel === 'LNG'
  /* VAHAN writes the norm as "BHARAT STAGE II", not "BS-II" — the older
     pattern here required a literal "BS" and so matched nothing against a
     real record. It then fell back to 6, which meant an unreadable norm was
     treated as the CLEANEST possible vehicle and waved through Stage IV.
     Failing open on an entry ban is the wrong direction to fail in, so an
     unreadable norm is now restricted rather than permitted. */
  const roman = /(?:BS|BHARAT\s*STAGE)[\s-]*([IVX]+|\d)/i.exec(bsNorm)?.[1]
  const bs = roman === undefined ? null : Number(
    roman.replace(/^VI$/i, '6').replace(/^IV$/i, '4')
      .replace(/^III$/i, '3').replace(/^II$/i, '2').replace(/^I$/i, '1'))

  if (bs === null || Number.isNaN(bs)) {
    return {
      stage, status: stage < 3 ? 'allowed' : 'barred',
      reason: stage < 3
        ? 'No entry curbs in force at this stage.'
        : `Emission norm could not be read from the VAHAN record ("${bsNorm}"). Treated as restricted until it is confirmed — an entry ban is not a good thing to guess in the permissive direction.`,
    }
  }

  if (stage < 3 || clean || bs >= 6) {
    return {
      stage, status: 'allowed',
      reason: stage < 3
        ? 'No entry curbs in force at this stage.'
        : clean ? `${fuel} vehicles are exempt from GRAP entry curbs.`
        : 'BS-VI diesel is permitted at every GRAP stage.',
    }
  }
  if (carriesEssentials) {
    return {
      stage, status: 'essential_only',
      reason: `${bsNorm} diesel is barred at ${GRAP_LABEL[stage]}, but essential-commodity carriage is exempt. Carry documentation proving the exemption.`,
    }
  }
  return {
    stage, status: 'barred',
    reason: `${bsNorm} diesel goods vehicles may not enter Delhi while ${GRAP_LABEL[stage]} is in force. Re-assign to a BS-VI, CNG or electric unit, or hold outside the NCR boundary.`,
  }
}

/* ── Live reads ───────────────────────────────────────────────── */

export interface AirQuality {
  lat: number
  lon: number
  pm25: number
  pm10: number
  aqi: number
  category: AqiCategory
  stage: GrapStage
  observedAt: string
  /** False when the network was unavailable and this is a cached or stale read. */
  live: boolean
}

export interface CorridorWeather {
  lat: number
  lon: number
  tempC: number
  precipMm: number
  windKmph: number
  visibilityM: number
  /** Sub-200 m visibility closes highways in the northern winter. */
  fogRisk: 'none' | 'moderate' | 'severe'
  observedAt: string
  live: boolean
}

function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key)
    if (!raw) return null
    const { at, value } = JSON.parse(raw) as { at: number; value: T }
    return Date.now() - at < TTL_MS ? value : null
  } catch { return null }
}

function writeCache<T>(key: string, value: T) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), value }))
  } catch { /* storage blocked — live reads simply will not be remembered */ }
}

async function getJson(url: string, timeoutMs = 8000): Promise<unknown | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    return res.ok ? await res.json() : null
  } catch {
    // Offline, blocked, or slow. The platform must still work — every
    // caller falls back rather than failing the screen.
    return null
  } finally { clearTimeout(timer) }
}

export async function fetchAirQuality(lat: number, lon: number): Promise<AirQuality | null> {
  const key = `aq:${lat.toFixed(2)},${lon.toFixed(2)}`
  const cached = readCache<AirQuality>(key)
  if (cached) return cached

  const json = await getJson(
    `${AQ_URL}?latitude=${lat}&longitude=${lon}&current=pm10,pm2_5&timezone=Asia%2FKolkata`) as
    { current?: { time: string; pm2_5: number; pm10: number } } | null
  if (!json?.current) return null

  const { pm2_5: pm25, pm10, time } = json.current
  const aqi = cpcbAqi(pm25, pm10)
  const value: AirQuality = {
    lat, lon, pm25, pm10, aqi,
    category: aqiCategory(aqi), stage: grapStage(aqi),
    observedAt: time, live: true,
  }
  writeCache(key, value)
  return value
}

export async function fetchWeather(lat: number, lon: number): Promise<CorridorWeather | null> {
  const key = `wx:${lat.toFixed(2)},${lon.toFixed(2)}`
  const cached = readCache<CorridorWeather>(key)
  if (cached) return cached

  const json = await getJson(
    `${WX_URL}?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation,wind_speed_10m,visibility&timezone=Asia%2FKolkata`) as
    { current?: { time: string; temperature_2m: number; precipitation: number; wind_speed_10m: number; visibility: number } } | null
  if (!json?.current) return null

  const c = json.current
  const value: CorridorWeather = {
    lat, lon,
    tempC: c.temperature_2m,
    precipMm: c.precipitation,
    windKmph: c.wind_speed_10m,
    visibilityM: c.visibility,
    fogRisk: c.visibility < 200 ? 'severe' : c.visibility < 1000 ? 'moderate' : 'none',
    observedAt: c.time, live: true,
  }
  writeCache(key, value)
  return value
}

/** Sample a corridor at a few points rather than every kilometre. */
export async function fetchCorridorWeather(
  from: { lat: number; lon: number }, to: { lat: number; lon: number }, samples = 3,
): Promise<CorridorWeather[]> {
  const points = Array.from({ length: samples }, (_, i) => {
    const t = samples === 1 ? 0.5 : i / (samples - 1)
    return { lat: +(from.lat + (to.lat - from.lat) * t).toFixed(2), lon: +(from.lon + (to.lon - from.lon) * t).toFixed(2) }
  })
  const results = await Promise.all(points.map((p) => fetchWeather(p.lat, p.lon)))
  return results.filter((x): x is CorridorWeather => x !== null)
}

/** Delhi NCR districts where GRAP entry curbs bite. */
export const NCR_NODES = new Set(['DEL', 'TKD', 'DER'])
export const isNcr = (code: string) => NCR_NODES.has(code)
