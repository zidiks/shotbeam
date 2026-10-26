import {
  type Analysis,
  type Asset,
  type Composition,
  compositionDuration,
  type Format,
  type Item,
  itemEnd,
  type Reference,
  trackLabel,
} from '@shotbeam/core'

/* Plain-text renderings of engine objects: what Claude reads back from the tools. */

export function t(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return '?'
  const m = Math.floor(s / 60)
  const sec = s - m * 60
  return `${m}:${sec.toFixed(1).padStart(4, '0')}`
}

export function assetLine(a: Asset): string {
  const size = a.width && a.height ? ` ${a.width}x${a.height}` : ''
  const dur = a.duration ? ` ${t(a.duration)}` : ''
  const tags = a.tags.length ? ` #${a.tags.join(' #')}` : ''
  const status =
    a.status === 'ready' ? '' : ` (${a.status}${a.error ? `: ${a.error.split('\n')[0]}` : ''})`
  return `- ${a.name} [${a.id}] ${a.role}/${a.kind}${dur}${size}${tags}${status}`
}

export function transcriptLines(
  analysis: Analysis,
  from = 0,
  to = Number.POSITIVE_INFINITY,
  max = 400,
) {
  const segs = (analysis.transcript?.segments ?? []).filter((s) => s.end > from && s.start < to)
  const lines = segs.slice(0, max).map((s) => `[${t(s.start)}–${t(s.end)}] ${s.text}`)
  if (segs.length > max) lines.push(`… ${segs.length - max} more segments (ask with from/to)`)
  return lines
}

export function describeAsset(
  a: Asset,
  an: Analysis,
  opts: { from?: number; to?: number } = {},
): string {
  const out: string[] = [assetLine(a).slice(2), `Path: ${a.path}`]
  if (a.notes) out.push(`Notes: ${a.notes}`)
  if (an.transcript) {
    out.push(
      '',
      `Transcript (${an.transcript.language}):`,
      ...transcriptLines(an, opts.from, opts.to),
    )
  } else if (a.hasAudio && a.kind !== 'image') {
    out.push(
      '',
      a.status === 'ready'
        ? 'No transcript (no speech found or local models not set up).'
        : 'Transcript: not ready yet.',
    )
  }
  if (an.scenes.length > 1) {
    out.push(
      '',
      `Scenes (${an.scenes.length}): ${an.scenes.map((s) => `${t(s.start)}–${t(s.end)}`).join(', ')}`,
    )
  }
  if (an.moments.length) {
    out.push('', 'Candidate moments (heuristic hints, check the frames):')
    for (const m of an.moments) {
      out.push(
        `- ${t(m.start)}–${t(m.end)} score ${m.score} (${m.reasons.join(', ')})${m.text ? `: "${m.text.slice(0, 160)}"` : ''}`,
      )
    }
  }
  if (an.sheets.length) {
    out.push(
      '',
      `Contact sheets (view_sheets): ${an.sheets.map((s) => `#${s.index} ${t(s.start)}–${t(s.end)}`).join(', ')}; each is ${an.sheets[0]?.cols}x${an.sheets[0]?.rows} frames ${
        (an.sheets[0]?.times[1] ?? 1) - (an.sheets[0]?.times[0] ?? 0)
      }s apart.`,
    )
  }
  if (an.music) {
    out.push(
      '',
      `Music: ${an.music.bpm} BPM, ${an.music.beats.length} beats; first: ${an.music.beats
        .slice(0, 16)
        .map((b) => b.toFixed(2))
        .join(', ')}`,
    )
  }
  return out.join('\n')
}

/** Numbers about how a reference is cut, for taking its format apart. */
export function pacing(a: Asset, an: Analysis): string {
  const d = a.duration ?? 0
  const shots = Math.max(1, an.scenes.length)
  const words = an.transcript?.segments.flatMap((s) => s.words) ?? []
  const first = words[0]
  const last = words[words.length - 1]
  const speech = first && last ? last.end - first.start : 0
  const hook = words
    .filter((w) => w.start < 3)
    .map((w) => w.text)
    .join(' ')
  const loud = an.loudness.filter((v) => v > -60)
  return [
    `Length ${t(d)}, ${shots} shots, average shot ${(d / shots).toFixed(2)} s, ${((shots - 1) / Math.max(1, d / 10)).toFixed(1)} cuts per 10 s.`,
    words.length
      ? `Speech: ${words.length} words, ${(words.length / Math.max(1, speech)).toFixed(2)} words/s; first 3 s: "${hook}"`
      : 'No speech.',
    loud.length
      ? `Loudness ${Math.min(...loud).toFixed(0)}…${Math.max(...loud).toFixed(0)} LUFS.`
      : '',
    `Shot lengths: ${an.scenes.map((s) => (s.end - s.start).toFixed(1)).join(', ')}`,
  ]
    .filter(Boolean)
    .join('\n')
}

export function referenceLine(r: Reference): string {
  const status =
    r.status === 'ready' ? '' : ` (${r.status}${r.error ? `: ${r.error.split('\n')[0]}` : ''})`
  return `- ${r.title || r.url} [${r.id}] ${r.platform}${r.author ? ` by ${r.author}` : ''}${r.analysis ? ' — analysed' : ''}${status}`
}

export function formatText(f: Format): string {
  return [
    `${f.name} [${f.id}]${f.projectId ? '' : ' (all projects)'}`,
    f.description,
    '',
    'Recipe:',
    JSON.stringify(f.recipe, null, 2),
  ].join('\n')
}

function itemLine(i: Item, names: Map<string, string>): string {
  const span = `${t(i.start)}–${t(itemEnd(i))}`
  switch (i.type) {
    case 'clip':
      return `  ${span} clip [${i.id}] ${names.get(i.assetId) ?? i.assetId} src ${t(i.in)}–${t(i.out)}${i.speed !== 1 ? ` x${i.speed}` : ''}${i.zoom !== 1 ? ` zoom ${i.zoom}` : ''} focus ${i.focus.x},${i.focus.y}${i.volume !== 1 ? ` vol ${i.volume}` : ''}`
    case 'audio':
      return `  ${span} audio [${i.id}] ${names.get(i.assetId) ?? i.assetId} src ${t(i.in)}–${t(i.out)} vol ${i.volume}${i.duck ? ' ducked' : ''}`
    case 'text':
      return `  ${span} text [${i.id}] "${i.text}" (${i.style.preset}, y ${i.style.y})`
    case 'captions':
      return `  ${span} captions [${i.id}] ${i.words.length} words, ${i.style.preset}`
    case 'motion':
      return `  ${span} motion [${i.id}] ${i.engine}/${i.template} ${JSON.stringify(i.props)}${i.renderedAssetId ? '' : ' (not rendered yet)'}`
  }
}

export function compositionText(c: Composition, names: Map<string, string>): string {
  const out = [
    `${c.name} [${c.id}] v${c.version}: ${c.width}x${c.height} ${c.fps} fps, ${t(compositionDuration(c))} long${c.formatId ? `, format ${c.formatId}` : ''}`,
  ]
  for (const tr of c.tracks) {
    out.push(
      `${trackLabel(c, tr.id)} ${tr.kind} track [${tr.id}]${tr.muted ? ' muted' : ''}${tr.hidden ? ' hidden' : ''}`,
    )
    for (const i of tr.items) out.push(itemLine(i, names))
  }
  return out.join('\n')
}
