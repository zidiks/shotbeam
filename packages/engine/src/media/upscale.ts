import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { chmod } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebStream } from 'node:stream/web'
import { type Asset, newId, nowIso, type UpscaleModel } from '@shotbeam/core'
import type { JobQueue } from '../jobs'
import type { Library } from '../paths'
import type { Sources } from '../sources'
import type { Store } from '../store'
import { ffmpeg } from './ffmpeg'
import { run } from './run'

/*
 * Upscaling with Real-ESRGAN (realesrgan-ncnn-vulkan: one program on Vulkan, so any recent GPU,
 * no Python or CUDA). Two models, picked per job:
 * - animevideo: realesr-animevideov3, made for video; fast; best on drawn, game and stylised
 *   footage; ×2, ×3 or ×4;
 * - general: realesrgan-x4plus, for camera footage; slower; always ×4 inside (smaller scales
 *   are scaled down after).
 * A video goes through in batches of frames (extract once as JPEG → upscale a batch → encode it
 * as a segment → delete its frames), so the disk never holds all the big frames at once. The
 * result is a new asset next to the original, which is left alone.
 */

const RELEASE = 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0'
const ZIP: Partial<Record<NodeJS.Platform, string>> = {
  win32: 'realesrgan-ncnn-vulkan-20220424-windows.zip',
  linux: 'realesrgan-ncnn-vulkan-20220424-ubuntu.zip',
  darwin: 'realesrgan-ncnn-vulkan-20220424-macos.zip',
}
const EXE = process.platform === 'win32' ? 'realesrgan-ncnn-vulkan.exe' : 'realesrgan-ncnn-vulkan'

/** Frames upscaled and encoded at a time. */
const BATCH = 120

export const UPSCALE_MODELS: Record<
  UpscaleModel,
  { name: string; scales: number[]; label: string }
> = {
  animevideo: {
    name: 'realesr-animevideov3',
    scales: [2, 3, 4],
    label: 'animevideov3 (рисованное, игры, стилизация)',
  },
  general: { name: 'realesrgan-x4plus', scales: [2, 3, 4], label: 'x4plus (живая съёмка)' },
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

export class Upscaler {
  constructor(
    private readonly library: Library,
    private readonly store: Store,
    private readonly jobs: JobQueue,
    private readonly sources: Sources,
  ) {
    // Frames of an upscale cut short (the engine closed mid-job) are useless: free the disk.
    const out = join(library.root, 'generated', 'upscaled')
    if (existsSync(out))
      for (const name of readdirSync(out))
        if (name.startsWith('work-')) rmSync(join(out, name), { recursive: true, force: true })
  }

  private get dir() {
    return join(this.library.root, 'tools', 'realesrgan')
  }

  /** The program, wherever the archive put it (its folder holds `models`). */
  binary(): string | null {
    const find = (dir: string, depth: number): string | null => {
      if (!existsSync(dir)) return null
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (name === EXE) return path
        if (depth > 0 && statSync(path).isDirectory()) {
          const inner = find(path, depth - 1)
          if (inner) return inner
        }
      }
      return null
    }
    return find(this.dir, 2)
  }

  status() {
    return { ready: !!this.binary(), supported: !!ZIP[process.platform] }
  }

  /** Downloads and unpacks Real-ESRGAN into the library (about 45 MB with the models). */
  install() {
    const running = this.jobs.active('upscaler-setup', 'realesrgan')
    if (running) return running
    return this.jobs.enqueue('upscaler-setup', 'realesrgan', 'net', async (ctx) => {
      const zip = ZIP[process.platform]
      if (!zip) throw new Error(`Real-ESRGAN has no build for ${process.platform}`)
      rmSync(this.dir, { recursive: true, force: true })
      mkdirSync(this.dir, { recursive: true })
      const file = join(this.dir, zip)
      ctx.progress(0.02, 'Скачиваю Real-ESRGAN')
      const res = await fetch(`${RELEASE}/${zip}`, { signal: ctx.signal })
      if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`)
      const total = Number(res.headers.get('content-length')) || 0
      let got = 0
      const body = Readable.fromWeb(res.body as unknown as WebStream<Uint8Array>)
      body.on('data', (chunk: Buffer) => {
        got += chunk.length
        if (total) ctx.progress(0.02 + 0.85 * (got / total), 'Скачиваю Real-ESRGAN')
      })
      await pipeline(body, createWriteStream(file))
      ctx.progress(0.9, 'Распаковываю')
      // bsdtar on Windows 10+ and macOS reads zip; Linux has unzip.
      if (process.platform === 'linux') await run('unzip', ['-o', '-q', file, '-d', this.dir])
      else await run('tar', ['-xf', file, '-C', this.dir], { signal: ctx.signal })
      rmSync(file, { force: true })
      const exe = this.binary()
      if (!exe) throw new Error('Real-ESRGAN unpacked, but its program was not found')
      if (process.platform !== 'win32') await chmod(exe, 0o755)
      return { path: exe }
    }).job
  }

  /** Starts upscaling an asset into a new one. */
  upscale(assetId: string, opts: { model: UpscaleModel; scale: number }) {
    const asset = this.store.getAsset(assetId)
    if (asset.kind !== 'video' && asset.kind !== 'image')
      throw Object.assign(new Error('Апскейлить можно видео и картинки'), { status: 400 })
    if (asset.role === 'reference')
      throw Object.assign(new Error('Референсы не апскейлятся: они не идут в монтаж'), {
        status: 400,
      })
    const exe = this.binary()
    if (!exe)
      throw Object.assign(
        new Error('Real-ESRGAN не установлен: Настройки → Локальные модели → Апскейл'),
        { status: 400 },
      )
    if (!UPSCALE_MODELS[opts.model].scales.includes(opts.scale))
      throw Object.assign(new Error(`Масштаб ×${opts.scale} не поддерживается`), { status: 400 })
    const key = `${assetId}:${opts.model}:${opts.scale}`
    const running = this.jobs.active('upscale', key)
    if (running) return running
    return this.jobs.enqueue('upscale', key, 'model', async (ctx) => {
      const out = await this.run(exe, asset, opts, ctx.progress, ctx.signal)
      const created = this.sources.importFile(out, {
        projectId: asset.projectId,
        role: asset.role,
      })
      const label = opts.model === 'animevideo' ? 'anime' : 'x4plus'
      this.store.saveAsset({
        ...this.store.getAsset(created.id),
        name: `${asset.name.replace(/\.[^.]+$/, '')} ×${opts.scale} ${label}${extname(out)}`,
        tags: [...new Set([...asset.tags.filter((t) => !/^\d+ ?bpm$/i.test(t)), 'upscaled'])],
        notes: `Апскейл ×${opts.scale} (${UPSCALE_MODELS[opts.model].name}) из «${asset.name}» [${asset.id}]`,
        updatedAt: nowIso(),
      })
      return { assetId: created.id, path: out }
    }).job
  }

  private async run(
    exe: string,
    asset: Asset,
    opts: { model: UpscaleModel; scale: number },
    progress: (f: number, m?: string) => void,
    signal: AbortSignal,
  ): Promise<string> {
    const model = UPSCALE_MODELS[opts.model]
    // x4plus only exists at ×4: run it at 4 and scale down to what was asked.
    const native = opts.model === 'general' ? 4 : opts.scale
    const outDir = join(this.library.root, 'generated', 'upscaled')
    mkdirSync(outDir, { recursive: true })
    const stem = `${basename(asset.path, extname(asset.path))}-x${opts.scale}-${opts.model}-${newId().slice(0, 6)}`
    const work = join(outDir, `work-${stem}`)
    mkdirSync(work, { recursive: true })
    const esrgan = (input: string, output: string) =>
      run(
        exe,
        [
          '-i',
          input,
          '-o',
          output,
          '-n',
          model.name,
          '-s',
          String(native),
          '-m',
          join(exe, '..', 'models'),
          '-f',
          'png',
        ],
        { cwd: join(exe, '..'), signal },
      )
    const w = asset.width ?? 0
    const h = asset.height ?? 0
    const size =
      native !== opts.scale && w && h
        ? ['-vf', `scale=${even(w * opts.scale)}:${even(h * opts.scale)}:flags=lanczos`]
        : // libx264 needs even sides.
          ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2']
    try {
      if (asset.kind === 'image') {
        progress(0.1, 'Апскейл картинки')
        const big = join(work, 'big.png')
        await esrgan(asset.path, big)
        const out = join(outDir, `${stem}.png`)
        if (native !== opts.scale && w && h)
          await ffmpeg(
            ['-i', big, '-vf', `scale=${w * opts.scale}:${h * opts.scale}:flags=lanczos`, out],
            { signal },
          )
        else renameSync(big, out)
        return out
      }

      const fps = asset.fps && asset.fps > 0 ? asset.fps : 30
      const frames = join(work, 'frames')
      mkdirSync(frames)
      progress(0.02, 'Достаю кадры')
      await ffmpeg(
        [
          '-i',
          asset.path,
          '-map',
          '0:v:0',
          '-vf',
          `fps=${fps}`,
          '-q:v',
          '1',
          join(frames, '%06d.jpg'),
        ],
        {
          signal,
          duration: asset.duration,
          onProgress: (f) => progress(0.02 + f * 0.08, 'Достаю кадры'),
        },
      )
      const all = readdirSync(frames)
        .filter((f) => f.endsWith('.jpg'))
        .sort()
      if (!all.length) throw new Error('ffmpeg не достал ни одного кадра')
      const segments: string[] = []
      for (let i = 0; i < all.length; i += BATCH) {
        const batch = all.slice(i, i + BATCH)
        const inDir = join(work, 'in')
        const upDir = join(work, 'up')
        rmSync(inDir, { recursive: true, force: true })
        rmSync(upDir, { recursive: true, force: true })
        mkdirSync(inDir)
        mkdirSync(upDir)
        for (const f of batch) renameSync(join(frames, f), join(inDir, f))
        // Real-ESRGAN says nothing useful while it works: count the frames it has written.
        const tick = () => {
          const done = i + readdirSync(upDir).length
          progress(0.1 + 0.82 * (done / all.length), `Апскейл: ${done} из ${all.length} кадров`)
        }
        tick()
        const timer = setInterval(tick, 1000)
        try {
          await esrgan(inDir, upDir)
        } finally {
          clearInterval(timer)
        }
        const made = readdirSync(upDir).filter((f) => f.endsWith('.png'))
        if (made.length !== batch.length)
          throw new Error(
            `Real-ESRGAN сделал ${made.length} кадров из ${batch.length} (не хватило видеопамяти или Vulkan?)`,
          )
        const segment = join(work, `seg-${String(segments.length).padStart(4, '0')}.mp4`)
        await ffmpeg(
          [
            '-framerate',
            String(fps),
            '-start_number',
            String(Number.parseInt(batch[0] as string, 10)),
            '-i',
            join(upDir, '%06d.png'),
            ...size,
            '-c:v',
            'libx264',
            '-preset',
            'fast',
            '-crf',
            '16',
            '-pix_fmt',
            'yuv420p',
            segment,
          ],
          { signal },
        )
        segments.push(segment)
        rmSync(inDir, { recursive: true, force: true })
        rmSync(upDir, { recursive: true, force: true })
      }
      progress(0.95, 'Собираю видео')
      const list = join(work, 'segments.txt')
      writeFileSync(
        list,
        segments.map((s) => `file '${s.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'),
      )
      const out = join(outDir, `${stem}.mp4`)
      await ffmpeg(
        [
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          list,
          '-i',
          asset.path,
          '-map',
          '0:v:0',
          '-map',
          '1:a:0?',
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-movflags',
          '+faststart',
          out,
        ],
        { signal },
      )
      return out
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  }
}
