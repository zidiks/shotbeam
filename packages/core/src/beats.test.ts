import { describe, expect, it } from 'vitest'
import { timelineBeats } from './beats'
import type { Composition } from './composition'
import { applyOps } from './ops'
import { findItem, itemEnd } from './timeline'

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

/** 120 BPM: a beat every half second from 0.1 s. */
const grid = Array.from({ length: 60 }, (_, i) => 0.1 + i * 0.5)

describe('beats', () => {
  it('moves the beats of a music item to timeline time and skips muted tracks', () => {
    const { composition, created } = applyOps(empty(), [
      { op: 'add', item: { type: 'audio', assetId: 'm', in: 2, out: 4, start: 1 } },
    ])
    const beats = timelineBeats(composition, (id) => (id === 'm' ? grid : null))
    expect(beats[0]).toBeCloseTo(1.1)
    expect(beats.at(-1)).toBeCloseTo(2.6)
    expect(beats).toHaveLength(4)
    const track = findItem(composition, created[0] as string)?.track.id as string
    const muted = applyOps(composition, [{ op: 'track', trackId: track, patch: { muted: true } }])
    expect(timelineBeats(muted.composition, () => grid)).toEqual([])
  })

  it('puts every cut on a beat, keeping the pacing', () => {
    const { composition } = applyOps(empty(), [
      { op: 'add', item: { type: 'clip', assetId: 'a', in: 0, out: 1.3 } },
      { op: 'add', item: { type: 'clip', assetId: 'b', in: 5, out: 6.9 } },
      { op: 'add', item: { type: 'text', text: 'Hi', duration: 0.8, style: {} }, level: 0 },
    ])
    const track = composition.tracks[0]?.id as string
    const { composition: cut } = applyOps(composition, [
      { op: 'cutToBeats', trackId: track, beats: grid },
    ])
    const items = cut.tracks[0]?.items ?? []
    expect(items.map((i) => itemEnd(i))).toEqual([1.1, 3.1, 4.1].map((v) => expect.closeTo(v, 6)))
    // Back to back, from the first shot's own start.
    expect(items.map((i) => i.start)).toEqual([0, 1.1, 3.1].map((v) => expect.closeTo(v, 6)))
    const b = items[1]
    expect(b?.type === 'clip' && b.in).toBe(5)
  })

  it('cuts every bar, never stretching a clip past its source', () => {
    const { composition } = applyOps(empty(), [
      { op: 'add', item: { type: 'clip', assetId: 'a', in: 0, out: 1.5, start: 0.1 } },
      { op: 'add', item: { type: 'clip', assetId: 'short', in: 0, out: 2.2 } },
    ])
    const track = composition.tracks[0]?.id as string
    const { composition: cut } = applyOps(
      composition,
      [{ op: 'cutToBeats', trackId: track, every: 4 }],
      { beats: () => grid, sourceLength: (id) => (id === 'short' ? 2.5 : 100) },
    )
    const [first, second] = cut.tracks[0]?.items ?? []
    // Bars at 0.1, 2.1, 4.1…: the first shot ends on 2.1 (nearer to 1.6 than 0.1 is long).
    expect(itemEnd(first as never)).toBeCloseTo(2.1)
    // 2.1 + 2.2 = 4.3 is nearest to 4.1, which the 2.5 s source allows.
    expect(itemEnd(second as never)).toBeCloseTo(4.1)
  })

  it('refuses without beats or on an audio track', () => {
    const { composition } = applyOps(empty(), [
      { op: 'add', item: { type: 'clip', assetId: 'a', in: 0, out: 1 } },
      { op: 'add', item: { type: 'audio', assetId: 'm', in: 0, out: 1 } },
    ])
    const [visual, audio] = composition.tracks
    expect(() =>
      applyOps(composition, [{ op: 'cutToBeats', trackId: visual?.id as string }]),
    ).toThrow('No beats')
    expect(() =>
      applyOps(composition, [{ op: 'cutToBeats', trackId: audio?.id as string, beats: grid }]),
    ).toThrow('visual track')
  })
})
