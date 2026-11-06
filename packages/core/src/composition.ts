import { z } from 'zod'
import { MotionEngine } from './model'

/*
 * A composition is the edit of one video: tracks of items on a timeline. It is one JSON document
 * that the editor and the MCP tools both change; rendering reads only this.
 * Tracks are in display order (see migrateTracks): visual tracks top to bottom, then audio.
 * On one track items may overlap when the person asked for it; the later one draws on top.
 */

const Fade = z.object({ fadeIn: z.number().default(0), fadeOut: z.number().default(0) })

export const ClipItem = z.object({
  id: z.string(),
  type: z.literal('clip'),
  assetId: z.string(),
  /** Timeline time the clip starts at. */
  start: z.number().min(0),
  /** Source in and out points. */
  in: z.number().min(0),
  out: z.number().min(0),
  speed: z.number().positive().default(1),
  volume: z.number().min(0).default(1),
  /** cover: fill the frame and crop; contain: fit inside with bars. */
  fit: z.enum(['cover', 'contain']).default('cover'),
  /** Crop centre for `cover`, 0..1 in the source frame. */
  focus: z.object({ x: z.number(), y: z.number() }).default({ x: 0.5, y: 0.5 }),
  /** Extra zoom on top of the fit, 1 = none. */
  zoom: z.number().min(1).default(1),
  ...Fade.shape,
})
export type ClipItem = z.infer<typeof ClipItem>

export const AudioItem = z.object({
  id: z.string(),
  type: z.literal('audio'),
  assetId: z.string(),
  start: z.number().min(0),
  in: z.number().min(0),
  out: z.number().min(0),
  volume: z.number().min(0).default(1),
  /** Lower this track while a voice track plays (music under a voiceover). */
  duck: z.boolean().default(false),
  ...Fade.shape,
})
export type AudioItem = z.infer<typeof AudioItem>

export const TextStyle = z.object({
  preset: z.string().default('title'),
  font: z.string().default('Inter'),
  size: z.number().default(72),
  weight: z.number().default(800),
  color: z.string().default('#ffffff'),
  /** A box behind the text, or null for none. */
  background: z.string().nullable().default(null),
  stroke: z.string().nullable().default('#000000'),
  /** Centre of the text block, 0..1 of the frame. */
  x: z.number().default(0.5),
  y: z.number().default(0.2),
  align: z.enum(['left', 'center', 'right']).default('center'),
  uppercase: z.boolean().default(false),
})
export type TextStyle = z.infer<typeof TextStyle>

export const TextItem = z.object({
  id: z.string(),
  type: z.literal('text'),
  start: z.number().min(0),
  duration: z.number().positive(),
  text: z.string(),
  style: TextStyle,
  ...Fade.shape,
})
export type TextItem = z.infer<typeof TextItem>

export const CaptionStyle = z.object({
  /** bold-pop: a few words, the spoken one highlighted; karaoke: a line filling in; minimal. */
  preset: z.enum(['bold-pop', 'karaoke', 'minimal']).default('bold-pop'),
  font: z.string().default('Inter'),
  size: z.number().default(92),
  color: z.string().default('#ffffff'),
  highlight: z.string().default('#ffd400'),
  stroke: z.string().default('#000000'),
  // Two lines end near 1290 px of 1920: above the caption, handle and buttons the apps draw.
  y: z.number().default(0.63),
  maxWords: z.number().int().positive().default(3),
  uppercase: z.boolean().default(false),
})
export type CaptionStyle = z.infer<typeof CaptionStyle>

export const CaptionsItem = z.object({
  id: z.string(),
  type: z.literal('captions'),
  start: z.number().min(0),
  duration: z.number().positive(),
  /** Word timings in timeline time. */
  words: z.array(z.object({ start: z.number(), end: z.number(), text: z.string() })),
  style: CaptionStyle,
})
export type CaptionsItem = z.infer<typeof CaptionsItem>

export const MotionItem = z.object({
  id: z.string(),
  type: z.literal('motion'),
  start: z.number().min(0),
  duration: z.number().positive(),
  engine: MotionEngine,
  /** Template id in that engine's library. */
  template: z.string(),
  props: z.record(z.string(), z.unknown()).default({}),
  /** Drawn over the tracks below (needs alpha) or covering the frame. */
  overlay: z.boolean().default(false),
  /** The last render of this item (an asset id), when props have not changed since. */
  renderedAssetId: z.string().nullable().default(null),
})
export type MotionItem = z.infer<typeof MotionItem>

export const Item = z.discriminatedUnion('type', [
  ClipItem,
  AudioItem,
  TextItem,
  CaptionsItem,
  MotionItem,
])
export type Item = z.infer<typeof Item>
export type ItemType = Item['type']

/**
 * Two kinds of tracks, like any editor: visual (clips, text, captions, motion) and audio.
 * The first version had video/text/motion tracks; those read as visual.
 */
export const TrackKind = z.enum(['visual', 'audio'])
export type TrackKind = z.infer<typeof TrackKind>

/** Which item types each kind of track holds. */
export const TRACK_ITEMS: Record<TrackKind, ItemType[]> = {
  visual: ['clip', 'text', 'captions', 'motion'],
  audio: ['audio'],
}

export const Track = z.object({
  id: z.string(),
  kind: z.preprocess((v) => (v === 'audio' ? 'audio' : v === 'visual' ? v : 'visual'), TrackKind),
  /** Optional own name; the editor shows V1…, A1… */
  name: z.string().default(''),
  /** Visual tracks: the clips' own sound; audio tracks: everything on it. */
  muted: z.boolean().default(false),
  hidden: z.boolean().default(false),
  items: z.array(Item),
})
export type Track = z.infer<typeof Track>

/**
 * Tracks are kept in display order: visual tracks first, the top one drawn on top of the others,
 * then audio tracks. Documents from the first version (paint order, typed tracks) are turned
 * into that.
 */
function migrateTracks(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const c = raw as { tracks?: { kind?: string; name?: string }[] }
  if (!Array.isArray(c.tracks)) return raw
  const legacy = c.tracks.some(
    (t) => t.kind === 'video' || t.kind === 'text' || t.kind === 'motion',
  )
  if (!legacy) return raw
  const visual = c.tracks.filter((t) => t.kind !== 'audio').reverse()
  const audio = c.tracks.filter((t) => t.kind === 'audio')
  return {
    ...c,
    tracks: [...visual, ...audio].map((t) => ({
      ...t,
      kind: t.kind === 'audio' ? 'audio' : 'visual',
      name: '',
    })),
  }
}

export const Composition = z.preprocess(
  migrateTracks,
  z.object({
    id: z.string(),
    projectId: z.string(),
    formatId: z.string().nullable(),
    name: z.string(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().positive(),
    background: z.string().default('#000000'),
    tracks: z.array(Track),
    /** Bumped on every change; a writer passes the version it read to avoid lost updates. */
    version: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
)
export type Composition = z.infer<typeof Composition>

/** "V2", "A1": visual tracks count up from the bottom one, audio tracks down from the top one. */
export function trackLabel(c: Composition, trackId: string): string {
  const visual = c.tracks.filter((t) => t.kind === 'visual')
  const audio = c.tracks.filter((t) => t.kind === 'audio')
  const v = visual.findIndex((t) => t.id === trackId)
  if (v >= 0) return `V${visual.length - v}`
  return `A${audio.findIndex((t) => t.id === trackId) + 1}`
}
