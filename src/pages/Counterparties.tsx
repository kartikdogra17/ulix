import { useMemo, useState } from 'react'
import {
  Building2, CircleAlert, CircleCheck, CircleSlash, Clock3, Info,
  Search, ShieldAlert, Users,
} from 'lucide-react'
import { adapter } from '../data'
import { useApp } from '../state/app'
import { lensFor } from '../data/roles'
import { useAsync, useDebounced } from '../lib/useAsync'
import { d, inr, num } from '../lib/format'
import { type CheckStatus, type Counterparty, riskTone } from '../data/counterparty'
import { Donut } from '../components/charts'
import {
  Badge, Button, Card, Drawer, Empty, Input, KeyVal, Meter,
  Mono, Select, Tab, TabList, Tabs, TableSkeleton,
} from '../components/ui'
import { cn } from '../lib/cn'

const CHECK_ICON: Record<CheckStatus, React.ComponentType<{ className?: string }>> = {
  pass: CircleCheck, warn: CircleAlert, fail: CircleSlash, info: Info, unchecked: Clock3,
}
const CHECK_TONE: Record<CheckStatus, string> = {
  pass: 'text-ok', warn: 'text-warn', fail: 'text-bad',
  info: 'text-accent', unchecked: 'text-faint',
}

function CheckRow({ c }: { c: Counterparty['checks'][number] }) {
  const Icon = CHECK_ICON[c.status]
  return (
    <div className="flex items-start gap-2.5 px-3.5 py-2.5">
      <Icon className={cn('mt-0.5 size-4 shrink-0', CHECK_TONE[c.status])} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium">{c.label}</span>
          <Mono className="text-faint">{c.endpoint}</Mono>
        </div>
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{c.detail}</p>
      </div>
    </div>
  )
}

function PartyDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data: p } = useAsync(
    () => (id ? adapter.getCounterparty(id) : Promise.resolve(null)), [id])
  const [tab, setTab] = useState('checks')

  return (
    <Drawer open={!!id} onClose={onClose} width="max-w-2xl"
      title={p?.name ?? 'Loading…'}
      sub={p && <span className="font-mono">{p.cin}</span>}>
      {!p ? <TableSkeleton rows={7} cols={2} /> : (
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={riskTone(p.risk)} dot>{p.risk}</Badge>
            <Badge tone={p.companyStatus === 'Active' ? 'ok' : 'bad'}>{p.companyStatus}</Badge>
            {p.roles.map((r) => <Badge key={r} tone="neutral">{r}</Badge>)}
            {p.enterpriseClass && (
              <Badge tone="info">MSME · {p.enterpriseClass}</Badge>
            )}
          </div>

          {/* The two things worth knowing before you book */}
          {p.risk === 'blocked' && (
            <Card className="border-bad/35 bg-bad-soft/40 p-3">
              <div className="flex items-start gap-2.5">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-bad" />
                <p className="text-[13px] leading-relaxed">
                  <strong>Do not book new business.</strong>{' '}
                  {p.checks.find((c) => c.status === 'fail')?.detail}
                </p>
              </div>
            </Card>
          )}
          {(p.enterpriseClass === 'Micro' || p.enterpriseClass === 'Small') && (
            <Card className="border-accent/30 bg-accent-soft/50 p-3">
              <div className="flex items-start gap-2.5">
                <Clock3 className="mt-0.5 size-4 shrink-0 text-accent" />
                <p className="text-[13px] leading-relaxed">
                  <strong>45-day payment clock.</strong> {p.name} is a registered{' '}
                  {p.enterpriseClass.toLowerCase()} enterprise, so invoices must be settled
                  within 45 days under s.15 of the MSMED Act — compound interest at three
                  times the RBI bank rate applies beyond that.
                </p>
              </div>
            </Card>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="p-3">
              <div className="text-[11px] uppercase tracking-wide text-faint">Consignments</div>
              <div className="tnum mt-1 text-[18px] font-semibold">{num(p.shipments)}</div>
            </Card>
            <Card className="p-3">
              <div className="text-[11px] uppercase tracking-wide text-faint">Value handled</div>
              <div className="tnum mt-1 text-[18px] font-semibold">{inr(p.valueHandled)}</div>
            </Card>
            <Card className="p-3">
              <div className="text-[11px] uppercase tracking-wide text-faint">Risk score</div>
              <div className="tnum mt-1 text-[18px] font-semibold">{p.score}<span className="text-xs text-faint">/100</span></div>
              <Meter value={p.score} tone={riskTone(p.risk)} className="mt-1.5" />
            </Card>
          </div>

          <Tabs value={tab} onChange={setTab}>
            <TabList>
              <Tab id="checks" count={p.checks.length}>Checks</Tab>
              <Tab id="registry">Registry</Tab>
              <Tab id="directors" count={p.directors.length}>Directors</Tab>
            </TabList>

            {tab === 'checks' && (
              <Card className="mt-3 divide-y divide-line-soft">
                {p.checks.map((c) => <CheckRow key={c.id} c={c} />)}
              </Card>
            )}

            {tab === 'registry' && (
              <Card className="mt-3 p-3">
                <dl>
                  <KeyVal k="CIN" v={p.cin} mono />
                  <KeyVal k="Status" v={p.companyStatus} />
                  <KeyVal k="Incorporated" v={d(p.incorporationDate)} />
                  <KeyVal k="Registrar" v={p.rocName} />
                  <KeyVal k="Registered state" v={p.registeredState} />
                  <KeyVal k="Turnover band" v={p.turnoverBand} />
                  <KeyVal k="GSTIN" v={p.gstin} mono />
                  <KeyVal k="Udyam" v={p.udyamNo ?? '— not registered'} mono={!!p.udyamNo} />
                  <KeyVal k="MSME class" v={p.enterpriseClass ?? '—'} />
                  <KeyVal k="IEC" v={p.iecNumber ? `${p.iecNumber} · ${p.iecStatus}` : '— no EXIM'} />
                </dl>
              </Card>
            )}

            {tab === 'directors' && (
              <div className="mt-3 space-y-2">
                {p.directors.map((dir) => (
                  <Card key={dir.din} className="flex items-center gap-3 p-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-3 text-[10px] font-semibold">
                      {dir.name.split(' ').map((x) => x[0]).join('')}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium">{dir.name}</div>
                      <div className="text-[11px] text-faint">
                        DIN <Mono>{dir.din}</Mono> · appointed {d(dir.appointedOn)}
                      </div>
                    </div>
                    <Badge tone={dir.dinStatus === 'Approved' ? 'ok' : 'bad'}>{dir.dinStatus}</Badge>
                  </Card>
                ))}
                {p.relatedParties.length > 0 && (
                  <Card className="p-3">
                    <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium">
                      <Users className="size-3.5 text-warn" /> Shared directorships
                    </div>
                    <p className="text-[12px] leading-relaxed text-muted">
                      {p.relatedParties.join(', ')}
                    </p>
                  </Card>
                )}
              </div>
            )}
          </Tabs>
        </div>
      )}
    </Drawer>
  )
}

export function Counterparties() {
  const [search, setSearch] = useState('')
  const { session } = useApp()
  /* The risk Select shows and clears this, so no banner. */
  const opens = lensFor(session?.org.role ?? 'Shipper').pageDefaults.parties
  const [risk, setRisk] = useState<'all' | Counterparty['risk']>(opens.risk)
  const [openId, setOpenId] = useState<string | null>(null)
  const q = useDebounced(search)

  const { data: all } = useAsync(() => adapter.counterparties(q), [q])

  const rows = useMemo(
    () => (all ?? []).filter((p) => risk === 'all' || p.risk === risk), [all, risk])

  const tally = useMemo(() => {
    const t = { clear: 0, watch: 0, blocked: 0, msme: 0, exposure: 0 }
    for (const p of all ?? []) {
      t[p.risk]++
      if (p.enterpriseClass === 'Micro' || p.enterpriseClass === 'Small') t.msme++
      if (p.risk === 'blocked') t.exposure += p.valueHandled
    }
    return t
  }, [all])

  return (
    <div className="space-y-3 p-3 sm:p-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Counterparties</h1>
        <p className="text-[13px] text-muted">
          Who you are actually trading with — company standing, directors, MSME status and IEC.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="flex items-center gap-3 p-3.5">
          <Donut size={62} thickness={9}
            centre={String((all ?? []).length)} centreSub="parties"
            segments={[
              { label: 'clear', value: tally.clear, tone: 'ok' },
              { label: 'watch', value: tally.watch, tone: 'warn' },
              { label: 'blocked', value: tally.blocked, tone: 'bad' },
            ]} />
          <div className="min-w-0 space-y-0.5 text-[11px]">
            {([['clear', tally.clear, 'bg-ok'], ['watch', tally.watch, 'bg-warn'], ['blocked', tally.blocked, 'bg-bad']] as const)
              .map(([k, n, dot]) => (
                <button key={k} onClick={() => setRisk(k)}
                  className="flex w-full items-center gap-1.5 text-left hover:text-fg">
                  <span className={cn('size-2 rounded-full', dot)} />
                  <span className="flex-1 capitalize text-muted">{k}</span>
                  <span className="tnum font-medium">{n}</span>
                </button>
              ))}
          </div>
        </Card>
        <Card className="p-3.5">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-faint">
            <ShieldAlert className="size-3" />Value with blocked parties
          </div>
          <div className="tnum mt-1 text-[22px] font-semibold tracking-tight">{inr(tally.exposure)}</div>
          <div className="mt-0.5 text-[11px] text-muted">already moving with them</div>
        </Card>
        <Card className="p-3.5">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-faint">
            <Clock3 className="size-3" />On a 45-day clock
          </div>
          <div className="tnum mt-1 text-[22px] font-semibold tracking-tight">{tally.msme}</div>
          <div className="mt-0.5 text-[11px] text-muted">micro or small, MSMED s.15</div>
        </Card>
        <Card className="p-3.5">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-faint">
            <Building2 className="size-3" />Sources
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {['MCA/03', 'MCA/05', 'UDYAM/01', 'DGFT/01'].map((e) => (
              <span key={e} className="rounded border border-line bg-surface-2 px-1 font-mono text-[10px] leading-4 text-muted">
                {e}
              </span>
            ))}
          </div>
        </Card>
      </div>

      <Card className="p-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8"
              placeholder="Name, CIN, GSTIN, Udyam, IEC or director…" />
          </div>
          <Select value={risk} onChange={(e) => setRisk(e.target.value as typeof risk)} className="sm:w-44">
            <option value="all">All parties</option>
            <option value="blocked">Blocked</option>
            <option value="watch">Watch</option>
            <option value="clear">Clear</option>
          </Select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {!all ? <TableSkeleton rows={8} cols={4} /> : !rows.length ? (
          <Empty icon={Building2} title="No counterparties match"
            sub="Try a different search or risk filter."
            action={<Button size="sm" onClick={() => { setSearch(''); setRisk('all') }}>Reset</Button>} />
        ) : (
          <div className="divide-y divide-line-soft">
            {rows.map((p) => {
              const fails = p.checks.filter((c) => c.status === 'fail').length
              const warns = p.checks.filter((c) => c.status === 'warn').length
              return (
                <button key={p.id} onClick={() => setOpenId(p.id)}
                  className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-2/60">
                  <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg border text-[10px] font-semibold',
                    p.risk === 'blocked' ? 'border-bad/30 bg-bad-soft text-bad'
                      : p.risk === 'watch' ? 'border-warn/30 bg-warn-soft text-warn'
                      : 'border-ok/30 bg-ok-soft text-ok')}>
                    {p.name.split(' ').slice(0, 2).map((x) => x[0]).join('')}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[13px] font-medium">{p.name}</span>
                      {p.companyStatus !== 'Active' && <Badge tone="bad">{p.companyStatus}</Badge>}
                      {(p.enterpriseClass === 'Micro' || p.enterpriseClass === 'Small') && (
                        <Badge tone="info"><Clock3 className="size-3" />45-day</Badge>
                      )}
                      {p.iecStatus && p.iecStatus !== 'Valid' && <Badge tone="bad">IEC {p.iecStatus}</Badge>}
                    </div>
                    <div className="truncate text-[11px] text-faint">
                      <Mono>{p.cin}</Mono> · {p.roles.join(', ')}
                    </div>
                  </div>
                  <div className="hidden shrink-0 text-right sm:block">
                    <div className="tnum text-[12px] font-medium">{inr(p.valueHandled)}</div>
                    <div className="text-[10px] text-faint">{p.shipments} loads</div>
                  </div>
                  <div className="w-20 shrink-0 text-right">
                    {fails > 0 && <Badge tone="bad">{fails} fail</Badge>}
                    {!fails && warns > 0 && <Badge tone="warn">{warns} warn</Badge>}
                    {!fails && !warns && <Badge tone="ok">clear</Badge>}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </Card>

      <PartyDrawer id={openId} onClose={() => setOpenId(null)} />
    </div>
  )
}
