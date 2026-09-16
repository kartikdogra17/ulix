/* PUT /api/cases/:signalId — a write pinned to the version you read.
   The compare-and-set happens inside the driver's transaction, not here,
   so this route cannot weaken it by accident. */
import { send, store } from '../_store.js'

export default async function handler(
  req: { method?: string; query?: Record<string, string | string[]>; body?: unknown },
  res: { status: (n: number) => { json: (b: unknown) => void } },
) {
  if (req.method !== 'PUT') return send(res, 405, { error: 'method not allowed' })

  const raw = req.query?.signalId
  const signalId = Array.isArray(raw) ? raw[0] : raw
  if (!signalId) return send(res, 400, { error: 'missing signal id' })

  const body = (typeof req.body === 'string' ? safeParse(req.body) : req.body) as
    { record?: unknown; ifVersion?: number } | null
  if (!body?.record) return send(res, 400, { error: 'body must carry a record' })

  try {
    const db = await store()
    /* Widened at the call site on purpose. The Store interface keeps the
       precise discriminated union because that is the real contract, but
       Vercel compiles api/ without strict, so `ok: true | false` widens to
       boolean, the union stops discriminating, and neither a ternary nor an
       if narrows it. Keeping the honest type in the interface and paying for
       it in one line here beats loosening the contract everywhere. */
    const result = await db.put(signalId, body.record, body.ifVersion) as
      { ok: boolean; version?: number; current?: unknown }
    if (result.ok) return send(res, 200, { ok: true, version: result.version })
    return send(res, 409, { error: 'version conflict', current: result.current })
  } catch (err) {
    return send(res, 503, { error: (err as Error).message })
  }
}

function safeParse(s: string) {
  try { return JSON.parse(s) } catch { return null }
}
