import type { Project } from '@shotbeam/core'
import { TooltipProvider } from '@shotbeam/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Toaster } from 'sonner'
import { EngineOffline } from '../components/EngineOffline'
import { Sidebar } from '../components/Sidebar'
import { TitleBar } from '../components/TitleBar'
import { useEngineEvents, useLive } from '../lib/events'
import { useProjects } from '../lib/queries'
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

export function App() {
  const qc = useQueryClient()
  useEngineEvents(qc)
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
      <Toaster position="bottom-right" richColors closeButton />
    </TooltipProvider>
  )
}
