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

const HERE = dirname(fileURLToPath(import.meta.url))
/** In the installed app the MCP server and the engine are bundled side by side. */
const BUNDLED_ENGINE = join(HERE, '..', 'engine', 'dist', 'main.mjs')
const ENGINE_MAIN = join(HERE, '..', '..', '..', 'packages', 'engine', 'src', 'main.ts')

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
  const bundled = existsSync(BUNDLED_ENGINE)
  if (!bundled && !existsSync(ENGINE_MAIN))
    throw new Error('The Shotbeam engine is not running; open the Shotbeam app')
  // A checkout runs the sources through tsx (resolved from the engine package).
  const child = spawn(
    process.execPath,
    bundled ? [BUNDLED_ENGINE] : ['--import', 'tsx', ENGINE_MAIN],
    {
      cwd: bundled ? dirname(BUNDLED_ENGINE) : dirname(dirname(ENGINE_MAIN)),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: {
        ...process.env,
        SHOTBEAM_NODE: process.execPath,
        SHOTBEAM_MCP_ENTRY: fileURLToPath(import.meta.url),
      },
    },
  )
  child.unref()
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500))
    url = knownUrl()
    if (await alive(url)) return new EngineClient(url)
  }
  throw new Error('Started the Shotbeam engine but it did not answer within 30 s')
}
