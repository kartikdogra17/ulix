import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Anchor, ArrowUpRight, CheckCircle2, ChevronRight, CircleDollarSign, Gauge,
  Newspaper, Signal as SignalIcon, Timer, TrendingUp, Truck, UserRoundPlus,
} from 'lucide-react'
import { adapter } from '../data'
import { useAsync } from '../lib/useAsync'
import { dur, inr, num, rel, titleCase } from '../lib/format'
import { NetworkMap, type MapMarker } from '../components/NetworkMap'
import {
  Badge, Button, Card, CardHead, Meter, Mono, Skeleton, TableSkeleton, Td, Th,
} from '../components/ui'
import { Donut, Radial, Sparkline } from '../components/charts'
import type { DisruptionKind } from '../data/disruptions'
import {
  Avatar, CaseDrawer, QuickActions, SEV_TONE, Sources, StatusChip, currentMemberId,
} from '../components/cases'
import { SLA_HOURS, TEAM, ageHours, isOverdue, memberById } from '../data/cases'
import type { CaseQuery } from '../data/adapter'
import type { Case } from '../data/cases'
import type { Severity } from '../data/fusion'
import { useApp } from '../state/app'
import { cn } from '../lib/cn'

const DISRUPTION_TONE: Record<DisruptionKind, 'bad' | 'warn' | 'info' | 'neutral'> = {
  port: 'bad', strike: 'bad', closure: 'warn', flood: 'warn',
  protest: 'warn', accident: 'info', weather: 'info',
}

const KIND_LABEL: Record<string, string> = {
  ewb_expires_before_eta: 'e-Way Bill expiring mid-transit',
  partb_vehicle_mismatch: 'Part-B vehicle mismatch',
  vehicle_dark: 'No toll reads',
  fitness_lapsed: 'Fitness lapsed',
  insurance_lapsed: 'Insurance lapsed',
  tag_blacklisted: 'FASTag blacklisted',
  tag_low_balance: 'FASTag low balance',
  dl_expired: 'Licence expired',
  customs_hold: 'Customs hold',
  hazmat_no_clearance: 'Hazmat without clearance',
  reefer_breach: 'Cold-chain breach',
  detention: 'Detention',
  eta_slip: 'Schedule slip',
}

const SPARK_TONE = { ok: 'ok', warn: 'warn', bad: 'bad', neutral: 'muted' } as const

function Kpi({ label, value, sub, icon: Icon, tone = 'neutral', loading, accent, trend }: {
  label: string; value: string; sub?: string
  icon: React.ComponentType<{ className?: string }>
  tone?: 'ok' | 'warn' | 'bad' | 'neutral'; loading?: boolean; accent?: boolean
  /** Recent history, drawn as a sparkline under the figure. */
  trend?: number[]
}) {
  const ring = {
    ok: 'text-ok bg-ok-soft', warn: 'text-warn bg-warn-soft',
    bad: 'text-bad bg-bad-soft', neutral: 'text-muted bg-surface-2',
  }[tone]
  return (
    <Card className={cn('relative overflow-hidden p-3.5', accent && 'border-bad/30 bg-bad-soft/25')}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</span>
        <span className={cn('grid size-6 shrink-0 place-items-center rounded-md', ring)}>
          <Icon className="size-3.5" />
        </span>
      </div>
      {loading
        ? <Skeleton className="mt-2 h-7 w-24" />
        : <div className="tnum mt-1.5 text-[22px] font-semibold leading-tight tracking-tight">{value}</div>}
      {sub && <div className="mt-0.5 text-[11px] text-muted">{sub}</div>}
      {trend && trend.length > 1 && (
        <div className="-mx-3.5 -mb-3.5 mt-2">
          <Sparkline values={trend} tone={SPARK_TONE[tone]} height={26} />
        </div>
      )}
    </Card>
  )
}

/* ── The hero: a worklist, not a list of charts ── */

function CaseRow({ c, actor, onOpen, onChanged }: {
  c: Case; actor: string; onOpen: () => void; onChanged: () => void
}) {
  const closed = c.status === 'resolved' || c.status === 'dismissed'
  return (
    <div className={cn('px-3.5 py-3 transition-colors hover:bg-surface-2/40', closed && 'opacity-60')}>
      <div className="flex items-start gap-3">
        <Badge tone={SEV_TONE[c.signal.severity]} dot className="mt-0.5 shrink-0">
          {c.signal.severity}
        </Badge>

        <button onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-[13px] font-medium">{c.signal.title}</span>
            <Mono className="text-faint">{c.signal.entity}</Mono>
            <StatusChip c={c} />
          </div>
          <p className="mt-1 line-clamp-1 text-[12px] leading-relaxed text-muted">
            {c.signal.detail}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Sources ids={c.signal.sources} />
            {c.signal.hoursToAct !== null && (
              <span className={cn('text-[10px] font-medium',
                c.signal.hoursToAct <= 0 ? 'text-bad'
                  : c.signal.hoursToAct < 12 ? 'text-warn' : 'text-faint')}>
                <Timer className="mr-0.5 inline size-3" />
                {c.signal.hoursToAct <= 0 ? 'window closed' : `${Math.round(c.signal.hoursToAct)}h to act`}
              </span>
            )}
            <span className="text-[10px] text-faint">
              waiting {dur(ageHours(c) * 60)} · SLA {SLA_HOURS[c.signal.severity]}h
            </span>
          </div>
        </button>

        {/* Owner is a glanceable avatar here; changing it happens in the case,
            where there is room to see who is already carrying what. */}
        <div className="hidden shrink-0 items-center gap-2.5 sm:flex">
          <button onClick={onOpen} title={memberById(c.assignee)?.name ?? 'Unassigned — click to open'}>
            <Avatar id={c.assignee} />
          </button>
          <div className="w-[4.5rem] text-right">
            <div className="tnum text-[13px] font-semibold">{inr(c.signal.valueAtRisk)}</div>
            <div className="text-[10px] text-faint">at risk</div>
          </div>
          <QuickActions c={c} actor={actor} onChanged={onChanged} />
        </div>

        <ChevronRight className="mt-1 size-4 shrink-0 text-faint sm:hidden" />
      </div>

      {/* Compact controls for narrow screens */}
      <div className="mt-2 flex items-center gap-2 sm:hidden">
        <Avatar id={c.assignee} />
        <span className="tnum ml-auto text-[12px] font-semibold">{inr(c.signal.valueAtRisk)}</span>
        <QuickActions c={c} actor={actor} onChanged={onChanged} />
      </div>
    </div>
  )
}

/* ── Page ─────────────────────────────────────────────────────── */

export function ControlTower() {
  const { session } = useApp()
  const actor = currentMemberId(session?.name)

  const [scope, setScope] = useState<NonNullable<CaseQuery['scope']>>('live')
  const [sev, setSev] = useState<Severity | 'all'>('all')
  const [openCase, setOpenCase] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const bump = () => setVersion((v) => v + 1)

  const { data } = useAsync(() => adapter.dashboard(), [version])
  const { data: live } = useAsync(() => adapter.liveMap(), [])
  const { data: cases } = useAsync(
    () => adapter.listCases({ scope, severity: sev, assignee: scope === 'mine' ? actor : undefined }),
    [scope, sev, actor, version])
  // Unfiltered, for tab counts and the risk breakdown.
  const { data: allLive } = useAsync(() => adapter.listCases({ scope: 'live' }), [version])
  const { data: storeKind } = useAsync(() => adapter.caseStoreKind(), [])
  const { data: feed } = useAsync(() => adapter.disruptions(), [])
  const { data: marine } = useAsync(() => adapter.vessels(), [])

  /** Risk per consignment, so the map shows exposure rather than mere position. */
  const riskByEntity = useMemo(() => {
    const m = new Map<string, Severity>()
    for (const c of allLive ?? []) {
      const cur = m.get(c.signal.entity)
      if (!cur || c.signal.severity === 'critical'
        || (c.signal.severity === 'high' && cur === 'medium')) {
        m.set(c.signal.entity, c.signal.severity)
      }
    }
    return m
  }, [allLive])

  const markers: MapMarker[] = useMemo(() =>
    (live ?? []).slice(0, 90).map((s) => {
      const r = riskByEntity.get(s.id)
      return {
        id: s.id, lat: s.lat, lon: s.lon,
        tone: r === 'critical' ? 'bad' : r === 'high' ? 'warn' : r === 'medium' ? 'info' : 'ok',
        pulse: r === 'critical',
        r: r ? 4.2 : 3,
        label: `${s.id}${r ? ` · ${r} risk` : ' · clear'}`,
      }
    }), [live, riskByEntity])

  /** What kinds of cross-system checks are actually firing. */
  const mix = useMemo(() => {
    const m = new Map<string, { count: number; worst: Severity }>()
    const rank = { critical: 0, high: 1, medium: 2 } as const
    for (const c of allLive ?? []) {
      const cur = m.get(c.signal.kind)
      m.set(c.signal.kind, {
        count: (cur?.count ?? 0) + 1,
        worst: !cur || rank[c.signal.severity] < rank[cur.worst] ? c.signal.severity : cur.worst,
      })
    }
    const rows = [...m.entries()]
      .map(([kind, v]) => ({ kind, label: KIND_LABEL[kind] ?? titleCase(kind), ...v }))
      .sort((a, b) => b.count - a.count)
    const max = Math.max(1, ...rows.map((r) => r.count))
    return rows.slice(0, 9).map((r) => ({ ...r, pct: (r.count / max) * 100 }))
  }, [allLive])

  const daily = data?.daily ?? []
  const trend = {
    created: daily.map((d) => d.created as number),
    delivered: daily.map((d) => d.delivered as number),
    onTime: daily.map((d) => d.onTimePct as number),
    delayed: daily.map((d) => d.delayed as number),
  }

  const severityMix = useMemo(() => {
    const c = { critical: 0, high: 0, medium: 0 }
    for (const x of allLive ?? []) c[x.signal.severity]++
    return c
  }, [allLive])

  const mine = (allLive ?? []).filter((c) => c.assignee === actor).length
  const SCOPES: Array<[NonNullable<CaseQuery['scope']>, string, number | undefined]> = [
    ['live', 'Queue', allLive?.length],
    ['mine', 'Mine', mine],
    ['unassigned', 'Unassigned', data?.unassignedCases],
    ['overdue', 'Overdue', data?.overdueCases],
    ['resolved', 'Closed', data?.resolvedToday],
  ]

  return (
    <div className="space-y-4 p-3 sm:p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Control tower</h1>
          <p className="text-[13px] text-muted">
            Every source system joined into one picture — what needs a decision, who owns it, and why.
          </p>
        </div>
        {data && (
          <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5">
            <Gauge className="size-3.5 text-muted" />
            <span className="text-[11px] text-muted">Data confidence</span>
            <Meter value={data.dataConfidence} className="w-16"
              tone={data.dataConfidence >= 75 ? 'ok' : data.dataConfidence >= 50 ? 'warn' : 'bad'} />
            <span className="tnum text-[12px] font-semibold">{data.dataConfidence}%</span>
          </div>
        )}
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi loading={!data} accent label="Value at risk" icon={CircleDollarSign} tone="bad"
          value={data ? inr(data.valueAtRisk) : '—'}
          sub={data ? `${data.criticalSignals} critical, unresolved` : undefined} />
        <Kpi loading={!data} label="Unassigned" icon={UserRoundPlus}
          tone={data?.unassignedCases ? 'warn' : 'ok'}
          value={data ? num(data.unassignedCases) : '—'} sub="nobody has picked these up" />
        <Kpi loading={!data} label="Overdue" icon={Timer}
          tone={data?.overdueCases ? 'bad' : 'ok'}
          value={data ? num(data.overdueCases) : '—'} sub="past SLA for their severity" />
        <Kpi loading={!data} label="Closed today" icon={CheckCircle2} tone="ok"
          value={data ? num(data.resolvedToday) : '—'} sub="resolved or dismissed"
          trend={trend.delivered} />
        <Kpi loading={!data} label="Active consignments" icon={Truck}
          value={data ? num(data.activeShipments) : '—'}
          sub={data ? `${inr(data.inTransitValue)} in transit` : undefined}
          trend={trend.created} />
        <Kpi loading={!data} label="On-time delivery" icon={SignalIcon}
          tone={data && data.onTimePct >= 85 ? 'ok' : 'warn'}
          value={data ? `${data.onTimePct}%` : '—'}
          sub={data ? `avg delay ${data.avgDelayHrs}h` : undefined}
          trend={trend.onTime} />
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.45fr_1fr]">
        {/* Hero — the worklist */}
        <Card className="overflow-hidden">
          <CardHead
            title="Decisions queue"
            sub="Cross-system signals no single ministry API can produce — assign, action, close"
            right={
              <div className="flex items-center gap-1">
                {storeKind && (
                  <Badge tone={storeKind === 'server' ? 'ok' : 'warn'} dot className="mr-1">
                    {storeKind === 'server' ? 'shared queue' : 'this browser only'}
                  </Badge>
                )}
                {(['all', 'critical', 'high', 'medium'] as const).map((k) => (
                  <button key={k} onClick={() => setSev(k as Severity | 'all')}
                    className={cn('rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                      sev === k ? 'bg-surface-3 text-fg' : 'text-muted hover:text-fg')}>
                    {k === 'all' ? 'All' : titleCase(k)}
                  </button>
                ))}
              </div>
            }
          />
          <div className="flex gap-1 overflow-x-auto border-b border-line-soft px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {SCOPES.map(([k, label, n]) => (
              <button key={k} onClick={() => setScope(k)}
                className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors',
                  scope === k ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg')}>
                {label}
                {n !== undefined && <span className="tnum text-[10px] text-faint">{n}</span>}
              </button>
            ))}
          </div>
          <div className="max-h-[560px] divide-y divide-line-soft overflow-y-auto">
            {!cases && <TableSkeleton rows={6} cols={3} />}
            {cases && !cases.length && (
              <div className="px-4 py-14 text-center">
                <CheckCircle2 className="mx-auto mb-2 size-6 text-ok" />
                <p className="text-sm font-medium">
                  {scope === 'mine' ? 'Nothing assigned to you'
                    : scope === 'overdue' ? 'Nothing is overdue'
                    : scope === 'resolved' ? 'Nothing closed yet today'
                    : 'Queue is clear'}
                </p>
                <p className="mt-1 text-[13px] text-muted">
                  {scope === 'resolved'
                    ? 'Cases you resolve or dismiss will appear here.'
                    : 'No cross-system conflicts waiting at this filter.'}
                </p>
              </div>
            )}
            {(cases ?? []).slice(0, 40).map((c) => (
              <CaseRow key={c.signalId} c={c} actor={actor}
                onOpen={() => setOpenCase(c.signalId)} onChanged={bump} />
            ))}
          </div>
        </Card>

        <div className="space-y-3">
          <Card className="overflow-hidden">
            <CardHead title="Live network" sub="Coloured by risk, not just position"
              right={
                <div className="flex items-center gap-2.5 text-[10px] text-muted">
                  {[['ok', 'Clear'], ['warn', 'High'], ['bad', 'Critical']].map(([t, l]) => (
                    <span key={t} className="flex items-center gap-1">
                      <span className="size-2 rounded-full" style={{ background: `var(--c-${t})` }} />{l}
                    </span>
                  ))}
                </div>
              } />
            <NetworkMap markers={markers} className="h-[clamp(240px,42vw,330px)] w-full p-2" />
          </Card>

          <Card>
            <CardHead title="What is driving risk"
              sub="Which cross-system checks are firing, network-wide" />
            {allLive && (
              <div className="flex items-center gap-4 border-b border-line-soft p-3">
                <Donut size={78} thickness={10}
                  centre={String(allLive.length)} centreSub="live"
                  segments={[
                    { label: 'critical', value: severityMix.critical, tone: 'bad' },
                    { label: 'high', value: severityMix.high, tone: 'warn' },
                    { label: 'medium', value: severityMix.medium, tone: 'info' },
                  ]} />
                <div className="min-w-0 flex-1 space-y-1">
                  {([['critical', severityMix.critical, 'bg-bad'],
                     ['high', severityMix.high, 'bg-warn'],
                     ['medium', severityMix.medium, 'bg-accent']] as const).map(([k, n, dot]) => (
                    <button key={k} onClick={() => { setSev(k as Severity); setScope('live') }}
                      className="flex w-full items-center gap-2 text-left text-[12px] hover:text-fg">
                      <span className={cn('size-2 shrink-0 rounded-full', dot)} />
                      <span className="flex-1 capitalize text-muted">{k}</span>
                      <span className="tnum font-medium">{n}</span>
                    </button>
                  ))}
                </div>
                <Radial size={52} value={data?.dataConfidence ?? 0} sublabel="conf"
                  tone={(data?.dataConfidence ?? 0) >= 75 ? 'ok' : (data?.dataConfidence ?? 0) >= 50 ? 'warn' : 'bad'} />
              </div>
            )}
            <div className="space-y-2 p-3">
              {!allLive && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-5" />)}
              {mix.map((m) => (
                <button key={m.kind} onClick={() => { setSev(m.worst); setScope('live') }}
                  className="flex w-full items-center gap-3 text-left">
                  <span className="w-[9.75rem] shrink-0 truncate text-[12px]">{m.label}</span>
                  <Meter value={m.pct} tone={SEV_TONE[m.worst] === 'bad' ? 'bad'
                    : SEV_TONE[m.worst] === 'warn' ? 'warn' : 'info'} className="flex-1" />
                  <span className="tnum w-6 shrink-0 text-right text-[12px] font-medium">{m.count}</span>
                </button>
              ))}
              {allLive && !mix.length && (
                <p className="py-6 text-center text-[13px] text-muted">No signals firing.</p>
              )}
            </div>
          </Card>

          {/* Who is carrying the queue */}
          <Card>
            <CardHead title="Desk load" sub="Live cases by owner" />
            <div className="divide-y divide-line-soft">
              {TEAM.map((m) => {
                const owned = (allLive ?? []).filter((c) => c.assignee === m.id)
                const late = owned.filter((c) => isOverdue(c)).length
                return (
                  <button key={m.id} onClick={() => { setScope('mine'); }}
                    disabled={m.id !== actor}
                    className={cn('flex w-full items-center gap-2.5 px-3.5 py-2 text-left',
                      m.id === actor && 'hover:bg-surface-2/50')}>
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-3 text-[9px] font-semibold">
                      {m.initials}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium">
                        {m.name}{m.id === actor && <span className="ml-1 text-faint">· you</span>}
                      </span>
                      <span className="block text-[10px] text-faint">{m.role}</span>
                    </span>
                    {late > 0 && <Badge tone="bad">{late} late</Badge>}
                    <span className="tnum w-6 text-right text-[13px] font-semibold">{owned.length}</span>
                  </button>
                )
              })}
              <div className="flex items-center gap-2.5 px-3.5 py-2">
                <span className="grid size-6 shrink-0 place-items-center rounded-full border border-dashed border-line text-faint">
                  <UserRoundPlus className="size-3" />
                </span>
                <span className="flex-1 text-[12px] text-muted">Unassigned</span>
                <span className="tnum w-6 text-right text-[13px] font-semibold">
                  {(allLive ?? []).filter((c) => !c.assignee).length}
                </span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHead title="Lane performance" sub="Volume, reliability and median transit"
            right={<Link to="/shipments"><Button size="sm" variant="ghost">Consignments <ArrowUpRight className="size-3.5" /></Button></Link>} />
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-line-soft">
                <Th>Lane</Th><Th className="text-right">Loads</Th>
                <Th className="text-right">On time</Th><Th className="text-right">Transit</Th>
              </tr></thead>
              <tbody className="divide-y divide-line-soft">
                {(data?.topLanes ?? []).map((l) => (
                  <tr key={l.lane} className="hover:bg-surface-2/50">
                    <Td className="font-medium">{l.lane}</Td>
                    <Td className="tnum text-right">{l.count}</Td>
                    <Td className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Meter value={l.onTimePct} className="w-10"
                          tone={l.onTimePct >= 80 ? 'ok' : l.onTimePct >= 60 ? 'warn' : 'bad'} />
                        <span className="tnum w-8 text-right text-[12px]">{l.onTimePct}%</span>
                      </div>
                    </Td>
                    <Td className="tnum text-right text-muted">{l.avgHrs}h</Td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data && <TableSkeleton rows={5} cols={4} />}
          </div>
        </Card>

        <Card>
          <CardHead title="Source system health"
            sub="A decision is only as good as the systems behind it"
            right={<Link to="/apis"><Button size="sm" variant="ghost"><TrendingUp className="size-3.5" /></Button></Link>} />
          <div className="divide-y divide-line-soft">
            {(data?.sourceHealth ?? []).map((s) => (
              <div key={s.system} className="flex items-center gap-3 px-3.5 py-2">
                <span className="w-20 shrink-0 truncate font-mono text-[11px]">{s.system}</span>
                <Meter value={s.uptimePct} className="flex-1"
                  tone={s.uptimePct >= 98 ? 'ok' : s.uptimePct >= 95 ? 'warn' : 'bad'} />
                <span className="tnum w-11 text-right text-[11px] text-muted">{s.uptimePct}%</span>
                <span className="tnum w-12 text-right text-[11px] text-faint">
                  <Timer className="mr-0.5 inline size-3" />{s.latencyMs}
                </span>
              </div>
            ))}
            {!data && <TableSkeleton rows={6} cols={3} />}
          </div>
        </Card>
      </div>

      {/* Open-source layer: filtered news and AIS, both clearly labelled. */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHead
            title="Corridor disruption feed"
            sub="Open news, filtered to placeable logistics events and de-duplicated across outlets"
            right={feed && (
              <Badge tone={feed.live ? 'ok' : 'warn'} dot>
                {feed.live ? 'live · GDELT' : 'simulated feed'}
              </Badge>
            )}
          />
          <div className="max-h-[320px] divide-y divide-line-soft overflow-y-auto">
            {!feed && <TableSkeleton rows={4} cols={2} />}
            {feed && !feed.items.length && (
              <p className="px-4 py-10 text-center text-[13px] text-muted">
                Nothing on the network passed the relevance and geography filters.
              </p>
            )}
            {feed?.items.slice(0, 12).map((d) => (
              <div key={d.id} className="px-3.5 py-2.5">
                <div className="flex items-start gap-2.5">
                  <Badge tone={DISRUPTION_TONE[d.kind]} className="mt-0.5 shrink-0">{d.kind}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[12px] font-medium leading-snug">{d.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-faint">
                      <span className="font-medium text-muted">{d.placeLabel}</span>
                      <span>·</span>
                      <span>{rel(d.seenAt)}</span>
                      <span>·</span>
                      <span className={d.corroboration > 2 ? 'font-medium text-fg' : undefined}>
                        {d.corroboration} outlet{d.corroboration === 1 ? '' : 's'}
                      </span>
                      <span className="truncate">
                        {d.sources.slice(0, 3).map((x) => x.domain.replace(/^www\./, '').split('.')[0]).join(', ')}
                      </span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="tnum text-[13px] font-semibold">{d.score}</div>
                    <div className="text-[10px] text-faint">score</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {feed && !feed.live && (
            <p className="border-t border-line-soft px-3.5 py-2 text-[11px] text-faint">
              <Newspaper className="mr-1 inline size-3" />
              GDELT rate-limits per IP, so the live feed is served by the proxy.
              Start it to replace this sample.
            </p>
          )}
        </Card>

        <Card className="overflow-hidden">
          <CardHead
            title="Port traffic"
            sub="AIS positions rolled up into an anchorage queue per port"
            right={marine && (
              <Badge tone={marine.live ? 'ok' : 'warn'} dot>
                {marine.live ? 'live · AIS' : 'simulated AIS'}
              </Badge>
            )}
          />
          <div className="max-h-[320px] divide-y divide-line-soft overflow-y-auto">
            {!marine && <TableSkeleton rows={5} cols={4} />}
            {marine?.ports.filter((p) => p.vessels.length).map((p) => (
              <div key={p.code} className="flex items-center gap-3 px-3.5 py-2.5">
                <span className={cn('grid size-7 shrink-0 place-items-center rounded-lg border',
                  p.congestion === 'congested' ? 'border-bad/30 bg-bad-soft text-bad'
                    : p.congestion === 'building' ? 'border-warn/30 bg-warn-soft text-warn'
                    : 'border-ok/30 bg-ok-soft text-ok')}>
                  <Anchor className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium">{p.name}</div>
                  <div className="text-[10px] text-faint">
                    {p.inbound} inbound · {p.atAnchor} at anchor · {p.moored} moored
                  </div>
                </div>
                <Badge tone={p.congestion === 'congested' ? 'bad'
                  : p.congestion === 'building' ? 'warn' : 'ok'}>
                  {p.congestion}
                </Badge>
                <span className="tnum w-6 text-right text-[13px] font-semibold">{p.vessels.length}</span>
              </div>
            ))}
          </div>
          {marine && !marine.configured && (
            <p className="border-t border-line-soft px-3.5 py-2 text-[11px] text-faint">
              <Anchor className="mr-1 inline size-3" />
              aisstream.io forbids direct browser connections. Set AISSTREAM_API_KEY on
              the proxy to replace this with live traffic.
            </p>
          )}
        </Card>
      </div>

      <CaseDrawer signalId={openCase} actor={actor}
        onClose={() => setOpenCase(null)} onChanged={bump} />
    </div>
  )
}
