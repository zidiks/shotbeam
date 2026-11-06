import { describe, expect, it } from 'vitest'
import type { Composition } from './composition'
import type { AssetRole } from './model'
import { FormatRecipe } from './model'
import { applyOps, type CompositionOp } from './ops'
import { type ReviewInput, reviewComposition } from './review'

function empty(): Composition {
  return {
    id: 'c1',
    projectId: 'p1',
    formatId: null,
    name: 'Test',
    width: 1080,
    height: 1920,
    fps: 30,
    background: '#000000',
    tracks: [],
    version: 1,
    createdAt: '',
    updatedAt: '',
  }
}

const assets = new Map<string, { role: AssetRole; hasAudio: boolean }>([
  ['clip', { role: 'footage', hasAudio: true }],
  ['mute', { role: 'footage', hasAudio: false }],
  ['music', { role: 'music', hasAudio: true }],
  ['voice', { role: 'voice', hasAudio: true }],
])

function review(ops: CompositionOp[], extra: Partial<ReviewInput> = {}) {
  const { composition } = applyOps(empty(), ops)
  return reviewComposition({
    composition,
    assets,
    beats: [],
    format: null,
    speech: false,
    ...extra,
  })
}

const codes = (r: ReturnType<typeof review>) => r.notes.map((n) => n.code)

const clip = (start: number, length: number, assetId = 'clip'): CompositionOp => ({
  op: 'add',
  item: { type: 'clip', assetId, in: 0, out: length, start },
})

describe('review', () => {
  it('finds an empty first frame and a black gap', () => {
    const r = review([clip(0.5, 2), clip(3, 2)])
    expect(r.notes.find((n) => n.code === 'first-frame-empty')).toMatchObject({
      level: 'P0',
      at: 0,
    })
    expect(r.notes.find((n) => n.code === 'black-gap')).toMatchObject({ level: 'P0', at: 2.5 })
  })

  it('flags a stretch with nothing changing, ignoring captions', () => {
    const r = review([
      clip(0, 1.5),
      clip(1.5, 6),
      {
        op: 'add',
        item: {
          type: 'captions',
          start: 0,
          duration: 7.5,
          words: [{ start: 2, end: 2.4, text: 'hi' }],
          style: {},
        },
      },
    ])
    expect(r.notes.find((n) => n.code === 'dead-stretch')).toMatchObject({ level: 'P1', at: 1.5 })
  })

  it('checks words: reading time, size and the safe zone', () => {
    const r = review([
      clip(0, 4),
      {
        op: 'add',
        item: {
          type: 'text',
          start: 0,
          duration: 1,
          text: 'один два три четыре',
          style: { size: 20, y: 0.9 },
        },
      },
    ])
    expect(codes(r)).toEqual(
      expect.arrayContaining(['text-too-short', 'text-too-small', 'outside-safe-zone']),
    )
  })

  it('accepts captions at the default height', () => {
    const r = review([
      clip(0, 4),
      {
        op: 'add',
        item: {
          type: 'captions',
          start: 0.1,
          duration: 3,
          words: [{ start: 0.1, end: 0.5, text: 'hi' }],
          style: {},
        },
      },
    ])
    expect(codes(r)).not.toContain('outside-safe-zone')
    expect(codes(r)).not.toContain('first-frame-empty')
  })

  it('wants sound on a long video and captions for speech', () => {
    const silent = review([
      clip(0, 2, 'mute'),
      ...Array.from({ length: 8 }, (_, i) => clip(2 + i * 2, 2, 'mute')),
    ])
    expect(codes(silent)).toContain('silent')
    const spoken = review([clip(0, 3)], { speech: true })
    expect(codes(spoken)).toContain('no-captions')
  })

  it('wants cuts on the beat when the format asks for it', () => {
    const format = {
      id: 'f',
      name: 'f',
      description: '',
      projectId: null,
      referenceIds: [],
      createdAt: '',
      updatedAt: '',
      recipe: FormatRecipe.parse({ pacing: { shot: 1, cutOnBeat: true } }),
    }
    const off = review([clip(0, 1.3), clip(1.3, 1), clip(2.3, 1)], { beats: [0, 1, 2, 3], format })
    expect(codes(off)).toContain('cuts-off-beat')
    const on = review([clip(0, 1), clip(1, 1), clip(2, 1)], { beats: [0, 1, 2, 3], format })
    expect(codes(on)).not.toContain('cuts-off-beat')
  })

  it('reads the loudness of the last render and ranks P0 first', () => {
    const r = review([clip(0.5, 3)], { render: { loudness: -20, truePeak: -0.2 } })
    expect(codes(r)).toEqual(expect.arrayContaining(['loudness', 'true-peak']))
    expect(r.notes[0]?.level).toBe('P0')
  })
})
