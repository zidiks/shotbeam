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
  navigate: (route: Route) => void
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
  navigate: (route) => {
    save('shotbeam.route', route)
    set({ route })
  },
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
