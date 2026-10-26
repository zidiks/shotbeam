import type { Asset } from '@shotbeam/core'
import { cn, Spinner } from '@shotbeam/ui'
import { AudioLines, CircleAlert, Film, ImageIcon } from 'lucide-react'
import { useState } from 'react'
import { mediaUrl } from '../lib/api'
import { timecode } from '../lib/format'

/** A media tile: thumbnail (or an icon), length, status. */
export function AssetCard({
  asset,
  selected,
  onClick,
  draggable,
}: {
  asset: Asset
  selected?: boolean
  onClick?: () => void
  draggable?: boolean
}) {
  const [broken, setBroken] = useState(false)
  const Icon = asset.kind === 'audio' ? AudioLines : asset.kind === 'image' ? ImageIcon : Film
  const bpm = asset.tags.find((t) => /bpm$/.test(t))
  return (
    <button
      type="button"
      onClick={onClick}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-shotbeam-asset', asset.id)
        e.dataTransfer.effectAllowed = 'copy'
      }}
      className={cn(
        'group flex w-full flex-col overflow-hidden rounded-lg border bg-card text-left transition-colors hover:border-ring/60',
        selected && 'border-brand ring-2 ring-brand/30',
      )}
    >
      <div className="relative aspect-video w-full bg-muted">
        {!broken && asset.kind !== 'audio' && asset.status !== 'new' ? (
          <img
            src={mediaUrl(asset.id, 'thumb', asset.updatedAt)}
            alt=""
            loading="lazy"
            onError={() => setBroken(true)}
            className="absolute inset-0 size-full object-contain"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Icon className="size-7 text-muted-foreground/60" />
          </div>
        )}
        {asset.duration ? (
          <span className="absolute right-1.5 bottom-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums">
            {timecode(asset.duration, true)}
          </span>
        ) : null}
        {asset.status === 'indexing' || asset.status === 'new' ? (
          <span className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-white">
            <Spinner className="size-3" /> индексация
          </span>
        ) : asset.status === 'error' ? (
          <span className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded bg-destructive px-1.5 py-0.5 text-[11px] text-white">
            <CircleAlert className="size-3" /> ошибка
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 items-center gap-1.5 px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate text-[13px]">{asset.name}</span>
        {bpm ? <span className="shrink-0 text-[11px] text-muted-foreground">{bpm}</span> : null}
      </div>
    </button>
  )
}
