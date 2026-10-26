import type { Aspect, Composition, Project } from '@shotbeam/core'
import { compositionDuration } from '@shotbeam/core'
import { Button, Dialog, DialogContent, DialogTitle, Input } from '@shotbeam/ui'
import { useMutation } from '@tanstack/react-query'
import { Film, Play, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Choice, Empty, Field, PageHeader, Segmented } from '../components/common'
import { CompositionMenu } from '../components/menus'
import { api, mediaUrl } from '../lib/api'
import { timecode } from '../lib/format'
import { errorToast, useAssets, useCompositions, useFormats } from '../lib/queries'
import { useUi } from '../lib/store'

function NewVideoDialog({
  project,
  open,
  onOpenChange,
}: {
  project: Project
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const navigate = useUi((s) => s.navigate)
  const formats = useFormats(project.id).data ?? []
  const [name, setName] = useState('')
  const [aspect, setAspect] = useState<Aspect>('9:16')
  const [formatId, setFormatId] = useState('')
  const create = useMutation({
    mutationFn: () =>
      api.post<Composition>('/api/compositions', {
        projectId: project.id,
        name: name.trim(),
        aspect: formatId ? undefined : aspect,
        formatId: formatId || null,
      }),
    onSuccess: (c) => navigate({ kind: 'editor', id: c.id }),
    onError: errorToast,
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">Новое видео</DialogTitle>
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
              placeholder="Тизер нового сезона"
            />
          </Field>
          <Field label="Формат" hint="Структура, сабы и звук возьмутся из него.">
            <Choice
              value={formatId || 'none'}
              onChange={(v) => setFormatId(v === 'none' ? '' : v)}
              options={[
                { value: 'none', label: 'Без формата' },
                ...formats.map((f) => ({ value: f.id, label: f.name })),
              ]}
            />
          </Field>
          {!formatId ? (
            <Field label="Кадр">
              <Segmented
                value={aspect}
                onChange={setAspect}
                options={(['9:16', '1:1', '4:5', '16:9'] as const).map((v) => ({
                  value: v,
                  label: v,
                }))}
              />
            </Field>
          ) : null}
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

export function VideosPage({ project }: { project: Project }) {
  const navigate = useUi((s) => s.navigate)
  const comps = useCompositions(project.id).data ?? []
  const renders = useAssets({ projectId: project.id, role: 'render', limit: 24 }).data?.items ?? []
  const [open, setOpen] = useState(false)
  const [playing, setPlaying] = useState<string | null>(null)
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/compositions/${id}`),
    onError: errorToast,
  })

  return (
    <div className="pb-10">
      <PageHeader
        title="Видео"
        description="Монтажи проекта. Клод собирает их через MCP, здесь докручиваешь руками и рендеришь."
        actions={
          <Button variant="brand" onClick={() => setOpen(true)}>
            <Plus />
            Новое видео
          </Button>
        }
      />
      {comps.length === 0 ? (
        <Empty
          icon={Film}
          title="Видео пока нет"
          action={
            <Button variant="brand" onClick={() => setOpen(true)}>
              Новое видео
            </Button>
          }
        >
          Или попроси Клода: «собери рилс из сочных моментов последнего стрима по формату X».
        </Empty>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3 px-6">
          {comps.map((c) => (
            <CompositionMenu key={c.id} composition={c}>
              <div className="group relative rounded-lg border bg-card p-4 transition-colors hover:border-ring/60">
                <button
                  type="button"
                  className="block w-full text-left"
                  onClick={() => navigate({ kind: 'editor', id: c.id })}
                >
                  <p className="truncate font-medium">{c.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {c.width}×{c.height} · {timecode(compositionDuration(c))} · v{c.version}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {c.tracks.reduce((n, t) => n + t.items.length, 0)} элементов
                  </p>
                </button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="absolute top-3 right-3 opacity-0 group-hover:opacity-100"
                  onClick={() => confirm(`Удалить «${c.name}»?`) && remove.mutate(c.id)}
                  aria-label="Удалить"
                >
                  <Trash2 />
                </Button>
              </div>
            </CompositionMenu>
          ))}
        </div>
      )}

      {renders.length ? (
        <>
          <h2 className="px-6 pt-8 pb-3 font-semibold">Рендеры</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3 px-6">
            {renders.map((r) => (
              <div key={r.id} className="overflow-hidden rounded-lg border bg-card">
                {playing === r.id ? (
                  // biome-ignore lint/a11y/useMediaCaption: rendered video with burned-in captions
                  <video
                    src={mediaUrl(r.id, 'original')}
                    controls
                    autoPlay
                    className="aspect-[9/16] w-full bg-black object-contain"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setPlaying(r.id)}
                    className="relative block aspect-[9/16] w-full bg-muted"
                  >
                    <img
                      src={mediaUrl(r.id, 'thumb', r.updatedAt)}
                      alt=""
                      className="absolute inset-0 size-full object-contain"
                      loading="lazy"
                    />
                    <Play className="absolute inset-0 m-auto size-8 text-white drop-shadow" />
                  </button>
                )}
                <div className="px-2 py-1.5">
                  <p className="truncate text-[13px]">{r.name}</p>
                  <p
                    className="truncate text-xs text-muted-foreground"
                    title={r.path}
                    data-selectable
                  >
                    {r.path}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}
      <NewVideoDialog project={project} open={open} onOpenChange={setOpen} />
    </div>
  )
}
