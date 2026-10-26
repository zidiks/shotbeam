import { writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  type Asset,
  type AudioItem,
  type ClipItem,
  type Composition,
  compositionDuration,
  itemEnd,
  type MotionItem,
} from '@shotbeam/core'
import { encoderArgs, ffmpeg } from '../media/ffmpeg'
import { buildAss } from './ass'

/*
 * A composition to an MP4 in one ffmpeg run:
 *   canvas (background colour) ← video clips and motion renders overlaid in track order
 *   ← text and captions (ASS, on top) ; audio of clips and audio items mixed, music ducked
 *   under the voice when asked.
 * Draft renders use the proxies at half size and encode fast.
 */

export interface RenderInput {
  composition: Composition
  assets: Map<string, Asset>
  /** The file to read for an asset: the original, or its proxy for drafts. */
  source: (asset: Asset, draft: boolean) => string
  fonts: { dir: string; resolve: (family: string) => string }
  encoder: 'auto' | 'nvenc' | 'cpu'
  draft: boolean
  out: string
  workDir: string
  signal?: AbortSignal
  onProgress?: (f: number) => void
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
const f3 = (n: number) => n.toFixed(3)

/** atempo takes 0.5–2; chain it for speeds outside that. */
function atempo(speed: number): string[] {
  const out: string[] = []
  let s = speed
  while (s > 2) {
    out.push('atempo=2')
    s /= 2
  }
  while (s < 0.5) {
    out.push('atempo=0.5')
    s /= 0.5
  }
  if (Math.abs(s - 1) > 1e-3) out.push(`atempo=${s.toFixed(4)}`)
  return out
}

export async function renderComposition(r: RenderInput) {
  const c = r.composition
  const scale = r.draft ? 0.5 : 1
  const W = even(c.width * scale)
  const H = even(c.height * scale)
  const fps = c.fps
  const duration = compositionDuration(c)
  if (duration <= 0) throw new Error('The composition is empty')

  const inputs: string[] = []
  const filters: string[] = []
  let inputCount = 0
  const addInput = (args: string[]) => {
    inputs.push(...args)
    return inputCount++
  }

  // Canvas.
  filters.push(
    `color=c=${c.background.replace('#', '0x')}:s=${W}x${H}:r=${fps}:d=${f3(duration)}[base0]`,
  )
  let base = 'base0'
  let layer = 0
  const voiceAudio: string[] = []
  const otherAudio: string[] = []
  const duckedAudio: string[] = []

  const visual = (
    item: ClipItem | MotionItem,
    asset: Asset,
    overlayFullFrame: boolean,
    muted: boolean,
  ) => {
    const isClip = item.type === 'clip'
    const inPoint = isClip ? item.in : 0
    const span = isClip ? item.out - item.in : item.duration
    const speed = isClip ? item.speed : 1
    const still = asset.kind === 'image'
    // Motion renders keep their alpha: always the original file, read with the decoder that
    // keeps VP9 transparency.
    const file = r.source(asset, r.draft && isClip)
    const alpha = /\.webm$/i.test(file) ? ['-c:v', 'libvpx-vp9'] : []
    const idx = still
      ? addInput(['-loop', '1', '-framerate', String(fps), '-t', f3(span / speed), '-i', file])
      : addInput(['-ss', f3(inPoint), '-t', f3(span), ...alpha, '-i', file])
    const sw = asset.width ?? W
    const sh = asset.height ?? H
    const fit = isClip ? item.fit : overlayFullFrame ? 'contain' : 'cover'
    const zoom = isClip ? item.zoom : 1
    const k = (fit === 'cover' ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh)) * zoom
    const tw = even(sw * k)
    const th = even(sh * k)
    const cw = Math.min(W, tw)
    const ch = Math.min(H, th)
    const focus = isClip ? item.focus : { x: 0.5, y: 0.5 }
    const cx = Math.round(Math.min(Math.max(focus.x * tw - cw / 2, 0), tw - cw))
    const cy = Math.round(Math.min(Math.max(focus.y * th - ch / 2, 0), th - ch))
    const start = item.start
    const end = itemEnd(item)
    const chain = [
      `setpts=(PTS-STARTPTS)/${speed}`,
      `fps=${fps}`,
      `scale=${tw}:${th}:flags=lanczos`,
      `crop=${cw}:${ch}:${cx}:${cy}`,
      'format=yuva420p',
    ]
    const fadeIn = isClip ? item.fadeIn : 0
    const fadeOut = isClip ? item.fadeOut : 0
    if (fadeIn > 0) chain.push(`fade=t=in:st=0:d=${f3(fadeIn)}:alpha=1`)
    if (fadeOut > 0)
      chain.push(`fade=t=out:st=${f3(Math.max(0, end - start - fadeOut))}:d=${f3(fadeOut)}:alpha=1`)
    chain.push(`setpts=PTS+${f3(start)}/TB`)
    const v = `v${layer}`
    filters.push(`[${idx}:v]${chain.join(',')}[${v}]`)
    const next = `base${++layer}`
    filters.push(
      `[${base}][${v}]overlay=x=${Math.round((W - cw) / 2)}:y=${Math.round((H - ch) / 2)}:eof_action=pass:repeatlast=0:enable='between(t,${f3(start)},${f3(end)})'[${next}]`,
    )
    base = next

    if (isClip && !muted && asset.hasAudio && item.volume > 0 && !still) {
      const a = `a${idx}`
      const achain = ['asetpts=PTS-STARTPTS', ...atempo(speed), `volume=${item.volume}`]
      if (fadeIn > 0) achain.push(`afade=t=in:st=0:d=${f3(fadeIn)}`)
      if (fadeOut > 0)
        achain.push(`afade=t=out:st=${f3(Math.max(0, end - start - fadeOut))}:d=${f3(fadeOut)}`)
      achain.push(`adelay=${Math.round(start * 1000)}:all=1`)
      filters.push(`[${idx}:a]${achain.join(',')}[${a}]`)
      ;(asset.role === 'voice' ? voiceAudio : otherAudio).push(a)
    }
  }

  const audio = (item: AudioItem, asset: Asset) => {
    const idx = addInput([
      '-ss',
      f3(item.in),
      '-t',
      f3(item.out - item.in),
      '-i',
      r.source(asset, false),
    ])
    const a = `a${idx}`
    const len = item.out - item.in
    const achain = ['asetpts=PTS-STARTPTS', `volume=${item.volume}`]
    if (item.fadeIn > 0) achain.push(`afade=t=in:st=0:d=${f3(item.fadeIn)}`)
    if (item.fadeOut > 0)
      achain.push(`afade=t=out:st=${f3(Math.max(0, len - item.fadeOut))}:d=${f3(item.fadeOut)}`)
    achain.push(`adelay=${Math.round(item.start * 1000)}:all=1`)
    filters.push(`[${idx}:a]${achain.join(',')}[${a}]`)
    if (item.duck) duckedAudio.push(a)
    else if (asset.role === 'voice') voiceAudio.push(a)
    else otherAudio.push(a)
  }

  // Relative names: ffmpeg runs in workDir, so no Windows drive letters to escape when the fonts
  // are on the same drive.
  let fontsdir = relative(r.workDir, r.fonts.dir).replace(/\\/g, '/')
  if (/^[a-z]:/i.test(fontsdir)) fontsdir = fontsdir.replace(/:/g, '\\:')

  // Visual tracks from the bottom one up; on a track, later items over earlier ones, then the
  // track's text and captions, so a higher track covers lower text too.
  const visualTracks = c.tracks.filter((t) => t.kind === 'visual' && !t.hidden).reverse()
  visualTracks.forEach((track, n) => {
    const items = [...track.items].sort((a, b) => a.start - b.start)
    for (const item of items) {
      if (item.type === 'clip') {
        const asset = r.assets.get(item.assetId)
        if (!asset) throw new Error(`Missing asset ${item.assetId}`)
        visual(item, asset, false, track.muted)
      } else if (item.type === 'motion') {
        if (!item.renderedAssetId)
          throw new Error(`Motion item "${item.template}" is not rendered yet`)
        const asset = r.assets.get(item.renderedAssetId)
        if (!asset) throw new Error(`Missing motion render ${item.renderedAssetId}`)
        visual(item, asset, item.overlay, true)
      }
    }
    const ass = buildAss(c, items, r.fonts.resolve, scale)
    if (ass) {
      const file = `text-${n + 1}.ass`
      writeFileSync(join(r.workDir, file), ass, 'utf8')
      const next = `base${++layer}`
      filters.push(`[${base}]ass=filename=${file}:fontsdir='${fontsdir}'[${next}]`)
      base = next
    }
  })
  for (const track of c.tracks) {
    if (track.kind !== 'audio' || track.muted) continue
    for (const item of track.items) {
      if (item.type !== 'audio') continue
      const asset = r.assets.get(item.assetId)
      if (!asset) throw new Error(`Missing asset ${item.assetId}`)
      audio(item, asset)
    }
  }
  filters.push(`[${base}]format=yuv420p[vout]`)

  // Audio mix.
  const mix = (labels: string[], out: string) => {
    if (labels.length === 1) filters.push(`[${labels[0]}]anull[${out}]`)
    else
      filters.push(
        `${labels.map((l) => `[${l}]`).join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0[${out}]`,
      )
  }
  const finals: string[] = []
  if (voiceAudio.length) {
    mix(voiceAudio, 'voice')
    if (duckedAudio.length) {
      filters.push('[voice]asplit=2[voice1][voicekey]')
      mix(duckedAudio, 'music')
      filters.push(
        '[music][voicekey]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[ducked]',
      )
      finals.push('voice1', 'ducked')
    } else finals.push('voice')
  } else if (duckedAudio.length) {
    mix(duckedAudio, 'music')
    finals.push('music')
  }
  if (otherAudio.length) {
    mix(otherAudio, 'other')
    finals.push('other')
  }
  let audioMap: string[] = []
  if (finals.length) {
    mix(finals, 'amixed')
    // Reels/Shorts play around -14 LUFS; normalise there so every video lands at the same level.
    filters.push(
      `[amixed]apad,atrim=0:${f3(duration)},loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]`,
    )
    audioMap = ['-map', '[aout]', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000']
  }

  const graph = join(r.workDir, 'graph.txt')
  writeFileSync(graph, filters.join(';\n'), 'utf8')
  await ffmpeg(
    [
      ...inputs,
      '-/filter_complex',
      graph,
      '-map',
      '[vout]',
      ...audioMap,
      ...(await encoderArgs(r.encoder, r.draft ? 'proxy' : 'final')),
      '-r',
      String(fps),
      '-t',
      f3(duration),
      '-movflags',
      '+faststart',
      r.out,
    ],
    { cwd: r.workDir, duration, onProgress: r.onProgress, signal: r.signal },
  )
  return { duration, width: W, height: H }
}
