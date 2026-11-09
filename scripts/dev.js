// Runs the API (3001) and Vite (5174) together; Ctrl+C stops both.
import { spawn } from 'node:child_process'

const procs = [
  ['api', ['run', 'dev', '-w', 'server']],
  ['web', ['run', 'dev', '-w', 'client']],
].map(([tag, args]) => {
  const child = spawn('npm', args, { stdio: ['ignore', 'pipe', 'pipe'] })
  const prefix = (chunk) => chunk.toString().replace(/^(?=.)/gm, `[${tag}] `)
  child.stdout.on('data', (c) => process.stdout.write(prefix(c)))
  child.stderr.on('data', (c) => process.stderr.write(prefix(c)))
  child.on('exit', (code) => {
    console.log(`[${tag}] exited (${code})`)
    stopAll()
  })
  return child
})

function stopAll() {
  for (const p of procs) if (p.exitCode === null) p.kill('SIGTERM')
}
process.on('SIGINT', stopAll)
process.on('SIGTERM', stopAll)
