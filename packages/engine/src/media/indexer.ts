import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Analysis, type Asset, MusicAnalysis, nowIso, Transcript } from '@shotbeam/core'
import type { JobQueue } from '../jobs'
import type { Library } from '../paths'
import type { Python } from '../python'
import type { Store } from '../store'
import {
  analyzeLoudness,
  analyzeMotion,
  contactSheets,
  extractAudio,
  makeProxy,
  probe,
  thumbnail,
} from './ffmpeg'
import { findMoments } from './moments'
import { type Waveform, wavPeaks } from './waveform'

/*
 * Turns a file into something Claude and the editor can work with: a proxy, a thumbnail,
 * contact sheets, loudness and motion curves, a transcript with word times, candidate moments,
 * beats for music. Files live in the library's cache/<asset id>/.
 */

export const ANALYSIS_VERSION = 1

export function emptyAnalysis(): Analysis {
  return {
    version: ANALYSIS_VERSION,
    transcript: null,
    scenes: [],
    loudness: [],
    motion: [],
    sheets: [],
    moments: [],
    music: null,
  }
}

/** Roles whose speech is worth transcribing. */
const SPOKEN = new Set(['footage', 'reference', 'voice', 'render'])

export class Indexer {
  constructor(
    private readonly library: Library,
    private readonly store: Store,
    private readonly jobs: JobQueue,
    private readonly python: Python,
  ) {}

  dir(assetId: string) {
    return this.library.assetDir(assetId)
  }
  file(
    assetId: string,
    name: 'thumb.jpg' | 'proxy.mp4' | 'audio.wav' | 'analysis.json' | 'waveform.json',
  ) {
    return join(this.dir(assetId), name)
  }
  sheetFile(assetId: string, file: string) {
    return join(this.dir(assetId), 'sheets', file)
  }

  analysis(assetId: string): Analysis {
    const path = this.file(assetId, 'analysis.json')
    if (!existsSync(path)) return emptyAnalysis()
    try {
      return { ...emptyAnalysis(), ...(JSON.parse(readFileSync(path, 'utf8')) as Analysis) }
    } catch {
      return emptyAnalysis()
    }
  }

  private saveAnalysis(assetId: string, a: Analysis) {
    writeFileSync(this.file(assetId, 'analysis.json'), JSON.stringify(a))
  }

  /** The file to play in previews: the proxy when there is one. */
  playable(asset: Asset): string {
    const proxy = this.file(asset.id, 'proxy.mp4')
    return asset.kind === 'video' && existsSync(proxy) ? proxy : asset.path
  }

  /** Starts (or joins) indexing of an asset. */
  index(assetId: string) {
    const running = this.jobs.active('index', assetId)
    if (running) return running
    const asset = this.store.getAsset(assetId)
    this.store.saveAsset({ ...asset, status: 'indexing', error: null })
    return this.jobs.enqueue('index', assetId, 'media', async (ctx) => {
      try {
        await this.runMedia(assetId, ctx.progress, ctx.signal)
      } catch (err) {
        const current = this.store.getAsset(assetId)
        this.store.saveAsset({
          ...current,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        })
        throw err
      }
      return { assetId }
    }).job
  }

  private async runMedia(
    assetId: string,
    progress: (f: number, m?: string) => void,
    signal: AbortSignal,
  ) {
    let asset = this.store.getAsset(assetId)
    if (!existsSync(asset.path)) throw new Error(`File not found: ${asset.path}`)
    const st = statSync(asset.path)
    progress(0.02, 'Reading the file')
    const info = await probe(asset.path, signal)
    const kind = asset.kind === 'image' || info.still ? 'image' : info.hasVideo ? 'video' : 'audio'
    // Re-read: whoever made the file names and tags it while ffprobe runs (voices, upscales).
    asset = this.store.saveAsset({
      ...this.store.getAsset(assetId),
      kind,
      size: st.size,
      mtime: st.mtimeMs,
      duration: info.duration,
      width: info.width,
      height: info.height,
      fps: info.fps,
      hasAudio: info.hasAudio,
    })

    const dir = this.dir(assetId)
    rmSync(join(dir, 'sheets'), { recursive: true, force: true })
    const analysis = emptyAnalysis()
    const duration = info.duration ?? 0

    if (kind === 'image' || info.hasVideo || info.still) {
      progress(0.05, 'Thumbnail')
      await thumbnail(
        asset.path,
        this.file(assetId, 'thumb.jpg'),
        Math.min(1, duration * 0.1),
        kind === 'image',
      ).catch(() => {})
    } else if (kind === 'audio') {
      // Cover art, when the file has some.
      await thumbnail(asset.path, this.file(assetId, 'thumb.jpg'), 0, true).catch(() => {})
    }

    if (kind === 'video') {
      const settings = this.store.getSettings()
      progress(0.08, 'Making a preview copy')
      await makeProxy(asset.path, this.file(assetId, 'proxy.mp4'), {
        duration: info.duration,
        hasAudio: info.hasAudio,
        encoder: settings.encoder,
        signal,
        onProgress: (f) => progress(0.08 + f * 0.5, 'Making a preview copy'),
      })
      progress(0.6, 'Finding scenes')
      const { motion, cuts } = await analyzeMotion(
        this.file(assetId, 'proxy.mp4'),
        duration,
        signal,
      )
      analysis.motion = motion
      const bounds = [0, ...cuts, duration]
      analysis.scenes = bounds
        .slice(0, -1)
        .map((start, i) => ({ start, end: bounds[i + 1] as number }))
        .filter((s) => s.end - s.start > 0.2)
      progress(0.72, 'Contact sheets')
      const sheetsDir = join(dir, 'sheets')
      const { mkdirSync } = await import('node:fs')
      mkdirSync(sheetsDir, { recursive: true })
      analysis.sheets = await contactSheets(
        this.file(assetId, 'proxy.mp4'),
        sheetsDir,
        duration,
        signal,
      )
    }

    if (info.hasAudio && duration > 0) {
      progress(0.85, 'Listening')
      await extractAudio(asset.path, this.file(assetId, 'audio.wav'), signal)
      analysis.loudness = await analyzeLoudness(this.file(assetId, 'audio.wav'), duration, signal)
    }

    analysis.moments = findMoments({
      duration,
      transcript: null,
      loudness: analysis.loudness,
      motion: analysis.motion,
      cuts: analysis.scenes.slice(1).map((s) => s.start),
    })
    // Keep a transcript or beats from before when the file did not change.
    const previous = this.analysis(assetId)
    if (previous.transcript && asset.mtime === st.mtimeMs) analysis.transcript = previous.transcript
    this.saveAnalysis(assetId, analysis)

    const features = await this.python.features().catch(() => null)
    const wantsTranscript = info.hasAudio && SPOKEN.has(asset.role) && !analysis.transcript
    const wantsBeats = info.hasAudio && asset.role === 'music'
    this.store.saveAsset({
      ...this.store.getAsset(assetId),
      status:
        (wantsTranscript && features?.whisper) || (wantsBeats && features?.beats)
          ? 'indexing'
          : 'ready',
    })
    if (wantsTranscript && features?.whisper) this.transcribe(assetId)
    if (wantsBeats && features?.beats) this.beats(assetId)
  }

  /** Speech to text with word times (faster-whisper on this computer). */
  transcribe(assetId: string, language?: string) {
    const running = this.jobs.active('transcribe', assetId)
    if (running) return running
    return this.jobs.enqueue('transcribe', assetId, 'model', async (ctx) => {
      const audio = this.file(assetId, 'audio.wav')
      if (!existsSync(audio)) throw new Error('No audio extracted yet: index the asset first')
      const settings = this.store.getSettings()
      const out = await this.python.call(
        'transcribe',
        [
          '--audio',
          audio,
          '--model',
          settings.whisperModel,
          '--models',
          join(this.python.modelsDir, 'whisper'),
          '--device',
          settings.whisperDevice,
          ...(language ? ['--language', language] : []),
        ],
        { signal: ctx.signal, onProgress: (f, m) => ctx.progress(f, `Transcribing (${m})`) },
      )
      const raw = JSON.parse(readFileSync(out.file, 'utf8')) as Record<string, unknown>
      out.cleanup()
      const transcript = Transcript.parse(raw)
      const analysis = this.analysis(assetId)
      analysis.transcript = transcript
      const asset = this.store.getAsset(assetId)
      analysis.moments = findMoments({
        duration: asset.duration ?? 0,
        transcript,
        loudness: analysis.loudness,
        motion: analysis.motion,
        cuts: analysis.scenes.slice(1).map((s) => s.start),
      })
      this.saveAnalysis(assetId, analysis)
      this.store.indexAssetText(asset, transcript.text)
      this.store.saveAsset({ ...asset, status: 'ready', error: null })
      return {
        language: transcript.language,
        words: transcript.segments.reduce((n, s) => n + s.words.length, 0),
        device: raw.device,
      }
    }).job
  }

  /**
   * Peaks of the sound for drawing it, made from audio.wav the first time they are asked for and
   * kept until the audio is extracted again. Null for files without sound (or not indexed yet).
   */
  waveform(assetId: string): Waveform | null {
    const wav = this.file(assetId, 'audio.wav')
    if (!existsSync(wav)) return null
    const cached = this.file(assetId, 'waveform.json')
    if (existsSync(cached) && statSync(cached).mtimeMs >= statSync(wav).mtimeMs) {
      try {
        return JSON.parse(readFileSync(cached, 'utf8')) as Waveform
      } catch {}
    }
    const wave = wavPeaks(readFileSync(wav))
    writeFileSync(cached, JSON.stringify(wave))
    return wave
  }

  /** Tempo and beat times of a track (librosa). */
  beats(assetId: string) {
    const running = this.jobs.active('beats', assetId)
    if (running) return running
    return this.jobs.enqueue('beats', assetId, 'model', async (ctx) => {
      const asset = this.store.getAsset(assetId)
      const out = await this.python.call('beats', ['--audio', asset.path], {
        signal: ctx.signal,
        onProgress: (f, m) => ctx.progress(f, m),
      })
      const music = MusicAnalysis.parse(JSON.parse(readFileSync(out.file, 'utf8')))
      out.cleanup()
      const analysis = this.analysis(assetId)
      analysis.music = music
      this.saveAnalysis(assetId, analysis)
      const tags = new Set(asset.tags.filter((t) => !/^\d+ ?bpm$/i.test(t)))
      tags.add(`${Math.round(music.bpm)} bpm`)
      this.store.saveAsset({ ...asset, tags: [...tags], status: 'ready', updatedAt: nowIso() })
      return { bpm: music.bpm, beats: music.beats.length }
    }).job
  }
}
