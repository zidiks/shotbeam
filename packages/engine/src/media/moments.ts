import type { Moment, Transcript } from '@shotbeam/core'

/*
 * Candidate "juicy moments": stretches where something happens (loud, lots of motion, cuts,
 * lively speech, a question or an exclamation). Only hints: Claude looks at the frames and the
 * words and decides.
 */

export interface Signals {
  duration: number
  transcript: Transcript | null
  /** LUFS per second. */
  loudness: number[]
  /** 0..1 per second. */
  motion: number[]
  cuts: number[]
}

const MIN_LEN = 3
const MAX_LEN = 20

function mean(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

function median(xs: number[]) {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] as number
}

function slice(xs: number[], start: number, end: number) {
  return xs.slice(Math.max(0, Math.floor(start)), Math.max(Math.floor(start) + 1, Math.ceil(end)))
}

export function findMoments(sig: Signals, limit = 12): Moment[] {
  const heard = sig.loudness.filter((v) => v > -60)
  const baseLoud = median(heard)
  const baseMotion = median(sig.motion)
  const segments = sig.transcript?.segments ?? []

  const windows: { start: number; end: number; text: string }[] = []
  if (segments.length) {
    // Windows made of whole sentences, so a cut never lands mid-word.
    for (let i = 0; i < segments.length; i++) {
      const first = segments[i]
      if (!first) continue
      let text = ''
      for (let j = i; j < segments.length; j++) {
        const seg = segments[j]
        if (!seg) break
        text = `${text} ${seg.text}`.trim()
        const len = seg.end - first.start
        if (len > MAX_LEN) break
        if (len >= MIN_LEN) windows.push({ start: first.start, end: seg.end, text })
      }
    }
  }
  if (!windows.length) {
    for (const len of [5, 8, 12]) {
      for (let s = 0; s + len <= Math.max(sig.duration, len); s += 1) {
        windows.push({ start: s, end: Math.min(sig.duration, s + len), text: '' })
      }
    }
  }

  const scored = windows.map((w) => {
    const len = w.end - w.start
    const loud = slice(sig.loudness, w.start, w.end)
    const motion = slice(sig.motion, w.start, w.end)
    const loudLift = heard.length ? Math.max(...loud, -70) - baseLoud : 0
    const motionLift = mean(motion) - baseMotion
    const cuts = sig.cuts.filter((c) => c >= w.start && c < w.end).length
    const words = w.text ? w.text.split(/\s+/).length : 0
    const pace = words / len
    const emphasis = (w.text.match(/[!?]/g) ?? []).length
    const reasons: string[] = []
    let score = 0
    if (loudLift > 4) {
      score += Math.min(1, loudLift / 12) * 0.35
      reasons.push(`louder (+${Math.round(loudLift)} LU)`)
    }
    if (motionLift > 0.1) {
      score += Math.min(1, motionLift / 0.5) * 0.25
      reasons.push('lots of motion')
    }
    if (cuts >= 2) {
      score += Math.min(1, cuts / (len / 1.5)) * 0.15
      reasons.push(`${cuts} cuts`)
    }
    if (pace > 2.8) {
      score += Math.min(1, (pace - 2.8) / 1.5) * 0.15
      reasons.push('lively speech')
    }
    if (emphasis) {
      score += Math.min(1, emphasis / 2) * 0.1
      reasons.push('question or exclamation')
    }
    // Short videos do better: prefer 6–15 s.
    if (len < 6 || len > 15) score *= 0.85
    return { ...w, score, reasons }
  })

  scored.sort((a, b) => b.score - a.score)
  const picked: Moment[] = []
  for (const w of scored) {
    if (picked.length >= limit) break
    if (w.score <= 0.05) break
    if (picked.some((p) => w.start < p.end && w.end > p.start)) continue
    picked.push({
      start: Math.round(w.start * 100) / 100,
      end: Math.round(w.end * 100) / 100,
      score: Math.round(Math.min(1, w.score) * 100) / 100,
      reasons: w.reasons,
      text: w.text,
    })
  }
  return picked.sort((a, b) => a.start - b.start)
}
