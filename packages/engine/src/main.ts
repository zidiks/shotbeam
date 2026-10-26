import { rmSync, writeFileSync } from 'node:fs'
import { serve } from '@hono/node-server'
import { DEFAULT_ENGINE_PORT } from '@shotbeam/core'
import { Engine } from './engine'
import { createApp } from './server'

/*
 * Starts the engine: opens the library, serves the API on 127.0.0.1 and writes engine.json so the
 * MCP server and the desktop app know where it is. SHOTBEAM_PORT picks another port.
 */

const port = Number(process.env.SHOTBEAM_PORT || DEFAULT_ENGINE_PORT)
const engine = new Engine()
const app = createApp(engine)

const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, (info) => {
  writeFileSync(
    engine.library.engineFile,
    JSON.stringify({
      url: `http://127.0.0.1:${info.port}`,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    }),
  )
  console.log(`Shotbeam engine on http://127.0.0.1:${info.port} (library ${engine.library.root})`)
  engine.start()
})

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is busy: another engine is probably running already.`)
    process.exit(2)
  }
  throw err
})

let stopping = false
function stop() {
  if (stopping) return
  stopping = true
  rmSync(engine.library.engineFile, { force: true })
  server.close()
  engine.close()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
