/* ────────────────────────────────────────────────────────────────
   PM GatiShakti — the infrastructure the network runs ON.

   Every other module in this app describes things that MOVE. This one
   describes what they move over: national highway corridors and their
   lane status, toll plazas, industrial parks, and warehousing capacity.
   It is a layer under the map rather than a screen of its own, because
   a corridor is only interesting next to the consignments using it.

   The join that makes it worth wiring: GatiShakti knows a corridor
   segment is still two-lane; your own consignments know how much
   tonnage you route over it. Neither system can see the pinch. Put
   them side by side and it is obvious.

   Endpoints, per ULIP_GATISHAKTI_Integration_Requirement:
     GATISHAKTI/01  nhno    → highway segments, gis_length, lane_statu
     GATISHAKTI/02  stateid → storage and warehousing infrastructure
     GATISHAKTI/03  stateid → toll plazas, operator, lanes, nearest hospital
     GATISHAKTI/04  stateid → industrial parks, land category, land available
     GATISHAKTI/05  gid     → named economic corridors, lane count, length
   ──────────────────────────────────────────────────────────────── */

import { TOLL_PLAZAS, float, haversine, int, pick, rng, type LatLon } from './mock/seed'

export const GATISHAKTI_SOURCES = [
  'GATISHAKTI/01', 'GATISHAKTI/02', 'GATISHAKTI/03', 'GATISHAKTI/04', 'GATISHAKTI/05',
]

export type CorridorMode = 'road' | 'rail'

export interface CorridorSegment {
  /** `gid` in GATISHAKTI/05. */
  gid: number
  from: string
  to: string
  /**
   * `lane_statu` verbatim from GATISHAKTI/01 — '2L', '4L', '6L' on road,
   * tracks on rail. A string, not a number, because that is what the
   * gateway returns and normalising it would lose '2L/4L' mixed stretches.
   */
  lanes: string
  lengthKm: number
  a: LatLon
  b: LatLon
}

export interface Corridor {
  id: string
  name: string
  mode: CorridorMode
  /** The `nhno` GATISHAKTI/01 accepts. Rail corridors have none. */
  nh: string | null
  segments: CorridorSegment[]
  lengthKm: number
  /** Narrowest lane status anywhere along it — the corridor's real capacity. */
  narrowest: string
  /** True when that narrowest stretch is a genuine constraint for this mode. */
  belowStandard: boolean
  /** Segments at the narrowest status, but only when it is sub-standard. */
  pinchPoints: number
}

export interface TollPlaza {
  name: string; nh: string; lat: number; lon: number
  lanes: string; operator: string; project: string
}

export interface IndustrialPark {
  name: string; type: string; category: string
  state: string; district: string
  lat: number; lon: number
  /** `land_avail`, hectares. Zero is common and meaningful: park is full. */
  landAvailableHa: number
}

export interface StorageDepot {
  name: string; state: string; address: string
  capacityTonnes: number; owner: string; type: string
}

export interface GatiShaktiLayer {
  corridors: Corridor[]
  tollPlazas: TollPlaza[]
  parks: IndustrialPark[]
  depots: StorageDepot[]
  sources: string[]
}

/* ── Corridor alignments ────────────────────────────────────────
   Real waypoints on the real NHDP and DFC alignments. The corridors
   and their routing are factual; lane status, tolls and land figures
   below are generated. */

type Way = [name: string, lat: number, lon: number]

const GOLDEN_QUADRILATERAL: Way[] = [
  ['Delhi', 28.61, 77.21], ['Jaipur', 26.91, 75.79], ['Ahmedabad', 23.03, 72.58],
  ['Vadodara', 22.31, 73.18], ['Mumbai', 19.08, 72.88], ['Pune', 18.52, 73.86],
  ['Belagavi', 15.85, 74.50], ['Bengaluru', 12.97, 77.59], ['Chennai', 13.08, 80.27],
  ['Vijayawada', 16.51, 80.65], ['Visakhapatnam', 17.69, 83.22], ['Bhubaneswar', 20.30, 85.82],
  ['Kolkata', 22.57, 88.36], ['Varanasi', 25.32, 82.97], ['Kanpur', 26.45, 80.33],
  ['Agra', 27.18, 78.01], ['Delhi', 28.61, 77.21],
]

const NORTH_SOUTH: Way[] = [
  ['Srinagar', 34.08, 74.80], ['Jammu', 32.73, 74.87], ['Jalandhar', 31.33, 75.58],
  ['Ambala', 30.38, 76.78], ['Delhi', 28.61, 77.21], ['Agra', 27.18, 78.01],
  ['Gwalior', 26.22, 78.18], ['Jhansi', 25.45, 78.57], ['Nagpur', 21.15, 79.09],
  ['Hyderabad', 17.39, 78.49], ['Kurnool', 15.83, 78.04], ['Bengaluru', 12.97, 77.59],
  ['Salem', 11.66, 78.15], ['Madurai', 9.93, 78.12], ['Kanyakumari', 8.08, 77.55],
]

const EAST_WEST: Way[] = [
  ['Porbandar', 21.64, 69.61], ['Rajkot', 22.30, 70.80], ['Ahmedabad', 23.03, 72.58],
  ['Indore', 22.72, 75.86], ['Jhansi', 25.45, 78.57], ['Kanpur', 26.45, 80.33],
  ['Lucknow', 26.85, 80.95], ['Gorakhpur', 26.76, 83.37], ['Muzaffarpur', 26.12, 85.39],
  ['Siliguri', 26.73, 88.40], ['Guwahati', 26.14, 91.74], ['Silchar', 24.83, 92.78],
]

const WESTERN_DFC: Way[] = [
  ['Dadri', 28.55, 77.55], ['Rewari', 28.19, 76.62], ['Ajmer', 26.45, 74.64],
  ['Palanpur', 24.17, 72.43], ['Ahmedabad', 23.03, 72.58], ['Vadodara', 22.31, 73.18],
  ['Vasai Road', 19.39, 72.83], ['JNPA Nhava Sheva', 18.95, 72.94],
]

const EASTERN_DFC: Way[] = [
  ['Ludhiana', 30.90, 75.85], ['Ambala', 30.38, 76.78], ['Saharanpur', 29.96, 77.55],
  ['Khurja', 28.25, 77.85], ['Kanpur', 26.45, 80.33], ['Pandit Deen Dayal Upadhyaya Jn', 25.28, 83.12],
  ['Dhanbad', 23.80, 86.43], ['Dankuni', 22.68, 88.29],
]

interface Spec { id: string; name: string; mode: CorridorMode; nh: string | null; ways: Way[] }

const SPECS: Spec[] = [
  { id: 'gq', name: 'Golden Quadrilateral', mode: 'road', nh: 'NH-48', ways: GOLDEN_QUADRILATERAL },
  { id: 'ns', name: 'North–South Corridor', mode: 'road', nh: 'NH-44', ways: NORTH_SOUTH },
  { id: 'ew', name: 'East–West Corridor', mode: 'road', nh: 'NH-27', ways: EAST_WEST },
  { id: 'wdfc', name: 'Western Dedicated Freight Corridor', mode: 'rail', nh: null, ways: WESTERN_DFC },
  { id: 'edfc', name: 'Eastern Dedicated Freight Corridor', mode: 'rail', nh: null, ways: EASTERN_DFC },
]

/**
 * Lane status, weighted so most of the network is adequate and a minority
 * is not.
 *
 * The rates look small on purpose and were arrived at by checking the
 * output rather than trusting the intuition. A 1-in-6 chance of a
 * two-lane segment sounds like a minority until you remember the Golden
 * Quadrilateral has sixteen segments: at that rate 94% of corridors come
 * back constrained, which is "flags everything" wearing a different hat.
 * At 5% roughly half of them do, which is a finding rather than wallpaper.
 */
function laneFor(r: () => number, mode: CorridorMode): string {
  if (mode === 'rail') return r() < 0.08 ? '1T' : '2T'
  const x = r()
  return x < 0.05 ? '2L' : x < 0.62 ? '4L' : '6L'
}

/**
 * Ranks are only ever compared WITHIN one corridor, and a corridor is one
 * mode throughout, so road and rail sharing a scale here is safe. They are
 * never compared across modes: a two-track freight corridor is not "worse"
 * than a four-lane highway, it is a different question entirely.
 */
const LANE_RANK: Record<string, number> = { '1T': 0, '2L': 1, '2T': 2, '4L': 3, '6L': 4 }

/** The grade at which a corridor is a real capacity constraint, per mode. */
const SUB_STANDARD: Record<CorridorMode, string> = { road: '2L', rail: '1T' }

const PARK_TYPES = ['Mega Food Park', 'Industrial Park', 'SEZ', 'Logistics Park', 'Textile Park']
const LAND_CATEGORIES = ['Industrial Park', 'Warehousing', 'Mixed Use', 'Industrial Estate']
const DEPOT_TYPES = ['LOAD BEARING STRUCTURES', 'CAP STORAGE', 'SILO', 'COVERED GODOWN']
const DEPOT_OWNERS = ['TRANSFERRED FROM GOI', 'OWNED', 'HIRED — STATE AGENCY', 'HIRED — PRIVATE']

const PARK_SITES: Array<[string, string, string, number, number]> = [
  ['Jangipur Bengal Mega Food Park', 'West Bengal', 'Murshidabad', 24.41, 88.05],
  ['Sanand Industrial Estate', 'Gujarat', 'Ahmedabad', 22.99, 72.38],
  ['Chakan Industrial Area', 'Maharashtra', 'Pune', 18.76, 73.86],
  ['Sriperumbudur Auto Cluster', 'Tamil Nadu', 'Kanchipuram', 12.96, 79.94],
  ['Nagpur MIHAN SEZ', 'Maharashtra', 'Nagpur', 21.05, 79.05],
  ['Vizag Special Economic Zone', 'Andhra Pradesh', 'Visakhapatnam', 17.69, 83.22],
  ['Pithampur Sector 3', 'Madhya Pradesh', 'Dhar', 22.61, 75.69],
  ['Hosur Industrial Complex', 'Tamil Nadu', 'Krishnagiri', 12.74, 77.83],
  ['Bidkin Industrial Node', 'Maharashtra', 'Aurangabad', 19.75, 75.42],
  ['Dholera Special Investment Region', 'Gujarat', 'Ahmedabad', 22.25, 72.18],
  ['Khurja Logistics Park', 'Uttar Pradesh', 'Bulandshahr', 28.25, 77.85],
  ['Panipat Textile Park', 'Haryana', 'Panipat', 29.39, 76.97],
]

const DEPOT_SITES: Array<[string, string, string]> = [
  ['FSD NARAINA', 'Delhi', 'F.C.I., Food Storage Depot Mayapuri, Delhi-110064'],
  ['FSD CTO', 'Delhi', 'F.C.I., Food Storage Depot CTO, Delhi-110060'],
  ['FSD KANDLA', 'Gujarat', 'F.C.I., Port Complex, Kandla-370210'],
  ['FSD WHITEFIELD', 'Karnataka', 'F.C.I., Whitefield, Bengaluru-560066'],
  ['FSD TONDIARPET', 'Tamil Nadu', 'F.C.I., Tondiarpet, Chennai-600081'],
  ['FSD KALAMBOLI', 'Maharashtra', 'F.C.I., Kalamboli, Navi Mumbai-410218'],
  ['FSD DANKUNI', 'West Bengal', 'F.C.I., Dankuni, Hooghly-712310'],
  ['FSD MOGA', 'Punjab', 'F.C.I., Moga-142001'],
  ['FSD KANPUR', 'Uttar Pradesh', 'F.C.I., Fazalganj, Kanpur-208012'],
]

export function makeGatiShakti(): GatiShaktiLayer {
  const r = rng(90417)

  const corridors: Corridor[] = SPECS.map((spec) => {
    const segments: CorridorSegment[] = []
    for (let i = 0; i < spec.ways.length - 1; i++) {
      const [fromName, aLat, aLon] = spec.ways[i]
      const [toName, bLat, bLon] = spec.ways[i + 1]
      const a = { lat: aLat, lon: aLon }
      const b = { lat: bLat, lon: bLon }
      segments.push({
        gid: segments.length + 1,
        from: fromName,
        to: toName,
        lanes: laneFor(r, spec.mode),
        lengthKm: haversine(a, b),
        a,
        b,
      })
    }
    const narrowest = segments.reduce(
      (worst, s) => (LANE_RANK[s.lanes] < LANE_RANK[worst] ? s.lanes : worst),
      segments[0].lanes)
    // Only a sub-standard narrowest counts as a pinch. Without this a
    // corridor that is six-lane end to end reports every segment as a
    // constraint, and the map draws the whole thing amber.
    const belowStandard = narrowest === SUB_STANDARD[spec.mode]
    return {
      ...spec,
      segments,
      lengthKm: segments.reduce((n, s) => n + s.lengthKm, 0),
      narrowest,
      belowStandard,
      pinchPoints: belowStandard ? segments.filter((s) => s.lanes === narrowest).length : 0,
    }
  })

  /* GATISHAKTI/03 returns the plaza's own coordinates, so these are plotted. */
  const tollPlazas: TollPlaza[] = TOLL_PLAZAS.map(([name, nh, lat, lon]) => ({
    name, nh, lat, lon,
    lanes: pick(r, ['4L', '6L', '8L']),
    operator: pick(r, [
      'NHAI', 'M/s GMR Highways', 'IRB Infrastructure', 'M/s Ashoka Buildcon',
      'Dilip Buildcon', 'M/s Sadbhav Infrastructure',
    ]),
    project: `${name} — ${nh}`,
  }))

  const parks: IndustrialPark[] = PARK_SITES.map(([name, state, district, lat, lon]) => ({
    name, state, district, lat, lon,
    type: pick(r, PARK_TYPES),
    category: pick(r, LAND_CATEGORIES),
    // land_avail is 0 in the documented sample often enough that a full park
    // has to be representable. A layer where every park has room is useless
    // to anyone deciding where to put a warehouse.
    landAvailableHa: r() < 0.3 ? 0 : float(r, 4, 180, 1),
  }))

  /* GATISHAKTI/02 returns a state and a postal address and NO coordinates,
     so depots are counted and listed, never plotted. Geocoding them would
     be inventing a field the gateway does not return. */
  const depots: StorageDepot[] = DEPOT_SITES.map(([name, state, address]) => ({
    name, state, address,
    capacityTonnes: int(r, 8_000, 120_000),
    owner: pick(r, DEPOT_OWNERS),
    type: pick(r, DEPOT_TYPES),
  }))

  return { corridors, tollPlazas, parks, depots, sources: GATISHAKTI_SOURCES }
}

/** Corridors carrying a genuine capacity constraint, judged per mode. */
export const constrained = (corridors: Corridor[]) => corridors.filter((c) => c.belowStandard)
