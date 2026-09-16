/* GET /api/cases — every record with its version.
   Mirrors the proxy route of the same name exactly, because the client
   cannot tell which one it is talking to and must not need to. */
import { send, store } from '../_store'

export default async function handler(
  req: { method?: string },
  res: { status: (n: number) => { json: (b: unknown) => void } },
) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' })
  try {
    const db = await store()
    return send(res, 200, { cases: await db.all(), serverTime: new Date().toISOString() })
  } catch (err) {
    // 503 rather than 500: the queue is unavailable, not broken. The client
    // falls back to local storage on a failed probe, which is correct here.
    return send(res, 503, { error: (err as Error).message })
  }
}
