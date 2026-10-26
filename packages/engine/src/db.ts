import { DatabaseSync } from 'node:sqlite'

/*
 * SQLite through node:sqlite. Each entity is a row with a few columns to filter on and the whole
 * object as JSON in `data` (validated by the core schemas when read and written).
 * Append migrations, never edit a shipped one.
 */

const MIGRATIONS: string[] = [
  `
  CREATE TABLE projects (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE sources (
    id TEXT PRIMARY KEY, project_id TEXT, data TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE assets (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    source_id TEXT,
    path TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX assets_project ON assets (project_id, role);
  CREATE INDEX assets_source ON assets (source_id);
  CREATE VIRTUAL TABLE asset_text USING fts5(
    asset_id UNINDEXED, name, notes, tags, transcript, tokenize = 'unicode61 remove_diacritics 2'
  );
  CREATE TABLE refs (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE formats (
    id TEXT PRIMARY KEY, project_id TEXT, data TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE voices (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE compositions (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE INDEX jobs_status ON jobs (status, updated_at);
  CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
]

export const SCHEMA_VERSION = MIGRATIONS.length

export type Row = Record<string, unknown>

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;')
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  const from = Number(row.user_version)
  if (from > MIGRATIONS.length) {
    throw new Error(
      `The library database is newer (v${from}) than this engine (v${SCHEMA_VERSION})`,
    )
  }
  for (let v = from; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[v] as string)
      db.exec(`PRAGMA user_version = ${v + 1}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
  return db
}

export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
