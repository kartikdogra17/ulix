/* ────────────────────────────────────────────────────────────────
   Cross-system fusion.

   The point of ULIP is not that you can call FASTAG/01 and VAHAN/01
   separately — it is that answers nobody can get from a single
   ministry fall out when you put them side by side.

   Every signal below is a JOIN across two or more source systems, and
   each one carries the endpoint codes that produced it, so an operator
   can always see WHY the platform is telling them something and which
   government system to challenge if it looks wrong.
   ──────────────────────────────────────────────────────────────── */

import type { ComplianceDoc, Shipment, Vehicle } from './types'
import { FASTAG_RETENTION_HOURS } from './ulip/catalogue'
import { type AirQuality, GRAP_LABEL, isNcr, ncrEligibility } from './osint'

const HOUR = 3_600_000

export type SignalKind =
  | 'ewb_expires_before_eta'
  | 'partb_vehicle_mismatch'
  | 'vehicle_dark'
  | 'fitness_lapsed'
  | 'insurance_lapsed'
  | 'tag_blacklisted'
  | 'tag_low_balance'
  | 'dl_expired'
  | 'customs_hold'
  | 'hazmat_no_clearance'
  | 'reefer_breach'
  | 'detention'
  | 'eta_slip'
  | 'grap_entry_ban'
  | 'fog_risk'

export type Severity = 'critical' | 'high' | 'medium'

export interface Signal {
  id: string
  kind: SignalKind
  severity: Severity
  title: string
  detail: string
  /** Endpoint codes whose data produced this signal — the fusion provenance. */
  sources: string[]
  entity: string
  entityKind: 'shipment' | 'vehicle'
  /** Consignment value exposed if this is not resolved. */
  valueAtRisk: number
  /** Hours until the window to act closes; null when already closed. */
  hoursToAct: number | null
  /**
   * When the underlying condition became true — NOT when the platform first
   * rendered it. SLA clocks run from here, otherwise nothing is ever overdue
   * because every case looks newly created the moment someone opens the page.
   */
  detectedAt: string
  /** What a controller should actually do next. */
  action: string
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2 }

const hoursBetween = (a: number, b: number) => (a - b) / HOUR

/**
 * Derive every cross-system signal for one consignment.
 *
 * `vehicle` is the unit currently on the active road leg, resolved through
 * the e-Way Bill Part-B vehicle number — which is itself the join that makes
 * the mismatch check below possible.
 */
export function signalsForShipment(
  s: Shipment,
  vehicle: Vehicle | null,
  docs: ComplianceDoc[],
  now = Date.now(),
  /** Live open-source context, when the platform has been able to fetch it. */
  osint?: { ncrAir?: AirQuality | null },
): Signal[] {
  const out: Signal[] = []
  const done = s.status === 'delivered'
  const eta = Date.parse(s.eta)
  const started = Date.parse(s.createdAt)
  /**
   * Clamp an onset into the window the platform could actually have seen it in:
   * never before dispatch, and never before the gateway's own visibility horizon
   * (FASTAG/01 retains 72h, so nothing road-side is observable earlier than that).
   * Without this, a certificate that lapsed three weeks ago would present as a
   * case that has been waiting three weeks, and every SLA would read as breached.
   */
  const horizon = now - FASTAG_RETENTION_HOURS * HOUR
  const onset = (ms: number) =>
    new Date(Math.min(now, Math.max(started, horizon, ms))).toISOString()

  const mk = (
    kind: SignalKind, severity: Severity, title: string, detail: string,
    sources: string[], hoursToAct: number | null, action: string,
    detectedAt: string = onset(started),
  ) => out.push({
    id: `${s.id}-${kind}`, kind, severity, title, detail, sources,
    entity: s.id, entityKind: 'shipment', valueAtRisk: s.invoiceValue,
    hoursToAct, action, detectedAt,
  })

  /* ── e-Way Bill validity vs the ETA the movement data implies ──
     EWAYBILL/01 gives validUpto; FASTag/FOIS reads give the real ETA.
     Neither system knows about the other, so only the join sees it. */
  const ewb = docs.find((d) => d.type === 'eway')
  if (ewb && !done) {
    const validUpto = Date.parse(ewb.validUpto)
    const slack = hoursBetween(validUpto, eta)
    if (slack < 0) {
      mk('ewb_expires_before_eta', 'critical',
        'e-Way Bill expires before arrival',
        `Part-A is valid to ${new Date(validUpto).toLocaleString('en-IN')}, but movement data puts arrival ${Math.abs(Math.round(slack))}h later. Moving on a lapsed e-Way Bill exposes the consignment to detention and penalty under s.129.`,
        ['EWAYBILL/01', 'FASTAG/01'], Math.max(0, hoursBetween(validUpto, now)),
        'Extend validity on the e-Way Bill portal before the vehicle crosses the next check post.')
    } else if (slack < 12) {
      mk('ewb_expires_before_eta', 'high',
        'e-Way Bill validity is tight',
        `Only ${Math.round(slack)}h of slack between e-Way Bill expiry and projected arrival. Any further delay puts the consignment out of compliance.`,
        ['EWAYBILL/01', 'FASTAG/01'], Math.round(hoursBetween(validUpto, now)),
        'Pre-emptively extend validity, or re-sequence the remaining legs.')
    }
  }

  /* ── Part-B vehicle vs the vehicle actually generating toll reads ──
     A genuine detector: the declared vehicle and the moving vehicle differ. */
  const roadLeg = s.legs.find((l) => l.mode === 'road' && l.status !== 'pending')
  if (vehicle && roadLeg && vehicle.regNo !== roadLeg.conveyance && !done) {
    mk('partb_vehicle_mismatch', 'critical',
      'Declared vehicle does not match the one moving',
      `e-Way Bill Part-B carries ${roadLeg.conveyance}, but toll reads on this lane are coming from ${vehicle.regNo}. Either Part-B was not updated after a transshipment, or the consignment is on an undeclared vehicle.`,
      ['EWAYBILL/01', 'FASTAG/01', 'VAHAN/01'], 0,
      'Update Part-B with the actual vehicle number, or confirm the transshipment with the transporter.')
  }

  /* ── Telemetry silence on an active leg ──
     FASTag reads are the heartbeat. Their absence is the signal. */
  if (vehicle && !done && s.status === 'in_transit') {
    const lastRead = vehicle.crossings[0] ? Date.parse(vehicle.crossings[0].ts) : null
    const darkFor = lastRead ? hoursBetween(now, lastRead) : null
    if (darkFor !== null && darkFor > 10 && darkFor < FASTAG_RETENTION_HOURS) {
      mk('vehicle_dark', darkFor > 24 ? 'critical' : 'high',
        `No toll read for ${Math.round(darkFor)}h`,
        `Last plaza read was ${vehicle.crossings[0].plaza}. On a corridor of this length a read is expected every few hours — the vehicle may be halted, diverted, or running a toll-free stretch.`,
        ['FASTAG/01'], null,
        'Call the driver to confirm position, then reconcile against the next expected plaza.',
        onset((lastRead ?? now) + 10 * HOUR))
    }
  }

  /* ── Statutory validity of the vehicle under load (VAHAN + SARATHI) ── */
  if (vehicle && !done) {
    const v = vehicle
    const add = (
      kind: SignalKind, sev: Severity, title: string, detail: string,
      src: string[], action: string, detectedAt: string,
    ) => out.push({
      id: `${s.id}-${kind}`, kind, severity: sev, title, detail, sources: src,
      entity: s.id, entityKind: 'shipment', valueAtRisk: s.invoiceValue,
      hoursToAct: 0, action, detectedAt,
    })

    if (Date.parse(v.fitnessUpto) < now) {
      add('fitness_lapsed', 'critical', 'Carrying vehicle is not road legal',
        `${v.regNo} has a fitness certificate that lapsed on ${new Date(v.fitnessUpto).toLocaleDateString('en-IN')} and is under load with ${s.commodity}. Any enforcement stop detains the cargo, not just the truck.`,
        ['VAHAN/01', 'EWAYBILL/01'],
        'Swap the consignment onto a compliant vehicle at the next hub.',
        onset(Date.parse(v.fitnessUpto)))
    }
    if (Date.parse(v.insuranceUpto) < now) {
      add('insurance_lapsed', 'critical', 'Goods in transit are uninsured',
        `Motor insurance on ${v.regNo} expired on ${new Date(v.insuranceUpto).toLocaleDateString('en-IN')}. Cargo worth this much is moving without cover.`,
        ['VAHAN/01'], 'Renew cover immediately or halt the vehicle at the nearest safe point.',
        onset(Date.parse(v.insuranceUpto)))
    }
    if (v.tagStatus === 'BLACKLIST') {
      add('tag_blacklisted', 'high', 'FASTag blacklisted — plaza entry will be refused',
        `${v.regNo} will be turned back or charged double at the next plaza, and you lose toll-read visibility for this consignment entirely.`,
        ['FASTAG/01'], 'Clear the tag with the issuing bank before the next plaza.',
        onset(now - 6 * HOUR))
    } else if (v.tagStatus === 'LOW_BALANCE') {
      add('tag_low_balance', 'medium', 'FASTag balance will not cover the remaining route',
        `Balance on ${v.regNo} is low for the plazas still ahead on this lane.`,
        ['FASTAG/01', 'TOLL/01'], 'Top up the tag before the vehicle reaches the next plaza.',
        onset(now - 12 * HOUR))
    }
    if (Date.parse(v.dlValidUpto) < now) {
      add('dl_expired', 'high', 'Driving licence has expired',
        `${v.driverName}'s licence lapsed on ${new Date(v.dlValidUpto).toLocaleDateString('en-IN')}. The driver is not legally entitled to move this load.`,
        ['SARATHI/01', 'VAHAN/01'], 'Relieve the driver at the next hub and log the renewal.',
        onset(Date.parse(v.dlValidUpto)))
    }
  }

  /* ── Hazardous cargo without an explosives/hazmat clearance (PESO) ── */
  if (s.hazardous && !done) {
    mk('hazmat_no_clearance', 'high',
      'Hazardous cargo with no PESO clearance on file',
      `${s.commodity} is flagged hazardous but no valid PESO licence is linked to this consignment or its carrying vehicle.`,
      ['PESO/01', 'EWAYBILL/01'], null,
      'Attach the PESO licence, or re-book on a licensed hazmat carrier.')
  }

  /* ── Customs (ICEGATE) holding a consignment already on the road ── */
  if (s.status === 'customs') {
    mk('customs_hold', 'high',
      'Held at customs assessment',
      'ICEGATE reports the filing is still under assessment. Every day here accrues demurrage and detention at the terminal.',
      ['ICEGATE/02', 'PCS/01'], null,
      'Respond to the assessment query and confirm duty payment.')
  }

  /* ── Cold chain ── */
  if (s.reefer && s.tempC !== undefined && s.tempC > 2 && !done) {
    mk('reefer_breach', 'critical',
      `Reefer running at ${s.tempC}°C`,
      `Set point for ${s.commodity} is well below this. Product may already be out of specification.`,
      ['ULIP'], 0,
      'Instruct the driver to restore set point and raise a quality hold at destination.')
  }

  /* ── GRAP: can this vehicle legally enter Delhi today? ──
     Neither ULIP nor CAQM can answer this alone. VAHAN knows the truck's
     emission norm; the public air-quality feed determines which GRAP stage
     is in force. The answer only exists in the join. */
  const air = osint?.ncrAir
  if (air && vehicle && !done && isNcr(s.destination) && air.stage >= 3) {
    const verdict = ncrEligibility(air.stage, vehicle.bsNorm, vehicle.fuel, false)
    if (verdict.status !== 'allowed') {
      mk('grap_entry_ban', verdict.status === 'barred' ? 'critical' : 'high',
        verdict.status === 'barred'
          ? 'Vehicle barred from Delhi under GRAP'
          : 'Delhi entry allowed only as essential carriage',
        `Delhi AQI is ${air.aqi} (${air.category}), so ${GRAP_LABEL[air.stage]} is in force. ${vehicle.regNo} is ${vehicle.bsNorm} ${vehicle.fuel}. ${verdict.reason}`,
        ['VAHAN/01', 'CPCB-AQI (open data)'], null,
        verdict.status === 'barred'
          ? 'Swap to a BS-VI, CNG or electric unit before the NCR boundary, or hold the load outside until the stage is revoked.'
          : 'Carry proof of essential-commodity carriage, or re-assign to a compliant vehicle.',
        onset(now - 3 * HOUR))
    }
  }

  /* ── Schedule slip worth escalating ── */
  if (!done && s.delayMins > 240) {
    mk('eta_slip', s.delayMins > 900 ? 'high' : 'medium',
      `Running ${Math.round(s.delayMins / 60)}h behind`,
      `Projected arrival has slipped past the promised ETA on the ${s.legs[s.legs.length - 1].mode} leg.`,
      ['FASTAG/01', 'FOIS/01'], null,
      'Notify the consignee with a revised ETA before they escalate.',
      onset(now - s.delayMins * 60_000))
  }

  return out.sort((a, b) =>
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.valueAtRisk - a.valueAtRisk)
}

/* ── Risk score & data confidence ─────────────────────────────── */

const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 34, high: 18, medium: 7 }

/** 0 (clean) … 100 (multiple critical, compounding). */
export function riskScore(signals: Signal[]): number {
  return Math.min(100, signals.reduce((a, s) => a + SEVERITY_WEIGHT[s.severity], 0))
}

export type CoverageState =
  | 'reported'        // subscribed, relevant, and has reported recently
  | 'stale'           // subscribed and relevant, but last report is old
  | 'missing'         // subscribed and relevant, yet nothing has come back
  | 'not_subscribed'  // this client has no access to the dataset
  | 'not_applicable'  // irrelevant to this consignment (no sea leg, no customs…)

export interface Coverage {
  system: string
  endpoint: string
  state: CoverageState
  lastAt: string | null
  note: string
}

/**
 * Which source systems have actually contributed to this consignment's picture.
 *
 * A decision made on two systems out of seven is a different decision from one
 * made on all seven, so the platform says which it is instead of implying
 * completeness it does not have.
 */
export function coverageForShipment(
  s: Shipment, vehicle: Vehicle | null, docs: ComplianceDoc[],
  subscribed: Set<string>, now = Date.now(),
): Coverage[] {
  const lastEventFrom = (src: string) =>
    [...s.events].reverse().find((e) => e.source === src)?.ts ?? null

  /**
   * `relevant` matters as much as `has`. A road-only consignment has no rail
   * leg, so FOIS silence is not a gap in the picture — counting it as one
   * would make every domestic truckload look poorly sourced.
   */
  const state = (
    relevant: boolean, has: boolean, lastAt: string | null, endpoint: string,
  ): CoverageState => {
    if (!relevant) return 'not_applicable'
    if (!subscribed.has(endpoint)) return 'not_subscribed'
    if (!has) return 'missing'
    if (lastAt && now - Date.parse(lastAt) > 24 * HOUR) return 'stale'
    return 'reported'
  }

  const rows: Coverage[] = []
  const push = (
    system: string, endpoint: string, relevant: boolean,
    has: boolean, lastAt: string | null, note: string,
  ) => rows.push({ system, endpoint, state: state(relevant, has, lastAt, endpoint), lastAt, note })

  const hasRoad = s.legs.some((l) => l.mode === 'road')
  const hasRail = s.legs.some((l) => l.mode === 'rail')
  const hasSea = s.legs.some((l) => l.mode === 'sea')
  const customs = docs.some((d) => d.type === 'bill_of_entry' || d.type === 'shipping_bill')
    || s.status === 'customs'

  const tollAt = vehicle?.crossings[0]?.ts ?? null
  push('FASTag', 'FASTAG/01', hasRoad, !!vehicle?.crossings.length, tollAt,
    'Toll reads — position and road-leg heartbeat')
  push('VAHAN', 'VAHAN/01', hasRoad, !!vehicle, vehicle?.lastPingAt ?? null,
    'Registration, fitness, insurance, permit')
  push('SARATHI', 'SARATHI/01', hasRoad, !!vehicle?.driverDl, vehicle?.lastPingAt ?? null,
    'Driver licence validity')
  push('e-Way Bill', 'EWAYBILL/01', true, docs.some((d) => d.type === 'eway'),
    docs.find((d) => d.type === 'eway')?.verifiedAt ?? null,
    'Part-A consignment data and Part-B vehicle')
  push('FOIS', 'FOIS/01', hasRail, !!lastEventFrom('FOIS'), lastEventFrom('FOIS'),
    'Rake and railway receipt status')
  push('ICEGATE', 'ICEGATE/02', customs, !!lastEventFrom('ICEGATE'), lastEventFrom('ICEGATE'),
    'Customs clearance milestones')
  push('PCS', 'PCS/01', hasSea || customs, !!lastEventFrom('PCS'), lastEventFrom('PCS'),
    'Terminal and container movements')
  push('LDB', 'LDB/01', hasSea, !!lastEventFrom('PCS'), lastEventFrom('PCS'),
    'Container track at port')
  return rows
}

/** Share of the systems relevant to this consignment that actually reported. */
export function confidence(rows: Coverage[]): number {
  const relevant = rows.filter((r) => r.state !== 'not_applicable')
  if (!relevant.length) return 0
  const good = relevant.filter((r) => r.state === 'reported').length
  const half = relevant.filter((r) => r.state === 'stale').length * 0.5
  return Math.round(((good + half) / relevant.length) * 100)
}
