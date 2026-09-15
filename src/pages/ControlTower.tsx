import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowUpRight, CheckCircle2, ChevronRight, CircleDollarSign, Clock,
  Gauge, Layers, ShieldAlert, Signal as SignalIcon, Timer, TrendingUp, Truck,
} from 'lucide-react'
import { adapter } from '../data'
import { useAsync } from '../lib/useAsync'
import { inr, num, titleCase } from '../lib/format'
import { NetworkMap, type MapMarker } from '../components/NetworkMap'
import {
  Badge, Button, Card, CardHead, Meter, Mono, Skeleton, TableSkeleton, Td, Th,
} from '../components/ui'
import type { Severity, Signal } from '../data/fusion'
import { cn } from '../lib/cn'

const SEV_TONE: Record<Severity, 'bad' | 'warn' | 'info'> = {
  critical: 'bad', high: 'warn', medium: 'info',
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

/** Provenance: which government systems produced this conclusion. */
function Sources({ ids }: { ids: string[] }) {
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

function Kpi({ label, value, sub, icon: Icon, tone = 'neutral', loading, accent }: {
  label: string; value: string; sub?: string
  icon: React.ComponentType<{ className?: string }>
  tone?: 'ok' | 'warn' | 'bad' | 'neutral'; loading?: boolean; accent?: boolean
}) {
  const ring = {
    ok: 'text-ok bg-ok-soft', warn: 'text-warn bg-warn-soft',
    bad: 'text-bad bg-bad-soft', neutral: 'text-muted bg-surface-2',
  }[tone]
  return (
    <Card className={cn('p-3.5', accent && 'border-bad/30 bg-bad-soft/25')}>
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
    </Card>
  )
}

/* ── The hero: a ranked queue of decisions, not a list of charts ── */

function DecisionRow({ s }: { s: Signal }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="px-3.5 py-3 transition-colors hover:bg-surface-2/40">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-3 text-left">
        <Badge tone={SEV_TONE[s.severity]} dot className="mt-0.5 shrink-0">{s.severity}</Badge>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-[13px] font-medium">{s.title}</span>
            <Mono className="text-faint">{s.entity}</Mono>
          </div>
          <p className={cn('mt-1 text-[12px] leading-relaxed text-muted', !open && 'line-clamp-1')}>
            {s.detail}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Sources ids={s.sources} />
            {s.hoursToAct !== null && (
              <span className={cn('text-[10px] font-medium',
                s.hoursToAct <= 0 ? 'text-bad' : s.hoursToAct < 12 ? 'text-warn' : 'text-faint')}>
                <Timer className="mr-0.5 inline size-3" />
                {s.hoursToAct <= 0 ? 'window closed' : `${Math.round(s.hoursToAct)}h to act`}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="tnum text-[13px] font-semibold">{inr(s.valueAtRisk)}</div>
          <div className="text-[10px] text-faint">at risk</div>
        </div>
        <ChevronRight className={cn('mt-1 size-4 shrink-0 text-faint transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="ml-[4.25rem] mt-2 rounded-lg border border-line bg-surface-2 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">Recommended action</div>
          <p className="mt-0.5 text-[12px] leading-relaxed">{s.action}</p>
        </div>
      )}
    </div>
  )
}

/* ── Page ─────────────────────────────────────────────────────── */

export function ControlTower() {
  const { data } = useAsync(() => adapter.dashboard(), [])
  const { data: live } = useAsync(() => adapter.liveMap(), [])
  const { data: signals } = useAsync(() => adapter.signals(), [])
  const [sev, setSev] = useState<Severity | 'all'>('all')

  const queue = useMemo(
    () => (signals ?? []).filter((s) => sev === 'all' || s.severity === sev),
    [signals, sev])

  /** Risk per consignment, so the map shows exposure rather than mere position. */
  const riskByEntity = useMemo(() => {
    const m = new Map<string, Severity>()
    for (const s of signals ?? []) {
      const cur = m.get(s.entity)
      if (!cur || (s.severity === 'critical') || (s.severity === 'high' && cur === 'medium')) {
        m.set(s.entity, s.severity)
      }
    }
    return m
  }, [signals])

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
    for (const s of signals ?? []) {
      const cur = m.get(s.kind)
      m.set(s.kind, {
        count: (cur?.count ?? 0) + 1,
        worst: !cur || rank[s.severity] < rank[cur.worst] ? s.severity : cur.worst,
      })
    }
    const rows = [...m.entries()]
      .map(([kind, v]) => ({ kind, label: KIND_LABEL[kind] ?? titleCase(kind), ...v }))
      .sort((a, b) => b.count - a.count)
    const max = Math.max(1, ...rows.map((r) => r.count))
    return rows.slice(0, 9).map((r) => ({ ...r, pct: (r.count / max) * 100 }))
  }, [signals])

  const counts = useMemo(() => ({
    all: signals?.length ?? 0,
    critical: (signals ?? []).filter((s) => s.severity === 'critical').length,
    high: (signals ?? []).filter((s) => s.severity === 'high').length,
    medium: (signals ?? []).filter((s) => s.severity === 'medium').length,
  }), [signals])

  return (
    <div className="space-y-4 p-3 sm:p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Control tower</h1>
          <p className="text-[13px] text-muted">
            Every source system joined into one picture — what needs a decision, and why.
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
          sub={data ? `${data.criticalSignals} critical signals` : undefined} />
        <Kpi loading={!data} label="Needs a decision" icon={ShieldAlert}
          tone={counts.critical ? 'bad' : 'warn'}
          value={num(counts.critical + counts.high)} sub="critical + high, unresolved" />
        <Kpi loading={!data} label="Active consignments" icon={Truck}
          value={data ? num(data.activeShipments) : '—'}
          sub={data ? `${inr(data.inTransitValue)} in transit` : undefined} />
        <Kpi loading={!data} label="On-time delivery" icon={CheckCircle2}
          tone={data && data.onTimePct >= 85 ? 'ok' : 'warn'}
          value={data ? `${data.onTimePct}%` : '—'} sub="rolling, delivered" />
        <Kpi loading={!data} label="Avg delay" icon={Clock}
          tone={data && data.avgDelayHrs > 8 ? 'bad' : 'warn'}
          value={data ? `${data.avgDelayHrs}h` : '—'} sub="on delayed legs" />
        <Kpi loading={!data} label="Fleet active" icon={SignalIcon} tone="ok"
          value={data ? `${data.fleetActive}/${data.fleetTotal}` : '—'}
          sub={data ? `${data.utilisationPct}% utilisation` : undefined} />
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.45fr_1fr]">
        {/* Hero — the decision queue */}
        <Card className="overflow-hidden">
          <CardHead
            title="Decisions queue"
            sub="Cross-system signals no single ministry API can produce, ranked by exposure"
            right={
              <div className="flex gap-1">
                {([['all', counts.all], ['critical', counts.critical], ['high', counts.high], ['medium', counts.medium]] as const)
                  .map(([k, n]) => (
                    <button key={k} onClick={() => setSev(k as Severity | 'all')}
                      className={cn('rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                        sev === k ? 'bg-surface-3 text-fg' : 'text-muted hover:text-fg')}>
                      {k === 'all' ? 'All' : titleCase(k)} <span className="tnum text-faint">{n}</span>
                    </button>
                  ))}
              </div>
            }
          />
          <div className="max-h-[560px] divide-y divide-line-soft overflow-y-auto">
            {!signals && <TableSkeleton rows={6} cols={3} />}
            {signals && !queue.length && (
              <div className="px-4 py-14 text-center">
                <CheckCircle2 className="mx-auto mb-2 size-6 text-ok" />
                <p className="text-sm font-medium">Nothing at this severity</p>
                <p className="mt-1 text-[13px] text-muted">No cross-system conflicts in the network right now.</p>
              </div>
            )}
            {queue.slice(0, 40).map((s) => <DecisionRow key={s.id} s={s} />)}
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
            <div className="space-y-2 p-3">
              {!signals && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-5" />)}
              {mix.map((m) => (
                <button key={m.kind} onClick={() => setSev(m.worst)}
                  className="flex w-full items-center gap-3 text-left">
                  <span className="w-[9.75rem] shrink-0 truncate text-[12px]">{m.label}</span>
                  <Meter value={m.pct} tone={SEV_TONE[m.worst] === 'bad' ? 'bad'
                    : SEV_TONE[m.worst] === 'warn' ? 'warn' : 'info'} className="flex-1" />
                  <span className="tnum w-6 shrink-0 text-right text-[12px] font-medium">{m.count}</span>
                </button>
              ))}
              {signals && !mix.length && (
                <p className="py-6 text-center text-[13px] text-muted">No signals firing.</p>
              )}
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
    </div>
  )
}
