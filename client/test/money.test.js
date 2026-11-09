import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatXlm, formatNaira, stroopsToXlm, stroopsToXlmText } from '../src/lib/money.js'
import { buildSummary } from '../src/lib/summary.js'

test('stroopsToXlm converts BigInt stroops into exact decimal strings', () => {
  assert.equal(stroopsToXlm(10_000_000n), '1')
  assert.equal(stroopsToXlm(45_000_000n), '4.5')
  assert.equal(stroopsToXlm(1n), '0.0000001')
  assert.equal(stroopsToXlm(0n), '0')
  assert.equal(stroopsToXlm(123_456_789n), '12.3456789')
})

test('formatXlm formats amounts with grouping, sensible decimals and XLM label', () => {
  assert.equal(formatXlm(10_000_000n), '1.00 XLM')
  assert.equal(formatXlm(45_000_000n), '4.50 XLM')
  assert.equal(formatXlm(12_345_678n), '1.2345678 XLM')
  assert.equal(formatXlm(1n), '0.0000001 XLM')
  assert.equal(formatXlm(10_000_000_000n), '1,000.00 XLM')
  assert.equal(formatXlm(10_000_000n, { showUnit: false }), '1.00')
})

test('formatNaira aliases to formatXlm without any ₦ symbol', () => {
  const result = formatNaira(10_000_000n)
  assert.equal(result.includes('₦'), false)
  assert.equal(result.includes('XLM'), true)
  assert.equal(result, '1.00 XLM')
})

test('buildSummary outputs purely XLM amounts and Stellar payment info', () => {
  const view = {
    table: { name: 'Friday Dinner', hostWallet: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' },
    participants: [
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
    ],
    totals: {
      participants: [
        { participantId: '1', total: 45_000_000n, amountXlm: '4.5', settlementStatus: 'confirmed', paymentReference: 'TAB:tbl:alice1' },
        { participantId: '2', total: 30_000_000n, amountXlm: '3', settlementStatus: 'unpaid', paymentReference: 'TAB:tbl:bob2' },
      ],
      unclaimed: { count: 0, total: 0n },
      bill: { total: 75_000_000n },
    },
  }

  const summary = buildSummary(view)
  assert.equal(summary.includes('₦'), false)
  assert.equal(summary.includes('NGN'), false)
  assert.equal(summary.includes('4.50 XLM'), true)
  assert.equal(summary.includes('3.00 XLM'), true)
  assert.equal(summary.includes('7.50 XLM'), true)
  assert.ok(summary.includes('Stellar'))
})
