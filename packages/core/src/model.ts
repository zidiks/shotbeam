import { z } from 'zod'

/*
 * The whole domain as zod schemas: the engine validates what it stores, the MCP server and the UI
 * share the inferred types. Times are seconds (floats) everywhere.
 */

export const Aspect = z.enum(['9:16', '1:1', '4:5', '16:9'])
export type Aspect = z.infer<typeof Aspect>

export const ASPECT_SIZE: Record<Aspect, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
  '16:9': { width: 1920, height: 1080 },
}

export const BrandKit = z.object({
  colors: z
    .object({
      primary: z.string().default('#ff6a1a'),
      accent: z.string().default('#ffd400'),
      text: z.string().default('#ffffff'),
      background: z.string().default('#111111'),
    })
    .default({ primary: '#ff6a1a', accent: '#ffd400', text: '#ffffff', background: '#111111' }),
  fonts: z
    .object({ heading: z.string().default('Inter'), body: z.string().default('Inter') })
    .default({ heading: 'Inter', body: 'Inter' }),
  /** Tone of voice and audience in plain words, for scripts and captions. */
  tone: z.string().default(''),
  /** Do and don't: words to avoid, legal lines, visual limits. */
  rules: z.string().default(''),
  languages: z.array(z.string()).default(['ru']),
})
export type BrandKit = z.infer<typeof BrandKit>

export const Project = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string().default(''),
  brand: BrandKit,
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Project = z.infer<typeof Project>

/** Where media comes from. Google Drive for Desktop folders are `local` sources too. */
export const Source = z.object({
  id: z.string(),
  /** null: shared by every project (a music library, say). */
  projectId: z.string().nullable(),
  kind: z.enum(['local']),
  name: z.string(),
  path: z.string(),
  /** What the files in it are for; the role new assets get. */
  role: z.enum(['footage', 'music', 'sfx', 'brand']).default('footage'),
  createdAt: z.string(),
  scannedAt: z.string().nullable(),
})
export type Source = z.infer<typeof Source>

export const AssetKind = z.enum(['video', 'audio', 'image'])
export type AssetKind = z.infer<typeof AssetKind>

export const AssetRole = z.enum([
  'footage',
  'music',
  'sfx',
  'brand',
  'voice',
  'reference',
  'motion',
  'render',
])
export type AssetRole = z.infer<typeof AssetRole>

export const AssetStatus = z.enum(['new', 'indexing', 'ready', 'error'])
export type AssetStatus = z.infer<typeof AssetStatus>

export const Asset = z.object({
  id: z.string(),
  sourceId: z.string().nullable(),
  projectId: z.string().nullable(),
  path: z.string(),
  name: z.string(),
  kind: AssetKind,
  role: AssetRole,
  size: z.number(),
  mtime: z.number(),
  duration: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  fps: z.number().nullable(),
  hasAudio: z.boolean(),
  status: AssetStatus,
  /** What the last indexing step said when it failed. */
  error: z.string().nullable(),
  tags: z.array(z.string()),
  /** Free text from the person or Claude: what is in it, mood, where it fits. */
  notes: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Asset = z.infer<typeof Asset>

export const Word = z.object({ start: z.number(), end: z.number(), text: z.string() })
export type Word = z.infer<typeof Word>

export const TranscriptSegment = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string(),
  words: z.array(Word),
})
export type TranscriptSegment = z.infer<typeof TranscriptSegment>

export const Transcript = z.object({
  language: z.string(),
  text: z.string(),
  segments: z.array(TranscriptSegment),
})
export type Transcript = z.infer<typeof Transcript>

/** A grid of frames in one image, for Claude to look at a stretch of video at once. */
export const ContactSheet = z.object({
  index: z.number(),
  start: z.number(),
  end: z.number(),
  cols: z.number(),
  rows: z.number(),
  /** Source time of each tile, left to right, top to bottom. */
  times: z.array(z.number()),
  file: z.string(),
})
export type ContactSheet = z.infer<typeof ContactSheet>

export const Moment = z.object({
  start: z.number(),
  end: z.number(),
  /** 0..1, higher is juicier. A heuristic, Claude decides. */
  score: z.number(),
  reasons: z.array(z.string()),
  text: z.string(),
})
export type Moment = z.infer<typeof Moment>

/**
 * What a music track is like, for cutting to it and for choosing it by mood. Fields after
 * `beats` came later and are missing in tracks analysed before.
 */
export const MusicAnalysis = z.object({
  bpm: z.number(),
  beats: z.array(z.number()),
  /** Estimated key, e.g. "A minor". */
  key: z.string().optional(),
  /** Mean spectral centroid, Hz: low = dark and warm, high = bright. */
  brightness: z.number().optional(),
  /** Note onsets per second: how busy it is. */
  density: z.number().optional(),
  /** Energy per second, 0..1 of the track's loudest second: where it builds and drops. */
  curve: z.array(z.number()).optional(),
})
export type MusicAnalysis = z.infer<typeof MusicAnalysis>

/** Everything indexing learned about an asset; kept as a JSON file next to its previews. */
export const Analysis = z.object({
  version: z.number(),
  transcript: Transcript.nullable(),
  scenes: z.array(z.object({ start: z.number(), end: z.number() })),
  /** Short-term loudness, one value per second (LUFS). */
  loudness: z.array(z.number()),
  /** Amount of picture change per second, 0..1. */
  motion: z.array(z.number()),
  sheets: z.array(ContactSheet),
  moments: z.array(Moment),
  music: MusicAnalysis.nullable(),
})
export type Analysis = z.infer<typeof Analysis>

export const Platform = z.enum(['youtube', 'instagram', 'tiktok', 'x', 'other'])
export type Platform = z.infer<typeof Platform>

export const Reference = z.object({
  id: z.string(),
  url: z.string(),
  platform: Platform,
  title: z.string(),
  author: z.string(),
  /** The downloaded video, indexed like any asset. */
  assetId: z.string().nullable(),
  status: z.enum(['new', 'downloading', 'indexing', 'ready', 'error']),
  error: z.string().nullable(),
  /** The breakdown (Markdown), written by Claude through MCP or by hand. */
  analysis: z.string(),
  tags: z.array(z.string()),
  projectIds: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Reference = z.infer<typeof Reference>

export const MotionEngine = z.enum(['remotion', 'hyperframes'])
export type MotionEngine = z.infer<typeof MotionEngine>

/** Real-ESRGAN models: video-made anime/game one, or the general one for camera footage. */
export const UpscaleModel = z.enum(['animevideo', 'general'])
export type UpscaleModel = z.infer<typeof UpscaleModel>

export const VoiceProviderId = z.enum(['fish-api', 'fish-local', 'kokoro', 'chatterbox'])
export type VoiceProviderId = z.infer<typeof VoiceProviderId>

/** One part of a format: the hook, a reveal, the call to action. */
export const FormatBeat = z.object({
  name: z.string(),
  /** Seconds this part usually takes. */
  duration: z.number(),
  purpose: z.string().default(''),
  visual: z.string().default(''),
  text: z.string().default(''),
  audio: z.string().default(''),
  motion: z.string().default(''),
})
export type FormatBeat = z.infer<typeof FormatBeat>

/** The repeatable mechanics of a video, so new ones can be made the same way. */
export const FormatRecipe = z.object({
  aspect: Aspect.default('9:16'),
  duration: z.object({ min: z.number(), max: z.number() }).default({ min: 15, max: 30 }),
  beats: z.array(FormatBeat).default([]),
  pacing: z
    .object({
      /** Average shot length, seconds. */
      shot: z.number().default(1.5),
      cutOnBeat: z.boolean().default(false),
    })
    .default({ shot: 1.5, cutOnBeat: false }),
  captions: z
    .object({
      style: z.string().default('bold-pop'),
      position: z.number().default(0.72),
      uppercase: z.boolean().default(false),
      maxWords: z.number().default(3),
    })
    .default({ style: 'bold-pop', position: 0.72, uppercase: false, maxWords: 3 }),
  music: z
    .object({
      mood: z.string().default(''),
      bpm: z.number().nullable().default(null),
      /** A trending sound to add in the app when posting, never baked into the render. */
      trendingSound: z.string().default(''),
    })
    .default({ mood: '', bpm: null, trendingSound: '' }),
  voice: z
    .object({
      provider: VoiceProviderId.nullable().default(null),
      voiceId: z.string().nullable().default(null),
      style: z.string().default(''),
      language: z.string().default('ru'),
    })
    .default({ provider: null, voiceId: null, style: '', language: 'ru' }),
  motionEngine: MotionEngine.nullable().default(null),
  hooks: z.array(z.string()).default([]),
  variables: z.array(z.object({ name: z.string(), description: z.string() })).default([]),
  notes: z.string().default(''),
})
export type FormatRecipe = z.infer<typeof FormatRecipe>

export const Format = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  name: z.string().min(1),
  description: z.string(),
  recipe: FormatRecipe,
  referenceIds: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Format = z.infer<typeof Format>

export const Voice = z.object({
  id: z.string(),
  name: z.string(),
  provider: VoiceProviderId,
  /** The provider's handle: a Fish model id, a local reference id, a built-in voice name. */
  ref: z.string(),
  /** Reference recording kept in the library (for providers that clone per request). */
  sample: z.string().nullable(),
  sampleText: z.string(),
  language: z.string(),
  createdAt: z.string(),
})
export type Voice = z.infer<typeof Voice>

export const JobStatus = z.enum(['queued', 'running', 'done', 'error'])
export type JobStatus = z.infer<typeof JobStatus>

export const Job = z.object({
  id: z.string(),
  kind: z.string(),
  status: JobStatus,
  progress: z.number(),
  message: z.string(),
  /** What the job is about: an asset, a reference, a composition. */
  target: z.string().nullable(),
  result: z.unknown().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Job = z.infer<typeof Job>
