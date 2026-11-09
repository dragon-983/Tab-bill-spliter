import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../src/app.js'
import { createPool } from '../src/db.js'
import { migrate } from '../src/migrate.js'
import {
  setHorizonServerForTest,
  stroopsToXlm,
  xlmToStroops,
} from '../src/stellar.js'
import { formatXlm, parseXlmToStroops } from '../src/money.js'

const url = process.env.TEST_DATABASE_URL
if (!url || !/test/.test(new URL(url).pathname)) {
  throw new Error('TEST_DATABASE_URL must point at a database whose name contains "test" (it gets wiped).')
}

const VALID_HOST_WALLET = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
const OTHER_HOST_WALLET = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
const VALID_PAYER_WALLET = 'GCKFJ3RF3H7L44WDTC677Z255677T6M4DMNF7H3O6Y44Y4462MN646M5'

let pool, server, base

before(async () => {
  pool = createPool(url)
  await migrate(pool, () => {})
  server = createApp(pool, { rateLimits: false, serveClient: false }).listen(0)
  base = `http://localhost:${server.address().port}/api`
})

beforeEach(() => {
  setHorizonServerForTest(null)
  return pool.query('TRUNCATE bill_tables CASCADE')
})

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

async function setupTable() {
  const t = await call('POST', '/tables', { body: { name: 'Stellar Dinner', taxPercent: '0', tipPercent: '0' } })
  const id = t.data.table.id
  const host = t.data.hostKey
  const add = async (name, price) => (await call('POST', `/tables/${id}/items`, { host, body: { name, price } })).data.item.id
  const join = async (name) => (await call('POST', `/tables/${id}/participants`, { body: { name } })).data
  return { id, host, add, join }
}

function mockHorizon({
  txSuccessful = true,
  ledger = 54321,
  memo = '',
  payments = [],
  txThrows404 = false,
  networkError = false,
} = {}) {
  return {
    transactions: () => ({
      transaction: (hash) => ({
        call: async () => {
          if (txThrows404) {
            const err = new Error('Not found')
            err.status = 404
            throw err
          }
          if (networkError) throw new Error('Horizon network error')
          return {
            hash,
            successful: txSuccessful,
            ledger,
            memo_type: 'text',
            memo,
            source_account: payments[0]?.from || VALID_PAYER_WALLET,
          }
        },
      }),
    }),
    operations: () => ({
      forTransaction: (hash) => ({
        call: async () => {
          if (networkError) throw new Error('Horizon network error')
          return { records: payments }
        },
      }),
    }),
  }
}

test('money math: exact XLM to stroops and stroops to XLM conversion', () => {
  // 1 XLM = 10,000,000 stroops
  assert.equal(parseXlmToStroops('3'), 30_000_000n)
  assert.equal(stroopsToXlm(30_000_000n), '3')
  assert.equal(xlmToStroops('3'), 30_000_000n)
  assert.equal(xlmToStroops('3.0000000'), 30_000_000n)
  assert.equal(formatXlm(30_000_000n), '3.00 XLM')

  // Sub-cent fractional amounts
  assert.equal(parseXlmToStroops('0.001'), 10_000n)
  assert.equal(stroopsToXlm(10_000n), '0.001')
  assert.equal(formatXlm(10_000n), '0.001 XLM')
  assert.equal(parseXlmToStroops('0.0000001'), 1n) // smallest unit: 1 stroop
  assert.equal(stroopsToXlm(1n), '0.0000001')
})

test('host wallet registration, validation, and permissions', async () => {
  const { id, host } = await setupTable()

  // Unauthorized (no host key)
  const unauth = await call('PATCH', `/tables/${id}/stellar-wallet`, { body: { hostWallet: VALID_HOST_WALLET } })
  assert.equal(unauth.status, 403)

  // Invalid wallet address format
  const invalid = await call('PATCH', `/tables/${id}/stellar-wallet`, { host, body: { hostWallet: 'not-a-stellar-address' } })
  assert.equal(invalid.status, 400)
  assert.match(invalid.data.error.message, /Invalid Stellar public key/)

  // Valid wallet address
  const ok = await call('PATCH', `/tables/${id}/stellar-wallet`, { host, body: { hostWallet: VALID_HOST_WALLET } })
  assert.equal(ok.status, 200)
  assert.equal(ok.data.table.hostWallet, VALID_HOST_WALLET)

  // Get table includes host wallet
  const view = await call('GET', `/tables/${id}`)
  assert.equal(view.data.table.hostWallet, VALID_HOST_WALLET)
})

test('cannot change host wallet while active obligations or confirmed payments exist', async () => {
  const { id, host, add, join } = await setupTable()
  await call('PATCH', `/tables/${id}/stellar-wallet`, { host, body: { hostWallet: VALID_HOST_WALLET } })
  const itemId = await add('Pizza', '3')
  const p = await join('Alice')
  await call('POST', `/tables/${id}/claim`, { token: p.participantToken, body: { itemId, claimed: true } })

  // Finalize bill
  await call('POST', `/tables/${id}/finalize`, { host })

  // Attempt to change wallet while finalized (active obligations)
  const lockedRes = await call('PATCH', `/tables/${id}/stellar-wallet`, { host, body: { hostWallet: OTHER_HOST_WALLET } })
  assert.equal(lockedRes.status, 409)
  assert.equal(lockedRes.data.error.code, 'active_obligations')
})

test('cannot submit payment before bill is finalized', async () => {
  const { id, host, add, join } = await setupTable()
  await call('PATCH', `/tables/${id}/stellar-wallet`, { host, body: { hostWallet: VALID_HOST_WALLET } })
  const itemId = await add('Pizza', '3')
  const p = await join('Alice')
  const txHash = 'a'.repeat(64)

  const res = await call('POST', `/tables/${id}/payments`, {
    token: p.participantToken,
    body: { txHash },
  })
  assert.equal(res.status, 409)
  assert.equal(res.data.error.code, 'not_finalized')
})

test('unauthorized payment submission without participant token', async () => {
  const { id, host } = await setupTable()
  await call('POST', `/tables/${id}/finalize`, { host })
  const res = await call('POST', `/tables/${id}/payments`, {
    body: { txHash: 'a'.repeat(64) },
  })
  assert.equal(res.status, 403)
})

test('successful payment verification, storage, and idempotency', async () => {
  const { id, host, add, join } = await setupTable()
  await call('PATCH', `/tables/${id}/stellar-wallet`, { host, body: { hostWallet: VALID_HOST_WALLET } })
  const itemId = await add('Jollof', '3') // 3 XLM = 30,000,000 stroops
  const alice = await join('Alice')
  await call('POST', `/tables/${id}/claim`, { token: alice.participantToken, body: { itemId, claimed: true } })

  // Finalize table
  const fin = await call('POST', `/tables/${id}/finalize`, { host })
  assert.equal(fin.data.table.finalized, true)

  const aliceTotal = fin.data.totals.participants.find((p) => p.participantId === alice.participant.id)
  assert.equal(aliceTotal.amountXlm, '3')
  assert.equal(aliceTotal.amountStroops, 30_000_000)
  assert.equal(aliceTotal.settlementStatus, 'unpaid')
  assert.ok(aliceTotal.paymentReference.startsWith(`TAB:${id}:`))

  const txHash = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
  setHorizonServerForTest(
    mockHorizon({
      memo: aliceTotal.paymentReference,
      payments: [
        {
          type: 'payment',
          from: VALID_PAYER_WALLET,
          to: VALID_HOST_WALLET,
          amount: '3.0000000',
          asset_type: 'native',
        },
      ],
    }),
  )

  // Submit payment
  const res = await call('POST', `/tables/${id}/payments`, {
    token: alice.participantToken,
    body: { txHash },
  })
  assert.equal(res.status, 201)
  assert.equal(res.data.payment.tx_hash, txHash)
  assert.equal(res.data.payment.status, 'confirmed')
  assert.equal(res.data.payment.amount_stroops, 30_000_000)
  assert.equal(res.data.payment.amount_xlm, '3.0000000')

  // Table view updates status to confirmed
  const viewAlice = res.data.totals.participants.find((p) => p.participantId === alice.participant.id)
  assert.equal(viewAlice.settlementStatus, 'confirmed')
  assert.equal(viewAlice.txHash, txHash)

  // Submitting the same transaction again is idempotent (200 OK)
  const dup = await call('POST', `/tables/${id}/payments`, {
    token: alice.participantToken,
    body: { txHash },
  })
  assert.equal(dup.status, 200)
  assert.equal(dup.data.payment.tx_hash, txHash)

  // Table payments endpoint returns confirmed record
  const paymentsQuery = await call('GET', `/tables/${id}/payments`)
  assert.equal(paymentsQuery.status, 200)
  assert.equal(paymentsQuery.data.payments.length, 1)
  assert.equal(paymentsQuery.data.payments[0].txHash, txHash)
  assert.equal(paymentsQuery.data.payments[0].amountXlm, '3.0000000')
})

test('rejects transaction with incorrect recipient, amount, asset, or memo', async () => {
  const { id, host, add, join } = await setupTable()
  await call('PATCH', `/tables/${id}/stellar-wallet`, { host, body: { hostWallet: VALID_HOST_WALLET } })
  const itemId = await add('Jollof', '3')
  const alice = await join('Alice')
  await call('POST', `/tables/${id}/claim`, { token: alice.participantToken, body: { itemId, claimed: true } })
  const fin = await call('POST', `/tables/${id}/finalize`, { host })
  const aliceMemo = fin.data.totals.participants.find((p) => p.participantId === alice.participant.id).paymentReference

  const txHash = 'b'.repeat(64)

  // Case 1: Wrong recipient
  setHorizonServerForTest(
    mockHorizon({
      memo: aliceMemo,
      payments: [{ type: 'payment', from: VALID_PAYER_WALLET, to: OTHER_HOST_WALLET, amount: '3.0000000', asset_type: 'native' }],
    }),
  )
  let res = await call('POST', `/tables/${id}/payments`, { token: alice.participantToken, body: { txHash } })
  assert.equal(res.status, 400)
  assert.match(res.data.error.message, /No payment operation to host wallet/)

  // Case 2: Wrong amount
  setHorizonServerForTest(
    mockHorizon({
      memo: aliceMemo,
      payments: [{ type: 'payment', from: VALID_PAYER_WALLET, to: VALID_HOST_WALLET, amount: '2.5000000', asset_type: 'native' }],
    }),
  )
  res = await call('POST', `/tables/${id}/payments`, { token: alice.participantToken, body: { txHash } })
  assert.equal(res.status, 400)
  assert.match(res.data.error.message, /Payment amount mismatch/)

  // Case 3: Wrong asset (USDC token instead of native XLM)
  setHorizonServerForTest(
    mockHorizon({
      memo: aliceMemo,
      payments: [
        {
          type: 'payment',
          from: VALID_PAYER_WALLET,
          to: VALID_HOST_WALLET,
          amount: '3.0000000',
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        },
      ],
    }),
  )
  res = await call('POST', `/tables/${id}/payments`, { token: alice.participantToken, body: { txHash } })
  assert.equal(res.status, 400)
  assert.match(res.data.error.message, /No payment operation matching asset XLM/)

  // Case 4: Wrong memo
  setHorizonServerForTest(
    mockHorizon({
      memo: 'WRONG_MEMO',
      payments: [{ type: 'payment', from: VALID_PAYER_WALLET, to: VALID_HOST_WALLET, amount: '3.0000000', asset_type: 'native' }],
    }),
  )
  res = await call('POST', `/tables/${id}/payments`, { token: alice.participantToken, body: { txHash } })
  assert.equal(res.status, 400)
  assert.match(res.data.error.message, /Transaction memo mismatch/)
})

test('cannot reuse same transaction hash for another participant', async () => {
  const { id, host, add, join } = await setupTable()
  await call('PATCH', `/tables/${id}/stellar-wallet`, { host, body: { hostWallet: VALID_HOST_WALLET } })
  const pizza = await add('Pizza', '6')
  const alice = await join('Alice')
  const bob = await join('Bob')
  await call('POST', `/tables/${id}/claim`, { token: alice.participantToken, body: { itemId: pizza, claimed: true } })
  await call('POST', `/tables/${id}/claim`, { token: bob.participantToken, body: { itemId: pizza, claimed: true } })
  const fin = await call('POST', `/tables/${id}/finalize`, { host })
  const aliceMemo = fin.data.totals.participants.find((p) => p.participantId === alice.participant.id).paymentReference

  const txHash = 'c'.repeat(64)
  setHorizonServerForTest(
    mockHorizon({
      memo: aliceMemo,
      payments: [{ type: 'payment', from: VALID_PAYER_WALLET, to: VALID_HOST_WALLET, amount: '3.0000000', asset_type: 'native' }],
    }),
  )

  // Alice settles successfully
  const r1 = await call('POST', `/tables/${id}/payments`, { token: alice.participantToken, body: { txHash } })
  assert.equal(r1.status, 201)

  // Bob attempts to use the same transaction hash
  const r2 = await call('POST', `/tables/${id}/payments`, { token: bob.participantToken, body: { txHash } })
  assert.equal(r2.status, 409)
  assert.equal(r2.data.error.code, 'tx_already_used')
})

test('cannot unlock bill after participants have confirmed payments', async () => {
  const { id, host, add, join } = await setupTable()
  await call('PATCH', `/tables/${id}/stellar-wallet`, { host, body: { hostWallet: VALID_HOST_WALLET } })
  const item = await add('Jollof', '3')
  const alice = await join('Alice')
  await call('POST', `/tables/${id}/claim`, { token: alice.participantToken, body: { itemId: item, claimed: true } })
  const fin = await call('POST', `/tables/${id}/finalize`, { host })
  const aliceMemo = fin.data.totals.participants.find((p) => p.participantId === alice.participant.id).paymentReference

  const txHash = 'd'.repeat(64)
  setHorizonServerForTest(
    mockHorizon({
      memo: aliceMemo,
      payments: [{ type: 'payment', from: VALID_PAYER_WALLET, to: VALID_HOST_WALLET, amount: '3.0000000', asset_type: 'native' }],
    }),
  )
  await call('POST', `/tables/${id}/payments`, { token: alice.participantToken, body: { txHash } })

  // Host attempts to unlock
  const unlockRes = await call('POST', `/tables/${id}/unlock`, { host })
  assert.equal(unlockRes.status, 409)
  assert.equal(unlockRes.data.error.code, 'has_payments')
})

test('rejects payment if host wallet is not configured', async () => {
  const { id, host, add, join } = await setupTable()
  const item = await add('Jollof', '3')
  const alice = await join('Alice')
  await call('POST', `/tables/${id}/claim`, { token: alice.participantToken, body: { itemId: item, claimed: true } })
  await call('POST', `/tables/${id}/finalize`, { host })

  const res = await call('POST', `/tables/${id}/payments`, {
    token: alice.participantToken,
    body: { txHash: 'e'.repeat(64) },
  })
  assert.equal(res.status, 400)
  assert.match(res.data.error.message, /Host has not configured a Stellar wallet/)
})

test('concurrent duplicate payment submissions resolve safely without duplicates', async () => {
  const { id, host, add, join } = await setupTable()
  await call('PATCH', `/tables/${id}/stellar-wallet`, { host, body: { hostWallet: VALID_HOST_WALLET } })
  const item = await add('Jollof', '3')
  const alice = await join('Alice')
  await call('POST', `/tables/${id}/claim`, { token: alice.participantToken, body: { itemId: item, claimed: true } })
  const fin = await call('POST', `/tables/${id}/finalize`, { host })
  const aliceMemo = fin.data.totals.participants.find((p) => p.participantId === alice.participant.id).paymentReference

  const txHash = 'f'.repeat(64)
  setHorizonServerForTest(
    mockHorizon({
      memo: aliceMemo,
      payments: [{ type: 'payment', from: VALID_PAYER_WALLET, to: VALID_HOST_WALLET, amount: '3.0000000', asset_type: 'native' }],
    }),
  )

  // Fire 3 simultaneous payment verification requests with the same txHash
  const results = await Promise.all([
    call('POST', `/tables/${id}/payments`, { token: alice.participantToken, body: { txHash } }),
    call('POST', `/tables/${id}/payments`, { token: alice.participantToken, body: { txHash } }),
    call('POST', `/tables/${id}/payments`, { token: alice.participantToken, body: { txHash } }),
  ])

  // At least one returned 201 (created), any subsequent race returned 200 (idempotent)
  const statuses = results.map((r) => r.status)
  assert.ok(statuses.every((s) => s === 200 || s === 201), `statuses: ${statuses.join(', ')}`)
  assert.ok(statuses.includes(201))

  // Database must contain exactly one record
  const paymentsQuery = await call('GET', `/tables/${id}/payments`)
  assert.equal(paymentsQuery.data.payments.length, 1)
  assert.equal(paymentsQuery.data.payments[0].txHash, txHash)
})
