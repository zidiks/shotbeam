import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  type Analysis,
  Aspect,
  type Asset,
  AssetRole,
  CaptionStyle,
  type Composition,
  CompositionOp,
  type EngineClient,
  type Format,
  type Job,
  MotionEngine,
  type Project,
  query,
  type Reference,
  type Source,
  UpscaleModel,
  type Voice,
  VoiceProviderId,
} from '@shotbeam/core'
import { z } from 'zod'
import {
  assetLine,
  type BeatInfo,
  beatsText,
  bestWindow,
  compositionText,
  describeAsset,
  formatText,
  musicLine,
  pacing,
  referenceLine,
  t,
  transcriptLines,
} from './format'

export const VERSION = '0.1.0'

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

const INSTRUCTIONS = `Shotbeam is the user's local studio for short vertical videos (Reels, Shorts, TikTok). You are the editor's brain; these tools are your hands.

How to work:
- Projects hold brand rules (tone, colours, fonts). Read them before writing scripts or captions.
- Media is indexed: transcripts with word times, scenes, candidate moments, contact sheets. To find juicy moments, read get_asset, then LOOK at view_sheets / get_frames before choosing; candidate moments are only hints.
- References are other people's videos (add_reference with a link). Take their format apart (get_reference, view_sheets on its asset), write the breakdown with save_reference_analysis, and capture the repeatable mechanics as a format (create_format / update_format). Never put reference footage in an edit.
- Formats are reusable recipes. A composition made from a format should follow its beats, pacing, captions and music.
- Compositions are edited with edit_composition (atomic batches of ops). Use add_captions after placing the voice or the talking clips. render with draft:true first, final when the user agrees.
- Voice: speak (pick the provider the user asks for; default from settings). Cloned voices come from create_voice with a recording of the person.
- Motion: two engines, HyperFrames (HTML+GSAP) and Remotion (React). Use the one the user picks; templates are listed by list_motion_templates and can be written with save_motion_template.
- Music: find_music picks tracks from the music library by mood, tempo and energy (it shows each track's key, brightness, busyness and energy shape). Tag the moods you hear in the numbers and names with update_asset (tags like "mood:upbeat") so they are found next time. Put music on A2 with duck:true under a voice, starting where find_music says the energy is. get_composition lists the beats on the timeline; {op:"cutToBeats"} lands every cut of a track on them (the format's pacing.cutOnBeat asks for it). When the library has nothing that fits: search_music_online (Openverse, Creative Commons; import_music brings a track in, and a CC BY one needs the credit from its notes in the video description), Pixabay through the link it gives (the user downloads; YouTube Content ID may claim it), or generate_music (MusicGen on this computer, up to 30 s; its CC BY-NC weights make it unfit for monetised videos — say so).
- Trending platform sounds are added in the app when posting, never rendered into the file: put them in the format's music.trendingSound.
Everything you change shows up live in the Shotbeam app, where the user can fine-tune it by hand.`

/** The Shotbeam MCP server over a connection to the engine. */
export function createServer(api: EngineClient): McpServer {
  const server = new McpServer(
    { name: 'shotbeam', version: VERSION },
    { instructions: INSTRUCTIONS },
  )

  const run = async (fn: () => Promise<string | Content[]>) => {
    try {
      const out = await fn()
      return { content: typeof out === 'string' ? [{ type: 'text' as const, text: out }] : out }
    } catch (err) {
      return {
        content: [
          { type: 'text' as const, text: err instanceof Error ? err.message : String(err) },
        ],
        isError: true,
      }
    }
  }

  const image = async (path: string): Promise<Content> => {
    const res = await fetch(api.url(path))
    if (!res.ok) throw new Error(`Could not load ${path}: ${res.status}`)
    return {
      type: 'image',
      data: Buffer.from(await res.arrayBuffer()).toString('base64'),
      mimeType: 'image/jpeg',
    }
  }

  /** Waits for a job up to `seconds`; returns it either way. */
  const wait = async (job: Job, seconds: number): Promise<Job> => {
    const until = Date.now() + seconds * 1000
    let current = job
    while (current.status !== 'done' && current.status !== 'error' && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 1000))
      current = await api.get<Job>(`/api/jobs/${job.id}`)
    }
    return current
  }

  const jobText = (j: Job) =>
    j.status === 'done'
      ? `Done: ${JSON.stringify(j.result)}`
      : j.status === 'error'
        ? `Failed: ${j.error}`
        : `Still ${j.status} (${Math.round(j.progress * 100)}% ${j.message}). Job ${j.id}: check with wait_job.`

  const projectByName = async (idOrName: string) => {
    const projects = await api.get<Project[]>('/api/projects')
    const p =
      projects.find((x) => x.id === idOrName) ??
      projects.find((x) => x.name.toLowerCase() === idOrName.toLowerCase())
    if (!p)
      throw new Error(
        `No project "${idOrName}". Projects: ${projects.map((x) => x.name).join(', ') || 'none yet'}`,
      )
    return p
  }

  const assetNames = async (c: Composition) => {
    const ids = new Set<string>()
    for (const tr of c.tracks)
      for (const i of tr.items) {
        if (i.type === 'clip' || i.type === 'audio') ids.add(i.assetId)
      }
    const names = new Map<string, string>()
    await Promise.all(
      [...ids].map(async (id) => {
        try {
          names.set(id, (await api.get<{ asset: Asset }>(`/api/assets/${id}`)).asset.name)
        } catch {}
      }),
    )
    return names
  }

  /** The edit as text, with the beats of its music. */
  const editText = async (c: Composition) => {
    const names = await assetNames(c)
    const text = compositionText(c, names)
    try {
      const beats = beatsText(await api.get<BeatInfo>(`/api/compositions/${c.id}/beats`), names)
      return beats ? `${text}\n\n${beats}` : text
    } catch {
      return text
    }
  }

  // Projects and media

  server.registerTool(
    'list_projects',
    {
      title: 'Projects',
      description: 'All projects with their brand kits.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () =>
      run(async () => {
        const projects = await api.get<Project[]>('/api/projects')
        if (!projects.length) return 'No projects yet. Create one with create_project.'
        return projects
          .map(
            (p) =>
              `${p.name} [${p.id}]${p.description ? ` — ${p.description}` : ''}\n  brand: ${JSON.stringify(p.brand)}`,
          )
          .join('\n')
      }),
  )

  server.registerTool(
    'create_project',
    {
      title: 'Create a project',
      description:
        'A brand or product with its own media, formats and videos. brand: { colors: {primary, accent, text, background}, fonts: {heading, body}, tone, rules, languages }.',
      inputSchema: {
        name: z.string().min(1),
        description: z.string().optional(),
        brand: z.record(z.string(), z.unknown()).optional(),
      },
    },
    (input) =>
      run(async () => {
        const p = await api.post<Project>('/api/projects', input)
        return `Created ${p.name} [${p.id}]`
      }),
  )

  server.registerTool(
    'update_project',
    {
      title: 'Update a project',
      description: 'Change name, description or brand kit (brand fields merge).',
      inputSchema: {
        project: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        brand: z.record(z.string(), z.unknown()).optional(),
      },
    },
    ({ project, ...patch }) =>
      run(async () => {
        const p = await projectByName(project)
        const saved = await api.patch<Project>(`/api/projects/${p.id}`, patch)
        return `Saved ${saved.name}: ${JSON.stringify(saved.brand)}`
      }),
  )

  server.registerTool(
    'add_source',
    {
      title: 'Connect a media folder',
      description:
        'A folder on this computer whose videos, audio and images join the library (watched for changes, originals untouched). For Google Drive use the Google Drive for Desktop folder (e.g. G:\\My Drive\\…). project null: shared by every project (a music library). role music/sfx for sound libraries.',
      inputSchema: {
        project: z.string().nullable(),
        path: z.string().min(1),
        role: z.enum(['footage', 'music', 'sfx', 'brand']).optional(),
        name: z.string().optional(),
      },
    },
    ({ project, ...rest }) =>
      run(async () => {
        const projectId = project ? (await projectByName(project)).id : null
        const r = await api.post<{ source: Source; added: number }>('/api/sources', {
          projectId,
          ...rest,
        })
        return `Connected ${r.source.path} [${r.source.id}]: ${r.added} files, indexing in the background.`
      }),
  )

  server.registerTool(
    'list_sources',
    {
      title: 'Media folders',
      description: 'Connected folders.',
      inputSchema: { project: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    ({ project }) =>
      run(async () => {
        const projectId = project ? (await projectByName(project)).id : undefined
        const sources = await api.get<Source[]>(`/api/sources${query({ projectId })}`)
        return (
          sources
            .map(
              (s) => `- ${s.name} [${s.id}] ${s.role} ${s.path}${s.projectId ? '' : ' (shared)'}`,
            )
            .join('\n') || 'No folders connected.'
        )
      }),
  )

  server.registerTool(
    'import_file',
    {
      title: 'Import one file',
      description:
        'Adds a single media file from this computer (e.g. a voice recording) to a project.',
      inputSchema: {
        project: z.string().nullable(),
        path: z.string().min(1),
        role: AssetRole.optional(),
      },
    },
    ({ project, path, role }) =>
      run(async () => {
        const projectId = project ? (await projectByName(project)).id : null
        const a = await api.post<Asset>('/api/assets/import', { projectId, path, role })
        return `Imported ${a.name} [${a.id}]; indexing.`
      }),
  )

  server.registerTool(
    'list_assets',
    {
      title: 'List media',
      description:
        'Media of a project (plus shared libraries): id, role/kind, length, size, tags (music has "NNN bpm"). query searches names, notes, tags and what is said.',
      inputSchema: {
        project: z.string().optional(),
        role: AssetRole.optional(),
        query: z.string().optional(),
        status: z.enum(['new', 'indexing', 'ready', 'error']).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ project, role, query: q, status, limit }) =>
      run(async () => {
        const projectId = project ? (await projectByName(project)).id : undefined
        const r = await api.get<{ items: Asset[]; total: number }>(
          `/api/assets${query({ projectId, role, q, status, limit: limit ?? 50 })}`,
        )
        if (!r.items.length) return 'Nothing found.'
        return [`${r.total} item(s)`, ...r.items.map(assetLine)].join('\n')
      }),
  )

  server.registerTool(
    'get_asset',
    {
      title: 'Read a media file',
      description:
        'Everything indexing learned: transcript with times, scenes, candidate moments, contact sheets, beats. from/to (seconds) narrow the transcript of long files.',
      inputSchema: { id: z.string(), from: z.number().optional(), to: z.number().optional() },
      annotations: { readOnlyHint: true },
    },
    ({ id, from, to }) =>
      run(async () => {
        const { asset, analysis } = await api.get<{ asset: Asset; analysis: Analysis }>(
          `/api/assets/${id}`,
        )
        return describeAsset(asset, analysis, { from, to })
      }),
  )

  server.registerTool(
    'view_sheets',
    {
      title: 'Look at contact sheets',
      description:
        'Contact sheets of a video (16 labelled frames each). Look before choosing moments. Up to 4 per call.',
      inputSchema: {
        id: z.string(),
        from: z.number().int().min(0).optional(),
        count: z.number().int().min(1).max(4).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ id, from, count }) =>
      run(async () => {
        const { analysis } = await api.get<{ analysis: Analysis }>(`/api/assets/${id}`)
        const sheets = analysis.sheets.slice(from ?? 0, (from ?? 0) + (count ?? 2))
        if (!sheets.length) return 'No contact sheets (not a video, or not indexed yet).'
        const out: Content[] = []
        for (const s of sheets) {
          out.push({
            type: 'text',
            text: `Sheet #${s.index}: ${t(s.start)}–${t(s.end)}, frames at ${s.times.map(t).join(', ')}`,
          })
          out.push(await image(`/api/assets/${id}/sheets/${s.index}`))
        }
        return out
      }),
  )

  server.registerTool(
    'get_frames',
    {
      title: 'Look at frames',
      description:
        'Frames of a video at given seconds (up to 8), to check a moment closely or find a crop focus.',
      inputSchema: {
        id: z.string(),
        times: z.array(z.number().min(0)).min(1).max(8),
        size: z.number().int().min(256).max(1280).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ id, times, size }) =>
      run(async () => {
        const out: Content[] = []
        for (const time of times) {
          out.push({ type: 'text', text: `At ${t(time)}` })
          out.push(await image(`/api/assets/${id}/frame${query({ t: time, size: size ?? 640 })}`))
        }
        return out
      }),
  )

  server.registerTool(
    'search_media',
    {
      title: 'Find what is said',
      description:
        'Searches transcripts (and names, notes, tags) and returns matching lines with times.',
      inputSchema: { query: z.string().min(1), project: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    ({ query: q, project }) =>
      run(async () => {
        const projectId = project ? (await projectByName(project)).id : undefined
        const r = await api.get<{ items: Asset[] }>(
          `/api/assets${query({ projectId, q, limit: 10 })}`,
        )
        if (!r.items.length) return 'Nothing found.'
        const words = q.toLowerCase().split(/\s+/).filter(Boolean)
        const out: string[] = []
        for (const a of r.items) {
          const { analysis } = await api.get<{ analysis: Analysis }>(`/api/assets/${a.id}`)
          const hits = (analysis.transcript?.segments ?? []).filter((s) =>
            words.some((w) => s.text.toLowerCase().includes(w)),
          )
          out.push(assetLine(a))
          for (const s of hits.slice(0, 8)) out.push(`    [${t(s.start)}–${t(s.end)}] ${s.text}`)
        }
        return out.join('\n')
      }),
  )

  server.registerTool(
    'upscale',
    {
      title: 'Upscale a video or image',
      description:
        'Makes a sharper, bigger copy of a video or image with Real-ESRGAN (a new asset next to the original, tagged "upscaled"). model: "animevideo" (realesr-animevideov3: made for video, fast, best for drawn, game and stylised footage; scale 2, 3 or 4) or "general" (realesrgan-x4plus: camera footage, many times slower — on a weak GPU hours for a whole clip, so use it for short pieces). Pick by what the footage is, and a scale that reaches the composition size (e.g. 540x960 → ×2 for 1080x1920). Waits up to `seconds` (default 60), then returns the job to follow with wait_job. Needs Real-ESRGAN installed in Settings.',
      inputSchema: {
        id: z.string(),
        model: UpscaleModel,
        scale: z.number().int().min(2).max(4),
        seconds: z.number().int().min(0).max(300).optional(),
      },
    },
    ({ id, model, scale, seconds }) =>
      run(async () => {
        const job = await api.post<Job>(`/api/assets/${id}/upscale`, { model, scale })
        const done = await wait(job, seconds ?? 60)
        if (done.status === 'done') {
          const r = done.result as { assetId: string }
          const { asset } = await api.get<{ asset: Asset }>(`/api/assets/${r.assetId}`)
          return `Upscaled: ${assetLine(asset).slice(2)}`
        }
        return `${jobText(done)}
Still working: follow it with wait_job ${done.id}.`
      }),
  )

  server.registerTool(
    'update_asset',
    {
      title: 'Tag or describe media',
      description:
        'Set tags, notes (what is in it, mood, where it fits) or the role of a media file.',
      inputSchema: {
        id: z.string(),
        tags: z.array(z.string()).optional(),
        notes: z.string().optional(),
        role: AssetRole.optional(),
      },
    },
    ({ id, ...patch }) =>
      run(async () => {
        const a = await api.patch<Asset>(`/api/assets/${id}`, patch)
        return `Saved: ${assetLine(a).slice(2)}`
      }),
  )

  server.registerTool(
    'find_music',
    {
      title: 'Find music',
      description:
        'Tracks of the music library (role music) ranked by mood words (matched in tags, notes and names), tempo (half and double time count) and length. Each line gives BPM, key, brightness, busyness and the energy shape over the track; with seconds, where the most energetic stretch of that length starts (on a beat). format: take mood and BPM from a format.',
      inputSchema: {
        project: z.string().optional(),
        mood: z.string().optional(),
        bpm: z.number().positive().optional(),
        seconds: z.number().positive().optional(),
        format: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ project, mood, bpm, seconds, format, limit }) =>
      run(async () => {
        const projectId = project ? (await projectByName(project)).id : undefined
        if (format) {
          const f = await api.get<Format>(`/api/formats/${format}`)
          mood ??= f.recipe.music.mood || undefined
          bpm ??= f.recipe.music.bpm ?? undefined
          seconds ??= f.recipe.duration.max
        }
        const r = await api.get<{ items: Asset[] }>(
          `/api/assets${query({ projectId, role: 'music', limit: 200 })}`,
        )
        if (!r.items.length)
          return 'No music yet. Connect a folder of tracks with add_source (role "music", project null to share it).'
        const words = (mood ?? '')
          .toLowerCase()
          .split(/[\s,]+/)
          .filter((w) => w.length > 2)
        const rows = await Promise.all(
          r.items.map(async (a) => {
            const { analysis } = await api.get<{ analysis: Analysis }>(`/api/assets/${a.id}`)
            const m = analysis.music
            const text = `${a.name} ${a.tags.join(' ')} ${a.notes}`.toLowerCase()
            let score = words.filter((w) => text.includes(w)).length * 2
            const target = bpm
            if (target && m) {
              const off = Math.min(
                ...[m.bpm, m.bpm * 2, m.bpm / 2].map((b) => Math.abs(b - target)),
              )
              score -= off / 10
            }
            if (seconds && a.duration && a.duration < seconds) score -= 3
            return { a, m, score, tagged: a.tags.some((t) => !/^\d+ ?bpm$/i.test(t)) || !!a.notes }
          }),
        )
        rows.sort((x, y) => y.score - x.score)
        const shown = rows.slice(0, limit ?? 15)
        const out = [
          `${rows.length} track(s)${mood ? `, mood "${mood}"` : ''}${bpm ? `, ~${bpm} BPM` : ''}${seconds ? `, ${seconds} s` : ''}:`,
        ]
        for (const { a, m, tagged } of shown) {
          out.push(assetLine(a))
          if (a.notes) out.push(`    notes: ${a.notes}`)
          if (!m) {
            out.push(
              `    ${a.status === 'ready' ? 'not analysed (local beats model off?)' : `${a.status}…`}`,
            )
            continue
          }
          out.push(`    ${musicLine(m)}${tagged ? '' : ' — no mood tags yet'}`)
          if (seconds) {
            const w = bestWindow(m, seconds)
            if (w.energy >= 0)
              out.push(`    best ${seconds} s from ${t(w.in)} (in: ${w.in.toFixed(2)})`)
          }
        }
        const old = rows.filter((x) => x.m && !x.m.curve).length
        if (old)
          out.push(
            `${old} track(s) were analysed before energy and key were measured; reindex them in the app to get those.`,
          )
        return out.join('\n')
      }),
  )

  server.registerTool(
    'search_music_online',
    {
      title: 'Search music online (Openverse)',
      description:
        'Creative Commons music from Openverse (Jamendo, Freesound, ccMixter, Wikimedia…), only licences that allow commercial use and putting it under a video: CC0, public domain and CC BY (credit needed) by default; share_alike adds CC BY-SA (the video would have to be shared under it too, rarely what the user wants). Search in English with genre / mood / instrument words. Bring one in with import_music. Also gives a Pixabay Music search link for the user to open (no API there).',
      inputSchema: {
        query: z.string().min(2),
        share_alike: z.boolean().optional(),
        page: z.number().int().min(1).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ query: q, share_alike, page }) =>
      run(async () => {
        const r = await api.get<{
          total: number
          results: {
            id: string
            title: string
            creator: string
            license: string
            duration: number | null
            source: string
            genres: string[]
            tags: string[]
            landing: string
          }[]
          pixabay: string
        }>(
          `/api/music/openverse${query({ q, license: share_alike ? 'share-alike' : 'credit', page })}`,
        )
        const out = [`${r.total} track(s) on Openverse for "${q}":`]
        for (const x of r.results)
          out.push(
            `- ${x.title}${x.creator ? ` — ${x.creator}` : ''} [${x.id}] ${t(x.duration)} ${x.license} (${x.source})${x.genres.length || x.tags.length ? ` #${[...x.genres, ...x.tags].slice(0, 8).join(' #')}` : ''}`,
          )
        if (!r.results.length) out.push('Nothing; try broader words (genre, mood, instrument).')
        out.push(
          '',
          `Pixabay Music (no API; the user opens it, downloads, then import_file with role "music"; YouTube Content ID may claim some tracks): ${r.pixabay}`,
        )
        return out.join('\n')
      }),
  )

  server.registerTool(
    'import_music',
    {
      title: 'Import a track from Openverse',
      description:
        'Downloads an Openverse track (id from search_music_online) into the shared music library; its beats and mood numbers are analysed like any track. Returns the asset and the credit line to put in the video description for CC BY.',
      inputSchema: { id: z.string(), project: z.string().optional() },
    },
    ({ id, project }) =>
      run(async () => {
        const projectId = project ? (await projectByName(project)).id : null
        const job = await wait(
          await api.post<Job>(`/api/music/openverse/${encodeURIComponent(id)}/import`, {
            projectId,
          }),
          120,
        )
        if (job.status !== 'done') return jobText(job)
        const r = job.result as { assetId: string; attribution: string; existed: boolean }
        const { asset } = await api.get<{ asset: Asset }>(`/api/assets/${r.assetId}`)
        return [
          `${r.existed ? 'Already in the library' : 'Imported'}: ${assetLine(asset).slice(2)}`,
          asset.notes,
          'Beats and mood numbers arrive after analysis (find_music / get_asset).',
        ].join('\n')
      }),
  )

  server.registerTool(
    'generate_music',
    {
      title: 'Generate music (MusicGen, local)',
      description:
        'An instrumental from a text prompt with MusicGen on this computer, 2–30 s. Prompt in English: genre, mood, instruments, tempo ("upbeat synthwave, punchy drums, 120 bpm"). model small is faster (a weak GPU or CPU takes minutes), medium better. The weights are CC BY-NC 4.0: tell the user it is not for monetised videos. Waits up to 5 minutes.',
      inputSchema: {
        prompt: z.string().min(3).max(500),
        seconds: z.number().min(2).max(30).optional(),
        model: z.enum(['small', 'medium']).optional(),
        project: z.string().optional(),
      },
    },
    ({ prompt, seconds, model, project }) =>
      run(async () => {
        const projectId = project ? (await projectByName(project)).id : null
        const job = await wait(
          await api.post<Job>('/api/music/generate', { prompt, seconds, model, projectId }),
          300,
        )
        if (job.status !== 'done') return `${jobText(job)}\nFollow it with wait_job ${job.id}.`
        const { assetId } = job.result as { assetId: string }
        const { asset } = await api.get<{ asset: Asset }>(`/api/assets/${assetId}`)
        return `Generated: ${assetLine(asset).slice(2)}\nNot for monetised videos (MusicGen weights are CC BY-NC).`
      }),
  )

  // References and formats

  server.registerTool(
    'add_reference',
    {
      title: 'Add a reference video',
      description:
        'A YouTube / Instagram / TikTok / X link to take apart. Downloads and indexes it (wait ~1 min, then get_reference).',
      inputSchema: {
        url: z.string().url(),
        project: z.string().optional(),
        tags: z.array(z.string()).optional(),
      },
    },
    ({ url, project, tags }) =>
      run(async () => {
        const projectId = project ? (await projectByName(project)).id : null
        const r = await api.post<Reference>('/api/references', { url, projectId, tags })
        return `Reference [${r.id}] ${r.status}. Use get_reference when it is ready.`
      }),
  )

  server.registerTool(
    'list_references',
    {
      title: 'References',
      description: 'Saved reference videos.',
      inputSchema: { project: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    ({ project }) =>
      run(async () => {
        const projectId = project ? (await projectByName(project)).id : undefined
        const refs = await api.get<Reference[]>(`/api/references${query({ projectId })}`)
        return refs.map(referenceLine).join('\n') || 'No references yet.'
      }),
  )

  server.registerTool(
    'get_reference',
    {
      title: 'Read a reference',
      description:
        'A reference with pacing numbers, transcript, scenes and its saved breakdown. Look at its frames with view_sheets on the asset id.',
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ id }) =>
      run(async () => {
        const { reference: r, asset } = await api.get<{
          reference: Reference
          asset: Asset | null
        }>(`/api/references/${id}`)
        const out = [referenceLine(r).slice(2), r.url]
        if (!asset || r.status !== 'ready') {
          out.push(`Not ready (${r.status}).`)
          return out.join('\n')
        }
        const { analysis } = await api.get<{ analysis: Analysis }>(`/api/assets/${asset.id}`)
        out.push(
          `Video asset: [${asset.id}] (view_sheets / get_frames with this id)`,
          '',
          pacing(asset, analysis),
        )
        if (asset.notes) out.push('', `Caption/description: ${asset.notes}`)
        out.push('', 'Transcript:', ...transcriptLines(analysis))
        if (r.analysis) out.push('', 'Saved breakdown:', r.analysis)
        return out.join('\n')
      }),
  )

  server.registerTool(
    'save_reference_analysis',
    {
      title: 'Save a reference breakdown',
      description:
        'The breakdown of a reference in Markdown: hook, structure with timings, editing rhythm, typography, camera, sound, captions, what makes it work, what we would need to copy the mechanics.',
      inputSchema: {
        id: z.string(),
        analysis: z.string().min(1),
        tags: z.array(z.string()).optional(),
      },
    },
    ({ id, analysis, tags }) =>
      run(async () => {
        await api.patch(`/api/references/${id}`, { analysis, ...(tags ? { tags } : {}) })
        return 'Saved.'
      }),
  )

  const recipeHelp =
    'recipe: { aspect: "9:16"|"1:1"|"4:5"|"16:9", duration: {min, max}, beats: [{name, duration, purpose, visual, text, audio, motion}], pacing: {shot, cutOnBeat}, captions: {style: "bold-pop"|"karaoke"|"minimal", position (0..1 from top), uppercase, maxWords}, music: {mood, bpm, trendingSound}, voice: {provider, voiceId, style, language}, motionEngine: "hyperframes"|"remotion"|null, hooks: [examples], variables: [{name, description}], notes }'

  server.registerTool(
    'list_formats',
    {
      title: 'Formats',
      description: 'Saved video formats (recipes).',
      inputSchema: { project: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    ({ project }) =>
      run(async () => {
        const projectId = project ? (await projectByName(project)).id : undefined
        const formats = await api.get<Format[]>(`/api/formats${query({ projectId })}`)
        return (
          formats
            .map(
              (f) =>
                `- ${f.name} [${f.id}] ${f.recipe.aspect}, ${f.recipe.beats.length} beats — ${f.description}`,
            )
            .join('\n') || 'No formats yet.'
        )
      }),
  )

  server.registerTool(
    'get_format',
    {
      title: 'Read a format',
      description: 'A format with its full recipe.',
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ id }) => run(async () => formatText(await api.get<Format>(`/api/formats/${id}`))),
  )

  server.registerTool(
    'create_format',
    {
      title: 'Create a format',
      description: `Saves a reusable video format. ${recipeHelp}`,
      inputSchema: {
        name: z.string().min(1),
        description: z.string().optional(),
        project: z.string().optional(),
        recipe: z.record(z.string(), z.unknown()).optional(),
        referenceIds: z.array(z.string()).optional(),
      },
    },
    ({ project, ...rest }) =>
      run(async () => {
        const projectId = project ? (await projectByName(project)).id : null
        const f = await api.post<Format>('/api/formats', { ...rest, projectId })
        return `Created:\n${formatText(f)}`
      }),
  )

  server.registerTool(
    'update_format',
    {
      title: 'Update a format',
      description: `Changes a format; recipe fields merge one level deep (send only what changes, arrays replace). ${recipeHelp}`,
      inputSchema: {
        id: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        recipe: z.record(z.string(), z.unknown()).optional(),
        referenceIds: z.array(z.string()).optional(),
      },
    },
    ({ id, ...patch }) =>
      run(
        async () => `Saved:\n${formatText(await api.patch<Format>(`/api/formats/${id}`, patch))}`,
      ),
  )

  // Voice

  server.registerTool(
    'voice_status',
    {
      title: 'Voice engines and voices',
      description: 'Which speech engines can run now, and the saved voices.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () =>
      run(async () => {
        const providers =
          await api.get<
            {
              id: string
              label: string
              available: boolean
              detail: string
              clones: boolean
              languages: string
            }[]
          >('/api/voice-providers')
        const voices = await api.get<Voice[]>('/api/voices')
        return [
          'Engines:',
          ...providers.map(
            (p) =>
              `- ${p.id}: ${p.available ? 'ready' : 'unavailable'} — ${p.detail}; ${p.languages}${p.clones ? '; clones voices' : ''}`,
          ),
          '',
          'Voices:',
          ...(voices.length
            ? voices.map((v) => `- ${v.name} [${v.id}] ${v.provider} ${v.language}`)
            : ['none yet']),
        ].join('\n')
      }),
  )

  server.registerTool(
    'create_voice',
    {
      title: 'Clone a voice',
      description:
        'Makes a voice from a clean recording (30 s–3 min of one person speaking, no music). Give a file path or an asset id. Only the user\'s own voice or one they have permission for. preset: a built-in voice name instead (e.g. Kokoro "am_michael").',
      inputSchema: {
        name: z.string().min(1),
        provider: VoiceProviderId,
        samplePath: z.string().optional(),
        sampleAssetId: z.string().optional(),
        sampleText: z.string().optional(),
        language: z.string().optional(),
        preset: z.string().optional(),
      },
    },
    (input) =>
      run(async () => {
        const res = await api.post<Job | Voice>('/api/voices', input)
        if ('provider' in res) return `Voice ${res.name} [${res.id}] saved.`
        return jobText(await wait(res, 120))
      }),
  )

  server.registerTool(
    'speak',
    {
      title: 'Generate a voiceover',
      description:
        'Speaks text into a new voice asset of the project (then transcribed for captions). provider: fish-api | fish-local | kokoro | chatterbox (default from settings). Fish S2 understands [bracket] cues like [excited], [whispers], [laughs]. language: ru, en, es…',
      inputSchema: {
        project: z.string(),
        text: z.string().min(1).max(5000),
        provider: VoiceProviderId.optional(),
        voiceId: z.string().optional(),
        language: z.string().optional(),
        speed: z.number().min(0.5).max(2).optional(),
        preset: z.string().optional(),
        name: z.string().optional(),
      },
    },
    ({ project, ...input }) =>
      run(async () => {
        const p = await projectByName(project)
        const job = await wait(await api.post<Job>('/api/tts', { ...input, projectId: p.id }), 180)
        if (job.status !== 'done') return jobText(job)
        const { assetId } = job.result as { assetId: string }
        const { asset } = await api.get<{ asset: Asset }>(`/api/assets/${assetId}`)
        return `Voice asset [${assetId}] ${t(asset.duration)} long; word timings arrive after transcription (seconds). Place it with edit_composition (type "audio").`
      }),
  )

  // Motion

  server.registerTool(
    'list_motion_templates',
    {
      title: 'Motion templates',
      description:
        'Templates of both engines with their variables. overlay templates render with transparency over the video.',
      inputSchema: { engine: MotionEngine.optional() },
      annotations: { readOnlyHint: true },
    },
    ({ engine }) =>
      run(async () => {
        const list = await api.get<
          {
            engine: string
            name: string
            description: string
            duration: number
            overlay: boolean
            variables: { name: string; type: string; default: unknown }[]
          }[]
        >(`/api/motion/templates${query({ engine })}`)
        return list
          .map(
            (m) =>
              `- ${m.engine}/${m.name}${m.overlay ? ' (overlay)' : ''} ${m.duration}s — ${m.description}\n    vars: ${m.variables.map((v) => `${v.name}:${v.type}=${JSON.stringify(v.default)}`).join(', ')}`,
          )
          .join('\n')
      }),
  )

  server.registerTool(
    'get_motion_template',
    {
      title: 'Read a motion template',
      description: 'Source files of a template, to copy or change it.',
      inputSchema: { engine: MotionEngine, name: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ engine, name }) =>
      run(async () => {
        const r = await api.get<{ files: Record<string, string> }>(
          `/api/motion/templates/${engine}/${name}`,
        )
        return Object.entries(r.files)
          .map(([f, c]) => `--- ${f}\n${c}`)
          .join('\n\n')
      }),
  )

  server.registerTool(
    'save_motion_template',
    {
      title: 'Write a motion template',
      description:
        'Creates or replaces a template. HyperFrames: files must include index.html, a HyperFrames composition (root data-composition-id="main", data-width/height/duration, variables declared in data-composition-variables on <html>, bound with data-var-text / var(--name), a paused GSAP timeline in window.__timelines["main"]). Remotion: files must include index.tsx exporting default a React component taking the variables as props (use useCurrentFrame/useVideoConfig; size from useVideoConfig). Copy a starter with get_motion_template first.',
      inputSchema: {
        engine: MotionEngine,
        name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
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
      },
    },
    ({ engine, name, ...body }) =>
      run(async () => {
        await api.put(`/api/motion/templates/${engine}/${name}`, body)
        return `Saved ${engine}/${name}. Put it in a composition as a motion item; it renders with the composition (or render_motion_item to check it alone).`
      }),
  )

  // Compositions

  server.registerTool(
    'list_compositions',
    {
      title: 'Videos in progress',
      description: 'Compositions of a project.',
      inputSchema: { project: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ project }) =>
      run(async () => {
        const p = await projectByName(project)
        const list = await api.get<Composition[]>(`/api/compositions${query({ projectId: p.id })}`)
        return (
          list
            .map((c) => `- ${c.name} [${c.id}] v${c.version} ${c.width}x${c.height}`)
            .join('\n') || 'None yet.'
        )
      }),
  )

  server.registerTool(
    'create_composition',
    {
      title: 'Start a video',
      description:
        'A new empty composition with tracks V2, V1, A1, A2, sized by aspect or by the format.',
      inputSchema: {
        project: z.string(),
        name: z.string().min(1),
        aspect: Aspect.optional(),
        formatId: z.string().optional(),
      },
    },
    ({ project, ...rest }) =>
      run(async () => {
        const p = await projectByName(project)
        const c = await api.post<Composition>('/api/compositions', { ...rest, projectId: p.id })
        return compositionText(c, new Map())
      }),
  )

  server.registerTool(
    'get_composition',
    {
      title: 'Read a video edit',
      description: 'Tracks and items with ids, times and settings.',
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ id }) =>
      run(async () => {
        const c = await api.get<Composition>(`/api/compositions/${id}`)
        return await editText(c)
      }),
  )

  server.registerTool(
    'edit_composition',
    {
      title: 'Edit a video',
      description: `Applies ops in order, all or nothing. Times in seconds.
Tracks are listed top to bottom: visual tracks V3, V2, V1 (V1 is the main one; higher tracks draw over lower ones; text and captions sit on visual tracks too), then audio tracks A1, A2… (A1 voice, A2 music by default). Items on one track should not overlap unless the user wants a layer over another: put overlays on a higher track instead.
Ops: add {item, trackId?, level?} (without trackId: level 0 = V1/A1, 1 = V2/A2…; it goes on the first free track from that level outward, new tracks appear as needed; no start = after the last item of that track), update {id, patch}, remove {id, ripple?}, move {id, start?, trackId?}, split {id, at}, reorder {id, index}, closeGaps {trackId}, cutToBeats {trackId, every?} (re-times the shots of a visual track back to back so every cut lands on a beat of the music on the audio tracks, keeping the pacing as near as it can; every: 1 each beat, 2 every other, 4 every bar), addTrack {kind: "visual"|"audio"} (visual on top, audio at the bottom), removeTrack {trackId}, track {trackId, patch: {name, muted, hidden}}, set {patch: {name, background, width, height, fps}}.
Items:
- clip {type:"clip", assetId, in, out, start?, speed=1, volume=1, fit:"cover"|"contain", focus:{x,y} (0..1 crop centre), zoom>=1, fadeIn, fadeOut}
- audio {type:"audio", assetId, in, out, start?, volume=1, duck (lower under the voice), fadeIn, fadeOut}
- text {type:"text", start, duration, text, style:{preset, font, size (px at full size), weight, color, background|null, stroke|null, x, y (0..1), align, uppercase}, fadeIn, fadeOut}
- captions: use add_captions
- motion {type:"motion", start, duration, engine:"hyperframes"|"remotion", template, props:{…template variables}, overlay}
Pass version (from get_composition) to avoid overwriting the user's edits made meanwhile.`,
      inputSchema: {
        id: z.string(),
        ops: z.array(CompositionOp).min(1),
        version: z.number().int().optional(),
      },
    },
    ({ id, ops, version }) =>
      run(async () => {
        const r = await api.post<{ composition: Composition; created: string[] }>(
          `/api/compositions/${id}/ops`,
          { ops, version },
        )
        return `${r.created.length ? `Created ids: ${r.created.join(', ')}\n` : ''}${await editText(r.composition)}`
      }),
  )

  for (const direction of ['undo', 'redo'] as const) {
    server.registerTool(
      `${direction}_composition`,
      {
        title: direction === 'undo' ? 'Undo the last edit' : 'Redo an undone edit',
        description:
          direction === 'undo'
            ? "Takes back the last edit of a video (yours or the user's in the editor). Repeat to go further back."
            : 'Brings back an edit undone with undo_composition.',
        inputSchema: { id: z.string() },
      },
      ({ id }) =>
        run(async () => {
          const c = await api.post<Composition>(`/api/compositions/${id}/${direction}`)
          return await editText(c)
        }),
    )
  }

  server.registerTool(
    'add_captions',
    {
      title: 'Caption the video',
      description:
        'Captions from what is said (voice track first, else the clips). Replaces earlier captions. Style defaults come from the format.',
      inputSchema: {
        id: z.string(),
        style: CaptionStyle.partial().optional(),
        source: z.enum(['auto', 'voice', 'clips']).optional(),
      },
    },
    ({ id, style, source }) =>
      run(async () => {
        const r = await api.post<{ composition: Composition }>(`/api/compositions/${id}/captions`, {
          style,
          source,
        })
        return editText(r.composition)
      }),
  )

  server.registerTool(
    'render_motion_item',
    {
      title: 'Render one motion item',
      description: 'Renders a motion item alone (to check it). Waits up to 3 minutes.',
      inputSchema: { composition: z.string(), item: z.string() },
    },
    ({ composition, item }) =>
      run(async () =>
        jobText(
          await wait(await api.post<Job>(`/api/compositions/${composition}/motion/${item}`), 180),
        ),
      ),
  )

  server.registerTool(
    'render',
    {
      title: 'Render the video',
      description:
        'Renders to MP4 (draft: half size, fast). Waits up to 4 minutes; returns the file path and asset id.',
      inputSchema: { id: z.string(), draft: z.boolean().optional() },
    },
    ({ id, draft }) =>
      run(async () =>
        jobText(await wait(await api.post<Job>(`/api/compositions/${id}/render`, { draft }), 240)),
      ),
  )

  server.registerTool(
    'wait_job',
    {
      title: 'Wait for a job',
      description: 'Waits up to `seconds` (default 60) for a background job and says how it ended.',
      inputSchema: { id: z.string(), seconds: z.number().int().min(1).max(300).optional() },
      annotations: { readOnlyHint: true },
    },
    ({ id, seconds }) =>
      run(async () => jobText(await wait(await api.get<Job>(`/api/jobs/${id}`), seconds ?? 60))),
  )

  server.registerTool(
    'list_jobs',
    {
      title: 'Background jobs',
      description: 'Running and recent jobs.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () =>
      run(async () => {
        const jobs = await api.get<Job[]>('/api/jobs?limit=15')
        return (
          jobs
            .map(
              (j) =>
                `- ${j.kind} [${j.id}] ${j.status} ${Math.round(j.progress * 100)}% ${j.message}${j.error ? ` — ${j.error.split('\n')[0]}` : ''}`,
            )
            .join('\n') || 'No jobs.'
        )
      }),
  )

  return server
}
