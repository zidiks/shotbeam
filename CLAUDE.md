# Shotbeam — working notes for Claude

Read docs/CONCEPT.md first (what this is and what was decided). Local-first: no cloud backend.

## Layout

- `packages/core` — zod schemas and pure logic: model (projects, assets, references, formats,
  voices, jobs), the composition document and its ops (`timeline.ts`, `ops.ts`), the engine HTTP
  client. No IO, no React.
- `packages/engine` — the local Node server (Hono on 127.0.0.1:47811): SQLite via `node:sqlite`,
  the library folder, sources, indexing (ffmpeg + Python worker), references (yt-dlp), voice
  providers, motion (HyperFrames / Remotion), rendering (ffmpeg). Events over SSE `/api/events`.
- `packages/ui` — the FixNote design system (shadcn style, Tailwind 4 tokens). Use semantic
  tokens; category colours on the timeline are the one exception.
- `apps/mcp` — stdio MCP server, a thin client of the engine (starts it when nothing answers).
  Entry for clients: `node apps/mcp/bin/shotbeam-mcp.mjs`.
- `apps/web` — React UI (Vite, port 5180), TanStack Query + SSE invalidation, zustand for UI state.
- `apps/desktop` — Tauri 2 shell: opens apps/web, starts the engine from this checkout.

## Conventions

- TypeScript strict, Biome (`pnpm format`), same style as FixNote: comments say why, sparse.
- The library (DB, previews, voices, renders, Python venv) lives where `~/.shotbeam.json`
  `{ "home": … }` says (here `D:/Shotbeam`; the system drive is nearly full). SHOTBEAM_HOME
  overrides. Never write big files to C:.
- DB: one row per entity, the object as JSON in `data` plus filter columns. Append migrations in
  `db.ts`, never edit a shipped one.
- Every write goes through `Store`, which announces it on the bus; the UI refetches by entity.
- Compositions change only through ops (`applyOps`), validated by the core schemas; the engine
  bumps `version`, and writers may pass the version they read (409 on conflict).
- Tracks are in display order: visual tracks first (top one draws on top, labels V3…V1 from the
  bottom), then audio (A1, A2…). Items on a track may overlap only when asked (magnet off, Alt,
  or pushed through); later items draw over earlier ones. Text and captions burn in at their
  own track's layer (one ASS script per visual track).
- UI strings are Russian, inline (personal tool). Buttons that wait get `loading`.
- Reference videos never go into an edit (the engine refuses).
- Python worker (`packages/engine/python/worker.py`): text in files, progress as
  `@@progress <f> <msg>` lines, audio for Whisper as 16 kHz mono WAV (no PyAV).

## Run

- `pnpm install`, then `pnpm dev` (engine + web) or `pnpm dev:desktop` (Tauri window; it starts
  the engine itself). Engine alone: `pnpm dev:engine`.
- Checks: `pnpm typecheck`, `pnpm test`, `pnpm lint`.
