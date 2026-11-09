import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { withTransaction } from './db.js'

const dir = fileURLToPath(new URL('../migrations/', import.meta.url))

// Applies each migrations/*.sql file once, in name order. Safe to run repeatedly.
export async function migrate(pool, log = console.log) {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())')
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  for (const file of files) {
    await withTransaction(pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(4242)') // one migrator at a time
      const done = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [file])
      if (done.rowCount) return
      await client.query(await readFile(dir + file, 'utf8'))
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file])
      log(`applied ${file}`)
    })
  }
}
