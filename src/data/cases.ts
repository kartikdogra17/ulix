/* ────────────────────────────────────────────────────────────────
   Cases — the working layer over signals.

   A signal is derived: it exists because the source data says so, and
   it disappears when the underlying facts change. A case is the human
   record attached to it — who owns it, what they decided, and why.

   The two are deliberately separate. Signals are recomputed on every
   read; cases persist, so an operator's decision survives the next
   refresh and an auditor can ask "who accepted this risk, and when?"
   ──────────────────────────────────────────────────────────────── */

import type { Severity, Signal } from './fusion'

export type CaseStatus = 'open' | 'in_progress' | 'snoozed' | 'resolved' | 'dismissed'

/** Outcome taxonomy — so you can later ask which responses actually work. */
export type Resolution =
  | 'fixed_at_source'   // the underlying problem was corrected
  | 'mitigated'         // worked around without fixing the root cause
  | 'false_positive'    // the source data was wrong, not the consignment
  | 'risk_accepted'     // knowingly proceeding, with a reason on record
  | 'no_longer_relevant'

export const RESOLUTION_LABEL: Record<Resolution, string> = {
  fixed_at_source: 'Fixed at source',
  mitigated: 'Mitigated',
  false_positive: 'False positive — source data wrong',
  risk_accepted: 'Risk accepted',
  no_longer_relevant: 'No longer relevant',
}

export const RESOLUTION_HINT: Record<Resolution, string> = {
  fixed_at_source: 'The e-Way Bill was extended, the vehicle swapped, the tag topped up.',
  mitigated: 'Handled another way — the exposure is contained but the cause remains.',
  false_positive: 'The government record was stale or wrong; nothing was actually at risk.',
  risk_accepted: 'Proceeding deliberately. Your reason becomes the audit record.',
  no_longer_relevant: 'Delivered, cancelled, or otherwise overtaken by events.',
}

export type ActivityKind =
  | 'created' | 'assigned' | 'unassigned' | 'status' | 'note'
  | 'snoozed' | 'resolved' | 'dismissed' | 'reopened'
  /* Somebody outside the app was told. Recorded here so it is both
     de-duplicated and auditable next to who assigned and who closed. */
  | 'notified'

export interface Activity {
  id: string
  ts: string
  actor: string
  kind: ActivityKind
  detail: string
}

export interface CaseRecord {
  signalId: string
  status: CaseStatus
  assignee: string | null
  snoozedUntil: string | null
  resolution: Resolution | null
  updatedAt: string
  activity: Activity[]
}

/** A signal with its working state attached — what the queue actually renders. */
export interface Case extends CaseRecord {
  signal: Signal
  /** True when a snooze has lapsed and the case is live again. */
  isDue: boolean
}

export interface TeamMember {
  id: string
  name: string
  role: string
  initials: string
}

export const TEAM: TeamMember[] = [
  { id: 'u-ananya', name: 'Ananya Deshmukh', role: 'Control Tower Lead', initials: 'AD' },
  { id: 'u-rohit', name: 'Rohit Bansal', role: 'Road Ops', initials: 'RB' },
  { id: 'u-fatima', name: 'Fatima Sheikh', role: 'Compliance', initials: 'FS' },
  { id: 'u-vikram', name: 'Vikram Iyer', role: 'Customs & Ports', initials: 'VI' },
  { id: 'u-neha', name: 'Neha Kulkarni', role: 'Fleet Desk', initials: 'NK' },
]

export const memberById = (id: string | null) =>
  id ? TEAM.find((m) => m.id === id) ?? null : null

/**
 * Who should own this by default. Routing by signal kind means a queue of
 * eighty items becomes five short queues that each land on the right desk.
 */
export function suggestedOwner(signal: Signal): TeamMember {
  switch (signal.kind) {
    case 'ewb_expires_before_eta':
    case 'partb_vehicle_mismatch':
    case 'hazmat_no_clearance':
      return TEAM[2] // Compliance
    case 'customs_hold':
      return TEAM[3] // Customs & Ports
    case 'fitness_lapsed':
    case 'insurance_lapsed':
    case 'tag_blacklisted':
    case 'tag_low_balance':
    case 'dl_expired':
      return TEAM[4] // Fleet Desk
    case 'vehicle_dark':
    case 'eta_slip':
    case 'detention':
      return TEAM[1] // Road Ops
    default:
      return TEAM[0]
  }
}

/** How long a case of this severity may sit before it is overdue. */
export const SLA_HOURS: Record<Severity, number> = { critical: 4, high: 12, medium: 48 }

export function isOverdue(c: Case, now = Date.now()): boolean {
  if (c.status === 'resolved' || c.status === 'dismissed') return false
  if (c.status === 'snoozed' && !c.isDue) return false
  // From detection, not from when the case record happened to be created.
  const since = Date.parse(c.signal.detectedAt)
  return now - since > SLA_HOURS[c.signal.severity] * 3_600_000
}

/** Hours a live case has been waiting, measured from detection. */
export const ageHours = (c: Case, now = Date.now()) =>
  Math.max(0, (now - Date.parse(c.signal.detectedAt)) / 3_600_000)

/** Cases that are actually live right now — snoozes that have lapsed count. */
export const isLive = (c: Case) =>
  c.status === 'open' || c.status === 'in_progress' || (c.status === 'snoozed' && c.isDue)

/* ── Persistence ──────────────────────────────────────────────────
   Case state is the one thing in this build that must survive a
   reload — a decision you recorded should not vanish because the
   simulated world regenerated. localStorage is the right scope here:
   per-operator, and never sent anywhere. */

const LS_KEY = 'ulip.cases.v1'

export function loadCases(): Record<string, CaseRecord> {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? (JSON.parse(raw) as Record<string, CaseRecord>) : {}
  } catch {
    return {}
  }
}

export function saveCases(cases: Record<string, CaseRecord>) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(cases))
  } catch {
    /* private window or blocked storage — the session still works, it just
       will not remember decisions after a reload. */
  }
}

export function blankCase(
  signalId: string, detectedAt?: string, now = Date.now(),
): CaseRecord {
  const raised = detectedAt ?? new Date(now).toISOString()
  return {
    signalId,
    status: 'open',
    assignee: null,
    snoozedUntil: null,
    resolution: null,
    updatedAt: raised,
    activity: [{
      id: `${signalId}-a0`,
      ts: raised,
      actor: 'system',
      kind: 'created',
      detail: 'Signal raised by cross-system fusion',
    }],
  }
}

export function appendActivity(
  rec: CaseRecord, actor: string, kind: ActivityKind, detail: string,
): CaseRecord {
  const ts = new Date().toISOString()
  return {
    ...rec,
    updatedAt: ts,
    activity: [...rec.activity, {
      id: `${rec.signalId}-a${rec.activity.length}`, ts, actor, kind, detail,
    }],
  }
}
