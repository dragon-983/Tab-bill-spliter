import { createPool } from '../src/db.js'
import { migrate } from '../src/migrate.js'

const pool = createPool()
try {
  await migrate(pool)
  console.log('migrations up to date')
} catch (err) {
  console.error('migration failed:', err.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
