import type { Project } from '@shotbeam/core'
import {
  Button,
  cn,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@shotbeam/ui'
import {
  ArrowLeft,
  CircleAlert,
  CircleCheck,
  ListChecks,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import { useActiveJobs, useLive } from '../lib/events'
import { JOB_LABEL } from '../lib/format'
import { useUi } from '../lib/store'
import { Progress } from './common'

/** Background work: a spinner with a count while anything runs, the list on click. */
function JobsButton() {
  const active = useActiveJobs()
  const all = Object.values(useLive((s) => s.jobs)).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5" aria-label="Фоновые задачи">
          {active.length ? <Spinner className="size-3.5" /> : <ListChecks className="size-4" />}
          {active.length ? <span className="tabular-nums">{active.length}</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-2">
        {all.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">Пока ничего не происходит.</p>
        ) : (
          <ul className="max-h-96 space-y-1 overflow-y-auto">
            {all.slice(0, 20).map((j) => (
              <li key={j.id} className="rounded-md px-2 py-1.5 text-sm">
                <div className="flex items-center gap-2">
                  {j.status === 'error' ? (
                    <CircleAlert className="size-4 shrink-0 text-destructive" />
                  ) : j.status === 'done' ? (
                    <CircleCheck className="size-4 shrink-0 text-success" />
                  ) : (
                    <Spinner className="size-4 shrink-0" />
                  )}
                  <span className="font-medium">{JOB_LABEL[j.kind] ?? j.kind}</span>
                  <span className="truncate text-muted-foreground">{j.message}</span>
                </div>
                {j.status === 'running' ? (
                  <Progress value={j.progress} className="mt-1.5 ml-6" />
                ) : null}
                {j.error ? (
                  <p className="mt-1 ml-6 line-clamp-3 text-xs text-destructive" data-selectable>
                    {j.error}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}

export function TitleBar({ project }: { project: Project | null }) {
  const ui = useUi()
  const connected = useLive((s) => s.connected)
  const inEditor = ui.route.kind === 'editor'
  return (
    <header className="flex h-11 shrink-0 select-none items-stretch border-b">
      <div
        className={cn(
          'flex shrink-0 items-center gap-1 pr-2 pl-3',
          ui.sidebarOpen && !inEditor && 'w-64 border-r border-sidebar-border bg-sidebar',
        )}
      >
        {inEditor ? (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => ui.navigate({ kind: 'videos' })}
            aria-label="К видео"
          >
            <ArrowLeft />
          </Button>
        ) : null}
        <span className="mr-auto px-1 text-sm font-semibold tracking-tight">
          Shot<span className="text-brand">beam</span>
        </span>
        {!inEditor ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={ui.toggleSidebar}
                aria-label="Боковая панель"
              >
                {ui.sidebarOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{ui.sidebarOpen ? 'Скрыть панель' : 'Показать панель'}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 px-3">
        <span className="truncate text-[13px] text-muted-foreground">{project?.name}</span>
        <div className="ml-auto flex items-center gap-1">
          {!connected ? <span className="text-xs text-destructive">движок не отвечает</span> : null}
          <JobsButton />
        </div>
      </div>
    </header>
  )
}
