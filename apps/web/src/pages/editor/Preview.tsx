import type {
  AudioItem,
  CaptionsItem,
  ClipItem,
  Composition,
  MotionItem,
  TextItem,
} from '@shotbeam/core'
import { captionGroups, itemEnd } from '@shotbeam/core'
import { useEffect, useRef, useState } from 'react'
import { mediaUrl } from '../../lib/api'
import { resolveFamily, useLibraryFonts } from './fonts'
import { useEditor } from './state'

/*
 * A live approximation of the render in the browser: proxies in <video>, audio in <audio>, text
 * and captions as DOM in frame pixels scaled to the preview. The render itself (ffmpeg) is the
 * truth; this is for editing.
 */

/** Items this close to the playhead stay mounted, so a cut does not wait for loading. */
const PRELOAD_BEFORE = 1
const PRELOAD_AFTER = 4

function fadeOpacity(t: number, start: number, end: number, fadeIn: number, fadeOut: number) {
  let o = 1
  if (fadeIn > 0) o = Math.min(o, (t - start) / fadeIn)
  if (fadeOut > 0) o = Math.min(o, (end - t) / fadeOut)
  return Math.max(0, Math.min(1, o))
}

/** Keeps a media element at the timeline position: seek when paused, drift-correct when playing. */
function useSyncedMedia(
  ref: React.RefObject<HTMLMediaElement | null>,
  opts: { active: boolean; mediaTime: number; playing: boolean; rate: number; volume: number },
) {
  const { active, mediaTime, playing, rate, volume } = opts
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.volume = Math.max(0, Math.min(1, volume))
    el.playbackRate = rate
    if (!active) {
      if (!el.paused) el.pause()
      // Ready at the in point for when it becomes active.
      if (Math.abs(el.currentTime - mediaTime) > 0.05) el.currentTime = Math.max(0, mediaTime)
      return
    }
    if (playing) {
      if (Math.abs(el.currentTime - mediaTime) > 0.25) el.currentTime = mediaTime
      if (el.paused) void el.play().catch(() => {})
    } else {
      if (!el.paused) el.pause()
      if (Math.abs(el.currentTime - mediaTime) > 0.02) el.currentTime = mediaTime
    }
  }, [ref, active, mediaTime, playing, rate, volume])
}

function ClipLayer({
  item,
  time,
  playing,
  muted,
}: {
  item: ClipItem
  time: number
  playing: boolean
  muted: boolean
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const end = itemEnd(item)
  const active = time >= item.start && time < end
  const mediaTime = item.in + Math.max(0, Math.min(time, end) - item.start) * item.speed
  useSyncedMedia(ref, {
    active,
    mediaTime,
    playing,
    rate: item.speed,
    volume: muted ? 0 : item.volume,
  })
  return (
    <div
      data-item-id={item.id}
      className="absolute inset-0 overflow-hidden"
      style={{
        opacity: active ? fadeOpacity(time, item.start, end, item.fadeIn, item.fadeOut) : 0,
        pointerEvents: active ? 'auto' : 'none',
      }}
    >
      <video
        ref={ref}
        src={mediaUrl(item.assetId, 'play')}
        muted={muted}
        playsInline
        preload="auto"
        className="absolute inset-0 size-full"
        style={{
          objectFit: item.fit,
          objectPosition: `${item.focus.x * 100}% ${item.focus.y * 100}%`,
          transform: item.zoom !== 1 ? `scale(${item.zoom})` : undefined,
          transformOrigin: `${item.focus.x * 100}% ${item.focus.y * 100}%`,
        }}
      />
    </div>
  )
}

function MotionLayer({
  item,
  time,
  playing,
}: {
  item: MotionItem
  time: number
  playing: boolean
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const end = itemEnd(item)
  const active = time >= item.start && time < end
  useSyncedMedia(ref, {
    active,
    mediaTime: Math.max(0, time - item.start),
    playing,
    rate: 1,
    volume: 0,
  })
  if (!item.renderedAssetId) {
    return active ? (
      <div
        data-item-id={item.id}
        className="absolute inset-[8%] flex items-center justify-center rounded-xl border-2 border-dashed border-white/50 bg-black/40 text-center text-white"
      >
        <div>
          <p className="text-[4cqw] font-semibold">{item.template}</p>
          <p className="text-[2.6cqw] opacity-75">{item.engine} · отрендерится вместе с видео</p>
        </div>
      </div>
    ) : null
  }
  return (
    <video
      ref={ref}
      src={mediaUrl(item.renderedAssetId, 'original')}
      muted
      playsInline
      preload="auto"
      data-item-id={item.id}
      className="absolute inset-0 size-full object-contain"
      style={{ opacity: active ? 1 : 0, pointerEvents: active ? 'auto' : 'none' }}
    />
  )
}

function AudioLayer({
  item,
  time,
  playing,
  muted,
}: {
  item: AudioItem
  time: number
  playing: boolean
  muted: boolean
}) {
  const ref = useRef<HTMLAudioElement>(null)
  const end = itemEnd(item)
  const active = time >= item.start && time < end
  const fade = active ? fadeOpacity(time, item.start, end, item.fadeIn, item.fadeOut) : 0
  useSyncedMedia(ref, {
    active,
    mediaTime: item.in + Math.max(0, time - item.start),
    playing,
    rate: 1,
    volume: muted ? 0 : item.volume * fade * (item.duck ? 0.5 : 1),
  })
  // biome-ignore lint/a11y/useMediaCaption: background audio of the preview
  return <audio ref={ref} src={mediaUrl(item.assetId, 'original')} preload="auto" />
}

function stroke(color: string | null, px: number) {
  if (!color) return undefined
  const s = Math.max(1, px)
  return [
    `${s}px 0`,
    `-${s}px 0`,
    `0 ${s}px`,
    `0 -${s}px`,
    `${s}px ${s}px`,
    `-${s}px -${s}px`,
    `${s}px -${s}px`,
    `-${s}px ${s}px`,
  ]
    .map((o) => `${o} 0 ${color}`)
    .join(', ')
}

function TextLayer({
  item,
  time,
  k,
  fonts,
}: {
  item: TextItem
  time: number
  k: number
  fonts: { family: string }[]
}) {
  const end = itemEnd(item)
  if (time < item.start || time >= end) return null
  const st = item.style
  const size = st.size * k
  return (
    <div
      data-item-id={item.id}
      className="absolute whitespace-pre-wrap"
      style={{
        left: `${st.x * 100}%`,
        top: `${st.y * 100}%`,
        transform: 'translate(-50%, -50%)',
        maxWidth: '88%',
        textAlign: st.align,
        fontFamily: `"${resolveFamily(st.font, fonts)}"`,
        fontSize: size,
        fontWeight: st.weight,
        lineHeight: 1.15,
        color: st.color,
        background: st.background ?? undefined,
        padding: st.background ? `${size * 0.18}px ${size * 0.3}px` : undefined,
        borderRadius: st.background ? size * 0.12 : undefined,
        textShadow: st.background ? undefined : stroke(st.stroke, size * 0.06),
        textTransform: st.uppercase ? 'uppercase' : undefined,
        opacity: fadeOpacity(time, item.start, end, item.fadeIn, item.fadeOut),
      }}
    >
      {item.text}
    </div>
  )
}

function CaptionsLayer({
  item,
  time,
  k,
  fonts,
}: {
  item: CaptionsItem
  time: number
  k: number
  fonts: { family: string }[]
}) {
  const st = item.style
  if (time < item.start || time >= item.start + item.duration) return null
  const group = captionGroups(item.words, st.maxWords).find(
    (g) => time >= g.start && time < g.end + 0.05,
  )
  if (!group) return null
  const size = st.size * k
  return (
    <div
      data-item-id={item.id}
      className="absolute w-[90%] text-center"
      style={{
        left: '50%',
        top: `${st.y * 100}%`,
        transform: 'translate(-50%, -50%)',
        fontFamily: `"${resolveFamily(st.font, fonts)}"`,
        fontSize: size,
        fontWeight: 800,
        lineHeight: 1.15,
        color: st.color,
        textShadow: stroke(st.stroke, size * 0.08),
        textTransform: st.uppercase ? 'uppercase' : undefined,
      }}
    >
      {group.words.map((w, i) => {
        const current =
          time >= w.start &&
          (i === group.words.length - 1 || time < (group.words[i + 1]?.start ?? w.end))
        const said = time >= w.start
        const color =
          st.preset === 'bold-pop'
            ? current
              ? st.highlight
              : undefined
            : st.preset === 'karaoke' && said
              ? st.highlight
              : undefined
        return (
          <span
            key={`${w.start}-${w.text}`}
            style={{
              color,
              display: 'inline-block',
              transform: st.preset === 'bold-pop' && current ? 'scale(1.12)' : undefined,
              margin: `0 ${size * 0.12}px`,
            }}
          >
            {w.text}
          </span>
        )
      })}
    </div>
  )
}

export function Preview({ composition }: { composition: Composition }) {
  const time = useEditor((s) => s.time)
  const playing = useEditor((s) => s.playing)
  const selected = useEditor((s) => s.selected)
  const fonts = useLibraryFonts()
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  // Fit the frame into the available box.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      const k = Math.min(r.width / composition.width, r.height / composition.height)
      setSize({ w: Math.floor(composition.width * k), h: Math.floor(composition.height * k) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [composition.width, composition.height])

  const k = size.w / composition.width

  /**
   * Selects what is under the pointer: the topmost item there; clicking the same spot again
   * goes one layer down (to reach a clip under a full-frame overlay).
   */
  const selectAt = (x: number, y: number) => {
    const ids: string[] = []
    for (const el of document.elementsFromPoint(x, y)) {
      const id = (el as HTMLElement).closest<HTMLElement>('[data-item-id]')?.dataset.itemId
      if (id && !ids.includes(id)) ids.push(id)
    }
    const { selected, select } = useEditor.getState()
    if (!ids.length) return select(null)
    const at = selected ? ids.indexOf(selected) : -1
    select(ids[(at + 1) % ids.length] ?? null)
  }
  // Mounted from a few seconds before an item starts until a moment after it ends.
  const near = (start: number, end: number) =>
    time >= start - PRELOAD_AFTER && time < end + PRELOAD_BEFORE

  return (
    <div ref={box} className="flex size-full items-center justify-center">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: selecting by pointer; the timeline does it by keyboard */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the frame is a pointer surface */}
      <div
        className="relative cursor-pointer overflow-hidden rounded-md shadow-float"
        onClick={(e) => selectAt(e.clientX, e.clientY)}
        style={{
          width: size.w,
          height: size.h,
          background: composition.background,
          containerType: 'inline-size',
        }}
      >
        {selected ? (
          <style>{`[data-item-id="${selected}"] { outline: 2px solid var(--color-brand); outline-offset: -2px; }`}</style>
        ) : null}
        {/* Paint order: visual tracks from the bottom one (V1) up, later items over earlier. */}
        {[
          ...composition.tracks.filter((t) => t.kind === 'visual').reverse(),
          ...composition.tracks.filter((t) => t.kind === 'audio'),
        ].map((track) => {
          if (track.hidden) return null
          return track.items.map((item) => {
            if (!near(item.start, itemEnd(item))) return null
            switch (item.type) {
              case 'clip':
                return (
                  <ClipLayer
                    key={item.id}
                    item={item}
                    time={time}
                    playing={playing}
                    muted={track.muted}
                  />
                )
              case 'motion':
                return <MotionLayer key={item.id} item={item} time={time} playing={playing} />
              case 'audio':
                return (
                  <AudioLayer
                    key={item.id}
                    item={item}
                    time={time}
                    playing={playing}
                    muted={track.muted}
                  />
                )
              case 'text':
                return <TextLayer key={item.id} item={item} time={time} k={k} fonts={fonts} />
              case 'captions':
                return <CaptionsLayer key={item.id} item={item} time={time} k={k} fonts={fonts} />
            }
            return null
          })
        })}
      </div>
    </div>
  )
}
