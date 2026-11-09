import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TESTNET_PASSPHRASE,
  buildStellarUri,
  connectFreighter,
  explorerAccountUrl,
  explorerTxUrl,
  isFreighterAvailable,
  isValidAddress,
  payWithStellar,
  setFreighterForTest,
  setHorizonServerForTest,
} from '../src/lib/stellar.js'

const VALID_KEY = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
const PAYER_KEY = 'GBR6VFAO326NULG433KSLJPZ5D4OUYUV7WM7K2ALQZJONNYBQKJIHTMV'

beforeEach(() => {
  setFreighterForTest(null)
  setHorizonServerForTest(null)
})

test('address validation and URI generation', () => {
  assert.equal(isValidAddress(VALID_KEY), true)
  assert.equal(isValidAddress('not-a-stellar-key'), false)
  assert.equal(isValidAddress(''), false)
  assert.equal(isValidAddress(null), false)

  const uri = buildStellarUri({ destination: VALID_KEY, amount: '5.5', memo: 'TAB:abc:123' })
  assert.ok(uri.startsWith('web+stellar:pay?'))
  assert.ok(uri.includes(`destination=${VALID_KEY}`))
  assert.ok(uri.includes('amount=5.5'))
  assert.ok(uri.includes('memo=TAB%3Aabc%3A123'))
  assert.ok(uri.includes('memo_type=MEMO_TEXT'))

  assert.equal(explorerTxUrl('abc123hash'), 'https://stellar.expert/explorer/testnet/tx/abc123hash')
  assert.equal(explorerAccountUrl(VALID_KEY), `https://stellar.expert/explorer/testnet/account/${VALID_KEY}`)
})

test('wallet unavailable: isFreighterAvailable returns false and connectFreighter throws', async () => {
  setFreighterForTest({
    isConnected: async () => ({ isConnected: false }),
  })
  assert.equal(await isFreighterAvailable(), false)

  await assert.rejects(
    async () => connectFreighter(),
    /Freighter wallet extension was not detected/,
  )
})

test('wallet connection success: retrieves address on testnet', async () => {
  setFreighterForTest({
    isConnected: async () => ({ isConnected: true }),
    requestAccess: async () => ({ address: PAYER_KEY }),
    getNetworkDetails: async () => ({ networkPassphrase: TESTNET_PASSPHRASE }),
    getAddress: async () => ({ address: PAYER_KEY }),
  })

  assert.equal(await isFreighterAvailable(), true)
  const conn = await connectFreighter()
  assert.equal(conn.address, PAYER_KEY)
})

test('network mismatch: throws error when Freighter is on Mainnet instead of Testnet', async () => {
  setFreighterForTest({
    isConnected: async () => ({ isConnected: true }),
    requestAccess: async () => ({ address: PAYER_KEY }),
    getNetworkDetails: async () => ({ networkPassphrase: 'Public Global Stellar Network ; September 2015' }),
    getAddress: async () => ({ address: PAYER_KEY }),
  })

  await assert.rejects(
    async () => connectFreighter(),
    /Please switch your Freighter wallet to Testnet/,
  )
})

test('user rejects signing in Freighter: payWithStellar throws descriptive error', async () => {
  setFreighterForTest({
    isConnected: async () => ({ isConnected: true }),
    requestAccess: async () => ({ address: PAYER_KEY }),
    getNetworkDetails: async () => ({ networkPassphrase: TESTNET_PASSPHRASE }),
    getAddress: async () => ({ address: PAYER_KEY }),
    signTransaction: async () => ({ error: 'User declined to sign transaction' }),
  })

  // Mock Horizon server loadAccount and fetchBaseFee
  setHorizonServerForTest({
    loadAccount: async () => ({
      accountId: () => PAYER_KEY,
      sequenceNumber: () => '100',
      incrementSequenceNumber: () => {},
    }),
    fetchBaseFee: async () => 100,
  })

  await assert.rejects(
    async () =>
      payWithStellar({
        recipientAddress: VALID_KEY,
        amountXlm: '3.0',
        memoText: 'TAB:k7x2qm:1234567890ab',
      }),
    /Transaction signing rejected: User declined to sign transaction/,
  )
})

test('successful transaction building, signing, and submission through Freighter', async () => {
  const dummyTxHash = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

  setFreighterForTest({
    isConnected: async () => ({ isConnected: true }),
    requestAccess: async () => ({ address: PAYER_KEY }),
    getNetworkDetails: async () => ({ networkPassphrase: TESTNET_PASSPHRASE }),
    getAddress: async () => ({ address: PAYER_KEY }),
    signTransaction: async (xdr) => ({
      signedTxXdr: xdr, // Echo xdr as signed
    }),
  })

  setHorizonServerForTest({
    loadAccount: async () => ({
      accountId: () => PAYER_KEY,
      sequenceNumber: () => '100',
      incrementSequenceNumber: () => {},
    }),
    fetchBaseFee: async () => 100,
    submitTransaction: async () => ({
      hash: dummyTxHash,
      successful: true,
    }),
  })

  const hash = await payWithStellar({
    recipientAddress: VALID_KEY,
    amountXlm: '4.5',
    memoText: 'TAB:table1:memo1234567',
  })

  assert.equal(hash, dummyTxHash)
})
