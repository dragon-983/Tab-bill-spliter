import { useState } from 'react'
import { copyText } from '../lib/clipboard.js'
import { Button } from './ui.jsx'

export default function CopyButton({ text, label, variant = 'secondary', className = '' }) {
  const [state, setState] = useState('idle')
  async function copy() {
    try {
      await copyText(typeof text === 'function' ? text() : text)
      setState('copied')
    } catch {
      setState('failed')
    }
    setTimeout(() => setState('idle'), 2000)
  }
  return (
    <Button variant={variant} onClick={copy} className={className} aria-live="polite">
      {state === 'copied' ? '✓ Copied' : state === 'failed' ? 'Copy failed — select manually' : label}
    </Button>
  )
}
