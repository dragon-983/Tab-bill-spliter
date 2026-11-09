import { Horizon, Networks, StrKey } from '@stellar/stellar-sdk'
import { createHash } from 'node:crypto'
import { badRequest, HttpError } from './errors.js'

export const TESTNET_HORIZON_URL = 'https://horizon-testnet.stellar.org'
export const TESTNET_PASSPHRASE = Networks.TESTNET // 'Test SDF Network ; September 2015'

let customHorizonServer = null

export function getHorizonServer() {
  return customHorizonServer || new Horizon.Server(TESTNET_HORIZON_URL)
}

export function setHorizonServerForTest(mockServer) {
  customHorizonServer = mockServer
}

export function isValidStellarAddress(address) {
  if (typeof address !== 'string') return false
  return StrKey.isValidEd25519PublicKey(address)
}

export function isValidTxHash(hash) {
  return typeof hash === 'string' && /^[0-9a-fA-F]{64}$/.test(hash.trim())
}

/**
 * Deterministic payment reference stored in PostgreSQL and used as Stellar text memo.
 * Formatted as TAB:<tableId>:<12-hex-chars>, guaranteed to be 23 ASCII characters (<= 28 byte limit).
 */
export function generatePaymentReference(tableId, seed) {
  const digest = createHash('sha256').update(`${tableId}:${seed}`).digest('hex').slice(0, 12)
  return `TAB:${tableId}:${digest}`
}

export function xlmToStroops(xlmString) {
  if (typeof xlmString !== 'string') return null
  const match = /^(\d+)(?:\.(\d{1,7}))?$/.exec(xlmString.trim())
  if (!match) return null
  const whole = BigInt(match[1])
  const fraction = (match[2] || '').padEnd(7, '0')
  return whole * 10_000_000n + BigInt(fraction)
}

export function stroopsToXlm(stroops) {
  const s = BigInt(stroops)
  const whole = s / 10_000_000n
  const fraction = (s % 10_000_000n).toString().padStart(7, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : `${whole}`
}

/**
 * Independently fetches and verifies a payment transaction on Stellar Testnet Horizon.
 */
export async function verifyPaymentOnHorizon({
  txHash,
  expectedToAddress,
  expectedAmountStroops,
  expectedAssetCode = 'XLM',
  expectedAssetIssuer = null,
  expectedMemo,
  server = getHorizonServer(),
}) {
  if (!isValidTxHash(txHash)) {
    throw badRequest('Transaction hash must be a 64-character hexadecimal string.')
  }
  const cleanTxHash = txHash.trim().toLowerCase()

  let tx
  try {
    tx = await server.transactions().transaction(cleanTxHash).call()
  } catch (err) {
    if (err?.response?.status === 404 || err?.status === 404) {
      throw badRequest('Transaction not found on Stellar Testnet.')
    }
    throw new HttpError(502, 'horizon_error', `Failed to query Stellar Horizon: ${err.message || 'Network error'}`)
  }

  if (!tx.successful) {
    throw badRequest('Transaction failed on the Stellar network.')
  }

  const ledgerSequence = tx.ledger_attr || tx.ledger
  if (!ledgerSequence) {
    throw badRequest('Transaction has not yet been included in a closed ledger.')
  }

  // Verify memo
  const memo = tx.memo || ''
  if (expectedMemo && memo !== expectedMemo) {
    throw badRequest(`Transaction memo mismatch. Expected "${expectedMemo}", found "${memo}".`)
  }

  // Retrieve operations for transaction
  let opsPage
  try {
    opsPage = await server.operations().forTransaction(cleanTxHash).call()
  } catch (err) {
    throw new HttpError(502, 'horizon_error', `Failed to query operations for transaction: ${err.message}`)
  }

  const records = opsPage.records || []
  // Find payment operation matching recipient
  const paymentOps = records.filter((op) => op.type === 'payment' && op.to === expectedToAddress)
  if (paymentOps.length === 0) {
    throw badRequest(`No payment operation to host wallet "${expectedToAddress}" was found in transaction.`)
  }

  // Match asset and amount
  let matchedOp = null
  for (const op of paymentOps) {
    // Check asset
    if (expectedAssetCode === 'XLM') {
      if (op.asset_type !== 'native') continue
    } else {
      if (op.asset_code !== expectedAssetCode) continue
      if (expectedAssetIssuer && op.asset_issuer !== expectedAssetIssuer) continue
    }

    // Check amount
    const opStroops = xlmToStroops(op.amount)
    if (opStroops !== expectedAmountStroops) {
      throw badRequest(
        `Payment amount mismatch. Expected ${stroopsToXlm(expectedAmountStroops)} XLM (${expectedAmountStroops} stroops), but transaction sent ${op.amount} XLM (${opStroops} stroops).`,
      )
    }

    matchedOp = op
    break
  }

  if (!matchedOp) {
    throw badRequest(`No payment operation matching asset ${expectedAssetCode} was found in transaction.`)
  }

  return {
    txHash: cleanTxHash,
    fromAddress: matchedOp.from,
    toAddress: matchedOp.to,
    amountStroops: expectedAmountStroops,
    amountXlm: matchedOp.amount,
    assetCode: expectedAssetCode,
    assetIssuer: expectedAssetIssuer,
    memo,
    networkPassphrase: TESTNET_PASSPHRASE,
    ledgerSequence: BigInt(ledgerSequence),
    verifiedAt: new Date().toISOString(),
  }
}

