import type { Project } from '@shotbeam/core'
import { TooltipProvider } from '@shotbeam/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Toaster } from 'sonner'
import { EngineOffline } from '../components/EngineOffline'
import { GlobalContextMenu } from '../components/GlobalContextMenu'
import { ShortcutsDialog } from '../components/ShortcutsDialog'
import { Sidebar } from '../components/Sidebar'
import { TitleBar } from '../components/TitleBar'
import { useEngineEvents, useLive } from '../lib/events'
import { matches } from '../lib/hotkeys'
import { useProjects } from '../lib/queries'
import type { Route } from '../lib/store'
import { applyTheme, useUi } from '../lib/store'
import { EditorPage } from '../pages/editor/EditorPage'
import { FormatsPage } from '../pages/FormatsPage'
import { MediaPage } from '../pages/MediaPage'
import { MotionPage } from '../pages/MotionPage'
import { ReferencesPage } from '../pages/ReferencesPage'
import { SettingsPage } from '../pages/SettingsPage'
import { VideosPage } from '../pages/VideosPage'
import { VoicePage } from '../pages/VoicePage'
import { WelcomePage } from '../pages/WelcomePage'

/** Ctrl+1…6: the sections in sidebar order. */
const SECTIONS: Route[] = [
  { kind: 'media' },
  { kind: 'videos' },
  { kind: 'references' },
  { kind: 'formats' },
  { kind: 'voice' },
  { kind: 'motion' },
]

/** Shortcuts that work on every screen, plus the mouse's back and forward buttons. */
function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState()
      const done = (action?: () => void) => {
        e.preventDefault()
        action?.()
      }
      if (matches(e, { code: 'ArrowLeft', alt: true })) return done(() => ui.goBack())
      if (matches(e, { code: 'ArrowRight', alt: true })) return done(() => ui.goForward())
      if (matches(e, { code: 'Comma', mod: true }))
        return done(() => ui.navigate({ kind: 'settings' }))
      if (matches(e, { code: 'Backslash', mod: true })) return done(() => ui.toggleSidebar())
      if (matches(e, { code: 'Slash', mod: true }))
        return done(() => ui.setShortcutsOpen(!ui.shortcutsOpen))
      SECTIONS.forEach((route, i) => {
        if (matches(e, { code: `Digit${i + 1}`, mod: true })) {
          done()
          ui.navigate(route)
        }
      })
    }
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) useUi.getState().goBack()
      if (e.button === 4) useUi.getState().goForward()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mouseup', onMouse)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mouseup', onMouse)
    }
  }, [])
}

export function App() {
  const qc = useQueryClient()
  useEngineEvents(qc)
  useGlobalShortcuts()
  const connected = useLive((s) => s.connected)
  const route = useUi((s) => s.route)
  const theme = useUi((s) => s.theme)
  const sidebarOpen = useUi((s) => s.sidebarOpen)
  const projectId = useUi((s) => s.projectId)
  const setProject = useUi((s) => s.setProject)
  const projects = useProjects()

  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'system') return
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const on = () => applyTheme('system')
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [theme])

  // The remembered project is gone (deleted, another library): open the first one.
  useEffect(() => {
    const list = projects.data
    if (!list) return
    if (!projectId || !list.some((p) => p.id === projectId)) setProject(list[0]?.id ?? null)
  }, [projects.data, projectId, setProject])

  const project = projects.data?.find((p) => p.id === projectId) ?? null
  const needsProject = route.kind !== 'settings' && route.kind !== 'motion'

  let page: React.ReactNode
  if (!connected && projects.isError) page = <EngineOffline />
  else if (needsProject && projects.data && !project) page = <WelcomePage />
  else if (!project && needsProject) page = null
  else if (project || !needsProject)
    switch (route.kind) {
      case 'media':
        page = <MediaPage project={project as Project} assetId={route.assetId} />
        break
      case 'references':
        page = <ReferencesPage project={project as Project} id={route.id} />
        break
      case 'formats':
        page = <FormatsPage project={project as Project} id={route.id} />
        break
      case 'videos':
        page = <VideosPage project={project as Project} />
        break
      case 'editor':
        page = <EditorPage key={route.id} id={route.id} />
        break
      case 'voice':
        page = <VoicePage project={project as Project} />
        break
      case 'motion':
        page = <MotionPage />
        break
      case 'settings':
        page = <SettingsPage />
        break
    }

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-full flex-col">
        <TitleBar project={project} />
        <div className="flex min-h-0 flex-1">
          {sidebarOpen && route.kind !== 'editor' ? <Sidebar /> : null}
          <main className="min-w-0 flex-1 overflow-y-auto">{page}</main>
        </div>
      </div>
      <ShortcutsDialog />
      <GlobalContextMenu />
      <Toaster position="bottom-right" richColors closeButton />
    </TooltipProvider>
  )
}
