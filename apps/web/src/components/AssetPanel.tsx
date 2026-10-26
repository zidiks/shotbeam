import type { Asset } from '@shotbeam/core'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Input,
} from '@shotbeam/ui'
import { useMutation } from '@tanstack/react-query'
import { Captions, ChevronDown, FilmIcon, RefreshCw, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api, mediaUrl, sheetUrl } from '../lib/api'
import { useJobFor } from '../lib/events'
import { bytes, ROLE_LABEL, timecode } from '../lib/format'
import { errorToast, useAsset, useCompositions } from '../lib/queries'
import { useUi } from '../lib/store'
import { Busy, Field, Progress, Textarea } from './common'

/** Adds a stretch of an asset to one of the project's videos. */
export function AddToVideo({
  asset,
  range,
}: {
  asset: Asset
  range: { in: number; out: number } | null
}) {
  const projectId = useUi((s) => s.projectId)
  const navigate = useUi((s) => s.navigate)
  const comps = useCompositions(projectId ?? undefined).data ?? []
  const add = useMutation({
    mutationFn: (id: string) =>
      api.post(`/api/compositions/${id}/ops`, {
        ops: [
          {
            op: 'add',
            item: {
              type: asset.kind === 'audio' ? 'audio' : 'clip',
              assetId: asset.id,
              in: range?.in ?? 0,
              out: range?.out ?? asset.duration ?? 5,
            },
          },
        ],
      }),
    onSuccess: (_r, id) =>
      toast.success('Добавлено', {
        action: { label: 'Открыть', onClick: () => navigate({ kind: 'editor', id }) },
      }),
    onError: errorToast,
  })
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="brand"
          disabled={asset.status !== 'ready' || asset.role === 'reference'}
        >
          <FilmIcon />В видео
          <ChevronDown className="size-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          {range ? `Отрезок ${timecode(range.in)}–${timecode(range.out)}` : 'Весь файл'}
        </DropdownMenuLabel>
        {comps.length ? (
          comps.map((c) => (
            <DropdownMenuItem key={c.id} onSelect={() => add.mutate(c.id)}>
              <span className="truncate">{c.name}</span>
            </DropdownMenuItem>
          ))
        ) : (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">
            Сначала создай видео во вкладке «Видео».
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AssetPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { data } = useAsset(id)
  const player = useRef<HTMLVideoElement & HTMLAudioElement>(null)
  const [range, setRange] = useState<{ in: number; out: number } | null>(null)
  const [time, setTime] = useState(0)
  const stopAt = useRef<number | null>(null)
  const indexJob = useJobFor('index', id)
  const transcribeJob = useJobFor('transcribe', id)
  const [tags, setTags] = useState('')
  const [notes, setNotes] = useState('')

  const asset = data?.asset
  const analysis = data?.analysis
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new asset starts without a range
  useEffect(() => {
    setRange(null)
  }, [id])
  // biome-ignore lint/correctness/useExhaustiveDependencies: refill the fields only when the asset itself changed
  useEffect(() => {
    if (!asset) return
    setTags(asset.tags.join(', '))
    setNotes(asset.notes)
  }, [asset?.id, asset?.updatedAt])

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/api/assets/${id}`, {
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        notes,
      }),
    onSuccess: () => toast.success('Сохранено'),
    onError: errorToast,
  })
  const reindex = useMutation({
    mutationFn: () => api.post(`/api/assets/${id}/reindex`),
    onError: errorToast,
  })
  const transcribe = useMutation({
    mutationFn: () => api.post(`/api/assets/${id}/transcribe`),
    onError: errorToast,
  })

  const seek = (t: number, until?: number) => {
    const p = player.current
    if (!p) return
    p.currentTime = t
    stopAt.current = until ?? null
    void p.play()
  }

  if (!asset || !analysis) {
    return <aside className="w-[460px] shrink-0 border-l bg-card" />
  }
  const running =
    (indexJob?.status === 'running' && indexJob) ||
    (transcribeJob?.status === 'running' && transcribeJob)
  const segments = analysis.transcript?.segments ?? []

  return (
    <aside className="flex w-[460px] shrink-0 flex-col border-l bg-card">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold" title={asset.path}>
          {asset.name}
        </h2>
        <AddToVideo asset={asset} range={range} />
        <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Закрыть">
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="bg-black">
          {asset.kind === 'image' ? (
            <img
              src={mediaUrl(asset.id, 'original')}
              alt=""
              className="max-h-80 w-full object-contain"
            />
          ) : asset.kind === 'audio' ? (
            // biome-ignore lint/a11y/useMediaCaption: the transcript below is the caption
            <audio
              ref={player}
              controls
              src={mediaUrl(asset.id, 'play')}
              className="w-full"
              onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            />
          ) : (
            // biome-ignore lint/a11y/useMediaCaption: the transcript below is the caption
            <video
              ref={player}
              controls
              src={mediaUrl(asset.id, 'play', asset.updatedAt)}
              className="max-h-80 w-full"
              onTimeUpdate={(e) => {
                const t = e.currentTarget.currentTime
                setTime(t)
                if (stopAt.current !== null && t >= stopAt.current) {
                  e.currentTarget.pause()
                  stopAt.current = null
                }
              }}
            />
          )}
        </div>

        <div className="space-y-5 p-4">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{ROLE_LABEL[asset.role]}</span>
            {asset.duration ? <span>{timecode(asset.duration)}</span> : null}
            {asset.width ? (
              <span>
                {asset.width}×{asset.height}
              </span>
            ) : null}
            {asset.fps ? <span>{asset.fps} fps</span> : null}
            <span>{bytes(asset.size)}</span>
            {analysis.music ? <span>{analysis.music.bpm} BPM</span> : null}
          </div>

          {running ? (
            <div>
              <Busy label={running.message || 'Обработка'} />
              <Progress value={running.progress} className="mt-2" />
            </div>
          ) : null}
          {asset.status === 'error' ? (
            <p
              className="rounded-md bg-destructive/10 p-2 text-xs text-destructive"
              data-selectable
            >
              {asset.error}
            </p>
          ) : null}

          {range ? (
            <div className="flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm">
              <span className="flex-1">
                Выбран отрезок {timecode(range.in)}–{timecode(range.out)}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setRange(null)}>
                Сбросить
              </Button>
            </div>
          ) : null}

          {analysis.moments.length ? (
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
                <Sparkles className="size-3.5 text-brand" /> Кандидаты на сочные моменты
              </h3>
              <ul className="space-y-1">
                {analysis.moments.map((m) => (
                  <li key={`${m.start}-${m.end}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setRange({ in: m.start, out: m.end })
                        seek(m.start, m.end)
                      }}
                      className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                    >
                      <span className="font-medium tabular-nums">
                        {timecode(m.start)}–{timecode(m.end)}
                      </span>{' '}
                      <span className="text-xs text-muted-foreground">{m.reasons.join(', ')}</span>
                      {m.text ? (
                        <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                          «{m.text}»
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {asset.hasAudio && asset.kind !== 'image' ? (
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
                <Captions className="size-3.5" /> Транскрипт
                {analysis.transcript ? (
                  <span className="font-normal text-muted-foreground">
                    · {analysis.transcript.language}
                  </span>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto h-6 px-2 text-xs"
                  onClick={() => transcribe.mutate()}
                  loading={transcribe.isPending}
                >
                  {analysis.transcript ? 'Заново' : 'Распознать'}
                </Button>
              </h3>
              {segments.length ? (
                <div className="max-h-72 space-y-0.5 overflow-y-auto text-sm" data-selectable>
                  {segments.map((s) => (
                    <button
                      key={s.start}
                      type="button"
                      onClick={(e) => {
                        if (e.shiftKey && range)
                          setRange({
                            in: Math.min(range.in, s.start),
                            out: Math.max(range.out, s.end),
                          })
                        else setRange({ in: s.start, out: s.end })
                        seek(s.start, s.end)
                      }}
                      className={`block w-full rounded px-1.5 py-0.5 text-left hover:bg-accent ${time >= s.start && time < s.end ? 'bg-highlight/50' : ''}`}
                    >
                      <span className="mr-2 text-xs text-muted-foreground tabular-nums">
                        {timecode(s.start)}
                      </span>
                      {s.text}
                    </button>
                  ))}
                  <p className="pt-1 text-xs text-muted-foreground">
                    Клик — выбрать фразу, Shift+клик — расширить отрезок.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Пока нет.</p>
              )}
            </section>
          ) : null}

          {analysis.sheets.length ? (
            <section>
              <h3 className="mb-2 text-[13px] font-semibold">Контакт-листы</h3>
              <div className="grid grid-cols-2 gap-2">
                {analysis.sheets.map((s) => (
                  <button
                    key={s.index}
                    type="button"
                    onClick={() => seek(s.start)}
                    className="overflow-hidden rounded-md border"
                  >
                    <img
                      src={sheetUrl(asset.id, s.index)}
                      alt=""
                      loading="lazy"
                      className="w-full"
                    />
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <section className="space-y-3">
            <Field label="Теги" hint="Через запятую">
              <Input value={tags} onChange={(e) => setTags(e.target.value)} />
            </Field>
            <Field label="Заметки" hint="Что тут, настроение, куда подходит. Клод это читает.">
              <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => save.mutate()} loading={save.isPending}>
                Сохранить
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => reindex.mutate()}
                loading={reindex.isPending}
              >
                <RefreshCw />
                Переиндексировать
              </Button>
            </div>
            <p className="break-all text-xs text-muted-foreground" data-selectable>
              {asset.path}
            </p>
          </section>
        </div>
      </div>
    </aside>
  )
}
