import pg from 'pg'

// BIGINT (int8) arrives as a string; turn it into BigInt so money stays exact.
pg.types.setTypeParser(20, (v) => BigInt(v))

export function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is not set — see .env.example')
  const isUnixSocket = connectionString.includes('host=/var/run/postgresql')
  const ssl = process.env.DATABASE_SSL === 'true' && !isUnixSocket ? { rejectUnauthorized: false } : undefined
  return new pg.Pool({ connectionString, ssl, max: 10 })
}

// Run `fn(client)` inside a transaction.
export async function withTransaction(pool, fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
