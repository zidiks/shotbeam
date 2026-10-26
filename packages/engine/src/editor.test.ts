import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Composition } from '@shotbeam/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Engine } from './engine'
import { Library } from './paths'
import { createApp } from './server'

describe('editor history and duplication', () => {
  let engine: Engine
  let root: string
  let composition: Composition
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'shotbeam-editor-'))
    engine = new Engine(new Library(root))
    const project = engine.store.createProject({ name: 'Test project' })
    composition = engine.compositions.create({ projectId: project.id, name: 'Original' })
  })
  afterEach(() => {
    engine.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('undoes and redoes edits as new versions, then clears redo on a new edit', () => {
    const id = composition.id
    engine.compositions.apply(id, [
      { op: 'add', item: { type: 'text', text: 'First', duration: 2, style: {} } },
    ])
    const edited = engine.store.getComposition(id)
    const undone = engine.store.stepHistory(id, 'undo')
    expect(undone.tracks.flatMap((t) => t.items)).toHaveLength(0)
    expect(undone.version).toBeGreaterThan(edited.version)
    const redone = engine.store.stepHistory(id, 'redo')
    expect(redone.tracks).toEqual(edited.tracks)
    expect(redone.version).toBeGreaterThan(undone.version)
    engine.store.stepHistory(id, 'undo')
    engine.compositions.apply(id, [
      { op: 'add', item: { type: 'text', text: 'Different', duration: 1, style: {} } },
    ])
    expect(engine.store.history(id)).toEqual({ undo: 1, redo: 0 })
    expect(() => engine.store.stepHistory(id, 'redo')).toThrow('Nothing to redo')
  })

  it('rejects a stale edit without changing the document or its history', () => {
    engine.compositions.apply(composition.id, [
      { op: 'add', item: { type: 'text', text: 'First', duration: 2, style: {} } },
    ])
    const before = engine.store.getComposition(composition.id)
    expect(() =>
      engine.compositions.apply(
        composition.id,
        [{ op: 'removeTrack', trackId: before.tracks[0]?.id ?? 'missing' }],
        composition.version,
      ),
    ).toThrow()
    expect(engine.store.getComposition(composition.id)).toEqual(before)
    expect(engine.store.history(composition.id)).toEqual({ undo: 1, redo: 0 })
  })

  it('duplicates a video through the API with independent edits and history', async () => {
    engine.compositions.apply(composition.id, [
      { op: 'add', item: { type: 'text', text: 'Original text', duration: 2, style: {} } },
    ])
    const original = engine.store.getComposition(composition.id)
    const response = await createApp(engine).request(
      `/api/compositions/${composition.id}/duplicate`,
      { method: 'POST' },
    )
    expect(response.status).toBe(201)
    const copy = (await response.json()) as Composition
    expect(copy.id).not.toBe(original.id)
    expect(copy.name).toBe('Original (копия)')
    expect(copy.tracks).toEqual(original.tracks)
    expect(copy.version).toBe(1)
    expect(engine.store.history(copy.id)).toEqual({ undo: 0, redo: 0 })
    const item = copy.tracks.flatMap((t) => t.items)[0]
    if (!item) throw new Error('Expected a copied item')
    engine.compositions.apply(copy.id, [
      { op: 'update', id: item.id, patch: { text: 'Edited copy' } },
    ])
    expect(engine.store.getComposition(original.id)).toEqual(original)
    engine.store.stepHistory(copy.id, 'undo')
    expect(engine.store.getComposition(copy.id).tracks).toEqual(original.tracks)
  })
})
