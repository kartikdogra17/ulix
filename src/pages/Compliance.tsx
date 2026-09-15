import { useEffect, useState } from 'react'
import { FileCheck2, Search, ShieldAlert, ShieldCheck } from 'lucide-react'
import { adapter } from '../data'
import { useAsync, useDebounced } from '../lib/useAsync'
import { d, daysTo, inr, num, titleCase } from '../lib/format'
import { docLabel } from '../data/mock/generate'
import { DOC_TONE } from '../lib/status'
import {
  Badge, Button, Card, Empty, Input, Mono, Select, Tab, TabList, Tabs,
  TableSkeleton, Td, Th,
} from '../components/ui'
import type { DocStatus, DocType } from '../data/types'

const DOC_TYPES: DocType[] = [
  'eway', 'gst_invoice', 'lorry_receipt', 'rail_receipt', 'air_waybill',
  'bill_of_lading', 'bill_of_entry', 'shipping_bill',
  'permit', 'insurance', 'puc', 'fitness',
]

const STATUS_TABS: Array<{ id: DocStatus | 'all'; label: string }> = [
  { id: 'all', label: 'Everything' },
  { id: 'mismatch', label: 'Mismatched' },
  { id: 'expired', label: 'Expired' },
  { id: 'expiring', label: 'Expiring' },
  { id: 'pending', label: 'Pending' },
  { id: 'valid', label: 'Valid' },
]

export function Compliance() {
  const [search, setSearch] = useState('')
  const [type, setType] = useState('all')
  const [status, setStatus] = useState<DocStatus | 'all'>('all')
  const [page, setPage] = useState(1)

  const q = useDebounced(search)
  useEffect(() => { setPage(1) }, [q, type, status])

  const { data, loading } = useAsync(
    () => adapter.listDocs({ search: q, type, status, page, pageSize: 30 }),
    [q, type, status, page])

  // Unfiltered counts for the tab badges.
  const { data: all } = useAsync(() => adapter.listDocs({ page: 1, pageSize: 100000 }), [])
  const countOf = (s: DocStatus | 'all') =>
    !all ? undefined
      : s === 'all' ? all.total
      : all.rows.filter((r) => r.status === s).length

  const pages = data ? Math.max(1, Math.ceil(data.total / 30)) : 1
  const healthy = all ? all.rows.filter((r) => r.status === 'valid').length : 0

  return (
    <div className="space-y-3 p-3 sm:p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Documents &amp; compliance</h1>
          <p className="text-[13px] text-muted">
            e-Way Bills, customs filings and statutory vehicle papers, verified against source systems.
          </p>
        </div>
        {all && (
          <div className="flex gap-2">
            <Badge tone="ok"><ShieldCheck className="size-3" />{num(healthy)} valid</Badge>
            <Badge tone="bad"><ShieldAlert className="size-3" />
              {num(all.rows.filter((r) => r.status === 'expired' || r.status === 'mismatch').length)} need action
            </Badge>
          </div>
        )}
      </header>

      <Card className="p-3">
        <Tabs value={status} onChange={(v) => setStatus(v as DocStatus | 'all')}>
          <TabList>
            {STATUS_TABS.map((t) => <Tab key={t.id} id={t.id} count={countOf(t.id)}>{t.label}</Tab>)}
          </TabList>
        </Tabs>
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8"
              placeholder="Document number, consignment, vehicle, issuer…" />
          </div>
          <Select value={type} onChange={(e) => setType(e.target.value)} className="sm:w-56">
            <option value="all">All document types</option>
            {DOC_TYPES.map((t) => <option key={t} value={t}>{docLabel(t)}</option>)}
          </Select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {loading && !data ? <TableSkeleton rows={10} cols={6} /> : !data?.rows.length ? (
          <Empty icon={FileCheck2} title="No documents match"
            sub="Nothing in this category right now — try another status tab." />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full">
                <thead className="border-b border-line-soft bg-surface-2/50"><tr>
                  <Th>Document</Th><Th>Linked to</Th><Th>Issuer</Th>
                  <Th>Validity</Th><Th className="text-right">Value</Th><Th className="text-right">Status</Th>
                </tr></thead>
                <tbody className="divide-y divide-line-soft">
                  {data.rows.map((doc) => {
                    const days = daysTo(doc.validUpto)
                    return (
                      <tr key={doc.id} className="hover:bg-surface-2/50">
                        <Td>
                          <div className="font-medium">{docLabel(doc.type)}</div>
                          <Mono className="text-faint">{doc.number}</Mono>
                        </Td>
                        <Td>
                          <div className="text-[12px]">{doc.linkedTo}</div>
                          <div className="text-[10px] text-faint">{doc.linkedKind}</div>
                        </Td>
                        <Td>
                          <div className="text-[12px]">{doc.issuer}</div>
                          <Badge tone="neutral" className="mt-0.5">{doc.source}</Badge>
                        </Td>
                        <Td>
                          <div className="tnum text-[12px]">{d(doc.validUpto)}</div>
                          <div className={`text-[10px] ${days < 0 ? 'text-bad' : days < 21 ? 'text-warn' : 'text-faint'}`}>
                            {days < 0 ? `${Math.abs(days)}d overdue` : `${days}d remaining`}
                          </div>
                        </Td>
                        <Td className="tnum text-right">{doc.value ? inr(doc.value) : '—'}</Td>
                        <Td className="text-right">
                          <Badge tone={DOC_TONE[doc.status]}>{titleCase(doc.status)}</Badge>
                          {doc.remark && (
                            <div className="mt-1 max-w-[220px] text-right text-[10px] leading-snug text-bad">
                              {doc.remark}
                            </div>
                          )}
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-line-soft md:hidden">
              {data.rows.map((doc) => {
                const days = daysTo(doc.validUpto)
                return (
                  <div key={doc.id} className="px-3.5 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium">{docLabel(doc.type)}</div>
                        <Mono className="text-faint">{doc.number}</Mono>
                      </div>
                      <Badge tone={DOC_TONE[doc.status]}>{titleCase(doc.status)}</Badge>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted">
                      <span>{doc.linkedTo} · {doc.source}</span>
                      <span className={days < 0 ? 'text-bad' : days < 21 ? 'text-warn' : ''}>
                        {days < 0 ? `${Math.abs(days)}d overdue` : `${days}d left`}
                      </span>
                    </div>
                    {doc.remark && <p className="mt-1 text-[11px] text-bad">{doc.remark}</p>}
                  </div>
                )
              })}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-line-soft px-3.5 py-2.5">
              <span className="text-[12px] text-muted">Page {page} of {pages} · {num(data.total)} documents</span>
              <div className="flex gap-1.5">
                <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <Button size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
