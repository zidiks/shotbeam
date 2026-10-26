import {
  type CaptionsItem,
  type Composition,
  captionGroups,
  type Item,
  type TextItem,
} from '@shotbeam/core'

/*
 * Text and captions as an ASS subtitle script, burned in by ffmpeg's libass. Positions are in
 * frame pixels (PlayRes = composition size), so what is set in the editor lands where it shows.
 */

/** #RRGGBB (or #RRGGBBAA) to ASS &HAABBGGRR. */
export function assColor(hex: string, alpha = 0): string {
  const h = hex.replace('#', '')
  const r = h.slice(0, 2) || 'ff'
  const g = h.slice(2, 4) || 'ff'
  const b = h.slice(4, 6) || 'ff'
  const a = h.length >= 8 ? 255 - Number.parseInt(h.slice(6, 8), 16) : alpha
  return `&H${a.toString(16).padStart(2, '0')}${b}${g}${r}`.toUpperCase()
}

export function assTime(t: number): string {
  const cs = Math.max(0, Math.round(t * 100))
  const h = Math.floor(cs / 360000)
  const m = Math.floor((cs % 360000) / 6000)
  const s = Math.floor((cs % 6000) / 100)
  const c = cs % 100
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`
}

function escapeText(text: string) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/\r?\n/g, '\\N')
}

const STYLE_FORMAT =
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding'

interface StyleSpec {
  name: string
  font: string
  size: number
  primary: string
  secondary: string
  outline: string
  back: string
  bold: boolean
  borderStyle: 1 | 3
  outlineWidth: number
  shadow: number
  alignment: number
}

function styleLine(s: StyleSpec) {
  return `Style: ${s.name},${s.font},${s.size},${s.primary},${s.secondary},${s.outline},${s.back},${s.bold ? -1 : 0},0,0,0,100,100,0,0,${s.borderStyle},${s.outlineWidth},${s.shadow},${s.alignment},60,60,60,1`
}

/** The text and captions of one visual track as an ASS script (burned in at that track's layer). */
export function buildAss(
  c: Composition,
  items: Item[],
  resolveFont: (family: string) => string,
  /** Draft renders scale the frame down; text scales with it. */
  scale = 1,
): string | null {
  const styles: string[] = []
  const events: string[] = []
  const W = Math.round(c.width * scale)
  const H = Math.round(c.height * scale)
  let n = 0

  for (const item of items) {
    n++
    if (item.type === 'text') text(item, `t${n}`)
    else if (item.type === 'captions') captions(item, `c${n}`)
  }
  if (!events.length) return null

  function text(item: TextItem, name: string) {
    const st = item.style
    const size = Math.round(st.size * scale)
    styles.push(
      styleLine({
        name,
        font: resolveFont(st.font),
        size,
        primary: assColor(st.color),
        secondary: assColor(st.color),
        outline: assColor(st.background ?? st.stroke ?? '#000000'),
        back: assColor(st.background ?? '#000000', st.background ? 0 : 0x80),
        bold: st.weight >= 600,
        borderStyle: st.background ? 3 : 1,
        outlineWidth: st.background
          ? Math.round(size * 0.25)
          : st.stroke
            ? Math.max(1, Math.round(size * 0.06))
            : 0,
        shadow: 0,
        alignment: st.align === 'left' ? 4 : st.align === 'right' ? 6 : 5,
      }),
    )
    const body = escapeText(st.uppercase ? item.text.toUpperCase() : item.text)
    const fade =
      item.fadeIn || item.fadeOut
        ? `\\fad(${Math.round(item.fadeIn * 1000)},${Math.round(item.fadeOut * 1000)})`
        : ''
    events.push(
      `Dialogue: 1,${assTime(item.start)},${assTime(item.start + item.duration)},${name},,0,0,0,,{\\pos(${Math.round(st.x * W)},${Math.round(st.y * H)})${fade}}${body}`,
    )
  }

  function captions(item: CaptionsItem, name: string) {
    const st = item.style
    const size = Math.round(st.size * scale)
    const karaoke = st.preset === 'karaoke'
    styles.push(
      styleLine({
        name,
        font: resolveFont(st.font),
        size,
        // Karaoke fills from the secondary colour to the primary one.
        primary: assColor(karaoke ? st.highlight : st.color),
        secondary: assColor(st.color),
        outline: assColor(st.stroke),
        back: assColor('#000000', 0x80),
        bold: true,
        borderStyle: 1,
        outlineWidth: Math.max(2, Math.round(size * 0.08)),
        shadow: Math.round(size * 0.04),
        alignment: 5,
      }),
    )
    const pos = `\\pos(${Math.round(W / 2)},${Math.round(st.y * H)})`
    const end = item.start + item.duration
    const words = item.words
      .filter((w) => w.end > item.start && w.start < end)
      .map((w) => ({ ...w, text: st.uppercase ? w.text.toUpperCase() : w.text }))
    for (const g of captionGroups(words, st.maxWords)) {
      const gEnd = Math.min(end, g.end)
      if (st.preset === 'minimal') {
        events.push(
          `Dialogue: 0,${assTime(g.start)},${assTime(gEnd)},${name},,0,0,0,,{${pos}}${escapeText(g.words.map((w) => w.text).join(' '))}`,
        )
        continue
      }
      if (karaoke) {
        const parts = g.words.map((w, i) => {
          const next = g.words[i + 1]
          const dur = Math.max(1, Math.round(((next ? next.start : w.end) - w.start) * 100))
          return `{\\k${dur}}${escapeText(w.text)} `
        })
        events.push(
          `Dialogue: 0,${assTime(g.start)},${assTime(gEnd)},${name},,0,0,0,,{${pos}}${parts.join('').trim()}`,
        )
        continue
      }
      // bold-pop: the group stays on screen, the word being said is highlighted and bigger.
      g.words.forEach((w, i) => {
        const next = g.words[i + 1]
        const from = i === 0 ? g.start : w.start
        const to = next ? next.start : gEnd
        if (to <= from) return
        const line = g.words
          .map((x, j) =>
            j === i
              ? `{\\c${assColor(st.highlight)}\\fscx112\\fscy112}${escapeText(x.text)}{\\r}`
              : escapeText(x.text),
          )
          .join(' ')
        events.push(`Dialogue: 0,${assTime(from)},${assTime(to)},${name},,0,0,0,,{${pos}}${line}`)
      })
    }
  }

  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    STYLE_FORMAT,
    ...styles,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    '',
  ].join('\n')
}
