/* ────────────────────────────────────────────────────────────────
   Role lens.

   Four organisation types sign in to the same network, and the login
   screen promises that every screen adapts to the role. This module is
   that promise, kept in one place.

   It is a LENS, not access control. Nothing here hides a record from
   anyone: every route stays reachable by URL and every signal stays in
   the queue. What changes is what the platform puts in FRONT of you —
   which modules are advertised, which conflicts sort to the top, and
   which single number leads the control tower.

   That distinction is the whole point, because the four roles are
   accountable for different things. A shipper owns cargo and answers
   for its value. A transporter owns vehicles and answers for whether
   they are legal to move. A forwarder answers for other people's cargo
   against a clock at a border. A regulator owns none of it and answers
   only for whether the rules held — which is why value at risk is
   deliberately NOT the regulator's headline. Showing a supervisor a
   rupee figure for cargo they have no stake in is the kind of number
   that looks authoritative and means nothing.
   ──────────────────────────────────────────────────────────────── */

import type { Dashboard } from './adapter'
import type { Case } from './cases'
import type { Severity, SignalKind } from './fusion'
import type { Counterparty } from './counterparty'
import type { DocStatus, Org } from './types'
import { inr, num } from '../lib/format'

export type Role = Org['role']

export interface Headline {
  label: string
  /** Already formatted — the page renders it, it does not compute it. */
  value: string
  tone: 'bad' | 'warn' | 'ok'
  /** The sentence under the number. */
  detail: string
  /** Why this number and not another. Shown small, but shown. */
  basis: string
}

/**
 * What each module opens on.
 *
 * A lensed default is only honest if it is visible and reversible, so every
 * page that applies one renders a note saying so with a one-click way out.
 * A silently pre-filtered table is indistinguishable from missing data, and
 * this project has already paid for screens that looked broken when they
 * were merely opinionated.
 */
export interface PageDefaults {
  shipments: {
    /** Empty means no signal filter: open on the whole book. */
    signalKinds: readonly SignalKind[]
    /** Sort hides nothing, so it never needs a note. */
    sort: 'created' | 'eta' | 'delay' | 'value'
    note?: string
  }
  fleet: { compliance: 'all' | 'issues'; note?: string }
  compliance: { status: DocStatus | 'all'; note?: string }
  parties: { risk: 'all' | Counterparty['risk']; note?: string }
}

export interface RoleLens {
  role: Role
  /** What this organisation is actually accountable for. */
  remit: string
  /** Nav paths in this role's order. A path absent here is not advertised. */
  nav: readonly string[]
  /** The four the phone keeps one tap away. */
  mobilePrimary: readonly string[]
  /** Conflicts this role owns — sorted to the top of the queue. */
  primaryKinds: readonly SignalKind[]
  /** Someone else's to fix — still listed, ranked last. */
  mutedKinds: readonly SignalKind[]
  towerTitle: string
  towerSub: string
  queueSub: string
  /** The standing-of-the-network chip beside the page title. */
  contextBadge: (d: Dashboard) => string
  /** What each module opens on for this role. */
  pageDefaults: PageDefaults
  headline: (cases: Case[], d: Dashboard | null) => Headline
}

/**
 * One name per route. The nav renders these and the lens orders them, so
 * a module is named in exactly one place.
 */
export const MODULE_LABEL: Record<string, string> = {
  '/': 'Control tower',
  '/shipments': 'Consignments',
  '/fleet': 'Fleet',
  '/exim': 'EXIM',
  '/compliance': 'Compliance',
  '/plan': 'Lane planner',
  '/waterways': 'Waterways',
  '/drill': 'Scenario drill',
  '/parties': 'Counterparties',
  '/apis': 'API gateway',
}

/* ── Kind groupings the headlines count over ───────────────────── */

/** Road-legality of the asset itself — VAHAN, SARATHI and FASTag status. */
const ASSET_BLOCKING: readonly SignalKind[] = [
  'fitness_lapsed', 'insurance_lapsed', 'dl_expired',
  'tag_blacklisted', 'partb_vehicle_mismatch', 'grap_entry_ban',
]

/** Cargo stopped by an authority rather than by the road. */
const BORDER: readonly SignalKind[] = ['customs_hold', 'hazmat_no_clearance']

/**
 * Breaches a supervisor can act on. Narrower than ASSET_BLOCKING on
 * purpose: a Part-B mismatch is an enforcement matter, a GRAP entry ban
 * is a state's own order, but neither is a commercial delay.
 */
const ENFORCEABLE: readonly SignalKind[] = [
  'fitness_lapsed', 'insurance_lapsed', 'dl_expired', 'tag_blacklisted',
  'hazmat_no_clearance', 'partb_vehicle_mismatch', 'grap_entry_ban',
]

/**
 * Distinct consignments carrying any of `kinds`, and the value behind them.
 *
 * Distinct matters: one truck with a lapsed fitness certificate AND no
 * insurance is one movement to stop, not two, and counting it twice
 * inflates every headline built on top of this.
 */
function affected(cases: Case[], kinds: readonly SignalKind[]) {
  const want = new Set<string>(kinds)
  const seen = new Set<string>()
  let value = 0
  for (const c of cases) {
    if (!want.has(c.signal.kind) || seen.has(c.signal.entity)) continue
    seen.add(c.signal.entity)
    value += c.signal.valueAtRisk
  }
  return { count: seen.size, value }
}

function severityMix(cases: Case[]) {
  const m = { critical: 0, high: 0, medium: 0 }
  for (const c of cases) m[c.signal.severity]++
  return m
}

/* ── The four lenses ───────────────────────────────────────────── */

const SHIPPER: RoleLens = {
  role: 'Shipper',
  remit: 'Owns the cargo. Answers for its value, its paperwork and its arrival.',
  nav: ['/', '/shipments', '/compliance', '/exim', '/plan', '/waterways', '/parties', '/drill', '/apis'],
  mobilePrimary: ['/', '/shipments', '/compliance', '/exim'],
  // A lapsed fitness certificate stays un-muted: the signal text is right
  // that an enforcement stop detains the cargo, not just the truck.
  primaryKinds: [
    'ewb_expires_before_eta', 'eta_slip', 'reefer_breach',
    'detention', 'customs_hold', 'corridor_disruption', 'vehicle_dark',
  ],
  mutedKinds: ['insurance_lapsed', 'dl_expired', 'tag_low_balance'],
  towerTitle: 'Control tower',
  towerSub: 'Every source system joined into one picture — what needs a decision, who owns it, and why.',
  queueSub: 'Cross-system conflicts against cargo you own — assign, action, close',
  contextBadge: (d) => `${num(d.activeShipments)} moving · ${inr(d.inTransitValue)}`,
  pageDefaults: {
    // Their own book, newest first — no filter. The paperwork clock is the
    // one question a shipper opens Compliance to ask.
    shipments: { signalKinds: [], sort: 'created' },
    fleet: { compliance: 'all' },
    compliance: { status: 'expiring', note: 'documents inside their expiry window' },
    parties: { risk: 'all' },
  },
  headline: (cases, d) => {
    const mix = severityMix(cases)
    return {
      label: 'Value at risk',
      value: d ? inr(d.valueAtRisk) : '—',
      tone: 'bad',
      detail: d
        ? `Exposed to ${d.criticalSignals} critical and ${mix.high} high signals still open, out of ${inr(d.inTransitValue)} moving.`
        : 'Reading the network…',
      basis: 'Invoice value of consignments you own that carry an open critical or high signal.',
    }
  },
}

const TRANSPORTER: RoleLens = {
  role: 'Transporter',
  remit: 'Owns the vehicles and the drivers. Answers for whether they are legal to move.',
  // No EXIM and no waterways: a road carrier files no bill of entry and runs no barge.
  nav: ['/', '/fleet', '/shipments', '/compliance', '/plan', '/drill', '/parties', '/apis'],
  mobilePrimary: ['/', '/fleet', '/shipments', '/compliance'],
  primaryKinds: [
    'fitness_lapsed', 'insurance_lapsed', 'dl_expired', 'tag_blacklisted',
    'tag_low_balance', 'vehicle_dark', 'partb_vehicle_mismatch',
    'grap_entry_ban', 'detention',
  ],
  mutedKinds: ['customs_hold'],
  towerTitle: 'Fleet control tower',
  towerSub: 'Which of your vehicles and drivers can legally move right now, and what is stopping the rest.',
  queueSub: 'Conflicts against your assets and the loads riding on them — assign, action, close',
  contextBadge: (d) => `${d.fleetActive}/${d.fleetTotal} active · ${num(d.activeShipments)} loads`,
  pageDefaults: {
    // Opens on the loads riding on an asset that cannot legally move.
    shipments: { signalKinds: ASSET_BLOCKING, sort: 'created',
      note: 'loads riding on a vehicle or driver that cannot legally move' },
    fleet: { compliance: 'issues', note: 'vehicles with an open compliance problem' },
    compliance: { status: 'expiring', note: 'documents inside their expiry window' },
    parties: { risk: 'all' },
  },
  headline: (cases) => {
    const a = affected(cases, ASSET_BLOCKING)
    return {
      label: 'Loads on blocked assets',
      value: num(a.count),
      tone: a.count ? 'bad' : 'ok',
      detail: a.count
        ? `${num(a.count)} consignments are moving on a vehicle or driver that is not road-legal — fitness, insurance, licence, a blacklisted tag or an undeclared swap. ${inr(a.value)} of someone else's cargo is riding on them.`
        : 'Every moving vehicle and driver is currently clear on VAHAN, SARATHI and FASTag.',
      basis: 'Distinct consignments under a vehicle- or driver-side breach. Counted per movement, not per breach.',
    }
  },
}

const FORWARDER: RoleLens = {
  role: 'Freight Forwarder',
  remit: "Moves other people's cargo across borders. Answers for the clock at both ends.",
  nav: ['/', '/exim', '/shipments', '/waterways', '/compliance', '/plan', '/parties', '/drill', '/apis'],
  mobilePrimary: ['/', '/exim', '/shipments', '/waterways'],
  primaryKinds: [
    'customs_hold', 'hazmat_no_clearance', 'detention', 'eta_slip',
    'ewb_expires_before_eta', 'corridor_disruption',
  ],
  mutedKinds: ['insurance_lapsed', 'dl_expired', 'tag_low_balance', 'fitness_lapsed'],
  towerTitle: 'Forwarding desk',
  towerSub: "Where your principals' cargo is held, what is holding it, and what the delay is costing.",
  queueSub: 'Conflicts against cargo you are carrying for someone else — assign, action, close',
  contextBadge: (d) => `${num(d.activeShipments)} moving · ${inr(d.inTransitValue)}`,
  pageDefaults: {
    // Opens on what is stopped rather than what is moving, because a
    // forwarder is paid on the clock and demurrage runs regardless.
    shipments: { signalKinds: ['customs_hold', 'hazmat_no_clearance', 'detention'], sort: 'eta',
      note: 'cargo held by customs, a missing clearance or detention' },
    fleet: { compliance: 'all' },
    compliance: { status: 'all' },
    parties: { risk: 'all' },
  },
  headline: (cases, d) => {
    const held = affected(cases, BORDER)
    return {
      label: 'Held at a border',
      value: held.count ? inr(held.value) : '₹0',
      tone: held.count ? 'bad' : 'ok',
      detail: held.count
        ? `${num(held.count)} consignments stopped by customs or a missing clearance${d ? `, against ${num(Math.round(d.detentionHrs))}h of detention already accrued across the network` : ''}. Demurrage runs whether or not anyone is working the file.`
        : 'Nothing is held by customs or awaiting a clearance right now.',
      basis: 'Invoice value of distinct consignments under a customs hold or missing hazmat clearance.',
    }
  },
}

const REGULATOR: RoleLens = {
  role: 'Regulator',
  remit: 'Supervises the network. Owns none of the cargo and answers for whether the rules held.',
  // No lane planner and no EXIM: a state logistics cell books no freight
  // and clears no customs. Both are commercial screens.
  nav: ['/', '/compliance', '/fleet', '/shipments', '/parties', '/waterways', '/drill', '/apis'],
  mobilePrimary: ['/', '/compliance', '/fleet', '/shipments'],
  primaryKinds: ENFORCEABLE,
  // Commercial performance is not a compliance matter. A late truck is
  // between the parties; an uninsured one is not.
  mutedKinds: ['eta_slip', 'detention', 'reefer_breach', 'tag_low_balance', 'corridor_disruption'],
  towerTitle: 'Supervision desk',
  towerSub: 'Where the network is moving outside the rules, on whose vehicles, and how long it has been true.',
  queueSub: 'Breaches visible only by joining two ministries — assign, action, close',
  contextBadge: (d) => `${num(d.activeShipments)} movements supervised · ${d.fleetActive} vehicles active`,
  pageDefaults: {
    // The point of the thread: a regulator opening Consignments lands on
    // the ones in breach, not on the whole moving book.
    shipments: { signalKinds: ENFORCEABLE, sort: 'created',
      note: 'movements in breach of VAHAN, SARATHI or FASTag status' },
    fleet: { compliance: 'issues', note: 'vehicles with an open compliance problem' },
    compliance: { status: 'expired', note: 'documents that have already lapsed' },
    parties: { risk: 'blocked', note: 'counterparties currently blocked' },
  },
  headline: (cases) => {
    const v = affected(cases, ENFORCEABLE)
    return {
      label: 'Movements in breach',
      value: num(v.count),
      tone: v.count ? 'bad' : 'ok',
      detail: v.count
        ? `${num(v.count)} consignments are moving on a vehicle or driver in breach of VAHAN, SARATHI or FASTag status. Counted as movements rather than rupees — the cargo is not yours.`
        : 'No movement in the supervised network is currently in breach.',
      basis: 'Distinct consignments under an enforceable breach. Commercial delay is excluded by design.',
    }
  },
}

const LENSES: Record<Role, RoleLens> = {
  Shipper: SHIPPER,
  Transporter: TRANSPORTER,
  'Freight Forwarder': FORWARDER,
  Regulator: REGULATOR,
}

export const lensFor = (role: Role): RoleLens => LENSES[role] ?? SHIPPER

/* ── Applying the lens ─────────────────────────────────────────── */

export type Ownership = 'primary' | 'neutral' | 'muted'

export function ownership(lens: RoleLens, kind: SignalKind): Ownership {
  if ((lens.primaryKinds as readonly string[]).includes(kind)) return 'primary'
  if ((lens.mutedKinds as readonly string[]).includes(kind)) return 'muted'
  return 'neutral'
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2 }
const BAND: Record<Ownership, number> = { primary: 0, neutral: 1, muted: 2 }

/**
 * Re-rank a queue for whoever is looking at it.
 *
 * Band first, severity second — so a medium breach this role owns outranks
 * a critical one it does not. That inversion is deliberate: for a regulator
 * a lapsed fitness certificate genuinely does matter more than a late
 * truck, however the commercial severity was scored. Nothing is removed,
 * so the cost of being wrong about someone's remit is a scroll, not a
 * missing record.
 */
export function rankForRole(lens: RoleLens, cases: Case[]): Case[] {
  return [...cases].sort((a, b) =>
    BAND[ownership(lens, a.signal.kind)] - BAND[ownership(lens, b.signal.kind)]
    || SEVERITY_RANK[a.signal.severity] - SEVERITY_RANK[b.signal.severity]
    || b.signal.valueAtRisk - a.signal.valueAtRisk)
}

/** Sort order for a nav path under this lens; -1 when not advertised. */
export const navRank = (lens: RoleLens, path: string) => lens.nav.indexOf(path)
