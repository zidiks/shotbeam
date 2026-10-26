import type { Asset, Composition, CompositionOp, Item, Track } from '@shotbeam/core'
import { compositionDuration, isFree, itemEnd, TRACK_ITEMS, trackLabel } from '@shotbeam/core'
import { Button, cn, Tooltip, TooltipContent, TooltipTrigger } from '@shotbeam/ui'
import { Eye, EyeOff, Layers, Magnet, Plus, Volume2, VolumeX, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { timecode } from '../../lib/format'
import { useEditor } from './state'
import { TimelineItemMenu } from './TimelineItemMenu'

/*
 * Timeline-lite, laid out like any editor: visual tracks on top (V1 is the main one, higher ones
 * draw over it), audio tracks below (A1, A2…). Drag to move (also to another track of the same
 * kind), drag an edge to trim, drop media from the bin, click the ruler to move the playhead.
 *
 * Magnet (default): edges snap to other edges and the playhead, and an item stops at its
 * neighbours instead of covering them. Pushing on past the edge (BREAK_PX) breaks through and
 * places it over the neighbour on purpose. With the magnet off, or while Alt is held, items go
 * exactly where they are dropped and may overlap. Every gesture ends in one batch of ops.
 */

const HEADER = 132
const ROW = 46
const SNAP_PX = 8
/** How far past a neighbour's edge an item has to be pushed before it may cover it. */
const BREAK_PX = 48

type DragMode = 'move' | 'trim-start' | 'trim-end'

interface Drag {
  mode: DragMode
  id: string
  x0: number
  item: Item
  trackId: string
  dx: number
  targetTrack: string
  free: boolean
}

interface Placed {
  patch: Partial<Item>
  /** It covers a neighbour (only when asked for: magnet off, Alt, or pushed through). */
  overlap: boolean
}

const COLORS: Record<string, string> = {
  clip: 'bg-sky-500/80 border-sky-300/60',
  audio: 'bg-emerald-600/80 border-emerald-300/60',
  music: 'bg-violet-600/75 border-violet-300/60',
  text: 'bg-amber-500/85 border-amber-200/70',
  captions: 'bg-yellow-400/85 border-yellow-100/70 text-black',
  motion: 'bg-pink-500/80 border-pink-200/60',
}

/** The item after a raw drag (seconds already snapped), before collisions. */
function raw(d: Drag, seconds: number, maxOut: (assetId: string) => number): Partial<Item> {
  const it = d.item
  if (d.mode === 'move') return { start: Math.max(0, it.start + seconds) }
  if (it.type === 'clip' || it.type === 'audio') {
    const speed = it.type === 'clip' ? it.speed : 1
    if (d.mode === 'trim-end') {
      return { out: Math.min(maxOut(it.assetId), Math.max(it.in + 0.1, it.out + seconds * speed)) }
    }
    const shift = Math.max(
      -it.in / speed,
      -it.start,
      Math.min(seconds, (it.out - it.in) / speed - 0.1),
    )
    return { start: it.start + shift, in: it.in + shift * speed }
  }
  const dur = (it as { duration: number }).duration
  if (d.mode === 'trim-end') return { duration: Math.max(0.1, dur + seconds) }
  const shift = Math.max(-it.start, Math.min(seconds, dur - 0.1))
  return { start: it.start + shift, duration: dur - shift }
}

/**
 * A start on `track` for an item of length `len` near `want` that covers nothing: `want` itself
 * when free, else the nearest edge of a neighbour. Null when no free spot is within `maxPx`.
 */
function nearestFree(
  track: Track,
  id: string | null,
  want: number,
  len: number,
  maxPx: number,
  zoom: number,
) {
  if (isFree(track, want, want + len, id ?? undefined)) return want
  let best: number | null = null
  for (const o of track.items) {
    if (o.id === id) continue
    for (const c of [itemEnd(o), o.start - len]) {
      if (c < 0 || !isFree(track, c, c + len, id ?? undefined)) continue
      if (best === null || Math.abs(c - want) < Math.abs(best - want)) best = c
    }
  }
  if (best === null || Math.abs(best - want) * zoom > maxPx) return null
  return best
}

/** Where a drag lands: magnet stops at neighbours until pushed through. */
function place(
  d: Drag,
  seconds: number,
  track: Track,
  magnet: boolean,
  zoom: number,
  maxOut: (id: string) => number,
): Placed {
  const patch = raw(d, seconds, maxOut)
  const moved = { ...d.item, ...patch } as Item
  const start = moved.start
  const end = itemEnd(moved)
  if (!magnet || d.free || isFree(track, start, end, d.id)) {
    return { patch, overlap: !isFree(track, start, end, d.id) }
  }
  if (d.mode === 'move') {
    const spot = nearestFree(track, d.id, start, end - start, BREAK_PX, zoom)
    return spot === null ? { patch, overlap: true } : { patch: { start: spot }, overlap: false }
  }
  const others = track.items.filter((i) => i.id !== d.id)
  if (d.mode === 'trim-end') {
    const wall = Math.min(...others.filter((i) => i.start >= d.item.start).map((i) => i.start))
    // Already over a neighbour that starts earlier: nothing to stop at.
    if (!Number.isFinite(wall) || (end - wall) * zoom > BREAK_PX) return { patch, overlap: true }
    const limit = wall - start
    if (moved.type === 'clip' || moved.type === 'audio') {
      const speed = moved.type === 'clip' ? moved.speed : 1
      return { patch: { out: moved.in + limit * speed }, overlap: false }
    }
    return { patch: { duration: limit }, overlap: false }
  }
  const wall = Math.max(...others.filter((i) => itemEnd(i) <= itemEnd(d.item)).map(itemEnd))
  if (!Number.isFinite(wall) || (wall - start) * zoom > BREAK_PX) return { patch, overlap: true }
  const shift = wall - d.item.start
  if (moved.type === 'clip' || moved.type === 'audio') {
    const it = d.item as typeof moved
    const speed = it.type === 'clip' ? it.speed : 1
    return { patch: { start: wall, in: it.in + shift * speed }, overlap: false }
  }
  return {
    patch: { start: wall, duration: (d.item as { duration: number }).duration - shift },
    overlap: false,
  }
}

export function Timeline({
  composition,
  assets,
  apply,
}: {
  composition: Composition
  assets: Map<string, Asset>
  apply: (ops: CompositionOp[]) => void
}) {
  const { time, zoom, selected, setTime, select, setZoom } = useEditor()
  const [drag, setDrag] = useState<Drag | null>(null)
  const magnet = useEditor((s) => s.magnet)
  const setMagnet = useEditor((s) => s.setMagnet)
  const lanes = useRef<HTMLDivElement>(null)
  const duration = compositionDuration(composition)
  const width = Math.max(duration + 10, 30) * zoom

  const maxOut = (id: string) => assets.get(id)?.duration ?? Number.POSITIVE_INFINITY
  const trackOf = (id: string) => composition.tracks.find((t) => t.id === id) as Track

  // Edges to snap to: zero, the playhead, every other item's start and end on any track.
  const snaps = useMemo(() => {
    const s = [0, time]
    for (const t of composition.tracks)
      for (const i of t.items) if (i.id !== drag?.id) s.push(i.start, itemEnd(i))
    return s
  }, [composition, time, drag?.id])

  const snap = (d: Drag, rawDx: number) => {
    const seconds = rawDx / zoom
    if (d.free) return seconds
    const it = d.item
    const edges =
      d.mode === 'move'
        ? [it.start + seconds, itemEnd(it) + seconds]
        : d.mode === 'trim-start'
          ? [it.start + seconds]
          : [itemEnd(it) + seconds]
    let best = seconds
    let bestDist = SNAP_PX / zoom
    for (const e of edges) {
      for (const p of snaps) {
        const dist = Math.abs(p - e)
        if (dist < bestDist) {
          bestDist = dist
          best = seconds + (p - e)
        }
      }
    }
    return best
  }

  const landing = (d: Drag) => place(d, snap(d, d.dx), trackOf(d.targetTrack), magnet, zoom, maxOut)

  const xToTime = (clientX: number) => {
    const r = lanes.current?.getBoundingClientRect()
    if (!r) return 0
    return Math.max(0, (clientX - r.left + (lanes.current?.scrollLeft ?? 0) - HEADER) / zoom)
  }

  const onItemDown = (e: React.PointerEvent, mode: DragMode, item: Item, track: Track) => {
    e.stopPropagation()
    if (e.button !== 0) return
    select(item.id)
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // No capture (a pen lifted already): the lanes still get the moves.
    }
    setDrag({
      mode,
      id: item.id,
      x0: e.clientX,
      item,
      trackId: track.id,
      dx: 0,
      targetTrack: track.id,
      free: e.altKey,
    })
  }

  const onMove = (e: React.PointerEvent) => {
    if (!drag) return
    let targetTrack = drag.targetTrack
    if (drag.mode === 'move') {
      const el = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest('[data-track-id]') as HTMLElement | null
      const t = composition.tracks.find((x) => x.id === el?.dataset.trackId)
      if (t && TRACK_ITEMS[t.kind].includes(drag.item.type)) targetTrack = t.id
    }
    setDrag({ ...drag, dx: e.clientX - drag.x0, targetTrack, free: e.altKey })
  }

  const onUp = () => {
    if (!drag) return
    const moved = Math.abs(drag.dx) > 2 || drag.targetTrack !== drag.trackId
    const { patch } = landing(drag)
    setDrag(null)
    if (!moved) return
    if (drag.mode === 'move') {
      const ops: CompositionOp[] = [
        {
          op: 'move',
          id: drag.id,
          start: patch.start,
          trackId: drag.targetTrack !== drag.trackId ? drag.targetTrack : undefined,
        },
      ]
      // `in` changes only when trimming; a magnet stop on move changes only the start.
      if ('in' in patch) ops.push({ op: 'update', id: drag.id, patch })
      apply(ops)
    } else apply([{ op: 'update', id: drag.id, patch }])
  }

  const onDrop = async (e: React.DragEvent, track: Track) => {
    const id = e.dataTransfer.getData('application/x-shotbeam-asset')
    if (!id) return
    e.preventDefault()
    const free = e.altKey || !magnet
    const want = xToTime(e.clientX)
    const { asset } = await api.get<{ asset: Asset }>(`/api/assets/${id}`)
    // Video dropped on an audio track brings its sound only.
    const type = track.kind === 'audio' ? 'audio' : asset.kind === 'audio' ? 'audio' : 'clip'
    if (type === 'audio' && !asset.hasAudio) return
    const len = asset.kind === 'image' ? 3 : (asset.duration ?? 5)
    const fits = TRACK_ITEMS[track.kind].includes(type)
    let start = want
    if (fits && !free)
      start = nearestFree(track, null, want, len, Number.POSITIVE_INFINITY, zoom) ?? want
    apply([
      {
        op: 'add',
        trackId: fits ? track.id : undefined,
        item: { type, assetId: id, in: 0, out: len, start },
      },
    ])
  }

  const removeTrack = (t: Track) => apply([{ op: 'removeTrack', trackId: t.id }])

  const ticks: number[] = []
  const step = zoom > 120 ? 0.5 : zoom > 50 ? 1 : zoom > 20 ? 5 : 10
  for (let s = 0; s * zoom < width; s += step) ticks.push(s)

  const label = (i: Item) => {
    switch (i.type) {
      case 'clip':
      case 'audio':
        return assets.get(i.assetId)?.name ?? '…'
      case 'text':
        return i.text
      case 'captions':
        return `Сабы · ${i.words.length} слов`
      case 'motion':
        return `${i.template} · ${i.engine}`
    }
  }

  const live = drag ? landing(drag) : null
  const firstAudio = composition.tracks.findIndex((t) => t.kind === 'audio')

  return (
    <div className="flex h-full min-h-0 flex-col border-t bg-card">
      <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
        <span className="font-mono tabular-nums text-foreground">
          {timecode(time)} / {timecode(duration)}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-xs"
          onClick={() => apply([{ op: 'addTrack', kind: 'visual' }])}
        >
          <Plus className="size-3.5" />
          Видео-дорожка
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-xs"
          onClick={() => apply([{ op: 'addTrack', kind: 'audio' }])}
        >
          <Plus className="size-3.5" />
          Аудио-дорожка
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              aria-pressed={magnet}
              className={cn(
                'h-7 gap-1 px-2 text-xs',
                magnet ? 'text-brand aria-pressed:text-brand' : '',
              )}
              onClick={() => setMagnet(!magnet)}
            >
              {magnet ? <Magnet className="size-3.5" /> : <Layers className="size-3.5" />}
              {magnet ? 'Магнит' : 'Наложение'}
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-72">
            {magnet
              ? 'Края липнут, элементы не налезают друг на друга. Дотащи сильнее — и элемент пробьёт соседа и ляжет поверх. Alt — свободно.'
              : 'Свободный режим: элементы кладутся куда отпустил и могут перекрываться.'}
          </TooltipContent>
        </Tooltip>
        <span className="ml-auto">Масштаб</span>
        <input
          type="range"
          min="10"
          max="300"
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="w-32 accent-[var(--color-brand)]"
        />
      </div>
      <div
        ref={lanes}
        className="relative min-h-0 flex-1 overflow-auto"
        onPointerMove={onMove}
        onPointerUp={onUp}
      >
        <div style={{ width: width + HEADER }} className="relative">
          {/* Ruler */}
          <div
            className="sticky top-0 z-20 flex h-6 border-b bg-card"
            onPointerDown={(e) => {
              setTime(xToTime(e.clientX))
              const move = (ev: PointerEvent) => setTime(xToTime(ev.clientX))
              const up = () => {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
              }
              window.addEventListener('pointermove', move)
              window.addEventListener('pointerup', up)
            }}
          >
            <div
              className="sticky left-0 z-10 shrink-0 border-r bg-card"
              style={{ width: HEADER }}
            />
            <div className="relative flex-1">
              {ticks.map((s) => (
                <span
                  key={s}
                  className="absolute top-0 h-full border-l border-border pl-1 text-[10px] text-muted-foreground"
                  style={{ left: s * zoom }}
                >
                  {Number.isInteger(s) ? timecode(s, true) : ''}
                </span>
              ))}
            </div>
          </div>

          {composition.tracks.map((track, index) => (
            <div
              key={track.id}
              className={cn(
                'group/track flex border-b',
                index === firstAudio && 'border-t-4 border-t-border',
              )}
              style={{ height: ROW }}
              data-track-id={track.id}
            >
              <div
                className="sticky left-0 z-10 flex shrink-0 items-center gap-0.5 border-r bg-card px-2"
                style={{ width: HEADER }}
              >
                <span
                  className={cn(
                    'w-7 text-xs font-semibold',
                    track.kind === 'visual' ? 'text-sky-500' : 'text-emerald-500',
                  )}
                >
                  {trackLabel(composition, track.id)}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="size-6"
                  onClick={() =>
                    apply([{ op: 'track', trackId: track.id, patch: { muted: !track.muted } }])
                  }
                  aria-label={track.muted ? 'Включить звук' : 'Выключить звук'}
                >
                  {track.muted ? (
                    <VolumeX className="size-3.5" />
                  ) : (
                    <Volume2 className="size-3.5" />
                  )}
                </Button>
                {track.kind === 'visual' ? (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="size-6"
                    onClick={() =>
                      apply([{ op: 'track', trackId: track.id, patch: { hidden: !track.hidden } }])
                    }
                    aria-label={track.hidden ? 'Показать' : 'Скрыть'}
                  >
                    {track.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </Button>
                ) : null}
                {track.items.length === 0 ? (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="ml-auto size-6 opacity-0 group-hover/track:opacity-100"
                    onClick={() => removeTrack(track)}
                    aria-label="Убрать пустую дорожку"
                  >
                    <X className="size-3.5" />
                  </Button>
                ) : null}
              </div>
              {/* biome-ignore lint/a11y/noStaticElementInteractions: the lane is a pointer and drop surface */}
              <div
                className={cn(
                  'relative flex-1',
                  track.hidden && 'opacity-40',
                  track.kind === 'audio' && 'bg-muted/30',
                  drag?.targetTrack === track.id && drag.trackId !== track.id && 'bg-brand/5',
                )}
                onPointerDown={(e) => {
                  if (e.target === e.currentTarget) {
                    select(null)
                    setTime(xToTime(e.clientX))
                  }
                }}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes('application/x-shotbeam-asset'))
                    e.preventDefault()
                }}
                onDrop={(e) => void onDrop(e, track)}
              >
                {composition.tracks
                  .flatMap((t) => t.items.map((i) => ({ i, t })))
                  .filter(({ i, t }) =>
                    drag?.id === i.id ? drag.targetTrack === track.id : t.id === track.id,
                  )
                  .map(({ i, t }) => {
                    const dragging = drag?.id === i.id && live
                    const shown = dragging ? ({ ...i, ...live.patch } as Item) : i
                    const covers = dragging ? live.overlap : !isFree(t, i.start, itemEnd(i), i.id)
                    const color =
                      i.type === 'audio' && assets.get(i.assetId)?.role !== 'voice'
                        ? COLORS.music
                        : COLORS[i.type]
                    return (
                      <TimelineItemMenu
                        key={i.id}
                        item={i}
                        track={t}
                        asset={
                          i.type === 'clip' || i.type === 'audio'
                            ? assets.get(i.assetId)
                            : undefined
                        }
                        apply={apply}
                      >
                        <div
                          className={cn(
                            'absolute top-1 bottom-1 flex cursor-grab items-center overflow-hidden rounded-md border text-[11px] font-medium text-white shadow-sm active:cursor-grabbing',
                            color,
                            selected === i.id && 'ring-2 ring-foreground',
                            covers &&
                              'outline-2 outline-dashed outline-offset-[-2px] outline-white/90',
                            dragging && 'z-10 opacity-90',
                          )}
                          style={{
                            left: shown.start * zoom,
                            width: Math.max(4, (itemEnd(shown) - shown.start) * zoom),
                          }}
                          title={covers ? 'Лежит поверх соседнего элемента' : undefined}
                          onPointerDown={(e) => onItemDown(e, 'move', i, t)}
                        >
                          <span
                            className="absolute inset-y-0 left-0 w-2 cursor-ew-resize hover:bg-white/30"
                            onPointerDown={(e) => onItemDown(e, 'trim-start', i, t)}
                          />
                          {covers ? <Layers className="ml-2 size-3 shrink-0" /> : null}
                          <span className="truncate px-2.5">{label(i)}</span>
                          <span
                            className="absolute inset-y-0 right-0 w-2 cursor-ew-resize hover:bg-white/30"
                            onPointerDown={(e) => onItemDown(e, 'trim-end', i, t)}
                          />
                        </div>
                      </TimelineItemMenu>
                    )
                  })}
              </div>
            </div>
          ))}

          {/* Playhead */}
          <div
            className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-brand"
            style={{ left: HEADER + time * zoom }}
          >
            <div className="-ml-1.5 size-3 rotate-45 bg-brand" />
          </div>
        </div>
      </div>
    </div>
  )
}
