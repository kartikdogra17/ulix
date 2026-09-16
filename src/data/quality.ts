/* ────────────────────────────────────────────────────────────────
   Detector precision — is this signal worth believing?

   Control towers fail in a well-documented way: they flag everything,
   operators learn the flags are noise, and the screen gets ignored. This
   codebase already guards the first half of that by checking
   distributions before shipping a screen. This module closes the other
   half.

   Every case ends with a `Resolution`, and two of those are verdicts on
   the DETECTOR rather than on the consignment: `false_positive` says the
   government record was stale or wrong and nothing was ever at risk,
   while `fixed_at_source`, `mitigated` and `risk_accepted` all say the
   signal was right and somebody did something. Counting those gives each
   detector a track record, and the operator a reason to weight one
   differently from another.

   `no_longer_relevant` is excluded from precision on purpose. A
   consignment that was delivered before anyone got to the case tells you
   nothing about whether the check was correct.
   ──────────────────────────────────────────────────────────────── */

import type { Case, Resolution } from './cases'
import { SIGNAL_LABEL, type SignalKind } from './fusion'
import { int, rng } from './mock/seed'

/** One closed case, reduced to what a track record needs. */
export interface ClosedOutcome {
  kind: SignalKind
  resolution: Resolution
  closedAt: string
}

export interface DetectorQuality {
  kind: SignalKind
  label: string
  /** Closed saying the signal was right and something was done about it. */
  actioned: number
  /** Closed saying the signal itself was wrong. */
  falsePositive: number
  /** Overtaken by events — neither a hit nor a miss. */
  lapsed: number
  closed: number
  /** actioned / (actioned + falsePositive), or null when the sample is too thin. */
  precision: number | null
  /** Open cases of this kind right now, for weighing the queue against. */
  live: number
}

/**
 * Below this many judged outcomes a precision figure is noise wearing a
 * decimal point. Saying "not enough history yet" is the honest output, and
 * it is also what stops a detector being condemned on two bad days.
 *
 * This started at 8 and was raised after checking the output: at n=8 the
 * standard error is around 17 points, so a detector built to be right 45%
 * of the time was displaying 74% and sitting above genuinely good checks.
 * A threshold that still admits noise is not a threshold.
 */
export const MIN_SAMPLE = 20

/** Detectors at or under this are worth warning an operator about. */
export const WEAK_PRECISION = 0.65

const ACTIONED: Resolution[] = ['fixed_at_source', 'mitigated', 'risk_accepted']

/**
 * How often each detector has turned out to be right, across this
 * simulated history.
 *
 * They are deliberately not equal. A check against an authoritative
 * register — has this fitness certificate lapsed, is this tag blacklisted —
 * is nearly always right, and is wrong only when the government record is
 * itself stale. Anything inferred from ABSENCE or from open news is far
 * weaker: a vehicle going dark is usually a toll-free stretch, and a
 * corridor disruption story is a headline that may or may not touch your
 * lane. The corridor pinch sits in between because it is inferred geometry
 * — a segment within 55 km of a leg's straight-line path is a good guess
 * about the route, not a fact about it.
 */
const OBSERVED: Record<SignalKind, { precision: number; volume: number }> = {
  // Checks against an authoritative register, and common enough to judge.
  insurance_lapsed:        { precision: 0.90, volume: 140 },
  fitness_lapsed:          { precision: 0.88, volume: 165 },
  ewb_expires_before_eta:  { precision: 0.87, volume: 190 },
  dl_expired:              { precision: 0.86, volume: 120 },
  tag_blacklisted:         { precision: 0.84, volume: 95 },
  detention:               { precision: 0.85, volume: 110 },
  customs_hold:            { precision: 0.91, volume: 85 },
  eta_slip:                { precision: 0.70, volume: 210 },
  tag_low_balance:         { precision: 0.66, volume: 130 },
  partb_vehicle_mismatch:  { precision: 0.72, volume: 70 },
  // Inferred rather than looked up. Weaker, and they should look weaker.
  vehicle_dark:            { precision: 0.54, volume: 155 },
  corridor_disruption:     { precision: 0.48, volume: 90 },
  corridor_pinch:          { precision: 0.63, volume: 40 },
  // Genuinely rare or seasonal: real deployments will not have enough
  // history to judge these for a long time, and the panel should say so
  // rather than invent a number from a handful of cases.
  hazmat_no_clearance:     { precision: 0.89, volume: 14 },
  reefer_breach:           { precision: 0.78, volume: 16 },
  grap_entry_ban:          { precision: 0.83, volume: 11 },
  fog_risk:                { precision: 0.45, volume: 9 },
}

/**
 * A back catalogue of closed cases, so a new deployment can say something
 * about its own detectors on day one instead of after a quarter.
 *
 * Simulated, like every other ULIP-side figure here, and labelled as such
 * wherever it is shown. Real outcomes accumulate on top of it as operators
 * actually close cases.
 */
export function makeCaseOutcomes(): ClosedOutcome[] {
  const r = rng(4477201)
  const now = Date.now()
  const out: ClosedOutcome[] = []
  for (const [kind, { precision, volume }] of Object.entries(OBSERVED) as Array<[SignalKind, { precision: number; volume: number }]>) {
    const n = int(r, Math.round(volume * 0.7), volume)
    for (let i = 0; i < n; i++) {
      /* Draw the non-verdict first, independently. Folding it into the same
         ladder as the verdict skewed every figure: it ate a slice of the
         false-positive tail, so measured precision came out well above the
         rate the detector was built to. Now actioned / (actioned + wrong)
         lands on `precision` by construction, which is the whole point of
         having a number to check against. */
      let resolution: Resolution
      if (r() < 0.08) {
        resolution = 'no_longer_relevant'
      } else if (r() < precision) {
        const x = r()
        resolution = x < 0.62 ? 'fixed_at_source' : x < 0.88 ? 'mitigated' : 'risk_accepted'
      } else {
        resolution = 'false_positive'
      }
      out.push({
        kind,
        resolution,
        closedAt: new Date(now - int(r, 1, 90) * 86_400_000).toISOString(),
      })
    }
  }
  return out
}

/**
 * Fold the back catalogue together with whatever operators have actually
 * closed, and rank the detectors by how much they can be trusted.
 */
export function detectorQuality(
  outcomes: ClosedOutcome[], cases: Case[],
): DetectorQuality[] {
  const rows = new Map<SignalKind, DetectorQuality>()
  const row = (kind: SignalKind) => {
    let r = rows.get(kind)
    if (!r) {
      r = {
        kind, label: SIGNAL_LABEL[kind] ?? kind,
        actioned: 0, falsePositive: 0, lapsed: 0, closed: 0, precision: null, live: 0,
      }
      rows.set(kind, r)
    }
    return r
  }

  const tally = (kind: SignalKind, resolution: Resolution | null) => {
    if (!resolution) return
    const r = row(kind)
    r.closed++
    if (resolution === 'false_positive') r.falsePositive++
    else if (resolution === 'no_longer_relevant') r.lapsed++
    else if (ACTIONED.includes(resolution)) r.actioned++
  }

  for (const o of outcomes) tally(o.kind, o.resolution)
  for (const c of cases) {
    if (c.status === 'resolved' || c.status === 'dismissed') tally(c.signal.kind, c.resolution)
    else row(c.signal.kind).live++
  }

  for (const r of rows.values()) {
    const judged = r.actioned + r.falsePositive
    r.precision = judged >= MIN_SAMPLE ? r.actioned / judged : null
  }

  return [...rows.values()].sort((a, b) =>
    (a.precision ?? 2) - (b.precision ?? 2) || b.closed - a.closed)
}

/** The weak detectors, worst first. Only ones with enough history to judge. */
export const weakDetectors = (rows: DetectorQuality[]) =>
  rows.filter((r) => r.precision !== null && r.precision <= WEAK_PRECISION)
