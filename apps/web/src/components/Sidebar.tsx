import type { Project } from '@shotbeam/core'
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
} from '@shotbeam/ui'
import { useMutation } from '@tanstack/react-query'
import {
  AudioLines,
  Check,
  ChevronsUpDown,
  Clapperboard,
  Film,
  FolderOpen,
  type LucideIcon,
  PanelLeftClose,
  Plus,
  Settings,
  Sparkles,
  Wand2,
} from 'lucide-react'
import { useState } from 'react'
import { api } from '../lib/api'
import { type MenuEntry, useMenuZone } from '../lib/contextMenu'
import { comboLabel } from '../lib/hotkeys'
import { errorToast, useProjects } from '../lib/queries'
import { type Route, useUi } from '../lib/store'
import { Field, Textarea } from './common'

/** The sections in sidebar order (Ctrl+1…6). */
const NAV: { icon: LucideIcon; label: string; route: Route }[] = [
  { icon: FolderOpen, label: 'Медиа', route: { kind: 'media' } },
  { icon: Film, label: 'Видео', route: { kind: 'videos' } },
  { icon: Sparkles, label: 'Референсы', route: { kind: 'references' } },
  { icon: Clapperboard, label: 'Форматы', route: { kind: 'formats' } },
  { icon: AudioLines, label: 'Голос', route: { kind: 'voice' } },
  { icon: Wand2, label: 'Моушн', route: { kind: 'motion' } },
]

function NavItem({ icon: Icon, label, route }: { icon: LucideIcon; label: string; route: Route }) {
  const current = useUi((s) => s.route)
  const navigate = useUi((s) => s.navigate)
  const active = current.kind === route.kind
  return (
    <button
      type="button"
      onClick={() => navigate(route)}
      data-route={route.kind}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'mb-0.5 flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13.5px] text-sidebar-foreground transition-colors hover:bg-sidebar-accent',
        active && 'bg-sidebar-accent font-medium text-foreground',
      )}
    >
      <Icon className="size-4 opacity-70" />
      <span className="flex-1 truncate text-left">{label}</span>
    </button>
  )
}

export function NewProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const setProject = useUi((s) => s.setProject)
  const create = useMutation({
    mutationFn: () => api.post<Project>('/api/projects', { name: name.trim(), description }),
    onSuccess: (p) => {
      setProject(p.id)
      setName('')
      setDescription('')
      onOpenChange(false)
    },
    onError: errorToast,
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">Новый проект</DialogTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Бренд или продукт: свои исходники, форматы, голос и видео.
        </p>
        <form
          className="mt-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) create.mutate()
          }}
        >
          <Field label="Название">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Level Legends"
            />
          </Field>
          <Field label="О чём" hint="Аудитория, что показываем. Клод читает это перед сценариями.">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button
              type="submit"
              variant="brand"
              disabled={!name.trim()}
              loading={create.isPending}
            >
              Создать
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ProjectSwitcher() {
  const projects = useProjects().data ?? []
  const projectId = useUi((s) => s.projectId)
  const setProject = useUi((s) => s.setProject)
  const [creating, setCreating] = useState(false)
  const current = projects.find((p) => p.id === projectId)
  const navigate = useUi((s) => s.navigate)
  useMenuZone('sidebar', ({ target }) => {
    const route = target.closest('[data-route]')?.getAttribute('data-route')
    const sections: MenuEntry[] = NAV.map((n, i) => ({
      label: n.label,
      icon: n.icon,
      shortcut: comboLabel({ code: `Digit${i + 1}`, mod: true }),
      onSelect: () => navigate(n.route),
    }))
    const opened = route ? NAV.find((n) => n.route.kind === route) : undefined
    return [
      ...(opened
        ? [
            {
              label: `Открыть «${opened.label}»`,
              icon: opened.icon,
              onSelect: () => navigate(opened.route),
            },
            'separator' as const,
          ]
        : []),
      { heading: 'Проекты' },
      ...projects.map(
        (p): MenuEntry => ({
          label: `${p.name}${p.id === projectId ? ' ✓' : ''}`,
          onSelect: () => setProject(p.id),
        }),
      ),
      { label: 'Новый проект', icon: Plus, onSelect: () => setCreating(true) },
      'separator',
      ...(opened ? [] : sections),
      'separator',
      {
        label: 'Скрыть боковую панель',
        icon: PanelLeftClose,
        shortcut: comboLabel({ code: 'Backslash', mod: true }),
        onSelect: () => useUi.getState().toggleSidebar(),
      },
    ]
  })
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-10 w-full items-center gap-2.5 rounded-lg border border-sidebar-border bg-background/60 px-2.5 text-left transition-colors hover:bg-background"
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-brand text-xs font-bold text-brand-foreground">
              {(current?.name ?? '?').slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {current?.name ?? 'Нет проекта'}
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          {projects.map((p) => (
            <DropdownMenuItem key={p.id} onSelect={() => setProject(p.id)}>
              <span className="flex-1 truncate">{p.name}</span>
              {p.id === projectId ? <Check className="size-4" /> : null}
            </DropdownMenuItem>
          ))}
          {projects.length ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <Plus />
            Новый проект
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NewProjectDialog open={creating} onOpenChange={setCreating} />
    </>
  )
}

export function Sidebar() {
  return (
    <aside
      className="flex h-full w-64 shrink-0 select-none flex-col border-r border-sidebar-border bg-sidebar"
      data-menu="sidebar"
    >
      <div className="p-2">
        <ProjectSwitcher />
      </div>
      <nav className="mt-2 flex-1 overflow-y-auto px-2">
        {NAV.map((n) => (
          <NavItem key={n.route.kind} icon={n.icon} label={n.label} route={n.route} />
        ))}
      </nav>
      <div className="border-t border-sidebar-border p-2">
        <NavItem icon={Settings} label="Настройки" route={{ kind: 'settings' }} />
      </div>
    </aside>
  )
}
