import { useState } from 'react'
import { api } from '../lib/api.js'
import { formatXlm } from '../lib/money.js'
import { buildStellarUri, explorerTxUrl, payWithStellar } from '../lib/stellar.js'
import CopyButton from './CopyButton.jsx'
import { Button, ErrorNote, inputClass } from './ui.jsx'

export function Breakdown({ row, taxPercent, tipPercent }) {
  return (
    <dl className="tabular grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
      <dt className="text-muted">Your items ({row.itemCount})</dt>
      <dd className="text-right">{formatXlm(row.subtotal)}</dd>
      <dt className="text-muted">Tax ({taxPercent}%)</dt>
      <dd className="text-right">{formatXlm(row.tax)}</dd>
      <dt className="text-muted">Tip ({tipPercent}%)</dt>
      <dd className="text-right">{formatXlm(row.tip)}</dd>
      <div className="col-span-2 my-0.5 border-t border-line" role="presentation" />
      <dt className="font-semibold">Total</dt>
      <dd className="text-right font-bold text-brand">{formatXlm(row.total)}</dd>
    </dl>
  )
}

function PaymentSection({ view, row, mutate, toast }) {
  const [busy, setBusy] = useState(false)
  const [busyText, setBusyText] = useState('')
  const [error, setError] = useState(null)
  const [showManual, setShowManual] = useState(false)
  const [manualTxHash, setManualTxHash] = useState('')

  const isFinalized = view.table.finalized
  const isSettled = row.settlementStatus === 'confirmed'
  const hasHostWallet = !!view.table.hostWallet
  const canPay = isFinalized && !isSettled && row.total > 0 && hasHostWallet

  async function handleFreighterPay() {
    setBusy(true)
    setError(null)
    setBusyText('Signing in Freighter…')
    try {
      const txHash = await payWithStellar({
        recipientAddress: view.table.hostWallet,
        amountXlm: row.amountXlm,
        memoText: row.paymentReference,
      })
      setBusyText('Verifying on Testnet…')
      await mutate(() => api.submitPayment(view.table.id, txHash))
      toast?.('Payment verified and settled on Stellar Testnet!', 'success')
    } catch (err) {
      setError(err.message || 'Payment failed')
      toast?.(err.message || 'Payment failed', 'error')
    } finally {
      setBusy(false)
      setBusyText('')
    }
  }

  async function handleManualSubmit(e) {
    e.preventDefault()
    if (!manualTxHash.trim()) return
    setBusy(true)
    setError(null)
    setBusyText('Verifying transaction…')
    try {
      await mutate(() => api.submitPayment(view.table.id, manualTxHash.trim()))
      toast?.('Payment verified and recorded!', 'success')
      setManualTxHash('')
      setShowManual(false)
    } catch (err) {
      setError(err.message || 'Verification failed')
      toast?.(err.message || 'Verification failed', 'error')
    } finally {
      setBusy(false)
      setBusyText('')
    }
  }

  if (!isFinalized) return null

  if (isSettled) {
    return (
      <div className="mt-3 rounded-xl bg-emerald-50 p-3 ring-1 ring-emerald-200">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-800">
            <span className="size-2 rounded-full bg-emerald-600" /> Settled on Stellar
          </span>
          {row.txHash && (
            <a
              href={explorerTxUrl(row.txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold text-emerald-700 underline underline-offset-2"
            >
              View Explorer ↗
            </a>
          )}
        </div>
        {row.amountXlm && (
          <p className="mt-1 text-xs text-emerald-900 font-medium">
            Paid {row.amountXlm} XLM (Memo: {row.paymentReference})
          </p>
        )}
      </div>
    )
  }

  if (row.total === 0) return null

  const stellarUri = buildStellarUri({
    destination: view.table.hostWallet,
    amount: row.amountXlm,
    memo: row.paymentReference,
  })

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-xl bg-stone-50 p-3 ring-1 ring-line">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-brand">Stellar Settlement</span>
        {row.amountXlm && <span className="tabular text-sm font-extrabold text-brand">{row.amountXlm} XLM</span>}
      </div>

      {!hasHostWallet && (
        <p className="text-xs text-muted">Host has not configured a Stellar receiving address yet.</p>
      )}

      {canPay && (
        <>
          <Button
            type="button"
            className="w-full text-xs font-bold py-2.5"
            busy={busy}
            disabled={busy}
            onClick={handleFreighterPay}
          >
            {busy ? busyText : `Pay ${row.amountXlm} XLM via Freighter`}
          </Button>

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => setShowManual(!showManual)}
              className="text-[11px] font-semibold text-muted underline underline-offset-2"
            >
              {showManual ? 'Hide manual / mobile instructions ▴' : 'Mobile wallet / manual payment instructions ▾'}
            </button>
            <span className="text-[10px] text-muted">Stellar Testnet</span>
          </div>

          {showManual && (
            <div className="mt-2 flex flex-col gap-2 rounded-lg bg-white p-2.5 text-xs ring-1 ring-line">
              <p className="font-semibold text-ink">Manual / Mobile Payment Instructions</p>
              <p className="text-[11px] text-muted">
                Send from any Stellar wallet on <strong>Testnet</strong>. You MUST include your exact memo!
              </p>

              <div>
                <span className="text-[11px] font-medium text-muted">Host Receiving Address:</span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <p className="min-w-0 flex-1 truncate font-mono text-[11px] bg-stone-50 p-1 rounded ring-1 ring-line">
                    {view.table.hostWallet}
                  </p>
                  <CopyButton text={view.table.hostWallet} label="Copy" variant="secondary" className="shrink-0 text-xs py-1" />
                </div>
              </div>

              <div>
                <span className="text-[11px] font-medium text-muted">Required Memo (Text):</span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <p className="min-w-0 flex-1 truncate font-mono text-[11px] font-bold text-brand bg-stone-50 p-1 rounded ring-1 ring-line">
                    {row.paymentReference}
                  </p>
                  <CopyButton text={row.paymentReference} label="Copy" variant="secondary" className="shrink-0 text-xs py-1" />
                </div>
              </div>

              <div>
                <span className="text-[11px] font-medium text-muted">Exact Amount:</span>
                <p className="font-mono text-xs font-bold text-ink mt-0.5">{row.amountXlm} XLM</p>
              </div>

              <div className="pt-1">
                <a
                  href={stellarUri}
                  className="inline-block text-xs font-semibold text-brand underline underline-offset-2"
                >
                  Open in Mobile Wallet (SEP-0007) ↗
                </a>
              </div>

              <form onSubmit={handleManualSubmit} className="mt-2 pt-2 border-t border-line flex flex-col gap-1.5">
                <label className="text-[11px] font-medium text-ink">
                  Already paid? Paste your 64-char transaction hash:
                </label>
                <div className="flex gap-1.5">
                  <input
                    className={`${inputClass} font-mono text-xs !min-h-9 !py-1`}
                    placeholder="Transaction hash..."
                    value={manualTxHash}
                    onChange={(e) => setManualTxHash(e.target.value)}
                    maxLength={64}
                  />
                  <Button
                    type="submit"
                    variant="secondary"
                    className="shrink-0 text-xs !min-h-9 px-3"
                    busy={busy}
                    disabled={!manualTxHash.trim()}
                  >
                    Verify
                  </Button>
                </div>
              </form>
            </div>
          )}

          {error && <ErrorNote>{error}</ErrorNote>}
        </>
      )}
    </div>
  )
}

// Mobile: sticky bottom bar that expands into a breakdown. Desktop: a regular card.
export default function YourTotal({ view, meId, mutate, toast }) {
  const [open, setOpen] = useState(false)
  const row = view.totals.participants.find((p) => p.participantId === meId)
  if (!row) return null
  const empty = row.itemCount === 0
  const props = { row, taxPercent: view.table.taxPercent, tipPercent: view.table.tipPercent }

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white shadow-[0_-8px_30px_-12px_rgba(0,0,0,0.25)] lg:hidden">
        {open && !empty && (
          <div className="border-b border-line px-4 pb-3 pt-4 max-h-[70vh] overflow-y-auto" id="total-breakdown">
            <Breakdown {...props} />
            <PaymentSection view={view} row={row} mutate={mutate} toast={toast} />
          </div>
        )}
        <button
          type="button"
          onClick={() => !empty && setOpen(!open)}
          aria-expanded={empty ? undefined : open}
          aria-controls="total-breakdown"
          className="flex w-full items-center justify-between gap-4 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 text-left"
        >
          <span>
            <span className="block text-xs font-semibold uppercase tracking-wide text-muted">You owe</span>
            <span className="tabular block text-2xl font-extrabold text-ink" data-testid="my-total">
              {formatXlm(row.total)}
            </span>
          </span>
          <span className="text-right text-sm text-muted">
            {empty ? (
              'Tap the items you had ↑'
            ) : (
              <>
                {row.itemCount} {row.itemCount === 1 ? 'item' : 'items'} incl. tax & tip
                <span className="block font-semibold text-brand">{open ? 'Hide details ▾' : 'See breakdown ▴'}</span>
              </>
            )}
          </span>
        </button>
      </div>

      <section className="hidden rounded-2xl bg-white p-5 shadow-sm ring-2 ring-brand lg:block">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">You owe</p>
        <p className="tabular text-3xl font-extrabold text-ink">{formatXlm(row.total)}</p>
        <div className="mt-3">
          {empty ? (
            <p className="text-sm text-muted">Tap the items you had.</p>
          ) : (
            <>
              <Breakdown {...props} />
              <PaymentSection view={view} row={row} mutate={mutate} toast={toast} />
            </>
          )}
        </div>
      </section>
    </>
  )
}
