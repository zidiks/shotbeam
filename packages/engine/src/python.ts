import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { run } from './media/run'
import type { Library } from './paths'

/*
 * The Python side: one virtualenv in the library with the local models, set up from the app
 * (features install separately; Chatterbox pulls PyTorch and is large).
 */

export const WORKER = join(dirname(fileURLToPath(import.meta.url)), '..', 'python', 'worker.py')

export type PythonFeature =
  | 'whisper'
  | 'ytdlp'
  | 'beats'
  | 'cuda'
  | 'kokoro'
  | 'chatterbox'
  | 'musicgen'

export const FEATURE_PACKAGES: Record<PythonFeature, string[]> = {
  whisper: ['faster-whisper'],
  ytdlp: ['yt-dlp[default]'],
  beats: ['librosa', 'soundfile'],
  // CUDA 12 / cuDNN 9 for faster-whisper on NVIDIA cards.
  cuda: ['nvidia-cublas-cu12', 'nvidia-cudnn-cu12'],
  kokoro: ['kokoro-onnx', 'soundfile'],
  chatterbox: ['chatterbox-tts'],
  // MusicGen through Hugging Face transformers; the weights download on first use.
  musicgen: ['transformers', 'torch', 'soundfile'],
}

const KOKORO_FILES = {
  'kokoro-v1.0.onnx':
    'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx',
  'voices-v1.0.bin':
    'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin',
}

export type FeatureStatus = Record<PythonFeature, boolean>

export class Python {
  private status: FeatureStatus | null = null

  constructor(private readonly library: Library) {}

  get venv() {
    return join(this.library.pythonDir, 'venv')
  }
  get modelsDir() {
    return join(this.library.pythonDir, 'models')
  }
  get python() {
    return process.platform === 'win32'
      ? join(this.venv, 'Scripts', 'python.exe')
      : join(this.venv, 'bin', 'python')
  }
  get ytdlp() {
    return process.platform === 'win32'
      ? join(this.venv, 'Scripts', 'yt-dlp.exe')
      : join(this.venv, 'bin', 'yt-dlp')
  }
  get ready() {
    return existsSync(this.python)
  }

  /** What is installed; checked once and after each install. */
  async features(refresh = false): Promise<FeatureStatus> {
    if (this.status && !refresh) return this.status
    const none: FeatureStatus = {
      whisper: false,
      ytdlp: false,
      beats: false,
      cuda: false,
      kokoro: false,
      chatterbox: false,
      musicgen: false,
    }
    if (!this.ready) return none
    const out = await this.call('check', [])
    this.status = { ...none, ...(JSON.parse(readFileSync(out.file, 'utf8')) as FeatureStatus) }
    out.cleanup()
    this.status.kokoro &&= existsSync(join(this.modelsDir, 'kokoro', 'voices-v1.0.bin'))
    return this.status
  }

  /** A base interpreter (3.10–3.12) to make the virtualenv from. */
  private async basePython(signal?: AbortSignal): Promise<[string, string[]]> {
    const tries: [string, string[]][] = process.env.SHOTBEAM_PYTHON
      ? [[process.env.SHOTBEAM_PYTHON, []]]
      : process.platform === 'win32'
        ? [
            ['py', ['-3.12']],
            ['py', ['-3.11']],
            ['py', ['-3.10']],
            ['python', []],
          ]
        : [
            ['python3.12', []],
            ['python3.11', []],
            ['python3', []],
          ]
    for (const [cmd, args] of tries) {
      try {
        const { stdout } = await run(cmd, [
          ...args,
          '-c',
          'import sys; print(sys.version_info[:2])',
        ])
        const [major, minor] = stdout
          .replace(/[()\s]/g, '')
          .split(',')
          .map(Number)
        if (major === 3 && (minor ?? 0) >= 10 && (minor ?? 0) <= 12) return [cmd, args]
      } catch {}
    }
    // None on this computer: a standalone CPython in the library, so the app needs no setup.
    return [await this.standalonePython(signal), []]
  }

  /** Where a downloaded standalone Python lives (python-build-standalone, "install_only"). */
  private get standaloneExe() {
    const base = join(this.library.pythonDir, 'base', 'python')
    return process.platform === 'win32' ? join(base, 'python.exe') : join(base, 'bin', 'python3')
  }

  private async standalonePython(signal?: AbortSignal): Promise<string> {
    if (existsSync(this.standaloneExe)) return this.standaloneExe
    const triple =
      process.platform === 'win32'
        ? 'x86_64-pc-windows-msvc'
        : process.platform === 'darwin'
          ? `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`
          : `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-unknown-linux-gnu`
    const res = await fetch(
      'https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest',
      { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Shotbeam' }, signal },
    )
    if (!res.ok) throw new Error(`Python 3.10–3.12 not found, and GitHub said ${res.status}`)
    const release = (await res.json()) as {
      assets: { name: string; browser_download_url: string }[]
    }
    const asset = release.assets.find(
      (a) => a.name.startsWith('cpython-3.12.') && a.name.endsWith(`${triple}-install_only.tar.gz`),
    )
    if (!asset) throw new Error(`No standalone Python 3.12 for ${triple}`)
    const dir = join(this.library.pythonDir, 'base')
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    const archive = join(dir, asset.name)
    await download(asset.browser_download_url, archive, signal)
    await run('tar', ['-xzf', archive, '-C', dir], { signal })
    rmSync(archive, { force: true })
    if (!existsSync(this.standaloneExe)) throw new Error('Standalone Python unpacked incomplete')
    return this.standaloneExe
  }

  /** pip's downloads and builds stay in the library too (the system drive may be small). */
  private installEnv(): NodeJS.ProcessEnv {
    const tmp = join(this.library.pythonDir, 'tmp')
    mkdirSync(tmp, { recursive: true })
    return {
      ...process.env,
      TMP: tmp,
      TEMP: tmp,
      TMPDIR: tmp,
      PIP_CACHE_DIR: join(this.library.pythonDir, 'pip-cache'),
    }
  }

  async install(
    features: PythonFeature[],
    progress: (f: number, message: string) => void,
    signal?: AbortSignal,
  ) {
    const env = this.installEnv()
    if (!this.ready) {
      progress(0.02, 'Creating the Python environment')
      progress(0.02, 'Finding Python (downloading one if there is none)')
      const [cmd, args] = await this.basePython(signal)
      await run(cmd, [...args, '-m', 'venv', this.venv], { signal, env })
      await run(this.python, ['-m', 'pip', 'install', '--upgrade', 'pip', 'wheel'], { signal, env })
    }
    const steps = features.length + (features.includes('kokoro') ? 1 : 0)
    let done = 0
    for (const feature of features) {
      progress(0.05 + (0.9 * done) / steps, `Installing ${feature}`)
      await run(this.python, ['-m', 'pip', 'install', '--upgrade', ...FEATURE_PACKAGES[feature]], {
        signal,
        env,
        keep: 20_000,
      })
      done++
    }
    if (features.includes('kokoro')) {
      const dir = join(this.modelsDir, 'kokoro')
      for (const [name, url] of Object.entries(KOKORO_FILES)) {
        if (existsSync(join(dir, name))) continue
        progress(0.05 + (0.9 * done) / steps, `Downloading ${name}`)
        await download(url, join(dir, name), signal)
      }
      done++
    }
    this.status = null
    return this.features(true)
  }

  /**
   * Runs one worker command. Returns the --out file it wrote (removed by `cleanup`).
   * `ext` picks the out file's extension.
   */
  async call(
    cmd: string,
    args: string[],
    opts: { ext?: string; signal?: AbortSignal; onProgress?: (f: number, m: string) => void } = {},
  ) {
    if (!this.ready) throw new Error('Local models are not set up yet (Settings → Local models)')
    const dir = mkdtempSync(join(tmpdir(), 'shotbeam-'))
    const file = join(dir, `out.${opts.ext ?? 'json'}`)
    await run(this.python, ['-X', 'utf8', WORKER, cmd, '--out', file, ...args], {
      signal: opts.signal,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', HF_HOME: join(this.modelsDir, 'hf') },
      onStdoutLine: (line) => {
        const m = /^@@progress ([\d.]+) ?(.*)$/.exec(line)
        if (m) opts.onProgress?.(Number(m[1]), m[2] ?? '')
      },
    })
    return { file, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
  }

  /** Writes text to a temporary file for commands that take --text-file. */
  textFile(text: string) {
    const dir = mkdtempSync(join(tmpdir(), 'shotbeam-text-'))
    const file = join(dir, 'text.txt')
    writeFileSync(file, text, 'utf8')
    return { file, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
  }
}

export async function download(url: string, to: string, signal?: AbortSignal) {
  const { mkdirSync, renameSync } = await import('node:fs')
  mkdirSync(dirname(to), { recursive: true })
  const res = await fetch(url, { signal, redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}): ${url}`)
  const part = `${to}.part`
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(part))
  renameSync(part, to)
}
