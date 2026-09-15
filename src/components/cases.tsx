import { useEffect, useState } from 'react'
import {
  AlarmClock, Check, CircleSlash, Layers, MessageSquarePlus, RotateCcw,
  Timer, UserRound,
} from 'lucide-react'
import { adapter } from '../data'
import { useAsync } from '../lib/useAsync'
import { dt, inr, rel } from '../lib/format'
import {
  type Case, type Resolution, RESOLUTION_HINT, RESOLUTION_LABEL,
  SLA_HOURS, TEAM, isOverdue, memberById, suggestedOwner,
} from '../data/cases'
import type { Severity } from '../data/fusion'
import { Badge, Button, Card, Drawer, Select, TableSkeleton } from './ui'
import { cn } from '../lib/cn'

export const SEV_TONE: Record<Severity, 'bad' | 'warn' | 'info'> = {
  critical: 'bad', high: 'warn', medium: 'info',
}

/** The signed-in operator, resolved onto the team roster. */
export const currentMemberId = (name?: string) =>
  TEAM.find((m) => m.name === name)?.id ?? TEAM[0].id

export function Avatar({ id, className }: { id: string | null; className?: string }) {
  const m = memberById(id)
  if (!m) {
    return (
      <span className={cn('grid size-6 place-items-center rounded-full border border-dashed border-line text-faint', className)}
        title="Unassigned">
        <UserRound className="size-3" />
      </span>
    )
  }
  return (
    <span title={`${m.name} — ${m.role}`}
      className={cn('grid size-6 shrink-0 place-items-center rounded-full bg-surface-3 text-[9px] font-semibold tracking-tight', className)}>
      {m.initials}
    </span>
  )
}

export function StatusChip({ c }: { c: Case }) {
  if (c.status === 'resolved') return <Badge tone="ok"><Check className="size-3" />Resolved</Badge>
  if (c.status === 'dismissed') return <Badge tone="neutral"><CircleSlash className="size-3" />Dismissed</Badge>
  if (c.status === 'snoozed' && !c.isDue) {
    return (
      <Badge tone="info">
        <AlarmClock className="size-3" />
        Snoozed {c.snoozedUntil ? rel(c.snoozedUntil) : ''}
      </Badge>
    )
  }
  if (isOverdue(c)) {
    return <Badge tone="bad"><Timer className="size-3" />Overdue</Badge>
  }
  if (c.status === 'in_progress') return <Badge tone="brand" dot>In progress</Badge>
  return <Badge tone="neutral" dot>Open</Badge>
}

export function Sources({ ids }: { ids: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Layers className="size-3 text-faint" />
      {ids.map((id) => (
        <span key={id}
          className="rounded border border-line bg-surface-2 px-1 font-mono text-[10px] leading-4 text-muted">
          {id}
        </span>
      ))}
    </div>
  )
}

/** Inline owner picker. Defaults to the desk this signal kind belongs to. */
export function AssigneeSelect({ c, actor, onChanged, compact }: {
  c: Case; actor: string; onChanged: () => void; compact?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const suggested = suggestedOwner(c.signal)

  const change = async (value: string) => {
    setBusy(true)
    try {
      await adapter.assignCase(c.signalId, value === '' ? null : value, actor)
      onChanged()
    } finally { setBusy(false) }
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Avatar id={c.assignee} />
      {/* Width lives on the wrapper: Select itself is w-full, and two width
          utilities on one element resolve by stylesheet order, not by the
          order they appear in the class string. */}
      <div className={cn('shrink-0', compact ? 'w-[8.5rem]' : 'w-44')}>
        <Select
          aria-label="Assign owner"
          disabled={busy}
          value={c.assignee ?? ''}
          onChange={(e) => change(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          className="h-7 text-[11px]"
        >
          <option value="">Unassigned{!c.assignee ? ` · suggest ${suggested.initials}` : ''}</option>
          {TEAM.map((m) => (
            <option key={m.id} value={m.id}>{m.name} — {m.role}</option>
          ))}
        </Select>
      </div>
    </div>
  )
}

/** Assign-to-suggested / snooze / resolve, the three things done most often. */
export function QuickActions({ c, actor, onChanged }: {
  c: Case; actor: string; onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try { await fn(); onChanged() } finally { setBusy(false) }
  }

  if (c.status === 'resolved' || c.status === 'dismissed') {
    return (
      <Button size="sm" variant="ghost" disabled={busy}
        onClick={(e) => { e.stopPropagation(); void run(() => adapter.reopenCase(c.signalId, actor)) }}>
        <RotateCcw className="size-3.5" /> Reopen
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      {!c.assignee && (
        <Button size="sm" variant="outline" disabled={busy}
          onClick={() => run(() => adapter.assignCase(c.signalId, suggestedOwner(c.signal).id, actor))}>
          Assign {suggestedOwner(c.signal).initials}
        </Button>
      )}
      <Button size="sm" variant="ghost" disabled={busy} aria-label="Snooze 8 hours"
        onClick={() => run(() => adapter.snoozeCase(c.signalId, 8, actor))}>
        <AlarmClock className="size-3.5" />
      </Button>
    </div>
  )
}

/* ── Case drawer: the full record and the resolve flow ────────── */

const RESOLUTIONS: Resolution[] = [
  'fixed_at_source', 'mitigated', 'false_positive', 'risk_accepted', 'no_longer_relevant',
]

export function CaseDrawer({ signalId, actor, onClose, onChanged }: {
  signalId: string | null; actor: string; onClose: () => void; onChanged: () => void
}) {
  const { data: c, refresh } = useAsync(
    () => (signalId ? adapter.getCase(signalId) : Promise.resolve(null)), [signalId])
  const [note, setNote] = useState('')
  const [resolution, setResolution] = useState<Resolution | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { setNote(''); setResolution(null) }, [signalId])

  const after = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try { await fn(); await refresh(); onChanged(); setNote('') } finally { setBusy(false) }
  }

  return (
    <Drawer open={!!signalId} onClose={onClose} width="max-w-2xl"
      title={c ? c.signal.title : 'Loading…'}
      sub={c && <span className="font-mono">{c.signal.entity}</span>}>
      {!c ? <TableSkeleton rows={6} cols={2} /> : (
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={SEV_TONE[c.signal.severity]} dot>{c.signal.severity}</Badge>
            <StatusChip c={c} />
            <Badge tone="neutral">
              SLA {SLA_HOURS[c.signal.severity]}h
            </Badge>
            <span className="ml-auto text-right">
              <span className="tnum text-[15px] font-semibold">{inr(c.signal.valueAtRisk)}</span>
              <span className="ml-1 text-[11px] text-faint">at risk</span>
            </span>
          </div>

          <Card className="p-3">
            <p className="text-[13px] leading-relaxed">{c.signal.detail}</p>
            <div className="mt-3 rounded-lg border border-line bg-surface-2 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">Do next</div>
              <p className="mt-0.5 text-[12px] leading-relaxed">{c.signal.action}</p>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <Sources ids={c.signal.sources} />
              {c.signal.hoursToAct !== null && (
                <span className={cn('text-[11px] font-medium',
                  c.signal.hoursToAct <= 0 ? 'text-bad' : c.signal.hoursToAct < 12 ? 'text-warn' : 'text-faint')}>
                  <Timer className="mr-0.5 inline size-3" />
                  {c.signal.hoursToAct <= 0 ? 'window closed' : `${Math.round(c.signal.hoursToAct)}h to act`}
                </span>
              )}
            </div>
          </Card>

          {/* Ownership */}
          <Card className="p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-faint">Owner</div>
            <div className="flex flex-wrap items-center gap-2">
              <AssigneeSelect c={c} actor={actor} onChanged={() => { void refresh(); onChanged() }} />
              {c.assignee !== actor && (
                <Button size="sm" variant="ghost" disabled={busy}
                  onClick={() => after(() => adapter.assignCase(c.signalId, actor, actor))}>
                  Take it
                </Button>
              )}
              <div className="ml-auto flex gap-1.5">
                {([4, 8, 24] as const).map((h) => (
                  <Button key={h} size="sm" variant="ghost" disabled={busy}
                    onClick={() => after(() => adapter.snoozeCase(c.signalId, h, actor))}>
                    <AlarmClock className="size-3.5" />{h}h
                  </Button>
                ))}
              </div>
            </div>
          </Card>

          {/* Resolve */}
          {c.status !== 'resolved' && c.status !== 'dismissed' ? (
            <Card className="p-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-faint">
                Close this case
              </div>
              <div className="space-y-1.5">
                {RESOLUTIONS.map((r) => (
                  <button key={r} onClick={() => setResolution(r)}
                    className={cn('w-full rounded-lg border px-3 py-2 text-left transition-colors',
                      resolution === r ? 'border-brand/50 bg-brand-soft' : 'border-line hover:bg-surface-2')}>
                    <div className="text-[12px] font-medium">{RESOLUTION_LABEL[r]}</div>
                    <div className="mt-0.5 text-[11px] leading-snug text-muted">{RESOLUTION_HINT[r]}</div>
                  </button>
                ))}
              </div>
              <textarea
                value={note} onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder={resolution === 'risk_accepted'
                  ? 'Why is this risk acceptable? This becomes the audit record.'
                  : 'What did you do? (optional)'}
                className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-[12px] placeholder:text-faint focus:border-brand/60 focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <Button variant="primary" size="sm"
                  disabled={busy || !resolution || (resolution === 'risk_accepted' && !note.trim())}
                  onClick={() => resolution && after(() =>
                    adapter.resolveCase(c.signalId, resolution, note, actor))}>
                  <Check className="size-3.5" /> Resolve
                </Button>
                <Button size="sm" variant="ghost" disabled={busy || !note.trim()}
                  onClick={() => after(() => adapter.addCaseNote(c.signalId, note, actor))}>
                  <MessageSquarePlus className="size-3.5" /> Add note only
                </Button>
                <Button size="sm" variant="danger" className="ml-auto" disabled={busy}
                  onClick={() => after(() => adapter.dismissCase(c.signalId, note, actor))}>
                  <CircleSlash className="size-3.5" /> Dismiss as false positive
                </Button>
              </div>
              {resolution === 'risk_accepted' && !note.trim() && (
                <p className="mt-1.5 text-[11px] text-warn">
                  Accepting a risk needs a reason on record.
                </p>
              )}
            </Card>
          ) : (
            <Card className="p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[12px] font-medium">
                    {c.resolution ? RESOLUTION_LABEL[c.resolution] : 'Closed'}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted">Closed {rel(c.updatedAt)}</div>
                </div>
                <Button size="sm" disabled={busy}
                  onClick={() => after(() => adapter.reopenCase(c.signalId, actor))}>
                  <RotateCcw className="size-3.5" /> Reopen
                </Button>
              </div>
            </Card>
          )}

          {/* Audit trail */}
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-faint">
              Activity
            </div>
            {[...c.activity].reverse().map((a, i) => (
              <div key={a.id} className="flex gap-3">
                <div className="flex flex-col items-center pt-1.5">
                  <span className={cn('size-1.5 shrink-0 rounded-full', i === 0 ? 'bg-brand' : 'bg-line')} />
                  {i < c.activity.length - 1 && <span className="my-1 w-px flex-1 bg-line" />}
                </div>
                <div className="min-w-0 flex-1 pb-3">
                  <div className="text-[12px] leading-snug">{a.detail}</div>
                  <div className="mt-0.5 text-[10px] text-faint">
                    {memberById(a.actor)?.name ?? a.actor} · {dt(a.ts)} · {rel(a.ts)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Drawer>
  )
}
