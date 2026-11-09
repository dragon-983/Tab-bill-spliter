import { useState } from 'react'
import CopyButton from './CopyButton.jsx'
import { Button, Card } from './ui.jsx'

export default function ShareCard({ tableId, tableName, compact = false }) {
  const url = `${window.location.origin}/t/${tableId}`
  const isLocal = /^(localhost|127\.)/.test(window.location.hostname)
  const [canShare] = useState(() => typeof navigator.share === 'function')

  return (
    <Card tone="brand" className="!p-4">
      <p className="text-sm font-semibold">{compact ? 'Table link' : 'Invite the table — send everyone this link'}</p>
      <div className="mt-2 flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate rounded-xl bg-white/10 px-3 py-2.5 font-mono text-sm font-semibold" data-testid="share-url" title={url}>
          {url.replace(/^https?:\/\//, '')}
        </p>
        <CopyButton text={url} label="Copy link" variant="secondary" className="shrink-0" />
      </div>
      {canShare && !compact && (
        <Button
          variant="secondary"
          className="mt-2 w-full"
          onClick={() => navigator.share({ title: `Tab — ${tableName}`, text: 'Tap what you had so we can split the bill:', url }).catch(() => {})}
        >
          Share via WhatsApp, SMS…
        </Button>
      )}
      {isLocal && !compact && (
        <p className="mt-2 text-xs text-white/70">On a laptop? Phones can’t open “localhost” — open Tab via this computer’s Wi-Fi address (see README).</p>
      )}
    </Card>
  )
}
