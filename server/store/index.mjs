/* ────────────────────────────────────────────────────────────────
   Which store the proxy talks to.

   One interface, two drivers:

     all()                          -> { [signalId]: { record, version } }
     put(signalId, record, ifVer)   -> { ok, version } | { ok: false, current }
     count()                        -> number
     close()                        -> void

   `put` is a compare-and-set in both: pass the version you read, and a
   stale pin is refused with the record as it now stands. That contract
   is the reason the queue can be shared at all, so a third driver must
   honour it or it is not a case store.

   Selection is by environment, so nothing in the app picks a database:
   DATABASE_URL present -> Postgres, otherwise the built-in SQLite file.
   ──────────────────────────────────────────────────────────────── */

import { openSqlite } from './sqlite.mjs'
import { openPostgres } from './postgres.mjs'

export async function openStore({ sqliteFile, migrateFrom }) {
  const url = process.env.DATABASE_URL
  if (url) return openPostgres(url)
  return openSqlite(sqliteFile, migrateFrom)
}
