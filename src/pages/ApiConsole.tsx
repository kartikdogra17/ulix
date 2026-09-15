import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle, CheckCircle2, ChevronRight, Copy, FileText, Play,
  Plug, Search, Timer, XCircle,
} from 'lucide-react'
import { adapter } from '../data'
import { useAsync, useDebounced } from '../lib/useAsync'
import { compact, rel } from '../lib/format'
import {
  ULIP_BASE, ULIP_CATEGORIES, ULIP_STATUS_CODES, type UlipCategory,
} from '../data/ulip/catalogue'
import { isNotFound } from '../data/ulip/envelope'
import type { CatalogueEntry } from '../data/mock/gateway'
import {
  Badge, Button, Card, CardHead, Drawer, Empty, Input, Meter, Mono,
  Select, Tab, TabList, Tabs, TableSkeleton, Td, Th,
} from '../components/ui'
import { cn } from '../lib/cn'

const CAT_TONE: Partial<Record<UlipCategory, 'ok' | 'warn' | 'info' | 'brand' | 'neutral'>> = {
  Road: 'brand', Rail: 'info', Maritime: 'ok', Air: 'warn', Customs: 'bad' as never,
}

/* ── Try-it panel ─────────────────────────────────────────────── */

function TryIt({ ep, onClose }: { ep: CatalogueEntry | null; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [result, setResult] = useState<Awaited<ReturnType<typeof adapter.invokeApi>> | null>(null)
  const [running, setRunning] = useState(false)
  const [tab, setTab] = useState('request')

  useEffect(() => {
    if (!ep) return
    setValues(Object.fromEntries(ep.params.map((p) => [p.name, p.example])))
    setResult(null)
    setTab('request')
  }, [ep])

  const run = async () => {
    if (!ep) return
    setRunning(true)
    try {
      setResult(await adapter.invokeApi(ep.id, values))
      setTab('response')
    } finally { setRunning(false) }
  }

  const statusTone = !result ? 'neutral'
    : result.status === 200 ? (isNotFound(result.body) ? 'warn' : 'ok')
    : result.status < 500 ? 'bad' : 'bad'

  return (
    <Drawer open={!!ep} onClose={onClose} width="max-w-3xl"
      title={ep && <span className="font-mono">{ep.id}</span>}
      sub={ep && `${ep.systemLabel} · ${ep.ministry}`}>
      {ep && (
        <div className="space-y-4 p-4">
          <p className="text-[13px] leading-relaxed text-muted">{ep.summary}</p>

          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={ep.subscribed ? 'ok' : 'neutral'} dot>
              {ep.subscribed ? 'Subscribed' : 'Not subscribed'}
            </Badge>
            <Badge tone="neutral">{ep.category}</Badge>
            <Badge tone="neutral"><Timer className="size-3" />{ep.avgLatencyMs} ms avg</Badge>
            <Button size="sm" variant={ep.subscribed ? 'outline' : 'primary'} className="ml-auto"
              onClick={() => adapter.toggleSubscription(ep.id)}>
              {ep.subscribed ? 'Manage access' : 'Request access'}
            </Button>
          </div>

          <Card className="overflow-hidden">
            <CardHead title="Endpoint" sub="POST, JSON body, bearer token" />
            <div className="space-y-1 p-3 font-mono text-[11px]">
              <div><span className="text-faint">prod </span>{ULIP_BASE.production}/<span className="text-brand">{ep.id}</span></div>
              <div><span className="text-faint">stg  </span>{ULIP_BASE.staging}/<span className="text-brand">{ep.id}</span></div>
            </div>
          </Card>

          <Tabs value={tab} onChange={setTab}>
            <TabList>
              <Tab id="request">Request</Tab>
              <Tab id="response">Response</Tab>
              <Tab id="curl">cURL</Tab>
            </TabList>

            {tab === 'request' && (
              <div className="mt-3 space-y-3">
                {!ep.params.length && (
                  <p className="text-[13px] text-muted">This endpoint takes no request parameters.</p>
                )}
                {ep.params.map((p) => (
                  <label key={p.name} className="block">
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <span className="font-mono text-[12px] font-medium">{p.name}</span>
                      {p.format && <code className="truncate text-[10px] text-faint">{p.format}</code>}
                    </div>
                    <Input value={values[p.name] ?? ''} placeholder={p.example}
                      onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))} />
                  </label>
                ))}
                <Button variant="primary" onClick={run} disabled={running} className="w-full">
                  <Play className="size-3.5" />{running ? 'Calling gateway…' : 'Send request'}
                </Button>
              </div>
            )}

            {tab === 'response' && (
              <div className="mt-3 space-y-2">
                {!result ? (
                  <Empty icon={Play} title="No response yet" sub="Send a request to see the envelope." />
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={statusTone as 'ok'} dot>HTTP {result.status}</Badge>
                      <Badge tone="neutral"><Timer className="size-3" />{result.latencyMs} ms</Badge>
                      {result.status === 200 && isNotFound(result.body) && (
                        <Badge tone="warn"><AlertCircle className="size-3" />Inner responseStatus: ERROR</Badge>
                      )}
                    </div>
                    <p className="text-[11px] leading-relaxed text-muted">
                      {ULIP_STATUS_CODES[result.status] ?? 'Unmapped status'}
                    </p>
                    <pre className="max-h-[360px] overflow-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[11px] leading-relaxed">
{JSON.stringify(result.body, null, 2)}
                    </pre>
                  </>
                )}
              </div>
            )}

            {tab === 'curl' && (
              <div className="mt-3">
                <pre className="overflow-x-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[11px] leading-relaxed">
{result?.requestPreview ?? [
  `curl --location '${ULIP_BASE.production}/${ep.id}' \\`,
  `  --header 'Authorization: Bearer <token>' \\`,
  `  --header 'Content-Type: application/json' \\`,
  `  --header 'Accept: application/json' \\`,
  `  --data '${JSON.stringify(Object.fromEntries(ep.params.map((p) => [p.name, p.example])), null, 2)}'`,
].join('\n')}
                </pre>
                <Button size="sm" className="mt-2" onClick={() =>
                  navigator.clipboard?.writeText(result?.requestPreview ?? '')}>
                  <Copy className="size-3.5" /> Copy
                </Button>
              </div>
            )}
          </Tabs>
        </div>
      )}
    </Drawer>
  )
}

/* ── Page ─────────────────────────────────────────────────────── */

export function ApiConsole() {
  const { data: catalogue } = useAsync(() => adapter.apiCatalogue(), [])
  const { data: logs } = useAsync(() => adapter.apiLogs(), [])
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState<UlipCategory | 'all'>('all')
  const [onlySubscribed, setOnlySubscribed] = useState(false)
  const [open, setOpen] = useState<CatalogueEntry | null>(null)

  const q = useDebounced(search).toLowerCase()

  const rows = useMemo(() => (catalogue ?? []).filter((e) => {
    if (cat !== 'all' && e.category !== cat) return false
    if (onlySubscribed && !e.subscribed) return false
    if (q && ![e.id, e.systemLabel, e.ministry, e.summary].join(' ').toLowerCase().includes(q)) return false
    return true
  }), [catalogue, cat, onlySubscribed, q])

  const subscribed = (catalogue ?? []).filter((e) => e.subscribed)
  const okCalls = (logs ?? []).filter((c) => c.status === 200)
  const successPct = logs?.length ? ((okCalls.length / logs.length) * 100).toFixed(1) : '—'
  const p95 = useMemo(() => {
    if (!logs?.length) return 0
    const sorted = [...logs].map((c) => c.latencyMs).sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length * 0.95)]
  }, [logs])

  return (
    <div className="space-y-3 p-3 sm:p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">API gateway console</h1>
          <p className="text-[13px] text-muted">
            The full ULIP catalogue, generated from the published integration documents.
          </p>
        </div>
        <a href="https://goulip.in" target="_blank" rel="noreferrer noopener">
          <Button size="sm" variant="ghost"><FileText className="size-3.5" /> Source documents</Button>
        </a>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Catalogue', catalogue ? `${catalogue.length}` : '—', 'endpoints published'],
          ['Subscribed', `${subscribed.length}`, 'datasets approved for you'],
          ['Success rate', `${successPct}%`, 'last 24h of calls'],
          ['p95 latency', `${p95} ms`, 'across subscribed datasets'],
        ].map(([label, value, sub]) => (
          <Card key={label} className="p-3.5">
            <div className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</div>
            <div className="tnum mt-1 text-[22px] font-semibold tracking-tight">{value}</div>
            <div className="mt-0.5 text-[11px] text-muted">{sub}</div>
          </Card>
        ))}
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.5fr_1fr]">
        {/* Catalogue */}
        <Card className="overflow-hidden">
          <CardHead title="Dataset catalogue" sub={`${rows.length} shown`} />
          <div className="space-y-2 border-b border-line-soft p-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8"
                  placeholder="FASTAG/01, e-Way Bill, customs, ministry…" />
              </div>
              <Select value={cat} onChange={(e) => setCat(e.target.value as UlipCategory | 'all')} className="sm:w-44">
                <option value="all">All categories</option>
                {ULIP_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
            <Button size="sm" variant={onlySubscribed ? 'primary' : 'outline'}
              onClick={() => setOnlySubscribed((v) => !v)}>
              Subscribed only
            </Button>
          </div>

          <div className="max-h-[560px] divide-y divide-line-soft overflow-y-auto">
            {!catalogue && <TableSkeleton rows={8} cols={3} />}
            {catalogue && !rows.length && (
              <Empty icon={Plug} title="No endpoints match" sub="Try a different category or search term." />
            )}
            {rows.map((e) => (
              <button key={e.id} onClick={() => setOpen(e)}
                className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-2/60">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Mono className="font-semibold">{e.id}</Mono>
                    <Badge tone={e.subscribed ? 'ok' : 'neutral'}>
                      {e.subscribed ? 'subscribed' : 'available'}
                    </Badge>
                    <Badge tone={(CAT_TONE[e.category] ?? 'neutral') as 'neutral'}>{e.category}</Badge>
                  </div>
                  <p className="mt-1 line-clamp-1 text-[12px] text-muted">{e.summary}</p>
                  <p className="mt-0.5 text-[10px] text-faint">{e.ministry}</p>
                </div>
                {e.subscribed && (
                  <div className="hidden w-24 shrink-0 sm:block">
                    <Meter value={(e.used / Math.max(1, e.quota)) * 100}
                      tone={e.used / Math.max(1, e.quota) > 0.85 ? 'bad' : 'brand'} />
                    <div className="tnum mt-1 text-right text-[10px] text-faint">
                      {compact(e.used)}/{compact(e.quota)}
                    </div>
                  </div>
                )}
                <ChevronRight className="size-4 shrink-0 text-faint" />
              </button>
            ))}
          </div>
        </Card>

        {/* Logs */}
        <Card className="overflow-hidden">
          <CardHead title="Request log" sub="Most recent gateway calls" />
          <div className="max-h-[560px] overflow-y-auto">
            {!logs ? <TableSkeleton rows={10} cols={3} /> : (
              <table className="w-full">
                <thead className="sticky top-0 border-b border-line-soft bg-surface"><tr>
                  <Th>Endpoint</Th><Th className="text-right">Status</Th><Th className="text-right">Latency</Th>
                </tr></thead>
                <tbody className="divide-y divide-line-soft">
                  {logs.slice(0, 80).map((c) => (
                    <tr key={c.id} className="hover:bg-surface-2/50">
                      <Td>
                        <Mono>{c.endpointId}</Mono>
                        <div className="text-[10px] text-faint">{c.consumer} · {rel(c.ts)}</div>
                      </Td>
                      <Td className="text-right">
                        <span className={cn('inline-flex items-center gap-1 font-mono text-[11px]',
                          c.status === 200 ? (c.resolved ? 'text-ok' : 'text-warn') : 'text-bad')}>
                          {c.status === 200
                            ? (c.resolved ? <CheckCircle2 className="size-3" /> : <AlertCircle className="size-3" />)
                            : <XCircle className="size-3" />}
                          {c.status}
                        </span>
                      </Td>
                      <Td className="tnum text-right text-[11px] text-muted">{c.latencyMs} ms</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      </div>

      <TryIt ep={open} onClose={() => setOpen(null)} />
    </div>
  )
}
