/* ────────────────────────────────────────────────────────────────
   A consignment book, from a CSV.

   ULIP is a lookup API: every endpoint is keyed by an identifier you
   already hold, and nothing answers "what am I shipping today". The book
   therefore has to come from the customer's own system, and until there
   is a TMS integration the shortest honest path is the file they already
   export from it.

   Rows are validated with `UlipClient.validate` — the same call path the
   gateway request uses, against the same regexes quoted in the
   integration documents. That matters: a preview that validates
   differently from the actual call is worse than no preview, because it
   promises a lookup will work and then fails at the counter.
   ──────────────────────────────────────────────────────────────── */

import { UlipClient } from './ulip/client'

/**
 * RFC 4180 enough for what finance systems actually export: quoted
 * fields, embedded commas and newlines, doubled quotes, CRLF, and the BOM
 * Excel puts on the front that otherwise corrupts the first header.
 */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else { quoted = false }
      } else field += c
      continue
    }
    if (c === '"') { quoted = true; continue }
    if (c === ',') { row.push(field); field = ''; continue }
    // A bare \r only appears as part of CRLF in anything modern.
    if (c === '\r') continue
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue }
    field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((f) => f.trim() !== ''))
}

export type Field =
  | 'ref' | 'ewayBill' | 'vehicleNo' | 'origin' | 'destination'
  | 'commodity' | 'weightKg' | 'invoiceValue' | 'consignor' | 'consignee'

/** Header spellings seen in real TMS and ERP exports. */
const ALIASES: Record<Field, string[]> = {
  ref: ['consignment', 'consignment no', 'consignment number', 'cn', 'cn no', 'cn number',
    'reference', 'ref', 'docket', 'docket no', 'lr', 'lr no', 'lr number', 'shipment id'],
  ewayBill: ['eway', 'ewaybill', 'eway bill', 'e way bill', 'e way bill no', 'ewb',
    'ewb no', 'ewb number', 'eway bill no', 'eway bill number'],
  vehicleNo: ['vehicle', 'vehicle no', 'vehicle number', 'vehicle reg', 'registration',
    'registration no', 'reg no', 'truck', 'truck no', 'lorry', 'lorry no'],
  origin: ['origin', 'from', 'source', 'pickup', 'origin city', 'from location'],
  destination: ['destination', 'to', 'drop', 'delivery', 'destination city', 'to location'],
  commodity: ['commodity', 'goods', 'material', 'item', 'description', 'product'],
  weightKg: ['weight', 'weight kg', 'weightkg', 'gross weight', 'net weight', 'qty kg'],
  invoiceValue: ['value', 'invoice value', 'invoice amount', 'amount', 'invoice', 'inv value'],
  consignor: ['consignor', 'shipper', 'sender', 'from party', 'seller'],
  consignee: ['consignee', 'receiver', 'buyer', 'to party', 'customer'],
}

const normalise = (h: string) =>
  h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export interface RowProblem { field: Field; value: string; message: string }

export interface ImportedRow {
  /** 1-based line in the file, so an error can be found in the original. */
  line: number
  ref: string
  ewayBill?: string
  vehicleNo?: string
  origin?: string
  destination?: string
  commodity?: string
  weightKg?: number
  invoiceValue?: number
  consignor?: string
  consignee?: string
  /** Endpoints this row carries a usable key for. */
  resolvable: string[]
  problems: RowProblem[]
}

export interface ImportReport {
  headers: string[]
  /** Header → field, for the columns that were understood. */
  mapped: Array<{ header: string; field: Field }>
  /** Columns carried through untouched; not an error, just unused. */
  unmapped: string[]
  rows: ImportedRow[]
  /** Rows that can be looked up against at least one endpoint. */
  ready: number
  /** Rows with a malformed identifier — they import, but cannot be enriched. */
  blocked: number
  /** Fatal problems with the file itself. */
  fatal: string | null
}

const num = (raw: string | undefined): number | undefined => {
  if (!raw) return undefined
  // Indian exports commonly carry thousands separators and a currency mark.
  const n = Number(raw.replace(/[₹,\s]/g, ''))
  return Number.isFinite(n) ? n : undefined
}

export function importConsignments(text: string): ImportReport {
  const grid = parseCsv(text)
  if (!grid.length) {
    return { headers: [], mapped: [], unmapped: [], rows: [], ready: 0, blocked: 0,
      fatal: 'That file has no rows.' }
  }

  const headers = grid[0].map((h) => h.trim())
  const lookup = new Map<number, Field>()
  const mapped: Array<{ header: string; field: Field }> = []
  const unmapped: string[] = []

  headers.forEach((h, i) => {
    const key = normalise(h)
    const hit = (Object.entries(ALIASES) as Array<[Field, string[]]>)
      .find(([, names]) => names.includes(key))
    if (hit && ![...lookup.values()].includes(hit[0])) {
      lookup.set(i, hit[0])
      mapped.push({ header: h, field: hit[0] })
    } else unmapped.push(h)
  })

  if (!mapped.some((m) => m.field === 'ewayBill' || m.field === 'vehicleNo')) {
    return {
      headers, mapped, unmapped, rows: [], ready: 0, blocked: 0,
      fatal: 'No e-Way Bill or vehicle number column was recognised. ULIP can only look up '
        + 'what it is given a key for, so at least one of those is required. '
        + `Columns found: ${headers.join(', ') || 'none'}.`,
    }
  }

  const rows: ImportedRow[] = []
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r]
    const get = (f: Field) => {
      for (const [i, field] of lookup) if (field === f) return cells[i]?.trim() || undefined
      return undefined
    }

    const ewayBill = get('ewayBill')
    const vehicleNo = get('vehicleNo')?.toUpperCase().replace(/[\s-]/g, '')
    const problems: RowProblem[] = []
    const resolvable: string[] = []

    if (ewayBill) {
      const bad = UlipClient.validate('EWAYBILL/01', { ewbNo: ewayBill })
      if (bad) problems.push({ field: 'ewayBill', value: ewayBill, message: bad })
      else resolvable.push('EWAYBILL/01')
    }
    if (vehicleNo) {
      const bad = UlipClient.validate('VAHAN/01', { vehiclenumber: vehicleNo })
      if (bad) problems.push({ field: 'vehicleNo', value: vehicleNo, message: bad })
      else resolvable.push('VAHAN/01', 'FASTAG/01')
    }
    if (!ewayBill && !vehicleNo) {
      problems.push({ field: 'ref', value: '', message: 'No e-Way Bill and no vehicle number — nothing to look up.' })
    }

    rows.push({
      line: r + 1,
      ref: get('ref') ?? `row ${r + 1}`,
      ewayBill, vehicleNo,
      origin: get('origin'), destination: get('destination'),
      commodity: get('commodity'),
      weightKg: num(get('weightKg')),
      invoiceValue: num(get('invoiceValue')),
      consignor: get('consignor'), consignee: get('consignee'),
      resolvable, problems,
    })
  }

  return {
    headers, mapped, unmapped, rows,
    ready: rows.filter((r) => r.resolvable.length > 0).length,
    blocked: rows.filter((r) => r.resolvable.length === 0).length,
    fatal: null,
  }
}

/* ── The book, kept between visits ───────────────────────────── */

const LS_BOOK = 'ulip.book'

export function saveBook(rows: ImportedRow[]) {
  try { localStorage.setItem(LS_BOOK, JSON.stringify(rows)) } catch { /* quota or blocked */ }
}

export function loadBook(): ImportedRow[] {
  try {
    const raw = localStorage.getItem(LS_BOOK)
    return raw ? (JSON.parse(raw) as ImportedRow[]) : []
  } catch { return [] }
}

export function clearBook() {
  try { localStorage.removeItem(LS_BOOK) } catch { /* ignore */ }
}
