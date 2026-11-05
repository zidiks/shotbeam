import type { AudioItem } from '@shotbeam/core'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api } from '../../lib/api'
import { keys } from '../../lib/queries'

interface Wave {
  rate: number
  peaks: number[]
}

/** One bar every this many pixels. */
const STEP = 2
/** Sound this far below full scale draws as silence. */
const RANGE_DB = 48

/**
 * The sound of an audio item as thin mirrored bars, behind its label: the part between `in` and
 * `out`, scaled by the item's volume and fades, so what is drawn is what will be heard.
 */
export function Waveform({ item, zoom }: { item: AudioItem; zoom: number }) {
  const { data } = useQuery({
    queryKey: [...keys.asset(item.assetId), 'waveform'],
    queryFn: () => api.get<Wave | null>(`/api/assets/${item.assetId}/waveform`),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const length = item.out - item.in
  const width = Math.max(1, Math.round(length * zoom))
  const path = useMemo(() => {
    if (!data?.peaks.length) return ''
    const { rate, peaks } = data
    let d = ''
    for (let x = 0; x < width; x += STEP) {
      const t0 = x / zoom
      const from = Math.floor((item.in + t0) * rate)
      const to = Math.max(from + 1, Math.floor((item.in + (x + STEP) / zoom) * rate))
      let peak = 0
      for (let i = from; i < to && i < peaks.length; i++) peak = Math.max(peak, peaks[i] as number)
      let gain = item.volume
      if (item.fadeIn > 0 && t0 < item.fadeIn) gain *= t0 / item.fadeIn
      if (item.fadeOut > 0 && length - t0 < item.fadeOut) gain *= (length - t0) / item.fadeOut
      // Decibels, like editors draw it, so quiet recordings still have a shape; 1 = the whole
      // lane, silence a hairline.
      const db = 20 * Math.log10(Math.max(1e-6, peak * gain))
      const h = Math.max(0.02, Math.min(1, (db + RANGE_DB) / RANGE_DB))
      d += `M${x} ${50 - h * 50}h${STEP - 0.6}v${h * 100}h-${STEP - 0.6}z`
    }
    return d
  }, [data, width, zoom, item.in, item.volume, item.fadeIn, item.fadeOut, length])
  if (!path) return null
  return (
    <svg
      className="pointer-events-none absolute inset-y-1 left-0 text-white/35"
      width={width}
      height="calc(100% - 0.5rem)"
      viewBox={`0 0 ${width} 100`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={path} fill="currentColor" />
    </svg>
  )
}
