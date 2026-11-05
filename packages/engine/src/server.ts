import { spawn } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import {
  Aspect,
  AssetRole,
  CaptionStyle,
  CompositionOp,
  type EngineEvent,
  FormatRecipe,
  MotionEngine,
  publicSettings,
  Settings,
  UpscaleModel,
  VoiceProviderId,
} from '@shotbeam/core'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import type { Engine } from './engine'
import { frameAt } from './media/ffmpeg'
import { mimeOf } from './media/kinds'
import type { PythonFeature } from './python'
import { assetUsage, deleteAsset, deleteReference, deleteVoice } from './removal'

/*
 * The engine's HTTP API (localhost only). JSON in and out; media files with Range support so the
 * editor can seek; /api/events streams changes (SSE).
 */

/**
 * How MCP clients start the server, for "connect Claude": the installed app passes its own Node
 * and bundled server (SHOTBEAM_NODE / SHOTBEAM_MCP_ENTRY); a checkout uses node on PATH.
 */
const MCP_ENTRY = (
  process.env.SHOTBEAM_MCP_ENTRY ??
  fileURLToPath(new URL('../../../apps/mcp/bin/shotbeam-mcp.mjs', import.meta.url))
).replace(/\\/g, '/')
const MCP_COMMAND = (process.env.SHOTBEAM_NODE ?? 'node').replace(/\\/g, '/')

const ALLOWED_ORIGINS = [
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
  /^tauri:\/\/localhost$/,
  /^https?:\/\/tauri\.localhost$/,
]

export function createApp(engine: Engine) {
  const { store, indexer, sources, references, voices, compositions, jobs, motion, python, fonts } =
    engine
  const app = new Hono()

  // Only this computer's apps: a web page elsewhere must not drive the engine.
  app.use('*', async (c, next) => {
    const origin = c.req.header('origin')
    if (origin && !ALLOWED_ORIGINS.some((r) => r.test(origin)))
      return c.json({ error: 'Origin not allowed' }, 403)
    await next()
    if (origin) {
      c.res.headers.set('access-control-allow-origin', origin)
      c.res.headers.set('vary', 'origin')
    }
  })
  app.options('*', (c) => {
    const origin = c.req.header('origin') ?? ''
    return c.body(null, 204, {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'access-control-allow-headers': 'content-type,authorization',
      'access-control-max-age': '600',
    })
  })

  app.onError((err, c) => {
    const status = (err as { status?: number }).status
    const message =
      err instanceof z.ZodError
        ? `Invalid input: ${err.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`
        : err.message
    if (!status || status >= 500) console.error('[api]', err)
    return c.json(
      { error: message },
      (status && status >= 400 && status < 600 ? status : 500) as 500,
    )
  })

  const body = async <S extends z.ZodType>(
    c: { req: { json: () => Promise<unknown> } },
    schema: S,
  ) => schema.parse(await c.req.json().catch(() => ({}))) as z.infer<S>

  // Uploads: bytes from the UI (a microphone recording, a dropped file) saved into the library.

  app.post('/api/uploads', async (c) => {
    const name = (c.req.query('name') ?? 'upload.bin').replace(/[^\w.-]+/g, '_').slice(-80)
    const dir = join(engine.library.root, 'uploads')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `${Date.now().toString(36)}-${name}`)
    writeFileSync(path, Buffer.from(await c.req.arrayBuffer()))
    return c.json({ path }, 201)
  })

  // Shows a file or folder in Explorer / Finder (the engine runs on this computer).
  app.post('/api/reveal', async (c) => {
    const { path } = await body(c, z.object({ path: z.string().min(1) }))
    if (!existsSync(path)) return c.json({ error: 'Файл не найден' }, 404)
    const [cmd, args] =
      process.platform === 'win32'
        ? ['explorer.exe', [`/select,${path}`]]
        : process.platform === 'darwin'
          ? ['open', ['-R', path]]
          : ['xdg-open', [dirname(path)]]
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref()
    return c.json({ ok: true })
  })

  // Health and setup

  app.get('/api/health', (c) =>
    c.json({ ok: true, library: engine.library.root, pid: process.pid }),
  )

  app.get('/api/setup', async (c) =>
    c.json({
      library: engine.library.root,
      mcpEntry: MCP_ENTRY,
      mcpCommand: MCP_COMMAND,
      python: { ready: python.ready, features: await python.features().catch(() => null) },
      voices: await voices.statuses(),
      motion: await motion.status(),
      upscaler: engine.upscaler.status(),
      tools: engine.tools.status(),
    }),
  )

  app.post('/api/setup/python', async (c) => {
    const { features } = await body(
      c,
      z.object({
        features: z
          .array(z.enum(['whisper', 'ytdlp', 'beats', 'cuda', 'kokoro', 'chatterbox', 'musicgen']))
          .min(1),
      }),
    )
    const { job } = jobs.enqueue('python-setup', null, 'net', (ctx) =>
      python.install(features as PythonFeature[], ctx.progress, ctx.signal),
    )
    return c.json(job)
  })

  app.post('/api/setup/remotion', (c) => c.json(motion.setupRemotion().job))
  // Music from outside: Openverse search and import, MusicGen.
  app.get('/api/music/openverse', async (c) => {
    const q = c.req.query()
    if (!q.q?.trim()) return c.json({ error: 'Пустой запрос' }, 400)
    return c.json(
      await engine.music.search(q.q, {
        license: q.license === 'share-alike' ? 'share-alike' : 'credit',
        page: q.page ? Number(q.page) : undefined,
        pageSize: q.pageSize ? Number(q.pageSize) : undefined,
      }),
    )
  })
  app.post('/api/music/openverse/:id/import', async (c) => {
    const { projectId } = await body(c, z.object({ projectId: z.string().nullable().optional() }))
    return c.json(engine.music.importOpenverse(c.req.param('id'), projectId ?? null))
  })
  app.post('/api/music/generate', async (c) => {
    const input = await body(
      c,
      z.object({
        prompt: z.string().min(3).max(500),
        seconds: z.number().min(2).max(30).default(15),
        model: z.enum(['small', 'medium']).default('small'),
        projectId: z.string().nullable().default(null),
      }),
    )
    return c.json(engine.music.generate(input))
  })

  app.post('/api/setup/ffmpeg', (c) => c.json(engine.tools.download().job))
  app.post('/api/setup/upscaler', (c) => c.json(engine.upscaler.install()))

  // Settings

  app.get('/api/settings', (c) => c.json(publicSettings(store.getSettings())))
  app.patch('/api/settings', async (c) => {
    const patch = await body(c, Settings.partial())
    return c.json(publicSettings(store.updateSettings(patch)))
  })

  // Projects

  app.get('/api/projects', (c) => c.json(store.listProjects()))
  app.post('/api/projects', async (c) => {
    const input = await body(
      c,
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        brand: z.unknown().optional(),
      }),
    )
    return c.json(store.createProject(input), 201)
  })
  app.get('/api/projects/:id', (c) => c.json(store.getProject(c.req.param('id'))))
  app.patch('/api/projects/:id', async (c) => {
    const patch = await body(
      c,
      z.object({
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        brand: z.unknown().optional(),
      }),
    )
    return c.json(store.updateProject(c.req.param('id'), patch))
  })
  app.delete('/api/projects/:id', (c) => {
    store.deleteProject(c.req.param('id'))
    return c.json({ ok: true })
  })

  // Sources

  app.get('/api/sources', (c) => c.json(store.listSources(c.req.query('projectId'))))
  app.post('/api/sources', async (c) => {
    const input = await body(
      c,
      z.object({
        projectId: z.string().nullable(),
        path: z.string().min(1),
        name: z.string().optional(),
        role: z.enum(['footage', 'music', 'sfx', 'brand']).optional(),
      }),
    )
    return c.json(sources.add(input), 201)
  })
  app.post('/api/sources/:id/scan', (c) => c.json(sources.scan(c.req.param('id'))))
  app.delete('/api/sources/:id', (c) => {
    sources.remove(c.req.param('id'))
    return c.json({ ok: true })
  })

  // Assets

  app.get('/api/assets', (c) => {
    const q = c.req.query()
    return c.json(
      store.listAssets({
        projectId: q.projectId === 'none' ? null : q.projectId,
        withShared: q.shared !== '0',
        sourceId: q.sourceId,
        role: q.role ? AssetRole.parse(q.role) : undefined,
        status: q.status as never,
        kind: q.kind,
        text: q.q,
        limit: q.limit ? Number(q.limit) : undefined,
        offset: q.offset ? Number(q.offset) : undefined,
      }),
    )
  })
  app.post('/api/assets/import', async (c) => {
    const input = await body(
      c,
      z.object({
        path: z.string().min(1),
        projectId: z.string().nullable(),
        role: AssetRole.optional(),
      }),
    )
    return c.json(sources.importFile(input.path, input), 201)
  })
  app.get('/api/assets/:id', (c) => {
    const asset = store.getAsset(c.req.param('id'))
    return c.json({
      asset,
      analysis: indexer.analysis(asset.id),
      jobs: store.listJobs({ target: asset.id, limit: 20 }),
    })
  })
  app.patch('/api/assets/:id', async (c) => {
    const patch = await body(
      c,
      z.object({
        name: z.string().optional(),
        tags: z.array(z.string()).optional(),
        notes: z.string().optional(),
        role: AssetRole.optional(),
        projectId: z.string().nullable().optional(),
      }),
    )
    const asset = store.getAsset(c.req.param('id'))
    const saved = store.saveAsset({ ...asset, ...patch })
    // A file that just became music gets its beats, as if it had been indexed as music.
    if (patch.role === 'music' && asset.role !== 'music' && asset.hasAudio) {
      void python
        .features()
        .then((f) => {
          if (f.beats && !indexer.analysis(asset.id).music) indexer.beats(asset.id)
        })
        .catch(() => {})
    }
    return c.json(saved)
  })
  app.post('/api/assets/:id/reindex', (c) => c.json(indexer.index(c.req.param('id'))))
  app.post('/api/assets/:id/transcribe', async (c) => {
    const { language } = await body(c, z.object({ language: z.string().optional() }))
    return c.json(indexer.transcribe(c.req.param('id'), language))
  })
  app.post('/api/assets/:id/beats', (c) => c.json(indexer.beats(c.req.param('id'))))
  app.post('/api/assets/:id/upscale', async (c) => {
    const input = await body(
      c,
      z.object({ model: UpscaleModel, scale: z.number().int().min(2).max(4) }),
    )
    return c.json(engine.upscaler.upscale(c.req.param('id'), input))
  })
  app.get('/api/assets/:id/waveform', (c) => c.json(indexer.waveform(c.req.param('id'))))
  app.get('/api/assets/:id/usage', (c) =>
    c.json({ compositions: assetUsage(store, c.req.param('id')) }),
  )
  app.delete('/api/assets/:id', async (c) => {
    const r = await deleteAsset(
      engine.library,
      store,
      c.req.param('id'),
      c.req.query('force') === '1',
    )
    return c.json({ ok: true, ...r })
  })

  app.get('/api/assets/:id/media/:variant', (c) => {
    const asset = store.getAsset(c.req.param('id'))
    const variant = c.req.param('variant')
    const path =
      variant === 'original'
        ? asset.path
        : variant === 'play'
          ? indexer.playable(asset)
          : variant === 'thumb'
            ? indexer.file(asset.id, 'thumb.jpg')
            : variant === 'proxy'
              ? indexer.file(asset.id, 'proxy.mp4')
              : variant === 'audio'
                ? indexer.file(asset.id, 'audio.wav')
                : null
    if (!path) return c.json({ error: 'Unknown variant' }, 400)
    return sendFile(c.req.raw, path)
  })
  app.get('/api/assets/:id/sheets/:index', (c) => {
    const id = c.req.param('id')
    const sheet = indexer.analysis(id).sheets[Number(c.req.param('index'))]
    if (!sheet) return c.json({ error: 'No such contact sheet' }, 404)
    return sendFile(c.req.raw, indexer.sheetFile(id, sheet.file))
  })
  app.get('/api/assets/:id/frame', async (c) => {
    const asset = store.getAsset(c.req.param('id'))
    const t = Number(c.req.query('t') ?? 0)
    const size = Math.min(1920, Number(c.req.query('size') ?? 768))
    const jpeg = await frameAt(
      asset.kind === 'image' ? asset.path : indexer.playable(asset),
      t,
      size,
    )
    return c.body(new Uint8Array(jpeg), 200, {
      'content-type': 'image/jpeg',
      'cache-control': 'max-age=3600',
    })
  })

  // References

  app.get('/api/references', (c) => c.json(references.listFor(c.req.query('projectId'))))
  app.post('/api/references', async (c) => {
    const input = await body(
      c,
      z.object({
        url: z.string().url(),
        projectId: z.string().nullable().optional(),
        tags: z.array(z.string()).optional(),
      }),
    )
    return c.json(references.add(input), 201)
  })
  app.get('/api/references/:id', (c) => {
    const ref = store.getReference(c.req.param('id'))
    return c.json({ reference: ref, asset: ref.assetId ? store.getAsset(ref.assetId) : null })
  })
  app.patch('/api/references/:id', async (c) => {
    const patch = await body(
      c,
      z.object({
        analysis: z.string().optional(),
        tags: z.array(z.string()).optional(),
        projectIds: z.array(z.string()).optional(),
        title: z.string().optional(),
      }),
    )
    return c.json(store.saveReference({ ...store.getReference(c.req.param('id')), ...patch }))
  })
  app.post('/api/references/:id/retry', (c) => c.json(references.download(c.req.param('id'))))
  app.delete('/api/references/:id', (c) => {
    deleteReference(engine.library, store, c.req.param('id'))
    return c.json({ ok: true })
  })
  app.get('/api/references/:id/thumb', (c) => {
    const thumb = references.thumbnail(c.req.param('id'))
    if (!thumb) return c.json({ error: 'No thumbnail' }, 404)
    return sendFile(c.req.raw, thumb)
  })

  // Formats

  app.get('/api/formats', (c) => c.json(store.listFormats(c.req.query('projectId'))))
  app.post('/api/formats', async (c) => {
    const input = await body(
      c,
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        projectId: z.string().nullable().optional(),
        recipe: z.unknown().optional(),
        referenceIds: z.array(z.string()).optional(),
      }),
    )
    return c.json(store.createFormat(input), 201)
  })
  app.get('/api/formats/:id', (c) => c.json(store.getFormat(c.req.param('id'))))
  app.patch('/api/formats/:id', async (c) => {
    const patch = await body(
      c,
      z.object({
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        projectId: z.string().nullable().optional(),
        recipe: z.record(z.string(), z.unknown()).optional(),
        referenceIds: z.array(z.string()).optional(),
      }),
    )
    const current = store.getFormat(c.req.param('id'))
    // Recipe changes merge one level deep, so "change the captions" keeps the beats.
    const recipe = patch.recipe
      ? FormatRecipe.parse(mergeRecipe(current.recipe, patch.recipe))
      : current.recipe
    return c.json(store.saveFormat({ ...current, ...patch, recipe }))
  })
  app.delete('/api/formats/:id', (c) => {
    store.deleteFormat(c.req.param('id'))
    return c.json({ ok: true })
  })

  // Voices and speech

  app.get('/api/voices', (c) => c.json(store.listVoices()))
  app.get('/api/voice-providers', async (c) => c.json(await voices.statuses()))
  app.post('/api/voices', async (c) => {
    const input = await body(
      c,
      z.object({
        name: z.string().min(1),
        provider: VoiceProviderId,
        samplePath: z.string().optional(),
        sampleAssetId: z.string().optional(),
        sampleText: z.string().optional(),
        language: z.string().optional(),
        preset: z.string().optional(),
      }),
    )
    if (input.preset) {
      return c.json(
        voices.addPreset({
          name: input.name,
          provider: input.provider,
          ref: input.preset,
          language: input.language ?? 'en',
        }),
        201,
      )
    }
    const samplePath =
      input.samplePath ?? (input.sampleAssetId ? store.getAsset(input.sampleAssetId).path : null)
    if (!samplePath) return c.json({ error: 'Give samplePath or sampleAssetId' }, 400)
    return c.json(voices.create({ ...input, samplePath }).job, 201)
  })
  app.delete('/api/voices/:id', (c) => {
    deleteVoice(engine.library, store, c.req.param('id'))
    return c.json({ ok: true })
  })
  app.get('/api/voices/:id/sample', (c) => {
    const v = store.getVoice(c.req.param('id'))
    if (!v.sample) return c.json({ error: 'No sample' }, 404)
    return sendFile(c.req.raw, v.sample)
  })
  app.post('/api/tts', async (c) => {
    const input = await body(
      c,
      z.object({
        projectId: z.string(),
        text: z.string().min(1).max(5000),
        provider: VoiceProviderId.optional(),
        voiceId: z.string().nullable().optional(),
        language: z.string().optional(),
        speed: z.number().min(0.5).max(2).optional(),
        preset: z.string().optional(),
        name: z.string().optional(),
        options: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    return c.json(voices.speak(input).job, 201)
  })

  // Motion templates

  app.get('/api/motion/templates', (c) => {
    const engineName = c.req.query('engine')
    return c.json(motion.list(engineName ? MotionEngine.parse(engineName) : undefined))
  })
  app.get('/api/motion/templates/:engine/:name', (c) => {
    const e = MotionEngine.parse(c.req.param('engine'))
    return c.json({
      template: motion.get(e, c.req.param('name')),
      files: motion.files(e, c.req.param('name')),
    })
  })
  app.put('/api/motion/templates/:engine/:name', async (c) => {
    const input = await body(
      c,
      z.object({
        description: z.string(),
        duration: z.number().positive(),
        overlay: z.boolean(),
        variables: z.array(
          z.object({
            name: z.string(),
            type: z.enum(['string', 'number', 'color', 'boolean']),
            default: z.unknown(),
            description: z.string().default(''),
          }),
        ),
        files: z.record(z.string(), z.string()),
      }),
    )
    const { files, ...manifest } = input
    return c.json(
      motion.save(MotionEngine.parse(c.req.param('engine')), c.req.param('name'), manifest, files),
    )
  })
  app.delete('/api/motion/templates/:engine/:name', (c) => {
    motion.remove(MotionEngine.parse(c.req.param('engine')), c.req.param('name'))
    return c.json({ ok: true })
  })

  // Compositions

  app.get('/api/compositions', (c) => c.json(store.listCompositions(c.req.query('projectId'))))
  app.post('/api/compositions', async (c) => {
    const input = await body(
      c,
      z.object({
        projectId: z.string(),
        name: z.string().min(1),
        aspect: Aspect.optional(),
        formatId: z.string().nullable().optional(),
        fps: z.number().optional(),
      }),
    )
    return c.json(compositions.create(input), 201)
  })
  app.get('/api/compositions/:id', (c) => c.json(store.getComposition(c.req.param('id'))))
  app.post('/api/compositions/:id/duplicate', (c) => {
    const src = store.getComposition(c.req.param('id'))
    const now = new Date().toISOString()
    const copy = store.saveComposition({
      ...src,
      id: crypto.randomUUID().replace(/-/g, '').slice(0, 12),
      name: `${src.name} (копия)`,
      version: 0,
      createdAt: now,
      updatedAt: now,
    })
    return c.json(copy, 201)
  })
  app.get('/api/compositions/:id/history', (c) => c.json(store.history(c.req.param('id'))))
  app.post('/api/compositions/:id/undo', (c) =>
    c.json(store.stepHistory(c.req.param('id'), 'undo')),
  )
  app.post('/api/compositions/:id/redo', (c) =>
    c.json(store.stepHistory(c.req.param('id'), 'redo')),
  )
  app.post('/api/compositions/:id/ops', async (c) => {
    const input = await body(
      c,
      z.object({ ops: z.array(CompositionOp).min(1), version: z.number().int().optional() }),
    )
    return c.json(compositions.apply(c.req.param('id'), input.ops, input.version))
  })
  app.get('/api/compositions/:id/beats', (c) => c.json(compositions.beats(c.req.param('id'))))
  app.post('/api/compositions/:id/captions', async (c) => {
    const input = await body(
      c,
      z.object({
        style: CaptionStyle.partial().optional(),
        source: z.enum(['auto', 'voice', 'clips']).optional(),
      }),
    )
    return c.json(compositions.captions(c.req.param('id'), input.style, input.source))
  })
  app.post('/api/compositions/:id/motion/:itemId', (c) =>
    c.json(compositions.renderMotion(c.req.param('id'), c.req.param('itemId'))),
  )
  app.post('/api/compositions/:id/render', async (c) => {
    const input = await body(c, z.object({ draft: z.boolean().optional() }))
    return c.json(compositions.render(c.req.param('id'), input))
  })
  app.patch('/api/compositions/:id', async (c) => {
    const patch = await body(
      c,
      z.object({ name: z.string().min(1).optional(), formatId: z.string().nullable().optional() }),
    )
    const current = store.getComposition(c.req.param('id'))
    return c.json(store.saveComposition({ ...current, ...patch }))
  })
  app.delete('/api/compositions/:id', (c) => {
    store.deleteComposition(c.req.param('id'))
    return c.json({ ok: true })
  })

  // Jobs

  app.get('/api/jobs', (c) =>
    c.json(
      store.listJobs({
        active: c.req.query('active') === '1',
        target: c.req.query('target'),
        limit: Number(c.req.query('limit') ?? 50),
      }),
    ),
  )
  app.get('/api/jobs/:id', (c) => c.json(store.getJob(c.req.param('id'))))
  app.post('/api/jobs/:id/cancel', (c) => c.json({ cancelled: jobs.cancel(c.req.param('id')) }))

  // Fonts (the editor previews text with the same files ffmpeg renders with)

  app.get('/api/fonts', (c) => c.json(fonts.list()))
  app.get('/api/fonts/:file', (c) => {
    const file = c.req.param('file')
    if (!/^[\w .-]+\.(ttf|otf)$/i.test(file)) return c.json({ error: 'Bad font name' }, 400)
    return sendFile(c.req.raw, join(fonts.dir, file))
  })

  // Events

  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      const queue: EngineEvent[] = []
      let wake: (() => void) | null = null
      const off = engine.bus.subscribe((e) => {
        queue.push(e)
        wake?.()
      })
      stream.onAbort(() => {
        off()
        wake?.()
      })
      await stream.writeSSE({ event: 'hello', data: '{}' })
      while (!stream.aborted) {
        if (!queue.length) {
          await Promise.race([new Promise<void>((r) => (wake = r)), stream.sleep(20_000)])
          wake = null
          if (!queue.length) {
            await stream.writeSSE({ event: 'ping', data: '{}' })
            continue
          }
        }
        const e = queue.shift() as EngineEvent
        await stream.writeSSE({ event: e.type, data: JSON.stringify(e) })
      }
    }),
  )

  return app
}

function mergeRecipe(current: Record<string, unknown>, patch: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...current }
  for (const [k, v] of Object.entries(patch)) {
    const prev = out[k]
    out[k] =
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      prev &&
      typeof prev === 'object' &&
      !Array.isArray(prev)
        ? { ...(prev as object), ...(v as object) }
        : v
  }
  return out
}

/** A file with Range support (video seeking). */
function sendFile(req: Request, path: string): Response {
  if (!existsSync(path)) return Response.json({ error: 'File not found' }, { status: 404 })
  const size = statSync(path).size
  const type = mimeOf(path)
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') ?? '')
  const headers: Record<string, string> = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'cache-control': 'no-cache',
  }
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
    if (start >= size)
      return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } })
    const stream = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
    return new Response(stream, {
      status: 206,
      headers: {
        ...headers,
        'content-range': `bytes ${start}-${end}/${size}`,
        'content-length': String(end - start + 1),
      },
    })
  }
  const stream = Readable.toWeb(createReadStream(path)) as ReadableStream
  return new Response(stream, {
    status: 200,
    headers: { ...headers, 'content-length': String(size) },
  })
}
