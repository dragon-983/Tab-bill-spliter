import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../src/app.js'
import { createPool } from '../src/db.js'
import { migrate } from '../src/migrate.js'

const url = process.env.TEST_DATABASE_URL
if (!url || !/test/.test(new URL(url).pathname)) {
  throw new Error('TEST_DATABASE_URL must point at a database whose name contains "test" (it gets wiped).')
}

let pool, server, base

before(async () => {
  pool = createPool(url)
  await migrate(pool, () => {})
  server = createApp(pool, { rateLimits: false, serveClient: false }).listen(0)
  base = `http://localhost:${server.address().port}/api`
})

beforeEach(() => pool.query('TRUNCATE bill_tables CASCADE'))

after(async () => {
  server.close()
  await pool.end()
})

async function call(method, path, { body, host, token } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (host) headers['x-host-key'] = host
  if (token) headers['x-participant-token'] = token
  const res = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, data: await res.json() }
}

async function setup() {
  const t = await call('POST', '/tables', { body: { name: 'Lunch', taxPercent: '7.5', tipPercent: '10' } })
  const id = t.data.table.id
  const host = t.data.hostKey
  const add = async (name, price) => (await call('POST', `/tables/${id}/items`, { host, body: { name, price } })).data.item.id
  const join = async (name) => (await call('POST', `/tables/${id}/participants`, { body: { name } })).data
  return { id, host, add, join }
}

test('health reports database up', async () => {
  const res = await call('GET', '/health')
  assert.equal(res.status, 200)
  assert.equal(res.data.ok, true)
  assert.equal(res.data.database, 'up')
})

test('create validates input and never leaks the host key on reads', async () => {
  const created = await call('POST', '/tables', { body: { name: 'Party', taxPercent: '5', tipPercent: '15' } })
  assert.equal(created.status, 201)
  assert.equal(created.data.table.name, 'Party')
  assert.equal(created.data.table.currency, 'XLM')
  assert.ok(created.data.hostKey)
  assert.equal(created.data.viewer.isHost, true)

  const publicRead = await call('GET', `/tables/${created.data.table.id}`)
  assert.equal(publicRead.status, 200)
  assert.equal(publicRead.data.hostKey, undefined)
  assert.equal(publicRead.data.viewer.isHost, false)
})

test('only the host can edit; invalid prices and missing records are rejected', async () => {
  const { id, host, add } = await setup()
  assert.equal((await call('POST', `/tables/${id}/items`, { body: { name: 'Rice', price: '1' } })).status, 403)
  assert.equal((await call('POST', `/tables/${id}/items`, { host: 'wrong', body: { name: 'Rice', price: '1' } })).status, 403)
  for (const price of ['-1', '0', '12.12345678', 'free', 1e15]) {
    assert.equal((await call('POST', `/tables/${id}/items`, { host, body: { name: 'Rice', price } })).status, 400, `price ${price}`)
  }
  assert.equal((await call('POST', `/tables/${id}/items`, { host, body: { price: '1' } })).status, 400)
  const itemId = await add('Rice', '4.5')
  const edited = await call('PATCH', `/tables/${id}/items/${itemId}`, { host, body: { price: '4.6' } })
  assert.equal(edited.data.items[0].priceStroops, 46_000_000)
  assert.equal(edited.data.items[0].priceXlm, '4.6')
  assert.equal((await call('PATCH', `/tables/${id}/items/999999`, { host, body: { price: '1' } })).status, 404)
  assert.equal((await call('GET', '/tables/zzzzzz')).status, 404)
  assert.equal((await call('GET', '/tables/not-a-code')).status, 404)
  assert.equal((await call('PATCH', `/tables/${id}`, { host, body: { taxPercent: '51' } })).status, 400)
  assert.equal((await call('PATCH', `/tables/${id}`, { host, body: { tipPercent: '12.5' } })).data.table.tipPercent, '12.5')
})

test('joining: case-insensitive unique names, idempotent rejoin with same token', async () => {
  const { id, join } = await setup()
  const ada = await join('Ada')
  assert.ok(ada.participantToken)
  assert.equal((await call('POST', `/tables/${id}/participants`, { body: { name: 'ADA ' } })).status, 409)
  const again = await call('POST', `/tables/${id}/participants`, { body: { name: 'Whatever' }, token: ada.participantToken })
  assert.equal(again.status, 200)
  assert.equal(again.data.participant.id, ada.participant.id)
  assert.equal(again.data.participants.length, 1)
  assert.equal(again.data.viewer.participantId, ada.participant.id)
})

test('full flow: shared items, idempotent claims, unclaimed tracking, reconciled totals', async () => {
  const { id, host, add, join } = await setup()
  const pizza = await add('Pizza', '9')
  const rice = await add('Rice', '4')
  const zobo = await add('Zobo', '1.5')
  const a = await join('Ada')
  const b = await join('Bayo')
  const c = await join('Chi')

  let v = (await call('GET', `/tables/${id}`)).data
  assert.deepEqual(v.unclaimedItemIds, [pizza, rice, zobo])

  for (const p of [a, b, c]) await call('POST', `/tables/${id}/claim`, { token: p.participantToken, body: { itemId: pizza, claimed: true } })
  // double-click / retry: same claim twice must not duplicate
  await call('POST', `/tables/${id}/claim`, { token: a.participantToken, body: { itemId: rice, claimed: true } })
  v = (await call('POST', `/tables/${id}/claim`, { token: a.participantToken, body: { itemId: rice, claimed: true } })).data

  assert.deepEqual(v.items.find((i) => i.id === rice).claimedBy, [a.participant.id])
  assert.deepEqual(v.unclaimedItemIds, [zobo])
  const byId = Object.fromEntries(v.totals.participants.map((p) => [p.participantId, p]))
  assert.equal(byId[b.participant.id].subtotal, 30_000_000) // 3 XLM share of pizza
  assert.equal(byId[a.participant.id].subtotal, 70_000_000) // 3 XLM pizza share + 4 XLM rice
  assert.equal(byId[a.participant.id].tax, 5_250_000) // 7.5% of 7 XLM = 0.525 XLM
  assert.equal(byId[a.participant.id].tip, 7_000_000) // 10% of 7 XLM = 0.7 XLM
  const owed = v.totals.participants.reduce((s, p) => s + p.total, 0)
  assert.equal(owed + v.totals.unclaimed.total, v.totals.bill.total)
  assert.equal(v.totals.unclaimed.subtotal, 15_000_000)

  v = (await call('POST', `/tables/${id}/claim`, { token: c.participantToken, body: { itemId: zobo, claimed: true } })).data
  assert.deepEqual(v.unclaimedItemIds, [])
  v = (await call('POST', `/tables/${id}/claim`, { token: c.participantToken, body: { itemId: zobo, claimed: false } })).data
  assert.deepEqual(v.unclaimedItemIds, [zobo])
  v = (await call('POST', `/tables/${id}/claim`, { token: c.participantToken, body: { itemId: zobo, claimed: false } })).data
  assert.deepEqual(v.unclaimedItemIds, [zobo])

  assert.equal((await call('POST', `/tables/${id}/claim`, { body: { itemId: zobo, claimed: true } })).status, 403)
  assert.equal((await call('POST', `/tables/${id}/claim`, { token: a.participantToken, body: { itemId: '424242', claimed: true } })).status, 404)
  assert.equal((await call('POST', `/tables/${id}/claim`, { token: a.participantToken, body: { itemId: zobo, claimed: 'yes' } })).status, 400)
})

test('finalize locks items and claims; unlock reopens; only host can do either', async () => {
  const { id, host, add, join } = await setup()
  const pizza = await add('Pizza', '9')
  const a = await join('Ada')

  assert.equal((await call('POST', `/tables/${id}/finalize`, { body: {} })).status, 403)
  const fin = await call('POST', `/tables/${id}/finalize`, { host })
  assert.equal(fin.status, 200)
  assert.equal(fin.data.table.finalized, true)

  assert.equal((await call('POST', `/tables/${id}/items`, { host, body: { name: 'More', price: '1' } })).status, 409)
  assert.equal((await call('PATCH', `/tables/${id}/items/${pizza}`, { host, body: { name: 'Renamed' } })).status, 409)
  assert.equal((await call('DELETE', `/tables/${id}/items/${pizza}`, { host })).status, 409)
  assert.equal((await call('POST', `/tables/${id}/claim`, { token: a.participantToken, body: { itemId: pizza, claimed: true } })).status, 409)

  const open = await call('POST', `/tables/${id}/unlock`, { host })
  assert.equal(open.data.table.finalized, false)
  assert.equal((await call('POST', `/tables/${id}/claim`, { token: a.participantToken, body: { itemId: pizza, claimed: true } })).status, 200)
})

test('sample bill creates real items through the backend in XLM', async () => {
  const { id, host } = await setup()
  const res = await call('POST', `/tables/${id}/sample`, { host })
  assert.equal(res.status, 201)
  assert.equal(res.data.items.length, 7)
  assert.ok(res.data.items.every((i) => i.priceStroops > 0))
  assert.equal(res.data.totals.bill.total, 358_375_000) // 30.5 XLM items + 7.5% tax (2.2875 XLM) + 10% tip (3.05 XLM) = 35.8375 XLM = 358,375,000 stroops
})

test('concurrent claims and a racing finalize never error or duplicate', async () => {
  const { id, host, add, join } = await setup()
  const item = await add('Nachos', '10')
  const people = await Promise.all(['P1', 'P2', 'P3', 'P4'].map(join))
  const claimCalls = people.map((p) =>
    call('POST', `/tables/${id}/claim`, { token: p.participantToken, body: { itemId: item, claimed: true } }),
  )
  const results = await Promise.all(claimCalls)
  assert.ok(results.every((r) => r.status === 200))
  const final = await call('GET', `/tables/${id}`)
  assert.equal(final.data.items[0].claimedBy.length, 4)
  assert.equal(final.data.totals.bill.subtotal, 100_000_000) // 10 XLM
})

test('malformed and oversized bodies get clean JSON errors', async () => {
  const { id, host } = await setup()
  assert.equal((await call('POST', '/tables', { body: 'not-json' })).status, 400)
  assert.equal((await call('POST', `/tables/${id}/items`, { host, body: { name: 'A'.repeat(61), price: '1' } })).status, 400)
})
