import { useState } from 'react'
import { api } from '../lib/api.js'
import { setHostKey } from '../lib/storage.js'
import { navigate } from '../lib/router.js'
import { Button, Card, ErrorNote, Field, Logo, inputClass } from '../components/ui.jsx'

const steps = [
  ['Add the bill', 'Type in the items and prices, plus tax and tip.'],
  ['Share the link', 'Friends open it on their phones — no app, no sign-up.'],
  ['Tap what you ate', 'Shared dishes split evenly. Totals update live.'],
]

export default function HomePage() {
  const [form, setForm] = useState({ name: '', taxPercent: '7.5', tipPercent: '10' })
  const [busy, setBusy] = useState(false)
  const [showRates, setShowRates] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function create(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const data = await api.createTable({ ...form, name: form.name.trim() || 'Dinner' })
      setHostKey(data.table.id, data.hostKey)
      navigate(`/t/${data.table.id}`)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 pt-6 sm:px-6">
      <Logo />
      <div className="mt-8 grid items-start gap-8 lg:mt-10 lg:grid-cols-[1.1fr_1fr] lg:gap-x-16">
        <div>
          <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl">
            Split the bill before the waiter comes back.
          </h1>
          <p className="mt-4 max-w-md text-lg text-muted">
            One person adds the bill. Everyone taps what they had on their own phone. Tax and tip are shared fairly — no maths, no awkwardness.
          </p>
        </div>
        <ol className="order-last grid gap-4 sm:grid-cols-3 lg:order-none lg:col-start-1 lg:grid-cols-1">
          {steps.map(([title, text], i) => (
            <li key={title} className="flex gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand">{i + 1}</span>
              <div>
                <p className="font-semibold">{title}</p>
                <p className="text-sm text-muted">{text}</p>
              </div>
            </li>
          ))}
        </ol>

        <Card className="lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-2">
          <form onSubmit={create} className="flex flex-col gap-4">
            <h2 className="text-lg font-bold">Start a table</h2>
            <Field label="Where are you eating?">
              <input className={inputClass} placeholder="e.g. Friday at Mama Cass" value={form.name} onChange={set('name')} maxLength={60} />
            </Field>
            {showRates ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Tax %" hint="Sales tax or VAT %">
                  <input className={inputClass} inputMode="decimal" value={form.taxPercent} onChange={set('taxPercent')} required />
                </Field>
                <Field label="Tip %" hint="Service charge or tip">
                  <input className={inputClass} inputMode="decimal" value={form.tipPercent} onChange={set('tipPercent')} required />
                </Field>
              </div>
            ) : (
              <p className="flex min-h-11 items-center justify-between rounded-xl bg-stone-50 px-3 text-sm">
                <span>
                  Tax <strong>{form.taxPercent}%</strong> · Tip <strong>{form.tipPercent}%</strong>
                </span>
                <button type="button" onClick={() => setShowRates(true)} className="min-h-9 font-semibold text-brand underline underline-offset-2">
                  Change
                </button>
              </p>
            )}
            <ErrorNote>{error}</ErrorNote>
            <Button type="submit" busy={busy} className="min-h-12 text-base">
              Create table
            </Button>
            <p className="text-center text-xs text-muted">Next you’ll add the items and get a link to share. Tax and tip can be changed any time.</p>
          </form>
        </Card>
      </div>
    </main>
  )
}
