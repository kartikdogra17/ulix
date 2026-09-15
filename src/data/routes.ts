/* ────────────────────────────────────────────────────────────────
   Route intelligence — planning a lane before it is booked.

   Five API families that the tracking screens never touch, joined
   around a single origin→destination pair:

     BLACKSPOT/01  accident black spots by state
     NOENTRY/01    city no-entry windows for goods vehicles
     TOLL/01       plaza tariffs by toll / state
     CARBON/01-04  emissions per mode (rail / road / air / sea)
     EVYATRA/01 + MOPNG|HPCL|IOCL|BPCL|JIOBP   energy along the way

   The insight that makes this worth building is the no-entry check.
   A truck that arrives at 06:40 into a city closed 08:00–22:00 is not
   late — it is stopped for thirteen hours at the boundary. Nobody can
   see that from a tracking feed; it falls out of joining an ETA to a
   municipal restriction table.
   ──────────────────────────────────────────────────────────────── */

import type { Mode, Node } from './types'
import { NODES, NODE_BY_CODE, STATE_GST, TOLL_PLAZAS, float, haversine, int, pick, rng } from './mock/seed'

const HOUR = 3_600_000

export interface BlackSpot {
  id: string
  state: string
  stateCode: string
  district: string
  roadName: string
  location: string
  policeStation: string
  lat: number
  lon: number
  /** Severity bucket derived from reported incidents at the spot. */
  severity: 'high' | 'medium'
}

export interface NoEntryWindow {
  stateCode: string
  stateName: string
  districtName: string
  areaName: string
  /** Verbatim from NOENTRY/01, e.g. "8.00 AM to 10.00 PM". */
  noEntryTime: string
  fromMin: number
  toMin: number
}

export interface TollPoint {
  name: string
  code: string
  lat: number
  lon: number
  /** Tariff for the selected vehicle class, from TOLL/01. */
  rate: number
}

export interface EnergyStop {
  id: string
  name: string
  brand: string
  kind: 'fuel' | 'ev'
  lat: number
  lon: number
  atKm: number
}

export interface ModalOption {
  mode: Mode
  hours: number
  costInr: number
  co2Kg: number
  feasible: boolean
  note: string
  /** Which CARBON endpoint produced the emissions figure. */
  source: string
}

export interface NoEntryConflict {
  window: NoEntryWindow
  /** Minutes the vehicle would wait at the city boundary for the window to lift. */
  waitMins: number
  /** Depart this much earlier to arrive before the window opens. */
  departEarlierMins: number
  /**
   * Which intervention is actually cheaper. Holding 40 minutes at the cordon
   * beats re-timing a dispatch by eleven hours; the reverse is true when the
   * window has only just closed.
   */
  advice: 'hold' | 'depart_earlier'
}

export interface LanePlan {
  origin: Node
  destination: Node
  distanceKm: number
  driveHours: number
  departAt: string
  arriveAt: string
  tolls: TollPoint[]
  tollCost: number
  fuelCost: number
  /**
   * Own-account operating cost, itemised. Kept separate from the market
   * freight rate below: a ₹/tonne-km rate is all-in, so listing it beside
   * fuel would count the diesel twice.
   */
  ownCost: { fuel: number; toll: number; driver: number; maintenance: number; total: number }
  /** What a transporter would charge for the same move. */
  marketFreight: number
  blackSpots: BlackSpot[]
  noEntry: NoEntryWindow[]
  conflict: NoEntryConflict | null
  energy: EnergyStop[]
  modal: ModalOption[]
  recommended: Mode
  sources: string[]
}

/* ── Reference data, shaped like the documents' responses ──────── */

const STATE_CODE = (state: string) => STATE_GST[state] ?? '27'

const BLACKSPOT_ROADS = ['NH-48', 'NH-44', 'NH-19', 'NH-27', 'NH-16', 'NH-66', 'NH-52', 'SH-11'] as const
const SPOT_KINDS = [
  'Unmarked median opening', 'Sharp curve without crash barrier', 'Unlit junction',
  'School crossing on carriageway', 'Merging slip road', 'Bridge approach narrowing',
  'Illegal U-turn point', 'Pedestrian crossing without signal',
] as const

/** A national pool, positioned along the corridors between real nodes. */
export const BLACK_SPOTS: BlackSpot[] = (() => {
  const r = rng(316001)
  const out: BlackSpot[] = []
  for (let i = 0; i < 420; i++) {
    const a = pick(r, NODES)
    let b = pick(r, NODES)
    if (a.code === b.code) b = NODES[(NODES.indexOf(a) + 3) % NODES.length]
    const t = float(r, 0.08, 0.92, 3)
    const lat = +(a.lat + (b.lat - a.lat) * t + float(r, -0.25, 0.25, 3)).toFixed(3)
    const lon = +(a.lon + (b.lon - a.lon) * t + float(r, -0.25, 0.25, 3)).toFixed(3)
    const near = t < 0.5 ? a : b
    out.push({
      id: `BS-${1000 + i}`,
      state: near.state,
      stateCode: STATE_CODE(near.state),
      district: near.name,
      roadName: pick(r, BLACKSPOT_ROADS),
      location: pick(r, SPOT_KINDS),
      policeStation: `${near.name} ${pick(r, ['Sadar', 'Rural', 'Traffic', 'City'])} PS`,
      lat, lon,
      severity: r() < 0.36 ? 'high' : 'medium',
    })
  }
  return out
})()

/** Municipal goods-vehicle restrictions, keyed to the destination city. */
export const NO_ENTRY: NoEntryWindow[] = (() => {
  const r = rng(210903)
  const patterns: Array<[string, number, number]> = [
    ['8.00 AM to 10.00 PM', 8 * 60, 22 * 60],
    ['7.00 AM to 11.00 AM', 7 * 60, 11 * 60],
    ['9.00 AM to 9.00 PM', 9 * 60, 21 * 60],
    ['6.00 AM to 10.00 AM', 6 * 60, 10 * 60],
    ['8.00 AM to 8.00 PM', 8 * 60, 20 * 60],
  ]
  return NODES.filter((n) => n.kind === 'city' || n.kind === 'port').flatMap((n) => {
    const count = int(r, 1, 2)
    return Array.from({ length: count }, (_, i) => {
      const [noEntryTime, fromMin, toMin] = pick(r, patterns)
      return {
        stateCode: STATE_CODE(n.state),
        stateName: n.state,
        districtName: `UPD- ${n.code}`,
        areaName: `${pick(r, BLACKSPOT_ROADS)} ${pick(r, ['Bypass', 'Ring Road', 'Corridor'])} — ${n.name} ${i === 0 ? 'inner cordon' : 'market area'}`,
        noEntryTime, fromMin, toMin,
      }
    })
  })
})()

const FUEL_BRANDS = [
  ['IndianOil', 'fuel'], ['HPCL', 'fuel'], ['BPCL', 'fuel'], ['Jio-bp', 'fuel'],
  ['Jio-bp pulse', 'ev'], ['Tata Power EZ', 'ev'], ['Statiq', 'ev'],
] as const

/* ── Geometry helpers ─────────────────────────────────────────── */

/** Perpendicular distance, in degrees, from a point to the a→b segment. */
function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Roughly where along the corridor a point falls, 0…1. */
function positionAlong(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy || 1
  return Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
}

const MODE_SPEED: Record<Mode, number> = { road: 38, rail: 46, sea: 26, air: 620 }
/** ₹ per tonne-km, indicative Indian freight economics. */
const MODE_RATE: Record<Mode, number> = { road: 3.1, rail: 1.5, sea: 0.9, air: 22 }
/** kg CO2e per tonne-km — the factors CARBON/01-04 apply. */
const MODE_CO2: Record<Mode, number> = { road: 0.09, rail: 0.028, sea: 0.016, air: 0.6 }
const CARBON_ENDPOINT: Record<Mode, string> = {
  rail: 'CARBON/01', road: 'CARBON/02', air: 'CARBON/03', sea: 'CARBON/04',
}

const pad2 = (n: number) => String(n).padStart(2, '0')
export const minsToClock = (m: number) => `${pad2(Math.floor(m / 60) % 24)}:${pad2(m % 60)}`

/* ── The planner ──────────────────────────────────────────────── */

export function planLane(
  originCode: string,
  destinationCode: string,
  opts: { weightKg: number; departAt: Date; vehicleClass: string },
): LanePlan {
  const origin = NODE_BY_CODE[originCode]
  const destination = NODE_BY_CODE[destinationCode]
  const r = rng(originCode.charCodeAt(0) * 7919 + destinationCode.charCodeAt(1) * 104729)

  const straight = haversine(origin, destination)
  // Road distance runs longer than great-circle; 1.24 is a usable Indian factor.
  const distanceKm = Math.round(straight * 1.24)
  const driveHours = +(distanceKm / MODE_SPEED.road + 2).toFixed(1)

  const departMs = opts.departAt.getTime()
  const arriveMs = departMs + driveHours * HOUR
  const tonnes = opts.weightKg / 1000

  /* Corridor selection: anything within ~1.1° of the straight line. */
  const near = <T extends { lat: number; lon: number }>(xs: T[], buffer = 1.1) =>
    xs.filter((x) => distToSegment(x.lon, x.lat, origin.lon, origin.lat, destination.lon, destination.lat) < buffer)

  const blackSpots = near(BLACK_SPOTS)
    .sort((a, b) =>
      positionAlong(a.lon, a.lat, origin.lon, origin.lat, destination.lon, destination.lat)
      - positionAlong(b.lon, b.lat, origin.lon, origin.lat, destination.lon, destination.lat))
    .slice(0, 14)

  /* Tolls on the corridor, priced for the selected class. */
  const classMultiplier =
    opts.vehicleClass.includes('6 Axle') ? 1.75
    : opts.vehicleClass.includes('Trailer') ? 1.9
    : opts.vehicleClass.includes('4 Axle') ? 1.45
    : opts.vehicleClass.includes('3 Axle') ? 1.2 : 1
  const tolls: TollPoint[] = near(
    TOLL_PLAZAS.map(([name, nh, lat, lon]) => ({ name: `${name} (${nh})`, code: `${nh}-${int(r, 100, 999)}`, lat, lon, rate: 0 })),
    1.4,
  ).map((t) => ({ ...t, rate: Math.round(int(r, 90, 320) * classMultiplier) }))
  const tollCost = tolls.reduce((a, t) => a + t.rate, 0)

  // Diesel at ~3.2 km/l for a loaded HGV.
  const fuelCost = Math.round((distanceKm / 3.2) * 94)
  // Driver wage plus night/trip allowance, and tyres/servicing per km.
  const driverCost = Math.round(driveHours * 190 + 900)
  const maintenanceCost = Math.round(distanceKm * 6.5)

  /* Energy stops spaced along the corridor. */
  const stopCount = Math.max(1, Math.round(distanceKm / 320))
  const energy: EnergyStop[] = Array.from({ length: stopCount }, (_, i) => {
    const t = (i + 1) / (stopCount + 1)
    const [brand, kind] = pick(r, FUEL_BRANDS)
    return {
      id: `EN-${i}`,
      name: `${brand} — ${pick(r, ['Highway Plaza', 'Truck Point', 'Corridor Stop', 'Wayside Amenity'])}`,
      brand, kind: kind as 'fuel' | 'ev',
      lat: +(origin.lat + (destination.lat - origin.lat) * t).toFixed(3),
      lon: +(origin.lon + (destination.lon - origin.lon) * t).toFixed(3),
      atKm: Math.round(distanceKm * t),
    }
  })

  /* No-entry: does the projected arrival land inside a closed window? */
  const noEntry = NO_ENTRY.filter((w) => w.districtName === `UPD- ${destination.code}`)
  const arrive = new Date(arriveMs)
  const arriveMin = arrive.getHours() * 60 + arrive.getMinutes()
  let conflict: NoEntryConflict | null = null
  for (const w of noEntry) {
    const inside = w.fromMin <= w.toMin
      ? arriveMin >= w.fromMin && arriveMin < w.toMin
      : arriveMin >= w.fromMin || arriveMin < w.toMin   // window spans midnight
    if (inside) {
      const waitMins = (w.toMin - arriveMin + 1440) % 1440
      // Arriving exactly at the opening minute is still barred, so clear it by
      // a margin rather than landing on the boundary.
      const departEarlierMins = ((arriveMin - w.fromMin + 1440) % 1440) + 20
      conflict = {
        window: w, waitMins, departEarlierMins,
        advice: waitMins <= departEarlierMins ? 'hold' : 'depart_earlier',
      }
      break
    }
  }

  /* Modal comparison. Rail needs a railhead at both ends, sea needs ports. */
  const RAIL_SERVED = new Set<Node['kind']>(['railhead', 'icd', 'port', 'city'])
  const railServed = (n: Node) => RAIL_SERVED.has(n.kind)
  const bothPorts = origin.kind === 'port' && destination.kind === 'port'
  const modal: ModalOption[] = (['road', 'rail', 'sea', 'air'] as Mode[]).map((mode) => {
    const legKm = mode === 'road' ? distanceKm : Math.round(straight * (mode === 'rail' ? 1.15 : 1.05))
    const hours = +(legKm / MODE_SPEED[mode] + (mode === 'rail' ? 8 : mode === 'sea' ? 26 : mode === 'air' ? 5 : 2)).toFixed(1)
    const feasible =
      mode === 'road' ? true
      : mode === 'rail' ? railServed(origin) && railServed(destination) && distanceKm > 500
      : mode === 'sea' ? bothPorts
      : distanceKm > 700
    return {
      mode,
      hours,
      costInr: Math.round(tonnes * legKm * MODE_RATE[mode] + (mode === 'road' ? tollCost : 0)),
      co2Kg: Math.round(tonnes * legKm * MODE_CO2[mode]),
      feasible,
      source: CARBON_ENDPOINT[mode],
      note:
        mode === 'road' ? 'Door to door, no handling'
        : mode === 'rail' ? (distanceKm > 500 ? 'Needs first and last mile by road' : 'Too short to beat road')
        : mode === 'sea' ? (bothPorts ? 'Coastal shipping between these ports' : 'No port at one or both ends')
        : (distanceKm > 700 ? 'Only worth it for high-value or urgent cargo' : 'Uneconomic at this distance'),
    }
  })

  /* Recommend on carbon per rupee saved, not carbon alone — a rail option
     that doubles transit for a rounding error in emissions helps nobody. */
  const road = modal[0]
  const recommended = modal
    .filter((m) => m.feasible && m.hours < road.hours * 2.2)
    .sort((a, b) => (a.co2Kg + a.costInr / 60) - (b.co2Kg + b.costInr / 60))[0]?.mode ?? 'road'

  return {
    origin, destination, distanceKm, driveHours,
    departAt: opts.departAt.toISOString(),
    arriveAt: new Date(arriveMs).toISOString(),
    tolls, tollCost, fuelCost,
    ownCost: {
      fuel: fuelCost, toll: tollCost, driver: driverCost, maintenance: maintenanceCost,
      total: fuelCost + tollCost + driverCost + maintenanceCost,
    },
    marketFreight: Math.round(tonnes * distanceKm * MODE_RATE.road),
    blackSpots, noEntry, conflict, energy,
    modal, recommended,
    sources: [
      'BLACKSPOT/01', 'NOENTRY/01', 'TOLL/01',
      'CARBON/01', 'CARBON/02', 'CARBON/04',
      'EVYATRA/01', 'MOPNG/01',
    ],
  }
}
