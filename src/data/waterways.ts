/* ────────────────────────────────────────────────────────────────
   Inland waterways (IWAI).

   Fifteen endpoints, none of them touched until now. Nine are traffic
   statistics; the four that matter operationally are IWAI/10–13:

     IWAI/10   national waterways and their stretches
     IWAI/11   navigability windows per stretch (fromDate, toDate)
     IWAI/12   structures with verticalClearance, lat, lon
     IWAI/13   terminals and jetties, positioned by chainage

   Two constraints decide whether a barge can actually run, and
   neither exists in road or rail planning:

   AIR DRAFT. A vessel must pass under every bridge on the stretch.
   The binding number is the LOWEST vertical clearance on the route,
   and it is lowest in monsoon — because clearance is measured to the
   water, and the water is high. So the season that gives you the most
   depth gives you the least headroom. Planning software that treats
   clearance as a fixed number gets this exactly backwards.

   LAD — least available depth. It sets how deep the vessel may sit,
   which sets how much cargo it may carry. In the lean season a barge
   on the same stretch carries materially less.

   Together they mean a waterway is not simply "available" or not: it
   is available for a particular vessel, carrying a particular tonnage,
   in a particular month.
   ──────────────────────────────────────────────────────────────── */

import { float, int, pick, rng } from './mock/seed'

export interface Structure {
  id: string
  /** IWAI/12 `structure` — bridge, barrage, power line. */
  structure: string
  location: string
  /** Metres above the current water level. */
  verticalClearance: number
  chainage: number
  latitude: number
  longitude: number
}

export interface Terminal {
  id: string
  terminalJetty: string
  office: string
  district: string
  state: string
  chainage: number
  latitude: number
  longitude: number
  /** Whether it can take containers, or only break-bulk. */
  containerCapable: boolean
  /** Thousand tonnes handled in the last financial year (IWAI/03, /08). */
  throughputKt: number
}

export interface Stretch {
  id: string
  name: string
  originName: string
  destinationName: string
  originChainage: number
  destinationChainage: number
  lengthKm: number
  /** IWAI/11 navigability window. */
  fromDate: string
  toDate: string
  navigable: boolean
  /** Least available depth by month, metres — drives loadable tonnage. */
  ladByMonth: number[]
  structures: Structure[]
  terminals: Terminal[]
}

export interface Waterway {
  id: string
  /** e.g. 'NW-1'. */
  code: string
  name: string
  displayName: string
  river: string
  states: string[]
  lengthKm: number
  utmZone: string
  stretches: Stretch[]
  /** Historical traffic, most recent last (IWAI/09). */
  trafficByYear: Array<{ fyear: string; traffic: number }>
}

/* ── The declared network ─────────────────────────────────────── */

const SEED: Array<{
  code: string; name: string; river: string; states: string[]; lengthKm: number
  utmZone: string; from: [string, number, number]; to: [string, number, number]
  stretches: Array<[string, string, string]>
}> = [
  {
    code: 'NW-1', name: 'Ganga–Bhagirathi–Hooghly', river: 'Ganga',
    states: ['Uttar Pradesh', 'Bihar', 'Jharkhand', 'West Bengal'],
    lengthKm: 1620, utmZone: '45N',
    from: ['Prayagraj', 25.44, 81.85], to: ['Haldia', 22.06, 88.11],
    stretches: [
      ['Haldia – Farakka', 'Haldia', 'Farakka'],
      ['Farakka – Patna', 'Farakka', 'Patna'],
      ['Patna – Varanasi', 'Patna', 'Varanasi'],
      ['Varanasi – Prayagraj', 'Varanasi', 'Prayagraj'],
    ],
  },
  {
    code: 'NW-2', name: 'Brahmaputra', river: 'Brahmaputra',
    states: ['Assam'], lengthKm: 891, utmZone: '46N',
    from: ['Dhubri', 26.02, 89.98], to: ['Sadiya', 27.83, 95.66],
    stretches: [
      ['Dhubri – Pandu', 'Dhubri', 'Pandu'],
      ['Pandu – Silghat', 'Pandu', 'Silghat'],
      ['Silghat – Sadiya', 'Silghat', 'Sadiya'],
    ],
  },
  {
    code: 'NW-3', name: 'West Coast Canal', river: 'West Coast Canal',
    states: ['Kerala'], lengthKm: 205, utmZone: '43N',
    from: ['Kottapuram', 10.18, 76.20], to: ['Kollam', 8.89, 76.59],
    stretches: [
      ['Kottapuram – Kochi', 'Kottapuram', 'Kochi'],
      ['Kochi – Kollam', 'Kochi', 'Kollam'],
    ],
  },
  {
    code: 'NW-4', name: 'Krishna–Godavari', river: 'Godavari',
    states: ['Andhra Pradesh', 'Telangana'], lengthKm: 1095, utmZone: '44N',
    from: ['Kakinada', 16.99, 82.25], to: ['Puducherry', 11.94, 79.83],
    stretches: [
      ['Kakinada – Rajahmundry', 'Kakinada', 'Rajahmundry'],
      ['Vijayawada – Muktyala', 'Vijayawada', 'Muktyala'],
    ],
  },
  {
    code: 'NW-16', name: 'Barak', river: 'Barak',
    states: ['Assam'], lengthKm: 121, utmZone: '46N',
    from: ['Lakhipur', 24.80, 93.00], to: ['Bhanga', 24.68, 92.45],
    stretches: [['Lakhipur – Bhanga', 'Lakhipur', 'Bhanga']],
  },
  {
    code: 'NW-68', name: 'Mandovi', river: 'Mandovi',
    states: ['Goa'], lengthKm: 41, utmZone: '43N',
    from: ['Usgaon', 15.44, 74.05], to: ['Panaji', 15.50, 73.83],
    stretches: [['Usgaon – Panaji', 'Usgaon', 'Panaji']],
  },
]

const STRUCTURE_KINDS = [
  'Road bridge', 'Rail bridge', 'Rail-cum-road bridge', 'Barrage',
  'Overhead power line', 'Aqueduct',
] as const

/* LAD follows the hydrological year: deep in and after the monsoon,
   shallow through the pre-monsoon months. */
const LAD_SHAPE = [0.78, 0.72, 0.68, 0.66, 0.7, 0.88, 1.0, 1.0, 0.97, 0.93, 0.88, 0.83]

export function makeWaterways(): Waterway[] {
  const r = rng(160992)

  return SEED.map((w) => {
    const [, oLat, oLon] = w.from
    const [, dLat, dLon] = w.to
    const perStretch = w.lengthKm / w.stretches.length

    const stretches: Stretch[] = w.stretches.map(([name, originName, destinationName], i) => {
      const t0 = i / w.stretches.length
      const t1 = (i + 1) / w.stretches.length
      const lat = (t: number) => oLat + (dLat - oLat) * t
      const lon = (t: number) => oLon + (dLon - oLon) * t

      const baseLad = float(r, 2.5, 3.6, 1)
      // A minority of stretches are seasonally closed or under dredging.
      const navigable = r() > 0.18

      const structures: Structure[] = Array.from({ length: int(r, 2, 5) }, (_, k) => {
        const tk = t0 + ((k + 1) / 6) * (t1 - t0)
        return {
          id: `${w.code}-S${i}-${k}`,
          structure: pick(r, STRUCTURE_KINDS),
          location: `${pick(r, ['Near', 'Upstream of', 'Downstream of'])} ${originName}`,
          verticalClearance: float(r, 7.2, 14.5, 1),
          chainage: Math.round(perStretch * (i + (k + 1) / 6)),
          latitude: +lat(tk).toFixed(3),
          longitude: +lon(tk).toFixed(3),
        }
      })

      const terminals: Terminal[] = [originName, destinationName].map((tName, k) => {
        const tk = k === 0 ? t0 : t1
        const container = r() < 0.45
        return {
          id: `${w.code}-T${i}-${k}`,
          terminalJetty: `${tName} ${container ? 'Multi-Modal Terminal' : 'Jetty'}`,
          office: `IWAI ${tName}`,
          district: tName,
          state: w.states[Math.min(w.states.length - 1, i)],
          chainage: Math.round(perStretch * (i + k)),
          latitude: +lat(tk).toFixed(3),
          longitude: +lon(tk).toFixed(3),
          containerCapable: container,
          throughputKt: container ? int(r, 180, 1400) : int(r, 20, 260),
        }
      })

      const now = new Date()
      return {
        id: `${w.code}-${i}`,
        name, originName, destinationName,
        originChainage: Math.round(perStretch * i),
        destinationChainage: Math.round(perStretch * (i + 1)),
        lengthKm: Math.round(perStretch),
        fromDate: new Date(now.getFullYear(), 0, 1).toISOString(),
        toDate: new Date(now.getFullYear(), 11, 31).toISOString(),
        navigable,
        ladByMonth: LAD_SHAPE.map((f) => +(baseLad * f).toFixed(2)),
        structures,
        terminals,
      }
    })

    const trafficByYear = Array.from({ length: 6 }, (_, i) => ({
      fyear: `${2020 + i}-${String(21 + i).padStart(2, '0')}`,
      traffic: int(r, 400, 3200) + i * int(r, 60, 420),
    }))

    return {
      id: w.code.toLowerCase(),
      code: w.code,
      name: w.name,
      displayName: `${w.code} · ${w.name}`,
      river: w.river,
      states: w.states,
      lengthKm: w.lengthKm,
      utmZone: w.utmZone,
      stretches,
      trafficByYear,
    }
  })
}

/* ── The constraint maths ─────────────────────────────────────── */

export interface VesselSpec {
  /** Height above waterline, metres. */
  airDraft: number
  /** Loaded draught at full capacity, metres. */
  fullDraft: number
  /** Tonnes at full draught. */
  capacityT: number
  name: string
}

export const VESSELS: VesselSpec[] = [
  { name: 'Self-propelled barge (small)', airDraft: 6.0, fullDraft: 1.8, capacityT: 500 },
  { name: 'Cargo barge (standard)', airDraft: 7.5, fullDraft: 2.2, capacityT: 1200 },
  { name: 'Container barge (2-tier)', airDraft: 9.4, fullDraft: 2.6, capacityT: 1800 },
  { name: 'Container barge (3-tier)', airDraft: 12.0, fullDraft: 3.0, capacityT: 2700 },
]

/** Clearance is measured to the water, so high water means low headroom. */
const CLEARANCE_SEASONAL_LOSS = [0, 0, 0, 0, 0.2, 0.9, 2.1, 2.4, 1.8, 0.9, 0.3, 0.1]

export interface Feasibility {
  month: number
  /** Lowest clearance on the stretch this month. */
  minClearance: number
  bindingStructure: Structure | null
  airDraftOk: boolean
  /** Headroom left after the vessel, metres. */
  headroom: number
  lad: number
  /** Tonnage the depth actually allows. */
  loadableT: number
  utilisationPct: number
  verdict: 'clear' | 'restricted' | 'blocked'
  note: string
}

export function assess(stretch: Stretch, vessel: VesselSpec, month: number): Feasibility {
  const loss = CLEARANCE_SEASONAL_LOSS[month]
  const clearances = stretch.structures.map((s) => s.verticalClearance - loss)
  const minClearance = clearances.length ? Math.min(...clearances) : Infinity
  const bindingStructure = clearances.length
    ? stretch.structures[clearances.indexOf(minClearance)] : null

  // A metre of air-draft margin is the usual working allowance.
  const MARGIN = 1.0
  const headroom = +(minClearance - vessel.airDraft).toFixed(2)
  const airDraftOk = headroom >= MARGIN

  const lad = stretch.ladByMonth[month]
  // Usable draught keeps half a metre under the keel.
  const usableDraft = Math.max(0, lad - 0.5)
  const loadableT = Math.round(
    vessel.capacityT * Math.max(0, Math.min(1, usableDraft / vessel.fullDraft)))
  const utilisationPct = Math.round((loadableT / vessel.capacityT) * 100)

  const verdict: Feasibility['verdict'] =
    !stretch.navigable || !airDraftOk || loadableT === 0 ? 'blocked'
      : utilisationPct < 70 ? 'restricted' : 'clear'

  const note = !stretch.navigable
    ? 'Stretch is not notified as navigable in this window.'
    : !airDraftOk
      ? `${bindingStructure?.structure ?? 'A structure'} at chainage ${bindingStructure?.chainage ?? '—'} km leaves ${headroom.toFixed(1)} m over the vessel — under the 1.0 m working margin. ${loss > 1 ? 'High water this month is the reason.' : ''}`
      : utilisationPct < 70
        ? `Depth allows only ${utilisationPct}% of rated tonnage — the lean season caps what this barge can carry.`
        : `Passable with ${headroom.toFixed(1)} m of headroom at ${utilisationPct}% of rated tonnage.`

  return {
    month, minClearance: +minClearance.toFixed(1), bindingStructure,
    airDraftOk, headroom, lad, loadableT, utilisationPct, verdict, note,
  }
}

/** The best months to run a given vessel on a stretch. */
export function seasonProfile(stretch: Stretch, vessel: VesselSpec): Feasibility[] {
  return Array.from({ length: 12 }, (_, m) => assess(stretch, vessel, m))
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/* ── Modal comparison against road ────────────────────────────── */

export interface ShiftComparison {
  distanceKm: number
  road: { hours: number; costInr: number; co2Kg: number }
  water: { hours: number; costInr: number; co2Kg: number }
  co2SavedKg: number
  costSavedInr: number
  extraHours: number
}

/** kg CO2e per tonne-km — IWT is the lowest of any mode. */
const CO2_ROAD = 0.09
const CO2_WATER = 0.016
const RATE_ROAD = 3.1
const RATE_WATER = 1.1
const SPEED_ROAD = 38
const SPEED_WATER = 11

export function compareToRoad(distanceKm: number, tonnes: number): ShiftComparison {
  const road = {
    hours: +(distanceKm / SPEED_ROAD + 2).toFixed(1),
    costInr: Math.round(tonnes * distanceKm * RATE_ROAD),
    co2Kg: Math.round(tonnes * distanceKm * CO2_ROAD),
  }
  const water = {
    // Waterway routing is longer than road, and handling at both ends is slow.
    hours: +((distanceKm * 1.15) / SPEED_WATER + 20).toFixed(1),
    costInr: Math.round(tonnes * distanceKm * 1.15 * RATE_WATER),
    co2Kg: Math.round(tonnes * distanceKm * 1.15 * CO2_WATER),
  }
  return {
    distanceKm, road, water,
    co2SavedKg: road.co2Kg - water.co2Kg,
    costSavedInr: road.costInr - water.costInr,
    extraHours: +(water.hours - road.hours).toFixed(1),
  }
}
