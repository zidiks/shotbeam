import type {
  Asset,
  AssetRole,
  Composition,
  CompositionOp,
  Job,
  MotionEngine,
} from '@shotbeam/core'
import { compositionDuration, findItem, isFree, itemEnd } from '@shotbeam/core'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@shotbeam/ui'
import { useMutation, useQueries } from '@tanstack/react-query'
import {
  Captions,
  Clapperboard,
  Pause,
  Play,
  Plus,
  Redo2,
  SkipBack,
  Type,
  Undo2,
  Wand2,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { AssetCard } from '../../components/AssetCard'
import { Busy, Progress, Segmented } from '../../components/common'
import { AssetMenu } from '../../components/menus'
import { api, mediaUrl } from '../../lib/api'
import { useJobFor } from '../../lib/events'
import { comboLabel, matches, typing } from '../../lib/hotkeys'
import {
  errorToast,
  keys,
  useAssets,
  useComposition,
  useCompositionHistory,
  useCompositionOps,
  useMotionTemplates,
  useSettings,
  useUndoRedo,
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
                <AssetMenu asset={a}>
                  <AssetCard asset={a} draggable onClick={() => onAdd(a)} />
                </AssetMenu>
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
  const history = useCompositionHistory(id).data
  const undoRedo = useUndoRedo(id)

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

  // Every editor shortcut (the list the help dialog shows is lib/hotkeys.ts). Handlers read the
  // latest state through refs, so the listener is added once.
  const actions = useRef({ apply, undoRedo, captions, render })
  actions.current = { apply, undoRedo, captions, render }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || e.defaultPrevented) return
      const comp = latest.current
      if (!comp) return
      const s = useEditor.getState()
      const a = actions.current
      const sel = s.selected ? findItem(comp, s.selected) : null
      const frame = 1 / comp.fps
      const done = (action?: () => void) => {
        e.preventDefault()
        action?.()
      }

      if (matches(e, { code: 'KeyZ', mod: true })) return done(() => a.undoRedo.mutate('undo'))
      if (
        matches(e, { code: 'KeyZ', mod: true, shift: true }) ||
        matches(e, { code: 'KeyY', mod: true })
      )
        return done(() => a.undoRedo.mutate('redo'))
      if (matches(e, { code: 'KeyE', mod: true })) return done(() => a.render.mutate(true))
      if (matches(e, { code: 'KeyE', mod: true, shift: true }))
        return done(() => a.render.mutate(false))
      if (matches(e, { code: 'Space' }) || matches(e, { code: 'KeyK' }))
        return done(() => s.setPlaying(!s.playing))
      if (matches(e, { code: 'Home' })) return done(() => s.setTime(0))
      if (matches(e, { code: 'End' })) return done(() => s.setTime(compositionDuration(comp)))
      if (matches(e, { code: 'Escape' })) return s.select(null)
      if (matches(e, { code: 'KeyM' })) return s.setMagnet(!s.magnet)
      if (matches(e, { code: 'Equal' }) || matches(e, { code: 'NumpadAdd' }))
        return s.setZoom(s.zoom * 1.25)
      if (matches(e, { code: 'Minus' }) || matches(e, { code: 'NumpadSubtract' }))
        return s.setZoom(s.zoom / 1.25)
      if (matches(e, { code: 'KeyT' }))
        return a.apply([
          {
            op: 'add',
            item: {
              type: 'text',
              start: s.time,
              duration: 2.5,
              text: 'Текст',
              style: { y: 0.2 },
              fadeIn: 0.15,
              fadeOut: 0.15,
            },
          },
        ])
      if (matches(e, { code: 'KeyC', shift: true })) return a.captions.mutate()

      // Playhead.
      for (const [code, dir] of [
        ['ArrowLeft', -1],
        ['ArrowRight', 1],
      ] as const) {
        if (matches(e, { code }) || matches(e, { code, shift: true })) {
          done()
          return s.setTime(s.time + dir * frame * (e.shiftKey ? 10 : 1))
        }
      }
      if (matches(e, { code: 'ArrowUp' }) || matches(e, { code: 'ArrowDown' })) {
        done()
        const cuts = [
          ...new Set(comp.tracks.flatMap((t) => t.items.flatMap((i) => [i.start, itemEnd(i)]))),
        ].sort((x, y) => x - y)
        const next =
          e.code === 'ArrowUp'
            ? [...cuts].reverse().find((c) => c < s.time - 1e-3)
            : cuts.find((c) => c > s.time + 1e-3)
        return s.setTime(next ?? (e.code === 'ArrowUp' ? 0 : s.time))
      }

      // Clipboard works without a selection (paste).
      if (matches(e, { code: 'KeyV', mod: true }) && s.clipboard) {
        done()
        const { id: _drop, ...copy } = s.clipboard
        return a.apply([{ op: 'add', item: { ...copy, start: s.time } }])
      }

      if (!sel) return
      const item = sel.item
      if (matches(e, { code: 'KeyC', mod: true })) return done(() => s.copy(item))
      if (matches(e, { code: 'KeyX', mod: true })) {
        done()
        s.copy(item)
        s.select(null)
        return a.apply([{ op: 'remove', id: item.id }])
      }
      if (matches(e, { code: 'KeyD', mod: true })) {
        done()
        const { id: _drop, ...copy } = item
        const start = itemEnd(item)
        const free = isFree(sel.track, start, start + (itemEnd(item) - item.start))
        return a.apply([
          { op: 'add', item: { ...copy, start }, trackId: free ? sel.track.id : undefined },
        ])
      }
      if (matches(e, { code: 'KeyS' }) || matches(e, { code: 'KeyB', mod: true })) {
        done()
        if (s.time > item.start + 0.05 && s.time < itemEnd(item) - 0.05)
          a.apply([{ op: 'split', id: item.id, at: s.time }])
        return
      }
      if (
        matches(e, { code: 'Delete' }) ||
        matches(e, { code: 'Backspace' }) ||
        matches(e, { code: 'Delete', shift: true }) ||
        matches(e, { code: 'Backspace', shift: true })
      ) {
        done()
        s.select(null)
        return a.apply([{ op: 'remove', id: item.id, ripple: e.shiftKey }])
      }
      for (const [code, dir] of [
        ['ArrowLeft', -1],
        ['ArrowRight', 1],
      ] as const) {
        if (matches(e, { code, mod: true }) || matches(e, { code, mod: true, shift: true })) {
          done()
          return a.apply([
            {
              op: 'move',
              id: item.id,
              start: Math.max(0, item.start + dir * frame * (e.shiftKey ? 10 : 1)),
            },
          ])
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
        <div className="flex items-center">
          {(['undo', 'redo'] as const).map((d) => (
            <Tooltip key={d}>
              <TooltipTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={!history?.[d] || undoRedo.isPending}
                  onClick={() => undoRedo.mutate(d)}
                  aria-label={d === 'undo' ? 'Отменить' : 'Повторить'}
                >
                  {d === 'undo' ? <Undo2 /> : <Redo2 />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {d === 'undo' ? 'Отменить' : 'Повторить'} ·{' '}
                {comboLabel(
                  d === 'undo'
                    ? { code: 'KeyZ', mod: true }
                    : { code: 'KeyZ', mod: true, shift: true },
                )}
                {history?.[d] ? ` · шагов: ${history[d]}` : ''}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
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
