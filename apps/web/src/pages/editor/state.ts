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
  /** Edges stick and items do not cover each other unless pushed through (see Timeline). */
  magnet: boolean
  /** An item copied with Ctrl+C, pasted at the playhead. */
  clipboard: Item | null
  setTime: (t: number) => void
  setPlaying: (p: boolean) => void
  select: (id: string | null) => void
  setZoom: (z: number) => void
  setMagnet: (m: boolean) => void
  copy: (item: Item | null) => void
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
  magnet: loadMagnet(),
  clipboard: null,
  setTime: (time) => set({ time: Math.max(0, time) }),
  setPlaying: (playing) => set({ playing }),
  select: (selected) => set({ selected }),
  setZoom: (zoom) => set({ zoom: Math.max(10, Math.min(400, zoom)) }),
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
