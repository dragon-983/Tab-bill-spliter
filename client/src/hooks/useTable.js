import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'

const POLL_MS = 2000

// Loads a table and re-polls every 2 s.
// Mutation responses carry the fresh view and are applied immediately. A poll
// that overlapped any mutation may contain pre-mutation data, so it's dropped
// (the next poll, 2 s later, is guaranteed fresh).
export function useTable(tableId) {
  const [view, setView] = useState(null)
  const [fatal, setFatal] = useState(null) // e.g. 404: stop polling
  const [offline, setOffline] = useState(false)
  const epoch = useRef(0) // bumps whenever a mutation starts or ends
  const pending = useRef(0) // mutations in flight
  const lastMutation = useRef(0)

  const mutate = useCallback(async (fn) => {
    const mine = ++lastMutation.current
    pending.current++
    epoch.current++
    try {
      const data = await fn()
      if (mine === lastMutation.current) setView(data) // newest mutation wins
      return data
    } finally {
      pending.current--
      epoch.current++
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let timer
    let controller

    async function poll() {
      controller = new AbortController()
      const startEpoch = epoch.current
      try {
        const data = await api.getTable(tableId, controller.signal)
        if (cancelled) return
        if (pending.current === 0 && startEpoch === epoch.current) setView(data)
        setOffline(false)
      } catch (err) {
        if (cancelled || err.name === 'AbortError') return
        if (err.status === 404) {
          setFatal(err)
          return // nothing to poll
        }
        setOffline(true) // keep showing the last good data and keep retrying
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS)
    }

    poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
      controller?.abort()
    }
  }, [tableId])

  return { view, fatal, offline, mutate }
}
