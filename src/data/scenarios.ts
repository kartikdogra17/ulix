/* ────────────────────────────────────────────────────────────────
   Scenario drill — cost a disruption before it happens.

   The rest of the platform is reactive: something has gone wrong and
   the queue tells you about it. This asks the other question. If GRAP
   Stage IV lands tomorrow, if Nhava Sheva shuts for two days, if fog
   puts six hours on every northern road leg — how many consignments,
   how much money, and what do we actually do about it?

   The part worth having is the SECOND-ORDER effect. Adding delay to a
   consignment is arithmetic. Noticing that the delay pushes its
   arrival past the e-Way Bill's validity — turning an operational
   problem into a compliance one, on a consignment nobody flagged —
   is the thing an ops team does not get from a spreadsheet.
   ──────────────────────────────────────────────────────────────── */

import type { ComplianceDoc, Shipment, Vehicle } from './types'
import { NODE_BY_CODE } from './mock/seed'
import { type GrapStage, isNcr, ncrEligibility } from './osint'

const HOUR = 3_600_000

export type ScenarioKind =
  | 'grap' | 'port_disruption' | 'corridor_closure' | 'weather_slowdown'

export interface ScenarioSpec {
  kind: ScenarioKind
  /** GRAP stage to simulate. */
  grapStage?: GrapStage
  /** Port or hub at the centre of the disruption. */
  node?: string
  /** State affected by a closure or weather event. */
  state?: string
  /** Hours the event runs for — becomes the delay added to affected legs. */
  durationHours: number
}

export interface ImpactedShipment {
  id: string
  consignor: string
  lane: string
  value: number
  /** Why this consignment is caught by the scenario. */
  reason: string
  etaBefore: string
  etaAfter: string
  addedHours: number
  ewbValidUpto: string | null
  /** True when the added delay pushes arrival past e-Way Bill validity. */
  ewbBreached: boolean
  /** True when the e-Way Bill was already going to lapse regardless. */
  ewbAlreadyBreached: boolean
  vehicle: { regNo: string; bsNorm: string; fuel: string; compliant: boolean } | null
  mitigation: string
}

export interface ScenarioAction {
  label: string
  count: number
  detail: string
  tone: 'bad' | 'warn' | 'ok'
}

export interface ScenarioResult {
  spec: ScenarioSpec
  title: string
  premise: string
  affected: ImpactedShipment[]
  /** Consignment value exposed by this scenario alone. */
  valueAtRisk: number
  /** Compliance breaches the scenario CREATES that do not exist today. */
  newEwbBreaches: number
  vehiclesToSwap: string[]
  /** Units in the fleet that could take the load instead. */
  compliantSpare: number
  byCarrier: Array<{ carrier: string; count: number; value: number }>
  actions: ScenarioAction[]
  baseline: { activeShipments: number; activeValue: number }
}

/* ── Helpers ──────────────────────────────────────────────────── */

const laneOf = (s: Shipment) =>
  `${NODE_BY_CODE[s.origin]?.name ?? s.origin} → ${NODE_BY_CODE[s.destination]?.name ?? s.destination}`

const isOpen = (s: Shipment) => s.status !== 'delivered' && s.status !== 'planned'

/** Nodes a consignment actually touches, origin and destination included. */
function touchedNodes(s: Shipment): string[] {
  return [...new Set([s.origin, s.destination, s.currentNode, ...s.legs.flatMap((l) => [l.from, l.to])])]
}

function statesOf(s: Shipment): string[] {
  return [...new Set(touchedNodes(s).map((c) => NODE_BY_CODE[c]?.state).filter(Boolean) as string[])]
}

/** A vehicle that could replace a non-compliant one on an NCR run. */
function isSpareCompliant(v: Vehicle, stage: GrapStage) {
  const free = v.status === 'idle' || v.status === 'offline' || !v.shipmentId
  return free && ncrEligibility(stage, v.bsNorm, v.fuel).status === 'allowed'
}

/* ── The drill ────────────────────────────────────────────────── */

export function runScenario(
  spec: ScenarioSpec,
  shipments: Shipment[],
  vehicles: Vehicle[],
  docs: ComplianceDoc[],
): ScenarioResult {
  const open = shipments.filter(isOpen)
  const vehicleFor = (id: string) => vehicles.find((v) => v.shipmentId === id) ?? null
  const ewbFor = (id: string) =>
    docs.find((d) => d.linkedTo === id && d.type === 'eway') ?? null

  const affected: ImpactedShipment[] = []
  let title = ''
  let premise = ''
  const vehiclesToSwap: string[] = []

  const add = (s: Shipment, addedHours: number, reason: string, mitigation: string) => {
    const v = vehicleFor(s.id)
    const etaBefore = Date.parse(s.eta)
    const etaAfter = etaBefore + addedHours * HOUR
    const ewb = ewbFor(s.id)
    const validUpto = ewb ? Date.parse(ewb.validUpto) : null

    const stage = spec.grapStage ?? 4
    const verdict = v ? ncrEligibility(stage, v.bsNorm, v.fuel) : null

    affected.push({
      id: s.id,
      consignor: s.consignor,
      lane: laneOf(s),
      value: s.invoiceValue,
      reason,
      etaBefore: new Date(etaBefore).toISOString(),
      etaAfter: new Date(etaAfter).toISOString(),
      addedHours,
      ewbValidUpto: ewb?.validUpto ?? null,
      // "New" means the scenario causes it; already-breached is not this
      // scenario's fault and must not be counted as its impact.
      ewbBreached: validUpto !== null && etaAfter > validUpto && etaBefore <= validUpto,
      ewbAlreadyBreached: validUpto !== null && etaBefore > validUpto,
      vehicle: v ? {
        regNo: v.regNo, bsNorm: v.bsNorm, fuel: v.fuel,
        compliant: verdict?.status === 'allowed',
      } : null,
      mitigation,
    })
  }

  switch (spec.kind) {
    case 'grap': {
      const stage = spec.grapStage ?? 4
      title = `GRAP Stage ${stage === 4 ? 'IV' : 'III'} invoked in Delhi NCR`
      premise = stage === 4
        ? 'Entry of BS-IV and older diesel goods vehicles into Delhi is banned except for essential commodities.'
        : 'BS-IV and older diesel medium goods vehicles are barred inside Delhi, and BS-IV diesel LCVs registered outside Delhi may not enter.'

      for (const s of open) {
        // GRAP curbs entry, not delivery. A consignment that merely routes
        // THROUGH the NCR is caught just as squarely as one terminating there,
        // so match on any touched node rather than the destination alone.
        const ncrTouch = touchedNodes(s).filter(isNcr)
        if (!ncrTouch.length) continue
        const v = vehicleFor(s.id)
        if (!v) continue
        const verdict = ncrEligibility(stage, v.bsNorm, v.fuel)
        if (verdict.status === 'allowed') continue
        vehiclesToSwap.push(v.regNo)
        const via = isNcr(s.destination) ? 'into' : 'through'
        add(s, spec.durationHours,
          `${v.regNo} is ${v.bsNorm} ${v.fuel} — ${verdict.status === 'barred' ? 'barred' : 'essentials only'} at Stage ${stage}, routing ${via} NCR`,
          'Swap to a BS-VI, CNG or electric unit before the NCR boundary, or hold outside until the stage lifts.')
      }
      break
    }

    case 'port_disruption': {
      const node = spec.node ?? 'NSA'
      const port = NODE_BY_CODE[node]
      title = `${port?.name ?? node} out of action for ${spec.durationHours}h`
      premise = 'Terminal stoppage — gate moves halt, vessels wait at anchorage, and every box routing through the port slips.'

      for (const s of open) {
        if (!touchedNodes(s).includes(node)) continue
        add(s, spec.durationHours,
          `Routes through ${port?.name ?? node}`,
          'Re-route via an alternate terminal, or renegotiate the delivery window with the consignee now rather than on the day.')
      }
      break
    }

    case 'corridor_closure': {
      const state = spec.state ?? 'Maharashtra'
      title = `Corridor closure across ${state} for ${spec.durationHours}h`
      premise = 'Agitation, flooding or an enforcement blockade closing through-movement in the state.'

      for (const s of open) {
        if (!statesOf(s).includes(state)) continue
        add(s, spec.durationHours,
          `Crosses ${state}`,
          'Divert around the state where the detour is shorter than the closure, otherwise hold and re-time.')
      }
      break
    }

    case 'weather_slowdown': {
      const state = spec.state ?? 'Uttar Pradesh'
      title = `Dense fog across ${state} — ${spec.durationHours}h of lost running`
      premise = 'Visibility below 200 m overnight. Highways run convoy-restricted or close entirely until it lifts.'

      for (const s of open) {
        if (!statesOf(s).includes(state)) continue
        if (!s.legs.some((l) => l.mode === 'road' && l.status !== 'completed')) continue
        add(s, spec.durationHours,
          `Road leg through ${state}`,
          'Brief drivers to hold at the nearest safe wayside rather than run blind, and reset consignee expectations.')
      }
      break
    }
  }

  /* ── Roll-up ────────────────────────────────────────────────── */

  const valueAtRisk = affected.reduce((a, s) => a + s.value, 0)
  const newEwbBreaches = affected.filter((s) => s.ewbBreached).length
  const stage = spec.grapStage ?? 4
  const compliantSpare = vehicles.filter((v) => isSpareCompliant(v, stage)).length

  const carrierMap = new Map<string, { count: number; value: number }>()
  for (const s of affected) {
    const ship = shipments.find((x) => x.id === s.id)
    const carrier = ship?.legs[0]?.carrier ?? 'Unknown'
    const agg = carrierMap.get(carrier) ?? { count: 0, value: 0 }
    agg.count++
    agg.value += s.value
    carrierMap.set(carrier, agg)
  }
  const byCarrier = [...carrierMap.entries()]
    .map(([carrier, v]) => ({ carrier, ...v }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6)

  const actions: ScenarioAction[] = []
  if (vehiclesToSwap.length) {
    const shortfall = vehiclesToSwap.length - compliantSpare
    actions.push({
      label: 'Swap non-compliant vehicles',
      count: vehiclesToSwap.length,
      tone: shortfall > 0 ? 'bad' : 'warn',
      detail: shortfall > 0
        ? `Only ${compliantSpare} compliant units are free — you are ${shortfall} short and would need to hire in or hold the balance.`
        : `${compliantSpare} compliant units are free, enough to cover every swap.`,
    })
  }
  if (newEwbBreaches) {
    actions.push({
      label: 'Extend e-Way Bill validity',
      count: newEwbBreaches,
      tone: 'bad',
      detail: 'These consignments would arrive after their e-Way Bill lapses — a compliance exposure the delay creates, not one that exists today.',
    })
  }
  const notifiable = affected.filter((s) => s.addedHours > 0).length
  if (notifiable) {
    actions.push({
      label: 'Re-time and notify consignees',
      count: notifiable,
      tone: 'warn',
      detail: 'Revised ETAs should go out before the event, not after the first missed slot.',
    })
  }
  if (!affected.length) {
    actions.push({
      label: 'No exposure',
      count: 0,
      tone: 'ok',
      detail: 'Nothing currently moving is caught by this scenario.',
    })
  }

  return {
    spec, title, premise,
    affected: affected.sort((a, b) => b.value - a.value),
    valueAtRisk, newEwbBreaches, vehiclesToSwap, compliantSpare, byCarrier, actions,
    baseline: {
      activeShipments: open.length,
      activeValue: open.reduce((a, s) => a + s.invoiceValue, 0),
    },
  }
}

/** Ready-made drills, so the page opens on something meaningful. */
export const PRESETS: Array<{ id: string; label: string; spec: ScenarioSpec }> = [
  { id: 'grap4', label: 'GRAP Stage IV — Delhi NCR', spec: { kind: 'grap', grapStage: 4, durationHours: 48 } },
  { id: 'grap3', label: 'GRAP Stage III — Delhi NCR', spec: { kind: 'grap', grapStage: 3, durationHours: 24 } },
  { id: 'jnpa', label: 'JNPA Nhava Sheva shutdown', spec: { kind: 'port_disruption', node: 'NSA', durationHours: 48 } },
  { id: 'mundra', label: 'Mundra shutdown', spec: { kind: 'port_disruption', node: 'MUN', durationHours: 36 } },
  { id: 'mh', label: 'Maharashtra corridor closure', spec: { kind: 'corridor_closure', state: 'Maharashtra', durationHours: 24 } },
  { id: 'fog', label: 'Dense fog — Uttar Pradesh', spec: { kind: 'weather_slowdown', state: 'Uttar Pradesh', durationHours: 8 } },
]
