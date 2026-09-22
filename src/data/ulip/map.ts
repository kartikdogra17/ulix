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
 * EWAYBILL/01 response record, as documented.
 *
 * Note the types: `ewbNo` is a STRING in the request and a NUMBER in the
 * response, and the pincodes are numbers too. The gateway is not
 * self-consistent and the mapper absorbs that rather than the caller.
 */
export interface EwayBillRecord {
  ewbNo?: string | number
  ewayBillDate?: string
  validUpto?: string
  fromPincode?: string | number
  toPincode?: string | number
  hsnCode?: string
  status?: string
  VehiclListDetails?: Array<{
    vehicleNo?: string
    enteredDate?: string
    transMode?: string | number
  }>
}

/** e-Way Bill transport modes, per the GST spec. */
const TRANS_MODE: Record<string, 'road' | 'rail' | 'air' | 'sea'> = {
  '1': 'road', '2': 'rail', '3': 'air', '4': 'sea',
}

/** `ACT` and `CNL` in the documented sample, not the words. */
const EWB_STATUS: Record<string, 'active' | 'cancelled'> = {
  ACT: 'active', CNL: 'cancelled',
}

/**
 * e-Way Bill timestamps are `dd/MM/yyyy hh:mm:ss a`.
 *
 * Parsed by hand, never through Date.parse, which reads `05/11/2017` as
 * 5 May rather than 5 November — silently wrong for the first twelve days
 * of every month, and right the rest of the time, which is the worst
 * possible failure pattern to debug.
 */
export function ewbDate(raw: string | undefined): string | null {
  if (!raw) return null
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?)?\s*$/i
    .exec(raw)
  if (!m) return null
  const [, dd, mm, yyyy, hh, mi, ss, ap] = m
  let hour = hh ? +hh : 0
  if (ap && /PM/i.test(ap) && hour < 12) hour += 12
  if (ap && /AM/i.test(ap) && hour === 12) hour = 0
  return new Date(Date.UTC(+yyyy, +mm - 1, +dd, hour, mi ? +mi : 0, ss ? +ss : 0)).toISOString()
}

export interface LiveEwayBill {
  known: {
    ewbNo?: string
    issuedAt?: string
    validUpto?: string
    fromPincode?: string
    toPincode?: string
    hsnCode?: string
    status?: 'active' | 'cancelled'
    /** Part-B: the vehicle the bill actually declares. */
    partB: Array<{ vehicleNo: string; enteredAt: string | null; mode: string | null }>
  }
  missing: string[]
  /** Problems with the data itself, not with our reading of it. */
  warnings: string[]
}

/**
 * The join the whole product leads with — an e-Way Bill's validity against
 * a movement-derived ETA — depends on `validUpto` being a moment in time.
 *
 * In the documented sample it is `" 11:59:00 PM"`: a time, with a leading
 * space where a date should be, and no date anywhere in it. Either the
 * gateway returns end-of-day without the day, or the published sample lost
 * it. We do not guess. Inferring the date from `ewayBillDate` would
 * fabricate a statutory expiry, and being a day out on one of those is the
 * exact bug already paid for once on VAHAN dates.
 */
export function toEwayBill(r: EwayBillRecord): LiveEwayBill {
  const missing: string[] = []
  const warnings: string[] = []

  const validUpto = ewbDate(r.validUpto)
  if (r.validUpto && !validUpto) {
    missing.push('validUpto')
    warnings.push(
      `validUpto carried no date ("${r.validUpto.trim()}"), so expiry cannot be compared `
      + 'against an ETA. The e-Way Bill expiry signal cannot fire on this record.')
  } else if (!r.validUpto) missing.push('validUpto')

  const issuedAt = ewbDate(r.ewayBillDate)
  if (!issuedAt) missing.push('issuedAt')

  const status = r.status ? EWB_STATUS[r.status.trim().toUpperCase()] : undefined
  if (r.status && !status) warnings.push(`Unknown e-Way Bill status "${r.status}".`)

  return {
    known: {
      ewbNo: r.ewbNo === undefined ? undefined : String(r.ewbNo),
      issuedAt: issuedAt ?? undefined,
      validUpto: validUpto ?? undefined,
      fromPincode: r.fromPincode === undefined ? undefined : String(r.fromPincode),
      toPincode: r.toPincode === undefined ? undefined : String(r.toPincode),
      hsnCode: r.hsnCode?.trim() || undefined,
      status,
      partB: (r.VehiclListDetails ?? [])
        .filter((v) => v.vehicleNo)
        .map((v) => ({
          vehicleNo: String(v.vehicleNo).toUpperCase().replace(/[\s-]/g, ''),
          enteredAt: ewbDate(v.enteredDate),
          mode: v.transMode === undefined ? null : TRANS_MODE[String(v.transMode)] ?? null,
        })),
    },
    missing,
    warnings,
  }
}

/* ── FOIS/01 — rail ──────────────────────────────────────────── */

export interface FoisRecord {
  fnrNo?: string
  newFnr?: string
  cmdt?: string
  currentStatus?: string
  lastRepStts?: string
  lastRepLocn?: string
  locoNumb?: string
  etaDstn?: string
  /** Longitude and latitude, as STRINGS, and longitude is listed first. */
  lgtd?: string
  lttd?: string
  stationFrom?: string
  stationTo?: string
}

/** `lastRepStts` codes seen in the documented sample and the FOIS glossary. */
const FOIS_STATUS: Record<string, string> = {
  AR: 'Arrived', DP: 'Departed', RD: 'Ready', LD: 'Loading', UL: 'Unloading',
  IN: 'In transit', TR: 'In transit',
}

/**
 * FOIS writes `HH:mm dd-MM-yyyy` — the TIME first.
 *
 * That is the third distinct date format across four endpoints, and the
 * only thing they agree on is that `Date.parse` must not be let near any
 * of them. On this one it simply fails, which is the kind outcome; e-Way
 * Bill's dd/MM is the unkind one, because it succeeds and is wrong.
 */
export function foisDate(raw: string | undefined): string | null {
  if (!raw) return null
  const m = /^\s*(\d{1,2}):(\d{2})\s+(\d{1,2})-(\d{1,2})-(\d{4})\s*$/.exec(raw)
  if (!m) return null
  const [, hh, mi, dd, mm, yyyy] = m
  return new Date(Date.UTC(+yyyy, +mm - 1, +dd, +hh, +mi)).toISOString()
}

/** `NEW KUSMUNDA COLLIERY SIDING,  KORBA(NKCR)` → name and station code. */
export function splitStation(raw: string | undefined): { name: string; code: string | null } | null {
  if (!raw?.trim()) return null
  const m = /^(.*?)\(([A-Z0-9]{2,6})\)\s*$/.exec(raw.trim())
  return m
    ? { name: m[1].replace(/\s+/g, ' ').trim().replace(/,$/, ''), code: m[2] }
    : { name: raw.replace(/\s+/g, ' ').trim(), code: null }
}

export interface LiveRake {
  known: {
    fnr?: string
    commodity?: string
    status?: string
    statusLabel?: string
    eta?: string
    from?: { name: string; code: string | null }
    to?: { name: string; code: string | null }
    lastSeen?: { name: string; code: string | null }
    position?: { lat: number; lon: number }
  }
  missing: string[]
}

export function toRake(r: FoisRecord): LiveRake {
  const missing: string[] = []
  const need = <T>(field: string, v: T | null | undefined): T | undefined => {
    if (v === null || v === undefined) { missing.push(field); return undefined }
    return v
  }

  /* Both arrive as strings, and the gateway lists longitude first — a
     tempting place to read them out in the order they appear and end up
     with a rake in the Indian Ocean. */
  const lat = r.lttd === undefined ? NaN : Number(r.lttd)
  const lon = r.lgtd === undefined ? NaN : Number(r.lgtd)
  const position = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : undefined
  if (!position) missing.push('position')

  const code = r.lastRepStts?.trim().toUpperCase()
  return {
    known: {
      fnr: (r.newFnr?.trim() || r.fnrNo?.trim()) ?? undefined,
      commodity: need('commodity', r.cmdt?.trim() || null),
      status: code || undefined,
      statusLabel: code ? FOIS_STATUS[code] ?? code : undefined,
      eta: need('eta', foisDate(r.etaDstn)),
      from: need('from', splitStation(r.stationFrom)),
      to: need('to', splitStation(r.stationTo)),
      lastSeen: splitStation(r.lastRepLocn) ?? undefined,
      position,
    },
    missing,
  }
}

/* ── ICEGATE/02 — bill of entry ──────────────────────────────── */

export interface BoeRecord {
  imoCode?: string
  containerNo?: string[]
  unitOfQt?: string
  igmDt?: string
  natureOfCargo?: string
  countryOrig?: string
  grossWt?: number
  totNoPkg?: number
}

/** `natureOfCargo` codes. */
const CARGO_NATURE: Record<string, string> = {
  C: 'Containerised', B: 'Break bulk', L: 'Liquid bulk', D: 'Dry bulk',
}

/**
 * ICEGATE writes dates as `ddMMyyyy` with no separators at all.
 *
 * The fourth format in four endpoints. `Date.parse("04072011")` does not
 * fail — it produces something, which is why this is parsed by position
 * rather than trusted to a general parser.
 */
export function icegateDate(raw: string | undefined): string | null {
  if (!raw) return null
  const m = /^(\d{2})(\d{2})(\d{4})$/.exec(raw.trim())
  if (!m) return null
  const [, dd, mm, yyyy] = m
  const d = new Date(Date.UTC(+yyyy, +mm - 1, +dd))
  // Reject 31-02 and friends rather than letting them roll into March.
  if (d.getUTCDate() !== +dd || d.getUTCMonth() !== +mm - 1) return null
  return d.toISOString()
}

export interface LiveBoe {
  known: {
    containers: string[]
    imoCode?: string
    igmDate?: string
    natureOfCargo?: string
    natureLabel?: string
    countryOfOrigin?: string
    grossWeight?: number
    unit?: string
    packages?: number
  }
  missing: string[]
}

/**
 * IMPORTANT: an unknown bill of entry comes back as `boeDetails: []` with
 * `responseStatus: "SUCCESS"`, NOT as the error envelope. `isNotFound()`
 * will not catch it, so a caller checking only that reads "no such BE" as
 * a successful lookup. Callers must check the array is non-empty too —
 * see `boeFound`.
 */
export const boeFound = (details: BoeRecord[] | undefined) => (details?.length ?? 0) > 0

export function toBoe(r: BoeRecord): LiveBoe {
  const missing: string[] = []
  const nature = r.natureOfCargo?.trim().toUpperCase()
  const igmDate = icegateDate(r.igmDt)
  if (r.igmDt && !igmDate) missing.push('igmDate')

  return {
    known: {
      // Always an array in the documented response, even for one box.
      containers: (r.containerNo ?? []).map((c) => c.trim().toUpperCase()).filter(Boolean),
      imoCode: r.imoCode?.trim() || undefined,
      igmDate: igmDate ?? undefined,
      natureOfCargo: nature || undefined,
      natureLabel: nature ? CARGO_NATURE[nature] ?? nature : undefined,
      countryOfOrigin: r.countryOrig?.trim().toUpperCase() || undefined,
      grossWeight: typeof r.grossWt === 'number' ? r.grossWt : undefined,
      unit: r.unitOfQt?.trim() || undefined,
      packages: typeof r.totNoPkg === 'number' ? r.totNoPkg : undefined,
    },
    missing,
  }
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
