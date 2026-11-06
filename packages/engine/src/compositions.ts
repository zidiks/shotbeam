import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  ASPECT_SIZE,
  type Aspect,
  type Asset,
  applyOps,
  type CaptionStyle,
  type Composition,
  type CompositionOp,
  captionWords,
  compositionDuration,
  newId,
  nowIso,
  type ReviewResult,
  reviewComposition,
  shiftWords,
  timelineBeats,
  trackLabel,
  type Word,
} from '@shotbeam/core'
import type { JobQueue } from './jobs'
import { measureLoudness } from './media/ffmpeg'
import type { Indexer } from './media/indexer'
import type { Motion } from './motion/motion'
import type { Library } from './paths'
import type { Fonts } from './render/fonts'
import { renderComposition } from './render/render'
import type { Sources } from './sources'
import type { Store } from './store'

/*
 * Compositions: creating them (empty or from a format), applying edits, captions from what is
 * said, and rendering to a `render` asset.
 */

export class Compositions {
  constructor(
    private readonly library: Library,
    private readonly store: Store,
    private readonly jobs: JobQueue,
    private readonly indexer: Indexer,
    private readonly sources: Sources,
    private readonly fonts: Fonts,
    private readonly motion: Motion,
  ) {}

  create(input: {
    projectId: string
    name: string
    aspect?: Aspect
    formatId?: string | null
    fps?: number
  }) {
    this.store.getProject(input.projectId)
    const format = input.formatId ? this.store.getFormat(input.formatId) : null
    const aspect = input.aspect ?? format?.recipe.aspect ?? '9:16'
    const size = ASPECT_SIZE[aspect]
    const now = nowIso()
    const c: Composition = {
      id: newId(),
      projectId: input.projectId,
      formatId: format?.id ?? null,
      name: input.name,
      width: size.width,
      height: size.height,
      fps: input.fps ?? 30,
      background: '#000000',
      // V2, V1 (main), A1 (voice), A2 (music): more appear as items need them.
      tracks: (['visual', 'visual', 'audio', 'audio'] as const).map((kind) => ({
        id: newId(),
        kind,
        name: '',
        muted: false,
        hidden: false,
        items: [],
      })),
      version: 0,
      createdAt: now,
      updatedAt: now,
    }
    return this.store.saveComposition(c)
  }

  /** Applies edits atomically; `expectVersion` guards against overwriting someone else's edit. */
  apply(id: string, ops: CompositionOp[], expectVersion?: number, opts: { history?: 'skip' } = {}) {
    const current = this.store.getComposition(id)
    if (expectVersion !== undefined && current.version !== expectVersion) {
      throw Object.assign(
        new Error(`The composition changed meanwhile (version ${current.version}); read it again`),
        {
          status: 409,
        },
      )
    }
    for (const op of ops) {
      if (op.op !== 'add') continue
      this.checkAssetRefs(op.item)
      // Voice and the clips' sound on A1, music and effects from A2, unless the edit says where.
      if (op.item.type === 'audio' && !op.trackId && op.level === undefined) {
        const role = this.store.getAsset(op.item.assetId as string).role
        if (role === 'music' || role === 'sfx') op.level = 1
      }
    }
    const { composition, created } = applyOps(current, ops, {
      beats: (c) => this.timelineBeats(c),
      sourceLength: (assetId) => this.store.getAsset(assetId).duration,
    })
    const saved = this.store.saveComposition(composition, current.version, opts)
    return { composition: saved, created }
  }

  private timelineBeats(c: Composition) {
    return timelineBeats(c, (assetId) => this.indexer.analysis(assetId).music?.beats)
  }

  /** Loudness of rendered files, by path and change time (measuring reads the whole file). */
  private readonly loudness = new Map<
    string,
    { loudness: number | null; truePeak: number | null }
  >()

  /**
   * What a first-time viewer would trip over (core/review.ts), with the loudness of the last
   * render measured.
   */
  async review(
    id: string,
  ): Promise<ReviewResult & { render: { assetId: string; path: string } | null }> {
    const c = this.store.getComposition(id)
    const assets = new Map<string, { role: Asset['role']; hasAudio: boolean }>()
    let speech = false
    for (const track of c.tracks)
      for (const item of track.items) {
        if (item.type !== 'clip' && item.type !== 'audio') continue
        if (assets.has(item.assetId)) continue
        const a = this.store.getAsset(item.assetId)
        assets.set(a.id, { role: a.role, hasAudio: a.hasAudio })
        if (track.muted) continue
        if (a.role === 'voice') speech = true
        else if (
          item.type === 'clip' &&
          a.hasAudio &&
          this.indexer.analysis(a.id).transcript?.text.trim()
        )
          speech = true
      }
    const format = c.formatId ? this.store.getFormat(c.formatId) : null
    // The newest render of this composition (render assets note where they came from).
    const render = this.store
      .listAssets({ role: 'render', limit: 1000 })
      .items.filter((a) => a.notes === `Composition ${c.id}` && existsSync(a.path))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    let measured: { loudness: number | null; truePeak: number | null } | null = null
    if (render) {
      const key = `${render.path}:${statSync(render.path).mtimeMs}`
      measured = this.loudness.get(key) ?? null
      if (!measured) {
        measured = await measureLoudness(render.path).catch(() => null)
        if (measured) this.loudness.set(key, measured)
      }
    }
    const result = reviewComposition({
      composition: c,
      assets,
      beats: this.timelineBeats(c),
      format,
      speech,
      render: measured,
    })
    return { ...result, render: render ? { assetId: render.id, path: render.path } : null }
  }

  /**
   * The beat grid of the music under the edit, in timeline time, with where it comes from, and
   * whether the format asks for cuts on the beat.
   */
  beats(id: string) {
    const c = this.store.getComposition(id)
    const music: { itemId: string; assetId: string; track: string; bpm: number | null }[] = []
    for (const track of c.tracks) {
      if (track.kind !== 'audio' || track.muted) continue
      for (const item of track.items) {
        if (item.type !== 'audio') continue
        const m = this.indexer.analysis(item.assetId).music
        const role = this.store.getAsset(item.assetId).role
        if (!m && role !== 'music') continue
        music.push({
          itemId: item.id,
          assetId: item.assetId,
          track: trackLabel(c, track.id),
          bpm: m?.bpm ?? null,
        })
      }
    }
    const format = c.formatId ? this.store.getFormat(c.formatId) : null
    return {
      beats: this.timelineBeats(c),
      music,
      cutOnBeat: format?.recipe.pacing.cutOnBeat ?? false,
    }
  }

  private checkAssetRefs(item: Record<string, unknown>) {
    const id = item.assetId
    if (typeof id !== 'string') return
    const asset = this.store.getAsset(id)
    if (asset.role === 'reference') {
      throw new Error(
        "Reference videos are someone else's work: use them to learn the format, not in the edit",
      )
    }
    // Clips default to the whole file when no in/out is given.
    if (item.type === 'clip' || item.type === 'audio') {
      item.in ??= 0
      item.out ??= asset.duration ?? 5
    }
  }

  /**
   * Captions for the composition: words from the transcripts of the voice track items, else of
   * the clips' own sound. Replaces earlier captions items.
   */
  captions(
    id: string,
    style: Partial<CaptionStyle> = {},
    source: 'auto' | 'voice' | 'clips' = 'auto',
  ) {
    const c = this.store.getComposition(id)
    const words: Word[] = []
    if (source !== 'clips') {
      for (const track of c.tracks) {
        if (track.kind !== 'audio' || track.muted) continue
        for (const item of track.items) {
          if (item.type !== 'audio') continue
          const asset = this.store.getAsset(item.assetId)
          if (asset.role !== 'voice') continue
          const t = this.indexer.analysis(asset.id).transcript
          if (!t) throw new Error(`"${asset.name}" has no transcript yet; wait for indexing`)
          const inRange = t.segments
            .flatMap((s) => s.words)
            .filter((w) => w.end > item.in && w.start < item.out)
          words.push(...shiftWords(inRange, item.start - item.in))
        }
      }
    }
    if (!words.length && source !== 'voice') {
      const map = new Map<string, Word[]>()
      for (const track of c.tracks) {
        for (const item of track.items) {
          if (item.type !== 'clip' || map.has(item.assetId)) continue
          const t = this.indexer.analysis(item.assetId).transcript
          if (t)
            map.set(
              item.assetId,
              t.segments.flatMap((s) => s.words),
            )
        }
      }
      words.push(...captionWords(c, map))
    }
    if (!words.length) throw new Error('No transcribed speech in this composition to caption')
    words.sort((a, b) => a.start - b.start)
    const format = c.formatId ? this.store.getFormat(c.formatId) : null
    const f = format?.recipe.captions
    const ops: CompositionOp[] = []
    for (const track of c.tracks) {
      for (const item of track.items)
        if (item.type === 'captions') ops.push({ op: 'remove', id: item.id })
    }
    const start = Math.max(0, (words[0] as Word).start - 0.05)
    const end = Math.max(compositionDuration(c), (words[words.length - 1] as Word).end + 0.2)
    ops.push({
      op: 'add',
      item: {
        type: 'captions',
        start,
        duration: end - start,
        words,
        style: {
          preset: f?.style === 'karaoke' || f?.style === 'minimal' ? f.style : 'bold-pop',
          y: f?.position ?? 0.63,
          uppercase: f?.uppercase ?? false,
          maxWords: f?.maxWords ?? 3,
          ...style,
        },
      },
    })
    return this.apply(id, ops)
  }

  /** Renders one motion item (a job) and points the item at the result. */
  renderMotion(id: string, itemId: string) {
    const running = this.jobs.active('motion', itemId)
    if (running) return running
    return this.jobs.enqueue('motion', itemId, 'media', async (ctx) => ({
      assetId: await this.renderMotionNow(id, itemId, ctx.progress, ctx.signal),
    })).job
  }

  private async renderMotionNow(
    id: string,
    itemId: string,
    progress: (f: number, m?: string) => void,
    signal?: AbortSignal,
  ) {
    const c = this.store.getComposition(id)
    const item = c.tracks.flatMap((t) => t.items).find((i) => i.id === itemId)
    if (item?.type !== 'motion') throw new Error(`No motion item ${itemId}`)
    const assetId = await this.motion.renderNow(
      id,
      item,
      { width: c.width, height: c.height, fps: c.fps },
      progress,
      signal,
    )
    this.apply(id, [{ op: 'update', id: itemId, patch: { renderedAssetId: assetId } }], undefined, {
      history: 'skip',
    })
    return assetId
  }

  /** Renders to an MP4 and adds it to the project as a `render` asset. */
  render(id: string, opts: { draft?: boolean } = {}) {
    const running = this.jobs.active('render', id)
    if (running) return running
    return this.jobs.enqueue('render', id, 'media', async (ctx) => {
      // Motion items without a current render get one first.
      for (const item of this.store.getComposition(id).tracks.flatMap((t) => t.items)) {
        if (item.type !== 'motion' || item.renderedAssetId) continue
        await this.renderMotionNow(id, item.id, (f, m) => ctx.progress(f * 0.3, m), ctx.signal)
      }
      const c = this.store.getComposition(id)
      const assets = new Map<string, Asset>()
      for (const track of c.tracks) {
        for (const item of track.items) {
          const ref =
            item.type === 'clip' || item.type === 'audio'
              ? item.assetId
              : item.type === 'motion'
                ? item.renderedAssetId
                : null
          if (ref && !assets.has(ref)) assets.set(ref, this.store.getAsset(ref))
        }
      }
      for (const a of assets.values()) {
        if (!existsSync(a.path)) throw new Error(`Source file is missing: ${a.path}`)
      }
      const dir = this.library.renderDir(c.id)
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const workDir = join(dir, `work-${stamp}`)
      mkdirSync(workDir, { recursive: true })
      const safe =
        c.name
          .replace(/[^\p{L}\p{N}_-]+/gu, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 60) || 'video'
      const out = join(dir, `${safe}-v${c.version}${opts.draft ? '-draft' : ''}-${stamp}.mp4`)
      const draft = !!opts.draft
      await renderComposition({
        composition: c,
        assets,
        source: (asset, useProxy) => (useProxy ? this.indexer.playable(asset) : asset.path),
        fonts: { dir: this.fonts.dir, resolve: (f) => this.fonts.resolve(f) },
        encoder: this.store.getSettings().encoder,
        draft,
        out,
        workDir,
        signal: ctx.signal,
        onProgress: (f) => ctx.progress(f * 0.95, draft ? 'Draft render' : 'Rendering'),
      })
      if (!existsSync(out) || statSync(out).size === 0) throw new Error('ffmpeg wrote no video')
      // The filter graph and subtitles stay only when a render fails (to see why).
      rmSync(workDir, { recursive: true, force: true })
      const asset = this.sources.importFile(out, { projectId: c.projectId, role: 'render' })
      this.store.saveAsset({
        ...this.store.getAsset(asset.id),
        name: `${c.name} v${c.version}${draft ? ' (draft)' : ''}`,
        tags: ['render', ...(draft ? ['draft'] : [])],
        notes: `Composition ${c.id}`,
      })
      return { assetId: asset.id, path: out }
    }).job
  }
}
