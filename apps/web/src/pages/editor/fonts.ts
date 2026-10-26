import { useEffect } from 'react'
import { engineUrl } from '../../lib/api'
import { useFonts } from '../../lib/queries'

/*
 * The preview draws text with the same font files ffmpeg renders with (the library's fonts/),
 * loaded under their family names.
 */

const loaded = new Set<string>()

export function useLibraryFonts() {
  const fonts = useFonts().data
  useEffect(() => {
    for (const f of fonts ?? []) {
      if (loaded.has(f.file)) continue
      loaded.add(f.file)
      const face = new FontFace(
        f.family,
        `url(${engineUrl(`/api/fonts/${encodeURIComponent(f.file)}`)})`,
      )
      face
        .load()
        .then((ff) => document.fonts.add(ff))
        .catch(() => loaded.delete(f.file))
    }
  }, [fonts])
  return fonts ?? []
}

/** The family the renderer will use for a requested one (same fallback order as the engine). */
export function resolveFamily(family: string, fonts: { family: string }[]) {
  const hit = fonts.find((f) => f.family.toLowerCase() === family.toLowerCase())
  if (hit) return hit.family
  for (const p of ['Segoe UI Black', 'Arial Black', 'Impact', 'DejaVu Sans']) {
    if (fonts.some((f) => f.family === p)) return p
  }
  return fonts[0]?.family ?? family
}
