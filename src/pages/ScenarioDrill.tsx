import { useMemo, useState } from 'react'
import {
  AlertTriangle, Ban, CheckCircle2, CloudFog, FlaskConical,
  Play, Ship, TriangleAlert, Truck, Wallet,
} from 'lucide-react'
import { adapter } from '../data'
import { useAsync } from '../lib/useAsync'
import { dt, dur, inr, num } from '../lib/format'
import { NODES } from '../data/mock/seed'
import { PRESETS, type ScenarioKind, type ScenarioSpec } from '../data/scenarios'
import { CompareBars, Radial } from '../components/charts'
import {
  Badge, Card, CardHead, Field, Meter, Mono, Select, Skeleton,
} from '../components/ui'
import { cn } from '../lib/cn'

const KIND_ICON: Record<ScenarioKind, React.ComponentType<{ className?: string }>> = {
  grap: Ban, port_disruption: Ship, corridor_closure: TriangleAlert, weather_slowdown: CloudFog,
}

const STATES = [...new Set(NODES.map((n) => n.state))].sort()
const PORTS = NODES.filter((n) => n.kind === 'port')

function Head({ label, value, sub, tone, icon: Icon }: {
  label: string; value: string; sub?: string
  tone?: 'bad' | 'warn' | 'ok'
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <Card className={cn('p-3.5',
      tone === 'bad' && 'border-bad/30 bg-bad-soft/30',
      tone === 'warn' && 'border-warn/30 bg-warn-soft/25',
      tone === 'ok' && 'border-ok/30 bg-ok-soft/25')}>
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">
        <Icon className="size-3" />{label}
      </div>
      <div className="tnum mt-1 text-[24px] font-semibold leading-tight tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted">{sub}</div>}
    </Card>
  )
}

export function ScenarioDrill() {
  const [presetId, setPresetId] = useState(PRESETS[0].id)
  const [spec, setSpec] = useState<ScenarioSpec>(PRESETS[0].spec)

  const applyPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id)
    if (!p) return
    setPresetId(id)
    setSpec(p.spec)
  }
  const patch = (p: Partial<ScenarioSpec>) => { setPresetId('custom'); setSpec((s) => ({ ...s, ...p })) }

  const { data: result, loading } = useAsync(() => adapter.runScenario(spec), [JSON.stringify(spec)])

  const shareOfNetwork = result
    ? (result.affected.length / Math.max(1, result.baseline.activeShipments)) * 100
    : 0
  const shareOfValue = result
    ? (result.valueAtRisk / Math.max(1, result.baseline.activeValue)) * 100
    : 0

  const alreadyBreached = useMemo(
    () => (result?.affected ?? []).filter((s) => s.ewbAlreadyBreached).length, [result])

  return (
    <div className="space-y-3 p-3 sm:p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Scenario drill</h1>
          <p className="text-[13px] text-muted">
            Cost a disruption before it happens — against the network exactly as it stands now.
          </p>
        </div>
        <Badge tone="neutral"><FlaskConical className="size-3" />hypothetical · nothing is changed</Badge>
      </header>

      {/* Scenario picker */}
      <Card className="p-3">
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => {
            const Icon = KIND_ICON[p.spec.kind]
            return (
              <button key={p.id} onClick={() => applyPreset(p.id)}
                className={cn('inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors',
                  presetId === p.id
                    ? 'border-brand/45 bg-brand-soft text-brand'
                    : 'border-line hover:bg-surface-2')}>
                <Icon className="size-3.5" />{p.label}
              </button>
            )
          })}
        </div>

        <div className="mt-3 grid gap-2 border-t border-line-soft pt-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Event type">
            <Select value={spec.kind} onChange={(e) => patch({ kind: e.target.value as ScenarioKind })}>
              <option value="grap">GRAP entry curbs — Delhi NCR</option>
              <option value="port_disruption">Port shutdown</option>
              <option value="corridor_closure">Corridor closure</option>
              <option value="weather_slowdown">Fog / weather slowdown</option>
            </Select>
          </Field>

          {spec.kind === 'grap' && (
            <Field label="GRAP stage">
              <Select value={spec.grapStage ?? 4}
                onChange={(e) => patch({ grapStage: Number(e.target.value) as 3 | 4 })}>
                <option value={3}>Stage III — Severe</option>
                <option value={4}>Stage IV — Severe+</option>
              </Select>
            </Field>
          )}

          {spec.kind === 'port_disruption' && (
            <Field label="Port">
              <Select value={spec.node ?? 'NSA'} onChange={(e) => patch({ node: e.target.value })}>
                {PORTS.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
              </Select>
            </Field>
          )}

          {(spec.kind === 'corridor_closure' || spec.kind === 'weather_slowdown') && (
            <Field label="State">
              <Select value={spec.state ?? STATES[0]} onChange={(e) => patch({ state: e.target.value })}>
                {STATES.map((st) => <option key={st} value={st}>{st}</option>)}
              </Select>
            </Field>
          )}

          <Field label="Duration" hint="Hours of lost running added to affected legs">
            <Select value={spec.durationHours}
              onChange={(e) => patch({ durationHours: Number(e.target.value) })}>
              {[4, 8, 12, 24, 36, 48, 72].map((h) => <option key={h} value={h}>{h} hours</option>)}
            </Select>
          </Field>
        </div>
      </Card>

      {loading && !result ? (
        <div className="grid gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : result && (
        <>
          {/* Premise */}
          <Card className="p-3.5">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
                <Play className="size-4" />
              </span>
              <div>
                <h2 className="text-[14px] font-semibold">{result.title}</h2>
                <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{result.premise}</p>
              </div>
            </div>
          </Card>

          {/* Headline impact */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Head label="Consignments caught" icon={Truck}
              tone={result.affected.length ? 'bad' : 'ok'}
              value={num(result.affected.length)}
              sub={`${shareOfNetwork.toFixed(0)}% of ${num(result.baseline.activeShipments)} moving`} />
            <Head label="Value exposed" icon={Wallet}
              tone={result.valueAtRisk ? 'bad' : 'ok'}
              value={inr(result.valueAtRisk)}
              sub={`${shareOfValue.toFixed(0)}% of ${inr(result.baseline.activeValue)} in transit`} />
            <Head label="New e-Way Bill breaches" icon={AlertTriangle}
              tone={result.newEwbBreaches ? 'bad' : 'ok'}
              value={num(result.newEwbBreaches)}
              sub={alreadyBreached ? `${alreadyBreached} already lapsed regardless` : 'created by this delay alone'} />
            <Head label="Vehicles to swap" icon={Ban}
              tone={result.vehiclesToSwap.length > result.compliantSpare ? 'bad' : result.vehiclesToSwap.length ? 'warn' : 'ok'}
              value={num(result.vehiclesToSwap.length)}
              sub={`${result.compliantSpare} compliant units free`} />
          </div>

          <div className="grid gap-3 lg:grid-cols-[1fr_1.1fr]">
            {/* Actions */}
            <div className="space-y-3">
              <Card>
                <CardHead title="What to do about it" sub="Ranked by what closes first" />
                <div className="divide-y divide-line-soft">
                  {result.actions.map((a) => (
                    <div key={a.label} className="flex items-start gap-3 px-3.5 py-2.5">
                      <span className={cn('mt-0.5 grid size-6 shrink-0 place-items-center rounded-md',
                        a.tone === 'bad' ? 'bg-bad-soft text-bad'
                          : a.tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok')}>
                        {a.tone === 'ok' ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="text-[13px] font-medium">{a.label}</span>
                          {a.count > 0 && <span className="tnum text-[13px] font-semibold">{a.count}</span>}
                        </div>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{a.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Fleet cover */}
              {result.vehiclesToSwap.length > 0 && (
                <Card>
                  <CardHead title="Can the fleet absorb it?" sub="Compliant units free against units needing a swap" />
                  <div className="flex items-center gap-4 p-3">
                    <Radial
                      size={64}
                      value={Math.min(100, (result.compliantSpare / Math.max(1, result.vehiclesToSwap.length)) * 100)}
                      tone={result.compliantSpare >= result.vehiclesToSwap.length ? 'ok' : 'bad'}
                      label={result.compliantSpare >= result.vehiclesToSwap.length
                        ? 'Full'
                        : `${Math.round((result.compliantSpare / Math.max(1, result.vehiclesToSwap.length)) * 100)}%`}
                      sublabel="cover" />
                    <div className="min-w-0 flex-1">
                      <CompareBars
                        format={(n) => String(Math.round(n))}
                        rows={[
                          { label: 'Need', value: result.vehiclesToSwap.length, tone: 'bad' },
                          { label: 'Free', value: result.compliantSpare, tone: 'ok' },
                        ]} />
                      <p className="mt-2 text-[11px] leading-relaxed text-muted">
                        {result.compliantSpare >= result.vehiclesToSwap.length
                          ? 'Every affected load can be re-assigned from the existing fleet.'
                          : `Short by ${result.vehiclesToSwap.length - result.compliantSpare} units — the balance needs hiring in or holding.`}
                      </p>
                    </div>
                  </div>
                </Card>
              )}

              {result.byCarrier.length > 0 && (
                <Card>
                  <CardHead title="Exposure by carrier" sub="Who to call first" />
                  <div className="p-3">
                    <CompareBars
                      format={(n) => inr(n)}
                      rows={result.byCarrier.map((c, i) => ({
                        label: c.carrier.split(' ')[0],
                        value: c.value,
                        tone: i === 0 ? 'bad' : i < 3 ? 'warn' : 'info',
                        hint: `${c.count} loads`,
                      }))} />
                  </div>
                </Card>
              )}
            </div>

            {/* Affected list */}
            <Card className="overflow-hidden">
              <CardHead title="Consignments caught"
                sub={result.affected.length
                  ? 'Highest value first. ETA shift assumes the load holds for the event — swapping or re-routing recovers most of it.'
                  : undefined} />
              {!result.affected.length ? (
                <div className="px-4 py-14 text-center">
                  <CheckCircle2 className="mx-auto mb-2 size-6 text-ok" />
                  <p className="text-sm font-medium">No exposure to this scenario</p>
                  <p className="mt-1 text-[13px] text-muted">
                    Nothing currently moving would be caught.
                  </p>
                </div>
              ) : (
                <div className="max-h-[560px] divide-y divide-line-soft overflow-y-auto">
                  {result.affected.slice(0, 60).map((s) => (
                    <div key={s.id} className="flex items-start gap-3 px-3.5 py-2.5 hover:bg-surface-2/50">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[13px] font-medium">{s.id}</span>
                          {s.ewbBreached && <Badge tone="bad">e-Way Bill lapses</Badge>}
                          {s.vehicle && !s.vehicle.compliant && (
                            <Badge tone="warn">{s.vehicle.bsNorm} {s.vehicle.fuel}</Badge>
                          )}
                        </div>
                        <div className="truncate text-[11px] text-muted">{s.lane}</div>
                        <div className="line-clamp-1 text-[10px] text-faint">{s.reason}</div>
                      </div>
                      <div className="w-[5.5rem] shrink-0 text-right">
                        <div className="tnum text-[12px] font-medium text-bad">
                          +{dur(s.addedHours * 60)}
                        </div>
                        <div className="tnum text-[10px] text-faint">{dt(s.etaAfter)}</div>
                      </div>
                      <div className="tnum w-[4.5rem] shrink-0 text-right text-[13px] font-semibold">
                        {inr(s.value)}
                      </div>
                    </div>
                  ))}
                  {result.affected.length > 60 && (
                    <p className="border-t border-line-soft px-3.5 py-2 text-[11px] text-faint">
                      Showing the 60 highest-value of {num(result.affected.length)}.
                    </p>
                  )}
                </div>
              )}
            </Card>
          </div>

          {/* Share of network */}
          <Card className="p-3">
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-[11px] font-medium uppercase tracking-wide text-faint">
                Share of live network
              </span>
              <div className="flex min-w-[220px] flex-1 items-center gap-2">
                <span className="w-24 shrink-0 text-[11px] text-muted">Consignments</span>
                <Meter value={shareOfNetwork} tone={shareOfNetwork > 25 ? 'bad' : 'warn'} className="flex-1" />
                <span className="tnum w-10 text-right text-[12px] font-medium">{shareOfNetwork.toFixed(0)}%</span>
              </div>
              <div className="flex min-w-[220px] flex-1 items-center gap-2">
                <span className="w-24 shrink-0 text-[11px] text-muted">Value</span>
                <Meter value={shareOfValue} tone={shareOfValue > 25 ? 'bad' : 'warn'} className="flex-1" />
                <span className="tnum w-10 text-right text-[12px] font-medium">{shareOfValue.toFixed(0)}%</span>
              </div>
              <Mono className="text-faint">
                {spec.kind} · {spec.durationHours}h
              </Mono>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
