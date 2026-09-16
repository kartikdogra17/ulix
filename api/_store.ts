/* ────────────────────────────────────────────────────────────────
   The case store, for serverless.

   Imports the Postgres driver DIRECTLY rather than going through
   server/store/index.mjs, which would statically pull in the SQLite
   driver and therefore `node:sqlite`. A function has no persistent disk,
   so SQLite was never an option here — importing it only to never choose
   it is a crash waiting for a runtime that does not ship it.

   The pool is cached at module scope. A warm invocation reuses it; a
   cold one pays for the connection once. Creating a pool per request is
   the classic way to exhaust a small Postgres connection limit.
   ──────────────────────────────────────────────────────────────── */

/* The .mjs driver, shared with the local proxy so the compare-and-set
   logic cannot drift between the two deployments. Its types are inferred
   from JavaScript and do not line up with the interface below, hence the
   cast — the contract is asserted here and enforced by the driver. */
import { openPostgres } from '../server/store/postgres.mjs'

interface Store {
  all(): Promise<Record<string, { record: unknown; version: number }>>
  put(signalId: string, record: unknown, ifVersion?: number): Promise<
    { ok: true; version: number } | { ok: false; current: unknown }>
  count(): Promise<number>
}

let pending: Promise<Store> | null = null

export function store(): Promise<Store> {
  const url = process.env.DATABASE_URL
  if (!url) {
    return Promise.reject(new Error(
      'DATABASE_URL is not set. The shared case queue needs a Postgres database; '
      + 'without one the app falls back to per-browser storage, which is the '
      + 'documented behaviour and not an error.'))
  }
  pending ??= openPostgres(url) as unknown as Promise<Store>
  return pending
}

export function send(res: { status: (n: number) => { json: (b: unknown) => void } }, code: number, body: unknown) {
  res.status(code).json(body)
}
