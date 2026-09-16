import { useMemo, useState } from 'react'
import {
  Anchor, CircleCheck, CircleDot, Clock3, Container, Plane, Search,
  Ship, TrendingUp, TriangleAlert,
} from 'lucide-react'
import { adapter } from '../data'
import { useAsync, useDebounced } from '../lib/useAsync'
import { dt, dur, inr } from '../lib/format'
import type { Charge, Milestone } from '../data/exim'
import { slabCliffs } from '../data/exim'
import { CompareBars } from '../components/charts'
import {
  Badge, Button, Card, CardHead, Drawer, Empty, Input, KeyVal, Meter,
  Mono, Select, Tab, TabList, Tabs, TableSkeleton,
} from '../components/ui'
import { cn } from '../lib/cn'

const STATE_ICON: Record<Milestone['state'], React.ComponentType<{ className?: string }>> = {
  done: CircleCheck, current: CircleDot, held: TriangleAlert, pending: CircleDot,
}
const STATE_TONE: Record<Milestone['state'], string> = {
  done: 'text-ok', current: 'text-brand', held: 'text-bad', pending: 'text-faint',
}

/** The tariff ladder, drawn so the cliff is visible rather than implied. */
function SlabLadder({ c }: { c: Charge }) {
  return (
    <div className="space-y-1">
      {c.slabs.map((s, i) => {
        const active = c.elapsedDays >= s.fromDay && c.elapsedDays < (s.toDay ?? Infinity)
        return (
          <div key={i} className={cn('flex items-center gap-2 rounded-md px-2 py-1 text-[11px]',
            active ? 'bg-bad-soft ring-1 ring-bad/30' : 'opacity-60')}>
            <span className="tnum w-16 shrink-0 text-faint">
              Day {s.fromDay}{s.toDay === null ? '+' : `–${s.toDay}`}
            </span>
            <span className={cn('tnum flex-1 font-medium', s.perDay === 0 && 'text-ok')}>
              {s.perDay === 0 ? 'free' : `${inr(s.perDay, false)}/day`}
            </span>
            {active && <Badge tone="bad">now</Badge>}
          </div>
        )
      })}
    </div>
  )
}

function ChargeCard({ c }: { c: Charge }) {
  const pastFree = c.elapsedDays > c.freeDays
  return (
    <Card className={cn('p-3', pastFree && 'border-bad/30 bg-bad-soft/25')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-semibold capitalize">{c.kind}</div>
          <div className="text-[10px] text-faint">{c.who}</div>
        </div>
        <div className="text-right">
          <div className="tnum text-[17px] font-semibold">{inr(c.accrued)}</div>
          <div className="text-[10px] text-faint">accrued</div>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2 text-[11px]">
        <span className="text-muted">Day {c.elapsedDays.toFixed(1)}</span>
        <Meter value={Math.min(100, (c.elapsedDays / Math.max(1, c.freeDays * 3)) * 100)}
          tone={pastFree ? 'bad' : 'ok'} className="flex-1" />
        <span className="tnum font-medium">
          {c.currentRate ? `${inr(c.currentRate, false)}/day` : 'free'}
        </span>
      </div>

      {c.hoursToNextSlab !== null && c.nextRate ? (
        <p className="mt-2 rounded-md border border-bad/25 bg-bad-soft px-2 py-1.5 text-[11px] leading-relaxed text-bad">
          Rate steps to <strong>{inr(c.nextRate, false)}/day</strong> in{' '}
          <strong>{dur(c.hoursToNextSlab * 60)}</strong> — clear it before then or the
          daily burn {c.currentRate ? 'roughly doubles' : 'starts'}.
        </p>
      ) : (
        <p className="mt-2 text-[11px] text-faint">Top slab — the rate does not rise further.</p>
      )}

      <div className="mt-2"><SlabLadder c={c} /></div>
    </Card>
  )
}

function FileDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data: f } = useAsync(
    () => (id ? adapter.getEximFile(id) : Promise.resolve(null)), [id])
  const [tab, setTab] = useState('chain')

  return (
    <Drawer open={!!id} onClose={onClose} width="max-w-2xl"
      title={f ? `${f.id} · ${f.direction === 'import' ? 'Import' : 'Export'}` : 'Loading…'}
      sub={f && <span className="font-mono">{f.containerNumber}</span>}>
      {!f ? <TableSkeleton rows={8} cols={2} /> : (
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={f.cleared ? 'ok' : f.holds.length ? 'bad' : 'brand'} dot>
              {f.cleared ? 'Cleared' : f.holds.length ? 'Held' : f.currentStage}
            </Badge>
            <Badge tone="neutral">{f.mode === 'sea' ? <Ship className="size-3" /> : <Plane className="size-3" />}{f.mode}</Badge>
            <Badge tone="neutral">{f.portName}</Badge>
            {f.esealStatus === 'TAMPER ALERT' && <Badge tone="bad">e-Seal tamper</Badge>}
            {f.exposure > 0 && (
              <span className="ml-auto text-right">
                <span className="tnum text-[15px] font-semibold text-bad">{inr(f.exposure)}</span>
                <span className="ml-1 text-[11px] text-faint">accrued</span>
              </span>
            )}
          </div>

          {f.holds.map((h) => (
            <Card key={h.id} className="border-bad/35 bg-bad-soft/40 p-3">
              <div className="flex items-start gap-2.5">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-bad" />
                <div>
                  <p className="text-[13px] font-medium">{h.reason}</p>
                  <p className="mt-1 text-[12px] leading-relaxed">{h.resolution}</p>
                  <div className="mt-1.5 flex items-center gap-2 text-[10px] text-faint">
                    <Mono>{h.endpoint}</Mono> · raised {dt(h.raisedAt)}
                  </div>
                </div>
              </div>
            </Card>
          ))}

          <Tabs value={tab} onChange={setTab}>
            <TabList>
              <Tab id="chain" count={f.milestones.length}>Clearance chain</Tab>
              <Tab id="money" count={f.charges.length}>Charges</Tab>
              <Tab id="ids">Identifiers</Tab>
            </TabList>

            {tab === 'chain' && (
              <div className="mt-3">
                {f.milestones.map((m, i) => {
                  const Icon = STATE_ICON[m.state]
                  return (
                    <div key={m.code} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <Icon className={cn('size-4 shrink-0', STATE_TONE[m.state])} />
                        {i < f.milestones.length - 1 && (
                          <span className={cn('my-1 w-px flex-1',
                            m.state === 'done' ? 'bg-ok/40' : 'bg-line')} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1 pb-4">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className={cn('text-[13px]',
                            m.state === 'pending' ? 'text-faint' : 'font-medium')}>
                            {m.label}
                          </span>
                          <Mono className="text-faint">{m.endpoint}</Mono>
                          {m.state === 'held' && <Badge tone="bad">held here</Badge>}
                        </div>
                        <div className="mt-0.5 text-[11px] text-muted">
                          {m.at ? dt(m.at) : m.state === 'pending' ? 'not yet reported' : 'in progress'}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {tab === 'money' && (
              <div className="mt-3 space-y-3">
                {!f.charges.length && (
                  <p className="py-8 text-center text-[13px] text-muted">
                    No demurrage or detention clock has started on this file.
                  </p>
                )}
                {f.charges.map((c) => <ChargeCard key={c.kind} c={c} />)}
              </div>
            )}

            {tab === 'ids' && (
              <Card className="mt-3 p-3">
                <dl>
                  <KeyVal k="Party" v={f.party} />
                  <KeyVal k="CHA" v={f.chaNo} />
                  <KeyVal k="Container" v={f.containerNumber} mono />
                  {f.igmNo && <KeyVal k="IGM" v={`${f.igmNo} · ${f.igmDt ? dt(f.igmDt) : ''}`} mono />}
                  {f.beNo && <KeyVal k="Bill of Entry" v={`${f.beNo} · ${f.beDt ? dt(f.beDt) : ''}`} mono />}
                  {f.oocNo && <KeyVal k="Out of charge" v={`${f.oocNo} · ${f.oocDt ? dt(f.oocDt) : ''}`} mono />}
                  {f.sbNo && <KeyVal k="Shipping Bill" v={`${f.sbNo} · ${f.sbDt ? dt(f.sbDt) : ''}`} mono />}
                  {f.leoDt && <KeyVal k="LEO" v={dt(f.leoDt)} />}
                  {f.egmNo && <KeyVal k="EGM" v={`${f.egmNo} · ${f.egmDt ? dt(f.egmDt) : ''}`} mono />}
                  {f.esealNumber && <KeyVal k="e-Seal" v={`${f.esealNumber} · ${f.esealStatus}`} mono />}
                  {f.mawbNumber && <KeyVal k="MAWB" v={f.mawbNumber} mono />}
                  {f.hawbNumber && <KeyVal k="HAWB" v={f.hawbNumber} mono />}
                  {f.flightNo && <KeyVal k="Flight" v={f.flightNo} mono />}
                  {f.vesselName && <KeyVal k="Vessel" v={`${f.vesselName} · ${f.voyageNo}`} />}
                  {f.imoCode && <KeyVal k="IMO" v={f.imoCode} mono />}
                  {f.rotationNumber && <KeyVal k="Rotation" v={f.rotationNumber} mono />}
                  <KeyVal k="Assessed value" v={inr(f.assessedValue)} />
                  <KeyVal k="Duty" v={inr(f.dutyAmount)} />
                  {f.shipmentId && <KeyVal k="Consignment" v={f.shipmentId} mono />}
                </dl>
              </Card>
            )}
          </Tabs>
        </div>
      )}
    </Drawer>
  )
}

export function Exim() {
  const [search, setSearch] = useState('')
  const [direction, setDirection] = useState<'all' | 'import' | 'export'>('all')
  const [onlyOpen, setOnlyOpen] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const q = useDebounced(search)

  const { data: files } = useAsync(
    () => adapter.eximFiles({ direction, search: q, onlyOpen }), [direction, q, onlyOpen])
  const { data: all } = useAsync(() => adapter.eximFiles({}), [])

  const tally = useMemo(() => {
    const t = { exposure: 0, held: 0, open: 0, burnPerDay: 0 }
    for (const f of all ?? []) {
      t.exposure += f.exposure
      if (f.holds.length) t.held++
      if (!f.cleared) t.open++
      if (!f.cleared) t.burnPerDay += f.charges.reduce((a, c) => a + c.currentRate, 0)
    }
    return t
  }, [all])

  const cliffs = useMemo(() => slabCliffs(all ?? []), [all])

  return (
    <div className="space-y-3 p-3 sm:p-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">EXIM cockpit</h1>
        <p className="text-[13px] text-muted">
          Import and export clearance, and what the delay is costing while it sits.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-3.5">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-faint">
            <Container className="size-3" />Accrued charges
          </div>
          <div className="tnum mt-1 text-[22px] font-semibold tracking-tight text-bad">
            {inr(tally.exposure)}
          </div>
          <div className="mt-0.5 text-[11px] text-muted">demurrage and detention to date</div>
        </Card>
        <Card className="p-3.5">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-faint">
            <TrendingUp className="size-3" />Burning now
          </div>
          <div className="tnum mt-1 text-[22px] font-semibold tracking-tight">
            {inr(tally.burnPerDay)}
          </div>
          <div className="mt-0.5 text-[11px] text-muted">per day across open files</div>
        </Card>
        <Card className="p-3.5">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-faint">
            <TriangleAlert className="size-3" />Held at customs
          </div>
          <div className="tnum mt-1 text-[22px] font-semibold tracking-tight">{tally.held}</div>
          <div className="mt-0.5 text-[11px] text-muted">of {tally.open} open files</div>
        </Card>
        <Card className="p-3.5">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-faint">
            <Anchor className="size-3" />Sources
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {['ICEGATE/02', 'ICEGATE/07', 'ICEGATE/13', 'PCS/01', 'PCS/04'].map((e) => (
              <span key={e} className="rounded border border-line bg-surface-2 px-1 font-mono text-[10px] leading-4 text-muted">
                {e}
              </span>
            ))}
          </div>
        </Card>
      </div>

      {/* The cliff list — what to clear before the rate steps up */}
      {cliffs.length > 0 && (
        <Card className="border-bad/30 bg-bad-soft/20">
          <CardHead title="Crossing into a higher tariff slab"
            sub="Clear these before the daily rate steps up — the charge ladder is slabbed, not linear" />
          <div className="divide-y divide-line-soft">
            {cliffs.slice(0, 5).map(({ file, charge }) => (
              <button key={`${file.id}-${charge.kind}`} onClick={() => setOpenId(file.id)}
                className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-surface-2/50">
                <Clock3 className="size-4 shrink-0 text-bad" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[13px] font-medium">{file.id}</span>
                    <Mono className="text-faint">{file.containerNumber}</Mono>
                    <Badge tone="neutral">{charge.kind}</Badge>
                  </div>
                  <div className="text-[11px] text-muted">
                    {file.party} · {file.portName}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="tnum text-[12px] font-semibold text-bad">
                    in {dur((charge.hoursToNextSlab ?? 0) * 60)}
                  </div>
                  <div className="tnum text-[10px] text-faint">
                    {inr(charge.currentRate, false)} → {inr(charge.nextRate ?? 0, false)}/day
                  </div>
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8"
              placeholder="Container, BE, SB, IGM, MAWB, e-Seal, vessel or party…" />
          </div>
          <Select value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}
            className="sm:w-36">
            <option value="all">Both ways</option>
            <option value="import">Imports</option>
            <option value="export">Exports</option>
          </Select>
          <Button size="md" variant={onlyOpen ? 'primary' : 'outline'}
            onClick={() => setOnlyOpen((v) => !v)}>
            Open only
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {!files ? <TableSkeleton rows={8} cols={4} /> : !files.length ? (
          <Empty icon={Container} title="No clearance files match"
            sub="Try a different direction or clear the search." />
        ) : (
          <div className="divide-y divide-line-soft">
            {files.map((f) => {
              const pct = (f.milestones.filter((m) => m.state === 'done').length / f.milestones.length) * 100
              return (
                <button key={f.id} onClick={() => setOpenId(f.id)}
                  className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-2/60">
                  <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg border',
                    f.holds.length ? 'border-bad/30 bg-bad-soft text-bad'
                      : f.cleared ? 'border-ok/30 bg-ok-soft text-ok'
                      : 'border-line bg-surface-2 text-muted')}>
                    {f.mode === 'sea' ? <Ship className="size-4" /> : <Plane className="size-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[13px] font-medium">{f.id}</span>
                      <Badge tone={f.direction === 'import' ? 'info' : 'brand'}>{f.direction}</Badge>
                      {f.holds.length > 0 && <Badge tone="bad">held</Badge>}
                      {f.esealStatus === 'TAMPER ALERT' && <Badge tone="bad">seal</Badge>}
                    </div>
                    <div className="truncate text-[11px] text-muted">
                      {f.party} · {f.portName} · <Mono>{f.containerNumber}</Mono>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <Meter value={pct} tone={f.cleared ? 'ok' : f.holds.length ? 'bad' : 'brand'}
                        className="max-w-[160px] flex-1" />
                      <span className="truncate text-[10px] text-faint">{f.currentStage}</span>
                    </div>
                  </div>
                  <div className="w-24 shrink-0 text-right">
                    {f.exposure > 0 ? (
                      <>
                        <div className="tnum text-[13px] font-semibold text-bad">{inr(f.exposure)}</div>
                        <div className="text-[10px] text-faint">accrued</div>
                      </>
                    ) : (
                      <div className="text-[11px] text-faint">no charges</div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </Card>

      {/* Where the money sits */}
      {all && all.length > 0 && (
        <Card>
          <CardHead title="Exposure by port" sub="Accrued demurrage and detention" />
          <div className="p-3">
            <CompareBars
              format={(n) => inr(n)}
              rows={Object.entries(
                all.reduce<Record<string, number>>((acc, f) => {
                  if (f.exposure > 0) acc[f.portName] = (acc[f.portName] ?? 0) + f.exposure
                  return acc
                }, {}))
                .sort((a, b) => b[1] - a[1])
                .slice(0, 6)
                .map(([port, value], i) => ({
                  label: port.split(' ')[0], value,
                  tone: i === 0 ? 'bad' : i < 3 ? 'warn' : 'info',
                }))} />
          </div>
        </Card>
      )}

      <FileDrawer id={openId} onClose={() => setOpenId(null)} />
    </div>
  )
}
