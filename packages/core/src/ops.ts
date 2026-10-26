import { z } from 'zod'
import { type Composition, TrackKind } from './composition'
import {
  addItem,
  addTrack,
  closeGaps,
  moveItem,
  type NewItem,
  removeItem,
  reorderItem,
  splitItem,
  updateItem,
} from './timeline'

/*
 * Edits of a composition as data, so the editor and MCP clients send the same thing and a batch
 * applies all or nothing.
 */

export const CompositionOp = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add'),
    item: z.record(z.string(), z.unknown()),
    trackId: z.string().optional(),
    /** Without trackId: 0 = main track (V1 / A1), 1 = the next one (V2 / A2)… */
    level: z.number().int().min(0).optional(),
  }),
  z.object({ op: z.literal('update'), id: z.string(), patch: z.record(z.string(), z.unknown()) }),
  z.object({ op: z.literal('remove'), id: z.string(), ripple: z.boolean().optional() }),
  z.object({
    op: z.literal('move'),
    id: z.string(),
    start: z.number().optional(),
    trackId: z.string().optional(),
  }),
  z.object({ op: z.literal('split'), id: z.string(), at: z.number() }),
  z.object({ op: z.literal('reorder'), id: z.string(), index: z.number().int() }),
  z.object({ op: z.literal('closeGaps'), trackId: z.string() }),
  z.object({ op: z.literal('addTrack'), kind: TrackKind, name: z.string().optional() }),
  z.object({ op: z.literal('removeTrack'), trackId: z.string() }),
  z.object({
    op: z.literal('track'),
    trackId: z.string(),
    patch: z.object({
      name: z.string().optional(),
      muted: z.boolean().optional(),
      hidden: z.boolean().optional(),
    }),
  }),
  z.object({
    op: z.literal('set'),
    patch: z.object({
      name: z.string().optional(),
      background: z.string().optional(),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      fps: z.number().positive().optional(),
    }),
  }),
])
export type CompositionOp = z.infer<typeof CompositionOp>

export type OpResult = { composition: Composition; created: string[] }

/** Applies edits in order; throws on the first one that does not fit (nothing is applied then). */
export function applyOps(c: Composition, ops: CompositionOp[]): OpResult {
  let next = c
  const created: string[] = []
  for (const op of ops) {
    switch (op.op) {
      case 'add': {
        const [n, item] = addItem(next, op.item as unknown as NewItem, {
          trackId: op.trackId,
          level: op.level,
        })
        next = n
        created.push(item.id)
        break
      }
      case 'update':
        next = updateItem(next, op.id, op.patch)
        break
      case 'remove':
        next = removeItem(next, op.id, { ripple: op.ripple })
        break
      case 'move':
        next = moveItem(next, op.id, { start: op.start, trackId: op.trackId })
        break
      case 'split': {
        const [n, id] = splitItem(next, op.id, op.at)
        next = n
        created.push(id)
        break
      }
      case 'reorder':
        next = reorderItem(next, op.id, op.index)
        break
      case 'closeGaps':
        next = closeGaps(next, op.trackId)
        break
      case 'addTrack': {
        const [n, track] = addTrack(next, op.kind, op.name)
        next = n
        created.push(track.id)
        break
      }
      case 'removeTrack':
        if (!next.tracks.some((t) => t.id === op.trackId)) throw new Error(`No track ${op.trackId}`)
        next = { ...next, tracks: next.tracks.filter((t) => t.id !== op.trackId) }
        break
      case 'track':
        if (!next.tracks.some((t) => t.id === op.trackId)) throw new Error(`No track ${op.trackId}`)
        next = {
          ...next,
          tracks: next.tracks.map((t) => (t.id === op.trackId ? { ...t, ...op.patch } : t)),
        }
        break
      case 'set':
        next = { ...next, ...op.patch }
        break
    }
  }
  return { composition: next, created }
}
