/* ────────────────────────────────────────────────────────────────
   Delivery — getting a signal out of the browser.

   A conflict that exists only on a screen nobody has open is still
   invisible, which is the exact problem this product sells against. The
   platform already computes what needs doing, who owns it and how long
   until the window shuts; none of that has ever left the page.

   The hard part is not sending. It is sending LITTLE ENOUGH. The
   documented way this category dies is alert fatigue, and a webhook that
   fires on all 109 live cases would reproduce it faster than any screen.
   So four guards, in order of how much they matter:

     1. Severity. Critical only, by default.
     2. Or: past SLA and still nobody's — the queue failing, not a case.
     3. Never twice. Signals are recomputed on every read, so without
        this a poll loop would re-send the same conflict forever.
     4. A cap per delivery, because ten lines get read and fifty do not.

   Guard 3 rides on the case activity trail rather than new state. That
   makes it auditable for free: who was told, and when, next to who
   assigned it and who closed it.
   ──────────────────────────────────────────────────────────────── */

import type { Case } from './cases'
import { SLA_HOURS, ageHours } from './cases'
import type { Severity } from './fusion'
import { inr } from '../lib/format'

export interface DeliveryRule {
  /** Severities that always warrant telling someone. */
  severities: Severity[]
  /** Also send when a case has outlived its SLA with no owner. */
  overdueUnassigned: boolean
  /** Most cases in one delivery. The rest are counted, not listed. */
  max: number
}

export const DEFAULT_RULE: DeliveryRule = {
  severities: ['critical'],
  overdueUnassigned: true,
  max: 10,
}

/** Has anyone already been told about this one? */
export const wasNotified = (c: Case) => c.activity.some((a) => a.kind === 'notified')

const isOpen = (c: Case) =>
  c.status === 'open' || c.status === 'in_progress' || (c.status === 'snoozed' && c.isDue)

/** Cases that warrant a message, worst first. */
export function selectForDelivery(
  cases: Case[], rule: DeliveryRule = DEFAULT_RULE, now = Date.now(),
): Case[] {
  const rank: Record<Severity, number> = { critical: 0, high: 1, medium: 2 }
  return cases
    .filter((c) => {
      if (!isOpen(c) || wasNotified(c)) return false
      if (rule.severities.includes(c.signal.severity)) return true
      if (!rule.overdueUnassigned) return false
      return c.assignee === null && ageHours(c, now) > SLA_HOURS[c.signal.severity]
    })
    .sort((a, b) =>
      rank[a.signal.severity] - rank[b.signal.severity]
      || b.signal.valueAtRisk - a.signal.valueAtRisk)
}

export interface DeliveryPayload {
  /** Slack and Teams incoming webhooks both render this key. */
  text: string
  /** The same thing structured, for anything that is not a chat tool. */
  cases: Array<{
    signalId: string
    entity: string
    severity: Severity
    kind: string
    title: string
    action: string
    valueAtRisk: number
    hoursToAct: number | null
    sources: string[]
    url: string | null
  }>
  /** How many qualified beyond those listed. */
  omitted: number
}

/**
 * One message. Every line carries the action, because an alert that says
 * what is wrong without saying what to do is the thing people learn to
 * scroll past.
 */
export function buildPayload(
  selected: Case[], rule: DeliveryRule = DEFAULT_RULE, appUrl?: string,
): DeliveryPayload {
  const shown = selected.slice(0, rule.max)
  const omitted = Math.max(0, selected.length - shown.length)
  const link = (c: Case) => appUrl ? `${appUrl.replace(/\/$/, '')}/#/shipments?q=${encodeURIComponent(c.signal.entity)}` : null

  const lines = shown.map((c) => {
    const window = c.signal.hoursToAct === null ? ''
      : c.signal.hoursToAct <= 0 ? ' · window closed'
      : ` · ${Math.round(c.signal.hoursToAct)}h to act`
    const owner = c.assignee ? '' : ' · unassigned'
    return `• [${c.signal.severity}] ${c.signal.title} — ${c.signal.entity}`
      + ` (${inr(c.signal.valueAtRisk)}${window}${owner})\n  → ${c.signal.action}`
  })

  const head = shown.length === 1
    ? '1 consignment needs a decision'
    : `${shown.length} consignments need a decision`

  return {
    text: [
      `*ULIX — ${head}*`,
      ...lines,
      omitted ? `…and ${omitted} more in the queue.` : '',
    ].filter(Boolean).join('\n'),
    cases: shown.map((c) => ({
      signalId: c.signalId,
      entity: c.signal.entity,
      severity: c.signal.severity,
      kind: c.signal.kind,
      title: c.signal.title,
      action: c.signal.action,
      valueAtRisk: c.signal.valueAtRisk,
      hoursToAct: c.signal.hoursToAct,
      sources: c.signal.sources,
      url: link(c),
    })),
    omitted,
  }
}
