import { rmSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import type { Library } from './paths'
import type { Store } from './store'

/*
 * Deleting things for real: rows, previews, and the files the engine made itself (voices,
 * renders, motion, downloads, uploads). Files in the person's own folders are never deleted.
 */

export class InUse extends Error {
  readonly status = 409
}

function insideLibrary(library: Library, path: string) {
  const rel = relative(resolve(library.root), resolve(path))
  return !!rel && !rel.startsWith('..') && !/^[a-z]:/i.test(rel)
}

/** Videos that use an asset (as a clip, a sound, or a motion render). */
export function assetUsage(store: Store, assetId: string): string[] {
  return store
    .listCompositions()
    .filter((c) =>
      c.tracks.some((t) =>
        t.items.some(
          (i) =>
            ((i.type === 'clip' || i.type === 'audio') && i.assetId === assetId) ||
            (i.type === 'motion' && i.renderedAssetId === assetId),
        ),
      ),
    )
    .map((c) => c.name)
}

export function deleteAsset(library: Library, store: Store, id: string, force = false) {
  const asset = store.getAsset(id)
  if (asset.sourceId) {
    throw Object.assign(
      new Error('Это файл из подключённой папки: удали его в самой папке или отключи папку'),
      { status: 400 },
    )
  }
  const used = assetUsage(store, id)
  if (used.length && !force) throw new InUse(`Используется в видео: ${used.join(', ')}`)
  store.deleteAsset(id)
  rmSync(join(library.root, 'cache', id), { recursive: true, force: true })
  if (insideLibrary(library, asset.path)) rmSync(asset.path, { force: true })
}

export function deleteReference(library: Library, store: Store, id: string) {
  const ref = store.getReference(id)
  if (ref.assetId) {
    try {
      store.deleteAsset(ref.assetId)
      rmSync(join(library.root, 'cache', ref.assetId), { recursive: true, force: true })
    } catch {}
  }
  store.deleteReference(id)
  rmSync(join(library.root, 'references', id), { recursive: true, force: true })
}

export function deleteVoice(library: Library, store: Store, id: string) {
  store.getVoice(id)
  store.deleteVoice(id)
  rmSync(join(library.root, 'voices', id), { recursive: true, force: true })
}
