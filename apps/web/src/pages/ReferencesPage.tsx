import type { Format, Project, Reference } from '@shotbeam/core'
import { Button, cn, Input, Spinner } from '@shotbeam/ui'
import { useMutation } from '@tanstack/react-query'
import { CircleAlert, Link2, RotateCcw, Sparkles, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Empty, PageHeader, Progress, Textarea } from '../components/common'
import { ReferenceMenu } from '../components/menus'
import { api, engineUrl, mediaUrl } from '../lib/api'
import { useJobFor } from '../lib/events'
import { timecode } from '../lib/format'
import { errorToast, useAsset, useReference, useReferences } from '../lib/queries'
import { useUi } from '../lib/store'

const PLATFORM: Record<Reference['platform'], string> = {
  youtube: 'YouTube',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  x: 'X',
  other: 'Ссылка',
}

function ReferenceCard({
  r,
  selected,
  onClick,
}: {
  r: Reference
  selected: boolean
  onClick: () => void
}) {
  const job = useJobFor('reference', r.id)
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col overflow-hidden rounded-lg border bg-card text-left transition-colors hover:border-ring/60',
        selected && 'border-brand ring-2 ring-brand/30',
      )}
    >
      <div className="relative aspect-[9/12] w-full bg-muted">
        {r.status !== 'new' && r.status !== 'downloading' ? (
          <img
            src={engineUrl(`/api/references/${r.id}/thumb`)}
            alt=""
            loading="lazy"
            className="absolute inset-0 size-full object-cover"
          />
        ) : null}
        <span className="absolute top-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-white">
          {PLATFORM[r.platform]}
        </span>
        {r.status === 'downloading' || r.status === 'indexing' || r.status === 'new' ? (
          <div className="absolute inset-x-2 bottom-2 rounded bg-black/70 p-1.5 text-[11px] text-white">
            <span className="flex items-center gap-1">
              <Spinner className="size-3" /> {r.status === 'indexing' ? 'индексация' : 'скачиваю'}
            </span>
            {job?.status === 'running' ? <Progress value={job.progress} className="mt-1" /> : null}
          </div>
        ) : r.status === 'error' ? (
          <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded bg-destructive px-1.5 py-0.5 text-[11px] text-white">
            <CircleAlert className="size-3" /> ошибка
          </span>
        ) : r.analysis ? (
          <span className="absolute right-1.5 bottom-1.5 rounded bg-brand px-1.5 py-0.5 text-[11px] text-brand-foreground">
            разобран
          </span>
        ) : null}
      </div>
      <div className="px-2 py-1.5">
        <p className="line-clamp-2 text-[13px]">{r.title || r.url}</p>
        {r.author ? <p className="truncate text-xs text-muted-foreground">{r.author}</p> : null}
      </div>
    </button>
  )
}

function ReferencePanel({
  id,
  project,
  onClose,
}: {
  id: string
  project: Project
  onClose: () => void
}) {
  const ref = useReference(id).data
  const assetData = useAsset(ref?.asset?.id ?? null).data
  const navigate = useUi((s) => s.navigate)
  const [analysis, setAnalysis] = useState('')
  useEffect(() => setAnalysis(ref?.reference.analysis ?? ''), [ref?.reference.analysis])
  const save = useMutation({
    mutationFn: () => api.patch(`/api/references/${id}`, { analysis }),
    onSuccess: () => toast.success('Разбор сохранён'),
    onError: errorToast,
  })
  const retry = useMutation({
    mutationFn: () => api.post(`/api/references/${id}/retry`),
    onError: errorToast,
  })
  const remove = useMutation({
    mutationFn: () => api.del(`/api/references/${id}`),
    onSuccess: onClose,
    onError: errorToast,
  })
  const toFormat = useMutation({
    mutationFn: () =>
      api.post<Format>('/api/formats', {
        name: ref?.reference.title?.slice(0, 60) || 'Новый формат',
        description: `По референсу ${ref?.reference.url}`,
        projectId: project.id,
        referenceIds: [id],
        recipe: { notes: analysis },
      }),
    onSuccess: (f) => navigate({ kind: 'formats', id: f.id }),
    onError: errorToast,
  })
  if (!ref) return <aside className="w-[460px] shrink-0 border-l bg-card" />
  const r = ref.reference
  const an = assetData?.analysis
  const a = ref.asset
  const shots = an?.scenes.length ?? 0
  const words = an?.transcript?.segments.flatMap((s) => s.words) ?? []

  return (
    <aside className="flex w-[460px] shrink-0 flex-col border-l bg-card">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{r.title || r.url}</h2>
        <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Закрыть">
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {a && r.status !== 'downloading' ? (
          // biome-ignore lint/a11y/useMediaCaption: transcript below
          <video
            controls
            src={mediaUrl(a.id, 'play', a.updatedAt)}
            className="max-h-96 w-full bg-black"
          />
        ) : null}
        <div className="space-y-5 p-4">
          <a
            href={r.url}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-xs text-brand hover:underline"
          >
            {r.url}
          </a>
          {r.status === 'error' ? (
            <div className="space-y-2">
              <p
                className="rounded-md bg-destructive/10 p-2 text-xs text-destructive"
                data-selectable
              >
                {r.error}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => retry.mutate()}
                loading={retry.isPending}
              >
                <RotateCcw />
                Повторить
              </Button>
              {r.platform === 'instagram' ? (
                <p className="text-xs text-muted-foreground">
                  Instagram часто требует вход: выбери браузер с куками в Настройках → Референсы.
                </p>
              ) : null}
            </div>
          ) : null}
          {a && an ? (
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md bg-muted p-2">
                <div className="text-lg font-semibold tabular-nums">{timecode(a.duration)}</div>
                <div className="text-xs text-muted-foreground">длина</div>
              </div>
              <div className="rounded-md bg-muted p-2">
                <div className="text-lg font-semibold tabular-nums">
                  {shots ? ((a.duration ?? 0) / shots).toFixed(1) : '—'} с
                </div>
                <div className="text-xs text-muted-foreground">средний план ({shots})</div>
              </div>
              <div className="rounded-md bg-muted p-2">
                <div className="text-lg font-semibold tabular-nums">
                  {words.length ? (words.length / Math.max(1, a.duration ?? 1)).toFixed(1) : '0'}
                </div>
                <div className="text-xs text-muted-foreground">слов в секунду</div>
              </div>
            </div>
          ) : null}
          {an?.transcript ? (
            <section>
              <h3 className="mb-1.5 text-[13px] font-semibold">Что говорят</h3>
              <div className="max-h-48 space-y-0.5 overflow-y-auto text-sm" data-selectable>
                {an.transcript.segments.map((s) => (
                  <p key={s.start}>
                    <span className="mr-2 text-xs text-muted-foreground tabular-nums">
                      {timecode(s.start)}
                    </span>
                    {s.text}
                  </p>
                ))}
              </div>
            </section>
          ) : null}
          <section>
            <h3 className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold">
              <Sparkles className="size-3.5 text-brand" /> Разбор формата
            </h3>
            <p className="mb-2 text-xs text-muted-foreground">
              Попроси Клода: «разбери референс {r.id}» — он посмотрит кадры и запишет разбор сюда.
              Или пиши сам.
            </p>
            <Textarea
              rows={10}
              value={analysis}
              onChange={(e) => setAnalysis(e.target.value)}
              placeholder="Хук, структура, ритм, типографика, звук…"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => save.mutate()}
                loading={save.isPending}
                disabled={analysis === r.analysis}
              >
                Сохранить
              </Button>
              <Button
                size="sm"
                variant="brand"
                onClick={() => toFormat.mutate()}
                loading={toFormat.isPending}
              >
                Сделать формат
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() => {
                  if (confirm('Удалить референс?')) remove.mutate()
                }}
              >
                <Trash2 />
              </Button>
            </div>
          </section>
        </div>
      </div>
    </aside>
  )
}

export function ReferencesPage({ project, id }: { project: Project; id?: string }) {
  const navigate = useUi((s) => s.navigate)
  const refs = useReferences(project.id).data ?? []
  const [url, setUrl] = useState('')
  const add = useMutation({
    mutationFn: () =>
      api.post<Reference>('/api/references', { url: url.trim(), projectId: project.id }),
    onSuccess: (r) => {
      setUrl('')
      navigate({ kind: 'references', id: r.id })
    },
    onError: errorToast,
  })
  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <PageHeader
          title="Референсы"
          description="Чужие ролики, чтобы разобрать формат: YouTube, Instagram, TikTok, X. Хранятся только у тебя и в монтаж не попадают."
        />
        <form
          className="flex gap-2 px-6 pb-5"
          onSubmit={(e) => {
            e.preventDefault()
            if (url.trim()) add.mutate()
          }}
        >
          <div className="relative flex-1">
            <Link2 className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.instagram.com/reel/…"
              className="pl-8"
            />
          </div>
          <Button type="submit" variant="brand" disabled={!url.trim()} loading={add.isPending}>
            Добавить
          </Button>
        </form>
        {refs.length === 0 ? (
          <Empty icon={Sparkles} title="Референсов пока нет">
            Вставь ссылку на ролик, формат которого хочешь повторить. Клод разберёт хук, ритм,
            структуру и соберёт из этого формат.
          </Empty>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3 px-6 pb-8">
            {refs.map((r) => (
              <ReferenceMenu
                key={r.id}
                reference={r}
                onOpen={() => navigate({ kind: 'references', id: r.id })}
                onDeleted={() => r.id === id && navigate({ kind: 'references' })}
              >
                <ReferenceCard
                  r={r}
                  selected={r.id === id}
                  onClick={() =>
                    navigate({ kind: 'references', id: r.id === id ? undefined : r.id })
                  }
                />
              </ReferenceMenu>
            ))}
          </div>
        )}
      </div>
      {id ? (
        <ReferencePanel
          id={id}
          project={project}
          onClose={() => navigate({ kind: 'references' })}
        />
      ) : null}
    </div>
  )
}
