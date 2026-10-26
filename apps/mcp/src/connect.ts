import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_ENGINE_PORT, EngineClient } from '@shotbeam/core'
import { libraryRoot } from '@shotbeam/engine/paths'

/*
 * Finds the running engine (engine.json in the library, else the default port) and starts it
 * when nothing answers, as its own process so it outlives this MCP session.
 */

const ENGINE_MAIN = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'packages',
  'engine',
  'src',
  'main.ts',
)

async function alive(url: string) {
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}

function knownUrl(): string {
  const file = join(libraryRoot(), 'engine.json')
  if (existsSync(file)) {
    try {
      const { url } = JSON.parse(readFileSync(file, 'utf8')) as { url?: string }
      if (url) return url
    } catch {}
  }
  return `http://127.0.0.1:${process.env.SHOTBEAM_PORT || DEFAULT_ENGINE_PORT}`
}

export async function connectEngine(): Promise<EngineClient> {
  let url = knownUrl()
  if (await alive(url)) return new EngineClient(url)
  if (!existsSync(ENGINE_MAIN))
    throw new Error('The Shotbeam engine is not running; open the Shotbeam app')
  // tsx resolves from the engine package, where it is installed.
  const child = spawn(process.execPath, ['--import', 'tsx', ENGINE_MAIN], {
    cwd: dirname(dirname(ENGINE_MAIN)),
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500))
    url = knownUrl()
    if (await alive(url)) return new EngineClient(url)
  }
  throw new Error('Started the Shotbeam engine but it did not answer within 30 s')
}
