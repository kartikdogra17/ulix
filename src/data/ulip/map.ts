/* ────────────────────────────────────────────────────────────────
   Gateway records → domain model.

   Field names here are taken verbatim from the response samples in the
   integration documents, not guessed. Where the gateway does not carry
   something the domain model expects, the gap is declared in FIELD_GAPS
   rather than filled with a plausible default — a fabricated permit date
   is indistinguishable from a real one once it is in the table, and this
   whole product rests on that distinction holding.
   ──────────────────────────────────────────────────────────────── */

import type { FastagCrossing, Vehicle } from '../types'

/** VAHAN/01 response record, as documented. Everything is optional: the
    gateway omits fields rather than nulling them, and state RTOs differ. */
export interface VahanRecord {
  rcRegnNo?: string
  rcOwnerName?: string
  rcMakerDesc?: string
  rcMakerModel?: string
  rcVhClassDesc?: string
  rcFuelDesc?: string
  rcNormsDesc?: string
  rcStatus?: string
  rcBlacklistStatus?: string
  rcRegnUpto?: string
  rcFitUpto?: string
  rcInsuranceUpto?: string
  rcPuccUpto?: string
  rcGvw?: string | number
  rcChasiNo?: string
  rcEngNo?: string
  rcRegisteredAt?: string
}

/** FASTAG/01 transaction record, as documented. */
export interface FastagRecord {
  vehicleRegNo?: string
  tagid?: string
  readerReadTime?: string
  tollPlazaName?: string
  tollPlazaGeocode?: string
  laneDirection?: string
  vehicleType?: string
  seqNo?: string | number
}

/**
 * What ULIP simply does not carry, against a domain model built from the
 * whole picture rather than from one gateway.
 *
 * These are not TODOs. They are the honest shape of the integration, and
 * anything consuming a live vehicle needs to know which fields came from
 * a government register and which are unavailable at any price.
 */
export const FIELD_GAPS = {
  permitUpto: 'No ULIP endpoint returns permit validity. VAHAN/01 carries registration, '
    + 'fitness, insurance and PUC only — there is no permit field in the documented response.',
  permitType: 'Same gap as permitUpto: national/state permit type is not exposed by ULIP.',
  tagBalance: 'FASTAG/01 returns toll READ events, not wallet balance. Balance needs the '
    + 'issuing bank, which is outside ULIP.',
  tagBank: 'Not in the FASTAG/01 response; the tag id identifies the issuer only indirectly.',
  driverName: 'SARATHI/01 needs a licence number AND date of birth. Neither is discoverable '
    + 'from a vehicle number, so a driver cannot be resolved from a plate alone.',
  utilisationPct: 'A commercial metric, not a government record. Comes from your own TMS.',
} as const

export type FieldGap = keyof typeof FIELD_GAPS

/* Longest first: "BHARAT STAGE III" contains "BHARAT STAGE II", and a
   substring match in the wrong order downgrades a BS-III to a BS-II. */
const BS: Array<[string, Vehicle['bsNorm']]> = [
  ['BHARAT STAGE VI', 'BS-VI'], ['BHARAT STAGE IV', 'BS-IV'],
  ['BHARAT STAGE III', 'BS-III'], ['BHARAT STAGE II', 'BS-II'],
  ['BS VI', 'BS-VI'], ['BS-VI', 'BS-VI'], ['BS IV', 'BS-IV'], ['BS-IV', 'BS-IV'],
  ['BS III', 'BS-III'], ['BS-III', 'BS-III'], ['BS II', 'BS-II'], ['BS-II', 'BS-II'],
]

const FUEL: Record<string, Vehicle['fuel']> = {
  DIESEL: 'Diesel', PETROL: 'Petrol', CNG: 'CNG', 'CNG ONLY': 'CNG',
  ELECTRIC: 'Electric', 'ELECTRIC(BOV)': 'Electric', LNG: 'LNG',
  // Real records carry dual-fuel descriptions; the cleaner fuel governs.
  'PETROL/CNG': 'CNG', 'DIESEL/CNG': 'CNG',
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * VAHAN dates are dd-MMM-yyyy in the samples. These are calendar dates with
 * no time, so they are pinned to UTC midnight.
 *
 * The documented form is matched FIRST, deliberately. Handing "25-Jan-2032"
 * to Date.parse succeeds — as local midnight — and toISOString then walks it
 * back across the date line in any positive offset, so in IST the sample
 * expiry came out as 2032-01-24. A statutory expiry that reads a day early
 * marks a compliant vehicle as lapsed on its last valid day.
 */
export function vahanDate(raw: string | undefined): string | null {
  if (!raw) return null
  const m = /^(\d{1,2})[-/]([A-Za-z]{3})[-/](\d{4})$/.exec(raw.trim())
  if (m) {
    const month = MONTHS.indexOf(m[2].toLowerCase())
    if (month >= 0) return new Date(Date.UTC(+m[3], month, +m[1])).toISOString()
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim())
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3])).toISOString()
  const t = Date.parse(raw)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

export function normBs(raw: string | undefined): Vehicle['bsNorm'] | null {
  if (!raw) return null
  const key = raw.trim().toUpperCase()
  for (const [k, v] of BS) if (key.includes(k)) return v
  return null
}

export function normFuel(raw: string | undefined): Vehicle['fuel'] | null {
  if (!raw) return null
  return FUEL[raw.trim().toUpperCase()] ?? null
}

export function normRcStatus(raw: string | undefined): Vehicle['rcStatus'] | null {
  if (!raw) return null
  const s = raw.trim().toUpperCase()
  if (s.includes('ACTIVE')) return 'ACTIVE'
  if (s.includes('SUSPEND')) return 'SUSPENDED'
  if (s.includes('EXPIRE')) return 'EXPIRED'
  return null
}

/** "22.5329,79.5874" or "22.5329 79.5874" — samples show both. */
export function geocode(raw: string | undefined): { lat: number; lon: number } | null {
  if (!raw) return null
  const m = raw.trim().split(/[,\s]+/).map(Number)
  if (m.length < 2 || m.some(Number.isNaN)) return null
  return { lat: m[0], lon: m[1] }
}

export function toCrossings(records: FastagRecord[]): FastagCrossing[] {
  return records
    .map((r, i) => {
      const at = r.readerReadTime ? Date.parse(r.readerReadTime) : NaN
      const geo = geocode(r.tollPlazaGeocode)
      return {
        id: String(r.seqNo ?? `TX${i}`),
        ts: Number.isNaN(at) ? '' : new Date(at).toISOString(),
        plaza: r.tollPlazaName ?? 'Unknown plaza',
        plazaCode: '',
        lane: r.laneDirection ?? '',
        // FASTAG/01 returns the read, not the toll charged.
        amount: 0,
        lat: geo?.lat ?? 0,
        lon: geo?.lon ?? 0,
        direction: (r.laneDirection?.trim().charAt(0).toUpperCase() ?? 'N') as FastagCrossing['direction'],
      }
    })
    .filter((c) => c.ts)
    .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
}

/**
 * What a live vehicle actually looks like: the fields the registers
 * answered for, and an explicit list of the ones nobody can.
 */
export interface LiveVehicle {
  known: Partial<Vehicle> & { regNo: string }
  /** Domain fields no ULIP endpoint can supply, with the reason. */
  gaps: FieldGap[]
  /** Fields the gateway omitted for THIS vehicle, which is different. */
  missing: string[]
}

export function toVehicle(regNo: string, v: VahanRecord, tolls: FastagRecord[]): LiveVehicle {
  const missing: string[] = []
  const need = <T>(field: string, value: T | null): T | undefined => {
    if (value === null || value === undefined) { missing.push(field); return undefined }
    return value
  }

  const gvw = v.rcGvw === undefined ? null : Number(v.rcGvw)
  const known: Partial<Vehicle> & { regNo: string } = {
    regNo: v.rcRegnNo?.trim() || regNo,
    owner: need('owner', v.rcOwnerName ?? null),
    makeModel: need('makeModel', [v.rcMakerDesc, v.rcMakerModel].filter(Boolean).join(' ') || null),
    vehicleClass: need('vehicleClass', v.rcVhClassDesc ?? null),
    fuel: need('fuel', normFuel(v.rcFuelDesc)),
    bsNorm: need('bsNorm', normBs(v.rcNormsDesc)),
    rcStatus: need('rcStatus', normRcStatus(v.rcStatus)),
    rcValidUpto: need('rcValidUpto', vahanDate(v.rcRegnUpto)),
    fitnessUpto: need('fitnessUpto', vahanDate(v.rcFitUpto)),
    insuranceUpto: need('insuranceUpto', vahanDate(v.rcInsuranceUpto)),
    pucUpto: need('pucUpto', vahanDate(v.rcPuccUpto)),
    capacityKg: gvw !== null && !Number.isNaN(gvw) ? gvw : undefined,
    tagId: tolls.find((t) => t.tagid)?.tagid,
    tagStatus: v.rcBlacklistStatus?.trim()
      ? (/NO|NIL|NONE/i.test(v.rcBlacklistStatus) ? 'ACTIVE' : 'BLACKLIST')
      : undefined,
    crossings: toCrossings(tolls),
  }
  if (known.capacityKg === undefined) missing.push('capacityKg')
  if (!known.tagId) missing.push('tagId')
  if (known.tagStatus === undefined) missing.push('tagStatus')

  return { known, gaps: Object.keys(FIELD_GAPS) as FieldGap[], missing }
}
