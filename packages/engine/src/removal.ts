import { execFile } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { Library } from './paths'
import type { Store } from './store'

/*
 * Deleting things for real: rows, previews, and the files the engine made itself (voices,
 * renders, motion, downloads, uploads). A file in the person's own folders goes to the system
 * Recycle Bin / Trash instead, so it can be brought back.
 */

const run = promisify(execFile)

/** Moves a file to the Recycle Bin (Windows), the Trash (macOS) or the trash can (Linux). */
export async function moveToTrash(path: string) {
  if (!existsSync(path)) return
  if (process.platform === 'win32') {
    // The path goes in through the environment, so no quoting can break the command.
    await run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($env:SHOTBEAM_TRASH, 'OnlyErrorDialogs', 'SendToRecycleBin')",
      ],
      { env: { ...process.env, SHOTBEAM_TRASH: path }, windowsHide: true },
    )
  } else if (process.platform === 'darwin') {
    await run('osascript', [
      '-e',
      'on run argv',
      '-e',
      'tell application "Finder" to delete POSIX file (item 1 of argv)',
      '-e',
      'end run',
      path,
    ])
  } else {
    await run('gio', ['trash', path])
  }
  if (existsSync(path)) throw new Error(`Could not move to the trash: ${path}`)
}

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

/**
 * Deletes an asset with its previews. A file the engine made goes for good; one in a connected
 * folder goes to the trash (else the next scan would bring it back); one imported from
 * elsewhere stays where it is and only leaves the library.
 */
export async function deleteAsset(library: Library, store: Store, id: string, force = false) {
  const asset = store.getAsset(id)
  const used = assetUsage(store, id)
  if (used.length && !force) throw new InUse(`Используется в видео: ${used.join(', ')}`)
  const ours = insideLibrary(library, asset.path)
  if (ours) rmSync(asset.path, { force: true })
  else if (asset.sourceId) await moveToTrash(asset.path)
  store.deleteAsset(id)
  rmSync(join(library.root, 'cache', id), { recursive: true, force: true })
  return { trashed: !ours && !!asset.sourceId }
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
