import { createApp } from './app.js'
import { createPool } from './db.js'
import { migrate } from './migrate.js'

const pool = createPool()
await migrate(pool, () => {})
const port = Number(process.env.PORT) || 3001
const server = createApp(pool).listen(port, () => console.log(`Tab API listening on http://localhost:${port}`))

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => pool.end().then(() => process.exit(0))))
}
