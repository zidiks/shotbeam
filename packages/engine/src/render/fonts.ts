import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/*
 * Fonts for text and captions: the library's fonts/ folder (drop brand fonts there) plus a few
 * bold system fonts copied in. ffmpeg's libass reads only this folder, so what renders is what the
 * editor previews (the UI loads the same files).
 */

const SYSTEM_FONTS: Record<string, string[]> = {
  win32: [
    'C:/Windows/Fonts/seguibl.ttf',
    'C:/Windows/Fonts/segoeuib.ttf',
    'C:/Windows/Fonts/ariblk.ttf',
    'C:/Windows/Fonts/arialbd.ttf',
    'C:/Windows/Fonts/impact.ttf',
    'C:/Windows/Fonts/bahnschrift.ttf',
  ],
  darwin: [
    '/System/Library/Fonts/Supplemental/Arial Black.ttf',
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '/System/Library/Fonts/Supplemental/Impact.ttf',
  ],
  linux: ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'],
}

export interface FontFile {
  file: string
  family: string
}

/** The family name (name id 1) of a TrueType/OpenType font, or null when it cannot be read. */
export function fontFamily(path: string): string | null {
  let buf: Buffer
  try {
    buf = readFileSync(path)
  } catch {
    return null
  }
  if (buf.length < 12) return null
  const tables = buf.readUInt16BE(4)
  for (let i = 0; i < tables; i++) {
    const rec = 12 + i * 16
    if (buf.toString('latin1', rec, rec + 4) !== 'name') continue
    const offset = buf.readUInt32BE(rec + 8)
    const count = buf.readUInt16BE(offset + 2)
    const strings = offset + buf.readUInt16BE(offset + 4)
    let fallback: string | null = null
    for (let n = 0; n < count; n++) {
      const r = offset + 6 + n * 12
      const platform = buf.readUInt16BE(r)
      const nameId = buf.readUInt16BE(r + 6)
      const length = buf.readUInt16BE(r + 8)
      const start = strings + buf.readUInt16BE(r + 10)
      if (nameId !== 1) continue
      if (platform === 3 || platform === 0) {
        const bytes = Buffer.from(buf.subarray(start, start + length))
        bytes.swap16()
        return bytes.toString('utf16le')
      }
      if (platform === 1) fallback = buf.toString('latin1', start, start + length)
    }
    return fallback
  }
  return null
}

export class Fonts {
  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true })
    for (const f of SYSTEM_FONTS[process.platform] ?? []) {
      const to = join(dir, f.split('/').pop() as string)
      if (existsSync(f) && !existsSync(to)) copyFileSync(f, to)
    }
  }

  list(): FontFile[] {
    return readdirSync(this.dir)
      .filter((f) => /\.(ttf|otf)$/i.test(f))
      .map((file) => ({ file, family: fontFamily(join(this.dir, file)) ?? file }))
  }

  /** A family that exists: the one asked for, else a heavy default. */
  resolve(family: string): string {
    const fonts = this.list()
    const want = family.toLowerCase()
    const hit = fonts.find((f) => f.family.toLowerCase() === want)
    if (hit) return hit.family
    for (const preferred of ['Segoe UI Black', 'Arial Black', 'Impact', 'DejaVu Sans']) {
      const p = fonts.find((f) => f.family === preferred)
      if (p) return p.family
    }
    return fonts[0]?.family ?? family
  }
}
