import { describe, expect, it } from 'vitest'
import { Composition, trackLabel } from './composition'
import { applyOps } from './ops'
import { captionGroups, captionWords, compositionDuration, findItem } from './timeline'

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

describe('timeline ops', () => {
  it('appends clips back to back and creates the track', () => {
    const { composition, created } = applyOps(empty(), [
      { op: 'add', item: { type: 'clip', assetId: 'a', in: 2, out: 5 } },
      { op: 'add', item: { type: 'clip', assetId: 'b', in: 0, out: 1.5 } },
    ])
    expect(composition.tracks).toHaveLength(1)
    expect(composition.tracks[0]?.kind).toBe('visual')
    expect(findItem(composition, created[1] as string)?.item.start).toBe(3)
    expect(compositionDuration(composition)).toBe(4.5)
  })

  it('splits a clip and keeps source times', () => {
    let { composition, created } = applyOps(empty(), [
      { op: 'add', item: { type: 'clip', assetId: 'a', in: 10, out: 14 } },
    ])
    ;({ composition, created } = applyOps(composition, [
      { op: 'split', id: created[0] as string, at: 1 },
    ]))
    const second = findItem(composition, created[0] as string)?.item
    expect(second).toMatchObject({ type: 'clip', start: 1, in: 11, out: 14 })
  })

  it('removes with ripple', () => {
    const { composition, created } = applyOps(empty(), [
      { op: 'add', item: { type: 'clip', assetId: 'a', in: 0, out: 2 } },
      { op: 'add', item: { type: 'clip', assetId: 'b', in: 0, out: 2 } },
    ])
    const next = applyOps(composition, [{ op: 'remove', id: created[0] as string, ripple: true }])
    expect(findItem(next.composition, created[1] as string)?.item.start).toBe(0)
  })

  it('rejects a bad patch without changing anything', () => {
    const { composition, created } = applyOps(empty(), [
      { op: 'add', item: { type: 'clip', assetId: 'a', in: 0, out: 2 } },
    ])
    expect(() =>
      applyOps(composition, [{ op: 'update', id: created[0] as string, patch: { speed: -1 } }]),
    ).toThrow()
  })

  it('keeps visual tracks above audio ones and numbers them like an editor', () => {
    let c = empty()
    ;({ composition: c } = applyOps(c, [
      { op: 'addTrack', kind: 'audio' },
      { op: 'addTrack', kind: 'visual' },
      { op: 'addTrack', kind: 'visual' },
      { op: 'addTrack', kind: 'audio' },
    ]))
    expect(c.tracks.map((t) => t.kind)).toEqual(['visual', 'visual', 'audio', 'audio'])
    expect(c.tracks.map((t) => trackLabel(c, t.id))).toEqual(['V2', 'V1', 'A1', 'A2'])
  })

  it('puts overlays above the main track and never stacks items unasked', () => {
    const { composition: c, created } = applyOps(empty(), [
      { op: 'add', item: { type: 'clip', assetId: 'a', in: 0, out: 4 } },
      { op: 'add', item: { type: 'text', start: 1, duration: 2, text: 'Hi', style: {} } },
      { op: 'add', item: { type: 'text', start: 2, duration: 2, text: 'Again', style: {} } },
      { op: 'add', item: { type: 'audio', assetId: 'm', in: 0, out: 4, start: 0 }, level: 1 },
    ])
    const label = (id: string) => trackLabel(c, findItem(c, id)?.track.id as string)
    expect(created.map(label)).toEqual(['V1', 'V2', 'V3', 'A2'])
  })

  it('reads first-version documents (typed tracks in paint order)', () => {
    const legacy = {
      ...empty(),
      tracks: [
        { id: 'v', kind: 'video', name: 'Video', items: [] },
        { id: 'a', kind: 'audio', name: 'Voice', items: [] },
        { id: 't', kind: 'text', name: 'Text', items: [] },
      ],
    }
    const c = Composition.parse(legacy)
    expect(c.tracks.map((t) => `${t.id}:${t.kind}`)).toEqual(['t:visual', 'v:visual', 'a:audio'])
  })

  it('moves transcript words to timeline time and groups them', () => {
    const { composition } = applyOps(empty(), [
      { op: 'add', item: { type: 'clip', assetId: 'a', in: 10, out: 12, start: 1 } },
    ])
    const words = captionWords(
      composition,
      new Map([
        [
          'a',
          [
            { start: 9.5, end: 9.9, text: 'skip' },
            { start: 10.2, end: 10.5, text: 'Hello' },
            { start: 10.6, end: 11, text: 'world.' },
            { start: 11.1, end: 11.4, text: 'Again' },
          ],
        ],
      ]),
    )
    expect(words.map((w) => w.text)).toEqual(['Hello', 'world.', 'Again'])
    expect(words[0]?.start).toBeCloseTo(1.2)
    expect(captionGroups(words, 3).map((g) => g.words.length)).toEqual([2, 1])
  })
})
