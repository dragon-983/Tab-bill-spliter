import { useState } from 'react'
import { formatXlm } from '../lib/money.js'

const PREVIEW = 3

// Compact, always-visible warning. Amounts come from the server in stroops.
export default function UnclaimedAlert({ items, unclaimedIds, unclaimedTotal, onJump }) {
  const [open, setOpen] = useState(false)
  if (unclaimedIds.length === 0) return null
  const unclaimed = items.filter((i) => unclaimedIds.includes(i.id))
  const shown = open ? unclaimed : unclaimed.slice(0, PREVIEW)
  const hidden = unclaimed.length - shown.length

  return (
    <section aria-live="polite" data-testid="unclaimed-alert" className="rounded-2xl border border-red-200 bg-alert-soft px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-bold text-alert">
          {unclaimed.length} unclaimed {unclaimed.length === 1 ? 'item' : 'items'}
        </h2>
        <span className="tabular shrink-0 text-sm font-semibold text-alert">{formatXlm(unclaimedTotal)}</span>
      </div>
      <p className="text-xs text-red-700">Not in anyone’s total yet (amount includes tax & tip).</p>
      <ul className="mt-2 divide-y divide-red-100">
        {shown.map((i) => (
          <li key={i.id}>
            <button type="button" onClick={() => onJump(i.id)} className="flex min-h-10 w-full items-center justify-between gap-3 text-left text-sm">
              <span className="min-w-0 truncate font-medium text-ink">{i.name}</span>
              <span className="tabular shrink-0 text-red-700">{formatXlm(i.priceStroops ?? i.priceKobo)}</span>
            </button>
          </li>
        ))}
      </ul>
      {(hidden > 0 || open) && unclaimed.length > PREVIEW && (
        <button type="button" onClick={() => setOpen(!open)} className="mt-1 min-h-9 text-sm font-semibold text-alert underline-offset-2 hover:underline">
          {open ? 'Show less' : `+ ${hidden} more`}
        </button>
      )}
    </section>
  )
}
