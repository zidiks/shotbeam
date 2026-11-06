import type { Composition, Item } from '@shotbeam/core'
import { compositionDuration } from '@shotbeam/core'
import { create } from 'zustand'

/*
 * Editor state that is not the document: the playhead, playback, selection, zoom, magnet and
 * the copied item. One editor is open at a time, so one store.
 */

interface EditorState {
  time: number
  playing: boolean
  selected: string | null
  /** Pixels per second on the timeline. */
  zoom: number
  /**
   * What must stay put on screen when zoom changes: `time` at `x` px from the start of the lanes.
   * Null: the playhead stays put (or the left edge, when the playhead is out of view).
   */
  zoomAnchor: { time: number; x: number } | null
  /** Bumped to ask the timeline to fit the whole video in view. */
  fitTick: number
  /** Shade where the platforms draw their UI over a vertical video. */
  safeZones: boolean
  /** Edges stick and items do not cover each other unless pushed through (see Timeline). */
  magnet: boolean
  /** An item copied with Ctrl+C, pasted at the playhead. */
  clipboard: Item | null
  setTime: (t: number) => void
  setPlaying: (p: boolean) => void
  select: (id: string | null) => void
  setZoom: (z: number, anchor?: { time: number; x: number }) => void
  fitView: () => void
  setSafeZones: (on: boolean) => void
  setMagnet: (m: boolean) => void
  copy: (item: Item | null) => void
}

/** Pixels per second: a long video whole, down to single frames. */
export const ZOOM_MIN = 5
export const ZOOM_MAX = 600

function loadFlag(key: string, fallback: boolean) {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

function loadMagnet() {
  try {
    return localStorage.getItem('shotbeam.magnet') !== '0'
  } catch {
    return true
  }
}

export const useEditor = create<EditorState>((set) => ({
  time: 0,
  playing: false,
  selected: null,
  zoom: 80,
  zoomAnchor: null,
  fitTick: 0,
  safeZones: loadFlag('shotbeam.safeZones', false),
  magnet: loadMagnet(),
  clipboard: null,
  setTime: (time) => set({ time: Math.max(0, time) }),
  setPlaying: (playing) => set({ playing }),
  select: (selected) => set({ selected }),
  setZoom: (zoom, anchor) =>
    set({ zoom: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom)), zoomAnchor: anchor ?? null }),
  fitView: () => set((s) => ({ fitTick: s.fitTick + 1 })),
  setSafeZones: (safeZones) => {
    try {
      localStorage.setItem('shotbeam.safeZones', safeZones ? '1' : '0')
    } catch {}
    set({ safeZones })
  },
  setMagnet: (magnet) => {
    try {
      localStorage.setItem('shotbeam.magnet', magnet ? '1' : '0')
    } catch {}
    set({ magnet })
  },
  copy: (clipboard) => set({ clipboard }),
}))

if (import.meta.env.DEV) (window as unknown as { __editor: typeof useEditor }).__editor = useEditor

/**
 * Drives the playhead while playing; stops at the end. A timer, not requestAnimationFrame: a
 * window that is covered gets no animation frames, and playback must go on (the sound too).
 */
export function startClock(c: () => Composition | undefined) {
  let timer: ReturnType<typeof setInterval> | null = null
  let last = 0
  const stop = () => {
    if (timer) clearInterval(timer)
    timer = null
  }
  const tick = () => {
    const s = useEditor.getState()
    if (!s.playing) return stop()
    const now = performance.now()
    const comp = c()
    const end = comp ? compositionDuration(comp) : 0
    const next = s.time + (now - last) / 1000
    last = now
    if (next >= end) {
      useEditor.setState({ time: end, playing: false })
      return stop()
    }
    useEditor.setState({ time: next })
  }
  const unsub = useEditor.subscribe((s, prev) => {
    if (s.playing && !prev.playing) {
      const comp = c()
      if (comp && s.time >= compositionDuration(comp) - 0.05) useEditor.setState({ time: 0 })
      last = performance.now()
      stop()
      timer = setInterval(tick, 1000 / 60)
    }
    if (!s.playing) stop()
  })
  return () => {
    unsub()
    stop()
  }
}
