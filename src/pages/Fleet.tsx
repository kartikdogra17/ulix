import { useEffect, useState } from 'react'
import {
  BadgeCheck, Fuel, Gauge, Info, MapPin, Receipt,
  Search, ShieldAlert, Truck, UserRound,
} from 'lucide-react'
import { adapter } from '../data'
import { useApp } from '../state/app'
import { lensFor, type FleetCol } from '../data/roles'
import { useAsync, useDebounced } from '../lib/useAsync'
import { d, daysTo, dt, inr, num } from '../lib/format'
import { FASTAG_RETENTION_HOURS } from '../data/ulip/catalogue'
import { VEHICLE_TONE } from '../lib/status'
import {
  Badge, Button, Card, Drawer, Empty, Input, KeyVal, Meter,
  Select, Tab, TabList, Tabs, TableSkeleton, Td, Th,
} from '../components/ui'
import { NetworkMap } from '../components/NetworkMap'
import type { Vehicle } from '../data/types'
import { cn } from '../lib/cn'

/** Validity chip driven by days remaining — the daily job of a fleet desk. */
function Validity({ label, iso }: { label: string; iso: string }) {
  const days = daysTo(iso)
  const tone = days < 0 ? 'bad' : days < 21 ? 'warn' : 'ok'
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line-soft py-2 last:border-0">
      <span className="text-xs text-muted">{label}</span>
      <div className="flex items-center gap-2">
        <span className="tnum text-[12px]">{d(iso)}</span>
        <Badge tone={tone}>
          {days < 0 ? `${Math.abs(days)}d overdue` : days < 21 ? `${days}d left` : 'Valid'}
        </Badge>
      </div>
    </div>
  )
}

function VehicleDetail({ regNo, onClose }: { regNo: string | null; onClose: () => void }) {
  const { data: v } = useAsync(() => (regNo ? adapter.getVehicle(regNo) : Promise.resolve(null)), [regNo])
  const [tab, setTab] = useState('vahan')
  useEffect(() => { setTab('vahan') }, [regNo])

  const cutoff = Date.now() - FASTAG_RETENTION_HOURS * 3_600_000
  const liveCrossings = (v?.crossings ?? []).filter((c) => Date.parse(c.ts) >= cutoff)
  const archived = (v?.crossings ?? []).length - liveCrossings.length

  return (
    <Drawer open={!!regNo} onClose={onClose}
      title={v ? <span className="font-mono">{v.regNo}</span> : 'Loading…'}
      sub={v && `${v.makeModel} · ${v.vehicleClass}`}>
      {!v ? <TableSkeleton rows={8} cols={3} /> : (
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={VEHICLE_TONE[v.status]} dot>{v.status}</Badge>
            <Badge tone={v.rcStatus === 'ACTIVE' ? 'ok' : 'bad'}>RC {v.rcStatus}</Badge>
            <Badge tone={v.tagStatus === 'ACTIVE' ? 'ok' : v.tagStatus === 'LOW_BALANCE' ? 'warn' : 'bad'}>
              FASTag {v.tagStatus.replace('_', ' ')}
            </Badge>
            {v.shipmentId && <Badge tone="info">Carrying {v.shipmentId}</Badge>}
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[
              ['Speed', `${v.speedKmph} km/h`, Gauge],
              ['Fuel', `${v.fuelPct}%`, Fuel],
              ['Odometer', `${num(v.odometerKm)} km`, MapPin],
            ].map(([label, value, Icon]) => (
              <Card key={label as string} className="p-3">
                <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-faint">
                  {/* @ts-expect-error tuple icon */}
                  <Icon className="size-3" />{label}
                </div>
                <div className="tnum mt-1 text-[15px] font-semibold">{value as string}</div>
              </Card>
            ))}
          </div>

          <Tabs value={tab} onChange={setTab}>
            <TabList>
              <Tab id="vahan">VAHAN</Tab>
              <Tab id="fastag" count={liveCrossings.length}>FASTag</Tab>
              <Tab id="driver">Driver</Tab>
              <Tab id="analytics">Analytics</Tab>
            </TabList>

            {tab === 'vahan' && (
              <div className="mt-3 space-y-3">
                <Card className="p-3">
                  <div className="mb-1 text-[11px] uppercase tracking-wide text-faint">Registration — VAHAN/01</div>
                  <dl>
                    <KeyVal k="Owner" v={v.owner} />
                    <KeyVal k="Class" v={v.vehicleClass} />
                    <KeyVal k="Fuel" v={v.fuel} />
                    <KeyVal k="GVW" v={`${num(v.capacityKg)} kg`} />
                    <KeyVal k="Permit type" v={v.permitType} />
                  </dl>
                </Card>
                <Card className="p-3">
                  <div className="mb-1 text-[11px] uppercase tracking-wide text-faint">Statutory validity</div>
                  <Validity label="Fitness (rcFitUpto)" iso={v.fitnessUpto} />
                  <Validity label="Insurance (rcInsuranceUpto)" iso={v.insuranceUpto} />
                  <Validity label="PUC (rcPuccUpto)" iso={v.pucUpto} />
                  <Validity label="Permit" iso={v.permitUpto} />
                  <Validity label="Driving licence" iso={v.dlValidUpto} />
                </Card>
              </div>
            )}

            {tab === 'fastag' && (
              <div className="mt-3 space-y-3">
                <div className="flex items-start gap-2 rounded-lg border border-info/25 bg-info-soft p-2.5 text-[11px] leading-relaxed text-info">
                  <Info className="mt-px size-3.5 shrink-0" />
                  <p>
                    <span className="font-semibold">FASTAG/01 returns only the last {FASTAG_RETENTION_HOURS} hours.</span>{' '}
                    {liveCrossings.length} crossing{liveCrossings.length === 1 ? '' : 's'} are inside that live window.
                    {archived > 0 && <> {archived} older crossing{archived === 1 ? '' : 's'} shown below come from this platform's own polled history, not from a live call.</>}
                  </p>
                </div>
                <Card className="p-3">
                  <dl>
                    <KeyVal k="Tag ID" v={v.tagId} mono />
                    <KeyVal k="Issuing bank" v={v.tagBank} />
                    <KeyVal k="Balance" v={inr(v.tagBalance, false)} />
                  </dl>
                </Card>
                <div className="overflow-hidden rounded-xl border border-line">
                  <table className="w-full">
                    <thead className="bg-surface-2"><tr>
                      <Th>Plaza</Th><Th>Read time</Th><Th className="text-right">Amount</Th><Th className="text-right">Source</Th>
                    </tr></thead>
                    <tbody className="divide-y divide-line-soft">
                      {v.crossings.map((c) => {
                        const live = Date.parse(c.ts) >= cutoff
                        return (
                          <tr key={c.id} className={cn(!live && 'opacity-65')}>
                            <Td className="font-medium">{c.plaza}<div className="text-[10px] text-faint">Lane {c.lane} · {c.direction}</div></Td>
                            <Td className="tnum text-[12px] text-muted">{dt(c.ts)}</Td>
                            <Td className="tnum text-right">{inr(c.amount, false)}</Td>
                            <Td className="text-right">
                              <Badge tone={live ? 'ok' : 'neutral'}>{live ? 'Live' : 'Stored'}</Badge>
                            </Td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tab === 'driver' && (
              <Card className="mt-3 p-3">
                <div className="mb-1 text-[11px] uppercase tracking-wide text-faint">SARATHI/01</div>
                <dl>
                  <KeyVal k="Name" v={v.driverName} />
                  <KeyVal k="Licence" v={v.driverDl} mono />
                  <KeyVal k="Valid upto" v={d(v.dlValidUpto)} />
                  <KeyVal k="Contact" v={v.driverPhone} mono />
                </dl>
                <div className="mt-3">
                  <div className="mb-1 flex justify-between text-[11px]">
                    <span className="text-muted">Behaviour score</span>
                    <span className="tnum font-medium">{v.driverScore}/100</span>
                  </div>
                  <Meter value={v.driverScore} tone={v.driverScore >= 80 ? 'ok' : v.driverScore >= 65 ? 'warn' : 'bad'} />
                </div>
              </Card>
            )}

            {tab === 'analytics' && (
              <div className="mt-3 space-y-3">
                <Card className="p-3">
                  <div className="mb-2 text-[11px] uppercase tracking-wide text-faint">Rolling 30 days — platform history</div>
                  <dl>
                    <KeyVal k="Distance covered" v={`${num(v.distance30dKm)} km`} />
                    <KeyVal k="Toll spend" v={inr(v.tollSpend30d)} />
                    <KeyVal k="Idle hours" v={`${v.idleHrs} h`} />
                    <KeyVal k="Detention hours" v={`${v.detentionHrs} h`} />
                  </dl>
                  <div className="mt-3">
                    <div className="mb-1 flex justify-between text-[11px]">
                      <span className="text-muted">Utilisation</span>
                      <span className="tnum font-medium">{v.utilisationPct}%</span>
                    </div>
                    <Meter value={v.utilisationPct} tone={v.utilisationPct >= 75 ? 'ok' : 'warn'} />
                  </div>
                </Card>
                <Card className="overflow-hidden">
                  <NetworkMap className="aspect-[4/3] w-full" showLabels={false}
                    markers={[{ id: v.regNo, lat: v.lat, lon: v.lon, tone: 'brand', pulse: v.status === 'moving', r: 5 }]} />
                </Card>
              </div>
            )}
          </Tabs>
        </div>
      )}
    </Drawer>
  )
}

/* Same pattern as the consignment table: one definition per column, and the
   lens picks the list. Nothing here is unreachable — the vehicle drawer shows
   every field whatever columns the role leads with. */
interface FleetColumn {
  head: string
  right?: boolean
  cell: (v: Vehicle) => React.ReactNode
}

const FLEET_COLUMNS: Record<FleetCol, FleetColumn> = {
  vehicle: {
    head: 'Vehicle',
    cell: (v) => (
      <>
        <div className="font-mono text-[12px] font-medium">{v.regNo}</div>
        <div className="truncate text-[11px] text-faint">{v.makeModel}</div>
      </>
    ),
  },
  driver: {
    head: 'Driver',
    cell: (v) => (
      <>
        <div className="text-[12px]">{v.driverName}</div>
        <div className="text-[10px] text-faint">Score {v.driverScore}</div>
      </>
    ),
  },
  state: {
    head: 'State',
    cell: (v) => <Badge tone={VEHICLE_TONE[v.status]} dot>{v.status}</Badge>,
  },
  compliance: {
    head: 'Compliance',
    cell: (v) => {
      const expiries = [v.fitnessUpto, v.insuranceUpto, v.pucUpto, v.permitUpto, v.dlValidUpto]
      const expired = expiries.filter((x) => daysTo(x) < 0).length
      const soon = expiries.filter((x) => daysTo(x) >= 0 && daysTo(x) < 21).length
      return expired ? <Badge tone="bad"><ShieldAlert className="size-3" />{expired} expired</Badge>
        : soon ? <Badge tone="warn">{soon} expiring</Badge>
        : <Badge tone="ok"><BadgeCheck className="size-3" />Clear</Badge>
    },
  },
  fastag: {
    head: 'FASTag', right: true,
    cell: (v) => (
      <>
        <div className="tnum text-[12px]">{inr(v.tagBalance, false)}</div>
        <div className="text-[10px] text-faint">{v.tagStatus.replace('_', ' ').toLowerCase()}</div>
      </>
    ),
  },
  utilisation: {
    head: 'Utilisation', right: true,
    cell: (v) => (
      <div className="flex items-center justify-end gap-2">
        <Meter value={v.utilisationPct} tone={v.utilisationPct >= 75 ? 'ok' : 'warn'} className="w-14" />
        <span className="tnum w-8 text-right text-[11px] text-muted">{v.utilisationPct}%</span>
      </div>
    ),
  },
}

export function Fleet() {
  const { session } = useApp()
  /* No banner here: the compliance Select below already shows the filter
     and clears it in one click, which is the whole point of the rule. */
  const opens = lensFor(session?.org.role ?? 'Shipper').pageDefaults.fleet
  const cols = opens.columns

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<Vehicle['status'] | 'all'>('all')
  const [compliance, setCompliance] = useState<'all' | 'issues'>(opens.compliance)
  const [page, setPage] = useState(1)
  const [openReg, setOpenReg] = useState<string | null>(null)

  const q = useDebounced(search)
  useEffect(() => { setPage(1) }, [q, status, compliance])

  const { data, loading } = useAsync(
    () => adapter.listVehicles({ search: q, status, compliance, page, pageSize: 25 }),
    [q, status, compliance, page])

  const pages = data ? Math.max(1, Math.ceil(data.total / 25)) : 1

  return (
    <div className="space-y-3 p-3 sm:p-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Fleet intelligence</h1>
        <p className="text-[13px] text-muted">
          VAHAN registration, SARATHI licences and FASTag movement, reconciled per vehicle.
        </p>
      </header>

      <Card className="p-3">
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8"
              placeholder="Registration, driver, owner, tag…" />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value as Vehicle['status'] | 'all')}>
            <option value="all">All states</option>
            {(['moving', 'idle', 'loading', 'maintenance', 'offline'] as const).map((s) =>
              <option key={s} value={s}>{s}</option>)}
          </Select>
          <Select value={compliance} onChange={(e) => setCompliance(e.target.value as 'all' | 'issues')}>
            <option value="all">All vehicles</option>
            <option value="issues">Compliance issues only</option>
          </Select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {loading && !data ? <TableSkeleton rows={9} cols={cols.length} /> : !data?.rows.length ? (
          <Empty icon={Truck} title="No vehicles match" sub="Widen the filters to see the rest of the fleet." />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full">
                <thead className="border-b border-line-soft bg-surface-2/50"><tr>
                  {cols.map((c) => (
                    <Th key={c} className={FLEET_COLUMNS[c].right ? 'text-right' : undefined}>
                      {FLEET_COLUMNS[c].head}
                    </Th>
                  ))}
                </tr></thead>
                <tbody className="divide-y divide-line-soft">
                  {data.rows.map((v) => {
                    return (
                      <tr key={v.regNo} onClick={() => setOpenReg(v.regNo)}
                        className="cursor-pointer transition-colors hover:bg-surface-2/60">
                        {cols.map((c) => (
                          <Td key={c} className={FLEET_COLUMNS[c].right ? 'text-right' : undefined}>
                            {FLEET_COLUMNS[c].cell(v)}
                          </Td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-line-soft md:hidden">
              {data.rows.map((v) => (
                <button key={v.regNo} onClick={() => setOpenReg(v.regNo)} className="w-full px-3.5 py-3 text-left active:bg-surface-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-mono text-[13px] font-medium">{v.regNo}</div>
                      <div className="text-[11px] text-muted"><UserRound className="mr-1 inline size-3" />{v.driverName}</div>
                    </div>
                    <Badge tone={VEHICLE_TONE[v.status]} dot>{v.status}</Badge>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-muted">
                    <Receipt className="size-3" />{inr(v.tagBalance, false)}
                    <Meter value={v.utilisationPct} tone={v.utilisationPct >= 75 ? 'ok' : 'warn'} className="ml-auto w-16" />
                  </div>
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-line-soft px-3.5 py-2.5">
              <span className="text-[12px] text-muted">Page {page} of {pages} · {num(data.total)} vehicles</span>
              <div className="flex gap-1.5">
                <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <Button size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          </>
        )}
      </Card>

      <VehicleDetail regNo={openReg} onClose={() => setOpenReg(null)} />
    </div>
  )
}
