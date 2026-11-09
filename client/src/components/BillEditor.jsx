import { useRef, useState } from 'react'
import { formatXlm, stroopsToXlmText } from '../lib/money.js'
import { connectFreighter, isValidAddress } from '../lib/stellar.js'
import { Button, Field, inputClass } from './ui.jsx'

// Fields show live server data, switching to a local draft only while being edited.
function ItemEditRow({ item, run }) {
  const currentStroops = item.priceStroops ?? item.priceKobo
  const [draft, setDraft] = useState(null)
  const name = draft ? draft.name : item.name
  const price = draft ? draft.price : stroopsToXlmText(currentStroops)
  const startEdit = () => setDraft((d) => d ?? { name: item.name, price: stroopsToXlmText(currentStroops) })
  const edit = (field) => (e) => setDraft((d) => ({ ...d, [field]: e.target.value }))
  const blurOnEnter = (e) => e.key === 'Enter' && e.currentTarget.blur()

  async function save(e) {
    if (e.currentTarget.closest('li').contains(e.relatedTarget)) return // moving between this row's fields
    const patch = {}
    if (name.trim() !== item.name) patch.name = name
    if (price.trim() !== stroopsToXlmText(currentStroops)) patch.price = price.trim()
    if (Object.keys(patch).length) await run((api, id) => api.updateItem(id, item.id, patch), 'Item updated')
    setDraft(null)
  }

  async function remove() {
    const n = item.claimedBy.length
    if (n && !window.confirm(`Remove “${item.name}”? ${n} ${n === 1 ? 'person has' : 'people have'} claimed it.`)) return
    await run((api, id) => api.deleteItem(id, item.id), `Removed ${item.name}`)
  }

  return (
    <li className="grid grid-cols-[1fr_auto] gap-2 rounded-2xl bg-white p-2.5 ring-1 ring-line sm:grid-cols-[1fr_9rem_auto]" data-testid="edit-item">
      <input
        className={`${inputClass} col-span-2 sm:col-span-1`}
        aria-label="Item name"
        value={name}
        onFocus={startEdit}
        onChange={edit('name')}
        onBlur={save}
        onKeyDown={blurOnEnter}
        maxLength={60}
      />
      <div className="relative">
        <input
          className={`${inputClass} tabular pl-3 pr-11 text-right`}
          aria-label={`Price of ${item.name}`}
          inputMode="decimal"
          value={price}
          onFocus={startEdit}
          onChange={edit('price')}
          onBlur={save}
          onKeyDown={blurOnEnter}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted">XLM</span>
      </div>
      <Button variant="danger" className="px-3" aria-label={`Remove ${item.name}`} onClick={remove}>
        Remove
      </Button>
    </li>
  )
}

function RateInput({ label, value, field, run, inputRef }) {
  const [draft, setDraft] = useState(null)
  return (
    <Field label={label}>
      <div className="relative">
        <input
          ref={inputRef}
          className={`${inputClass} pr-8`}
          inputMode="decimal"
          value={draft ?? value}
          onFocus={() => setDraft(value)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={async () => {
            if (draft !== null && draft.trim() !== value) await run((api, id) => api.updateTable(id, { [field]: draft.trim() }), `${label} updated`)
            setDraft(null)
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted">%</span>
      </div>
    </Field>
  )
}

export default function BillEditor({ view, run, taxRef }) {
  const [newItem, setNewItem] = useState({ name: '', price: '' })
  const [busy, setBusy] = useState('')
  const [walletInput, setWalletInput] = useState('')
  const [connectingWallet, setConnectingWallet] = useState(false)
  const nameRef = useRef(null)
  const empty = view.items.length === 0

  async function add(e) {
    e.preventDefault()
    setBusy('add')
    const ok = await run((api, id) => api.addItem(id, { name: newItem.name, price: newItem.price.trim() }), `Added ${newItem.name.trim()}`)
    if (ok) {
      setNewItem({ name: '', price: '' })
      nameRef.current?.focus()
    }
    setBusy('')
  }

  async function sample() {
    setBusy('sample')
    await run((api, id) => api.loadSample(id), 'Sample bill added')
    setBusy('')
  }

  async function handleConnectWallet() {
    setConnectingWallet(true)
    try {
      const { address } = await connectFreighter()
      await run((api, id) => api.setHostWallet(id, address), 'Connected host Stellar wallet')
      setWalletInput('')
    } catch (err) {
      alert(err.message)
    } finally {
      setConnectingWallet(false)
    }
  }

  async function handleSaveWallet(address) {
    const clean = address ? address.trim() : ''
    if (clean && !isValidAddress(clean)) {
      alert('Please enter a valid 56-character Stellar public key (starting with G).')
      return
    }
    const ok = await run((api, id) => api.setHostWallet(id, clean || null), clean ? 'Host Stellar wallet saved' : 'Host wallet cleared')
    if (ok) setWalletInput('')
  }

  return (
    <div className="flex flex-col gap-4" data-testid="host-editor">
      <form onSubmit={add} className="rounded-2xl bg-white p-3 ring-2 ring-brand/30">
        <p className="mb-2 text-sm font-semibold">{empty ? 'Add the first item from the bill' : 'Add another item'}</p>
        <div className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_9rem_auto]">
          <input
            ref={nameRef}
            className={`${inputClass} col-span-2 sm:col-span-1`}
            placeholder="Item, e.g. Jollof rice"
            aria-label="New item name"
            value={newItem.name}
            onChange={(e) => setNewItem((n) => ({ ...n, name: e.target.value }))}
            maxLength={60}
            required
            autoFocus={empty}
            enterKeyHint="next"
          />
          <div className="relative">
            <input
              className={`${inputClass} tabular pl-3 pr-11 text-right`}
              placeholder="0.00"
              aria-label="New item price"
              inputMode="decimal"
              value={newItem.price}
              onChange={(e) => setNewItem((n) => ({ ...n, price: e.target.value }))}
              required
              enterKeyHint="done"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted">XLM</span>
          </div>
          <Button type="submit" busy={busy === 'add'} className="px-5">
            Add
          </Button>
        </div>
        {empty && (
          <p className="mt-3 text-sm text-muted">
            Just trying it out?{' '}
            <button type="button" onClick={sample} disabled={!!busy} className="font-semibold text-brand underline underline-offset-2">
              {busy === 'sample' ? 'Adding…' : 'Load sample bill'}
            </button>
          </p>
        )}
      </form>

      {!empty && (
        <div>
          <p className="mb-2 text-sm text-muted">
            {view.items.length} {view.items.length === 1 ? 'item' : 'items'} · {formatXlm(view.totals.bill.subtotal)} before tax & tip. Tap a name or price to change it.
          </p>
          <ul className="flex flex-col gap-2">
            {view.items.map((item) => (
              <ItemEditRow key={item.id} item={item} run={run} />
            ))}
          </ul>
          <button type="button" onClick={sample} disabled={!!busy} className="mt-2 min-h-10 text-sm font-medium text-muted underline underline-offset-2">
            {busy === 'sample' ? 'Adding…' : 'Load sample bill'}
          </button>
        </div>
      )}

      <div className="rounded-2xl bg-white p-3 ring-1 ring-line">
        <p className="mb-2 text-sm font-semibold">Tax & tip</p>
        <div className="grid grid-cols-2 gap-3">
          <RateInput label="Tax" field="taxPercent" value={view.table.taxPercent} run={run} inputRef={taxRef} />
          <RateInput label="Tip" field="tipPercent" value={view.table.tipPercent} run={run} />
        </div>
        <p className="mt-2 text-xs text-muted">Both are % of the items, shared in proportion to what each person had.</p>
      </div>

      <div className="rounded-2xl bg-white p-3 ring-1 ring-line">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <p className="text-sm font-semibold">Stellar Testnet Settlement</p>
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">Testnet</span>
        </div>
        <p className="text-xs text-muted mb-3">
          Provide your Stellar address or connect Freighter so participants can settle their share directly in native XLM on Stellar Testnet.
        </p>

        {view.table.hostWallet ? (
          <div className="flex flex-col gap-2 rounded-xl bg-stone-50 p-3 ring-1 ring-line">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wide text-brand">Host Receiving Wallet</span>
              <button
                type="button"
                onClick={() => handleSaveWallet('')}
                className="text-xs font-semibold text-alert hover:underline"
              >
                Change
              </button>
            </div>
            <p className="font-mono text-xs break-all text-ink">{view.table.hostWallet}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <input
                className={`${inputClass} font-mono text-xs`}
                placeholder="G..."
                aria-label="Host Stellar public key"
                value={walletInput}
                onChange={(e) => setWalletInput(e.target.value)}
                maxLength={56}
              />
              <Button
                variant="secondary"
                className="shrink-0 px-3 text-xs"
                onClick={() => handleSaveWallet(walletInput)}
                disabled={!walletInput.trim()}
              >
                Save
              </Button>
            </div>
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={handleConnectWallet}
                disabled={connectingWallet}
                className="text-xs font-semibold text-brand underline underline-offset-2 flex items-center gap-1.5"
              >
                {connectingWallet ? 'Connecting…' : '⚡ Connect Freighter Wallet'}
              </button>
              <span className="text-[11px] text-muted">Native testnet XLM</span>
            </div>
          </div>
        )}

        <p className="mt-2.5 text-[11px] text-muted">
          All bill creation, calculations and settlements run strictly in native Stellar XLM.
        </p>
      </div>
    </div>
  )
}
