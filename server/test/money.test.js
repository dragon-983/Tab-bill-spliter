import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  STROOPS_PER_XLM,
  MAX_TAX_BP,
  applyRate,
  computeTotals,
  formatXlm,
  largestRemainder,
  parsePercentToBp,
  parseXlmToStroops,
  stroopsToXlm,
} from '../src/money.js'

test('parseXlmToStroops accepts valid XLM strings and numbers up to 7 decimals, rejects invalid', () => {
  assert.equal(parseXlmToStroops('1'), 10_000_000n)
  assert.equal(parseXlmToStroops('4.5'), 45_000_000n)
  assert.equal(parseXlmToStroops('4.500'), 45_000_000n)
  assert.equal(parseXlmToStroops('0.0000001'), 1n) // 1 stroop
  assert.equal(parseXlmToStroops('100,000.5'), 1_000_005_000_000n)
  assert.equal(parseXlmToStroops(4.5), 45_000_000n)

  // Rejects invalid formats, negatives, 0, > 7 decimal places, > max price
  for (const bad of [
    '0',
    '-5',
    '-0.1',
    '1.12345678', // 8 decimals (over Stellar 7-decimal limit)
    'abc',
    '',
    '1e5',
    null,
    undefined,
    {},
    '1000000000000', // over max
  ]) {
    assert.equal(parseXlmToStroops(bad), null, `should reject ${JSON.stringify(bad)}`)
  }
})

test('stroopsToXlm converts BigInt stroops into exact decimal strings', () => {
  assert.equal(stroopsToXlm(10_000_000n), '1')
  assert.equal(stroopsToXlm(45_000_000n), '4.5')
  assert.equal(stroopsToXlm(1n), '0.0000001')
  assert.equal(stroopsToXlm(0n), '0')
  assert.equal(stroopsToXlm(100_000_000_000n), '10000')
})

test('formatXlm formats amounts with grouping, sensible decimals and XLM label', () => {
  assert.equal(formatXlm(10_000_000n), '1.00 XLM')
  assert.equal(formatXlm(45_000_000n), '4.50 XLM')
  assert.equal(formatXlm(1n), '0.0000001 XLM')
  assert.equal(formatXlm(10_000_000_000n), '1,000.00 XLM')
  assert.equal(formatXlm(10_000_000n, { showUnit: false }), '1.00')
})

test('parsePercentToBp validates range and precision', () => {
  assert.equal(parsePercentToBp('7.5', MAX_TAX_BP), 750)
  assert.equal(parsePercentToBp(0, MAX_TAX_BP), 0)
  assert.equal(parsePercentToBp('50', MAX_TAX_BP), 5000)
  assert.equal(parsePercentToBp('50.01', MAX_TAX_BP), null)
  assert.equal(parsePercentToBp('-1', MAX_TAX_BP), null)
  assert.equal(parsePercentToBp('7.555', MAX_TAX_BP), null)
})

test('applyRate rounds half up to the nearest stroop', () => {
  assert.equal(applyRate(100_000_000n, 750), 7_500_000n) // 7.5% of 10 XLM = 0.75 XLM
  assert.equal(applyRate(10n, 500), 1n) // 0.5 stroop → 1
  assert.equal(applyRate(9n, 500), 0n) // 0.45 stroop → 0
})

test('largestRemainder always sums exactly and favours earlier on ties', () => {
  assert.deepEqual(largestRemainder(10000n, [1n, 1n, 1n]), [3334n, 3333n, 3333n])
  assert.deepEqual(largestRemainder(2n, [1n, 1n, 1n]), [1n, 1n, 0n])
  assert.deepEqual(largestRemainder(0n, [0n, 0n]), [0n, 0n])
  const shares = largestRemainder(99999n, [3n, 7n, 11n, 13n])
  assert.equal(shares.reduce((a, b) => a + b, 0n), 99999n)
})

const P = (...ids) => ids.map((id) => ({ id }))
const I = (id, xlm) => ({ id, priceStroops: parseXlmToStroops(xlm) })

test('three people sharing a 9 XLM dish each owe 3 XLM before tax/tip', () => {
  const t = computeTotals({ taxBp: 0, tipBp: 0 }, [I('pizza', '9')], P('a', 'b', 'c'), [
    { itemId: 'pizza', participantId: 'a' },
    { itemId: 'pizza', participantId: 'b' },
    { itemId: 'pizza', participantId: 'c' },
  ])
  assert.deepEqual(t.participants.map((p) => p.subtotal), [30_000_000n, 30_000_000n, 30_000_000n])
  assert.deepEqual(t.participants.map((p) => p.amountXlm), ['3', '3', '3'])
})

test('tax and tip are proportional to subtotal; no claims means nothing owed', () => {
  const t = computeTotals(
    { taxBp: 750, tipBp: 1000 },
    [I('rice', '4'), I('suya', '6')],
    P('a', 'b', 'idle'),
    [
      { itemId: 'rice', participantId: 'a' },
      { itemId: 'suya', participantId: 'b' },
    ],
  )
  const [a, b, idle] = t.participants
  assert.equal(a.tax, 3_000_000n) // 7.5% of 4 XLM = 0.3 XLM = 3,000,000 stroops
  assert.equal(a.tip, 4_000_000n) // 10% of 4 XLM = 0.4 XLM = 4,000,000 stroops
  assert.equal(b.tax, 4_500_000n) // 7.5% of 6 XLM = 0.45 XLM
  assert.equal(b.tip, 6_000_000n) // 10% of 6 XLM = 0.6 XLM
  assert.deepEqual([idle.subtotal, idle.tax, idle.tip, idle.total], [0n, 0n, 0n, 0n])
})

test('unclaimed items are excluded from people and everything reconciles to the bill', () => {
  const t = computeTotals(
    { taxBp: 750, tipBp: 1250 },
    [I('pizza', '9.0000001'), I('drink', '1.3333333'), I('nobody', '2.7777777')],
    P('a', 'b', 'c'),
    [
      { itemId: 'pizza', participantId: 'a' },
      { itemId: 'pizza', participantId: 'b' },
      { itemId: 'pizza', participantId: 'c' },
      { itemId: 'drink', participantId: 'b' },
    ],
  )
  assert.deepEqual(t.unclaimedItemIds, ['nobody'])
  assert.equal(t.unclaimed.subtotal, 27_777_777n)
  const owed = t.participants.reduce((s, p) => s + p.total, 0n)
  assert.equal(owed, t.claimed.total)
  assert.equal(owed + t.unclaimed.total, t.bill.total)
  assert.equal(t.claimed.subtotal + t.unclaimed.subtotal, t.bill.subtotal)
})

test('awkward fractional XLM amounts still reconcile exactly to the stroop (randomised)', () => {
  let seed = 42
  const rand = (n) => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % n
  for (let run = 0; run < 300; run++) {
    const people = P(...Array.from({ length: 1 + rand(6) }, (_, i) => `p${i}`))
    const items = Array.from({ length: 1 + rand(8) }, (_, i) => ({ id: `i${i}`, priceStroops: BigInt(1 + rand(500_000_000)) }))
    const claims = []
    for (const item of items) {
      for (const p of people) {
        if (rand(2) === 0) claims.push({ itemId: item.id, participantId: p.id })
      }
    }
    const t = computeTotals({ taxBp: rand(3000), tipBp: rand(5000) }, items, people, claims)
    const owed = t.participants.reduce((s, p) => s + p.total, 0n)
    assert.equal(owed + t.unclaimed.total, t.bill.total, `run ${run}: participant sum + unclaimed !== bill total`)
    assert.equal(t.claimed.subtotal + t.unclaimed.subtotal, t.bill.subtotal)
  }
})
