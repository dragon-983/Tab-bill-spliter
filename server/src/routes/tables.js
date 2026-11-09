import { Router } from 'express'
import * as tables from '../tables.js'
import * as v from '../validate.js'
import { notFound } from '../errors.js'
import { TABLE_ID_PATTERN } from '../security.js'

const hostKey = (req) => req.get('x-host-key') ?? ''
const participantToken = (req) => req.get('x-participant-token') ?? ''

export function tablesRouter(pool, { writeLimiter, createLimiter }) {
  const r = Router()

  r.param('id', (req, res, next, id) => (TABLE_ID_PATTERN.test(id) ? next() : next(notFound())))

  // Every response carries the full recalculated view, so the client never computes money.
  const view = (req) => tables.getTableView(pool, req.params.id, { hostKey: hostKey(req), participantToken: participantToken(req) })

  r.post('/', createLimiter, async (req, res) => {
    const body = v.requireObject(req.body)
    const name = v.text(body.name ?? 'Dinner', 'Table name', 60)
    const taxBp = v.taxPercent(body.taxPercent ?? '0')
    const tipBp = v.tipPercent(body.tipPercent ?? '0')
    const { id, hostKey: key } = await tables.createTable(pool, { name, taxBp, tipBp })
    const data = await tables.getTableView(pool, id, { hostKey: key })
    res.status(201).json({ ...data, hostKey: key })
  })

  r.get('/:id', async (req, res) => {
    res.json(await view(req))
  })

  r.patch('/:id', writeLimiter, async (req, res) => {
    const body = v.requireObject(req.body)
    const patch = {
      name: v.text(body.name, 'Table name', 60, { optional: true }),
      taxBp: v.taxPercent(body.taxPercent, { optional: true }),
      tipBp: v.tipPercent(body.tipPercent, { optional: true }),
    }
    await tables.updateSettings(pool, req.params.id, hostKey(req), patch)
    res.json(await view(req))
  })

  r.post('/:id/items', writeLimiter, async (req, res) => {
    const body = v.requireObject(req.body)
    const item = await tables.addItem(pool, req.params.id, hostKey(req), {
      name: v.text(body.name, 'Item name', 60),
      priceStroops: v.price(body.price),
    })
    res.status(201).json({ item, ...(await view(req)) })
  })

  r.post('/:id/sample', writeLimiter, async (req, res) => {
    await tables.loadSample(pool, req.params.id, hostKey(req))
    res.status(201).json(await view(req))
  })

  r.patch('/:id/items/:itemId', writeLimiter, async (req, res) => {
    const body = v.requireObject(req.body)
    const patch = {
      name: v.text(body.name, 'Item name', 60, { optional: true }),
      priceStroops: body.price === undefined ? undefined : v.price(body.price),
    }
    await tables.updateItem(pool, req.params.id, hostKey(req), v.id(req.params.itemId, 'Item id'), patch)
    res.json(await view(req))
  })

  r.delete('/:id/items/:itemId', writeLimiter, async (req, res) => {
    await tables.deleteItem(pool, req.params.id, hostKey(req), v.id(req.params.itemId, 'Item id'))
    res.json(await view(req))
  })

  r.post('/:id/finalize', writeLimiter, async (req, res) => {
    await tables.setFinalized(pool, req.params.id, hostKey(req), true)
    res.json(await view(req))
  })

  r.post('/:id/unlock', writeLimiter, async (req, res) => {
    await tables.setFinalized(pool, req.params.id, hostKey(req), false)
    res.json(await view(req))
  })

  r.post('/:id/participants', writeLimiter, async (req, res) => {
    const body = v.requireObject(req.body)
    const joined = await tables.joinTable(pool, req.params.id, {
      name: v.text(body.name, 'Name', 30),
      participantToken: participantToken(req),
    })
    const data = await tables.getTableView(pool, req.params.id, { hostKey: hostKey(req), participantToken: joined.token })
    res.status(joined.created ? 201 : 200).json({ participant: joined.participant, participantToken: joined.token, ...data })
  })

  r.post('/:id/claim', writeLimiter, async (req, res) => {
    const body = v.requireObject(req.body)
    await tables.setClaim(pool, req.params.id, participantToken(req), v.id(body.itemId, 'itemId'), v.bool(body.claimed, 'claimed'))
    res.json(await view(req))
  })

  r.patch('/:id/stellar-wallet', writeLimiter, async (req, res) => {
    const body = v.requireObject(req.body)
    await tables.setHostWallet(pool, req.params.id, hostKey(req), body.hostWallet ?? null)
    res.json(await view(req))
  })

  r.post('/:id/payments', writeLimiter, async (req, res) => {
    const body = v.requireObject(req.body)
    const txHash = v.text(body.txHash, 'Transaction hash', 100)
    const result = await tables.recordPayment(pool, req.params.id, participantToken(req), { txHash })
    const viewData = await view(req)
    res.status(result.created ? 201 : 200).json({ payment: result.payment, ...viewData })
  })

  r.get('/:id/payments', async (req, res) => {
    res.json(await tables.getTablePayments(pool, req.params.id))
  })

  return r
}
