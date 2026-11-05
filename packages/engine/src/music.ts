import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { nowIso } from '@shotbeam/core'
import type { JobQueue } from './jobs'
import type { Library } from './paths'
import { download, type Python } from './python'
import type { Sources } from './sources'
import type { Store } from './store'

/*
 * Music from outside the library:
 * - Openverse (api.openverse.org): Creative Commons audio from Jamendo, Freesound, ccMixter,
 *   Wikimedia… Searched with licences that allow commercial use and changes (music under a
 *   video is an adaptation), so CC0, public domain and CC BY by default, CC BY-SA on request;
 *   never ND or NC. CC BY needs a credit: it is kept in the track's notes.
 * - Pixabay Music has no API (its API covers images and videos only): a search link to open in
 *   the browser; the person downloads and drops the file in. YouTube Content ID can still claim
 *   some of its tracks.
 * - MusicGen (Meta, local, via the Python worker): short instrumentals from a text prompt. Its
 *   weights are CC BY-NC 4.0: fine to try, not for monetised videos.
 * Imported and generated tracks become shared `music` assets; indexing finds their beats and mood.
 */

const OPENVERSE = 'https://api.openverse.org/v1/audio/'
const AGENT = 'Shotbeam/0.1 (local short-video studio)'

export type OpenverseLicense = 'credit' | 'share-alike'

export interface OpenverseTrack {
  id: string
  title: string
  creator: string
  license: string
  licenseUrl: string
  /** The audio file. */
  url: string
  /** Seconds. */
  duration: number | null
  landing: string
  attribution: string
  source: string
  genres: string[]
  tags: string[]
  filetype: string
}

interface RawTrack {
  id: string
  title?: string
  creator?: string
  license: string
  license_version?: string
  license_url?: string
  url: string
  duration?: number | null
  foreign_landing_url?: string
  attribution?: string
  source?: string
  genres?: string[] | null
  tags?: { name: string }[] | null
  filetype?: string | null
}

const LICENSES: Record<OpenverseLicense, string> = {
  credit: 'cc0,pdm,by',
  'share-alike': 'cc0,pdm,by,by-sa',
}

function track(r: RawTrack): OpenverseTrack {
  return {
    id: r.id,
    title: r.title || 'Без названия',
    creator: r.creator || '',
    license: `${r.license.toUpperCase()}${r.license_version ? ` ${r.license_version}` : ''}`,
    licenseUrl: r.license_url ?? '',
    url: r.url,
    duration: r.duration ? r.duration / 1000 : null,
    landing: r.foreign_landing_url ?? '',
    attribution: r.attribution ?? '',
    source: r.source ?? '',
    genres: r.genres ?? [],
    // Jamendo's speed_* and the like say little; keep words.
    tags: (r.tags ?? []).map((t) => t.name).filter((t) => !/^speed_/.test(t)),
    filetype: r.filetype ?? '',
  }
}

async function openverse<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${OPENVERSE}${path}`, {
    headers: { 'User-Agent': AGENT, Accept: 'application/json' },
    signal,
  })
  if (res.status === 429)
    throw Object.assign(new Error('Openverse: слишком много запросов, попробуй через минуту'), {
      status: 429,
    })
  if (!res.ok) throw new Error(`Openverse ответил ${res.status}`)
  return (await res.json()) as T
}

export function pixabayMusicUrl(query: string) {
  const q = query.trim()
  return q
    ? `https://pixabay.com/music/search/${encodeURIComponent(q)}/`
    : 'https://pixabay.com/music/'
}

export class Music {
  constructor(
    private readonly library: Library,
    private readonly store: Store,
    private readonly jobs: JobQueue,
    private readonly python: Python,
    private readonly sources: Sources,
  ) {}

  private dir(kind: 'openverse' | 'musicgen') {
    const dir = join(this.library.root, 'music', kind)
    mkdirSync(dir, { recursive: true })
    return dir
  }

  async search(
    query: string,
    opts: { license?: OpenverseLicense; page?: number; pageSize?: number } = {},
  ) {
    const params = new URLSearchParams({
      q: query,
      // Not category=music: most usable tracks are Freesound loops and pieces, which carry no
      // category; 30 s to 10 min leaves out one-shot sound effects instead.
      length: 'short,medium',
      license: LICENSES[opts.license ?? 'credit'],
      page: String(opts.page ?? 1),
      page_size: String(Math.min(50, opts.pageSize ?? 20)),
    })
    const r = await openverse<{ result_count: number; page_count: number; results: RawTrack[] }>(
      `?${params}`,
    )
    return {
      total: r.result_count,
      pages: r.page_count,
      results: r.results.map(track),
      pixabay: pixabayMusicUrl(query),
    }
  }

  /** Downloads an Openverse track into the shared music library (once). */
  importOpenverse(id: string, projectId: string | null = null) {
    const running = this.jobs.active('music-import', id)
    if (running) return running
    return this.jobs.enqueue('music-import', id, 'net', async (ctx) => {
      // Details from Openverse itself, not from the caller: the licence decides what is allowed.
      const t = track(await openverse<RawTrack>(`${encodeURIComponent(id)}/`, ctx.signal))
      if (!/^(CC0|PDM|BY|BY-SA)\b/.test(t.license))
        throw new Error(`Лицензия ${t.license} не подходит для музыки под видео`)
      const ext =
        t.filetype === 'mp32' || !t.filetype ? 'mp3' : t.filetype.replace(/[^a-z0-9]/gi, '')
      const file = join(this.dir('openverse'), `${id}.${ext}`)
      const known = existsSync(file) ? this.store.findAssetByPath(file) : null
      if (known) return { assetId: known.id, attribution: t.attribution, existed: true }
      ctx.progress(0.1, `Скачиваю «${t.title}»`)
      await download(t.url, file, ctx.signal)
      const asset = this.sources.importFile(file, { projectId, role: 'music' })
      this.store.saveAsset({
        ...this.store.getAsset(asset.id),
        name: `${t.title}${t.creator ? ` — ${t.creator}` : ''}`,
        tags: [...new Set([...t.genres, ...t.tags, 'openverse', t.license])].slice(0, 16),
        notes: [
          t.license.startsWith('BY')
            ? `Нужна атрибуция в описании ролика: ${t.attribution}`
            : `Лицензия ${t.license}: атрибуция не обязательна. ${t.attribution}`,
          t.landing ? `Страница: ${t.landing}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        updatedAt: nowIso(),
      })
      return { assetId: asset.id, attribution: t.attribution, existed: false }
    }).job
  }

  /** An instrumental from a prompt with MusicGen on this computer (up to 30 s). */
  generate(input: {
    prompt: string
    seconds: number
    model: 'small' | 'medium'
    projectId: string | null
  }) {
    return this.jobs.enqueue('musicgen', null, 'model', async (ctx) => {
      const features = await this.python.features()
      if (!features.musicgen)
        throw new Error('MusicGen не установлен: Настройки → Локальные модели')
      const text = this.python.textFile(input.prompt)
      try {
        const res = await this.python.call(
          'musicgen',
          [
            '--text-file',
            text.file,
            '--model',
            `facebook/musicgen-${input.model}`,
            '--seconds',
            String(Math.min(30, Math.max(2, input.seconds))),
          ],
          { ext: 'wav', signal: ctx.signal, onProgress: ctx.progress },
        )
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        const out = join(this.dir('musicgen'), `musicgen-${stamp}.wav`)
        // The worker writes to the system temp folder, maybe on another drive.
        copyFileSync(res.file, out)
        res.cleanup()
        const asset = this.sources.importFile(out, { projectId: input.projectId, role: 'music' })
        this.store.saveAsset({
          ...this.store.getAsset(asset.id),
          name: `MusicGen: ${input.prompt.slice(0, 60)}`,
          tags: ['musicgen', 'generated'],
          notes: `Промпт: ${input.prompt}\nМодель facebook/musicgen-${input.model}. Веса MusicGen под CC BY-NC 4.0: для монетизируемых роликов не подходит.`,
          updatedAt: nowIso(),
        })
        return { assetId: asset.id }
      } finally {
        text.cleanup()
      }
    }).job
  }
}
