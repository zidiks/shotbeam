import type { LucideIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'

/*
 * Right-click everywhere. The browser's own menu never shows (GlobalContextMenu). Cards and
 * timeline items have their own menus (components/menus.tsx, Radix ContextMenu); everything
 * else is a zone: an element marked `data-menu="<name>"` whose actions a mounted component
 * registers with useMenuZone. A right click opens the nearest zone around the pointer, else
 * the page's own menu ("page"), then the app's.
 */

export interface MenuAction {
  label: string
  icon?: LucideIcon
  /** Shown on the right, e.g. "Ctrl+Z". */
  shortcut?: string
  onSelect: () => void
  disabled?: boolean
  destructive?: boolean
}

export type MenuEntry = MenuAction | 'separator' | { heading: string }

/** What the menu is opened on: the element under the pointer and where in the timeline etc. */
export interface MenuContext {
  /** The element right-clicked. */
  target: Element
  /** The nearest element carrying the zone's `data-menu` (read its data-* for details). */
  zone: Element
  x: number
  y: number
}

export type MenuBuilder = (ctx: MenuContext) => MenuEntry[]

const zones = new Map<string, { current: MenuBuilder }>()

/** The builder for a zone name, if one is mounted. */
export function menuZone(name: string): MenuBuilder | undefined {
  const ref = zones.get(name)
  return ref ? (ctx) => ref.current(ctx) : undefined
}

/**
 * Registers the actions of a zone while the component is mounted. `build` runs when the menu
 * opens, so it always sees the latest state.
 */
export function useMenuZone(name: string, build: MenuBuilder) {
  const ref = useRef(build)
  ref.current = build
  useEffect(() => {
    zones.set(name, ref)
    return () => {
      if (zones.get(name) === ref) zones.delete(name)
    }
  }, [name])
}

/** The menu of the whole page, for right clicks on nothing in particular. */
export const usePageMenu = (build: MenuBuilder) => useMenuZone('page', build)

/** Drops separators at the ends and doubled ones. */
export function tidy(entries: MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = []
  for (const e of entries) {
    if (e === 'separator' && (!out.length || out[out.length - 1] === 'separator')) continue
    out.push(e)
  }
  while (out[out.length - 1] === 'separator') out.pop()
  return out
}
