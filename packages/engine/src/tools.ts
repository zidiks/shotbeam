import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { JobQueue } from './jobs'
import { setFfmpegDir } from './media/ffmpeg'
import { run } from './media/run'
import type { Library } from './paths'
import { download } from './python'

/*
 * ffmpeg for a computer that has none: the installed app should just work, so when ffmpeg is
 * not on PATH the engine downloads a build into the library (BtbN's GPL shared build for
 * Windows: x264, NVENC, libass and freetype for captions, ~90 MB) and uses it from there.
 * Elsewhere the system's ffmpeg is expected (brew / apt).
 */

const BTBN = 'https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest'
const EXE = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'

export type FfmpegSource = 'path' | 'library' | 'missing'

export class Tools {
  private source: FfmpegSource = 'missing'

  constructor(
    private readonly library: Library,
    private readonly jobs: JobQueue,
  ) {}

  private get dir() {
    return join(this.library.root, 'tools', 'ffmpeg')
  }

  /** The `bin` folder of a downloaded build, wherever the archive put it. */
  private libraryBin(): string | null {
    if (!existsSync(this.dir)) return null
    for (const name of readdirSync(this.dir)) {
      const bin = join(this.dir, name, 'bin')
      if (existsSync(join(bin, EXE))) return bin
    }
    return existsSync(join(this.dir, 'bin', EXE)) ? join(this.dir, 'bin') : null
  }

  status() {
    return { ffmpeg: this.source, canDownload: process.platform === 'win32' }
  }

  /**
   * Picks the ffmpeg to use: a downloaded one wins (it is known to have what renders need),
   * then PATH (or FFMPEG_PATH). Downloads one on Windows when there is neither; resolves once
   * ffmpeg works.
   */
  async ensureFfmpeg(): Promise<FfmpegSource> {
    const bin = this.libraryBin()
    if (bin) {
      setFfmpegDir(bin)
      this.source = 'library'
      return this.source
    }
    try {
      await run(process.env.FFMPEG_PATH || 'ffmpeg', ['-version'], { keep: 2000 })
      this.source = 'path'
      return this.source
    } catch {}
    if (process.platform !== 'win32') return 'missing'
    await this.download().done
    return this.source
  }

  download() {
    const running = this.jobs.active('ffmpeg-setup', 'ffmpeg')
    if (running) return { job: running, done: Promise.resolve() }
    return this.jobs.enqueue('ffmpeg-setup', 'ffmpeg', 'net', async (ctx) => {
      ctx.progress(0.02, 'Ищу сборку ffmpeg')
      const res = await fetch(BTBN, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Shotbeam' },
        signal: ctx.signal,
      })
      if (!res.ok) throw new Error(`GitHub ответил ${res.status}`)
      const release = (await res.json()) as {
        assets: { name: string; browser_download_url: string }[]
      }
      // A numbered release (ffmpeg-n9.0-…), newest first; master builds as the fallback.
      const assets = release.assets
        .filter((a) => /^ffmpeg-.*-win64-gpl-shared.*\.zip$/.test(a.name))
        .sort((a, b) => {
          const v = (n: string) => Number(/-n(\d+\.\d+)/.exec(n)?.[1] ?? 0)
          return v(b.name) - v(a.name)
        })
      const asset = assets[0]
      if (!asset) throw new Error('Не нашёл сборку ffmpeg для Windows')
      rmSync(this.dir, { recursive: true, force: true })
      mkdirSync(this.dir, { recursive: true })
      const zip = join(this.dir, asset.name)
      ctx.progress(0.05, `Скачиваю ${asset.name}`)
      await download(asset.browser_download_url, zip, ctx.signal)
      ctx.progress(0.85, 'Распаковываю ffmpeg')
      await run('tar', ['-xf', zip, '-C', this.dir], { signal: ctx.signal })
      rmSync(zip, { force: true })
      const bin = this.libraryBin()
      if (!bin) throw new Error('ffmpeg распакован, но ffmpeg.exe не найден')
      setFfmpegDir(bin)
      this.source = 'library'
      return { bin, size: statSync(join(bin, EXE)).size }
    })
  }
}
