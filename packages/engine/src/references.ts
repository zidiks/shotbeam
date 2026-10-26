import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { newId, nowIso, type Platform, type Reference } from '@shotbeam/core'
import type { JobQueue } from './jobs'
import type { Indexer } from './media/indexer'
import { run } from './media/run'
import type { Library } from './paths'
import type { Python } from './python'
import type { Sources } from './sources'
import type { Store } from './store'

/*
 * References: a link to someone else's video, downloaded with yt-dlp, kept only in the library and
 * indexed like footage, so Claude can take its format apart. The video is a creative guide, not
 * material: it never goes into a render.
 */

export function platformOf(url: string): Platform {
  let host = ''
  try {
    host = new URL(url).hostname.replace(/^www\./, '')
  } catch {
    throw new Error(`Not a link: ${url}`)
  }
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return 'youtube'
  if (/(^|\.)instagram\.com$/.test(host)) return 'instagram'
  if (/(^|\.)tiktok\.com$/.test(host)) return 'tiktok'
  if (/(^|\.)(x\.com|twitter\.com)$/.test(host)) return 'x'
  return 'other'
}

export class References {
  constructor(
    private readonly library: Library,
    private readonly store: Store,
    private readonly jobs: JobQueue,
    private readonly python: Python,
    private readonly sources: Sources,
    private readonly indexer: Indexer,
  ) {}

  listFor(projectId?: string) {
    return this.store.listReferences(projectId)
  }

  add(input: { url: string; projectId?: string | null; tags?: string[] }): Reference {
    const url = input.url.trim()
    const platform = platformOf(url)
    const existing = this.store.listReferences().find((r) => r.url === url)
    if (existing) return existing
    const now = nowIso()
    const ref = this.store.saveReference({
      id: newId(),
      url,
      platform,
      title: '',
      author: '',
      assetId: null,
      status: 'new',
      error: null,
      analysis: '',
      tags: input.tags ?? [],
      projectIds: input.projectId ? [input.projectId] : [],
      createdAt: now,
      updatedAt: now,
    })
    this.download(ref.id)
    return ref
  }

  download(id: string) {
    const running = this.jobs.active('reference', id)
    if (running) return running
    return this.jobs.enqueue('reference', id, 'net', async (ctx) => {
      let ref = this.store.saveReference({
        ...this.store.getReference(id),
        status: 'downloading',
        error: null,
      })
      try {
        const features = await this.python.features()
        if (!features.ytdlp)
          throw new Error('yt-dlp is not installed yet (Settings → Local models)')
        const dir = this.library.referenceDir(id)
        const settings = this.store.getSettings()
        const cookies =
          settings.cookiesBrowser === 'none'
            ? []
            : ['--cookies-from-browser', settings.cookiesBrowser]
        await run(
          this.python.ytdlp,
          [
            '--no-playlist',
            '--newline',
            '--no-colors',
            '-f',
            'bv*[height<=1920]+ba/b',
            '--merge-output-format',
            'mp4',
            '--write-info-json',
            '--write-thumbnail',
            '--convert-thumbnails',
            'jpg',
            '-o',
            join(dir, 'video.%(ext)s'),
            ...cookies,
            ref.url,
          ],
          {
            signal: ctx.signal,
            onStdoutLine: (line) => {
              const m = /\[download\]\s+([\d.]+)%/.exec(line)
              if (m) ctx.progress((Number(m[1]) / 100) * 0.9, 'Downloading')
            },
          },
        )
        const video = readdirSync(dir).find((f) => /^video\.(mp4|webm|mkv|mov)$/.test(f))
        if (!video) throw new Error('yt-dlp finished but no video file was written')
        const infoFile = join(dir, 'video.info.json')
        const info = existsSync(infoFile)
          ? (JSON.parse(readFileSync(infoFile, 'utf8')) as Record<string, unknown>)
          : {}
        const asset = this.sources.upsertAsset(join(dir, video), {
          sourceId: null,
          projectId: null,
          role: 'reference',
          existing: ref.assetId ? this.store.getAsset(ref.assetId) : null,
        })
        const description = String(info.description ?? '')
        this.store.saveAsset({
          ...asset,
          name: String(info.title ?? asset.name).slice(0, 200),
          notes: description.slice(0, 2000),
        })
        ref = this.store.saveReference({
          ...this.store.getReference(id),
          title: String(info.title ?? info.fulltitle ?? '').slice(0, 300),
          author: String(info.uploader ?? info.channel ?? info.creator ?? ''),
          assetId: asset.id,
          status: 'indexing',
        })
        this.indexer.index(asset.id)
        return { assetId: asset.id }
      } catch (err) {
        this.store.saveReference({
          ...this.store.getReference(id),
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        })
        throw err
      }
    }).job
  }

  /** A reference is ready once its video is indexed. */
  syncStatus(assetId: string) {
    const ref = this.store.listReferences().find((r) => r.assetId === assetId)
    if (!ref) return
    const asset = this.store.getAsset(assetId)
    const status =
      asset.status === 'ready' ? 'ready' : asset.status === 'error' ? 'error' : 'indexing'
    if (status !== ref.status) {
      this.store.saveReference({
        ...ref,
        status,
        error: asset.status === 'error' ? asset.error : null,
      })
    }
  }

  thumbnail(id: string): string | null {
    const dir = this.library.referenceDir(id)
    const f = readdirSync(dir).find((n) => /^video\.jpg$/.test(n))
    return f ? join(dir, f) : null
  }
}
