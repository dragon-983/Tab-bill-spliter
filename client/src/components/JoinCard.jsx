import { useState } from 'react'
import { Button, Card, ErrorNote, inputClass } from './ui.jsx'

export const JOIN_INPUT_ID = 'join-name'

export default function JoinCard({ onJoin, isHost }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function submit(e) {
    e.preventDefault()
    if (!name.trim()) return setError({ message: 'Type your name first.' })
    setBusy(true)
    setError(null)
    try {
      await onJoin(name.trim())
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <Card className={isHost ? '' : 'ring-2 ring-brand/40'} data-testid="join-card">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-bold">{isHost ? 'Eating too? Add yourself' : 'What’s your name?'}</h2>
          <p className="mt-0.5 text-sm text-muted">
            It shows everyone at this table which items are yours. No account needed — this phone remembers you.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            id={JOIN_INPUT_ID}
            className={inputClass}
            placeholder="e.g. Ada"
            aria-label="Your name"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setError(null)
            }}
            maxLength={30}
            autoComplete="given-name"
            enterKeyHint="go"
          />
          <Button type="submit" busy={busy} className="shrink-0 px-5">
            Join
          </Button>
        </div>
        {error && (
          <ErrorNote>
            {error.message}
            {error.code === 'name_taken' && (
              <span className="mt-1 block font-normal text-red-700">
                Joined on another phone? Keep using that phone. Otherwise add an initial, like “{name.trim()} B.”
              </span>
            )}
          </ErrorNote>
        )}
      </form>
    </Card>
  )
}
