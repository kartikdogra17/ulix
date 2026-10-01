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

/* ── PCS/01 — port community system, by IGM number ───────────── */

/**
 * PCS/01 response record, as documented.
 *
 * Every field is nullable because the MISS carries all of them as null —
 * see `pcsFound`. The numbers are inconsistent in the way ULIP always is:
 * `grossWeight` and `container_weight` come back as numbers, while the two
 * package counts come back as strings.
 */
export interface PcsRecord {
  custom_house_code?: string | null
  igm_no?: string | null
  igm_date?: string | null
  voyage_no?: string | null
  shipping_line_code?: string | null
  shipping_agent_code?: string | null
  port_of_arrival?: string | null
  expected_date_and_time_of_arrival?: string | null
  terminal_operator_code?: string | null
  cargo_imo_code?: string | null
  line_no?: string | null
  sub_line_no?: string | null
  bill_no?: string | null
  bill_date?: string | null
  port_of_loading?: string | null
  port_of_destination?: string | null
  nature_of_cargo?: string | null
  port_of_discharge?: string | null
  grossWeight?: number | string | null
  number_of_packages?: number | string | null
  goods_description?: string | null
  mode_of_transport?: string | null
  container_no?: string | null
  line_number?: string | null
  sub_line_number?: string | null
  container_seal_no?: string | null
  total_no_of_packages?: number | string | null
  container_weight?: number | string | null
  iso_code?: string | null
  responseMsg?: string | null
}

/**
 * PCS writes the ETA as `ddMMyyyy:HH:mm` — ICEGATE's separator-free date
 * with a time bolted on after a colon.
 *
 * That is the fifth distinct date format across six endpoints, and PCS/01
 * carries two of them at once: this one, and bare `ddMMyyyy` on `igm_date`
 * and `bill_date`. Date.parse returns NaN here, which is the kind outcome.
 *
 * Read day-first, and the sample settles that rather than convention: the
 * document's other two dates are `27022023` and `30012023`, whose leading
 * pair cannot be a month. On the ETA `02032023` alone both readings parse,
 * and the wrong one dates the vessel's arrival 24 days BEFORE the manifest
 * that declares it.
 */
export function pcsEtaDate(raw: string | null | undefined): string | null {
  if (!raw) return null
  const m = /^\s*(\d{2})(\d{2})(\d{4}):(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/.exec(raw)
  if (!m) return null
  const [, dd, mm, yyyy, hh, mi, ss] = m
  const d = new Date(Date.UTC(+yyyy, +mm - 1, +dd, +hh, +mi, ss ? +ss : 0))
  if (d.getUTCDate() !== +dd || d.getUTCMonth() !== +mm - 1) return null
  return d.toISOString()
}

/**
 * True when a field masked for privacy, not a field with a value.
 *
 * PCS returns `goods_description` with every other character replaced:
 * `"P*A*T*C*R*G*I*D*H* *O*E*3*0*1*9*…"`. It is present, non-empty and
 * useless, so anything that renders a description to an operator has to
 * know the difference — a screen full of asterisks reads as corruption.
 */
export function isMasked(raw: string | null | undefined): boolean {
  if (!raw) return false
  const stars = (raw.match(/\*/g) ?? []).length
  return stars > 0 && stars / raw.length >= 0.3
}

/** The substantive fields — the ones that are all null on a miss. */
const PCS_SUBSTANTIVE: Array<keyof PcsRecord> = [
  'igm_no', 'igm_date', 'voyage_no', 'bill_no', 'container_no',
  'port_of_arrival', 'port_of_loading', 'port_of_discharge',
]

/**
 * IMPORTANT: a PCS/01 miss is the most dangerous of the three shapes ULIP
 * uses to report one.
 *
 * ICEGATE returns an EMPTY list under `responseStatus: "SUCCESS"`; LDB
 * returns `responseStatus: "FAILURE"`. PCS returns **one fully-populated
 * record whose every field is null**, under `responseStatus: "SUCCESS"`,
 * with the only marker being `responseMsg: "not found"` where a hit says
 * `"SUCCESS"`. Neither `isNotFound()` nor a length check catches it, and a
 * mapper that does not look produces a consignment with no IGM number and
 * no port — indistinguishable from a real record the gateway answered
 * thinly for.
 */
export function pcsMiss(r: PcsRecord | undefined): boolean {
  if (!r) return true
  if (/not\s*found/i.test(r.responseMsg ?? '')) return true
  return PCS_SUBSTANTIVE.every((k) => r[k] === null || r[k] === undefined || r[k] === '')
}

export const pcsFound = (rows: PcsRecord[] | undefined) => (rows ?? []).some((r) => !pcsMiss(r))

export interface LivePcs {
  known: {
    igmNo?: string
    igmDate?: string
    /** Vessel arrival, from `expected_date_and_time_of_arrival`. */
    eta?: string
    voyageNo?: string
    customHouse?: string
    portOfArrival?: string
    portOfLoading?: string
    portOfDischarge?: string
    portOfDestination?: string
    terminalOperator?: string
    shippingLineCode?: string
    shippingAgentCode?: string
    billNo?: string
    billDate?: string
    lineNo?: string
    subLineNo?: string
    containerNo?: string
    containerSealNo?: string
    isoCode?: string
    natureOfCargo?: string
    natureLabel?: string
    /** Undocumented unit — see the warning this mapper raises. */
    grossWeight?: number
    containerWeight?: number
    packages?: number
    totalPackages?: number
    goodsDescription?: string
    /** Raw `cargo_imo_code`, only when it reads as an IMDG class. */
    imdgClass?: string
  }
  missing: string[]
  warnings: string[]
}

const num = (v: number | string | null | undefined): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

const str = (v: string | null | undefined): string | undefined => v?.trim() || undefined

export function toPcs(r: PcsRecord): LivePcs {
  const missing: string[] = []
  const warnings: string[] = []

  if (pcsMiss(r)) {
    warnings.push(
      'PCS/01 answered with a null record — this IGM number is not in the port '
      + 'community system. The envelope reports SUCCESS regardless.')
    return { known: {}, missing: ['record'], warnings }
  }

  const eta = pcsEtaDate(r.expected_date_and_time_of_arrival)
  if (r.expected_date_and_time_of_arrival && !eta) {
    missing.push('eta')
    warnings.push(
      `Could not read the vessel ETA "${r.expected_date_and_time_of_arrival}" as `
      + 'ddMMyyyy:HH:mm, so no arrival can be compared against a berth window.')
  } else if (!r.expected_date_and_time_of_arrival) missing.push('eta')

  const igmDate = icegateDate(r.igm_date ?? undefined)
  if (r.igm_date && !igmDate) missing.push('igmDate')

  /* `cargo_imo_code` is a CARGO hazard code, not ICEGATE's `imoCode`, which
     the ICEGATE document defines as the identifier of the SHIP. Two fields,
     near-identical names, different namespaces — joining them would file a
     vessel number as a hazard class. IMDG classes are 1-9; the documented
     sample carries "ZZZ", which is not one, so it is reported rather than
     passed through as though the cargo were classified. */
  const imo = str(r.cargo_imo_code)
  const imdgClass = imo && /^[1-9](\.[1-9])?$/.test(imo) ? imo : undefined
  if (imo && !imdgClass) {
    warnings.push(
      `cargo_imo_code is "${imo}", which is not an IMDG class (1-9). Treated as `
      + 'no declared hazard class rather than as a classification.')
  }

  const description = str(r.goods_description)
  if (isMasked(description)) {
    warnings.push('goods_description is masked by the gateway and carries no readable text.')
  }

  const nature = r.nature_of_cargo?.trim().toUpperCase()

  /* Two weights, two package counts, and the document gives a unit for
     none of them. In the sample `grossWeight` is 50847 and
     `container_weight` is 25.65 — three orders of magnitude apart, so they
     are certainly not the same unit. Adding them, or showing either
     without a unit, invents a fact. */
  const grossWeight = num(r.grossWeight)
  const containerWeight = num(r.container_weight)
  if (grossWeight !== undefined && containerWeight !== undefined) {
    warnings.push(
      'PCS/01 documents no unit for grossWeight or container_weight; they are not '
      + 'comparable to each other and must be labelled as unitless.')
  }

  return {
    known: {
      igmNo: str(r.igm_no),
      igmDate: igmDate ?? undefined,
      eta: eta ?? undefined,
      voyageNo: str(r.voyage_no),
      customHouse: str(r.custom_house_code)?.toUpperCase(),
      portOfArrival: str(r.port_of_arrival)?.toUpperCase(),
      portOfLoading: str(r.port_of_loading)?.toUpperCase(),
      portOfDischarge: str(r.port_of_discharge)?.toUpperCase(),
      portOfDestination: str(r.port_of_destination)?.toUpperCase(),
      terminalOperator: str(r.terminal_operator_code)?.toUpperCase(),
      shippingLineCode: str(r.shipping_line_code),
      shippingAgentCode: str(r.shipping_agent_code),
      billNo: str(r.bill_no),
      billDate: icegateDate(r.bill_date ?? undefined) ?? undefined,
      // line_no/line_number and sub_line_no/sub_line_number are duplicate
      // pairs carrying the same value; one of each is read.
      lineNo: str(r.line_no) ?? str(r.line_number),
      subLineNo: str(r.sub_line_no) ?? str(r.sub_line_number),
      containerNo: str(r.container_no)?.toUpperCase(),
      // Looks exactly like a container number and is not one.
      containerSealNo: str(r.container_seal_no)?.toUpperCase(),
      isoCode: str(r.iso_code),
      natureOfCargo: nature || undefined,
      natureLabel: nature ? CARGO_NATURE[nature] ?? nature : undefined,
      grossWeight,
      containerWeight,
      packages: num(r.number_of_packages),
      totalPackages: num(r.total_no_of_packages),
      goodsDescription: isMasked(description) ? undefined : description,
      imdgClass,
    },
    missing,
    warnings,
  }
}

/* ── LDB/01 — container track, by container number ───────────── */

/** A `trackLog` / `last_event` entry, as documented. */
export interface LdbEvent {
  serialno?: number | null
  eventname?: string | null
  currentlocation?: string | null
  division?: string | null
  /** Local wall-clock, `yyyy-MM-dd HH:mm:ss`, with the zone in a SEPARATE field. */
  timestamptimezone?: string | null
  timezoneabvr?: string | null
  latitude?: number | null
  longitude?: number | null
  containernumber?: string | null
  /** Epoch milliseconds. The only unambiguous time on the record. */
  timeinms?: number | null
  transportmode?: string | null
  type?: string | null
  isempty?: string | null
}

/** A `vessel_eta` / `vessel_etd` / `vessel_ata` entry, as documented. */
export interface LdbVesselEvent {
  eventid?: number | null
  eventname?: string | null
  orgname?: string | null
  /** When the notice was PUBLISHED, not when the vessel arrives. */
  infotime?: number | null
  timeinms?: number | null
  timetimestamp?: string | null
  latitude?: number | null
  longitude?: number | null
  vesselname?: string | null
  vesselimo?: string | null
  cntrcycleid?: number | null
  shippingline?: string | null
}

export interface LdbTrail {
  cntrDetail?: {
    cntrno?: string | null
    refflg?: string | null
    cntrsize?: number | string | null
    isocode?: string | null
    containertype?: string | null
  } | null
  dpd_dpe?: unknown
  last_event?: LdbEvent[] | null
  res_Message?: string | null
  trackLog?: LdbEvent[] | null
  vessel_ata?: LdbVesselEvent[] | null
  vessel_atd?: LdbVesselEvent[] | null
  vessel_eta?: LdbVesselEvent[] | null
  vessel_etd?: LdbVesselEvent[] | null
  vessel_gate_cutoff?: LdbVesselEvent[] | null
}

/** LDB/01 returns BOTH trails every time; one of them is empty. */
export interface LdbRecord {
  eximContainerTrail?: LdbTrail | null
  domesticContainerTrail?: LdbTrail | null
}

/** Zone abbreviations LDB is documented to use, in minutes east of UTC. */
const LDB_ZONES: Record<string, number> = { IST: 330, UTC: 0, GMT: 0 }

/**
 * When an LDB event actually happened.
 *
 * The record carries the same instant twice: `timeinms` as epoch
 * milliseconds, and `timestamptimezone` as `"2023-03-29 11:00:09"` with
 * the zone in a DIFFERENT field, `timezoneabvr: "IST"`.
 *
 * `Date.parse` on that string reads it in the RUNTIME's zone. On a laptop
 * set to Asia/Kolkata the two agree exactly, so the bug is invisible while
 * you are writing it; on the UTC box that runs the delivery job and the
 * serverless functions, every LDB timestamp lands 5½ hours early — early
 * enough to move a port-out across a shift boundary and to age a signal
 * past an SLA it has not breached.
 *
 * So `timeinms` wins whenever it is there, and the string is read by hand
 * against its own declared zone when it is not. An unrecognised zone is
 * refused rather than assumed to be UTC.
 */
export function ldbEventTime(ev: { timeinms?: number | null; timestamptimezone?: string | null; timezoneabvr?: string | null }): string | null {
  if (typeof ev.timeinms === 'number' && Number.isFinite(ev.timeinms) && ev.timeinms > 0) {
    return new Date(ev.timeinms).toISOString()
  }
  const raw = ev.timestamptimezone?.trim()
  if (!raw) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw)
  if (!m) return null
  const zone = ev.timezoneabvr?.trim().toUpperCase()
  const offset = zone ? LDB_ZONES[zone] : undefined
  if (offset === undefined) return null
  const [, yyyy, mm, dd, hh, mi, ss] = m
  return new Date(
    Date.UTC(+yyyy, +mm - 1, +dd, +hh, +mi, ss ? +ss : 0) - offset * 60_000,
  ).toISOString()
}

/**
 * Which of the two trails this container is actually on.
 *
 * LDB/01 always returns `eximContainerTrail` AND `domesticContainerTrail`.
 * The one that does not apply comes back with every field null and
 * `res_Message: "NO RECORD FOUND"`. Reading `eximContainerTrail`
 * unconditionally — the obvious thing, and the one the sample invites
 * because the EXIM trail is the populated one there — returns nothing at
 * all for every domestic container.
 */
export function ldbTrail(r: LdbRecord | undefined): { kind: 'exim' | 'domestic'; trail: LdbTrail } | null {
  const has = (t: LdbTrail | null | undefined) =>
    !!t && !/no\s*record\s*found/i.test(t.res_Message ?? '')
    && (!!t.cntrDetail || !!t.trackLog?.length || !!t.last_event?.length)
  if (has(r?.eximContainerTrail)) return { kind: 'exim', trail: r!.eximContainerTrail! }
  if (has(r?.domesticContainerTrail)) return { kind: 'domestic', trail: r!.domesticContainerTrail! }
  return null
}

export interface LiveContainer {
  known: {
    containerNo?: string
    kind?: 'exim' | 'domestic'
    sizeFt?: number
    isoCode?: string
    reefer?: boolean
    /** Newest first, like every other event list in this codebase. */
    events: Array<{
      seq: number | null
      name: string
      at: string
      location: string | null
      mode: string | null
      empty: boolean | null
      lat: number | null
      lon: number | null
    }>
    lastEvent?: { name: string; at: string; location: string | null }
    vesselEta?: { at: string; vessel: string | null; line: string | null; terminal: string | null }
  }
  missing: string[]
  warnings: string[]
}

export function toLdb(r: LdbRecord): LiveContainer {
  const missing: string[] = []
  const warnings: string[] = []

  const picked = ldbTrail(r)
  if (!picked) {
    warnings.push(
      'LDB/01 returned no populated trail — neither the EXIM nor the domestic side '
      + 'has this container.')
    return { known: { events: [] }, missing: ['trail'], warnings }
  }
  const { kind, trail } = picked

  /* `trackLog` is numbered ascending and ordered NEWEST first: serialno 1 is
     PORT OUT on the 29th, serialno 2 is PORT IN on the 28th. Taking the last
     element as "latest" — or sorting by serialno — gives the oldest event.
     Sorted by resolved instant instead, so the ordering does not depend on
     the gateway keeping its own convention. */
  const raw = trail.trackLog?.length ? trail.trackLog : trail.last_event ?? []
  const events = raw
    .map((ev) => {
      const at = ldbEventTime(ev)
      if (!at && (ev.timeinms || ev.timestamptimezone)) {
        warnings.push(
          `Dropped a "${ev.eventname ?? 'unnamed'}" event: its timestamp `
          + `("${ev.timestamptimezone ?? ev.timeinms}", zone `
          + `"${ev.timezoneabvr ?? 'absent'}") could not be placed on a clock.`)
      }
      return at ? {
        seq: typeof ev.serialno === 'number' ? ev.serialno : null,
        name: str(ev.eventname) ?? 'Unknown event',
        at,
        location: str(ev.currentlocation) ?? null,
        mode: str(ev.transportmode)?.toLowerCase() ?? null,
        // "Y"/"N", and an absent flag is unknown rather than laden.
        empty: ev.isempty ? /^Y/i.test(ev.isempty) : null,
        lat: typeof ev.latitude === 'number' ? ev.latitude : null,
        lon: typeof ev.longitude === 'number' ? ev.longitude : null,
      } : null
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))

  if (!events.length) missing.push('events')

  /* `vessel_eta` carries TWO epochs. `timeinms` is the arrival;
     `infotime` is when the notice was published, and in the documented
     sample it is a WEEK LATER than the arrival it describes. Reading the
     first number on the record puts the vessel eight days out. */
  const etaRow = trail.vessel_eta?.find((v) => v.timeinms || v.timetimestamp)
  const etaAt = etaRow ? ldbEventTime(etaRow) : null
  if (trail.vessel_eta?.length && !etaAt) missing.push('vesselEta')

  const size = num(trail.cntrDetail?.cntrsize)
  const iso = str(trail.cntrDetail?.isocode)

  return {
    known: {
      containerNo: (str(trail.cntrDetail?.cntrno)
        ?? str(raw.find((e) => e.containernumber)?.containernumber))?.toUpperCase(),
      kind,
      sizeFt: size,
      isoCode: iso,
      // `refflg` is "Yes"/"No", not a boolean, and not every record has it.
      reefer: trail.cntrDetail?.refflg ? /^Y/i.test(trail.cntrDetail.refflg) : undefined,
      events,
      lastEvent: events[0]
        ? { name: events[0].name, at: events[0].at, location: events[0].location }
        : undefined,
      vesselEta: etaAt ? {
        at: etaAt,
        vessel: str(etaRow?.vesselname) ?? null,
        line: str(etaRow?.shippingline) ?? null,
        terminal: str(etaRow?.orgname) ?? null,
      } : undefined,
    },
    missing,
    warnings,
  }
}

/* ── NOENTRY/01 — state and city no-entry windows ────────────── */

/**
 * NOENTRY/01 response record, as documented.
 *
 * `stateCode` is a STRING in the request and a NUMBER in the response,
 * the same inconsistency e-Way Bill has on `ewbNo`.
 */
export interface NoEntryRecord {
  stateCode?: number | string | null
  stateName?: string | null
  districtCode?: number | string | null
  districtName?: string | null
  areaName?: string | null
  noEntryTime?: string | null
}

/**
 * India has not observed daylight saving since 1945 and IST is a fixed
 * +05:30, so the offset is a constant rather than a zone lookup. That
 * matters here: no-entry windows are stated in local civil time and the
 * delivery job runs on a UTC box, where "is it 8am yet" is 5½ hours out.
 */
const IST_OFFSET_MIN = 330

/** Minutes since midnight IST for an instant. */
export function istMinutesOfDay(at: Date | number): number {
  const ms = typeof at === 'number' ? at : at.getTime()
  const shifted = new Date(ms + IST_OFFSET_MIN * 60_000)
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
}

export interface NoEntryWindow {
  /** Minutes since midnight IST. */
  fromMin: number
  toMin: number
  /** True when the window runs through midnight — `toMin <= fromMin`. */
  wraps: boolean
  /** Tidied for display: "08:00–22:00 IST". */
  label: string
}

/** `8.00 AM`, `8:00 AM`, `8 AM`, `08.30 PM` → minutes since midnight. */
function clockToMinutes(raw: string): number | null {
  const m = /^(\d{1,2})(?:[.:](\d{2}))?\s*([AP])\.?M\.?$/i.exec(raw.trim())
  if (!m) return null
  let hour = +m[1]
  const min = m[2] ? +m[2] : 0
  if (hour < 1 || hour > 12 || min > 59) return null
  const pm = m[3].toUpperCase() === 'P'
  if (hour === 12) hour = 0
  return (hour + (pm ? 12 : 0)) * 60 + min
}

/**
 * `noEntryTime` is free text, and it writes the clock with DOTS:
 * `"8.00 AM to 10.00 PM"`. Nothing else in ULIP does that.
 *
 * Two things here are restriction logic, not formatting, and getting
 * either wrong fails OPEN:
 *
 *  - **Windows wrap midnight.** A city-centre ban is typically
 *    `"10.00 PM to 6.00 AM"`, where `toMin < fromMin`. A naive
 *    `from <= t && t <= to` is false at every minute of such a window, so
 *    the ban silently never applies and a truck is waved in at 2am.
 *  - **`from == to` is read as all day, not as zero length.** The field is
 *    a restriction; the safe reading of an ambiguous one is the
 *    restrictive one.
 */
export function noEntryWindow(raw: string | null | undefined): NoEntryWindow | null {
  if (!raw?.trim()) return null
  const m = /^\s*(.+?)\s+(?:to|-|–|—|till|until)\s+(.+?)\s*$/i.exec(raw)
  if (!m) return null
  const fromMin = clockToMinutes(m[1])
  const toMin = clockToMinutes(m[2])
  if (fromMin === null || toMin === null) return null
  const hhmm = (v: number) => `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`
  return {
    fromMin,
    toMin,
    wraps: toMin <= fromMin,
    label: `${hhmm(fromMin)}–${hhmm(toMin)} IST`,
  }
}

/** True when an instant falls inside a no-entry window. */
export function inNoEntryWindow(w: NoEntryWindow, at: Date | number): boolean {
  const t = istMinutesOfDay(at)
  // Equal bounds mean the whole day; see noEntryWindow.
  if (w.fromMin === w.toMin) return true
  return w.wraps ? t >= w.fromMin || t < w.toMin : t >= w.fromMin && t < w.toMin
}

export interface NoEntryZone {
  stateCode?: string
  stateName?: string
  districtCode?: string
  districtName?: string
  area: string
  window: NoEntryWindow | null
  /** The field verbatim, because the parse is lossy and operators argue with it. */
  rawWindow?: string
}

export interface LiveNoEntry {
  known: { zones: NoEntryZone[] }
  missing: string[]
  warnings: string[]
}

/**
 * IMPORTANT: an EMPTY NOENTRY/01 response means ULIP has no no-entry data
 * for that state, NOT that the state has no restrictions.
 *
 * The document publishes no "not found" sample at all — only an invalid
 * format and a hit — so the empty case is undocumented, and the only safe
 * reading of a missing restriction list is that it is missing. Anything
 * that turns this into "clear to enter" is the `ncrEligibility` fail-open
 * bug a second time.
 */
export function toNoEntry(rows: NoEntryRecord[] | undefined): LiveNoEntry {
  const warnings: string[] = []
  const missing: string[] = []
  const list = rows ?? []

  if (!list.length) {
    missing.push('zones')
    warnings.push(
      'NOENTRY/01 returned no zones. ULIP has no no-entry data for this state code — '
      + 'that is NOT the same as the state having no restrictions, and must not be '
      + 'presented as clear to enter.')
  }

  const zones: NoEntryZone[] = []
  const seen = new Set<string>()
  for (const r of list) {
    // areaName carries embedded newlines in the documented sample, which
    // break a table row wherever they land.
    const area = r.areaName?.replace(/\s+/g, ' ').trim()
    if (!area) continue
    const window = noEntryWindow(r.noEntryTime)
    if (r.noEntryTime && !window) {
      warnings.push(
        `Could not read the no-entry window "${r.noEntryTime.trim()}" for ${area}. `
        + 'The restriction stands; only its hours are unknown.')
    }
    // districtCode is 1 for every row in the sample and is NOT unique
    // across states, so the key has to carry the state too.
    const key = `${r.stateCode ?? ''}/${r.districtCode ?? ''}/${area}/${r.noEntryTime ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    zones.push({
      stateCode: r.stateCode === null || r.stateCode === undefined ? undefined : String(r.stateCode),
      // The document's own state-code table calls 21 "ORISSA" while the
      // response calls it "Odisha". Join on the code; never on the name.
      stateName: r.stateName?.trim() || undefined,
      districtCode: r.districtCode === null || r.districtCode === undefined
        ? undefined : String(r.districtCode),
      districtName: r.districtName?.replace(/\s+/g, ' ').trim() || undefined,
      area,
      window,
      rawWindow: r.noEntryTime?.trim() || undefined,
    })
  }

  return { known: { zones }, missing, warnings }
}

/* ── PESO/01 — CNG cylinder certification ────────────────────── */

/**
 * PESO/01 response record, as documented.
 *
 * The keys are human column headings used verbatim as JSON keys — with
 * spaces, inconsistent capitalisation (`Number of cylinders`), and a stray
 * space inside `Cylinder ID/ Serial Number`. They have to be quoted
 * exactly; there is no camelCase form to fall back on.
 */
export interface PesoRecord {
  ErrorMsg?: string | null
  'Cylinder Manufacturing Date'?: string | null
  'Cylinder Make'?: string | null
  'Cylinder capacity in water litre'?: number | string | null
  'Number of cylinders'?: number | string | null
  'Cylinder ID/ Serial Number'?: string | null
  'Hydro Test Date'?: string | null
  'Hydro Test Due Date'?: string | null
  'Test Result'?: string | null
  'Cylinder Age valid till Date'?: string | null
  'Testing Company Name'?: string | null
  'Certificate No'?: string | null
  'Vehicle Registration Number'?: string | null
}

/**
 * PESO encodes a missing FIELD as human prose inside the typed field:
 * `"Number of cylinders": "Not Available at PESO"` where a number belongs,
 * and the same string in a date field.
 *
 * So `Number(...)` yields NaN and a date parser is handed a sentence. Both
 * have to be detected as absent before anything tries to read them — a
 * count that silently becomes NaN propagates into arithmetic, and a date
 * that fails to parse is indistinguishable from one the mapper got wrong.
 */
export const PESO_UNAVAILABLE = /not\s*available\s*at\s*peso/i

const pesoValue = (v: string | null | undefined): string | undefined => {
  const s = v?.trim()
  if (!s || PESO_UNAVAILABLE.test(s)) return undefined
  return s
}

/**
 * IMPORTANT: a PESO/01 miss is the fifth shape ULIP uses for one — a
 * single row carrying ONLY `ErrorMsg: "No Record found"`, under
 * `responseStatus: "SUCCESS"`.
 *
 * It is PCS's trap with a different marker, and note the inconsistency
 * inside one endpoint: a hit sets `ErrorMsg` to the empty string, a
 * record-level miss puts prose in it, and a FIELD-level miss puts
 * different prose in the field itself.
 */
export function pesoMiss(r: PesoRecord | undefined): boolean {
  if (!r) return true
  if (/no\s*record\s*found/i.test(r.ErrorMsg ?? '')) return true
  return !r['Cylinder ID/ Serial Number'] && !r['Certificate No']
    && !r['Hydro Test Due Date']
}

export const pesoFound = (rows: PesoRecord[] | undefined) => (rows ?? []).some((r) => !pesoMiss(r))

export interface PesoCylinder {
  serialNo?: string
  certificateNo?: string
  make?: string
  /** Water capacity in litres, the standard measure for a gas cylinder. */
  capacityL?: number
  manufacturedOn?: string
  testedOn?: string
  /** Hydro-test expiry. The field that decides whether the vehicle may run. */
  dueOn?: string
  testPassed?: boolean
  testResult?: string
  testedBy?: string
  /** Separate from the hydro test, and usually absent. */
  ageValidUpto?: string
}

export interface LiveCylinders {
  known: {
    regNo?: string
    cylinders: PesoCylinder[]
    /** Derived from the ROW COUNT, because the field never carries it. */
    cylinderCount: number
    /**
     * The earliest hydro-test expiry across every cylinder. A vehicle is
     * out of certification as soon as ONE cylinder lapses, so the worst
     * date governs — taking the first row's, or the latest, certifies a
     * vehicle that is not certified.
     */
    earliestDueOn?: string
    anyTestFailed: boolean
  }
  missing: string[]
  warnings: string[]
}

export function toPesoCylinders(rows: PesoRecord[] | undefined): LiveCylinders {
  const missing: string[] = []
  const warnings: string[] = []
  const list = (rows ?? []).filter((r) => !pesoMiss(r))

  if (!list.length) {
    warnings.push(
      'PESO/01 has no CNG cylinder record for this vehicle. For a CNG vehicle that is a '
      + 'finding; for a diesel or petrol vehicle it is expected, because PESO/01 only '
      + 'covers CNG cylinder testing.')
    return {
      known: { cylinders: [], cylinderCount: 0, anyTestFailed: false },
      missing: ['cylinders'],
      warnings,
    }
  }

  const cylinders: PesoCylinder[] = list.map((r) => {
    const result = pesoValue(r['Test Result'])
    const dueOn = ewbDate(pesoValue(r['Hydro Test Due Date']))
    if (pesoValue(r['Hydro Test Due Date']) && !dueOn) {
      warnings.push(
        `Could not read the hydro-test due date "${r['Hydro Test Due Date']}" for cylinder `
        + `${pesoValue(r['Cylinder ID/ Serial Number']) ?? 'unknown'}.`)
    }
    const cap = pesoValue(
      typeof r['Cylinder capacity in water litre'] === 'number'
        ? String(r['Cylinder capacity in water litre'])
        : r['Cylinder capacity in water litre'] as string | null | undefined)
    const capacityL = cap === undefined ? undefined : num(cap)
    return {
      serialNo: pesoValue(r['Cylinder ID/ Serial Number']),
      certificateNo: pesoValue(r['Certificate No']),
      make: pesoValue(r['Cylinder Make']),
      capacityL,
      // dd/MM/yyyy — e-Way Bill's trap again, so e-Way Bill's parser.
      manufacturedOn: ewbDate(pesoValue(r['Cylinder Manufacturing Date'])) ?? undefined,
      testedOn: ewbDate(pesoValue(r['Hydro Test Date'])) ?? undefined,
      dueOn: dueOn ?? undefined,
      // An unreadable result is NOT a pass.
      testPassed: result === undefined ? undefined : /^pass/i.test(result),
      testResult: result,
      testedBy: pesoValue(r['Testing Company Name']),
      ageValidUpto: ewbDate(pesoValue(r['Cylinder Age valid till Date'])) ?? undefined,
    }
  })

  const due = cylinders.map((c) => c.dueOn).filter((d): d is string => !!d)
  if (due.length !== cylinders.length) missing.push('earliestDueOn')

  /* The field says "Not Available at PESO" on every documented row, so the
     count comes from how many certificates came back. */
  if (list.some((r) => PESO_UNAVAILABLE.test(String(r['Number of cylinders'] ?? '')))) {
    warnings.push(
      '"Number of cylinders" reads "Not Available at PESO"; the count is the number of '
      + 'certificates returned, which is a floor rather than a total.')
  }

  return {
    known: {
      regNo: pesoValue(list.find((r) => r['Vehicle Registration Number'])?.['Vehicle Registration Number'])
        ?.toUpperCase().replace(/[\s-]/g, ''),
      cylinders,
      cylinderCount: cylinders.length,
      earliestDueOn: due.length
        ? due.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b))
        : undefined,
      anyTestFailed: cylinders.some((c) => c.testPassed === false),
    },
    missing,
    warnings,
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
  hazmatClearance: 'NO ULIP endpoint carries a hazardous-goods or explosives licence. '
    + 'PESO is the Petroleum & Explosives Safety Organisation, but PESO/01 — the one '
    + 'endpoint ULIP exposes from it — returns CNG CYLINDER TEST CERTIFICATES and nothing '
    + 'else: no licence number, no validity, no class. The word "explosive" does not '
    + 'appear in any of the 36 integration documents, and no document declares a licence '
    + 'field of any kind. A hazmat clearance has to be held as a document you attach, '
    + 'the way a PESO licence PDF is attached today.',
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
