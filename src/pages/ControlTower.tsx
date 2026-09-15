import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  AlertTriangle, ArrowUpRight, CheckCircle2, Clock, FileWarning,
  Leaf, Radio, Timer, TrendingUp, Truck,
} from 'lucide-react'
import { adapter } from '../data'
import { useAsync } from '../lib/useAsync'
import { compact, dur, inr, num, rel, titleCase } from '../lib/format'
import { NetworkMap, type MapMarker, type MapRoute } from '../components/NetworkMap'
import { Badge, Button, Card, CardHead, Meter, Skeleton, TableSkeleton, Td, Th } from '../components/ui'
import type { Exception } from '../data/types'
import { cn } from '../lib/cn'

/* ── KPI tile ─────────────────────────────────────────────────── */

function Kpi({ label, value, sub, icon: Icon, tone = 'neutral', loading }: {
  label: string; value: string; sub?: string
  icon: React.ComponentType<{ className?: string }>
  tone?: 'ok' | 'warn' | 'bad' | 'neutral'; loading?: boolean
}) {
  const ring = {
    ok: 'text-ok bg-ok-soft', warn: 'text-warn bg-warn-soft',
    bad: 'text-bad bg-bad-soft', neutral: 'text-muted bg-surface-2',
  }[tone]
  return (
    <Card className="p-3.5">
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

const chartAxis = {
  stroke: 'var(--c-faint)', fontSize: 10,
  tickLine: false, axisLine: false,
}

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-line bg-surface px-2.5 py-2 text-[11px] shadow-[var(--shadow-pop)]">
      <div className="mb-1 font-medium">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="size-2 rounded-sm" style={{ background: p.color }} />
          <span className="text-muted">{titleCase(String(p.dataKey))}</span>
          <span className="tnum ml-auto font-medium">{num(p.value, 0)}</span>
        </div>
      ))}
    </div>
  )
}

/* ── Page ─────────────────────────────────────────────────────── */

export function ControlTower() {
  const { data, loading } = useAsync(() => adapter.dashboard(), [])
  const { data: live } = useAsync(() => adapter.liveMap(), [])
  const { data: exceptions, refresh } = useAsync(() => adapter.listExceptions(), [])
  const [acking, setAcking] = useState<string | null>(null)

  const markers: MapMarker[] = useMemo(() =>
    (live ?? []).slice(0, 70).map((s) => ({
      id: s.id, lat: s.lat, lon: s.lon,
      tone: s.status === 'exception' || s.delayMins > 600 ? 'bad'
        : s.delayMins > 120 ? 'warn'
        : s.status === 'delivered' ? 'ok' : 'info',
      pulse: s.status === 'in_transit' && s.delayMins <= 120,
      r: 3.4,
      label: `${s.id} · ${titleCase(s.status)}${s.delayMins > 30 ? ` · ${dur(s.delayMins)} late` : ''}`,
    })), [live])

  const routes: MapRoute[] = useMemo(() =>
    (live ?? []).slice(0, 26).map((s) => ({
      from: s.origin, to: s.destination, mode: 'road' as const,
      active: s.progress > 0 && s.progress < 1,
    })), [live])

  const open = (exceptions ?? []).filter((e) => !e.ack)

  const ack = async (e: Exception) => {
    setAcking(e.id)
    await adapter.acknowledgeException(e.id)
    await refresh()
    setAcking(null)
  }

  return (
    <div className="space-y-4 p-3 sm:p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Control tower</h1>
          <p className="text-[13px] text-muted">
            Network-wide position across road, rail, sea and air.
          </p>
        </div>
        <Badge tone="ok" dot>Streaming · updated {rel(new Date(Date.now() - 42_000).toISOString())}</Badge>
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Kpi loading={loading} label="Active consignments" icon={Truck}
          value={data ? num(data.activeShipments) : '—'}
          sub={data ? `${inr(data.inTransitValue)} in transit` : undefined} />
        <Kpi loading={loading} label="On-time delivery" icon={CheckCircle2}
          tone={data && data.onTimePct >= 85 ? 'ok' : 'warn'}
          value={data ? `${data.onTimePct}%` : '—'} sub="rolling, delivered" />
        <Kpi loading={loading} label="Avg delay" icon={Clock}
          tone={data && data.avgDelayHrs > 8 ? 'bad' : 'warn'}
          value={data ? `${data.avgDelayHrs}h` : '—'} sub="on delayed legs" />
        <Kpi loading={loading} label="Open exceptions" icon={AlertTriangle}
          tone={open.length > 20 ? 'bad' : 'warn'}
          value={data ? num(open.length) : '—'} sub="unacknowledged" />
        <Kpi loading={loading} label="Fleet active" icon={Radio} tone="ok"
          value={data ? `${data.fleetActive}/${data.fleetTotal}` : '—'}
          sub={data ? `${data.utilisationPct}% utilisation` : undefined} />
        <Kpi loading={loading} label="Doc compliance" icon={FileWarning}
          tone={data && data.docCompliancePct >= 97 ? 'ok' : 'warn'}
          value={data ? `${data.docCompliancePct}%` : '—'}
          sub={data ? `${data.docsExpiring} expiring soon` : undefined} />
        <Kpi loading={loading} label="CO₂e this cycle" icon={Leaf}
          value={data ? `${compact(data.co2Tonnes)} t` : '—'} sub="IIMB factors" />
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.35fr_1fr]">
        {/* Map */}
        <Card className="overflow-hidden">
          <CardHead
            title="Live network"
            sub={`${markers.length} consignments plotted · node positions are true coordinates`}
            right={
              <div className="flex items-center gap-2.5 text-[10px] text-muted">
                {[['ok', 'On time'], ['warn', 'At risk'], ['bad', 'Exception']].map(([t, l]) => (
                  <span key={t} className="flex items-center gap-1">
                    <span className="size-2 rounded-full" style={{ background: `var(--c-${t})` }} />{l}
                  </span>
                ))}
              </div>
            }
          />
          <NetworkMap routes={routes} markers={markers} className="h-[clamp(260px,52vw,430px)] w-full p-2" />
        </Card>

        <div className="space-y-3">
          {/* Volume */}
          <Card>
            <CardHead title="Consignment volume" sub="Created vs delivered, last 30 days" />
            <div className="h-[168px] p-2">
              {data ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.daily} margin={{ top: 6, right: 6, left: -22, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gCreated" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--c-accent)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--c-accent)" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="gDelivered" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--c-ok)" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="var(--c-ok)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--c-grid)" vertical={false} />
                    <XAxis dataKey="label" {...chartAxis} interval={6} />
                    <YAxis {...chartAxis} width={38} />
                    <Tooltip content={<ChartTip />} />
                    <Area dataKey="created" stroke="var(--c-accent)" strokeWidth={1.6} fill="url(#gCreated)" />
                    <Area dataKey="delivered" stroke="var(--c-ok)" strokeWidth={1.6} fill="url(#gDelivered)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <Skeleton className="h-full w-full" />}
            </div>
          </Card>

          {/* Modal split */}
          <Card>
            <CardHead title="Modal split" sub="Tonne-km by mode" />
            <div className="h-[150px] p-2">
              {data ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.modal} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                    <CartesianGrid stroke="var(--c-grid)" vertical={false} />
                    <XAxis dataKey="label" {...chartAxis} />
                    <YAxis {...chartAxis} width={38} tickFormatter={(v) => compact(v as number)} />
                    <Tooltip content={<ChartTip />} cursor={{ fill: 'var(--c-surface-2)' }} />
                    <Bar dataKey="tonneKm" radius={[4, 4, 0, 0]}>
                      {data.modal.map((m) => (
                        <Cell key={m.key} fill={
                          m.key === 'road' ? 'var(--c-brand)'
                          : m.key === 'rail' ? 'var(--c-accent)'
                          : m.key === 'sea' ? 'var(--c-info)' : 'var(--c-warn)'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : <Skeleton className="h-full w-full" />}
            </div>
          </Card>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_1fr_0.9fr]">
        {/* Exceptions */}
        <Card className="lg:col-span-1">
          <CardHead title="Exception queue" sub={`${open.length} awaiting action`}
            right={<Link to="/shipments"><Button size="sm" variant="ghost">All <ArrowUpRight className="size-3.5" /></Button></Link>} />
          <div className="max-h-[300px] divide-y divide-line-soft overflow-y-auto">
            {!exceptions && <TableSkeleton rows={4} cols={2} />}
            {open.slice(0, 12).map((e) => (
              <div key={e.id} className="flex items-start gap-2.5 px-3.5 py-2.5">
                <Badge tone={e.severity === 'high' ? 'bad' : e.severity === 'medium' ? 'warn' : 'neutral'}>
                  {titleCase(e.type)}
                </Badge>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-medium">{e.entity}</div>
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted">{e.note}</p>
                  <div className="mt-1 text-[10px] text-faint">{rel(e.raisedAt)}</div>
                </div>
                <Button size="sm" variant="ghost" disabled={acking === e.id} onClick={() => ack(e)}>
                  {acking === e.id ? '…' : 'Ack'}
                </Button>
              </div>
            ))}
            {exceptions && !open.length && (
              <div className="px-4 py-10 text-center text-[13px] text-muted">
                Queue clear — nothing needs attention.
              </div>
            )}
          </div>
        </Card>

        {/* Lanes */}
        <Card>
          <CardHead title="Busiest lanes" sub="Volume, reliability and median transit" />
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
                        <Meter value={l.onTimePct} tone={l.onTimePct >= 80 ? 'ok' : l.onTimePct >= 60 ? 'warn' : 'bad'} className="w-10" />
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

        {/* Source health */}
        <Card>
          <CardHead title="Source system health" sub="Per-ministry gateway reliability"
            right={<Link to="/apis"><Button size="sm" variant="ghost"><TrendingUp className="size-3.5" /></Button></Link>} />
          <div className="divide-y divide-line-soft">
            {(data?.sourceHealth ?? []).map((s) => (
              <div key={s.system} className="flex items-center gap-3 px-3.5 py-2">
                <span className="w-20 shrink-0 truncate font-mono text-[11px]">{s.system}</span>
                <Meter value={s.uptimePct} tone={s.uptimePct >= 98 ? 'ok' : s.uptimePct >= 95 ? 'warn' : 'bad'} className="flex-1" />
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
