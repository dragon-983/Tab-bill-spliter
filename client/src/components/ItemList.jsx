import { formatXlm } from '../lib/money.js'
import Avatar from './Avatar.jsx'
import { Spinner } from './ui.jsx'

// "3.00 XLM each", or a range when the server's largest-remainder split differs by a stroop.
function eachText(shares) {
  const vals = Object.values(shares)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  return min === max ? `${formatXlm(min)} each` : `${formatXlm(min)}–${formatXlm(max)} each`
}

export default function ItemList({ view, meId, pending, onToggle, onNeedJoin, locked }) {
  const people = Object.fromEntries(view.participants.map((p) => [p.id, p]))

  return (
    <ul className="flex flex-col gap-2">
      {view.items.map((item) => {
        const mine = item.claimedBy.includes(meId)
        const count = item.claimedBy.length
        const busy = pending.has(item.id)
        const claimers = item.claimedBy.map((id) => people[id]).filter(Boolean)
        const label = mine ? `${item.name}, claimed by you` : item.name
        const itemPrice = item.priceStroops ?? item.priceKobo
        return (
          <li key={item.id} id={`item-${item.id}`} className="scroll-mt-24">
            <button
              type="button"
              disabled={locked || busy}
              aria-pressed={meId ? mine : undefined}
              aria-label={label}
              onClick={() => (meId ? onToggle(item.id, !mine) : onNeedJoin())}
              data-testid="claim-item"
              className={`flex min-h-[4.5rem] w-full items-start gap-3 rounded-2xl p-3.5 text-left ring-1 transition active:scale-[0.99] disabled:cursor-default sm:p-4 ${
                mine
                  ? 'bg-brand-soft ring-2 ring-brand'
                  : count === 0
                    ? 'bg-white ring-red-200 shadow-[inset_4px_0_0_var(--color-alert)]'
                    : 'bg-white ring-line hover:ring-stone-300'
              } ${locked ? 'opacity-80' : ''}`}
            >
              <span
                aria-hidden="true"
                className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold ${
                  mine ? 'border-brand bg-brand text-white' : 'border-stone-300 bg-white text-transparent'
                }`}
              >
                {busy ? <Spinner className="text-brand" /> : '✓'}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-start justify-between gap-3">
                  <span className="font-semibold leading-snug">{item.name}</span>
                  <span className="tabular shrink-0 font-semibold">{formatXlm(itemPrice)}</span>
                </span>

                <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  {count === 0 ? (
                    <span className="font-medium text-alert">Unclaimed</span>
                  ) : (
                    <>
                      <span className="flex -space-x-1.5">
                        {claimers.slice(0, 5).map((p) => (
                          <Avatar key={p.id} person={p} size={22} ring />
                        ))}
                      </span>
                      <span className="text-muted">
                        {count === 1
                          ? mine
                            ? 'Just you'
                            : claimers[0]?.name
                          : `Shared by ${count} · ${eachText(item.shares)}`}
                      </span>
                    </>
                  )}
                </span>

                {mine && count > 1 && (
                  <span className="tabular mt-1 block text-sm font-semibold text-brand">Your share: {formatXlm(item.shares[meId])}</span>
                )}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
