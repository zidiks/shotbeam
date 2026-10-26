import { create } from 'zustand'

/*
 * UI state: where we are and which project is open. Kept per device in localStorage
 * (a convenience only; everything that matters lives in the engine).
 */

export type Route =
  | { kind: 'media'; assetId?: string }
  | { kind: 'references'; id?: string }
  | { kind: 'formats'; id?: string }
  | { kind: 'videos' }
  | { kind: 'editor'; id: string }
  | { kind: 'voice' }
  | { kind: 'motion' }
  | { kind: 'settings' }

export type Theme = 'system' | 'light' | 'dark'

interface UiState {
  route: Route
  projectId: string | null
  theme: Theme
  sidebarOpen: boolean
  /** Screens visited before / after the current one (Alt+←/→, the arrows in the title bar). */
  back: Route[]
  forward: Route[]
  shortcutsOpen: boolean
  navigate: (route: Route) => void
  goBack: () => void
  goForward: () => void
  setShortcutsOpen: (open: boolean) => void
  setProject: (id: string | null) => void
  setTheme: (t: Theme) => void
  toggleSidebar: () => void
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

export function applyTheme(theme: Theme) {
  const dark =
    theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  try {
    localStorage.setItem('shotbeam.theme', theme)
  } catch {}
}

const HISTORY = 50

function sameRoute(a: Route, b: Route) {
  return JSON.stringify(a) === JSON.stringify(b)
}

export const useUi = create<UiState>((set) => ({
  route: load<Route>('shotbeam.route', { kind: 'media' }),
  projectId: load<string | null>('shotbeam.project', null),
  theme: ((): Theme => {
    try {
      return (localStorage.getItem('shotbeam.theme') as Theme) || 'system'
    } catch {
      return 'system'
    }
  })(),
  sidebarOpen: true,
  back: [],
  forward: [],
  shortcutsOpen: false,
  navigate: (route) => {
    save('shotbeam.route', route)
    set((s) =>
      sameRoute(s.route, route)
        ? { route }
        : { route, back: [...s.back, s.route].slice(-HISTORY), forward: [] },
    )
  },
  goBack: () =>
    set((s) => {
      const route = s.back[s.back.length - 1]
      if (!route) return s
      save('shotbeam.route', route)
      return { route, back: s.back.slice(0, -1), forward: [s.route, ...s.forward] }
    }),
  goForward: () =>
    set((s) => {
      const [route, ...rest] = s.forward
      if (!route) return s
      save('shotbeam.route', route)
      return { route, back: [...s.back, s.route], forward: rest }
    }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setProject: (projectId) => {
    save('shotbeam.project', projectId)
    set({ projectId })
  },
  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
  },
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}))
