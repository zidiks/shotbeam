import type { Asset, Composition, Format, Reference, Source, Voice } from '@shotbeam/core'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@shotbeam/ui'
import { useQueryClient } from '@tanstack/react-query'
import {
  Captions,
  Clapperboard,
  Copy,
  ExternalLink,
  Film,
  FolderOpen,
  Pencil,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
} from 'lucide-react'
import type * as React from 'react'
import { toast } from 'sonner'
import { api } from '../lib/api'
import { errorToast, useCompositions } from '../lib/queries'
import { useUi } from '../lib/store'

/*
 * Right-click menus with the actions for each kind of thing. Every action goes to the engine;
 * lists refresh from its events. Deleting asks first and says what else it affects.
 */

async function run(fn: () => Promise<unknown>, ok?: string) {
  try {
    await fn()
    if (ok) toast.success(ok)
    return true
  } catch (err) {
    errorToast(err)
    return false
  }
}

export const reveal = (path: string) => run(() => api.post('/api/reveal', { path }))

export const copyText = (text: string, what = 'Скопировано') =>
  run(() => navigator.clipboard.writeText(text), what)

function Menu({ children, content }: { children: React.ReactNode; content: React.ReactNode }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-60">{content}</ContextMenuContent>
    </ContextMenu>
  )
}

export async function deleteAssetAsk(asset: Asset) {
  if (asset.sourceId) {
    toast('Это файл из подключённой папки', {
      description: 'Удали его в самой папке (покажу где) — из медиатеки он уйдёт сам.',
      action: { label: 'Показать', onClick: () => void reveal(asset.path) },
    })
    return false
  }
  const { compositions } = await api.get<{ compositions: string[] }>(
    `/api/assets/${asset.id}/usage`,
  )
  const warn = compositions.length
    ? `\n\nОн стоит в видео: ${compositions.join(', ')}. Там он пропадёт.`
    : ''
  if (!confirm(`Удалить «${asset.name}» вместе с файлом?${warn}`)) return false
  return run(
    () => api.del(`/api/assets/${asset.id}${compositions.length ? '?force=1' : ''}`),
    'Удалено',
  )
}

export function AssetMenu({
  asset,
  children,
  onOpen,
  onDeleted,
}: {
  asset: Asset
  children: React.ReactNode
  onOpen?: () => void
  onDeleted?: () => void
}) {
  const projectId = useUi((s) => s.projectId)
  const navigate = useUi((s) => s.navigate)
  const comps = useCompositions(projectId ?? undefined).data ?? []
  const addTo = (c: Composition) =>
    run(
      () =>
        api.post(`/api/compositions/${c.id}/ops`, {
          ops: [
            {
              op: 'add',
              item: {
                type: asset.kind === 'audio' ? 'audio' : 'clip',
                assetId: asset.id,
                in: 0,
                out: asset.kind === 'image' ? 3 : (asset.duration ?? 5),
              },
            },
          ],
        }),
      `Добавлено в «${c.name}»`,
    )
  return (
    <Menu
      content={
        <>
          {onOpen ? (
            <ContextMenuItem onSelect={onOpen}>
              <Pencil />
              Открыть
            </ContextMenuItem>
          ) : null}
          {asset.role !== 'reference' && asset.status === 'ready' ? (
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Film />В видео
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-56">
                {comps.length ? (
                  comps.map((c) => (
                    <ContextMenuItem key={c.id} onSelect={() => void addTo(c)}>
                      {c.name}
                    </ContextMenuItem>
                  ))
                ) : (
                  <ContextMenuItem onSelect={() => navigate({ kind: 'videos' })}>
                    Сначала создай видео
                  </ContextMenuItem>
                )}
              </ContextMenuSubContent>
            </ContextMenuSub>
          ) : null}
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => void reveal(asset.path)}>
            <FolderOpen />
            Показать в папке
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void copyText(asset.path, 'Путь скопирован')}>
            <Copy />
            Копировать путь
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() =>
              void run(() => api.post(`/api/assets/${asset.id}/reindex`), 'Переиндексирую')
            }
          >
            <RefreshCw />
            Переиндексировать
          </ContextMenuItem>
          {asset.hasAudio && asset.kind !== 'image' ? (
            <ContextMenuItem
              onSelect={() =>
                void run(() => api.post(`/api/assets/${asset.id}/transcribe`, {}), 'Распознаю речь')
              }
            >
              <Captions />
              Распознать речь заново
            </ContextMenuItem>
          ) : null}
          <ContextMenuSeparator />
          <ContextMenuItem
            destructive
            onSelect={() =>
              void deleteAssetAsk(asset)
                .then((ok) => ok && onDeleted?.())
                .catch(errorToast)
            }
          >
            <Trash2 />
            {asset.sourceId ? 'Удалить… (файл в твоей папке)' : 'Удалить'}
          </ContextMenuItem>
        </>
      }
    >
      {children}
    </Menu>
  )
}

export function ReferenceMenu({
  reference: r,
  children,
  onOpen,
  onDeleted,
}: {
  reference: Reference
  children: React.ReactNode
  onOpen: () => void
  onDeleted?: () => void
}) {
  const navigate = useUi((s) => s.navigate)
  const projectId = useUi((s) => s.projectId)
  const toFormat = () =>
    run(async () => {
      const f = await api.post<Format>('/api/formats', {
        name: r.title.slice(0, 60) || 'Новый формат',
        description: `По референсу ${r.url}`,
        projectId,
        referenceIds: [r.id],
        recipe: { notes: r.analysis },
      })
      navigate({ kind: 'formats', id: f.id })
    })
  return (
    <Menu
      content={
        <>
          <ContextMenuItem onSelect={onOpen}>
            <Pencil />
            Открыть
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => window.open(r.url, '_blank', 'noreferrer')}>
            <ExternalLink />
            Открыть оригинал
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void copyText(r.url, 'Ссылка скопирована')}>
            <Copy />
            Копировать ссылку
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => void toFormat()}>
            <Sparkles />
            Сделать формат
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() =>
              void run(() => api.post(`/api/references/${r.id}/retry`), 'Скачиваю заново')
            }
          >
            <RotateCcw />
            Скачать заново
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            destructive
            onSelect={() => {
              if (confirm(`Удалить референс «${r.title || r.url}» вместе со скачанным видео?`))
                void run(() => api.del(`/api/references/${r.id}`), 'Удалено').then(
                  (ok) => ok && onDeleted?.(),
                )
            }}
          >
            <Trash2 />
            Удалить
          </ContextMenuItem>
        </>
      }
    >
      {children}
    </Menu>
  )
}

export function CompositionMenu({
  composition: c,
  children,
}: {
  composition: Composition
  children: React.ReactNode
}) {
  const navigate = useUi((s) => s.navigate)
  const qc = useQueryClient()
  return (
    <Menu
      content={
        <>
          <ContextMenuItem onSelect={() => navigate({ kind: 'editor', id: c.id })}>
            <Pencil />
            Открыть в редакторе
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              const name = prompt('Название видео', c.name)?.trim()
              if (name && name !== c.name)
                void run(() => api.patch(`/api/compositions/${c.id}`, { name }))
            }}
          >
            <Pencil />
            Переименовать
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() =>
              void run(async () => {
                await api.post(`/api/compositions/${c.id}/duplicate`)
                qc.invalidateQueries({ queryKey: ['composition'] })
              }, 'Копия создана')
            }
          >
            <Copy />
            Дублировать
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() =>
              void run(
                () => api.post(`/api/compositions/${c.id}/render`, { draft: true }),
                'Черновой рендер пошёл',
              )
            }
          >
            <Clapperboard />
            Черновой рендер
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() =>
              void run(
                () => api.post(`/api/compositions/${c.id}/render`, { draft: false }),
                'Рендер пошёл',
              )
            }
          >
            <Clapperboard />
            Финальный рендер
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            destructive
            onSelect={() => {
              if (confirm(`Удалить видео «${c.name}»? Готовые рендеры останутся.`))
                void run(() => api.del(`/api/compositions/${c.id}`), 'Удалено')
            }}
          >
            <Trash2 />
            Удалить
          </ContextMenuItem>
        </>
      }
    >
      {children}
    </Menu>
  )
}

export function FormatMenu({ format: f, children }: { format: Format; children: React.ReactNode }) {
  const navigate = useUi((s) => s.navigate)
  const projectId = useUi((s) => s.projectId)
  return (
    <Menu
      content={
        <>
          <ContextMenuItem onSelect={() => navigate({ kind: 'formats', id: f.id })}>
            <Pencil />
            Открыть
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() =>
              void run(async () => {
                const copy = await api.post<Format>('/api/formats', {
                  name: `${f.name} (копия)`,
                  description: f.description,
                  projectId: f.projectId,
                  recipe: f.recipe,
                  referenceIds: f.referenceIds,
                })
                navigate({ kind: 'formats', id: copy.id })
              })
            }
          >
            <Copy />
            Дублировать
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() =>
              void run(async () => {
                const c = await api.post<Composition>('/api/compositions', {
                  projectId,
                  name: `${f.name} — новое`,
                  formatId: f.id,
                })
                navigate({ kind: 'editor', id: c.id })
              })
            }
          >
            <Film />
            Видео по формату
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            destructive
            onSelect={() => {
              if (confirm(`Удалить формат «${f.name}»?`)) {
                void run(() => api.del(`/api/formats/${f.id}`), 'Удалено').then(
                  (ok) => ok && navigate({ kind: 'formats' }),
                )
              }
            }}
          >
            <Trash2 />
            Удалить
          </ContextMenuItem>
        </>
      }
    >
      {children}
    </Menu>
  )
}

export function SourceMenu({ source: s, children }: { source: Source; children: React.ReactNode }) {
  return (
    <Menu
      content={
        <>
          <ContextMenuItem
            onSelect={() => void run(() => api.post(`/api/sources/${s.id}/scan`), 'Сканирую')}
          >
            <RefreshCw />
            Пересканировать
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void reveal(s.path)}>
            <FolderOpen />
            Открыть папку
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void copyText(s.path, 'Путь скопирован')}>
            <Copy />
            Копировать путь
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            destructive
            onSelect={() => {
              if (
                confirm(
                  `Отключить папку «${s.name}»? Файлы на диске останутся, из медиатеки они уйдут.`,
                )
              )
                void run(() => api.del(`/api/sources/${s.id}`), 'Папка отключена')
            }}
          >
            <Trash2 />
            Отключить папку
          </ContextMenuItem>
        </>
      }
    >
      {children}
    </Menu>
  )
}

export function VoiceMenu({ voice: v, children }: { voice: Voice; children: React.ReactNode }) {
  return (
    <Menu
      content={
        <>
          {v.sample ? (
            <ContextMenuItem onSelect={() => void reveal(v.sample as string)}>
              <FolderOpen />
              Показать образец
            </ContextMenuItem>
          ) : null}
          <ContextMenuItem onSelect={() => void copyText(v.id, 'Id голоса скопирован')}>
            <Copy />
            Копировать id (для Клода)
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            destructive
            onSelect={() => {
              if (confirm(`Удалить голос «${v.name}»? Готовая озвучка останется.`))
                void run(() => api.del(`/api/voices/${v.id}`), 'Удалено')
            }}
          >
            <Trash2 />
            Удалить
          </ContextMenuItem>
        </>
      }
    >
      {children}
    </Menu>
  )
}
