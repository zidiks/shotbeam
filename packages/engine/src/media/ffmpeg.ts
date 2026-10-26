import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ContactSheet } from '@shotbeam/core'
import { type RunOptions, run } from './run'

/*
 * Everything the engine asks of ffmpeg/ffprobe (on PATH, or FFMPEG_PATH / FFPROBE_PATH).
 * Filter expressions are passed as single arguments, never through a shell.
 */

export const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'
export const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe'

export interface Probe {
  duration: number | null
  width: number | null
  height: number | null
  fps: number | null
  hasVideo: boolean
  hasAudio: boolean
  /** A still picture (an image file, or a video stream that is a cover image). */
  still: boolean
  rotation: number
}

interface FfprobeStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  avg_frame_rate?: string
  r_frame_rate?: string
  duration?: string
  nb_frames?: string
  disposition?: { attached_pic?: number }
  side_data_list?: { rotation?: number }[]
  tags?: { rotate?: string }
}

function rate(r?: string): number | null {
  if (!r) return null
  const [n, d] = r.split('/').map(Number)
  if (!n || !d) return null
  const v = n / d
  return Number.isFinite(v) && v > 0 && v < 1000 ? Math.round(v * 1000) / 1000 : null
}

export async function probe(path: string, signal?: AbortSignal): Promise<Probe> {
  const { stdout } = await run(
    FFPROBE,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
    { signal },
  )
  const data = JSON.parse(stdout) as { streams?: FfprobeStream[]; format?: { duration?: string } }
  const streams = data.streams ?? []
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
  const cover = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic)
  const audio = streams.find((s) => s.codec_type === 'audio')
  const duration = Number(data.format?.duration ?? video?.duration ?? audio?.duration)
  const imageCodec = /^(png|mjpeg|webp|bmp|tiff|gif)$/.test(video?.codec_name ?? '')
  const still =
    !!video && imageCodec && (!Number.isFinite(duration) || Number(video.nb_frames ?? 1) <= 1)
  const rotation = Number(
    video?.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ??
      video?.tags?.rotate ??
      0,
  )
  let width = video?.width ?? cover?.width ?? null
  let height = video?.height ?? cover?.height ?? null
  if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width]
  return {
    duration: Number.isFinite(duration) && duration > 0 && !still ? duration : null,
    width,
    height,
    fps: video && !still ? (rate(video.avg_frame_rate) ?? rate(video.r_frame_rate)) : null,
    hasVideo: !!video && !still,
    hasAudio: !!audio,
    still,
    rotation,
  }
}

/** Runs ffmpeg, reporting progress from `-progress` against a known duration. */
export async function ffmpeg(
  args: string[],
  opts: RunOptions & { duration?: number | null; onProgress?: (fraction: number) => void } = {},
) {
  const { duration, onProgress, ...rest } = opts
  const progressArgs = onProgress && duration ? ['-progress', 'pipe:1', '-nostats'] : []
  return run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...progressArgs, ...args], {
    ...rest,
    onStdoutLine: (line) => {
      rest.onStdoutLine?.(line)
      if (!onProgress || !duration) return
      const m = /^out_time_us=(\d+)/.exec(line)
      if (m) onProgress(Math.min(1, Number(m[1]) / 1e6 / duration))
    },
  })
}

export type Encoder = 'nvenc' | 'cpu'
let encoderCheck: Promise<Encoder> | null = null

/**
 * NVENC when it actually opens (an old driver lists it but fails), else libx264.
 * Checked once per run.
 */
export function detectEncoder(): Promise<Encoder> {
  encoderCheck ??= ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=256x256:rate=30:duration=0.2',
    '-c:v',
    'h264_nvenc',
    '-f',
    'null',
    '-',
  ])
    .then(() => 'nvenc' as const)
    .catch(() => 'cpu' as const)
  return encoderCheck
}

export async function encoderArgs(
  want: 'auto' | 'nvenc' | 'cpu',
  quality: 'proxy' | 'final',
): Promise<string[]> {
  const enc = want === 'auto' ? await detectEncoder() : want
  if (enc === 'nvenc') {
    return [
      '-c:v',
      'h264_nvenc',
      '-preset',
      'p5',
      '-rc',
      'vbr',
      '-cq',
      quality === 'proxy' ? '30' : '20',
      '-b:v',
      '0',
    ]
  }
  return [
    '-c:v',
    'libx264',
    '-preset',
    quality === 'proxy' ? 'veryfast' : 'medium',
    '-crf',
    quality === 'proxy' ? '27' : '19',
  ]
}

/** Short side to `size`, keeping the aspect, even sizes, never upscaling. */
function shortSide(size: number) {
  return `scale='if(gt(iw,ih),-2,trunc(min(${size},iw)/2)*2)':'if(gt(iw,ih),trunc(min(${size},ih)/2)*2,-2)'`
}

/** Fits inside a `size` square, keeping the aspect. */
function fitBox(size: number) {
  return `scale='if(gt(iw,ih),${size},-2)':'if(gt(iw,ih),-2,${size})'`
}

export async function thumbnail(input: string, out: string, at: number, still: boolean) {
  const seek = still ? [] : ['-ss', at.toFixed(3)]
  await ffmpeg([...seek, '-i', input, '-frames:v', '1', '-vf', fitBox(480), '-q:v', '4', out])
}

/**
 * A light copy for previews and analysis: 540p short side, a keyframe every second (smooth
 * seeking in the editor), AAC audio.
 */
export async function makeProxy(
  input: string,
  out: string,
  opts: {
    duration: number | null
    hasAudio: boolean
    encoder: 'auto' | 'nvenc' | 'cpu'
    signal?: AbortSignal
    onProgress?: (f: number) => void
  },
) {
  const audio = opts.hasAudio ? ['-map', '0:a:0', '-c:a', 'aac', '-b:a', '128k', '-ac', '2'] : []
  await ffmpeg(
    [
      '-i',
      input,
      '-map',
      '0:v:0',
      ...audio,
      '-vf',
      `${shortSide(540)},fps='min(source_fps,30)'`,
      ...(await encoderArgs(opts.encoder, 'proxy')),
      '-g',
      '30',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      out,
    ],
    { duration: opts.duration, onProgress: opts.onProgress, signal: opts.signal },
  )
}

/** Mono 16 kHz WAV: what Whisper and the loudness scan read. */
export async function extractAudio(input: string, out: string, signal?: AbortSignal) {
  await ffmpeg(['-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out], {
    signal,
  })
}

/**
 * Picture change over time from scene scores at 4 frames per second: `motion[s]` is the mean
 * change in second s (0..1), `cuts` the times where the picture changes at once.
 */
export async function analyzeMotion(input: string, duration: number, signal?: AbortSignal) {
  const scores: { t: number; score: number }[] = []
  let t = 0
  await run(
    FFMPEG,
    [
      '-hide_banner',
      '-nostats',
      '-i',
      input,
      '-an',
      '-vf',
      "fps=4,scale=160:-2,select='gte(scene,0)',metadata=print:key=lavfi.scene_score:file=-",
      '-f',
      'null',
      '-',
    ],
    {
      signal,
      keep: 10_000,
      onStdoutLine: (line) => {
        const time = /pts_time:([\d.]+)/.exec(line)
        if (time) t = Number(time[1])
        const score = /lavfi\.scene_score=([\d.]+)/.exec(line)
        if (score) scores.push({ t, score: Number(score[1]) })
      },
    },
  )
  const seconds = Math.max(1, Math.ceil(duration))
  const sum = new Array<number>(seconds).fill(0)
  const count = new Array<number>(seconds).fill(0)
  const cuts: number[] = []
  for (const s of scores) {
    const i = Math.min(seconds - 1, Math.floor(s.t))
    sum[i] = (sum[i] ?? 0) + s.score
    count[i] = (count[i] ?? 0) + 1
    if (s.score > 0.3 && s.t - (cuts[cuts.length - 1] ?? -1) > 0.5) cuts.push(s.t)
  }
  const motion = sum.map(
    (v, i) => Math.round(Math.min(1, v / Math.max(1, count[i] ?? 1) / 0.3) * 1000) / 1000,
  )
  return { motion, cuts }
}

/** Short-term loudness (LUFS) for each second; silence is -70. */
export async function analyzeLoudness(input: string, duration: number, signal?: AbortSignal) {
  const seconds = Math.max(1, Math.ceil(duration))
  const sum = new Array<number>(seconds).fill(0)
  const count = new Array<number>(seconds).fill(0)
  let t = 0
  await run(
    FFMPEG,
    [
      '-hide_banner',
      '-nostats',
      '-i',
      input,
      '-af',
      'ebur128=metadata=1,ametadata=print:key=lavfi.r128.S:file=-',
      '-f',
      'null',
      '-',
    ],
    {
      signal,
      keep: 10_000,
      onStdoutLine: (line) => {
        const time = /pts_time:([\d.]+)/.exec(line)
        if (time) t = Number(time[1])
        const m = /lavfi\.r128\.S=(-?[\d.]+|-inf|nan)/.exec(line)
        if (m) {
          const v = Number(m[1])
          const i = Math.min(seconds - 1, Math.floor(t))
          sum[i] = (sum[i] ?? 0) + (Number.isFinite(v) ? Math.max(-70, v) : -70)
          count[i] = (count[i] ?? 0) + 1
        }
      },
    },
  )
  return sum.map((v, i) => Math.round((count[i] ? v / (count[i] as number) : -70) * 10) / 10)
}

/** A font file for labels on contact sheets (run ffmpeg with this folder as cwd). */
export function labelFont(): { dir: string; file: string } | null {
  const candidates =
    process.platform === 'win32'
      ? [
          ['C:/Windows/Fonts', 'arialbd.ttf'],
          ['C:/Windows/Fonts', 'segoeuib.ttf'],
        ]
      : process.platform === 'darwin'
        ? [
            ['/System/Library/Fonts/Supplemental', 'Arial Bold.ttf'],
            ['/Library/Fonts', 'Arial Bold.ttf'],
          ]
        : [['/usr/share/fonts/truetype/dejavu', 'DejaVuSans-Bold.ttf']]
  for (const [dir, file] of candidates) {
    if (existsSync(join(dir as string, file as string)))
      return { dir: dir as string, file: file as string }
  }
  return null
}

const SHEET_COLS = 4
const SHEET_ROWS = 4
const MAX_SHEETS = 24

/** How far apart the frames on contact sheets are, for a video this long. */
export function sheetInterval(duration: number) {
  const perSheet = SHEET_COLS * SHEET_ROWS
  if (duration <= perSheet * 6) return 1
  return Math.max(1, Math.round((duration / (perSheet * MAX_SHEETS)) * 10) / 10)
}

/**
 * Contact sheets: frames every `interval` seconds, each labelled with its time, 16 to a sheet.
 * Written as sheet_001.jpg… in `dir`.
 */
export async function contactSheets(
  input: string,
  dir: string,
  duration: number,
  signal?: AbortSignal,
): Promise<ContactSheet[]> {
  const interval = sheetInterval(duration)
  const font = labelFont()
  const label = font
    ? `,drawtext=fontfile=${font.file}:text='%{pts\\:hms}':x=6:y=6:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=4`
    : ''
  await run(
    FFMPEG,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      input,
      '-an',
      '-vf',
      `fps=1/${interval},${fitBox(320)}${label},tile=${SHEET_COLS}x${SHEET_ROWS}:padding=4:color=black`,
      '-q:v',
      '4',
      join(dir, 'sheet_%03d.jpg'),
    ],
    { signal, cwd: font?.dir },
  )
  const files = readdirSync(dir)
    .filter((f) => /^sheet_\d+\.jpg$/.test(f))
    .sort()
  const perSheet = SHEET_COLS * SHEET_ROWS
  const total = Math.max(1, Math.ceil(duration / interval))
  return files.map((file, index) => {
    const times: number[] = []
    for (let k = 0; k < perSheet; k++) {
      const n = index * perSheet + k
      if (n >= total) break
      times.push(Math.round(n * interval * 100) / 100)
    }
    return {
      index,
      start: times[0] ?? 0,
      end: Math.min(duration, (times[times.length - 1] ?? 0) + interval),
      cols: SHEET_COLS,
      rows: SHEET_ROWS,
      times,
      file,
    }
  })
}

/** One frame as JPEG bytes, fitting a `size` box. */
export async function frameAt(input: string, at: number, size = 768, signal?: AbortSignal) {
  const { stdout } = await runBinary(
    [
      '-ss',
      Math.max(0, at).toFixed(3),
      '-i',
      input,
      '-frames:v',
      '1',
      '-vf',
      fitBox(size),
      '-q:v',
      '3',
      '-f',
      'image2pipe',
      '-c:v',
      'mjpeg',
      '-',
    ],
    signal,
  )
  return stdout
}

/** ffmpeg writing binary to stdout. */
async function runBinary(args: string[], signal?: AbortSignal): Promise<{ stdout: Buffer }> {
  const { spawn } = await import('node:child_process')
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...args], {
      windowsHide: true,
    })
    const chunks: Buffer[] = []
    let err = ''
    signal?.addEventListener('abort', () => child.kill(), { once: true })
    child.stdout.on('data', (d: Buffer) => chunks.push(d))
    child.stderr.on('data', (d: Buffer) => {
      err += d.toString()
    })
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0
        ? resolve({ stdout: Buffer.concat(chunks) })
        : reject(new Error(`ffmpeg failed: ${err.trim()}`)),
    )
  })
}
