import { useEffect, useState } from 'react'
import HomePage from './pages/HomePage.jsx'
import TablePage from './pages/TablePage.jsx'
import NotFound from './pages/NotFound.jsx'

// Two routes don't need a router library: "/" and "/t/:code" (navigate lives in lib/router.js).
export default function App() {
  const [path, setPath] = useState(window.location.pathname)
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  if (path === '/') return <HomePage />
  const match = /^\/t\/([a-z0-9]{6})\/?$/.exec(path)
  if (match) return <TablePage key={match[1]} tableId={match[1]} />
  return <NotFound />
}
