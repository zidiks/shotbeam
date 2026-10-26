import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import {
  Asset,
  type AssetRole,
  type AssetStatus,
  BrandKit,
  Composition,
  Format,
  FormatRecipe,
  Job,
  newId,
  nowIso,
  Project,
  Reference,
  Settings,
  Source,
  Voice,
} from '@shotbeam/core'
import type { z } from 'zod'
import { transaction } from './db'
import type { EventBus } from './events'

/*
 * Reads and writes of every entity. Writers announce the change on the bus so open views refresh;
 * nothing else writes these tables.
 */

export class NotFound extends Error {
  readonly status = 404
}

export class Conflict extends Error {
  readonly status = 409
}

function parse<S extends z.ZodType>(schema: S, json: unknown): z.infer<S> {
  return schema.parse(typeof json === 'string' ? JSON.parse(json) : json)
}

export interface AssetQuery {
  projectId?: string | null
  /** Also assets shared by every project (projectId null), e.g. the music library. */
  withShared?: boolean
  sourceId?: string
  role?: AssetRole
  status?: AssetStatus
  kind?: string
  text?: string
  limit?: number
  offset?: number
}

export class Store {
  constructor(
    readonly db: DatabaseSync,
    private readonly bus: EventBus,
  ) {}

  private all(sql: string, ...params: SQLInputValue[]) {
    return this.db.prepare(sql).all(...params) as Record<string, SQLInputValue>[]
  }
  private one(sql: string, ...params: SQLInputValue[]) {
    return this.db.prepare(sql).get(...params) as Record<string, SQLInputValue> | undefined
  }
  private run(sql: string, ...params: SQLInputValue[]) {
    return this.db.prepare(sql).run(...params)
  }

  // Projects

  listProjects(): Project[] {
    return this.all('SELECT data FROM projects ORDER BY updated_at DESC').map((r) =>
      parse(Project, r.data),
    )
  }

  getProject(id: string): Project {
    const row = this.one('SELECT data FROM projects WHERE id = ?', id)
    if (!row) throw new NotFound(`No project ${id}`)
    return parse(Project, row.data)
  }

  createProject(input: { name: string; description?: string; brand?: unknown }): Project {
    const now = nowIso()
    const project = Project.parse({
      id: newId(),
      name: input.name,
      description: input.description ?? '',
      brand: BrandKit.parse(input.brand ?? {}),
      createdAt: now,
      updatedAt: now,
    })
    this.run(
      'INSERT INTO projects (id, data, updated_at) VALUES (?, ?, ?)',
      project.id,
      JSON.stringify(project),
      now,
    )
    this.bus.changed('project', project.id)
    return project
  }

  updateProject(
    id: string,
    patch: Partial<Pick<Project, 'name' | 'description'>> & { brand?: unknown },
  ): Project {
    const current = this.getProject(id)
    const project = Project.parse({
      ...current,
      ...patch,
      brand: patch.brand
        ? BrandKit.parse({ ...current.brand, ...(patch.brand as object) })
        : current.brand,
      updatedAt: nowIso(),
    })
    this.run(
      'UPDATE projects SET data = ?, updated_at = ? WHERE id = ?',
      JSON.stringify(project),
      project.updatedAt,
      id,
    )
    this.bus.changed('project', id)
    return project
  }

  deleteProject(id: string) {
    this.getProject(id)
    transaction(this.db, () => {
      this.run('DELETE FROM projects WHERE id = ?', id)
      this.run('DELETE FROM compositions WHERE project_id = ?', id)
      this.run('UPDATE formats SET project_id = NULL WHERE project_id = ?', id)
    })
    this.bus.changed('project', id)
  }

  // Sources

  listSources(projectId?: string | null): Source[] {
    const rows =
      projectId === undefined
        ? this.all('SELECT data FROM sources ORDER BY updated_at')
        : this.all(
            'SELECT data FROM sources WHERE project_id = ? OR project_id IS NULL ORDER BY updated_at',
            projectId,
          )
    return rows.map((r) => parse(Source, r.data))
  }

  getSource(id: string): Source {
    const row = this.one('SELECT data FROM sources WHERE id = ?', id)
    if (!row) throw new NotFound(`No source ${id}`)
    return parse(Source, row.data)
  }

  saveSource(source: Source) {
    const s = Source.parse(source)
    this.run(
      `INSERT INTO sources (id, project_id, data, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET project_id = excluded.project_id, data = excluded.data, updated_at = excluded.updated_at`,
      s.id,
      s.projectId,
      JSON.stringify(s),
      nowIso(),
    )
    this.bus.changed('source', s.id)
    return s
  }

  deleteSource(id: string) {
    transaction(this.db, () => {
      this.run('DELETE FROM sources WHERE id = ?', id)
      for (const r of this.all('SELECT id FROM assets WHERE source_id = ?', id)) {
        this.run('DELETE FROM asset_text WHERE asset_id = ?', r.id as string)
      }
      this.run('DELETE FROM assets WHERE source_id = ?', id)
    })
    this.bus.changed('source', id)
    this.bus.changed('asset', null)
  }

  // Assets

  getAsset(id: string): Asset {
    const row = this.one('SELECT data FROM assets WHERE id = ?', id)
    if (!row) throw new NotFound(`No asset ${id}`)
    return parse(Asset, row.data)
  }

  findAssetByPath(path: string): Asset | null {
    const row = this.one('SELECT data FROM assets WHERE path = ?', path)
    return row ? parse(Asset, row.data) : null
  }

  listAssets(q: AssetQuery = {}): { items: Asset[]; total: number } {
    const where: string[] = []
    const params: SQLInputValue[] = []
    if (q.projectId !== undefined) {
      if (q.projectId === null) where.push('a.project_id IS NULL')
      else {
        where.push(q.withShared ? '(a.project_id = ? OR a.project_id IS NULL)' : 'a.project_id = ?')
        params.push(q.projectId)
      }
    }
    if (q.sourceId) {
      where.push('a.source_id = ?')
      params.push(q.sourceId)
    }
    if (q.role) {
      where.push('a.role = ?')
      params.push(q.role)
    }
    if (q.status) {
      where.push('a.status = ?')
      params.push(q.status)
    }
    if (q.kind) {
      where.push('a.kind = ?')
      params.push(q.kind)
    }
    let from = 'assets a'
    if (q.text?.trim()) {
      from = 'assets a JOIN asset_text t ON t.asset_id = a.id'
      where.push('asset_text MATCH ?')
      params.push(ftsQuery(q.text))
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = Number(this.one(`SELECT count(*) AS n FROM ${from} ${clause}`, ...params)?.n ?? 0)
    const rows = this.all(
      `SELECT a.data FROM ${from} ${clause} ORDER BY a.updated_at DESC LIMIT ? OFFSET ?`,
      ...params,
      q.limit ?? 100,
      q.offset ?? 0,
    )
    return { items: rows.map((r) => parse(Asset, r.data)), total }
  }

  saveAsset(asset: Asset, opts: { quiet?: boolean } = {}): Asset {
    const a = Asset.parse({ ...asset, updatedAt: nowIso() })
    this.run(
      `INSERT INTO assets (id, project_id, source_id, path, role, kind, status, data, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET project_id = excluded.project_id, source_id = excluded.source_id,
         path = excluded.path, role = excluded.role, kind = excluded.kind, status = excluded.status,
         data = excluded.data, updated_at = excluded.updated_at`,
      a.id,
      a.projectId,
      a.sourceId,
      a.path,
      a.role,
      a.kind,
      a.status,
      JSON.stringify(a),
      a.updatedAt,
    )
    this.indexAssetText(a)
    if (!opts.quiet) this.bus.changed('asset', a.id)
    return a
  }

  /** Keeps the search index in step; the transcript text comes from indexing. */
  indexAssetText(a: Asset, transcript?: string) {
    const prev = this.one('SELECT transcript FROM asset_text WHERE asset_id = ?', a.id)
    this.run('DELETE FROM asset_text WHERE asset_id = ?', a.id)
    this.run(
      'INSERT INTO asset_text (asset_id, name, notes, tags, transcript) VALUES (?, ?, ?, ?, ?)',
      a.id,
      a.name,
      a.notes,
      a.tags.join(' '),
      transcript ?? ((prev?.transcript as string | undefined) || ''),
    )
  }

  deleteAsset(id: string) {
    this.run('DELETE FROM assets WHERE id = ?', id)
    this.run('DELETE FROM asset_text WHERE asset_id = ?', id)
    this.bus.changed('asset', id)
  }

  // References

  listReferences(projectId?: string): Reference[] {
    return this.all('SELECT data FROM refs ORDER BY updated_at DESC')
      .map((r) => parse(Reference, r.data))
      .filter((r) => !projectId || r.projectIds.length === 0 || r.projectIds.includes(projectId))
  }

  getReference(id: string): Reference {
    const row = this.one('SELECT data FROM refs WHERE id = ?', id)
    if (!row) throw new NotFound(`No reference ${id}`)
    return parse(Reference, row.data)
  }

  saveReference(ref: Reference): Reference {
    const r = Reference.parse({ ...ref, updatedAt: nowIso() })
    this.run(
      `INSERT INTO refs (id, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      r.id,
      JSON.stringify(r),
      r.updatedAt,
    )
    this.bus.changed('reference', r.id)
    return r
  }

  deleteReference(id: string) {
    this.run('DELETE FROM refs WHERE id = ?', id)
    this.bus.changed('reference', id)
  }

  // Formats

  listFormats(projectId?: string): Format[] {
    const rows = projectId
      ? this.all(
          'SELECT data FROM formats WHERE project_id = ? OR project_id IS NULL ORDER BY updated_at DESC',
          projectId,
        )
      : this.all('SELECT data FROM formats ORDER BY updated_at DESC')
    return rows.map((r) => parse(Format, r.data))
  }

  getFormat(id: string): Format {
    const row = this.one('SELECT data FROM formats WHERE id = ?', id)
    if (!row) throw new NotFound(`No format ${id}`)
    return parse(Format, row.data)
  }

  createFormat(input: {
    name: string
    description?: string
    projectId?: string | null
    recipe?: unknown
    referenceIds?: string[]
  }): Format {
    const now = nowIso()
    return this.saveFormat({
      id: newId(),
      name: input.name,
      description: input.description ?? '',
      projectId: input.projectId ?? null,
      recipe: FormatRecipe.parse(input.recipe ?? {}),
      referenceIds: input.referenceIds ?? [],
      createdAt: now,
      updatedAt: now,
    })
  }

  saveFormat(format: Format): Format {
    const f = Format.parse({ ...format, updatedAt: nowIso() })
    this.run(
      `INSERT INTO formats (id, project_id, data, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET project_id = excluded.project_id, data = excluded.data, updated_at = excluded.updated_at`,
      f.id,
      f.projectId,
      JSON.stringify(f),
      f.updatedAt,
    )
    this.bus.changed('format', f.id)
    return f
  }

  deleteFormat(id: string) {
    this.run('DELETE FROM formats WHERE id = ?', id)
    this.bus.changed('format', id)
  }

  // Voices

  listVoices(): Voice[] {
    return this.all('SELECT data FROM voices ORDER BY updated_at DESC').map((r) =>
      parse(Voice, r.data),
    )
  }

  getVoice(id: string): Voice {
    const row = this.one('SELECT data FROM voices WHERE id = ?', id)
    if (!row) throw new NotFound(`No voice ${id}`)
    return parse(Voice, row.data)
  }

  saveVoice(voice: Voice): Voice {
    const v = Voice.parse(voice)
    this.run(
      `INSERT INTO voices (id, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      v.id,
      JSON.stringify(v),
      nowIso(),
    )
    this.bus.changed('voice', v.id)
    return v
  }

  deleteVoice(id: string) {
    this.run('DELETE FROM voices WHERE id = ?', id)
    this.bus.changed('voice', id)
  }

  // Compositions

  listCompositions(projectId?: string): Composition[] {
    const rows = projectId
      ? this.all(
          'SELECT data FROM compositions WHERE project_id = ? ORDER BY updated_at DESC',
          projectId,
        )
      : this.all('SELECT data FROM compositions ORDER BY updated_at DESC')
    return rows.map((r) => parse(Composition, r.data))
  }

  getComposition(id: string): Composition {
    const row = this.one('SELECT data FROM compositions WHERE id = ?', id)
    if (!row) throw new NotFound(`No composition ${id}`)
    return parse(Composition, row.data)
  }

  /**
   * Saves a composition. With `expectVersion`, refuses when someone saved since that version
   * (the editor and Claude edit the same document).
   */
  saveComposition(c: Composition, expectVersion?: number): Composition {
    return transaction(this.db, () => {
      const row = this.one('SELECT data FROM compositions WHERE id = ?', c.id)
      const current = row ? parse(Composition, row.data) : null
      if (current && expectVersion !== undefined && current.version !== expectVersion) {
        throw new Conflict(
          `The composition changed meanwhile (version ${current.version}, expected ${expectVersion}); read it again`,
        )
      }
      const saved = Composition.parse({
        ...c,
        version: (current?.version ?? 0) + 1,
        updatedAt: nowIso(),
      })
      this.run(
        `INSERT INTO compositions (id, project_id, data, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET project_id = excluded.project_id, data = excluded.data, updated_at = excluded.updated_at`,
        saved.id,
        saved.projectId,
        JSON.stringify(saved),
        saved.updatedAt,
      )
      this.bus.changed('composition', saved.id)
      return saved
    })
  }

  deleteComposition(id: string) {
    this.run('DELETE FROM compositions WHERE id = ?', id)
    this.bus.changed('composition', id)
  }

  // Jobs

  saveJob(job: Job) {
    const j = Job.parse(job)
    this.run(
      `INSERT INTO jobs (id, status, data, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET status = excluded.status, data = excluded.data, updated_at = excluded.updated_at`,
      j.id,
      j.status,
      JSON.stringify(j),
      j.updatedAt,
    )
  }

  getJob(id: string): Job {
    const row = this.one('SELECT data FROM jobs WHERE id = ?', id)
    if (!row) throw new NotFound(`No job ${id}`)
    return parse(Job, row.data)
  }

  listJobs(opts: { active?: boolean; target?: string; limit?: number } = {}): Job[] {
    const where: string[] = []
    const params: SQLInputValue[] = []
    if (opts.active) where.push("status IN ('queued', 'running')")
    if (opts.target) {
      where.push("json_extract(data, '$.target') = ?")
      params.push(opts.target)
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    // Newest first by creation, so "the last job for X" is stable while jobs update.
    return this.all(
      `SELECT data FROM jobs ${clause} ORDER BY json_extract(data, '$.createdAt') DESC LIMIT ?`,
      ...params,
      opts.limit ?? 50,
    ).map((r) => parse(Job, r.data))
  }

  /** Jobs that were running when the engine stopped will never finish. */
  failInterruptedJobs() {
    for (const job of this.listJobs({ active: true })) {
      this.saveJob({
        ...job,
        status: 'error',
        error: 'Interrupted: the engine stopped',
        updatedAt: nowIso(),
      })
    }
    this.run("DELETE FROM jobs WHERE status IN ('done', 'error') AND updated_at < ?", daysAgo(7))
  }

  // Settings

  getSettings(): Settings {
    const row = this.one("SELECT value FROM kv WHERE key = 'settings'")
    return Settings.parse(row ? JSON.parse(row.value as string) : {})
  }

  updateSettings(patch: Partial<Settings>): Settings {
    const next = Settings.parse({ ...this.getSettings(), ...patch })
    this.run(
      "INSERT INTO kv (key, value) VALUES ('settings', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      JSON.stringify(next),
    )
    this.bus.changed('settings')
    return next
  }
}

function daysAgo(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

/** Free text to an FTS5 query: each word as a prefix, all required. */
export function ftsQuery(text: string): string {
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
  return words.map((w) => `"${w}"*`).join(' ')
}
