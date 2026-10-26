import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface RunOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
  /** Called with each line the process writes to stdout. */
  onStdoutLine?: (line: string) => void
  onStderrLine?: (line: string) => void
  /** Keep at most this much of each stream (the tail) in the result. */
  keep?: number
  input?: string | Buffer
}

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

export class ProcessError extends Error {
  constructor(
    readonly command: string,
    readonly result: RunResult,
  ) {
    const tail = result.stderr.trim().split('\n').slice(-6).join('\n')
    super(`${command} failed (exit ${result.code})${tail ? `:\n${tail}` : ''}`)
  }
}

/**
 * npm/npx as [command, args] without a shell: on Windows they are .cmd batch files, so run npm's
 * own scripts with this Node instead.
 */
export function nodeTool(tool: 'npm' | 'npx', args: string[]): [string, string[]] {
  const script = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', `${tool}-cli.js`)
  if (existsSync(script)) return [process.execPath, [script, ...args]]
  return [tool, args]
}

/** Runs a program without a shell and collects its output; rejects on a non-zero exit. */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const keep = opts.keep ?? 4_000_000
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new Error('Cancelled'))
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let outLine = ''
    let errLine = ''
    const onAbort = () => child.kill()
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    const lines = (chunk: string, rest: string, fn?: (l: string) => void) => {
      if (!fn) return ''
      const parts = (rest + chunk).split(/\r?\n|\r/)
      const last = parts.pop() ?? ''
      for (const l of parts) fn(l)
      return last
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d: string) => {
      stdout = (stdout + d).slice(-keep)
      outLine = lines(d, outLine, opts.onStdoutLine)
    })
    child.stderr.on('data', (d: string) => {
      stderr = (stderr + d).slice(-keep)
      errLine = lines(d, errLine, opts.onStderrLine)
    })
    child.on('error', (err) => {
      opts.signal?.removeEventListener('abort', onAbort)
      reject(
        (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? new Error(`${cmd} is not installed or not on PATH`)
          : err,
      )
    })
    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', onAbort)
      if (outLine) opts.onStdoutLine?.(outLine)
      if (errLine) opts.onStderrLine?.(errLine)
      const result = { code: code ?? -1, stdout, stderr }
      if (opts.signal?.aborted) return reject(new Error('Cancelled'))
      if (code === 0) resolve(result)
      else reject(new ProcessError(cmd, result))
    })
    if (opts.input !== undefined) child.stdin.end(opts.input)
    else child.stdin.end()
  })
}
