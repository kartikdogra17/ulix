/* ────────────────────────────────────────────────────────────────
   AIS vessel positions.

   Ships broadcast AIS in the clear; the data is genuinely open. The
   access path is not: aisstream.io is WebSocket-only, requires a free
   key, and states plainly that direct browser connections are not
   permitted — connect from your own server and proxy what clients
   need. AISHub likewise requires membership and a contributed feed.

   So this goes through the same proxy that already holds the ULIP
   credentials: it keeps one upstream subscription open for the whole
   tenant and serves snapshots, rather than every browser tab opening
   its own socket. Without a key the platform falls back to simulated
   traffic, clearly labelled, so the screens still work.
   ──────────────────────────────────────────────────────────────── */

import { NODES } from './mock/seed'
import { int, pick, rng } from './mock/seed'

export interface Vessel {
  mmsi: string
  imo?: string
  name: string
  lat: number
  lon: number
  /** Speed over ground, knots. */
  sog: number
  /** Course over ground, degrees. */
  cog: number
  navStatus: string
  destination?: string
  eta?: string
  shipType: string
  updatedAt: string
  live: boolean
}

/** Indian waters, as a bounding box for the upstream subscription. */
export const INDIA_BBOX: [[number, number], [number, number]] = [[5, 66], [25, 93]]

const SHIP_TYPES = ['Container', 'Bulk carrier', 'Tanker', 'General cargo', 'Ro-Ro'] as const

const VESSEL_NAMES = [
  'MV Bharat Star', 'MV Konkan Pride', 'MV Deccan Trader', 'MV Coromandel',
  'MV Sagar Setu', 'MV Kutch Voyager', 'MV Malabar Dawn', 'MV Ganga Express',
  'MV Nicobar', 'MV Vindhya', 'MV Arabian Crest', 'MV Bay Runner',
] as const

const PORTS = NODES.filter((n) => n.kind === 'port')

/**
 * Plausible traffic around Indian ports, for when no AIS key is configured.
 * Deterministic, and every record is flagged `live: false` so the UI can say so.
 */
export function simulatedVessels(count = 26): Vessel[] {
  const r = rng(99170)
  return Array.from({ length: count }, (_, i) => {
    const port = PORTS[i % PORTS.length]
    // Anchorage and approaches sit offshore of the terminal itself.
    const bearing = r() * Math.PI * 2
    const offset = 0.15 + r() * 1.1
    const moored = r() < 0.3
    const status = moored ? 'Moored' : r() < 0.35 ? 'At anchor' : 'Under way using engine'
    return {
      mmsi: String(419000000 + int(r, 100000, 999999)),
      imo: `IMO${int(r, 9000000, 9899999)}`,
      name: `${pick(r, VESSEL_NAMES)} ${['I', 'II', 'III'][i % 3]}`,
      lat: +(port.lat + Math.sin(bearing) * offset * (moored ? 0.05 : 1)).toFixed(4),
      lon: +(port.lon + Math.cos(bearing) * offset * (moored ? 0.05 : 1)).toFixed(4),
      sog: status === 'Under way using engine' ? +(6 + r() * 12).toFixed(1) : +(r() * 0.4).toFixed(1),
      cog: int(r, 0, 359),
      navStatus: status,
      destination: port.code,
      eta: new Date(Date.now() + int(r, 2, 72) * 3_600_000).toISOString(),
      shipType: pick(r, SHIP_TYPES),
      updatedAt: new Date(Date.now() - int(r, 1, 55) * 60_000).toISOString(),
      live: false,
    }
  })
}

/** Great-circle distance in km, for matching vessels to ports. */
function km(aLat: number, aLon: number, bLat: number, bLon: number) {
  const R = 6371
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLon = ((bLon - aLon) * Math.PI) / 180
  const la1 = (aLat * Math.PI) / 180, la2 = (bLat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export interface PortTraffic {
  code: string
  name: string
  /** Vessels within the approach radius. */
  inbound: number
  atAnchor: number
  moored: number
  /** Anchorage queue is the congestion signal that matters commercially. */
  congestion: 'clear' | 'building' | 'congested'
  vessels: Vessel[]
}

/** Roll vessel positions up into something a control tower can act on. */
export function portTraffic(vessels: Vessel[], radiusKm = 80): PortTraffic[] {
  return PORTS.map((p) => {
    const near = vessels.filter((v) => km(v.lat, v.lon, p.lat, p.lon) <= radiusKm)
    const atAnchor = near.filter((v) => v.navStatus === 'At anchor').length
    const moored = near.filter((v) => v.navStatus === 'Moored').length
    const inbound = near.length - atAnchor - moored
    return {
      code: p.code, name: p.name, inbound, atAnchor, moored,
      congestion: (atAnchor >= 5 ? 'congested' : atAnchor >= 3 ? 'building' : 'clear') as PortTraffic['congestion'],
      vessels: near.sort((a, b) => b.sog - a.sog),
    }
  }).sort((a, b) => b.vessels.length - a.vessels.length)
}

/* ── Fetch ────────────────────────────────────────────────────── */

import { OSINT_BASE } from './index'

export interface VesselFeed {
  vessels: Vessel[]
  live: boolean
  /** False when the proxy is running but no AIS key is configured. */
  configured: boolean
}

export async function fetchVessels(): Promise<VesselFeed> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 6000)
  try {
    const res = await fetch(`${OSINT_BASE}/vessels`, { signal: ctrl.signal })
    if (res.ok) {
      const body = await res.json() as { configured: boolean; vessels: Vessel[] }
      if (body.configured && body.vessels?.length) {
        return { vessels: body.vessels, live: true, configured: true }
      }
      return { vessels: simulatedVessels(), live: false, configured: body.configured }
    }
  } catch {
    // Proxy down — simulated traffic keeps the maritime screens usable.
  } finally { clearTimeout(timer) }
  return { vessels: simulatedVessels(), live: false, configured: false }
}
