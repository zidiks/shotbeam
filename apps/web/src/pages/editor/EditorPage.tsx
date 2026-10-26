import type {
  Asset,
  AssetRole,
  Composition,
  CompositionOp,
  Job,
  MotionEngine,
} from '@shotbeam/core'
import { findItem } from '@shotbeam/core'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
} from '@shotbeam/ui'
import { useMutation, useQueries } from '@tanstack/react-query'
import { Captions, Clapperboard, Pause, Play, Plus, SkipBack, Type, Wand2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { AssetCard } from '../../components/AssetCard'
import { Busy, Progress, Segmented } from '../../components/common'
import { api, mediaUrl } from '../../lib/api'
import { useJobFor } from '../../lib/events'
import {
  errorToast,
  keys,
  useAssets,
  useComposition,
  useCompositionOps,
  useMotionTemplates,
  useSettings,
} from '../../lib/queries'
import { useUi } from '../../lib/store'
import { Inspector } from './Inspector'
import { Preview } from './Preview'
import { startClock, useEditor } from './state'
import { Timeline } from './Timeline'

/** Media of the project to drag onto the timeline. */
function MediaBin({ projectId, onAdd }: { projectId: string; onAdd: (a: Asset) => void }) {
  const [role, setRole] = useState<AssetRole>('footage')
  const assets = useAssets({ projectId, role }).data?.items ?? []
  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-2">
        <Segmented
          value={role}
          onChange={setRole}
          className="w-full"
          options={[
            { value: 'footage', label: 'Видео' },
            { value: 'voice', label: 'Голос' },
            { value: 'music', label: 'Музыка' },
            { value: 'motion', label: 'Моушн' },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {assets.length === 0 ? (
          <p className="p-2 text-xs text-muted-foreground">
            Пусто. Подключи папку во вкладке «Медиа» или сгенерируй озвучку.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {assets.map((a) => (
              <div key={a.id} className="group relative">
                <AssetCard asset={a} draggable onClick={() => onAdd(a)} />
              </div>
            ))}
          </div>
        )}
        <p className="p-2 text-[11px] text-muted-foreground">
          Перетащи на дорожку или кликни, чтобы добавить в конец.
        </p>
      </div>
    </div>
  )
}

function useAssetMap(c: Composition | undefined) {
  const ids = useMemo(() => {
    const s = new Set<string>()
    for (const t of c?.tracks ?? [])
      for (const i of t.items) {
        if (i.type === 'clip' || i.type === 'audio') s.add(i.assetId)
      }
    return [...s]
  }, [c])
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: keys.asset(id),
      queryFn: () => api.get<{ asset: Asset }>(`/api/assets/${id}`),
    })),
  })
  return useMemo(() => {
    const m = new Map<string, Asset>()
    for (const r of results) if (r.data) m.set(r.data.asset.id, r.data.asset)
    return m
  }, [results])
}

export function EditorPage({ id }: { id: string }) {
  const comp = useComposition(id)
  const c = comp.data
  const ops = useCompositionOps(id)
  const assets = useAssetMap(c)
  const settings = useSettings().data
  const templates = useMotionTemplates().data ?? []
  const navigate = useUi((s) => s.navigate)
  const { time, playing, setPlaying, setTime, selected, select } = useEditor()
  const renderJob = useJobFor('render', id)
  const [name, setName] = useState('')
  const [lastRender, setLastRender] = useState<string | null>(null)

  useEffect(() => setName(c?.name ?? ''), [c?.name])
  // The clock reads the latest composition (its length changes while editing).
  const latest = useRef(c)
  latest.current = c
  useEffect(() => {
    useEditor.setState({ time: 0, playing: false, selected: null })
    return startClock(() => latest.current)
  }, [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: react once per status change
  useEffect(() => {
    if (renderJob?.status === 'done') {
      const r = renderJob.result as { assetId: string }
      setLastRender(r.assetId)
      toast.success('Видео готово')
    }
    if (renderJob?.status === 'error') toast.error(renderJob.error)
  }, [renderJob?.status])

  const apply = (list: CompositionOp[]) => ops.mutate(list)

  // Keyboard: space, S, Delete, arrows.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, [contenteditable="true"]')) return
      const s = useEditor.getState()
      if (e.code === 'Space') {
        e.preventDefault()
        s.setPlaying(!s.playing)
      } else if (e.code === 'KeyS' && s.selected) {
        apply([{ op: 'split', id: s.selected, at: s.time }])
      } else if ((e.code === 'Delete' || e.code === 'Backspace') && s.selected) {
        apply([{ op: 'remove', id: s.selected, ripple: e.shiftKey }])
        s.select(null)
      } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        const f = 1 / (comp.data?.fps ?? 30)
        s.setTime(s.time + (e.code === 'ArrowLeft' ? -f : f) * (e.shiftKey ? 10 : 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [comp.data?.fps, apply])

  const captions = useMutation({
    mutationFn: () =>
      api.post<{ composition: Composition }>(`/api/compositions/${id}/captions`, {}),
    onSuccess: () => toast.success('Сабы добавлены'),
    onError: errorToast,
  })
  const render = useMutation({
    mutationFn: (draft: boolean) => api.post<Job>(`/api/compositions/${id}/render`, { draft }),
    onError: errorToast,
  })
  const rename = useMutation({
    mutationFn: (n: string) => api.patch(`/api/compositions/${id}`, { name: n }),
    onError: errorToast,
  })

  if (!c)
    return comp.isLoading ? (
      <div className="p-6">
        <Busy label="Открываю" />
      </div>
    ) : null

  const addAsset = (a: Asset) =>
    apply([
      {
        op: 'add',
        item: {
          type: a.kind === 'audio' ? 'audio' : 'clip',
          assetId: a.id,
          in: 0,
          out: a.kind === 'image' ? 3 : (a.duration ?? 5),
          ...(a.role === 'music'
            ? { start: 0, duck: true, volume: 0.6 }
            : a.role === 'voice'
              ? { start: time }
              : {}),
        },
      },
    ])
  const addText = () =>
    apply([
      {
        op: 'add',
        item: {
          type: 'text',
          start: time,
          duration: 2.5,
          text: 'Текст',
          style: { y: 0.2 },
          fadeIn: 0.15,
          fadeOut: 0.15,
        },
      },
    ])
  const addMotion = (engine: MotionEngine, template: string) => {
    const t = templates.find((x) => x.engine === engine && x.name === template)
    apply([
      {
        op: 'add',
        item: {
          type: 'motion',
          engine,
          template,
          start: time,
          duration: t?.duration ?? 3,
          overlay: t?.overlay ?? false,
          props: {},
        },
      },
    ])
  }
  const rendering = renderJob && (renderJob.status === 'queued' || renderJob.status === 'running')
  const defaultEngine = settings?.defaultMotionEngine ?? 'hyperframes'

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== c.name && rename.mutate(name.trim())}
          className="h-8 w-64 font-medium"
        />
        <span className="text-xs text-muted-foreground">
          {c.width}×{c.height} · {c.fps} fps · v{c.version}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={addText}>
            <Type />
            Текст
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost">
                <Wand2 />
                Моушн
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {(['hyperframes', 'remotion'] as const).map((engine, n) => (
                <div key={engine}>
                  {n ? <DropdownMenuSeparator /> : null}
                  <DropdownMenuLabel>
                    {engine === 'hyperframes' ? 'HyperFrames' : 'Remotion'}
                    {engine === defaultEngine ? ' · по умолчанию' : ''}
                  </DropdownMenuLabel>
                  {templates
                    .filter((t) => t.engine === engine)
                    .map((t) => (
                      <DropdownMenuItem key={t.name} onSelect={() => addMotion(engine, t.name)}>
                        <Plus />
                        {t.name}
                        <span className="ml-auto text-xs text-muted-foreground">
                          {t.overlay ? 'поверх' : 'кадр'}
                        </span>
                      </DropdownMenuItem>
                    ))}
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => captions.mutate()}
            loading={captions.isPending}
          >
            <Captions />
            Сабы
          </Button>
          <div className="mx-1 h-5 w-px bg-border" />
          <Button
            size="sm"
            variant="outline"
            onClick={() => render.mutate(true)}
            disabled={!!rendering}
          >
            Черновик
          </Button>
          <Button
            size="sm"
            variant="brand"
            onClick={() => render.mutate(false)}
            loading={!!rendering}
          >
            <Clapperboard />
            Рендер
          </Button>
        </div>
      </div>
      {rendering ? (
        <div className="flex items-center gap-3 border-b bg-accent/50 px-3 py-1.5 text-xs">
          <span>{renderJob?.message || 'Рендер'}</span>
          <Progress value={renderJob?.progress ?? 0} className="w-60" />
        </div>
      ) : lastRender ? (
        <div className="flex items-center gap-3 border-b bg-success/10 px-3 py-1.5 text-xs">
          <span>Рендер готов.</span>
          <a
            className="text-brand hover:underline"
            href={mediaUrl(lastRender, 'original')}
            target="_blank"
            rel="noreferrer"
          >
            Открыть файл
          </a>
          <button
            type="button"
            className="text-brand hover:underline"
            onClick={() => navigate({ kind: 'videos' })}
          >
            Все рендеры
          </button>
        </div>
      ) : null}

      {/* Bin · preview · inspector */}
      <div className="flex min-h-0 flex-1">
        <aside className="w-64 shrink-0 border-r bg-sidebar">
          <MediaBin projectId={c.projectId} onAdd={addAsset} />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col bg-muted/40">
          <div className="min-h-0 flex-1 p-4">
            <Preview composition={c} />
          </div>
          <div className="flex items-center justify-center gap-1 pb-2">
            <Button size="icon-sm" variant="ghost" onClick={() => setTime(0)} aria-label="В начало">
              <SkipBack />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => setPlaying(!playing)}
              aria-label={playing ? 'Пауза' : 'Играть'}
            >
              {playing ? <Pause /> : <Play />}
            </Button>
          </div>
        </div>
        <aside className="w-80 shrink-0 overflow-y-auto border-l bg-card">
          <Inspector composition={c} assets={assets} apply={apply} />
        </aside>
      </div>

      {/* Timeline */}
      <div className="h-[260px] shrink-0">
        <Timeline composition={c} assets={assets} apply={apply} />
      </div>
      {selected && !findItem(c, selected) ? <SelectionReset onReset={() => select(null)} /> : null}
    </div>
  )
}

/** The selected item disappeared (removed by Claude, say): drop the selection. */
function SelectionReset({ onReset }: { onReset: () => void }) {
  useEffect(onReset, [onReset])
  return null
}
