// beforeDevCommand for `tauri dev`: starts the web dev server, or keeps the one already running
// (`pnpm dev` in another terminal) instead of failing on the busy port.
import { spawn } from 'node:child_process'

const URL = 'http://localhost:5180'

async function alive() {
  try {
    const res = await fetch(URL, { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}

if (await alive()) {
  console.log(`Using the web dev server already running at ${URL}`)
  // Tauri stops the app when this command exits: stay until it stops us.
  setInterval(() => {}, 1 << 30)
} else {
  const child = spawn('pnpm', ['--filter', '@shotbeam/web', 'dev'], {
    stdio: 'inherit',
    shell: true,
  })
  child.on('exit', (code) => process.exit(code ?? 0))
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
}
