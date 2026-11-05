import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { type Asset, itemEnd, newId, nowIso } from '@shotbeam/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Engine } from './engine'
import { Library } from './paths'

describe('cutting to the beat', () => {
  let engine: Engine
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'shotbeam-beats-'))
    engine = new Engine(new Library(root))
  })
  afterEach(() => {
    engine.close()
    rmSync(root, { recursive: true, force: true })
  })

  const asset = (role: Asset['role'], duration: number): Asset =>
    engine.store.saveAsset({
      id: newId(),
      sourceId: null,
      projectId: null,
      path: join(root, `${role}.mp4`),
      name: role,
      kind: role === 'music' ? 'audio' : 'video',
      role,
      size: 1,
      mtime: 0,
      duration,
      width: null,
      height: null,
      fps: null,
      hasAudio: true,
      status: 'ready',
      error: null,
      tags: [],
      notes: '',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    })

  it('takes the beats from the music on the timeline and reports them', () => {
    const project = engine.store.createProject({ name: 'Beats' })
    const format = engine.store.createFormat({
      projectId: project.id,
      name: 'On the beat',
      recipe: { pacing: { shot: 1, cutOnBeat: true } },
    })
    const c = engine.compositions.create({
      projectId: project.id,
      name: 'Cut',
      formatId: format.id,
    })
    const music = asset('music', 30)
    const footage = asset('footage', 60)
    const file = engine.indexer.file(music.id, 'analysis.json')
    mkdirSync(dirname(file), { recursive: true })
    const beats = Array.from({ length: 60 }, (_, i) => 0.25 + i * 0.5)
    writeFileSync(file, JSON.stringify({ music: { bpm: 120, beats } }))

    const placed = engine.compositions.apply(c.id, [
      { op: 'add', item: { type: 'clip', assetId: footage.id, in: 0, out: 1.4 } },
      { op: 'add', item: { type: 'clip', assetId: footage.id, in: 10, out: 11.1 } },
      // No track given: music goes to A2, from the start of the source.
      { op: 'add', item: { type: 'audio', assetId: music.id, start: 0 } },
    ]).composition
    const v1 = placed.tracks[1]?.id as string
    const cut = engine.compositions.apply(c.id, [{ op: 'cutToBeats', trackId: v1 }]).composition
    expect(cut.tracks[1]?.items.map((i) => itemEnd(i))).toEqual([
      expect.closeTo(1.25, 6),
      expect.closeTo(2.25, 6),
    ])

    const info = engine.compositions.beats(c.id)
    expect(info.cutOnBeat).toBe(true)
    expect(info.music).toEqual([
      { itemId: expect.any(String), assetId: music.id, track: 'A2', bpm: 120 },
    ])
    expect(info.beats[0]).toBeCloseTo(0.25)
  })
})
