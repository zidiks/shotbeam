import {
  type CaptionsItem,
  type Composition,
  Item,
  TRACK_ITEMS,
  type Track,
  type TrackKind,
} from './composition'
import { newId } from './ids'
import type { Word } from './model'

/*
 * Pure edits of a composition. Each returns a new composition (inputs are never changed) and
 * leaves `version` alone: the store bumps it when it saves.
 */

/** Where an item ends on the timeline. */
export function itemEnd(item: Item): number {
  switch (item.type) {
    case 'clip':
      return item.start + (item.out - item.in) / item.speed
    case 'audio':
      return item.start + (item.out - item.in)
    default:
      return item.start + item.duration
  }
}

export function itemDuration(item: Item): number {
  return itemEnd(item) - item.start
}

/** Length of the video: the end of the last visible item. */
export function compositionDuration(c: Composition): number {
  let end = 0
  for (const t of c.tracks) {
    if (t.hidden) continue
    for (const i of t.items) end = Math.max(end, itemEnd(i))
  }
  return end
}

export function trackEnd(track: Track): number {
  return track.items.reduce((end, i) => Math.max(end, itemEnd(i)), 0)
}

export function findItem(c: Composition, id: string) {
  for (const track of c.tracks) {
    const index = track.items.findIndex((i) => i.id === id)
    if (index >= 0) return { track, item: track.items[index] as Item, index }
  }
  return null
}

function requireItem(c: Composition, id: string) {
  const found = findItem(c, id)
  if (!found) throw new Error(`No item ${id} in this composition`)
  return found
}

export function trackKindFor(type: Item['type']): TrackKind {
  for (const [kind, types] of Object.entries(TRACK_ITEMS)) {
    if (types.includes(type)) return kind as TrackKind
  }
  throw new Error(`Unknown item type ${type}`)
}

/**
 * Tracks of a kind from the main one outward: visual from the bottom (V1, V2…), audio from the
 * top (A1, A2…). `level` counts in this order.
 */
export function tracksByLevel(c: Composition, kind: TrackKind): Track[] {
  const tracks = c.tracks.filter((t) => t.kind === kind)
  return kind === 'visual' ? tracks.reverse() : tracks
}

/** A new empty track: visual ones go on top, audio ones at the bottom. */
export function addTrack(c: Composition, kind: TrackKind, name = ''): [Composition, Track] {
  const track: Track = { id: newId(), kind, name, muted: false, hidden: false, items: [] }
  return [{ ...c, tracks: kind === 'visual' ? [track, ...c.tracks] : [...c.tracks, track] }, track]
}

function sortItems(items: Item[]): Item[] {
  return [...items].sort((a, b) => a.start - b.start)
}

function replaceTrack(c: Composition, track: Track): Composition {
  return {
    ...c,
    tracks: c.tracks.map((t) =>
      t.id === track.id ? { ...track, items: sortItems(track.items) } : t,
    ),
  }
}

/** Whether [start, end) on a track is free of other items. */
export function isFree(track: Track, start: number, end: number, exceptId?: string): boolean {
  return !track.items.some(
    (i) => i.id !== exceptId && start < itemEnd(i) - 1e-6 && end > i.start + 1e-6,
  )
}

export type NewItem = Omit<Item, 'id' | 'start'> & { id?: string; start?: number }

/** Where an item type goes by default: clips and audio on the main track, overlays above it. */
function defaultLevel(type: Item['type']) {
  return type === 'text' || type === 'captions' || type === 'motion' ? 1 : 0
}

/**
 * Adds an item. With `trackId` it goes there (after the last item when no `start`).
 * Otherwise it goes on the track at `level` (default: main track for clips and audio, the one
 * above for text, captions and motion) or the next one outward where it does not overlap
 * anything; tracks are added as needed.
 */
export function addItem(
  c: Composition,
  input: NewItem,
  opts: { trackId?: string; level?: number } = {},
): [Composition, Item] {
  const kind = trackKindFor(input.type)
  let next = c
  if (opts.trackId) {
    const track = c.tracks.find((t) => t.id === opts.trackId)
    if (!track) throw new Error(`No track ${opts.trackId}`)
    if (!TRACK_ITEMS[track.kind].includes(input.type)) {
      throw new Error(`A ${track.kind} track cannot hold ${input.type} items`)
    }
    const item = Item.parse({
      ...input,
      id: input.id ?? newId(),
      start: input.start ?? trackEnd(track),
    })
    return [replaceTrack(next, { ...track, items: [...track.items, item] }), item]
  }
  const level = Math.max(0, opts.level ?? defaultLevel(input.type))
  while (tracksByLevel(next, kind).length <= level) [next] = addTrack(next, kind)
  const levels = tracksByLevel(next, kind)
  if (input.start === undefined) {
    const track = levels[level] as Track
    const item = Item.parse({ ...input, id: input.id ?? newId(), start: trackEnd(track) })
    return [replaceTrack(next, { ...track, items: [...track.items, item] }), item]
  }
  const item = Item.parse({ ...input, id: input.id ?? newId() })
  const end = itemEnd(item)
  let track = levels.slice(level).find((t) => isFree(t, item.start, end))
  if (!track) [next, track] = addTrack(next, kind)
  return [replaceTrack(next, { ...track, items: [...track.items, item] }), item]
}

/** Changes fields of an item; the result is validated, so a bad patch throws. */
export function updateItem(
  c: Composition,
  id: string,
  patch: Record<string, unknown>,
): Composition {
  const { track, item } = requireItem(c, id)
  const { id: _id, type: _type, ...rest } = patch
  // A motion item whose look changed needs a new render.
  if (
    item.type === 'motion' &&
    !('renderedAssetId' in rest) &&
    ['props', 'template', 'engine', 'duration', 'overlay'].some((k) => k in rest)
  ) {
    rest.renderedAssetId = null
  }
  const updated = Item.parse({ ...item, ...rest })
  return replaceTrack(c, { ...track, items: track.items.map((i) => (i.id === id ? updated : i)) })
}

/** Removes an item; with `ripple`, later items on its track move left to close the gap. */
export function removeItem(
  c: Composition,
  id: string,
  opts: { ripple?: boolean } = {},
): Composition {
  const { track, item } = requireItem(c, id)
  const gap = itemDuration(item)
  const items = track.items
    .filter((i) => i.id !== id)
    .map((i) =>
      opts.ripple && i.start >= itemEnd(item) - 1e-6
        ? { ...i, start: Math.max(0, i.start - gap) }
        : i,
    )
  return replaceTrack(c, { ...track, items })
}

/** Moves an item in time and, when given, to another track that can hold it. */
export function moveItem(
  c: Composition,
  id: string,
  to: { start?: number; trackId?: string },
): Composition {
  const { track, item } = requireItem(c, id)
  const moved = { ...item, start: Math.max(0, to.start ?? item.start) } as Item
  if (!to.trackId || to.trackId === track.id) {
    return replaceTrack(c, { ...track, items: track.items.map((i) => (i.id === id ? moved : i)) })
  }
  const target = c.tracks.find((t) => t.id === to.trackId)
  if (!target) throw new Error(`No track ${to.trackId}`)
  if (!TRACK_ITEMS[target.kind].includes(item.type)) {
    throw new Error(`A ${target.kind} track cannot hold ${item.type} items`)
  }
  const without = replaceTrack(c, { ...track, items: track.items.filter((i) => i.id !== id) })
  const fresh = without.tracks.find((t) => t.id === target.id) as Track
  return replaceTrack(without, { ...fresh, items: [...fresh.items, moved] })
}

/** Cuts an item in two at timeline time `at`; returns the id of the second half. */
export function splitItem(c: Composition, id: string, at: number): [Composition, string] {
  const { track, item } = requireItem(c, id)
  if (at <= item.start + 1e-3 || at >= itemEnd(item) - 1e-3) {
    throw new Error('Split point must be inside the item')
  }
  const offset = at - item.start
  const secondId = newId()
  let first: Item
  let second: Item
  switch (item.type) {
    case 'clip': {
      const cut = item.in + offset * item.speed
      first = { ...item, out: cut, fadeOut: 0 }
      second = { ...item, id: secondId, start: at, in: cut, fadeIn: 0 }
      break
    }
    case 'audio': {
      const cut = item.in + offset
      first = { ...item, out: cut, fadeOut: 0 }
      second = { ...item, id: secondId, start: at, in: cut, fadeIn: 0 }
      break
    }
    case 'captions': {
      first = { ...item, duration: offset, words: item.words.filter((w) => w.start < at) }
      second = {
        ...item,
        id: secondId,
        start: at,
        duration: item.duration - offset,
        words: item.words.filter((w) => w.start >= at),
      }
      break
    }
    default: {
      first = { ...item, duration: offset } as Item
      second = { ...item, id: secondId, start: at, duration: item.duration - offset } as Item
    }
  }
  const items = track.items.flatMap((i) => (i.id === id ? [first, second] : [i]))
  return [replaceTrack(c, { ...track, items }), secondId]
}

/** Moves every item on a track left so they play back to back from `from`. */
export function closeGaps(c: Composition, trackId: string, from = 0): Composition {
  const track = c.tracks.find((t) => t.id === trackId)
  if (!track) throw new Error(`No track ${trackId}`)
  let at = from
  const items = sortItems(track.items).map((i) => {
    const placed = { ...i, start: at } as Item
    at += itemDuration(i)
    return placed
  })
  return replaceTrack(c, { ...track, items })
}

/** Moves an item to another place in the order of its track and closes the gaps. */
export function reorderItem(c: Composition, id: string, index: number): Composition {
  const { track } = requireItem(c, id)
  const items = sortItems(track.items)
  const from = items.findIndex((i) => i.id === id)
  const [item] = items.splice(from, 1)
  items.splice(Math.max(0, Math.min(index, items.length)), 0, item as Item)
  const first = items[0]?.start ?? 0
  let at = Math.min(first, (item as Item).start)
  const placed = items.map((i) => {
    const p = { ...i, start: at } as Item
    at += itemDuration(i)
    return p
  })
  return replaceTrack(c, { ...track, items: placed })
}

/**
 * Captions for what the clips on video tracks say: each clip's words (from its asset's
 * transcript) moved to timeline time. `words` maps an asset id to its transcript words.
 */
export function captionWords(c: Composition, words: Map<string, Word[]>): Word[] {
  const out: Word[] = []
  for (const track of c.tracks) {
    if (track.kind !== 'visual' || track.hidden || track.muted) continue
    for (const item of track.items) {
      if (item.type !== 'clip') continue
      for (const w of words.get(item.assetId) ?? []) {
        if (w.end <= item.in || w.start >= item.out) continue
        const s = Math.max(w.start, item.in)
        const e = Math.min(w.end, item.out)
        out.push({
          start: item.start + (s - item.in) / item.speed,
          end: item.start + (e - item.in) / item.speed,
          text: w.text.trim(),
        })
      }
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

/** Words moved by `offset` (a voiceover placed at `offset` on the timeline). */
export function shiftWords(words: Word[], offset: number): Word[] {
  return words.map((w) => ({ start: w.start + offset, end: w.end + offset, text: w.text.trim() }))
}

/**
 * Splits words into the groups shown on screen together: at most `maxWords`, and a new group
 * after a pause or the end of a sentence.
 */
export function captionGroups(words: CaptionsItem['words'], maxWords: number) {
  const groups: { start: number; end: number; words: CaptionsItem['words'] }[] = []
  let current: CaptionsItem['words'] = []
  const flush = () => {
    if (!current.length) return
    groups.push({
      start: (current[0] as Word).start,
      end: (current[current.length - 1] as Word).end,
      words: current,
    })
    current = []
  }
  for (const w of words) {
    const prev = current[current.length - 1]
    if (prev && (w.start - prev.end > 0.45 || /[.!?…]$/.test(prev.text))) flush()
    current.push(w)
    if (current.length >= maxWords) flush()
  }
  flush()
  return groups
}
