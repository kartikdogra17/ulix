import { useRef, useState } from 'react'
import { FileUp, Link2, TriangleAlert, Trash2, Upload } from 'lucide-react'
import {
  clearBook, importConsignments, loadBook, saveBook,
  type ImportReport, type ImportedRow,
} from '../data/importer'
import { ULIP_MODE } from '../data'
import { Badge, Button, Card, CardHead, Empty, Mono, Td, Th } from '../components/ui'
import { Sources } from '../components/cases'
import { inr, num } from '../lib/format'
import { cn } from '../lib/cn'

const SAMPLE = `Docket No,E-Way Bill No,Vehicle Reg,From,To,Goods,Gross Weight,Invoice Value
DKT-1001,101000609218,MH19JK3923,Pune,Nagpur,"Steel coils, hot rolled",18500,"₹12,45,000"
DKT-1002,231000774512,GJ01AB4471,Ahmedabad,Delhi,Textiles,9000,340000
DKT-1003,,KA51AB1234,Chennai,Kochi,Tea chests,4200,180000`

export function ImportPage() {
  const [report, setReport] = useState<ImportReport | null>(null)
  const [book, setBook] = useState<ImportedRow[]>(loadBook)
  const [paste, setPaste] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const run = (text: string) => setReport(importConsignments(text))

  const onFile = (file: File | undefined) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => run(String(reader.result ?? ''))
    reader.readAsText(file)
  }

  const keep = () => {
    if (!report) return
    saveBook(report.rows)
    setBook(report.rows)
  }

  return (
    <div className="space-y-3 p-3 sm:p-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Import consignments</h1>
        <p className="max-w-3xl text-[13px] leading-relaxed text-muted">
          ULIP is a lookup platform: every dataset is keyed by an identifier you already
          hold, and nothing answers <em>what am I shipping today</em>. Bring your book from
          the system that does know — a CSV export from your TMS or ERP — and each row is
          matched to the endpoints that can enrich it.
        </p>
      </header>

      {book.length > 0 && (
        <Card>
          <CardHead title="Current book"
            sub={`${num(book.length)} consignments · ${num(book.filter((r) => r.resolvable.length).length)} with a usable key`}
            right={
              <Button size="sm" variant="ghost" onClick={() => { clearBook(); setBook([]) }}>
                <Trash2 className="size-3.5" /> Clear
              </Button>
            } />
        </Card>
      )}

      <Card>
        <CardHead title="Load a file" sub="CSV from your TMS. Nothing is uploaded — it is parsed in this browser." />
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="hidden"
              onChange={(e) => onFile(e.target.files?.[0])} />
            <Button variant="primary" onClick={() => fileRef.current?.click()}>
              <FileUp className="size-4" /> Choose CSV
            </Button>
            <Button variant="outline" onClick={() => { setPaste(SAMPLE); run(SAMPLE) }}>
              Try a sample
            </Button>
          </div>

          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">
              Or paste rows
            </div>
            <textarea value={paste} onChange={(e) => setPaste(e.target.value)}
              onBlur={() => paste.trim() && run(paste)}
              rows={4} spellCheck={false}
              placeholder="Docket No,E-Way Bill No,Vehicle Reg,From,To…"
              className="w-full rounded-lg border border-line bg-surface p-2.5 font-mono text-[12px] placeholder:text-faint focus:border-brand/60 focus:outline-none focus:ring-2 focus:ring-brand/20" />
            <p className="mt-1 text-[11px] text-faint">
              Recognised columns include docket/CN/LR number, e-Way Bill, vehicle registration,
              from, to, goods, weight and invoice value. Anything else is carried through
              untouched.
            </p>
          </div>
        </div>
      </Card>

      {report?.fatal && (
        <Card className="border-bad/40">
          <div className="flex items-start gap-2.5 p-4">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-bad" />
            <div>
              <div className="text-[13px] font-medium">That file cannot be used</div>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">{report.fatal}</p>
            </div>
          </div>
        </Card>
      )}

      {report && !report.fatal && (
        <>
          <Card>
            <CardHead title="What came through"
              right={
                <Button size="sm" variant="primary" onClick={keep}>
                  <Upload className="size-3.5" /> Use as my book
                </Button>
              } />
            <div className="grid grid-cols-2 gap-px bg-line-soft sm:grid-cols-4">
              {[
                ['Rows', num(report.rows.length), 'neutral'],
                ['Can be enriched', num(report.ready), report.ready ? 'ok' : 'warn'],
                ['No usable key', num(report.blocked), report.blocked ? 'warn' : 'ok'],
                ['Columns ignored', num(report.unmapped.length), 'neutral'],
              ].map(([label, value, tone]) => (
                <div key={label as string} className="bg-surface px-4 py-3">
                  <div className="text-[10px] font-medium uppercase tracking-[0.1em] text-faint">
                    {label as string}
                  </div>
                  <div className={cn('tnum mt-0.5 text-[20px] font-semibold tracking-tight',
                    tone === 'warn' && 'text-warn', tone === 'ok' && 'text-ok')}>
                    {value as string}
                  </div>
                </div>
              ))}
            </div>
            <div className="space-y-1.5 border-t border-line-soft px-4 py-3 text-[11px] leading-relaxed">
              <div>
                <span className="text-faint">Mapped: </span>
                {report.mapped.map((m) => (
                  <Mono key={m.header} className="mr-1">{m.header} → {m.field}</Mono>
                ))}
              </div>
              {report.unmapped.length > 0 && (
                <div className="text-muted">
                  <span className="text-faint">Carried through unused: </span>
                  {report.unmapped.join(', ')}
                </div>
              )}
              <p className="border-t border-line-soft pt-2 text-faint">
                Identifiers are checked against the same regexes the gateway enforces, using the
                same code path the real call uses — a row marked ready here will not be refused
                at the counter for its format.{' '}
                {ULIP_MODE === 'live'
                  ? 'Live gateway: these lookups will hit the real registers.'
                  : 'Simulated gateway: the lookups below are the ones that WOULD be called; connect credentials to run them.'}
              </p>
            </div>
          </Card>

          <Card className="overflow-hidden">
            {!report.rows.length ? (
              <Empty icon={Link2} title="No rows" sub="The file had headers but nothing under them." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-line-soft bg-surface-2/50"><tr>
                    <Th>Consignment</Th><Th>Lane</Th><Th>e-Way Bill</Th><Th>Vehicle</Th>
                    <Th>Resolves against</Th><Th className="text-right">Value</Th>
                  </tr></thead>
                  <tbody className="divide-y divide-line-soft">
                    {report.rows.slice(0, 60).map((r) => (
                      <tr key={r.line} className={cn(!r.resolvable.length && 'opacity-60')}>
                        <Td>
                          <div className="font-medium">{r.ref}</div>
                          <div className="text-[11px] text-faint">line {r.line} · {r.commodity ?? '—'}</div>
                        </Td>
                        <Td className="text-[12px]">
                          {r.origin ?? '—'}<span className="mx-1 text-faint">→</span>{r.destination ?? '—'}
                        </Td>
                        <Td><Mono>{r.ewayBill ?? '—'}</Mono></Td>
                        <Td><Mono>{r.vehicleNo ?? '—'}</Mono></Td>
                        <Td>
                          {r.resolvable.length
                            ? <Sources ids={r.resolvable} />
                            : <Badge tone="warn">nothing to look up</Badge>}
                          {r.problems.map((p, i) => (
                            <div key={i} className="mt-1 text-[10px] leading-relaxed text-bad">
                              {p.message}
                            </div>
                          ))}
                        </Td>
                        <Td className="tnum text-right">
                          {r.invoiceValue !== undefined ? inr(r.invoiceValue) : '—'}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {report.rows.length > 60 && (
                  <p className="border-t border-line-soft px-4 py-2 text-[11px] text-faint">
                    Showing the first 60 of {num(report.rows.length)}. All of them import.
                  </p>
                )}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
