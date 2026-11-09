// Data access + business rules for tables. Route handlers stay thin and call these.
import { withTransaction } from './db.js'
import { badRequest, conflict, forbidden, notFound } from './errors.js'
import { bpToPercentString, computeTotals, parseXlmToStroops, stroopsToXlm, toJSONSafe } from './money.js'
import { hashSecret, newSecret, newTableId, secretMatches } from './security.js'
import {
  generatePaymentReference,
  isValidStellarAddress,
  isValidTxHash,
  verifyPaymentOnHorizon,
} from './stellar.js'

export { toJSONSafe } from './money.js'

export const MAX_ITEMS = 100
export const MAX_PARTICIPANTS = 30

const SAMPLE_BILL = [
  ['Jollof rice', '4.5'],
  ['Fried rice & chicken', '5.2'],
  ['Suya platter (to share)', '9'],
  ['Pepper soup', '3.8'],
  ['Chapman', '2.5'],
  ['Chapman', '2.5'],
  ['Zobo jug (to share)', '3'],
]

// ---------- reading ----------

export async function getTableView(pool, tableId, { hostKey, participantToken } = {}) {
  const t = await pool.query('SELECT * FROM bill_tables WHERE id = $1', [tableId])
  if (!t.rowCount) throw notFound()
  const table = t.rows[0]
  const [items, participants, claims, payments] = await Promise.all([
    pool.query('SELECT id, name, price_stroops, price_kobo FROM items WHERE table_id = $1 ORDER BY id', [tableId]),
    pool.query('SELECT id, name, token_hash, payment_reference, created_at FROM participants WHERE table_id = $1 ORDER BY id', [tableId]),
    pool.query(
      `SELECT c.item_id, c.participant_id FROM claims c JOIN items i ON i.id = c.item_id
       WHERE i.table_id = $1 ORDER BY c.created_at, c.participant_id`,
      [tableId],
    ),
    pool.query(
      `SELECT participant_id, tx_hash, from_address, to_address, amount_stroops, amount_xlm, status, verified_at, confirmed_at
       FROM settlement_payments WHERE table_id = $1 AND status = 'confirmed'`,
      [tableId],
    ),
  ])

  const itemList = items.rows.map((r) => {
    const stroops = r.price_stroops ?? (r.price_kobo !== null ? BigInt(r.price_kobo) * 100000n : 0n)
    return {
      id: String(r.id),
      name: r.name,
      priceStroops: stroops,
      priceKobo: stroops, // backwards-compatible field for consumers expecting integer amount
      priceXlm: stroopsToXlm(stroops),
    }
  })

  const people = participants.rows.map((r) => ({
    id: String(r.id),
    name: r.name,
    joinedAt: r.created_at,
    paymentReference: r.payment_reference,
  }))
  const claimList = claims.rows.map((r) => ({ itemId: String(r.item_id), participantId: String(r.participant_id) }))
  const totals = computeTotals({ taxBp: table.tax_bp, tipBp: table.tip_bp }, itemList, people, claimList)
  const me = participantToken ? participants.rows.find((r) => secretMatches(participantToken, r.token_hash)) : null

  // Map confirmed payments by participant_id
  const confirmedPayments = new Map(payments.rows.map((p) => [String(p.participant_id), p]))

  const participantsWithSettlement = totals.participants.map((p) => {
    const partObj = people.find((person) => person.id === p.participantId)
    const payment = confirmedPayments.get(p.participantId)
    const amountStroops = p.total
    const amountXlm = stroopsToXlm(p.total)

    let settlementStatus = 'unpaid'
    if (payment) {
      settlementStatus = 'confirmed'
    } else if (p.total === 0n) {
      settlementStatus = 'exempt'
    }

    return {
      ...p,
      paymentReference: partObj?.paymentReference ?? null,
      amountStroops: toJSONSafe(amountStroops),
      amountXlm,
      settlementStatus,
      txHash: payment?.tx_hash ?? null,
      fromAddress: payment?.from_address ?? null,
      verifiedAt: payment?.verified_at ? payment.verified_at.toISOString() : null,
      confirmedAt: payment?.confirmed_at ? payment.confirmed_at.toISOString() : null,
    }
  })

  return toJSONSafe({
    table: {
      id: table.id,
      name: table.name,
      taxPercent: bpToPercentString(table.tax_bp),
      tipPercent: bpToPercentString(table.tip_bp),
      finalized: table.finalized,
      createdAt: table.created_at,
      currency: table.currency || 'XLM',
      hostWallet: table.host_wallet || null,
    },
    items: itemList.map((it) => ({
      ...it,
      claimedBy: claimList.filter((c) => c.itemId === it.id).map((c) => c.participantId),
      shares: totals.itemShares[it.id] ?? {},
    })),
    participants: people.map(({ id, name, joinedAt, paymentReference }) => ({
      id,
      name,
      joinedAt,
      paymentReference,
    })),
    unclaimedItemIds: totals.unclaimedItemIds,
    totals: {
      participants: participantsWithSettlement,
      claimed: totals.claimed,
      unclaimed: totals.unclaimed,
      bill: totals.bill,
    },
    viewer: {
      isHost: secretMatches(hostKey, table.host_key_hash),
      participantId: me ? String(me.id) : null,
    },
  })
}

// ---------- host actions ----------

export async function createTable(pool, { name, taxBp, tipBp }) {
  const hostKey = newSecret()
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = newTableId()
    try {
      await pool.query('INSERT INTO bill_tables (id, name, host_key_hash, tax_bp, tip_bp, currency) VALUES ($1, $2, $3, $4, $5, $6)', [
        id,
        name,
        hashSecret(hostKey),
        taxBp,
        tipBp,
        'XLM',
      ])
      return { id, hostKey }
    } catch (err) {
      if (err.code !== '23505') throw err // retry only on share-code collision
    }
  }
  throw new Error('Could not allocate a unique table code')
}

// Locks the table row for the rest of the transaction, checks host key and (optionally) that it's still open.
async function lockAsHost(client, tableId, hostKey, { mustBeOpen = true } = {}) {
  const r = await client.query('SELECT host_key_hash, finalized FROM bill_tables WHERE id = $1 FOR UPDATE', [tableId])
  if (!r.rowCount) throw notFound()
  if (!secretMatches(hostKey, r.rows[0].host_key_hash)) throw forbidden()
  if (mustBeOpen && r.rows[0].finalized) throw conflict('finalized', 'The bill is finalized. Unlock it to make changes.')
}

async function touch(client, tableId) {
  await client.query('UPDATE bill_tables SET updated_at = now() WHERE id = $1', [tableId])
}

export function updateSettings(pool, tableId, hostKey, { name, taxBp, tipBp }) {
  return withTransaction(pool, async (client) => {
    await lockAsHost(client, tableId, hostKey)
    await client.query(
      `UPDATE bill_tables SET name = COALESCE($2, name), tax_bp = COALESCE($3, tax_bp), tip_bp = COALESCE($4, tip_bp), updated_at = now()
       WHERE id = $1`,
      [tableId, name ?? null, taxBp ?? null, tipBp ?? null],
    )
  })
}

export function setHostWallet(pool, tableId, hostKey, hostWallet) {
  return withTransaction(pool, async (client) => {
    await lockAsHost(client, tableId, hostKey, { mustBeOpen: false })

    const r = await client.query('SELECT finalized FROM bill_tables WHERE id = $1', [tableId])
    if (r.rows[0].finalized) {
      throw conflict('active_obligations', 'Cannot change host wallet while the bill is finalized and active settlement obligations exist.')
    }

    const paid = await client.query('SELECT 1 FROM settlement_payments WHERE table_id = $1 AND status = $2', [tableId, 'confirmed'])
    if (paid.rowCount) {
      throw conflict('active_obligations', 'Cannot change host wallet after settlement payments have been recorded.')
    }

    if (hostWallet) {
      const clean = hostWallet.trim()
      if (!isValidStellarAddress(clean)) {
        throw badRequest('Invalid Stellar public key. Must be a 56-character Ed25519 public key starting with G.')
      }
      await client.query('UPDATE bill_tables SET host_wallet = $2, updated_at = now() WHERE id = $1', [tableId, clean])
    } else {
      await client.query('UPDATE bill_tables SET host_wallet = NULL, updated_at = now() WHERE id = $1', [tableId])
    }

    await touch(client, tableId)
  })
}

async function assertItemRoom(client, tableId, adding) {
  const c = await client.query('SELECT count(*)::int AS n FROM items WHERE table_id = $1', [tableId])
  if (c.rows[0].n + adding > MAX_ITEMS) throw conflict('too_many_items', `A table can have at most ${MAX_ITEMS} items.`)
}

export function addItem(pool, tableId, hostKey, { name, priceStroops, priceKobo }) {
  const stroops = priceStroops ?? priceKobo
  return withTransaction(pool, async (client) => {
    await lockAsHost(client, tableId, hostKey)
    await assertItemRoom(client, tableId, 1)
    const r = await client.query('INSERT INTO items (table_id, name, price_stroops) VALUES ($1, $2, $3) RETURNING id', [tableId, name, stroops])
    await touch(client, tableId)
    return { id: String(r.rows[0].id) }
  })
}

export function loadSample(pool, tableId, hostKey) {
  return withTransaction(pool, async (client) => {
    await lockAsHost(client, tableId, hostKey)
    await assertItemRoom(client, tableId, SAMPLE_BILL.length)
    for (const [name, xlm] of SAMPLE_BILL) {
      const stroops = parseXlmToStroops(xlm)
      await client.query('INSERT INTO items (table_id, name, price_stroops) VALUES ($1, $2, $3)', [tableId, name, stroops])
    }
    await touch(client, tableId)
  })
}

export function updateItem(pool, tableId, hostKey, itemId, { name, priceStroops, priceKobo }) {
  const stroops = priceStroops ?? priceKobo
  return withTransaction(pool, async (client) => {
    await lockAsHost(client, tableId, hostKey)
    const r = await client.query(
      'UPDATE items SET name = COALESCE($3, name), price_stroops = COALESCE($4, price_stroops) WHERE id = $1 AND table_id = $2',
      [itemId, tableId, name ?? null, stroops ?? null],
    )
    if (!r.rowCount) throw notFound('Item')
    await touch(client, tableId)
  })
}

export function deleteItem(pool, tableId, hostKey, itemId) {
  return withTransaction(pool, async (client) => {
    await lockAsHost(client, tableId, hostKey)
    const r = await client.query('DELETE FROM items WHERE id = $1 AND table_id = $2', [itemId, tableId])
    if (!r.rowCount) throw notFound('Item')
    await touch(client, tableId)
  })
}

export function setFinalized(pool, tableId, hostKey, finalized) {
  return withTransaction(pool, async (client) => {
    await lockAsHost(client, tableId, hostKey, { mustBeOpen: false })
    if (finalized) {
      await client.query('UPDATE bill_tables SET finalized = true, updated_at = now() WHERE id = $1', [tableId])
    } else {
      // Check if any participants have already confirmed payments on Stellar
      const paid = await client.query('SELECT 1 FROM settlement_payments WHERE table_id = $1 AND status = $2', [tableId, 'confirmed'])
      if (paid.rowCount) {
        throw conflict('has_payments', 'Cannot unlock bill: one or more participants have already settled on Stellar.')
      }
      await client.query('UPDATE bill_tables SET finalized = false, updated_at = now() WHERE id = $1', [tableId])
    }
  })
}

// ---------- participant actions ----------

export function joinTable(pool, tableId, { name, participantToken }) {
  return withTransaction(pool, async (client) => {
    const t = await client.query('SELECT 1 FROM bill_tables WHERE id = $1 FOR SHARE', [tableId])
    if (!t.rowCount) throw notFound()

    // Same browser joining again → return the existing participant (no duplicates on refresh).
    if (participantToken) {
      const existing = await client.query(
        'SELECT id, name, payment_reference FROM participants WHERE table_id = $1 AND token_hash = $2',
        [tableId, hashSecret(participantToken)],
      )
      if (existing.rowCount) {
        const p = existing.rows[0]
        return {
          participant: { id: String(p.id), name: p.name, paymentReference: p.payment_reference },
          token: participantToken,
          created: false,
        }
      }
    }

    const count = await client.query('SELECT count(*)::int AS n FROM participants WHERE table_id = $1', [tableId])
    if (count.rows[0].n >= MAX_PARTICIPANTS) throw conflict('table_full', `A table can have at most ${MAX_PARTICIPANTS} people.`)

    const token = newSecret()
    const tokenHash = hashSecret(token)
    const paymentReference = generatePaymentReference(tableId, tokenHash)

    const r = await client.query(
      `INSERT INTO participants (table_id, name, name_key, token_hash, payment_reference) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (table_id, name_key) DO NOTHING RETURNING id, name, payment_reference`,
      [tableId, name, name.toLowerCase(), tokenHash, paymentReference],
    )
    if (!r.rowCount) throw conflict('name_taken', `Someone called “${name}” is already at this table. Try a different name.`)
    return {
      participant: { id: String(r.rows[0].id), name: r.rows[0].name, paymentReference: r.rows[0].payment_reference },
      token,
      created: true,
    }
  })
}

// Idempotent: claimed=true inserts if missing; claimed=false deletes if present.
export function setClaim(pool, tableId, participantToken, itemId, claimed) {
  return withTransaction(pool, async (client) => {
    // FOR SHARE blocks a concurrent finalize until this claim commits (and vice versa).
    const t = await client.query('SELECT finalized FROM bill_tables WHERE id = $1 FOR SHARE', [tableId])
    if (!t.rowCount) throw notFound()
    if (t.rows[0].finalized) throw conflict('finalized', 'The bill is finalized — claims are locked.')

    const p = participantToken
      ? await client.query('SELECT id FROM participants WHERE table_id = $1 AND token_hash = $2', [tableId, hashSecret(participantToken)])
      : { rowCount: 0 }
    if (!p.rowCount) throw forbidden('Join the table before claiming items.')
    const participantId = p.rows[0].id

    const item = await client.query('SELECT 1 FROM items WHERE id = $1 AND table_id = $2', [itemId, tableId])
    if (!item.rowCount) throw notFound('Item')

    if (claimed) {
      await client.query('INSERT INTO claims (item_id, participant_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [itemId, participantId])
    } else {
      await client.query('DELETE FROM claims WHERE item_id = $1 AND participant_id = $2', [itemId, participantId])
    }
  })
}

// ---------- payment actions ----------

export function recordPayment(pool, tableId, participantToken, { txHash }) {
  return withTransaction(pool, async (client) => {
    if (!participantToken) {
      throw forbidden('A valid participant token is required to submit a payment.')
    }
    const p = await client.query(
      'SELECT id, name, payment_reference FROM participants WHERE table_id = $1 AND token_hash = $2 FOR UPDATE',
      [tableId, hashSecret(participantToken)],
    )
    if (!p.rowCount) {
      throw forbidden('Participant not found at this table.')
    }
    const participant = p.rows[0]
    const participantId = String(participant.id)

    const t = await client.query(
      'SELECT finalized, host_wallet, tax_bp, tip_bp, currency FROM bill_tables WHERE id = $1',
      [tableId],
    )
    if (!t.rowCount) throw notFound()
    const table = t.rows[0]
    if (!table.finalized) {
      throw conflict('not_finalized', 'Cannot submit payment before the bill is finalized.')
    }
    if (!table.host_wallet) {
      throw badRequest('Host has not configured a Stellar wallet address for this table.')
    }

    // Compute participant's total directly in stroops
    const items = await client.query('SELECT id, name, price_stroops, price_kobo FROM items WHERE table_id = $1 ORDER BY id', [tableId])
    const participants = await client.query('SELECT id, name, token_hash, created_at FROM participants WHERE table_id = $1 ORDER BY id', [tableId])
    const claims = await client.query(
      `SELECT c.item_id, c.participant_id FROM claims c JOIN items i ON i.id = c.item_id
       WHERE i.table_id = $1 ORDER BY c.created_at, c.participant_id`,
      [tableId],
    )
    const itemList = items.rows.map((r) => ({
      id: String(r.id),
      name: r.name,
      priceStroops: r.price_stroops ?? (r.price_kobo !== null ? BigInt(r.price_kobo) * 100000n : 0n),
    }))
    const people = participants.rows.map((r) => ({ id: String(r.id), name: r.name, joinedAt: r.created_at }))
    const claimList = claims.rows.map((r) => ({ itemId: String(r.item_id), participantId: String(r.participant_id) }))
    const totals = computeTotals({ taxBp: table.tax_bp, tipBp: table.tip_bp }, itemList, people, claimList)

    const myRow = totals.participants.find((row) => row.participantId === participantId)
    const expectedStroops = myRow?.total ?? 0n
    if (expectedStroops <= 0n) {
      throw badRequest('Participant total is 0 XLM. No payment required.')
    }

    if (!isValidTxHash(txHash)) {
      throw badRequest('Transaction hash must be a 64-character hexadecimal string.')
    }
    const cleanHash = txHash.trim().toLowerCase()

    // Idempotency check: is this tx_hash already stored?
    const existingTx = await client.query('SELECT * FROM settlement_payments WHERE tx_hash = $1', [cleanHash])
    if (existingTx.rowCount) {
      const rec = existingTx.rows[0]
      if (rec.table_id === tableId && String(rec.participant_id) === participantId) {
        return { payment: toJSONSafe(rec), created: false }
      }
      throw conflict('tx_already_used', 'This transaction has already been used to settle another participant or table.')
    }

    // Check if participant already has a confirmed payment
    const existingPartPayment = await client.query(
      'SELECT * FROM settlement_payments WHERE table_id = $1 AND participant_id = $2 AND status = $3',
      [tableId, participantId, 'confirmed'],
    )
    if (existingPartPayment.rowCount) {
      return { payment: toJSONSafe(existingPartPayment.rows[0]), created: false }
    }

    // Verify on Horizon independently
    const verified = await verifyPaymentOnHorizon({
      txHash: cleanHash,
      expectedToAddress: table.host_wallet,
      expectedAmountStroops: expectedStroops,
      expectedAssetCode: 'XLM',
      expectedMemo: participant.payment_reference,
    })

    // Record verified payment atomically
    const insertRes = await client.query(
      `INSERT INTO settlement_payments (
        table_id, participant_id, tx_hash, from_address, to_address,
        amount_stroops, amount_xlm, asset_code, asset_type, asset_issuer,
        network_passphrase, memo, status, ledger_sequence, verified_at, confirmed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT (tx_hash) DO NOTHING
      RETURNING *`,
      [
        tableId,
        participantId,
        verified.txHash,
        verified.fromAddress,
        verified.toAddress,
        verified.amountStroops,
        verified.amountXlm,
        verified.assetCode,
        'native',
        verified.assetIssuer,
        verified.networkPassphrase,
        verified.memo,
        'confirmed',
        verified.ledgerSequence,
        verified.verifiedAt,
        verified.verifiedAt,
      ],
    )

    if (insertRes.rowCount === 0) {
      const winner = await client.query('SELECT * FROM settlement_payments WHERE tx_hash = $1', [cleanHash])
      if (winner.rowCount && winner.rows[0].table_id === tableId && String(winner.rows[0].participant_id) === participantId) {
        return { payment: toJSONSafe(winner.rows[0]), created: false }
      }
      throw conflict('tx_already_used', 'This transaction has already been used to settle another participant or table.')
    }

    await touch(client, tableId)
    return { payment: toJSONSafe(insertRes.rows[0]), created: true }
  })
}

export async function getTablePayments(pool, tableId) {
  const t = await pool.query('SELECT host_wallet, currency FROM bill_tables WHERE id = $1', [tableId])
  if (!t.rowCount) throw notFound()
  const table = t.rows[0]

  const r = await pool.query(
    `SELECT id, table_id, participant_id, tx_hash, from_address, to_address,
            amount_stroops, amount_xlm, asset_code, asset_type, status,
            ledger_sequence, created_at, verified_at, confirmed_at
     FROM settlement_payments WHERE table_id = $1 ORDER BY created_at ASC`,
    [tableId],
  )
  return toJSONSafe({
    tableId,
    hostWallet: table.host_wallet || null,
    currency: table.currency || 'XLM',
    payments: r.rows.map((row) => ({
      id: String(row.id),
      tableId: row.table_id,
      participantId: String(row.participant_id),
      txHash: row.tx_hash,
      fromAddress: row.from_address,
      toAddress: row.to_address,
      amountStroops: row.amount_stroops,
      amountXlm: row.amount_xlm,
      assetCode: row.asset_code,
      status: row.status,
      ledgerSequence: row.ledger_sequence ? String(row.ledger_sequence) : null,
      createdAt: row.created_at,
      verifiedAt: row.verified_at,
      confirmedAt: row.confirmed_at,
    })),
  })
}
