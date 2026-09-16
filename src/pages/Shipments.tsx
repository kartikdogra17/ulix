import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  CircleAlert, Filter, Gauge, Package, Plane, Search, Ship,
  ThermometerSnowflake, Train, Truck, TriangleAlert,
} from 'lucide-react'
import { adapter } from '../data'
import { lensFor } from '../data/roles'
import { LensDefault } from '../components/lens'
import type { Coverage, SignalKind } from '../data/fusion'
import {
  AssigneeSelect, CaseDrawer, SEV_TONE, Sources, StatusChip, currentMemberId,
} from '../components/cases'
import { useApp } from '../state/app'
import { useAsync, useDebounced } from '../lib/useAsync'
import { d, dt, dur, inr, kg, num, rel } from '../lib/format'
import { NODES, nodeName } from '../data/mock/seed'
import { MODE_LABEL, SHIPMENT_LABEL, SHIPMENT_TONE } from '../lib/status'
import {
  Badge, Button, Card, Drawer, Empty, Input, Meter, Mono,
  Select, Tab, TabList, Tabs, TableSkeleton, Td, Th,
} from '../components/ui'
import { NetworkMap } from '../components/NetworkMap'
import { DOC_TONE } from '../lib/status'
import type { Mode, ShipmentStatus } from '../data/types'
import { cn } from '../lib/cn'

const MODE_ICON: Record<Mode, React.ComponentType<{ className?: string }>> = {
  road: Truck, rail: Train, sea: Ship, air: Plane,
}

const STATUSES: Array<ShipmentStatus | 'all'> = [
  'all', 'in_transit', 'at_hub', 'customs', 'out_for_delivery', 'delivered', 'exception', 'planned',
]

/* ── Detail drawer ────────────────────────────────────────────── */

const COVERAGE_TONE: Record<Coverage['state'], 'ok' | 'warn' | 'bad' | 'neutral'> = {
  reported: 'ok', stale: 'warn', missing: 'bad',
  not_subscribed: 'neutral', not_applicable: 'neutral',
}

const COVERAGE_LABEL: Record<Coverage['state'], string> = {
  reported: 'Reporting', stale: 'Stale', missing: 'No data',
  not_subscribed: 'Not subscribed', not_applicable: 'Not applicable',
}

function ShipmentDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { session } = useApp()
  const actor = currentMemberId(session?.name)
  const [tab, setTab] = useState('overview')
  const [openCase, setOpenCase] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const bump = () => setVersion((v) => v + 1)

  const { data: f } = useAsync(
    () => (id ? adapter.shipment360(id) : Promise.resolve(null)), [id])
  // Working state for this consignment's signals — owner, status, outcome.
  const { data: cases } = useAsync(
    () => (id ? adapter.listCases({ scope: 'all', search: id }) : Promise.resolve([])),
    [id, version])
  const caseFor = (signalId: string) => cases?.find((c) => c.signalId === signalId) ?? null

  useEffect(() => { setTab('overview') }, [id])

  const s = f?.shipment

  return (
    <Drawer open={!!id} onClose={onClose}
      title={s ? s.id : 'Loading…'}
      sub={s && <span className="font-mono">{s.ulipRef}</span>}>
      {!s || !f ? <TableSkeleton rows={8} cols={3} /> : (
        <div className="space-y-4 p-4">
          {/* Summary strip */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={SHIPMENT_TONE[s.status]} dot>{SHIPMENT_LABEL[s.status]}</Badge>
            {s.delayMins > 30 && <Badge tone="bad">{dur(s.delayMins)} behind</Badge>}
            {s.delayMins < -30 && <Badge tone="ok">{dur(s.delayMins)} early</Badge>}
            {s.hazardous && <Badge tone="warn">Hazardous</Badge>}
            {s.reefer && <Badge tone="info"><ThermometerSnowflake className="size-3" />{s.tempC}°C</Badge>}
          </div>

          {/* Risk + confidence, side by side — how bad, and how sure */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Card className="p-3">
              <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-faint">
                <span>Risk score</span>
                <CircleAlert className="size-3.5" />
              </div>
              <div className="tnum mt-1 text-[22px] font-semibold tracking-tight">{f.risk}<span className="text-sm text-faint">/100</span></div>
              <Meter value={f.risk} className="mt-2"
                tone={f.risk >= 60 ? 'bad' : f.risk >= 25 ? 'warn' : 'ok'} />
              <p className="mt-1.5 text-[11px] text-muted">
                {f.signals.length ? `${f.signals.length} cross-system signal${f.signals.length === 1 ? '' : 's'}` : 'No conflicts detected'}
              </p>
            </Card>
            <Card className="p-3">
              <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-faint">
                <span>Data confidence</span>
                <Gauge className="size-3.5" />
              </div>
              <div className="tnum mt-1 text-[22px] font-semibold tracking-tight">{f.confidence}<span className="text-sm text-faint">%</span></div>
              <Meter value={f.confidence} className="mt-2"
                tone={f.confidence >= 75 ? 'ok' : f.confidence >= 50 ? 'warn' : 'bad'} />
              <p className="mt-1.5 text-[11px] text-muted">
                {f.coverage.filter((c) => c.state === 'reported').length} of{' '}
                {f.coverage.filter((c) => c.state !== 'not_applicable').length} relevant systems reporting
              </p>
            </Card>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Card className="p-3">
              <div className="text-[11px] uppercase tracking-wide text-faint">Route</div>
              <div className="mt-1 text-[15px] font-semibold tracking-tight">
                {nodeName(s.origin)} → {nodeName(s.destination)}
              </div>
              <Meter value={s.progress * 100} className="mt-2.5"
                tone={s.status === 'delivered' ? 'ok' : s.delayMins > 180 ? 'bad' : 'brand'} />
              <div className="mt-1.5 flex justify-between text-[11px] text-muted">
                <span>{Math.round(s.progress * 100)}% complete</span>
                <span>ETA {dt(s.eta)}</span>
              </div>
            </Card>
            <Card className="p-3">
              <div className="text-[11px] uppercase tracking-wide text-faint">Consignment</div>
              <div className="mt-1 text-[15px] font-semibold tracking-tight">{s.commodity}</div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-[12px]">
                <div><div className="text-faint">Weight</div><div className="tnum font-medium">{kg(s.weightKg)}</div></div>
                <div><div className="text-faint">Packages</div><div className="tnum font-medium">{num(s.packages)}</div></div>
                <div><div className="text-faint">Value</div><div className="tnum font-medium">{inr(s.invoiceValue)}</div></div>
              </div>
            </Card>
          </div>

          <Tabs value={tab} onChange={setTab}>
            <TabList>
              <Tab id="overview" count={f.signals.length}>Signals</Tab>
              <Tab id="sources" count={f.coverage.length}>Sources</Tab>
              <Tab id="journey">Journey</Tab>
              <Tab id="events" count={s.events.length}>Events</Tab>
              <Tab id="docs" count={f.docs.length}>Documents</Tab>
            </TabList>

            {tab === 'overview' && (
              <div className="mt-3 space-y-2">
                {!f.signals.length && (
                  <div className="rounded-xl border border-ok/25 bg-ok-soft px-4 py-8 text-center">
                    <p className="text-[13px] font-medium text-ok">No cross-system conflicts</p>
                    <p className="mt-1 text-[12px] text-muted">
                      Documents, vehicle status and movement data all agree on this consignment.
                    </p>
                  </div>
                )}
                {f.signals.map((sig) => {
                  const c = caseFor(sig.id)
                  return (
                    <Card key={sig.id} className="p-3">
                      <div className="flex items-start gap-2.5">
                        <Badge tone={SEV_TONE[sig.severity]} dot className="mt-0.5 shrink-0">{sig.severity}</Badge>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[13px] font-medium">{sig.title}</span>
                            {c && <StatusChip c={c} />}
                          </div>
                          <p className="mt-1 text-[12px] leading-relaxed text-muted">{sig.detail}</p>
                          <div className="mt-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5">
                            <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">Do next</div>
                            <p className="mt-0.5 text-[12px]">{sig.action}</p>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                            <Sources ids={sig.sources} />
                            {c && (
                              <div className="flex items-center gap-2">
                                <AssigneeSelect c={c} actor={actor} onChanged={bump} compact />
                                <Button size="sm" onClick={() => setOpenCase(sig.id)}>Open case</Button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </Card>
                  )
                })}
              </div>
            )}

            {tab === 'sources' && (
              <div className="mt-3 space-y-2">
                <p className="text-[12px] leading-relaxed text-muted">
                  Which government systems have contributed to this consignment's picture.
                  Gaps here are the reason a decision may need a phone call rather than a click.
                </p>
                <div className="overflow-hidden rounded-xl border border-line">
                  <table className="w-full">
                    <thead className="bg-surface-2"><tr>
                      <Th>System</Th><Th>Endpoint</Th><Th>Contributes</Th><Th className="text-right">State</Th>
                    </tr></thead>
                    <tbody className="divide-y divide-line-soft">
                      {f.coverage.map((c) => (
                        <tr key={c.endpoint} className={cn(
                          (c.state === 'not_subscribed' || c.state === 'not_applicable') && 'opacity-50')}>
                          <Td className="font-medium">{c.system}</Td>
                          <Td><Mono className="text-muted">{c.endpoint}</Mono></Td>
                          <Td className="text-[11px] text-muted">{c.note}</Td>
                          <Td className="text-right">
                            <Badge tone={COVERAGE_TONE[c.state]}>{COVERAGE_LABEL[c.state]}</Badge>
                            {c.lastAt && c.state !== 'missing' && c.state !== 'not_applicable' && (
                              <div className="mt-0.5 text-[10px] text-faint">{rel(c.lastAt)}</div>
                            )}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tab === 'journey' && (
              <div className="mt-3 space-y-3">
                <Card className="overflow-hidden">
                  <NetworkMap
                    className="aspect-[4/3] w-full"
                    showLabels={false}
                    highlight={[s.origin, s.destination, s.currentNode]}
                    routes={s.legs.map((l) => ({ from: l.from, to: l.to, mode: l.mode, active: l.status === 'active' }))}
                    markers={[{ id: s.id, lat: s.lat, lon: s.lon, tone: f.risk >= 60 ? 'bad' : 'ok', pulse: true, r: 5 }]}
                  />
                </Card>
                {s.legs.map((l, i) => {
                  const Icon = MODE_ICON[l.mode]
                  return (
                    <div key={l.id} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg border',
                          l.status === 'completed' ? 'border-ok/30 bg-ok-soft text-ok'
                          : l.status === 'active' ? 'border-brand/30 bg-brand-soft text-brand'
                          : l.status === 'delayed' ? 'border-bad/30 bg-bad-soft text-bad'
                          : 'border-line bg-surface-2 text-faint')}>
                          <Icon className="size-4" />
                        </span>
                        {i < s.legs.length - 1 && <span className="my-1 w-px flex-1 bg-line" />}
                      </div>
                      <Card className="mb-1 flex-1 p-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-[13px] font-medium">
                            {nodeName(l.from)} → {nodeName(l.to)}
                          </span>
                          <Badge tone={l.status === 'completed' ? 'ok' : l.status === 'delayed' ? 'bad' : l.status === 'active' ? 'brand' : 'neutral'}>
                            {MODE_LABEL[l.mode]} · {l.status}
                          </Badge>
                        </div>
                        <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted sm:grid-cols-4">
                          <div><span className="text-faint">Carrier </span>{l.carrier}</div>
                          <div><span className="text-faint">Unit </span><Mono>{l.conveyance}</Mono></div>
                          <div><span className="text-faint">Dep </span>{dt(l.actualDep ?? l.plannedDep)}</div>
                          <div><span className="text-faint">Arr </span>{dt(l.actualArr ?? l.plannedArr)}</div>
                        </div>
                      </Card>
                    </div>
                  )
                })}
              </div>
            )}

            {tab === 'events' && (
              <div className="mt-3">
                {[...s.events].reverse().map((e, i) => (
                  <div key={e.id} className="flex gap-3">
                    <div className="flex flex-col items-center pt-1">
                      <span className={cn('size-2 shrink-0 rounded-full', i === 0 ? 'bg-brand' : 'bg-line')} />
                      {i < s.events.length - 1 && <span className="my-1 w-px flex-1 bg-line" />}
                    </div>
                    <div className="min-w-0 flex-1 pb-4">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="text-[13px] font-medium">{e.label}</span>
                        <Badge tone="neutral">{e.source}</Badge>
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted">{e.location}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-faint">
                        <Mono>{e.code}</Mono> · {dt(e.ts)} · {rel(e.ts)}
                      </div>
                      {e.note && <p className="mt-1 text-[11px] text-muted">{e.note}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'docs' && (
              <div className="mt-3 overflow-hidden rounded-xl border border-line">
                <table className="w-full">
                  <thead className="bg-surface-2"><tr>
                    <Th>Document</Th><Th>Number</Th><Th>Valid to</Th><Th className="text-right">Status</Th>
                  </tr></thead>
                  <tbody className="divide-y divide-line-soft">
                    {f.docs.map((doc) => (
                      <tr key={doc.id}>
                        <Td className="font-medium">{doc.type.replace(/_/g, ' ')}</Td>
                        <Td><Mono>{doc.number}</Mono></Td>
                        <Td className="text-muted">{d(doc.validUpto)}</Td>
                        <Td className="text-right"><Badge tone={DOC_TONE[doc.status]}>{doc.status}</Badge></Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Tabs>
        </div>
      )}
      <CaseDrawer signalId={openCase} actor={actor}
        onClose={() => setOpenCase(null)} onChanged={bump} />
    </Drawer>
  )
}

/* ── Page ─────────────────────────────────────────────────────── */

export function Shipments() {
  const { session } = useApp()
  const lens = lensFor(session?.org.role ?? 'Shipper')
  const opens = lens.pageDefaults.shipments

  const [sp, setSp] = useSearchParams()
  const [search, setSearch] = useState(sp.get('q') ?? '')
  const [status, setStatus] = useState<ShipmentStatus | 'all'>('all')
  const [mode, setMode] = useState('all')
  const [origin, setOrigin] = useState('all')
  const [onlyDelayed, setOnlyDelayed] = useState(false)
  const [sort, setSort] = useState<'created' | 'eta' | 'delay' | 'value'>(opens.sort)
  /* Seeded from the lens; cleared to [] the moment anyone asks to see everything. */
  const [signalKinds, setSignalKinds] = useState<readonly SignalKind[]>(opens.signalKinds)
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<string | null>(null)

  const q = useDebounced(search)
  useEffect(() => { setPage(1) }, [q, status, mode, origin, onlyDelayed, sort, signalKinds])
  useEffect(() => { if (q) setSp({ q }, { replace: true }); else setSp({}, { replace: true }) }, [q, setSp])

  const { data, loading } = useAsync(
    () => adapter.listShipments({ search: q, status, mode, origin, onlyDelayed, signalKinds, sort, page, pageSize: 25 }),
    [q, status, mode, origin, onlyDelayed, signalKinds, sort, page])

  const pages = data ? Math.max(1, Math.ceil(data.total / 25)) : 1

  return (
    <div className="space-y-3 p-3 sm:p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Consignments</h1>
          <p className="text-[13px] text-muted">
            {data ? `${num(data.total)} matching` : 'Loading'} · multimodal, deduplicated across source systems
          </p>
        </div>
      </header>

      {/* Filters */}
      <Card className="p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <div className="relative lg:col-span-2">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8"
              placeholder="CN number, e-Way Bill, vehicle, party, commodity…" />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value as ShipmentStatus | 'all')}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s === 'all' ? 'All statuses' : SHIPMENT_LABEL[s as ShipmentStatus]}</option>
            ))}
          </Select>
          <Select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="all">All modes</option>
            {(['road', 'rail', 'sea', 'air'] as Mode[]).map((m) => (
              <option key={m} value={m}>{MODE_LABEL[m]}</option>
            ))}
          </Select>
          <Select value={origin} onChange={(e) => setOrigin(e.target.value)}>
            <option value="all">Any origin</option>
            {NODES.map((n) => <option key={n.code} value={n.code}>{n.name}</option>)}
          </Select>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" variant={onlyDelayed ? 'primary' : 'outline'} onClick={() => setOnlyDelayed((v) => !v)}>
            <TriangleAlert className="size-3.5" /> Delayed only
          </Button>
          <div className="ml-auto flex items-center gap-1.5">
            <Filter className="size-3.5 text-faint" />
            <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="h-7 w-auto text-xs">
              <option value="created">Newest first</option>
              <option value="eta">Soonest ETA</option>
              <option value="delay">Most delayed</option>
              <option value="value">Highest value</option>
            </Select>
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden">
        {signalKinds.length > 0 && opens.note && (
          <LensDefault role={lens.role} what={opens.note} onClear={() => setSignalKinds([])} />
        )}
        {loading && !data ? <TableSkeleton rows={9} cols={7} /> : !data?.rows.length ? (
          <Empty icon={Package} title="Nothing matches those filters"
            sub="Try clearing the search box or widening the status and mode filters."
            action={<Button size="sm" onClick={() => { setSearch(''); setStatus('all'); setMode('all'); setOrigin('all'); setOnlyDelayed(false); setSignalKinds([]) }}>Reset filters</Button>} />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full">
                <thead className="border-b border-line-soft bg-surface-2/50"><tr>
                  <Th>Consignment</Th><Th>Lane</Th><Th>Modes</Th><Th>Status</Th>
                  <Th className="text-right">Value</Th><Th className="text-right">ETA</Th><Th className="text-right">Progress</Th>
                </tr></thead>
                <tbody className="divide-y divide-line-soft">
                  {data.rows.map((s) => (
                    <tr key={s.id} onClick={() => setOpenId(s.id)}
                      className="cursor-pointer transition-colors hover:bg-surface-2/60">
                      <Td>
                        <div className="font-medium">{s.id}</div>
                        <div className="truncate text-[11px] text-faint">{s.commodity}</div>
                      </Td>
                      <Td className="text-[12px]">
                        {nodeName(s.origin)}<span className="mx-1 text-faint">→</span>{nodeName(s.destination)}
                      </Td>
                      <Td>
                        <div className="flex gap-1">
                          {[...new Set(s.legs.map((l) => l.mode))].map((m) => {
                            const Icon = MODE_ICON[m]
                            return <Icon key={m} className="size-3.5 text-muted" />
                          })}
                        </div>
                      </Td>
                      <Td>
                        <Badge tone={SHIPMENT_TONE[s.status]} dot>{SHIPMENT_LABEL[s.status]}</Badge>
                      </Td>
                      <Td className="tnum text-right">{inr(s.invoiceValue)}</Td>
                      <Td className="text-right">
                        <div className="tnum text-[12px]">{dt(s.eta)}</div>
                        {s.delayMins > 30 && <div className="text-[10px] text-bad">{dur(s.delayMins)} late</div>}
                      </Td>
                      <Td>
                        <div className="flex items-center justify-end gap-2">
                          <Meter value={s.progress * 100} tone={s.status === 'delivered' ? 'ok' : s.delayMins > 180 ? 'bad' : 'brand'} className="w-14" />
                          <span className="tnum w-8 text-right text-[11px] text-muted">{Math.round(s.progress * 100)}%</span>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="divide-y divide-line-soft md:hidden">
              {data.rows.map((s) => (
                <button key={s.id} onClick={() => setOpenId(s.id)} className="w-full px-3.5 py-3 text-left active:bg-surface-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium">{s.id}</div>
                      <div className="truncate text-[11px] text-muted">
                        {nodeName(s.origin)} → {nodeName(s.destination)}
                      </div>
                    </div>
                    <Badge tone={SHIPMENT_TONE[s.status]} dot>{SHIPMENT_LABEL[s.status]}</Badge>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Meter value={s.progress * 100} tone={s.status === 'delivered' ? 'ok' : s.delayMins > 180 ? 'bad' : 'brand'} className="flex-1" />
                    <span className="tnum text-[11px] text-muted">{dt(s.eta)}</span>
                  </div>
                </button>
              ))}
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between gap-3 border-t border-line-soft px-3.5 py-2.5">
              <span className="text-[12px] text-muted">
                Page {page} of {pages} · {num(data.total)} consignments
              </span>
              <div className="flex gap-1.5">
                <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <Button size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          </>
        )}
      </Card>

      <ShipmentDetail id={openId} onClose={() => setOpenId(null)} />
    </div>
  )
}
