/* ────────────────────────────────────────────────────────────────
   Case store on Postgres — the serverless path.

   NOT EXERCISED. There is no provisioned database behind this, so
   unlike the SQLite driver beside it this code has never run against a
   real server. It is written to be obvious rather than clever for
   exactly that reason: the first person to point DATABASE_URL at a real
   instance is also the first person to test it, and they should be able
   to read it in one pass.

   `pg` is imported dynamically and is NOT a dependency of this repo. A
   default `npm install` stays at zero server dependencies; this path
   asks for the package only when you have actually chosen it.
   ──────────────────────────────────────────────────────────────── */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cases (
  signal_id  TEXT PRIMARY KEY,
  version    INTEGER NOT NULL,
  record     JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cases_updated_at ON cases (updated_at);
`

export async function openPostgres(connectionString) {
  let pg
  try {
    pg = await import('pg')
  } catch {
    throw new Error(
      'DATABASE_URL is set but the "pg" package is not installed.\n'
      + '  Run:  npm install pg\n'
      + '  Or unset DATABASE_URL to fall back to the built-in SQLite store.',
    )
  }

  const Pool = pg.default?.Pool ?? pg.Pool
  const pool = new Pool({
    connectionString,
    // Hosted Postgres almost always terminates TLS with its own chain.
    ssl: /\bsslmode=disable\b/.test(connectionString) ? false : { rejectUnauthorized: false },
    max: 4,
  })
  await pool.query(SCHEMA)

  return {
    kind: 'postgres',
    label: connectionString.replace(/:\/\/[^@]*@/, '://***@'),
    imported: 0,

    async all() {
      const { rows } = await pool.query('SELECT signal_id, version, record FROM cases')
      const out = {}
      for (const r of rows) out[r.signal_id] = { record: r.record, version: r.version }
      return out
    },

    async count() {
      const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM cases')
      return rows[0].n
    },

    /**
     * Same compare-and-set as the SQLite driver, and deliberately the same
     * shape: SELECT ... FOR UPDATE inside a transaction rather than a
     * clever single-statement upsert, because the two drivers have to be
     * checkable against each other by reading them side by side.
     */
    async put(signalId, record, ifVersion) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const { rows } = await client.query(
          'SELECT version, record FROM cases WHERE signal_id = $1 FOR UPDATE', [signalId])
        const row = rows[0]
        const expected = row?.version ?? 0
        if (ifVersion !== undefined && ifVersion !== expected) {
          await client.query('ROLLBACK')
          return {
            ok: false,
            current: row ? { record: row.record, version: row.version } : null,
          }
        }
        const next = expected + 1
        await client.query(
          `INSERT INTO cases (signal_id, version, record, updated_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (signal_id) DO UPDATE
             SET version = EXCLUDED.version,
                 record = EXCLUDED.record,
                 updated_at = now()`,
          [signalId, next, JSON.stringify(record)])
        await client.query('COMMIT')
        return { ok: true, version: next }
      } catch (err) {
        try { await client.query('ROLLBACK') } catch { /* connection already gone */ }
        throw err
      } finally {
        client.release()
      }
    },

    async close() { await pool.end() },
  }
}
