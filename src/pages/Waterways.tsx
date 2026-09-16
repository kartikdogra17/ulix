import { useEffect, useMemo, useState } from 'react'
import {
  Anchor, ArrowDownUp, Boxes, Droplets, Leaf, Ruler, Ship, TriangleAlert, Waves,
} from 'lucide-react'
import { adapter } from '../data'
import { useAsync } from '../lib/useAsync'
import { compact, inr, num } from '../lib/format'
import {
  MONTHS, VESSELS, assess, compareToRoad, seasonProfile,
  type Feasibility, type Stretch,
} from '../data/waterways'
import { CompareBars, Sparkline } from '../components/charts'
import {
  Badge, Card, CardHead, Field, Meter, Mono, Select, Skeleton,
} from '../components/ui'
import { cn } from '../lib/cn'

const VERDICT_TONE = { clear: 'ok', restricted: 'warn', blocked: 'bad' } as const

/** Twelve months of feasibility, as a band you can read at a glance. */
function SeasonBand({ profile, month, onPick }: {
  profile: Feasibility[]; month: number; onPick: (m: number) => void
}) {
  return (
    <div>
      <div className="flex gap-0.5">
        {profile.map((f, m) => (
          <button key={m} onClick={() => onPick(m)}
            title={`${MONTHS[m]} — ${f.verdict}, ${f.utilisationPct}% of rated tonnage`}
            className={cn('h-8 flex-1 rounded-[3px] transition-all',
              f.verdict === 'clear' ? 'bg-ok/70 hover:bg-ok'
                : f.verdict === 'restricted' ? 'bg-warn/70 hover:bg-warn'
                : 'bg-bad/70 hover:bg-bad',
              m === month && 'ring-2 ring-fg/40')} />
        ))}
      </div>
      <div className="mt-1 flex gap-0.5">
        {MONTHS.map((mn, m) => (
          <span key={mn} className={cn('flex-1 text-center text-[9px]',
            m === month ? 'font-semibold text-fg' : 'text-faint')}>
            {mn[0]}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Clearance profile along the stretch, lowest structure marked. */
function ClearanceProfile({ stretch, airDraft, month }: {
  stretch: Stretch; airDraft: number; month: number
}) {
  const f = assess(stretch, { ...VESSELS[0], airDraft }, month)
  // assess() already applied the seasonal loss to reach minClearance, so derive
  // the same offset once rather than recomputing it per structure.
  const rawMin = Math.min(...stretch.structures.map((s) => s.verticalClearance))
  const seasonalLoss = +(rawMin - f.minClearance).toFixed(2)
  const max = Math.max(airDraft + 3, ...stretch.structures.map((s) => s.verticalClearance))

  return (
    <div className="space-y-1.5">
      {stretch.structures.map((s) => {
        const effective = +(s.verticalClearance - seasonalLoss).toFixed(1)
        const clear = effective - airDraft
        const binding = f.bindingStructure?.id === s.id
        return (
          <div key={s.id} className={cn('flex items-center gap-2 rounded-md px-2 py-1',
            binding && 'bg-bad-soft ring-1 ring-bad/30')}>
            <span className="w-14 shrink-0 text-right font-mono text-[10px] text-faint">
              {s.chainage} km
            </span>
            <span className="w-28 shrink-0 truncate text-[11px]">{s.structure}</span>
            <div className="relative h-3 flex-1 overflow-hidden rounded-[2px] bg-surface-3">
              <div className={cn('absolute inset-y-0 left-0', clear < 1 ? 'bg-bad/50' : 'bg-accent/45')}
                style={{ width: `${(effective / max) * 100}%` }} />
              <div className="absolute inset-y-0 w-0.5 bg-fg"
                style={{ left: `${(airDraft / max) * 100}%` }} title="Vessel air draft" />
            </div>
            <span className={cn('tnum w-12 shrink-0 text-right text-[11px] font-medium',
              clear < 1 ? 'text-bad' : 'text-muted')}>
              {effective.toFixed(1)} m
            </span>
            {binding && <Badge tone="bad">binding</Badge>}
          </div>
        )
      })}
      {seasonalLoss > 0 && (
        <p className="pt-1 text-[10px] text-faint">
          Clearances shown are {seasonalLoss.toFixed(1)} m below their low-water figures —
          the water is high this month.
        </p>
      )}
    </div>
  )
}

export function Waterways() {
  const { data: ways } = useAsync(() => adapter.waterways(), [])
  const [wayId, setWayId] = useState<string>('nw-1')
  const [stretchId, setStretchId] = useState<string>('')
  const [vesselIdx, setVesselIdx] = useState(2)
  const [month, setMonth] = useState(new Date().getMonth())
  const [tonnes, setTonnes] = useState(1200)

  const way = useMemo(() => (ways ?? []).find((w) => w.id === wayId) ?? ways?.[0], [ways, wayId])
  const stretch = useMemo(
    () => way?.stretches.find((s) => s.id === stretchId) ?? way?.stretches[0], [way, stretchId])

  useEffect(() => { if (way && !way.stretches.some((s) => s.id === stretchId)) setStretchId(way.stretches[0].id) },
    [way, stretchId])

  const vessel = VESSELS[vesselIdx]
  const profile = useMemo(() => (stretch ? seasonProfile(stretch, vessel) : []), [stretch, vessel])
  const current = profile[month]
  const shift = useMemo(
    () => (stretch ? compareToRoad(stretch.lengthKm, tonnes) : null), [stretch, tonnes])

  const bestMonths = useMemo(
    () => profile.map((f, m) => ({ m, f })).filter((x) => x.f.verdict === 'clear').map((x) => MONTHS[x.m]),
    [profile])

  return (
    <div className="space-y-3 p-3 sm:p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Inland waterways</h1>
          <p className="text-[13px] text-muted">
            Whether a barge can actually run this stretch — and with how much on board.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {['IWAI/10', 'IWAI/11', 'IWAI/12', 'IWAI/13', 'IWAI/09'].map((e) => (
            <span key={e} className="rounded border border-line bg-surface-2 px-1 font-mono text-[10px] leading-4 text-muted">
              {e}
            </span>
          ))}
        </div>
      </header>

      {!ways || !way || !stretch ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <Skeleton className="h-64" /><Skeleton className="h-64" />
        </div>
      ) : (
        <>
          <Card className="p-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <Field label="National Waterway">
                <Select value={way.id} onChange={(e) => setWayId(e.target.value)}>
                  {ways.map((w) => <option key={w.id} value={w.id}>{w.displayName}</option>)}
                </Select>
              </Field>
              <Field label="Stretch">
                <Select value={stretch.id} onChange={(e) => setStretchId(e.target.value)}>
                  {way.stretches.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
              <Field label="Vessel">
                <Select value={vesselIdx} onChange={(e) => setVesselIdx(Number(e.target.value))}>
                  {VESSELS.map((v, i) => (
                    <option key={v.name} value={i}>{v.name} · {v.airDraft} m air draft</option>
                  ))}
                </Select>
              </Field>
              <Field label="Month">
                <Select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                  {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
                </Select>
              </Field>
              <Field label="Cargo">
                <Select value={tonnes} onChange={(e) => setTonnes(Number(e.target.value))}>
                  {[400, 800, 1200, 1800, 2400].map((t) => <option key={t} value={t}>{t} tonnes</option>)}
                </Select>
              </Field>
            </div>
          </Card>

          {/* Verdict */}
          {current && (
            <Card className={cn('p-3.5',
              current.verdict === 'blocked' ? 'border-bad/35 bg-bad-soft/35'
                : current.verdict === 'restricted' ? 'border-warn/35 bg-warn-soft/30'
                : 'border-ok/30 bg-ok-soft/25')}>
              <div className="flex items-start gap-3">
                <span className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg',
                  current.verdict === 'blocked' ? 'bg-bad/15 text-bad'
                    : current.verdict === 'restricted' ? 'bg-warn/15 text-warn' : 'bg-ok/15 text-ok')}>
                  {current.verdict === 'blocked' ? <TriangleAlert className="size-4" /> : <Ship className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-[14px] font-semibold">
                      {stretch.name} in {MONTHS[month]} — {current.verdict}
                    </h2>
                    <Badge tone={VERDICT_TONE[current.verdict]} dot>{vessel.name}</Badge>
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed">{current.note}</p>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      ['Min clearance', `${current.minClearance} m`, Ruler],
                      ['Headroom', `${current.headroom.toFixed(1)} m`, ArrowDownUp],
                      ['LAD', `${current.lad} m`, Droplets],
                      ['Loadable', `${num(current.loadableT)} t`, Boxes],
                    ].map(([label, value, Icon]) => (
                      <div key={label as string} className="rounded-lg border border-line bg-surface/70 p-2">
                        <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-faint">
                          {/* @ts-expect-error tuple icon */}
                          <Icon className="size-3" />{label}
                        </div>
                        <div className="tnum mt-0.5 text-[15px] font-semibold">{value as string}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          )}

          <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
            {/* Season */}
            <Card>
              <CardHead title="Navigable season"
                sub="Clearance falls as the water rises — the deepest months give the least headroom"
                right={<Mono className="text-faint">IWAI/11 × IWAI/12</Mono>} />
              <div className="p-3">
                <SeasonBand profile={profile} month={month} onPick={setMonth} />
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                  {[['ok', 'clear'], ['warn', 'restricted'], ['bad', 'blocked']].map(([t, l]) => (
                    <span key={t} className="flex items-center gap-1 text-muted">
                      <span className="size-2 rounded-sm" style={{ background: `var(--c-${t})` }} />{l}
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-[12px] leading-relaxed text-muted">
                  {bestMonths.length
                    ? <>Full-tonnage months for a {vessel.name.toLowerCase()}: <strong className="text-fg">{bestMonths.join(', ')}</strong>.</>
                    : <>No month clears this stretch for a {vessel.name.toLowerCase()} — try a lower air draft.</>}
                </p>
                <div className="mt-3 border-t border-line-soft pt-3">
                  <div className="mb-1 flex items-center justify-between text-[11px] text-faint">
                    <span>Least available depth through the year</span>
                    <span className="tnum">{Math.min(...stretch.ladByMonth)}–{Math.max(...stretch.ladByMonth)} m</span>
                  </div>
                  <Sparkline values={stretch.ladByMonth} tone="info" height={34} />
                </div>
              </div>
            </Card>

            {/* Air draft */}
            <Card>
              <CardHead title="Air draft along the stretch"
                sub={`Structures between ${stretch.originName} and ${stretch.destinationName}`}
                right={<Mono className="text-faint">IWAI/12</Mono>} />
              <div className="p-3">
                <ClearanceProfile stretch={stretch} airDraft={vessel.airDraft} month={month} />
                <p className="mt-2 text-[11px] leading-relaxed text-faint">
                  Bar shows clearance above the water this month; the vertical line is the
                  vessel at {vessel.airDraft} m. A working margin of 1.0 m is required over it.
                </p>
              </div>
            </Card>
          </div>

          <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr]">
            {/* Modal shift — the payoff */}
            {shift && (
              <Card>
                <CardHead title="Against moving it by road"
                  sub={`${num(tonnes)} tonnes over ${num(stretch.lengthKm)} km`}
                  right={<Badge tone="ok"><Leaf className="size-3" />IWT</Badge>} />
                <div className="p-3">
                  <CompareBars
                    format={(n) => `${compact(n)} kg`}
                    rows={[
                      { label: 'Road', value: shift.road.co2Kg, tone: 'warn', hint: `${shift.road.hours}h · ${inr(shift.road.costInr)}` },
                      { label: 'Water', value: shift.water.co2Kg, tone: 'ok', hint: `${shift.water.hours}h · ${inr(shift.water.costInr)}` },
                    ]} />
                  <div className="mt-3 rounded-lg border border-line bg-surface-2 p-2.5">
                    <p className="text-[13px] leading-relaxed">
                      Shifting this to water avoids{' '}
                      <strong className="text-ok">{num(shift.co2SavedKg)} kg CO₂e</strong>
                      {shift.costSavedInr > 0
                        ? <> and saves <strong className="text-ok">{inr(shift.costSavedInr)}</strong></>
                        : <> at <strong>{inr(-shift.costSavedInr)}</strong> more</>}
                      , for <strong>{shift.extraHours}h</strong> more transit.
                    </p>
                    <p className="mt-1 text-[11px] text-faint">
                      {current?.verdict === 'clear'
                        ? 'The stretch clears for this vessel in the selected month.'
                        : current?.verdict === 'restricted'
                          ? `Note the depth cap — only ${num(current.loadableT)} t of the ${num(vessel.capacityT)} t rating can be loaded.`
                          : 'Not available in the selected month — see the navigable season above.'}
                    </p>
                  </div>
                </div>
              </Card>
            )}

            {/* Terminals */}
            <Card className="overflow-hidden">
              <CardHead title="Terminals on this stretch"
                sub="Handling capability and last-year throughput"
                right={<Mono className="text-faint">IWAI/13</Mono>} />
              <div className="divide-y divide-line-soft">
                {stretch.terminals.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 px-3.5 py-2.5">
                    <span className={cn('grid size-7 shrink-0 place-items-center rounded-lg border',
                      t.containerCapable ? 'border-ok/30 bg-ok-soft text-ok' : 'border-line bg-surface-2 text-muted')}>
                      <Anchor className="size-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium">{t.terminalJetty}</div>
                      <div className="truncate text-[11px] text-faint">
                        {t.district}, {t.state} · chainage {t.chainage} km
                      </div>
                    </div>
                    {t.containerCapable && <Badge tone="ok">containers</Badge>}
                    <div className="tnum w-16 shrink-0 text-right">
                      <div className="text-[12px] font-semibold">{num(t.throughputKt)}</div>
                      <div className="text-[10px] text-faint">kt/yr</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Network context */}
          <Card>
            <CardHead title={`${way.displayName} — traffic`}
              sub={`${num(way.lengthKm)} km · ${way.states.join(', ')} · UTM ${way.utmZone}`}
              right={<Mono className="text-faint">IWAI/09</Mono>} />
            <div className="flex flex-wrap items-center gap-5 p-3">
              <div className="min-w-[180px] flex-1">
                <Sparkline values={way.trafficByYear.map((t) => t.traffic)} tone="brand" height={40} />
                <div className="mt-1 flex justify-between text-[10px] text-faint">
                  <span>{way.trafficByYear[0].fyear}</span>
                  <span>{way.trafficByYear[way.trafficByYear.length - 1].fyear}</span>
                </div>
              </div>
              <div className="flex items-center gap-5">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-faint">Latest</div>
                  <div className="tnum text-[18px] font-semibold">
                    {num(way.trafficByYear[way.trafficByYear.length - 1].traffic)}
                    <span className="ml-1 text-[11px] font-normal text-faint">kt</span>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-faint">Stretches</div>
                  <div className="tnum text-[18px] font-semibold">{way.stretches.length}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-faint">Navigable now</div>
                  <div className="tnum text-[18px] font-semibold">
                    {way.stretches.filter((s) => s.navigable).length}/{way.stretches.length}
                  </div>
                </div>
              </div>
            </div>
            <div className="border-t border-line-soft p-3">
              <div className="space-y-1.5">
                {way.stretches.map((s) => {
                  const f = assess(s, vessel, month)
                  return (
                    <button key={s.id} onClick={() => setStretchId(s.id)}
                      className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-surface-2/60">
                      <Waves className={cn('size-3.5 shrink-0',
                        f.verdict === 'clear' ? 'text-ok' : f.verdict === 'restricted' ? 'text-warn' : 'text-bad')} />
                      <span className={cn('min-w-0 flex-1 truncate text-[12px]',
                        s.id === stretch.id && 'font-semibold')}>{s.name}</span>
                      <span className="tnum w-14 text-right text-[11px] text-faint">{s.lengthKm} km</span>
                      <Meter value={f.utilisationPct} tone={VERDICT_TONE[f.verdict]} className="w-16" />
                      <span className="tnum w-9 text-right text-[11px]">{f.utilisationPct}%</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
