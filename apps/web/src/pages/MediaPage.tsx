import type { AssetRole, Project, Source } from '@shotbeam/core'
import { Button, cn, Dialog, DialogContent, DialogTitle, Input } from '@shotbeam/ui'
import { useMutation } from '@tanstack/react-query'
import { FolderOpen, FolderPlus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { AssetCard } from '../components/AssetCard'
import { AssetPanel } from '../components/AssetPanel'
import { Choice, Empty, Field, PageHeader } from '../components/common'
import { api } from '../lib/api'
import { ROLE_LABEL } from '../lib/format'
import { errorToast, useAssets, useSources } from '../lib/queries'
import { useUi } from '../lib/store'

/** Running inside the Tauri window (native dialogs available). */
const inDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const FILTERS: { value: AssetRole | 'all'; label: string }[] = [
  { value: 'all', label: 'Всё' },
  { value: 'footage', label: 'Исходники' },
  { value: 'voice', label: 'Озвучка' },
  { value: 'music', label: 'Музыка' },
  { value: 'motion', label: 'Моушн' },
  { value: 'render', label: 'Рендеры' },
]

function AddSourceDialog({
  project,
  open,
  onOpenChange,
}: {
  project: Project
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const [path, setPath] = useState('')
  const [role, setRole] = useState<Source['role']>('footage')
  const [shared, setShared] = useState(false)
  const add = useMutation({
    mutationFn: () =>
      api.post<{ added: number }>('/api/sources', {
        projectId: shared ? null : project.id,
        path: path.trim(),
        role,
      }),
    onSuccess: (r) => {
      toast.success(`Папка подключена: ${r.added} файлов, индексирую`)
      setPath('')
      onOpenChange(false)
    },
    onError: errorToast,
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">Подключить папку</DialogTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Видео, звук и картинки из папки попадут в медиатеку. Оригиналы не копируются и не
          меняются, новые файлы подхватываются сами. Для Google Drive укажи папку Google Drive for
          Desktop (например <code className="font-mono text-xs">G:\Мой диск\Level Legends</code>).
        </p>
        <form
          className="mt-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (path.trim()) add.mutate()
          }}
        >
          <Field label="Путь к папке">
            <div className="flex gap-2">
              <Input
                autoFocus
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="D:\Видео\Level Legends"
              />
              {inDesktop ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    const { open } = await import('@tauri-apps/plugin-dialog')
                    const picked = await open({ directory: true, title: 'Папка с медиа' })
                    if (typeof picked === 'string') setPath(picked)
                  }}
                >
                  Выбрать…
                </Button>
              ) : null}
            </div>
          </Field>
          <Field label="Что в ней">
            <Choice
              value={role}
              onChange={setRole}
              options={[
                { value: 'footage', label: 'Исходники (видео, скриншоты)' },
                { value: 'music', label: 'Музыка' },
                { value: 'sfx', label: 'Звуковые эффекты' },
                { value: 'brand', label: 'Бренд (логотипы, заставки)' },
              ]}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            Общая для всех проектов (например, музыкальная библиотека)
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button type="submit" variant="brand" disabled={!path.trim()} loading={add.isPending}>
              Подключить
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SourcesBar({ project }: { project: Project }) {
  const sources = useSources(project.id).data ?? []
  const scan = useMutation({
    mutationFn: (id: string) => api.post(`/api/sources/${id}/scan`),
    onError: errorToast,
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/sources/${id}`),
    onError: errorToast,
  })
  if (!sources.length) return null
  return (
    <div className="flex flex-wrap gap-2 px-6 pb-3">
      {sources.map((s) => (
        <div
          key={s.id}
          className="group flex h-8 items-center gap-2 rounded-md border bg-card pr-1 pl-2.5 text-[13px]"
          title={s.path}
        >
          <FolderOpen className="size-3.5 text-muted-foreground" />
          <span className="max-w-56 truncate">{s.name}</span>
          <span className="text-xs text-muted-foreground">
            {ROLE_LABEL[s.role]}
            {s.projectId ? '' : ' · общая'}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-6"
            onClick={() => scan.mutate(s.id)}
            aria-label="Пересканировать"
          >
            <RefreshCw className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-6 opacity-0 group-hover:opacity-100"
            onClick={() => {
              if (confirm(`Отключить папку «${s.name}»? Файлы останутся на диске.`))
                remove.mutate(s.id)
            }}
            aria-label="Отключить"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}
    </div>
  )
}

export function MediaPage({ project, assetId }: { project: Project; assetId?: string }) {
  const navigate = useUi((s) => s.navigate)
  const [filter, setFilter] = useState<AssetRole | 'all'>('all')
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const assets = useAssets({
    projectId: project.id,
    role: filter === 'all' ? undefined : filter,
    q: q.trim() || undefined,
  })
  const items = (assets.data?.items ?? []).filter((a) => a.role !== 'reference')

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <PageHeader
          title="Медиа"
          description="Исходники, озвучка, музыка и рендеры проекта. Клод видит то же самое через MCP."
          actions={
            <Button variant="brand" onClick={() => setAdding(true)}>
              <FolderPlus />
              Подключить папку
            </Button>
          }
        />
        <SourcesBar project={project} />
        <div className="flex flex-wrap items-center gap-2 px-6 pb-4">
          <div className="flex gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilter(f.value)}
                className={cn(
                  'h-7 rounded-full border px-3 text-[13px] text-muted-foreground transition-colors hover:text-foreground',
                  filter === f.value &&
                    'border-foreground/30 bg-accent font-medium text-foreground',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative ml-auto w-72">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск по словам в видео, тегам…"
              className="pl-8"
            />
          </div>
        </div>
        {items.length === 0 && !assets.isLoading ? (
          <Empty
            icon={FolderOpen}
            title={q ? 'Ничего не нашлось' : 'Медиатека пуста'}
            action={
              q ? null : (
                <Button variant="brand" onClick={() => setAdding(true)}>
                  Подключить папку
                </Button>
              )
            }
          >
            {q
              ? 'Поиск идёт по названиям, тегам, заметкам и словам, сказанным в видео.'
              : 'Подключи папку с исходниками (локальную или Google Drive for Desktop).'}
          </Empty>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3 px-6 pb-8">
            {items.map((a) => (
              <AssetCard
                key={a.id}
                asset={a}
                selected={a.id === assetId}
                onClick={() =>
                  navigate({ kind: 'media', assetId: a.id === assetId ? undefined : a.id })
                }
              />
            ))}
          </div>
        )}
      </div>
      {assetId ? <AssetPanel id={assetId} onClose={() => navigate({ kind: 'media' })} /> : null}
      <AddSourceDialog project={project} open={adding} onOpenChange={setAdding} />
    </div>
  )
}
