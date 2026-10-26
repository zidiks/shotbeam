import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/*
 * The library: one folder with the database and everything the engine makes (previews,
 * transcripts, downloads, voices, renders, the Python environment). Originals stay where they are.
 * It grows to many gigabytes, so it can live on another drive: ~/.shotbeam.json `{ "home": … }`
 * says where; SHOTBEAM_HOME overrides that (tests, a second library).
 */

export const POINTER_FILE = join(homedir(), '.shotbeam.json')

export function libraryRoot(): string {
  if (process.env.SHOTBEAM_HOME) return process.env.SHOTBEAM_HOME
  if (existsSync(POINTER_FILE)) {
    try {
      const { home } = JSON.parse(readFileSync(POINTER_FILE, 'utf8')) as { home?: string }
      if (home) return home
    } catch {}
  }
  return join(homedir(), 'Shotbeam')
}

export class Library {
  constructor(readonly root: string = libraryRoot()) {
    for (const dir of ['cache', 'references', 'voices', 'generated', 'renders', 'motion', 'logs']) {
      mkdirSync(join(root, dir), { recursive: true })
    }
  }

  get database() {
    return join(this.root, 'shotbeam.db')
  }
  /** Where a running engine says how to reach it (read by the MCP server). */
  get engineFile() {
    return join(this.root, 'engine.json')
  }
  get pythonDir() {
    return join(this.root, 'python')
  }
  assetDir(assetId: string) {
    const dir = join(this.root, 'cache', assetId)
    mkdirSync(dir, { recursive: true })
    return dir
  }
  referenceDir(referenceId: string) {
    const dir = join(this.root, 'references', referenceId)
    mkdirSync(dir, { recursive: true })
    return dir
  }
  voiceDir(voiceId: string) {
    const dir = join(this.root, 'voices', voiceId)
    mkdirSync(dir, { recursive: true })
    return dir
  }
  generated(kind: 'voice' | 'motion' | 'audio') {
    const dir = join(this.root, 'generated', kind)
    mkdirSync(dir, { recursive: true })
    return dir
  }
  renderDir(compositionId: string) {
    const dir = join(this.root, 'renders', compositionId)
    mkdirSync(dir, { recursive: true })
    return dir
  }
  motionDir(engine: string) {
    const dir = join(this.root, 'motion', engine)
    mkdirSync(dir, { recursive: true })
    return dir
  }
}
