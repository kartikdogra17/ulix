/* ────────────────────────────────────────────────────────────────
   Case store on SQLite, via Node's built-in node:sqlite.

   Chosen over a JSON file because a control room's queue is the one
   piece of genuinely shared state here, and a JSON file has two failure
   modes it cannot fix: a write that is interrupted leaves a truncated
   file that parses as nothing, and the whole table is rewritten on
   every change. A transaction fixes both.

   Chosen over a client library because node:sqlite ships with Node —
   this repo already deleted a charting library for costing 370 kB, so
   adding a dependency to write four SQL statements would be poor form.
   The cost is an ExperimentalWarning on startup; the proxy explains it
   rather than letting it look like a fault.
   ──────────────────────────────────────────────────────────────── */

import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cases (
  signal_id  TEXT PRIMARY KEY,
  version    INTEGER NOT NULL,
  record     TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cases_updated_at ON cases (updated_at);
`

export function openSqlite(file, migrateFrom) {
  mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  // WAL lets a reader and a writer coexist, which a JSON file cannot do.
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec(SCHEMA)

  const get = db.prepare('SELECT version, record FROM cases WHERE signal_id = ?')
  const list = db.prepare('SELECT signal_id, version, record FROM cases')
  const count = db.prepare('SELECT COUNT(*) AS n FROM cases')
  const upsert = db.prepare(`
    INSERT INTO cases (signal_id, version, record, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (signal_id) DO UPDATE
      SET version = excluded.version,
          record = excluded.record,
          updated_at = excluded.updated_at
  `)

  /* One-time import so nobody loses a queue to an upgrade. Only runs when
     the table is empty, so it cannot clobber live records if the old file
     is left lying around. */
  let imported = 0
  if (migrateFrom && count.get().n === 0) {
    try {
      const old = JSON.parse(readFileSync(migrateFrom, 'utf8'))
      const now = new Date().toISOString()
      db.exec('BEGIN IMMEDIATE')
      for (const [signalId, entry] of Object.entries(old)) {
        if (!entry?.record) continue
        upsert.run(signalId, entry.version ?? 1, JSON.stringify(entry.record), now)
        imported++
      }
      db.exec('COMMIT')
    } catch {
      // No file, or unreadable. Either way there is nothing to carry over.
      try { db.exec('ROLLBACK') } catch { /* no transaction open */ }
      imported = 0
    }
  }

  return {
    kind: 'sqlite',
    label: file,
    imported,

    async all() {
      const out = {}
      for (const row of list.all()) {
        out[row.signal_id] = { record: JSON.parse(row.record), version: row.version }
      }
      return out
    },

    async count() {
      return count.get().n
    },

    /**
     * Compare-and-set inside a transaction.
     *
     * BEGIN IMMEDIATE takes the write lock up front, so the read of the
     * current version and the write that depends on it cannot be split by
     * another process. That is the part a JSON file could never promise.
     */
    async put(signalId, record, ifVersion) {
      db.exec('BEGIN IMMEDIATE')
      try {
        const row = get.get(signalId)
        const expected = row?.version ?? 0
        if (ifVersion !== undefined && ifVersion !== expected) {
          db.exec('ROLLBACK')
          return {
            ok: false,
            current: row ? { record: JSON.parse(row.record), version: row.version } : null,
          }
        }
        const next = expected + 1
        upsert.run(signalId, next, JSON.stringify(record), new Date().toISOString())
        db.exec('COMMIT')
        return { ok: true, version: next }
      } catch (err) {
        try { db.exec('ROLLBACK') } catch { /* already rolled back */ }
        throw err
      }
    },

    async close() { db.close() },
  }
}
