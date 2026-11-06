import type { Composition, Item, Track } from './composition'
import type { AssetRole, Format } from './model'
import { compositionDuration, itemEnd } from './timeline'

/*
 * A review of an edit before it is rendered: what a first-time viewer on a phone would trip
 * over. Rules from measured short-form practice (see the production guide in the MCP server):
 * the first frame is the thumbnail, the picture changes every few seconds, words stay long
 * enough to read and out from under the app's buttons, there is sound, captions for speech,
 * and the mix sits near -14 LUFS. Notes are ranked P0 (breaks the video), P1 (weakens it),
 * P2 (polish).
 */

export type ReviewLevel = 'P0' | 'P1' | 'P2'

export interface ReviewNote {
  level: ReviewLevel
  /** Stable id of the rule, for filtering and tests. */
  code: string
  /** Timeline seconds the note is about, when it is about a moment. */
  at: number | null
  /** The item it is about, to select it in the editor. */
  itemId: string | null
  problem: string
  fix: string
}

export interface ReviewInput {
  composition: Composition
  /** What the review needs to know about the files the items use. */
  assets: Map<string, { role: AssetRole; hasAudio: boolean }>
  /** Beat times of the music on the timeline. */
  beats: number[]
  format: Format | null
  /** Some placed audio or clip carries transcribed speech. */
  speech: boolean
  /** Measured on the last render of this composition, when there is one. */
  render?: { loudness: number | null; truePeak: number | null } | null
}

export interface ReviewResult {
  notes: ReviewNote[]
  stats: { duration: number; shots: number; averageShot: number; cutsPer10s: number }
}

/**
 * Where a vertical frame is free of the platforms' own UI (status bar, caption, handle,
 * buttons), as fractions of 1080×1920: words and the subject stay inside. Conservative across
 * TikTok, Reels and Shorts; the apps change, so these are a guide, not a promise.
 */
export const SAFE_ZONE = {
  top: 168 / 1920,
  bottom: 1330 / 1920,
  left: 60 / 1080,
  right: 940 / 1080,
}

/** Seconds a line needs on screen to be read: half a second plus 0.3 s a word. */
export const readTime = (words: number) => 0.5 + 0.3 * words

const LEVEL_ORDER: Record<ReviewLevel, number> = { P0: 0, P1: 1, P2: 2 }
const t = (s: number) => `${s.toFixed(1)} с`

/** Items that fill the picture (text and captions draw over it, overlays need something under). */
function covers(item: Item) {
  return item.type === 'clip' || (item.type === 'motion' && !item.overlay)
}

function visualTracks(c: Composition): Track[] {
  return c.tracks.filter((tr) => tr.kind === 'visual' && !tr.hidden)
}

/** Stretches of [0, end) that nothing covers, longer than `min`. */
function holes(c: Composition, end: number, min = 0.1): { from: number; to: number }[] {
  const spans = visualTracks(c)
    .flatMap((tr) => tr.items.filter(covers))
    .map((i) => ({ from: i.start, to: itemEnd(i) }))
    .sort((a, b) => a.from - b.from)
  const out: { from: number; to: number }[] = []
  let at = 0
  for (const s of spans) {
    if (s.from - at > min) out.push({ from: at, to: s.from })
    at = Math.max(at, s.to)
  }
  if (end - at > min) out.push({ from: at, to: end })
  return out
}

export function reviewComposition(input: ReviewInput): ReviewResult {
  const c = input.composition
  const notes: ReviewNote[] = []
  const add = (n: Omit<ReviewNote, 'itemId' | 'at'> & { at?: number | null; itemId?: string }) =>
    notes.push({ at: n.at ?? null, itemId: n.itemId ?? null, ...n })
  const duration = compositionDuration(c)
  const vertical = c.height > c.width
  const scale = c.height / (vertical ? 1920 : 1080)
  const visuals = visualTracks(c)
  const items = visuals.flatMap((tr) => tr.items)

  if (duration <= 0) {
    add({
      level: 'P0',
      code: 'empty',
      problem: 'В видео пока ничего нет',
      fix: 'Положи клипы на V1',
    })
    return { notes, stats: { duration: 0, shots: 0, averageShot: 0, cutsPer10s: 0 } }
  }

  // The picture: an empty first frame is the thumbnail, a hole is a black flash.
  const gaps = holes(c, duration)
  for (const h of gaps) {
    add(
      h.from === 0
        ? {
            level: 'P0',
            code: 'first-frame-empty',
            at: 0,
            problem: `Первый кадр пустой (до ${t(h.to)}) — а он и есть обложка`,
            fix: 'Начни с самого сильного кадра: лицо, результат или крупная фраза уже на экране',
          }
        : {
            level: 'P0',
            code: 'black-gap',
            at: h.from,
            problem: `Чёрный кадр ${t(h.from)}–${t(h.to)}`,
            fix: 'Закрой пробел на дорожке или растяни соседний клип',
          },
    )
  }

  // The hook: most watch muted, so words on screen in the first second carry it.
  const earlyText = items.some((i) => (i.type === 'text' || i.type === 'captions') && i.start < 1)
  if (duration > 5 && !earlyText)
    add({
      level: 'P1',
      code: 'no-hook-text',
      at: 0,
      problem: 'В первую секунду на экране нет слов, а большинство смотрит без звука',
      fix: 'Дай хук текстом (крупная фраза до 5 слов) или начни сабы сразу',
    })

  // Something should change every few seconds (captions alone do not count).
  const changes = [
    0,
    duration,
    ...items.filter((i) => i.type !== 'captions').flatMap((i) => [i.start, itemEnd(i)]),
  ]
    .filter((x) => x >= 0 && x <= duration)
    .sort((a, b) => a - b)
  const deadLimit = vertical ? 3 : 4
  for (let i = 1; i < changes.length; i++) {
    const from = changes[i - 1] as number
    const to = changes[i] as number
    // A black gap is already a P0; the same stretch is not also "nothing changing".
    const inGap = gaps.some((g) => g.from <= from + 1e-6 && g.to >= to - 1e-6)
    if (to - from > deadLimit && !inGap)
      add({
        level: 'P1',
        code: 'dead-stretch',
        at: from,
        problem: `${t(to - from)} без смены картинки (${t(from)}–${t(to)})`,
        fix: 'Разрежь план, добавь пробивку (зум 1.1–1.2), текст или моушн',
      })
  }

  // Words: long enough to read, big enough, inside the safe zone.
  const minSize = 28 * scale
  for (const tr of visuals) {
    for (const i of tr.items) {
      if (i.type === 'text') {
        const words = i.text.trim().split(/\s+/).filter(Boolean).length
        if (words && i.duration < readTime(words) - 1e-6)
          add({
            level: 'P1',
            code: 'text-too-short',
            at: i.start,
            itemId: i.id,
            problem: `«${i.text.slice(0, 40)}» на экране ${t(i.duration)}, а на ${words} сл. нужно ${t(readTime(words))}`,
            fix: 'Удлини текст или сократи фразу',
          })
      }
      if (i.type === 'text' || i.type === 'captions') {
        const size = i.style.size
        if (size < minSize)
          add({
            level: 'P1',
            code: 'text-too-small',
            at: i.start,
            itemId: i.id,
            problem: `Размер текста ${size}px — на телефоне не прочитать`,
            fix: `Не меньше ${Math.ceil(minSize)}px; лучше сократить слова, чем уменьшать шрифт`,
          })
        if (vertical) {
          const lines = i.type === 'captions' ? 2 : Math.max(1, i.text.split('\n').length)
          const half = (size * 1.15 * lines) / 2 / c.height
          const y = i.style.y
          if (y - half < SAFE_ZONE.top || y + half > SAFE_ZONE.bottom)
            add({
              level: 'P1',
              code: 'outside-safe-zone',
              at: i.start,
              itemId: i.id,
              problem: `${i.type === 'captions' ? 'Сабы заходят' : 'Текст заходит'} под интерфейс площадки (y ${y.toFixed(2)})`,
              fix: `Держи слова между ${SAFE_ZONE.top.toFixed(2)} и ${(SAFE_ZONE.bottom - half).toFixed(2)} по высоте`,
            })
          if (i.type === 'text' && (i.style.x < 0.1 || i.style.x > 0.85))
            add({
              level: 'P2',
              code: 'near-edge',
              at: i.start,
              itemId: i.id,
              problem: 'Текст у края кадра: справа его закроют кнопки',
              fix: 'Сдвинь ближе к центру (x 0.15–0.8)',
            })
        }
      }
    }
  }

  // Sound.
  const audible = c.tracks.some(
    (tr) =>
      !tr.muted &&
      tr.items.some(
        (i) =>
          (i.type === 'audio' && i.volume > 0) ||
          (i.type === 'clip' && i.volume > 0 && input.assets.get(i.assetId)?.hasAudio),
      ),
  )
  if (duration > 15 && !audible)
    add({
      level: 'P1',
      code: 'silent',
      problem: 'Видео длиннее 15 с без звука',
      fix: 'Положи музыку на A2 (find_music) и звуки на действия',
    })
  const audioItems = c.tracks
    .filter((tr) => tr.kind === 'audio' && !tr.muted)
    .flatMap((tr) => tr.items)
    .filter((i) => i.type === 'audio')
  const hasVoice = audioItems.some((i) => input.assets.get(i.assetId)?.role === 'voice')
  for (const i of audioItems) {
    if (i.type !== 'audio') continue
    if (hasVoice && input.assets.get(i.assetId)?.role === 'music' && !i.duck && i.volume > 0.4)
      add({
        level: 'P2',
        code: 'music-not-ducked',
        at: i.start,
        itemId: i.id,
        problem: 'Музыка не приглушается под голосом',
        fix: 'Включи duck или опусти громкость музыки до 0.3–0.4',
      })
  }
  const hasCaptions = items.some((i) => i.type === 'captions')
  if (input.speech && !hasCaptions)
    add({
      level: 'P1',
      code: 'no-captions',
      problem: 'Есть речь, но нет сабов — без звука смысл теряется',
      fix: 'add_captions (2–3 слова на группу для энергичного ролика)',
    })

  // Length.
  if (duration > 180)
    add({
      level: 'P0',
      code: 'too-long',
      problem: `Длина ${t(duration)}: Shorts принимают до 3 минут`,
      fix: 'Сократи до 15–60 с',
    })
  else if (duration > 90)
    add({
      level: 'P2',
      code: 'long',
      problem: `Длина ${t(duration)}: короткие ролики лучше досматривают на 15–60 с`,
      fix: 'Вырежи всё, что не тянет к развязке',
    })

  // Pacing on the main track.
  const main = visuals.at(-1)
  const shots = (main?.items ?? []).filter(covers).sort((a, b) => a.start - b.start)
  const lengths = shots.map((s) => itemEnd(s) - s.start)
  const averageShot = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0
  const target = input.format?.recipe.pacing.shot ?? (vertical ? 2 : 3)
  if (shots.length > 2 && averageShot > Math.max(4, target * 2))
    add({
      level: 'P1',
      code: 'slow-pacing',
      problem: `Средний план ${t(averageShot)} — ${input.format ? `формат просит около ${t(target)}` : 'для вертикали это медленно'}`,
      fix: 'Режь на 1–2 с, держи длинный план только там, где внутри идёт действие',
    })
  if (input.format?.recipe.pacing.cutOnBeat && input.beats.length && shots.length > 1) {
    const off = shots.slice(1).filter((s) => !input.beats.some((b) => Math.abs(b - s.start) < 0.08))
    if (off.length)
      add({
        level: 'P1',
        code: 'cuts-off-beat',
        at: off[0]?.start ?? null,
        itemId: off[0]?.id,
        problem: `${off.length} склеек мимо битов, а формат режет в бит`,
        fix: 'Shift+B в редакторе или {op:"cutToBeats"}',
      })
  }

  // The same motion again and again reads as a template.
  const motionUse = new Map<string, number>()
  for (const i of items)
    if (i.type === 'motion') motionUse.set(i.template, (motionUse.get(i.template) ?? 0) + 1)
  for (const [template, n] of motionUse)
    if (n > 3)
      add({
        level: 'P2',
        code: 'repeated-motion',
        problem: `Моушн «${template}» стоит ${n} раз`,
        fix: 'Чередуй 3–5 разных входов и переходов',
      })

  // The mix of the last render.
  const r = input.render
  if (r?.loudness != null && (r.loudness < -16.5 || r.loudness > -12.5))
    add({
      level: 'P1',
      code: 'loudness',
      problem: `Громкость последнего рендера ${r.loudness.toFixed(1)} LUFS`,
      fix: 'Около −14 LUFS: перерендери (рендер нормализует) или проверь, не слишком ли тихий голос',
    })
  if (r?.truePeak != null && r.truePeak > -0.9)
    add({
      level: 'P1',
      code: 'true-peak',
      problem: `Пики последнего рендера до ${r.truePeak.toFixed(1)} dBTP — на телефоне может хрипеть`,
      fix: 'Не выше −1 dBTP: убавь громкие клипы',
    })

  notes.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || (a.at ?? 0) - (b.at ?? 0))
  return {
    notes,
    stats: {
      duration,
      shots: shots.length,
      averageShot,
      cutsPer10s: duration ? (Math.max(0, shots.length - 1) / duration) * 10 : 0,
    },
  }
}
