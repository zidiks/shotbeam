import type { Composition, Item, Track } from './composition'
import { itemDuration } from './timeline'

/*
 * Cutting to the music: the beats of the music under the edit in timeline time, and re-timing
 * the shots of a track so every cut lands on one.
 */

/**
 * Beat times on the timeline from the audio items whose files have beats (music), on audio
 * tracks that are not muted. `beatsOf` gives an asset's beat times in its own time.
 */
export function timelineBeats(
  c: Composition,
  beatsOf: (assetId: string) => number[] | null | undefined,
): number[] {
  const out: number[] = []
  for (const track of c.tracks) {
    if (track.kind !== 'audio' || track.muted) continue
    for (const item of track.items) {
      if (item.type !== 'audio') continue
      for (const b of beatsOf(item.assetId) ?? []) {
        if (b < item.in || b > item.out) continue
        out.push(item.start + (b - item.in))
      }
    }
  }
  out.sort((a, b) => a - b)
  // Two tracks on the same grid would give every beat twice.
  return out.filter((b, i) => i === 0 || b - (out[i - 1] as number) > 0.03)
}

/** Index of the beat nearest to `t`. */
function nearestIndex(beats: number[], t: number): number {
  let best = 0
  for (let i = 1; i < beats.length; i++) {
    if (Math.abs((beats[i] as number) - t) < Math.abs((beats[best] as number) - t)) best = i
  }
  return best
}

export interface CutToBeatsOptions {
  /** Cut on every beat (1), every other (2), every bar of 4/4 (4)… */
  every?: number
  /** Length of a clip's source file, so a shot is never stretched past its end. */
  sourceLength?: (assetId: string) => number | null | undefined
  /** Shortest shot, seconds. */
  minLength?: number
}

/**
 * Re-times the shots of a visual track so they play back to back with every cut on a beat: each
 * shot ends on the cut point nearest to where it ended before (so the pacing stays), shorter
 * when its source runs out. Counting `every` starts from the beat nearest to the first shot.
 * Captions keep their times (they follow the words); the first shot keeps its start.
 */
export function cutToBeats(
  c: Composition,
  trackId: string,
  beats: number[],
  opts: CutToBeatsOptions = {},
): Composition {
  const track = c.tracks.find((t) => t.id === trackId)
  if (!track) throw new Error(`No track ${trackId}`)
  if (track.kind !== 'visual') {
    throw new Error('Cut a visual track to the beat: the music on the audio tracks sets the beat')
  }
  if (!beats.length) {
    throw new Error('No beats to cut to: put music with analysed beats on an audio track')
  }
  const every = Math.max(1, Math.round(opts.every ?? 1))
  const minLength = opts.minLength ?? 0.25
  const grid = [...beats].sort((a, b) => a - b)
  const shots = track.items.filter((i) => i.type !== 'captions').sort((a, b) => a.start - b.start)
  const first = shots[0]
  if (!first) return c
  const anchor = nearestIndex(grid, first.start)
  const points = grid.filter((_, k) => k >= anchor && (k - anchor) % every === 0)

  let at = first.start
  const placed = new Map<string, Item>()
  for (const shot of shots) {
    const length = itemDuration(shot)
    let maxLength = Number.POSITIVE_INFINITY
    if (shot.type === 'clip') {
      const source = opts.sourceLength?.(shot.assetId)
      if (source) maxLength = Math.max(0, (source - shot.in) / shot.speed)
    }
    const want = at + length
    let end = at + Math.min(length, maxLength)
    let bestDist = Number.POSITIVE_INFINITY
    for (const p of points) {
      if (p < at + minLength || p - at > maxLength + 1e-6) continue
      const dist = Math.abs(p - want)
      if (dist < bestDist) {
        bestDist = dist
        end = p
      }
    }
    placed.set(shot.id, retime(shot, at, end - at))
    at = end
  }
  const items = track.items.map((i) => placed.get(i.id) ?? i)
  const next: Track = { ...track, items: items.sort((a, b) => a.start - b.start) }
  return { ...c, tracks: c.tracks.map((t) => (t.id === trackId ? next : t)) }
}

function retime(item: Item, start: number, length: number): Item {
  switch (item.type) {
    case 'clip':
      return { ...item, start, out: item.in + length * item.speed }
    case 'audio':
      return { ...item, start, out: item.in + length }
    default:
      return { ...item, start, duration: length } as Item
  }
}
