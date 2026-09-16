/* ────────────────────────────────────────────────────────────────
   EXIM cockpit — the import and export clearance chain.

   Eleven ICEGATE endpoints and four more from PCS were sitting unused
   while "in customs" was a single status chip. That chip hides the
   part of the journey where money actually burns: a box sitting in a
   terminal is not late, it is EXPENSIVE, and it gets more expensive in
   steps rather than smoothly.

   So the two things this models properly are the MILESTONE CHAIN —
   each step attributed to the endpoint that reports it — and the
   DEMURRAGE AND DETENTION CLOCKS.

   Those clocks are slabbed, not linear. Free days, then a daily rate,
   then roughly double it, then double again. An operator who knows a
   box crosses into the next slab at 06:00 tomorrow can act on that;
   a flat "₹/day" figure hides the cliff entirely.

   Demurrage is the terminal charging for its ground. Detention is the
   line charging for its box. They run on different clocks and both
   can be live at once, which is why they are tracked separately.
   ──────────────────────────────────────────────────────────────── */

import type { Shipment } from './types'
import { NODES, NODE_BY_CODE, int, pick, rng } from './mock/seed'

const HOUR = 3_600_000
const DAY = 24 * HOUR

export type Direction = 'import' | 'export'
export type EximMode = 'sea' | 'air'

export type MilestoneState = 'done' | 'current' | 'pending' | 'held'

export interface Milestone {
  code: string
  label: string
  /** Which API reports this step. */
  endpoint: string
  at: string | null
  state: MilestoneState
  detail?: string
}

export interface Hold {
  id: string
  reason: string
  raisedAt: string
  endpoint: string
  /** What actually clears it. */
  resolution: string
}

/** A slab in the demurrage or detention tariff. */
export interface Slab {
  fromDay: number
  toDay: number | null
  perDay: number
}

export interface Charge {
  kind: 'demurrage' | 'detention'
  /** Who is charging, and for what. */
  who: string
  freeDays: number
  /** Days since the clock started. */
  elapsedDays: number
  slabs: Slab[]
  accrued: number
  currentRate: number
  /** Hours until the daily rate steps up again; null when on the top slab. */
  hoursToNextSlab: number | null
  nextRate: number | null
}

export interface EximFile {
  id: string
  direction: Direction
  mode: EximMode
  shipmentId: string | null
  party: string
  portCode: string
  portName: string
  containerNumber: string
  /* Identifiers, named as the documents name them. */
  igmNo: string | null
  igmDt: string | null
  beNo: string | null
  beDt: string | null
  oocNo: string | null
  oocDt: string | null
  sbNo: string | null
  sbDt: string | null
  leoDt: string | null
  egmNo: string | null
  egmDt: string | null
  esealNumber: string | null
  esealStatus: string | null
  mawbNumber: string | null
  hawbNumber: string | null
  flightNo: string | null
  vesselName: string | null
  imoCode: string | null
  voyageNo: string | null
  rotationNumber: string | null
  chaNo: string
  assessedValue: number
  dutyAmount: number
  milestones: Milestone[]
  currentStage: string
  holds: Hold[]
  charges: Charge[]
  /** Total accruing across both clocks. */
  exposure: number
  cleared: boolean
}

/* ── Tariff slabs ─────────────────────────────────────────────── */

/** Indicative Indian terminal demurrage: escalating by slab, per TEU per day. */
const DEMURRAGE_SLABS: Slab[] = [
  { fromDay: 0, toDay: 3, perDay: 0 },
  { fromDay: 3, toDay: 6, perDay: 1800 },
  { fromDay: 6, toDay: 10, perDay: 3600 },
  { fromDay: 10, toDay: null, perDay: 7200 },
]

/** Line detention on the box once it leaves the terminal. */
const DETENTION_SLABS: Slab[] = [
  { fromDay: 0, toDay: 5, perDay: 0 },
  { fromDay: 5, toDay: 9, perDay: 1200 },
  { fromDay: 9, toDay: 14, perDay: 2600 },
  { fromDay: 14, toDay: null, perDay: 5200 },
]

function computeCharge(
  kind: Charge['kind'], who: string, slabs: Slab[], startedMs: number, now: number,
): Charge {
  const elapsedMs = Math.max(0, now - startedMs)
  const elapsedDays = elapsedMs / DAY
  const freeDays = slabs.find((s) => s.perDay === 0)?.toDay ?? 0

  let accrued = 0
  for (const s of slabs) {
    const upper = s.toDay ?? Infinity
    const daysInSlab = Math.max(0, Math.min(elapsedDays, upper) - s.fromDay)
    accrued += daysInSlab * s.perDay
  }

  const current = slabs.find((s) => elapsedDays >= s.fromDay && elapsedDays < (s.toDay ?? Infinity))
    ?? slabs[slabs.length - 1]
  const nextIndex = slabs.indexOf(current) + 1
  const next = nextIndex < slabs.length ? slabs[nextIndex] : null

  return {
    kind, who, freeDays,
    elapsedDays: +elapsedDays.toFixed(2),
    slabs,
    accrued: Math.round(accrued),
    currentRate: current.perDay,
    hoursToNextSlab: current.toDay !== null
      ? Math.max(0, (current.toDay - elapsedDays) * 24)
      : null,
    nextRate: next?.perDay ?? null,
  }
}

/* ── Milestone chains ─────────────────────────────────────────── */

type Step = [code: string, label: string, endpoint: string]

const IMPORT_SEA: Step[] = [
  ['ROTATION', 'Rotation number allotted', 'PCS/01'],
  ['VESSEL_ARR', 'Vessel arrival reported', 'ICEGATE/04'],
  ['IGM', 'Import General Manifest filed', 'ICEGATE/07'],
  ['DISCHARGE', 'Container discharged', 'PCS/01'],
  ['BE', 'Bill of Entry filed', 'ICEGATE/02'],
  ['ASSESS', 'Assessment completed', 'ICEGATE/02'],
  ['DUTY', 'Duty paid', 'ICEGATE/02'],
  ['OOC', 'Out of charge granted', 'ICEGATE/02'],
  ['DO', 'Delivery order issued', 'PCS/04'],
  ['GATE_OUT', 'Gate-out from terminal', 'PCS/05'],
]

const EXPORT_SEA: Step[] = [
  ['SB', 'Shipping Bill filed', 'ICEGATE/03'],
  ['RECEIVED', 'Goods received at port', 'PCS/02'],
  ['LEO', 'Let Export Order granted', 'ICEGATE/05'],
  ['ESEAL', 'Container stuffed and e-sealed', 'ICEGATE/13'],
  ['LOADED', 'Loaded on vessel', 'PCS/03'],
  ['EGM', 'Export General Manifest filed', 'ICEGATE/08'],
  ['SAILED', 'Vessel sailed', 'PCS/06'],
]

const IMPORT_AIR: Step[] = [
  ['FLIGHT_ARR', 'Flight arrival reported', 'ICEGATE/11'],
  ['MAWB', 'Master air waybill manifested', 'ICEGATE/09'],
  ['HAWB', 'House air waybill broken down', 'ICEGATE/10'],
  ['BE', 'Bill of Entry filed', 'ICEGATE/02'],
  ['OOC', 'Out of charge granted', 'ICEGATE/02'],
  ['DELIVERED', 'Delivered from cargo terminal', 'AAICLAS/01'],
]

const EXPORT_AIR: Step[] = [
  ['SB', 'Shipping Bill filed', 'ICEGATE/03'],
  ['ACCEPT', 'Cargo accepted at terminal', 'ACMES/01'],
  ['LEO', 'Let Export Order granted', 'ICEGATE/05'],
  ['EGM', 'Air Export General Manifest filed', 'ICEGATE/11'],
  ['UPLIFT', 'Uplifted on flight', 'KALE/01'],
]

const HOLD_REASONS: Array<[string, string, string]> = [
  ['Assessment query raised — declared value under review', 'ICEGATE/02',
   'Respond to the query with supporting invoices and transaction evidence.'],
  ['Examination ordered — RMS flagged for physical check', 'ICEGATE/02',
   'Present the consignment for examination and obtain the examination report.'],
  ['Duty unpaid — challan generated but not settled', 'ICEGATE/02',
   'Settle the duty challan; out-of-charge cannot follow until it clears.'],
  ['e-Seal integrity flagged at gate', 'ICEGATE/13',
   'Terminal to re-verify the seal against the shipping bill before loading.'],
  ['IGM line mismatch against the bill of lading', 'ICEGATE/07',
   'Shipping line to file an IGM amendment for the affected line.'],
  ['Delivery order not released by the line', 'PCS/04',
   'Clear outstanding line charges to release the delivery order.'],
]

const PORTS = NODES.filter((n) => n.kind === 'port')
const CHA = ['Coromandel Clearing', 'Sagar Customs House Agents', 'Meridian Logistics CHA',
  'Konkan Brokers', 'Bharat Clearing & Forwarding'] as const

export function makeEximFiles(shipments: Shipment[], count = 46): EximFile[] {
  const r = rng(51204)
  const now = Date.now()
  const out: EximFile[] = []

  // Prefer real consignments that actually touch a port or fly.
  const candidates = shipments.filter((s) =>
    s.legs.some((l) => l.mode === 'sea' || l.mode === 'air')
    || NODE_BY_CODE[s.origin]?.kind === 'port'
    || NODE_BY_CODE[s.destination]?.kind === 'port')

  for (let i = 0; i < count; i++) {
    const link = candidates[i % Math.max(1, candidates.length)] ?? null
    const mode: EximMode = r() < 0.78 ? 'sea' : 'air'
    const direction: Direction = r() < 0.55 ? 'import' : 'export'
    const port = link && NODE_BY_CODE[link.origin]?.kind === 'port'
      ? NODE_BY_CODE[link.origin]
      : link && NODE_BY_CODE[link.destination]?.kind === 'port'
        ? NODE_BY_CODE[link.destination]
        : pick(r, PORTS)

    const steps = mode === 'sea'
      ? (direction === 'import' ? IMPORT_SEA : EXPORT_SEA)
      : (direction === 'import' ? IMPORT_AIR : EXPORT_AIR)

    // Where in the chain this file has got to.
    const held = r() < 0.24
    const reached = held
      ? int(r, 2, steps.length - 2)
      : r() < 0.22 ? steps.length : int(r, 2, steps.length - 1)

    const startedAt = now - int(r, 2, 22) * DAY
    const span = Math.max(1, reached)
    const milestones: Milestone[] = steps.map(([code, label, endpoint], idx) => {
      const done = idx < reached
      const at = done ? new Date(startedAt + (idx / span) * (now - startedAt)).toISOString() : null
      return {
        code, label, endpoint, at,
        state: done ? 'done' : idx === reached ? (held ? 'held' : 'current') : 'pending',
      }
    })

    const holds: Hold[] = held
      ? [(() => {
          const [reason, endpoint, resolution] = pick(r, HOLD_REASONS)
          return {
            id: `HLD-${i}`, reason, endpoint, resolution,
            raisedAt: new Date(now - int(r, 4, 96) * HOUR).toISOString(),
          }
        })()]
      : []

    const cleared = reached >= steps.length

    /* Clocks. Demurrage runs from discharge or port receipt; detention from
       gate-out. Only the ones that have actually started are tracked. */
    const charges: Charge[] = []
    if (mode === 'sea') {
      const dischargeIdx = direction === 'import' ? 3 : 1
      const dischargeAt = milestones[dischargeIdx]?.at
      if (dischargeAt) {
        charges.push(computeCharge('demurrage',
          `${port.name} terminal`, DEMURRAGE_SLABS, Date.parse(dischargeAt), now))
      }
      const gateOut = milestones.find((m) => m.code === 'GATE_OUT')?.at
      if (gateOut) {
        charges.push(computeCharge('detention',
          'Shipping line', DETENTION_SLABS, Date.parse(gateOut), now))
      }
    }

    const assessedValue = link?.invoiceValue ?? int(r, 800000, 9000000)

    out.push({
      id: `EX${String(4200 + i)}`,
      direction, mode,
      shipmentId: link?.id ?? null,
      party: link ? (direction === 'import' ? link.consignee : link.consignor) : 'Nexa Electronics',
      portCode: port.code,
      portName: port.name,
      containerNumber: `${pick(r, ['MSKU', 'TGHU', 'CSNU', 'BMOU'])}${int(r, 1000000, 9999999)}`,
      igmNo: direction === 'import' ? String(int(r, 1000000, 9999999)) : null,
      igmDt: direction === 'import' ? new Date(startedAt).toISOString() : null,
      beNo: direction === 'import' && reached > 4 ? String(int(r, 1000000, 9999999)) : null,
      beDt: direction === 'import' && reached > 4 ? new Date(startedAt + 2 * DAY).toISOString() : null,
      oocNo: direction === 'import' && cleared ? String(int(r, 100000, 999999)) : null,
      oocDt: direction === 'import' && cleared ? new Date(now - DAY).toISOString() : null,
      sbNo: direction === 'export' ? String(int(r, 1000000, 9999999)) : null,
      sbDt: direction === 'export' ? new Date(startedAt).toISOString() : null,
      leoDt: direction === 'export' && reached > 2 ? new Date(startedAt + 2 * DAY).toISOString() : null,
      egmNo: direction === 'export' && reached > 5 ? String(int(r, 100000, 999999)) : null,
      egmDt: direction === 'export' && reached > 5 ? new Date(now - DAY).toISOString() : null,
      esealNumber: direction === 'export' && mode === 'sea' && reached > 3
        ? String(int(r, 100000000000, 999999999999)) : null,
      esealStatus: direction === 'export' && mode === 'sea' && reached > 3
        ? (r() < 0.9 ? 'VERIFIED' : 'TAMPER ALERT') : null,
      mawbNumber: mode === 'air' ? `${int(r, 100, 998)}-${int(r, 10000000, 99999999)}` : null,
      hawbNumber: mode === 'air' && r() < 0.6 ? `HAWB${int(r, 100000, 999999)}` : null,
      flightNo: mode === 'air' ? `${pick(r, ['AI', '6E', 'SG', 'BD'])}${int(r, 100, 999)}` : null,
      vesselName: mode === 'sea' ? `MV ${pick(r, ['Bharat Star', 'Konkan Pride', 'Deccan Trader', 'Sagar Setu'])}` : null,
      imoCode: mode === 'sea' ? `IMO${int(r, 9000000, 9899999)}` : null,
      voyageNo: mode === 'sea' ? `${int(r, 2000, 2699)}${pick(r, ['E', 'W', 'N', 'S'])}` : null,
      rotationNumber: mode === 'sea' ? String(int(r, 100000, 999999)) : null,
      chaNo: pick(r, CHA),
      assessedValue,
      dutyAmount: Math.round(assessedValue * (0.07 + r() * 0.23)),
      milestones,
      currentStage: cleared ? 'Cleared' : (milestones[reached]?.label ?? 'In progress'),
      holds,
      charges,
      exposure: charges.reduce((a, c) => a + c.accrued, 0),
      cleared,
    })
  }

  return out.sort((a, b) => b.exposure - a.exposure)
}

/** Files about to step into a higher tariff slab, soonest first. */
export function slabCliffs(files: EximFile[], withinHours = 36) {
  return files
    .filter((f) => !f.cleared)
    .flatMap((f) => f.charges
      .filter((c) => c.hoursToNextSlab !== null && c.hoursToNextSlab <= withinHours && c.nextRate)
      .map((c) => ({ file: f, charge: c })))
    .sort((a, b) => (a.charge.hoursToNextSlab ?? 0) - (b.charge.hoursToNextSlab ?? 0))
}
