import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { setParticipantToken } from '../lib/storage.js'
import { useTable } from '../hooks/useTable.js'
import BillEditor from '../components/BillEditor.jsx'
import ItemList from '../components/ItemList.jsx'
import JoinCard, { JOIN_INPUT_ID } from '../components/JoinCard.jsx'
import ParticipantsStrip from '../components/ParticipantsStrip.jsx'
import Settlement from '../components/Settlement.jsx'
import ShareCard from '../components/ShareCard.jsx'
import { ToastStack, useToasts } from '../components/Toasts.jsx'
import UnclaimedAlert from '../components/UnclaimedAlert.jsx'
import YourTotal from '../components/YourTotal.jsx'
import { Logo } from '../components/ui.jsx'
import NotFound from './NotFound.jsx'

function LoadingSkeleton() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-6" aria-busy="true" aria-label="Loading the bill">
      <div className="h-8 w-48 animate-pulse rounded-lg bg-stone-200" />
      <div className="mt-2 h-4 w-32 animate-pulse rounded bg-stone-200" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="mt-3 h-[4.5rem] animate-pulse rounded-2xl bg-stone-200/70" />
      ))}
    </main>
  )
}

function StatusPill({ offline, locked }) {
  const base = 'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold'
  if (offline)
    return (
      <span className={`${base} bg-amber-100 text-amber-800`} data-testid="status">
        <span className="size-2 animate-pulse rounded-full bg-amber-500" /> Reconnecting…
      </span>
    )
  if (locked)
    return (
      <span className={`${base} bg-brand text-white`} data-testid="status">
        🔒 Finalized
      </span>
    )
  return (
    <span className={`${base} bg-brand-soft text-brand`} data-testid="status" title="Updates every 2 seconds">
      <span className="size-2 animate-pulse rounded-full bg-brand" /> Live
    </span>
  )
}

export default function TablePage({ tableId }) {
  const { view, fatal, offline, mutate } = useTable(tableId)
  const { toasts, toast } = useToasts()
  const [pending, setPending] = useState(() => new Set())
  const [mode, setMode] = useState(null) // host: 'claim' | 'edit'; null = automatic
  const [busy, setBusy] = useState('')
  const taxRef = useRef(null)
  const greeted = useRef(false)

  // Returning participant on this phone: say hello once.
  useEffect(() => {
    if (!view || greeted.current) return
    greeted.current = true
    const me = view.participants.find((p) => p.id === view.viewer.participantId)
    if (me) toast(`Welcome back, ${me.name}`)
  }, [view, toast])

  // Host actions: call the API, show the fresh view, confirm or explain. Returns true on success.
  const runHost = useCallback(
    async (fn, success) => {
      try {
        await mutate(() => fn(api, tableId))
        if (success) toast(success)
        return true
      } catch (err) {
        toast(err.message, 'error')
        return false
      }
    },
    [mutate, tableId, toast],
  )

  // Editing pins Edit mode, so adding the first item doesn't flip the host to the claim list.
  const runEdit = useCallback(
    (fn, success) => {
      setMode((m) => m ?? 'edit')
      return runHost(fn, success)
    },
    [runHost],
  )

  async function toggle(itemId, claimed) {
    if (pending.has(itemId)) return // ignore double taps while saving
    setPending((s) => new Set(s).add(itemId))
    try {
      await mutate(() => api.claim(tableId, itemId, claimed))
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setPending((s) => {
        const next = new Set(s)
        next.delete(itemId)
        return next
      })
    }
  }

  async function join(name) {
    const data = await mutate(() => api.join(tableId, name))
    setParticipantToken(tableId, data.participantToken)
    greeted.current = true
    toast(`You’re in, ${data.participant.name}! Now tap what you had.`)
  }

  function needJoin() {
    const input = document.getElementById(JOIN_INPUT_ID)
    input?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    input?.focus({ preventScroll: true })
    toast('Add your name first, then tap your items', 'error')
  }

  async function finalize(on) {
    setBusy(on ? 'finalize' : 'unlock')
    const ok = await runHost((a, id) => (on ? a.finalize(id) : a.unlock(id)), on ? 'Bill finalized — totals are locked' : 'Bill unlocked')
    if (ok && on) setMode('claim')
    setBusy('')
  }

  const jump = (itemId) => {
    setMode('claim')
    requestAnimationFrame(() => document.getElementById(`item-${itemId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }

  if (fatal) return <NotFound title="Table not found" message="Check the link — the code might be mistyped, or the table was removed." />
  if (!view) return <LoadingSkeleton />

  const meId = view.viewer.participantId
  const isHost = view.viewer.isHost
  const locked = view.table.finalized
  const empty = view.items.length === 0
  const editing = isHost && !locked && (mode ?? (empty ? 'edit' : 'claim')) === 'edit'

  const editTaxTip = () => {
    setMode('edit')
    requestAnimationFrame(() => taxRef.current?.focus())
  }

  const joinCard = !meId && !locked && <JoinCard onJoin={join} isHost={isHost} />

  return (
    <div className={meId ? 'pb-32 lg:pb-0' : ''}>
      <header className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Logo />
          <StatusPill offline={offline} locked={locked} />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-5 sm:px-6">
        <h1 className="break-words text-2xl font-extrabold tracking-tight sm:text-3xl">{view.table.name}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted">
          <span>
            Tax {view.table.taxPercent}% · Tip {view.table.tipPercent}%
          </span>
          {isHost && !locked && (
            <button type="button" onClick={editTaxTip} className="min-h-8 font-semibold text-brand underline underline-offset-2">
              Change
            </button>
          )}
        </p>

        {offline && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200" role="status">
            Connection lost — showing the last update. Retrying every 2 seconds…
          </p>
        )}
        {locked && (
          <p className="mt-3 rounded-xl bg-brand px-4 py-3 text-sm text-white" data-testid="final-banner">
            {isHost ? (
              <>
                <strong>You finalized the bill.</strong> Items and claims are locked. Unlock it from “Who owes what” to make changes.
              </>
            ) : (
              <>
                <strong>The host has finalized the bill.</strong> Items and claims are locked — these are the final amounts.
              </>
            )}
          </p>
        )}

        <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-w-0 flex-col gap-5">
            {!isHost && joinCard}
            {isHost && (
              <div className="lg:hidden">
                <ShareCard tableId={tableId} tableName={view.table.name} compact={locked} />
              </div>
            )}
            <ParticipantsStrip participants={view.participants} meId={meId} />
            {!editing && (
              <UnclaimedAlert items={view.items} unclaimedIds={view.unclaimedItemIds} unclaimedTotal={view.totals.unclaimed.total} onJump={jump} />
            )}

            <section aria-labelledby="bill-heading">
              <div className="mb-3 flex min-h-11 items-center justify-between gap-3">
                <h2 id="bill-heading" className="text-lg font-bold">
                  The bill
                </h2>
                {isHost && !locked ? (
                  <div className="grid grid-cols-2 rounded-xl bg-stone-200/70 p-1 text-sm font-semibold" role="tablist" aria-label="Bill mode">
                    {[
                      ['claim', 'Tap items'],
                      ['edit', 'Edit bill'],
                    ].map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={(editing ? 'edit' : 'claim') === key}
                        onClick={() => setMode(key)}
                        className={`min-h-9 rounded-lg px-3 transition ${(editing ? 'edit' : 'claim') === key ? 'bg-white text-ink shadow-sm' : 'text-muted'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className="text-sm text-muted">{locked ? '🔒 Locked' : meId ? 'Tap what you had' : 'Add your name to tap items'}</span>
                )}
              </div>

              {editing ? (
                <BillEditor view={view} run={runEdit} taxRef={taxRef} />
              ) : empty ? (
                <div className="rounded-2xl border-2 border-dashed border-line px-4 py-10 text-center">
                  <p className="font-semibold">No items on the bill yet</p>
                  <p className="mt-1 text-sm text-muted">{isHost ? 'Switch to “Edit bill” to add them.' : 'The host is adding the bill — it’ll appear here automatically.'}</p>
                </div>
              ) : (
                <ItemList view={view} meId={meId} pending={pending} onToggle={toggle} onNeedJoin={needJoin} locked={locked} />
              )}
            </section>

            {isHost && joinCard}
          </div>

          <aside className="flex flex-col gap-5 lg:sticky lg:top-20">
            {isHost && (
              <div className="hidden lg:block">
                <ShareCard tableId={tableId} tableName={view.table.name} compact={locked} />
              </div>
            )}
            {meId && <YourTotal view={view} meId={meId} mutate={mutate} toast={toast} />}
            <Settlement view={view} meId={meId} busy={busy} onFinalize={() => finalize(true)} onUnlock={() => finalize(false)} />
          </aside>
        </div>

        <p className="mt-10 text-center text-xs text-muted">
          Anyone with this link can see the bill and join. Amounts are calculated by the server in integer stroops and settled in native Stellar XLM.
        </p>
      </main>

      <ToastStack toasts={toasts} raised={!!meId} />
    </div>
  )
}
