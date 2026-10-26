import { existsSync, type FSWatcher, readdirSync, statSync, watch } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { type Asset, type AssetRole, newId, nowIso, type Source } from '@shotbeam/core'
import type { Indexer } from './media/indexer'
import { kindOf } from './media/kinds'
import type { Store } from './store'

/*
 * Local folders (and Google Drive for Desktop folders, which are local too) as media sources:
 * scanned on demand and watched for changes. Originals are never copied or changed.
 */

const SKIP_DIRS = new Set(['node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information'])

function* walk(dir: string): Generator<string> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else if (e.isFile() && kindOf(p)) yield p
  }
}

export class Sources {
  private readonly watchers = new Map<string, FSWatcher>()
  private readonly timers = new Map<string, NodeJS.Timeout>()

  constructor(
    private readonly store: Store,
    private readonly indexer: Indexer,
  ) {}

  add(input: { projectId: string | null; path: string; name?: string; role?: Source['role'] }) {
    const path = resolve(input.path)
    if (!existsSync(path) || !statSync(path).isDirectory()) throw new Error(`Not a folder: ${path}`)
    const existing = this.store
      .listSources()
      .find((s) => s.path.toLowerCase() === path.toLowerCase())
    if (existing) throw new Error(`This folder is already a source (${existing.name})`)
    const source = this.store.saveSource({
      id: newId(),
      projectId: input.projectId,
      kind: 'local',
      name: input.name?.trim() || basename(path) || path,
      path,
      role: input.role ?? 'footage',
      createdAt: nowIso(),
      scannedAt: null,
    })
    this.watch(source)
    const result = this.scan(source.id)
    return { source, ...result }
  }

  remove(id: string) {
    this.watchers.get(id)?.close()
    this.watchers.delete(id)
    this.store.deleteSource(id)
  }

  /** New and changed files get indexed, gone ones leave the library. */
  scan(id: string) {
    const source = this.store.getSource(id)
    const seen = new Set<string>()
    let added = 0
    let changed = 0
    for (const path of walk(source.path)) {
      seen.add(path)
      const st = statSync(path)
      const existing = this.store.findAssetByPath(path)
      if (
        existing &&
        existing.size === st.size &&
        Math.abs(existing.mtime - st.mtimeMs) < 1 &&
        existing.status !== 'error'
      ) {
        if (existing.status === 'new') this.indexer.index(existing.id)
        continue
      }
      const asset = this.upsertAsset(path, {
        sourceId: source.id,
        projectId: source.projectId,
        role: source.role,
        existing,
      })
      if (existing) changed++
      else added++
      this.indexer.index(asset.id)
    }
    let removed = 0
    for (const a of this.store.listAssets({ sourceId: source.id, limit: 100_000 }).items) {
      if (!seen.has(a.path)) {
        this.store.deleteAsset(a.id)
        removed++
      }
    }
    this.store.saveSource({ ...source, scannedAt: nowIso() })
    return { added, changed, removed }
  }

  /** One file from anywhere on the computer (dropped in the app or named by Claude). */
  importFile(path: string, opts: { projectId: string | null; role?: AssetRole }) {
    const full = resolve(path)
    if (!existsSync(full)) throw new Error(`File not found: ${full}`)
    if (!kindOf(full)) throw new Error(`Not a media file: ${full}`)
    const existing = this.store.findAssetByPath(full)
    const asset = this.upsertAsset(full, {
      sourceId: existing?.sourceId ?? null,
      projectId: opts.projectId,
      role: opts.role ?? existing?.role ?? 'footage',
      existing,
    })
    this.indexer.index(asset.id)
    return asset
  }

  upsertAsset(
    path: string,
    opts: {
      sourceId: string | null
      projectId: string | null
      role: AssetRole
      existing?: Asset | null
    },
  ): Asset {
    const st = statSync(path)
    const now = nowIso()
    const kind = kindOf(path) ?? 'video'
    return this.store.saveAsset({
      id: opts.existing?.id ?? newId(),
      sourceId: opts.sourceId,
      projectId: opts.projectId,
      path,
      name: basename(path),
      kind,
      role: opts.role,
      size: st.size,
      mtime: st.mtimeMs,
      duration: null,
      width: null,
      height: null,
      fps: null,
      hasAudio: kind !== 'image',
      status: 'new',
      error: null,
      tags: opts.existing?.tags ?? [],
      notes: opts.existing?.notes ?? '',
      createdAt: opts.existing?.createdAt ?? now,
      updatedAt: now,
    })
  }

  /** Watches every source; changes are picked up by a scan a moment later. */
  watchAll() {
    for (const s of this.store.listSources()) {
      if (!existsSync(s.path)) continue
      this.watch(s)
      try {
        this.scan(s.id)
      } catch (err) {
        console.error(`[sources] scan of ${s.path} failed:`, err)
      }
    }
  }

  private watch(source: Source) {
    if (this.watchers.has(source.id)) return
    try {
      const w = watch(source.path, { recursive: true }, (_event, file) => {
        if (file && !kindOf(String(file))) return
        clearTimeout(this.timers.get(source.id))
        this.timers.set(
          source.id,
          setTimeout(() => {
            try {
              this.scan(source.id)
            } catch (err) {
              console.error(`[sources] rescan failed:`, err)
            }
          }, 2500),
        )
      })
      w.on('error', () => this.watchers.delete(source.id))
      this.watchers.set(source.id, w)
    } catch (err) {
      console.error(`[sources] cannot watch ${source.path}:`, err)
    }
  }

  close() {
    for (const w of this.watchers.values()) w.close()
    for (const t of this.timers.values()) clearTimeout(t)
  }
}
