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
  Bot,
  Captions,
  Clapperboard,
  Copy,
  ExternalLink,
  Film,
  FolderOpen,
  Hash,
  Maximize,
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

/** What deleting does to the file itself, said before asking. */
function deleteWhat(asset: Asset) {
  if (asset.sourceId) return 'Файл уйдёт в Корзину — оттуда его можно вернуть.'
  if (['render', 'voice', 'motion', 'reference'].includes(asset.role))
    return 'Файл удалится с диска.'
  return 'Файл, сделанный или загруженный в Shotbeam, удалится; импортированный из твоей папки останется на месте.'
}

/** The upscale choices for a file: model, scale, and the size it comes out at. */
export function upscaleChoices(asset: Asset) {
  const size = (s: number) =>
    asset.width && asset.height ? ` → ${asset.width * s}×${asset.height * s}` : ''
  return [
    { model: 'animevideo' as const, scale: 2, label: `Рисованное / игры ×2${size(2)}` },
    { model: 'animevideo' as const, scale: 3, label: `Рисованное / игры ×3${size(3)}` },
    { model: 'animevideo' as const, scale: 4, label: `Рисованное / игры ×4${size(4)}` },
    { model: 'general' as const, scale: 2, label: `Живая съёмка ×2${size(2)} (медленно)` },
    { model: 'general' as const, scale: 4, label: `Живая съёмка ×4${size(4)} (медленно)` },
  ]
}

export const canUpscale = (asset: Asset) =>
  (asset.kind === 'video' || asset.kind === 'image') &&
  asset.role !== 'reference' &&
  asset.status === 'ready'

/** Starts an upscale; when Real-ESRGAN is missing, offers the settings. */
export async function upscaleAsset(asset: Asset, model: 'animevideo' | 'general', scale: number) {
  try {
    await api.post(`/api/assets/${asset.id}/upscale`, { model, scale })
    toast.success('Апскейл пошёл', {
      description: 'Новый файл появится рядом с оригиналом. Прогресс — в списке задач сверху.',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/не установлен/.test(message))
      toast.error('Real-ESRGAN не установлен', {
        action: {
          label: 'Установить',
          onClick: () => useUi.getState().navigate({ kind: 'settings' }),
        },
      })
    else errorToast(err)
  }
}

export async function deleteAssetAsk(asset: Asset) {
  const { compositions } = await api.get<{ compositions: string[] }>(
    `/api/assets/${asset.id}/usage`,
  )
  const warn = compositions.length
    ? `\n\nОн стоит в видео: ${compositions.join(', ')}. Там он пропадёт.`
    : ''
  if (!confirm(`Удалить «${asset.name}»?\n\n${deleteWhat(asset)}${warn}`)) return false
  return run(
    () => api.del(`/api/assets/${asset.id}${compositions.length ? '?force=1' : ''}`),
    asset.sourceId ? 'В Корзине' : 'Удалено',
  )
}

/**
 * A ready prompt for Claude or another assistant with Shotbeam connected over MCP: take the
 * reference apart, or (once it is) turn the breakdown into a format.
 */
export function referencePrompt(r: Reference) {
  const what = `референс ${r.id}${r.title ? ` («${r.title}»)` : ''} в Shotbeam`
  return r.analysis
    ? `Возьми ${what}: его разбор уже записан. Собери из него формат (create_format) — биты с таймингами, пейсинг, сабы, музыку, голос и переменные, чтобы по нему можно было делать новые ролики для проекта.`
    : `Разбери ${what}: открой get_reference, посмотри кадры через view_sheets и get_frames, оцени хук первых секунд, структуру по битам, ритм монтажа, типографику и сабы, звук и музыку. Запиши разбор через save_reference_analysis и предложи, как превратить его в формат.`
}

export const copyReferencePrompt = (r: Reference) =>
  copyText(referencePrompt(r), 'Промпт скопирован — вставь его в Claude или GPT')

export const copyReferenceId = (r: Reference) => copyText(r.id, 'Id референса скопирован')

export function deleteReferenceAsk(r: Reference) {
  if (!confirm(`Удалить референс «${r.title || r.url}» вместе со скачанным видео?`))
    return Promise.resolve(false)
  return run(() => api.del(`/api/references/${r.id}`), 'Удалено')
}

/** A trash button that shows on hover over a card (the card is a `group`). */
export function DeleteOnHover({ label, onDelete }: { label: string; onDelete: () => void }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: it sits inside card buttons, where a <button> may not
    <span
      role="button"
      tabIndex={0}
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        onDelete()
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.stopPropagation()
        e.preventDefault()
        onDelete()
      }}
      className="absolute top-1.5 right-1.5 z-10 flex size-7 items-center justify-center rounded-md bg-black/65 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive focus-visible:opacity-100"
    >
      <Trash2 className="size-3.5" />
    </span>
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
          {canUpscale(asset) ? (
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Maximize />
                Апскейл
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-72">
                {upscaleChoices(asset).map((c) => (
                  <ContextMenuItem
                    key={`${c.model}-${c.scale}`}
                    onSelect={() => void upscaleAsset(asset, c.model, c.scale)}
                  >
                    {c.label}
                  </ContextMenuItem>
                ))}
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
            {asset.sourceId ? 'Удалить в Корзину' : 'Удалить'}
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
          <ContextMenuItem onSelect={() => void copyReferencePrompt(r)}>
            <Bot />
            {r.analysis ? 'Копировать промпт: сделать формат' : 'Копировать промпт: разобрать'}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void copyReferenceId(r)}>
            <Hash />
            Копировать id
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
            onSelect={() => void deleteReferenceAsk(r).then((ok) => ok && onDeleted?.())}
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
