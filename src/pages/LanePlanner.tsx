import { useMemo, useState } from 'react'
import {
  AlertTriangle, BatteryCharging, Ban, Fuel, Plane, Route,
  Ship, Train, Truck, Wallet,
} from 'lucide-react'
import { adapter } from '../data'
import { useAsync } from '../lib/useAsync'
import { compact, dur, inr, num } from '../lib/format'
import { NODES } from '../data/mock/seed'
import { minsToClock } from '../data/routes'
import { NetworkMap, type MapMarker, type MapRoute } from '../components/NetworkMap'
import { CompareBars, DayBand, Donut, Radial } from '../components/charts'
import {
  Badge, Button, Card, CardHead, Field, Meter, Mono, Select, Skeleton,
} from '../components/ui'
import { Sources } from '../components/cases'
import type { Mode } from '../data/types'
import { cn } from '../lib/cn'

const MODE_ICON: Record<Mode, React.ComponentType<{ className?: string }>> = {
  road: Truck, rail: Train, sea: Ship, air: Plane,
}
const MODE_TONE: Record<Mode, 'brand' | 'info' | 'ok' | 'warn'> = {
  road: 'brand', rail: 'info', sea: 'ok', air: 'warn',
}

const VEHICLE_CLASSES = [
  'HGV — 4 Axle', 'MGV — 3 Axle', 'HGV — 6 Axle', 'LGV — 2 Axle', 'Trailer — 40ft',
]

/** Local datetime string for an <input type="datetime-local">. */
function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function Stat({ label, value, sub, icon: Icon, tone }: {
  label: string; value: string; sub?: string
  icon: React.ComponentType<{ className?: string }>
  tone?: 'ok' | 'warn' | 'bad'
}) {
  return (
    <div className="rounded-lg border border-line bg-surface-2/60 p-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-faint">
        <Icon className="size-3" />{label}
      </div>
      <div className={cn('tnum mt-1 text-[17px] font-semibold tracking-tight',
        tone === 'bad' && 'text-bad', tone === 'warn' && 'text-warn', tone === 'ok' && 'text-ok')}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[10px] text-muted">{sub}</div>}
    </div>
  )
}

export function LanePlanner() {
  const [origin, setOrigin] = useState('DEL')
  const [destination, setDestination] = useState('BOM')
  const [vehicleClass, setVehicleClass] = useState(VEHICLE_CLASSES[0])
  const [weightKg, setWeightKg] = useState(18000)
  const [departLocal, setDepartLocal] = useState(() => toLocalInput(new Date(Date.now() + 3600_000)))

  const departAt = useMemo(() => new Date(departLocal), [departLocal])

  const { data: plan, loading } = useAsync(
    () => adapter.planLane(origin, destination, { weightKg, departAt, vehicleClass }),
    [origin, destination, weightKg, departAt.getTime(), vehicleClass])

  const arriveMin = plan
    ? new Date(plan.arriveAt).getHours() * 60 + new Date(plan.arriveAt).getMinutes()
    : undefined

  const markers: MapMarker[] = useMemo(() => {
    if (!plan) return []
    return [
      ...plan.blackSpots.map((b) => ({
        id: b.id, lat: b.lat, lon: b.lon,
        tone: (b.severity === 'high' ? 'bad' : 'warn') as MapMarker['tone'],
        glyph: 'hazard' as const,
        label: `${b.location} · ${b.roadName}, ${b.district}`,
      })),
      ...plan.tolls.map((t) => ({
        id: t.code, lat: t.lat, lon: t.lon, tone: 'info' as const,
        glyph: 'toll' as const, label: `${t.name} · ${inr(t.rate, false)}`,
      })),
      ...plan.energy.map((e) => ({
        id: e.id, lat: e.lat, lon: e.lon, tone: 'ok' as const,
        glyph: e.kind as 'fuel' | 'ev', label: `${e.name} · ${e.atKm} km`,
      })),
    ]
  }, [plan])

  const routes: MapRoute[] = plan
    ? [{ from: plan.origin.code, to: plan.destination.code, mode: plan.recommended, active: true }]
    : []

  const feasible = (plan?.modal ?? []).filter((m) => m.feasible)
  const best = plan?.modal.find((m) => m.mode === plan.recommended)
  const road = plan?.modal.find((m) => m.mode === 'road')
  const co2Saving = best && road ? road.co2Kg - best.co2Kg : 0
  const costSaving = best && road ? road.costInr - best.costInr : 0

  return (
    <div className="space-y-3 p-3 sm:p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Lane planner</h1>
          <p className="text-[13px] text-muted">
            Plan a corridor before you book it — safety, city restrictions, cost and the modal trade-off.
          </p>
        </div>
        {plan && <Sources ids={plan.sources} />}
      </header>

      {/* Inputs */}
      <Card className="p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Origin">
            <Select value={origin} onChange={(e) => setOrigin(e.target.value)}>
              {NODES.map((n) => <option key={n.code} value={n.code}>{n.name}</option>)}
            </Select>
          </Field>
          <Field label="Destination">
            <Select value={destination} onChange={(e) => setDestination(e.target.value)}>
              {NODES.map((n) => <option key={n.code} value={n.code}>{n.name}</option>)}
            </Select>
          </Field>
          <Field label="Vehicle class">
            <Select value={vehicleClass} onChange={(e) => setVehicleClass(e.target.value)}>
              {VEHICLE_CLASSES.map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Payload">
            <Select value={weightKg} onChange={(e) => setWeightKg(Number(e.target.value))}>
              {[6000, 12000, 18000, 24000, 32000].map((w) =>
                <option key={w} value={w}>{(w / 1000).toFixed(0)} tonnes</option>)}
            </Select>
          </Field>
          <Field label="Departure">
            <input type="datetime-local" value={departLocal}
              onChange={(e) => setDepartLocal(e.target.value)}
              className="h-9 w-full rounded-lg border border-line bg-surface px-3 text-[13px] text-fg focus:border-brand/60 focus:outline-none focus:ring-2 focus:ring-brand/20" />
          </Field>
        </div>
      </Card>

      {loading && !plan ? (
        <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr]">
          <Skeleton className="h-[420px]" /><Skeleton className="h-[420px]" />
        </div>
      ) : plan && (
        <>
          {/* The headline: does arrival land inside a closed window? */}
          {plan.conflict ? (
            <Card className="border-bad/35 bg-bad-soft/40 p-3.5">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-bad/15 text-bad">
                  <Ban className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[14px] font-semibold text-bad">
                    Arrival lands inside a no-entry window
                  </h3>
                  <p className="mt-1 text-[13px] leading-relaxed">
                    Projected arrival is <strong>{minsToClock(arriveMin!)}</strong>, but goods vehicles
                    are barred from {plan.destination.name} between{' '}
                    <strong>{plan.conflict.window.noEntryTime}</strong> at{' '}
                    {plan.conflict.window.areaName}.
                  </p>
                  <p className="mt-1.5 text-[13px]">
                    {plan.conflict.advice === 'hold' ? (
                      <>
                        Cheapest fix is to <strong>hold {dur(plan.conflict.waitMins)}</strong> and enter
                        at {minsToClock(plan.conflict.window.toMin)} — re-timing dispatch would cost{' '}
                        {dur(plan.conflict.departEarlierMins)}.
                      </>
                    ) : (
                      <>
                        Depart <strong>{dur(plan.conflict.departEarlierMins)} earlier</strong> to arrive
                        before {minsToClock(plan.conflict.window.fromMin)} — waiting it out would cost{' '}
                        {dur(plan.conflict.waitMins)} at the boundary.
                      </>
                    )}
                  </p>
                  <div className="mt-3">
                    <DayBand
                      windows={plan.noEntry.map((w) => ({ fromMin: w.fromMin, toMin: w.toMin, label: w.areaName }))}
                      markerMin={arriveMin}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Sources ids={['NOENTRY/01', 'FASTAG/01']} />
                    {plan.conflict.advice === 'depart_earlier' && (
                      <Button size="sm" variant="outline" className="ml-auto"
                        onClick={() => setDepartLocal(toLocalInput(
                          new Date(departAt.getTime() - plan.conflict!.departEarlierMins * 60_000)))}>
                        Shift departure earlier
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ) : (
            <Card className="border-ok/30 bg-ok-soft/30 p-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-ok/15 text-ok">
                  <Route className="size-3.5" />
                </span>
                <p className="text-[13px]">
                  Arrival at <strong>{minsToClock(arriveMin!)}</strong> clears every goods-vehicle
                  restriction recorded for {plan.destination.name}.
                </p>
                <div className="ml-auto w-full max-w-xs sm:w-56">
                  <DayBand
                    windows={plan.noEntry.map((w) => ({ fromMin: w.fromMin, toMin: w.toMin, label: w.areaName }))}
                    markerMin={arriveMin}
                  />
                </div>
              </div>
            </Card>
          )}

          <div className="grid gap-3 lg:grid-cols-[1.05fr_1fr]">
            {/* Corridor */}
            <Card className="overflow-hidden">
              <CardHead
                title={`${plan.origin.name} → ${plan.destination.name}`}
                sub={`${num(plan.distanceKm)} km by road · ${plan.driveHours}h driving`}
                right={
                  <div className="flex items-center gap-2 text-[10px] text-muted">
                    <span className="flex items-center gap-1"><AlertTriangle className="size-3 text-bad" />Black spot</span>
                    <span className="flex items-center gap-1"><Wallet className="size-3 text-accent" />Toll</span>
                    <span className="flex items-center gap-1"><Fuel className="size-3 text-ok" />Energy</span>
                  </div>
                }
              />
              <NetworkMap routes={routes} markers={markers} showLabels={false}
                highlight={[plan.origin.code, plan.destination.code]}
                className="h-[clamp(240px,44vw,330px)] w-full p-2" />
              <div className="grid grid-cols-2 gap-2 border-t border-line-soft p-3 sm:grid-cols-4">
                <Stat label="Toll" value={inr(plan.tollCost, false)} icon={Wallet}
                  sub={`${plan.tolls.length} plazas`} />
                <Stat label="Fuel" value={inr(plan.fuelCost)} icon={Fuel} sub="at ₹94/l, 3.2 km/l" />
                <Stat label="Black spots" value={String(plan.blackSpots.length)} icon={AlertTriangle}
                  tone={plan.blackSpots.some((b) => b.severity === 'high') ? 'bad' : 'warn'}
                  sub={`${plan.blackSpots.filter((b) => b.severity === 'high').length} high severity`} />
                <Stat label="Energy stops" value={String(plan.energy.length)} icon={BatteryCharging}
                  sub={`${plan.energy.filter((e) => e.kind === 'ev').length} with charging`} />
              </div>
            </Card>

            {/* Modal trade-off */}
            <Card>
              <CardHead title="Mode comparison"
                sub="Transit, landed cost and emissions for this payload"
                right={<Badge tone={MODE_TONE[plan.recommended]} dot>
                  {plan.recommended} recommended
                </Badge>} />

              <div className="flex items-center gap-4 border-b border-line-soft p-3">
                <Donut
                  size={86} thickness={11}
                  centre={`${compact(best?.co2Kg ?? 0)}`} centreSub="kg CO₂e"
                  segments={feasible.map((m) => ({
                    label: m.mode, value: m.co2Kg,
                    tone: MODE_TONE[m.mode] === 'brand' ? 'brand'
                      : MODE_TONE[m.mode] === 'info' ? 'info'
                      : MODE_TONE[m.mode] === 'ok' ? 'ok' : 'warn',
                  }))}
                />
                <div className="min-w-0 flex-1 space-y-1.5">
                  {co2Saving > 0 ? (
                    <p className="text-[13px] leading-relaxed">
                      Moving this by <strong>{plan.recommended}</strong> instead of road avoids{' '}
                      <strong className="text-ok">{num(co2Saving)} kg CO₂e</strong>
                      {costSaving > 0 && <> and saves <strong className="text-ok">{inr(costSaving)}</strong></>}
                      {costSaving < 0 && <> at <strong>{inr(-costSaving)}</strong> extra cost</>}.
                    </p>
                  ) : (
                    <p className="text-[13px] leading-relaxed">
                      Road is the right call on this lane — no feasible mode beats it on time
                      without a disproportionate cost or carbon penalty.
                    </p>
                  )}
                  <p className="text-[11px] text-faint">
                    Emission factors from the IIMB calculator via {best?.source ?? 'CARBON/02'}.
                  </p>
                </div>
              </div>

              <div className="divide-y divide-line-soft">
                {plan.modal.map((m) => {
                  const Icon = MODE_ICON[m.mode]
                  return (
                    <div key={m.mode}
                      className={cn('flex items-center gap-3 px-3.5 py-2.5', !m.feasible && 'opacity-45')}>
                      <span className={cn('grid size-7 shrink-0 place-items-center rounded-lg border',
                        m.mode === plan.recommended
                          ? 'border-brand/40 bg-brand-soft text-brand'
                          : 'border-line bg-surface-2 text-muted')}>
                        <Icon className="size-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="text-[13px] font-medium capitalize">{m.mode}</span>
                          <Mono className="text-faint">{m.source}</Mono>
                        </div>
                        <div className="truncate text-[11px] text-muted">{m.note}</div>
                      </div>
                      <div className="tnum shrink-0 text-right text-[12px]">
                        <div>{m.hours}h</div>
                        <div className="text-[10px] text-faint">transit</div>
                      </div>
                      <div className="tnum w-20 shrink-0 text-right text-[12px]">
                        <div>{inr(m.costInr)}</div>
                        <div className="text-[10px] text-faint">landed</div>
                      </div>
                      <div className="tnum w-16 shrink-0 text-right text-[12px]">
                        <div className={m.mode === plan.recommended ? 'text-ok' : undefined}>
                          {compact(m.co2Kg)}
                        </div>
                        <div className="text-[10px] text-faint">kg CO₂e</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          </div>

          <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
            {/* Safety */}
            <Card>
              <CardHead title="Black spots on this corridor"
                sub="Accident-prone locations reported by the states you cross"
                right={<Sources ids={['BLACKSPOT/01']} />} />
              <div className="max-h-[300px] divide-y divide-line-soft overflow-y-auto">
                {!plan.blackSpots.length && (
                  <p className="px-4 py-8 text-center text-[13px] text-muted">
                    No black spots recorded on this corridor.
                  </p>
                )}
                {plan.blackSpots.map((b) => (
                  <div key={b.id} className="flex items-start gap-2.5 px-3.5 py-2">
                    <AlertTriangle className={cn('mt-0.5 size-3.5 shrink-0',
                      b.severity === 'high' ? 'text-bad' : 'text-warn')} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-medium">{b.location}</div>
                      <div className="text-[11px] text-muted">
                        {b.roadName} · {b.district}, {b.state}
                      </div>
                      <div className="text-[10px] text-faint">{b.policeStation}</div>
                    </div>
                    <Badge tone={b.severity === 'high' ? 'bad' : 'warn'}>{b.severity}</Badge>
                  </div>
                ))}
              </div>
            </Card>

            {/* Cost split + restrictions */}
            <div className="space-y-3">
              <Card>
                <CardHead title="Cost to run this lane"
                  sub="Own-account operating cost, against what the market would charge" />
                <div className="p-3">
                  <CompareBars
                    format={(n) => inr(n)}
                    rows={[
                      { label: 'Fuel', value: plan.ownCost.fuel, tone: 'warn' },
                      { label: 'Driver', value: plan.ownCost.driver, tone: 'info' },
                      { label: 'Toll', value: plan.ownCost.toll, tone: 'brand' },
                      { label: 'Upkeep', value: plan.ownCost.maintenance, tone: 'muted' },
                    ]}
                  />
                  <div className="mt-3 flex items-center gap-3 border-t border-line-soft pt-3">
                    <Radial
                      value={Math.min(100, (plan.ownCost.total / Math.max(1, plan.marketFreight)) * 100)}
                      tone={plan.ownCost.total < plan.marketFreight ? 'ok' : 'bad'}
                      size={52} sublabel="of rate" />
                    <p className="text-[12px] leading-relaxed text-muted">
                      Running it yourself costs <strong className="text-fg">{inr(plan.ownCost.total)}</strong>{' '}
                      against a market rate of <strong className="text-fg">{inr(plan.marketFreight)}</strong> —{' '}
                      {plan.ownCost.total < plan.marketFreight
                        ? <span className="text-ok">{inr(plan.marketFreight - plan.ownCost.total)} better to run own fleet</span>
                        : <span className="text-bad">{inr(plan.ownCost.total - plan.marketFreight)} cheaper to hire</span>}
                      . Toll is {((plan.ownCost.toll / plan.ownCost.total) * 100).toFixed(0)}% of the
                      operating stack across {plan.tolls.length} plazas.
                    </p>
                  </div>
                </div>
              </Card>

              <Card>
                <CardHead title={`Restrictions at ${plan.destination.name}`}
                  sub="Municipal goods-vehicle windows"
                  right={<Sources ids={['NOENTRY/01']} />} />
                <div className="divide-y divide-line-soft">
                  {!plan.noEntry.length && (
                    <p className="px-4 py-6 text-center text-[13px] text-muted">
                      No restrictions recorded for this destination.
                    </p>
                  )}
                  {plan.noEntry.map((w, i) => (
                    <div key={i} className="px-3.5 py-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[12px] font-medium">{w.areaName}</div>
                          <div className="text-[10px] text-faint">{w.districtName} · {w.stateName}</div>
                        </div>
                        <Badge tone="warn">{w.noEntryTime}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>

          {/* Energy along the way */}
          <Card>
            <CardHead title="Energy along the corridor"
              sub="Fuel and charging, spaced for a loaded run"
              right={<Sources ids={['MOPNG/01', 'EVYATRA/01']} />} />
            <div className="flex gap-2 overflow-x-auto p-3">
              {plan.energy.map((e) => (
                <div key={e.id} className="w-48 shrink-0 rounded-lg border border-line bg-surface-2/60 p-2.5">
                  <div className="flex items-center gap-1.5">
                    {e.kind === 'ev'
                      ? <BatteryCharging className="size-3.5 text-ok" />
                      : <Fuel className="size-3.5 text-warn" />}
                    <span className="truncate text-[12px] font-medium">{e.brand}</span>
                  </div>
                  <div className="mt-1 truncate text-[11px] text-muted">{e.name}</div>
                  <div className="mt-1.5">
                    <Meter value={(e.atKm / plan.distanceKm) * 100} tone="brand" />
                    <div className="tnum mt-1 text-[10px] text-faint">at {num(e.atKm)} km</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
