import freighter from '@stellar/freighter-api'
import {
  Asset,
  Horizon,
  Memo,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
} from '@stellar/stellar-sdk'

export const TESTNET_HORIZON_URL = 'https://horizon-testnet.stellar.org'
export const TESTNET_PASSPHRASE = Networks.TESTNET

let customFreighter = null
let customHorizonServer = null

export function setFreighterForTest(mock) {
  customFreighter = mock
}

export function setHorizonServerForTest(mock) {
  customHorizonServer = mock
}

function getFreighter() {
  return customFreighter || freighter
}

export function getHorizonServer() {
  return customHorizonServer || new Horizon.Server(TESTNET_HORIZON_URL)
}

export function isValidAddress(address) {
  if (typeof address !== 'string') return false
  return StrKey.isValidEd25519PublicKey(address.trim())
}

export async function isFreighterAvailable() {
  try {
    const res = await getFreighter().isConnected()
    return !!(res && res.isConnected)
  } catch {
    return false
  }
}

export async function connectFreighter() {
  const available = await isFreighterAvailable()
  if (!available) {
    throw new Error('Freighter wallet extension was not detected. Please install Freighter from freighter.app.')
  }

  const access = await getFreighter().requestAccess()
  if (access?.error) {
    throw new Error(`Freighter connection rejected: ${access.error}`)
  }

  const networkDetails = await getFreighter().getNetworkDetails()
  if (networkDetails?.networkPassphrase && networkDetails.networkPassphrase !== TESTNET_PASSPHRASE) {
    throw new Error('Please switch your Freighter wallet to Testnet in Settings.')
  }

  const addrRes = await getFreighter().getAddress()
  if (addrRes?.error || !addrRes?.address) {
    throw new Error(`Could not retrieve address from Freighter: ${addrRes?.error || 'Unknown error'}`)
  }

  return { address: addrRes.address }
}

export async function payWithStellar({ recipientAddress, amountXlm, memoText }) {
  if (!isValidAddress(recipientAddress)) {
    throw new Error(`Invalid host recipient address: ${recipientAddress}`)
  }
  if (!amountXlm || Number(amountXlm) <= 0) {
    throw new Error('Payment amount must be greater than 0 XLM.')
  }
  if (!memoText) {
    throw new Error('A payment reference memo is required for settlement.')
  }

  const { address: payerAddress } = await connectFreighter()
  const server = getHorizonServer()

  let account
  try {
    account = await server.loadAccount(payerAddress)
  } catch (err) {
    if (err?.response?.status === 404 || err?.status === 404) {
      throw new Error(
        `Your Stellar Testnet account (${payerAddress.slice(0, 4)}...${payerAddress.slice(-4)}) is not funded yet. Fund it using the Stellar Testnet laboratory or friendbot.`,
      )
    }
    throw new Error(`Failed to load account from Stellar Testnet: ${err.message}`)
  }

  let fee
  try {
    fee = await server.fetchBaseFee()
  } catch {
    fee = 100
  }

  const tx = new TransactionBuilder(account, {
    fee: String(fee || 100),
    networkPassphrase: TESTNET_PASSPHRASE,
  })
    .addOperation(
      Operation.payment({
        destination: recipientAddress.trim(),
        asset: Asset.native(),
        amount: String(amountXlm),
      }),
    )
    .addMemo(Memo.text(memoText))
    .setTimeout(180)
    .build()

  const xdr = tx.toXDR()
  const signResult = await getFreighter().signTransaction(xdr, {
    networkPassphrase: TESTNET_PASSPHRASE,
    address: payerAddress,
  })

  if (signResult?.error) {
    throw new Error(`Transaction signing rejected: ${signResult.error}`)
  }

  const signedXdr = signResult.signedTxXdr || signResult.signedTransaction
  if (!signedXdr) {
    throw new Error('Freighter did not return a signed transaction.')
  }

  const signedTx = TransactionBuilder.fromXDR(signedXdr, TESTNET_PASSPHRASE)
  const submitResult = await server.submitTransaction(signedTx)
  return submitResult.hash
}

export function buildStellarUri({ destination, amount, memo }) {
  const params = new URLSearchParams()
  if (destination) params.set('destination', destination)
  if (amount) params.set('amount', String(amount))
  if (memo) {
    params.set('memo', memo)
    params.set('memo_type', 'MEMO_TEXT')
  }
  return `web+stellar:pay?${params.toString()}`
}

export const explorerTxUrl = (txHash) => `https://stellar.expert/explorer/testnet/tx/${encodeURIComponent(txHash)}`
export const explorerAccountUrl = (addr) => `https://stellar.expert/explorer/testnet/account/${encodeURIComponent(addr)}`
