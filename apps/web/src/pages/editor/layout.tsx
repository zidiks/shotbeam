import { cn } from '@shotbeam/ui'
import { RotateCcw } from 'lucide-react'
import { useRef } from 'react'
import { create } from 'zustand'
import { useMenuZone } from '../../lib/contextMenu'

/*
 * The editor's panel sizes: media bin, inspector, timeline. Dragged by the borders between them,
 * remembered per device; double-click a border (or its right-click menu) to reset.
 */

export interface PanelSizes {
  bin: number
  inspector: number
  timeline: number
}

const DEFAULTS: PanelSizes = { bin: 256, inspector: 320, timeline: 260 }
const KEY = 'shotbeam.editorLayout'

const LIMITS: Record<keyof PanelSizes, (s: number) => number> = {
  bin: (v) => Math.max(160, Math.min(560, v)),
  inspector: (v) => Math.max(240, Math.min(640, v)),
  // Leave the preview and toolbar at least ~220 px.
  timeline: (v) => Math.max(120, Math.min(window.innerHeight - 220, v)),
}

function load(): PanelSizes {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as PanelSizes) }
  } catch {
    return DEFAULTS
  }
}

export const useLayout = create<
  PanelSizes & {
    set: (k: keyof PanelSizes, v: number) => void
    reset: (k?: keyof PanelSizes) => void
  }
>((set, get) => {
  const persist = () => {
    try {
      const { bin, inspector, timeline } = get()
      localStorage.setItem(KEY, JSON.stringify({ bin, inspector, timeline }))
    } catch {}
  }
  return {
    ...load(),
    set: (k, v) => {
      set({ [k]: LIMITS[k](v) } as Partial<PanelSizes>)
      persist()
    },
    reset: (k) => {
      set(k ? ({ [k]: DEFAULTS[k] } as Partial<PanelSizes>) : DEFAULTS)
      persist()
    },
  }
})

const NAMES: Record<keyof PanelSizes, string> = {
  bin: 'панели медиа',
  inspector: 'инспектора',
  timeline: 'таймлайна',
}

/**
 * A border to drag. `panel` grows by the drag in `sign` direction (+1: right / down grows it).
 */
export function Splitter({
  panel,
  sign,
  className,
}: {
  panel: keyof PanelSizes
  sign: 1 | -1
  className?: string
}) {
  const vertical = panel === 'timeline'
  const start = useRef<{ at: number; size: number } | null>(null)
  useMenuZone('splitter', ({ zone }) => {
    const k = zone.getAttribute('data-panel') as keyof PanelSizes
    return [
      {
        label: `Сбросить размер ${NAMES[k]}`,
        icon: RotateCcw,
        onSelect: () => useLayout.getState().reset(k),
      },
      {
        label: 'Сбросить все панели',
        icon: RotateCcw,
        onSelect: () => useLayout.getState().reset(),
      },
    ]
  })
  return (
    // biome-ignore lint/a11y/useSemanticElements: a draggable border, not a static separator
    <div
      role="separator"
      aria-orientation={vertical ? 'horizontal' : 'vertical'}
      aria-valuenow={useLayout((s) => s[panel])}
      tabIndex={-1}
      data-menu="splitter"
      data-panel={panel}
      title="Тяни, чтобы изменить размер; двойной клик — сбросить"
      className={cn(
        'group relative z-20 shrink-0 bg-border',
        vertical ? 'h-px w-full cursor-row-resize' : 'h-full w-px cursor-col-resize',
        className,
      )}
      onDoubleClick={() => useLayout.getState().reset(panel)}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        start.current = { at: vertical ? e.clientY : e.clientX, size: useLayout.getState()[panel] }
        document.body.style.cursor = vertical ? 'row-resize' : 'col-resize'
      }}
      onPointerMove={(e) => {
        const s = start.current
        if (!s) return
        const delta = (vertical ? e.clientY : e.clientX) - s.at
        useLayout.getState().set(panel, s.size + delta * sign)
      }}
      onPointerUp={() => {
        start.current = null
        document.body.style.cursor = ''
      }}
    >
      {/* A wider grab area than the 1 px line, highlighted on hover. */}
      <span
        className={cn(
          'absolute transition-colors group-hover:bg-brand/50 group-active:bg-brand',
          vertical ? '-top-1 -bottom-1 inset-x-0' : '-left-1 -right-1 inset-y-0',
        )}
      />
    </div>
  )
}
