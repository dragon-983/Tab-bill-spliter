import { Button, Logo } from '../components/ui.jsx'
import { navigate } from '../lib/router.js'

export default function NotFound({ title = 'Page not found', message = 'That link doesn’t lead anywhere.' }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <Logo />
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="text-muted">{message}</p>
      <Button onClick={() => navigate('/')}>Start a new table</Button>
    </main>
  )
}
