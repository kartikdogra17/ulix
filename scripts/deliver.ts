/* ────────────────────────────────────────────────────────────────
   The delivery job.

   Sending was a button, which meant a conflict raised while nobody was
   looking waited for somebody to look — the exact failure the delivery
   path exists to fix. This runs headless, on a timer, with nobody
   watching.

   It does NOT import MockAdapter. That would pull in the whole browser
   data layer for the sake of two lists; instead it builds the same
   deterministic world from the same seed and talks to the proxy over the
   same HTTP contract the client uses. So the marks it writes are the
   marks the client reads, and neither can send a case the other already
   sent.

   Run:
     ULIP_PROXY_URL=http://localhost:8787 npx tsx scripts/deliver.ts
     npx tsx scripts/deliver.ts --dry-run     # decide, print, send nothing

   Schedule with cron, a systemd timer, or any scheduler that can run a
   command. Fifteen minutes is a sensible cadence: the tightest SLA here
   is four hours, so anything faster is noise.
   ──────────────────────────────────────────────────────────────── */

import { makeDocs, makeShipments, makeVehicles } from '../src/data/mock/generate'
import { NODE_BY_CODE } from '../src/data/mock/seed'
import { makeGatiShakti } from '../src/data/gatishakti'
import { fetchAirQuality } from '../src/data/osint'
import { fetchDisruptions } from '../src/data/disruptions'
import { signalsForShipment } from '../src/data/fusion'
import { appendActivity, blankCase, type Case, type CaseRecord } from '../src/data/cases'
import { DEFAULT_RULE, buildPayload, selectForDelivery } from '../src/data/notify'

const PROXY = process.env.ULIP_PROXY_URL ?? 'http://localhost:8787'
const APP_URL = process.env.ULIP_APP_URL
const DRY = process.argv.includes('--dry-run')

interface Stored { record: CaseRecord; version: number }

const log = (m: string) => console.log(`[deliver] ${m}`)
const fail = (m: string): never => { console.error(`[deliver] ${m}`); process.exit(1) }

async function main() {
  /* 1. What the platform sees. Same seed as the browser, so the same world. */
  const shipments = makeShipments()
  const vehicles = makeVehicles(shipments)
  const docs = makeDocs(shipments, vehicles)
  const docsFor = new Map<string, typeof docs>()
  for (const d of docs) {
    if (d.linkedKind !== 'shipment') continue
    docsFor.set(d.linkedTo, [...(docsFor.get(d.linkedTo) ?? []), d])
  }
  /* The same context the browser gives fusion, or the job sees fewer
     signals than the screen and silently skips whole kinds. Corridors and
     the node table are pure; the NCR reading is a real fetch, because a
     GRAP entry ban can be critical and missing it is not acceptable. */
  const corridors = makeGatiShakti().corridors
  const nodeAt = (code: string) => {
    const n = NODE_BY_CODE[code]
    return n ? { lat: n.lat, lon: n.lon } : undefined
  }
  const [ncrAir, feed] = await Promise.all([
    fetchAirQuality(28.61, 77.21).catch(() => null),
    fetchDisruptions().catch(() => null),
  ])
  if (!ncrAir) log('no NCR air reading — GRAP signals will not fire this run')
  log(`disruption feed: ${feed ? `${feed.items.length} items${feed.live ? ' (live)' : ' (simulated fallback)'}` : 'unavailable'}`)

  const signals = shipments.flatMap((s) => signalsForShipment(
    s, vehicles.find((v) => v.shipmentId === s.id) ?? null,
    docsFor.get(s.id) ?? [], Date.now(),
    { nodeAt, corridors, ncrAir, disruptions: feed?.items ?? [] }))
  log(`${signals.length} signals across ${shipments.length} consignments`)

  /* 2. What the humans have already done about it. */
  let stored: Record<string, Stored> = {}
  try {
    const res = await fetch(`${PROXY}/api/cases`)
    if (!res.ok) fail(`case store answered ${res.status}. Is the proxy running?`)
    stored = ((await res.json()) as { cases?: Record<string, Stored> }).cases ?? {}
  } catch {
    fail(`no case store at ${PROXY}. Start the proxy, or set ULIP_PROXY_URL.`)
  }
  log(`${Object.keys(stored).length} existing case records`)

  const now = Date.now()
  const cases: Case[] = signals.map((s) => {
    const rec = stored[s.id]?.record ?? blankCase(s.id, s.detectedAt, now)
    return {
      ...rec,
      signal: s,
      isDue: rec.status === 'snoozed'
        ? !rec.snoozedUntil || Date.parse(rec.snoozedUntil) <= now
        : false,
    }
  })

  /* 3. The rule. Same module the UI uses, so they cannot disagree. */
  const selected = selectForDelivery(cases, DEFAULT_RULE, now)
  if (!selected.length) return log('nothing qualifies. Nothing sent.')

  const payload = buildPayload(selected, DEFAULT_RULE, APP_URL)
  log(`${selected.length} qualify; sending ${payload.cases.length}, counting ${payload.omitted}`)

  if (DRY) {
    console.log('\n' + payload.text + '\n')
    return log('dry run: nothing sent, nothing marked.')
  }

  /* 4. Send, and only then record it. */
  const res = await fetch(`${PROXY}/api/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const ack = (await res.json().catch(() => null)) as { ok?: boolean } | null
  if (!res.ok || ack?.ok !== true) {
    fail(`delivery refused (${res.status}). Nothing marked, so it will be retried.`)
  }

  /* 5. Mark what was listed, pinned to the version read. A conflict means a
        human touched the case between the read and the write; skip it rather
        than clobber, and the next run picks it up. */
  let marked = 0, skipped = 0
  for (const c of payload.cases) {
    const existing = stored[c.signalId]
    const rec = existing?.record ?? blankCase(c.signalId, undefined, now)
    const next = appendActivity(rec, 'scheduler', 'notified', `Delivered — ${c.title}`)
    const put = await fetch(`${PROXY}/api/cases/${encodeURIComponent(c.signalId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ record: next, ifVersion: existing?.version ?? 0 }),
    })
    if (put.ok) marked++
    else skipped++
  }
  log(`delivered ${payload.cases.length}, marked ${marked}${skipped ? `, ${skipped} skipped on a version conflict` : ''}`)
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)))
