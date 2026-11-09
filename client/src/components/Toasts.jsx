import { useCallback, useRef, useState } from 'react'

// Tiny toast system for action feedback ("Item added", "Bill finalized", ...).
// eslint-disable-next-line react/only-export-components
export function useToasts() {
  const [toasts, setToasts] = useState([])
  const next = useRef(0)
  const toast = useCallback((message, tone = 'success') => {
    const id = ++next.current
    setToasts((t) => [...t.slice(-2), { id, message, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600)
  }, [])
  return { toasts, toast }
}

export function ToastStack({ toasts, raised }) {
  return (
    <div
      aria-live="polite"
      className={`pointer-events-none fixed inset-x-0 z-40 flex flex-col items-center gap-2 px-4 ${raised ? 'bottom-28 lg:bottom-6' : 'bottom-6'}`}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`rounded-full px-4 py-2.5 text-sm font-semibold shadow-lg ${t.tone === 'error' ? 'bg-alert text-white' : 'bg-ink text-white'}`}
        >
          {t.tone === 'error' ? '⚠ ' : '✓ '}
          {t.message}
        </div>
      ))}
    </div>
  )
}
