
import express from 'express'
import cors from 'cors'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { rateLimit } from 'express-rate-limit'
import { HttpError } from './errors.js'
import { tablesRouter } from './routes/tables.js'

const clientDist = fileURLToPath(new URL('../../client/dist/', import.meta.url))

function limiter(windowMs, limit, enabled) {
  if (!enabled) return (req, res, next) => next()

  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) =>
      res.status(429).json({
        error: {
          code: 'rate_limited',
          message: 'Too many requests — slow down a little.',
        },
      }),
  })
}

export function createApp(pool, { rateLimits = true, serveClient = true } = {}) {
  const app = express()

  app.disable('x-powered-by')
  app.set('trust proxy', 1)

  // Allow requests from the deployed Vercel frontend.
  app.use(
    cors({
      origin: 'https://bill-splitter-ten-rho.vercel.app',
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'X-Host-Key',
        'X-Participant-Token',
      ],
    }),
  )

  app.use('/api', limiter(60_000, 1500, rateLimits))
  app.use('/api', express.json({ limit: '10kb' }))

  app.get('/api/health', async (req, res) => {
    try {
      await pool.query('SELECT 1')
      res.json({ ok: true, database: 'up' })
    } catch {
      res.status(503).json({ ok: false, database: 'down' })
    }
  })

  app.use(
    '/api/tables',
    tablesRouter(pool, {
      writeLimiter: limiter(60_000, 300, rateLimits),
      createLimiter: limiter(10 * 60_000, 30, rateLimits),
    }),
  )

  app.use('/api', (req, res) =>
    res.status(404).json({
      error: {
        code: 'not_found',
        message: 'No such API endpoint.',
      },
    }),
  )

  // Serve the built frontend when available.
  if (serveClient && existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false, maxAge: '1h' }))
    app.use((req, res, next) =>
      req.method === 'GET'
        ? res.sendFile(clientDist + 'index.html')
        : next(),
    )
  }

  // Consistent JSON error responses.
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({
        error: { code: err.code, message: err.message },
      })
    }

    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({
        error: {
          code: 'invalid_json',
          message: 'Body is not valid JSON.',
        },
      })
    }

    if (err.type === 'entity.too.large') {
      return res.status(413).json({
        error: {
          code: 'too_large',
          message: 'Request body is too large.',
        },
      })
    }

    console.error(err)

    res.status(500).json({
      error: {
        code: 'server_error',
        message: 'Something went wrong on our side.',
      },
    })
  })

  return app
}
