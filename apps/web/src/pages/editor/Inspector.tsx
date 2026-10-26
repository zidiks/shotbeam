import type { Asset, Composition, CompositionOp, Item, MotionEngine } from '@shotbeam/core'
import { findItem, itemEnd } from '@shotbeam/core'
import { Button, Input } from '@shotbeam/ui'
import { useMutation } from '@tanstack/react-query'
import { Scissors, Trash2, Wand2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Choice, Field, Segmented, Textarea } from '../../components/common'
import { api } from '../../lib/api'
import { useJobFor } from '../../lib/events'
import { timecode } from '../../lib/format'
import { errorToast, useMotionTemplates } from '../../lib/queries'
import { useLibraryFonts } from './fonts'
import { useEditor } from './state'

/* Properties of the selected item. Text fields commit on blur or Enter; sliders on release. */

function Num({
  label,
  value,
  onCommit,
  step = 0.1,
  min,
  max,
}: {
  label: string
  value: number
  onCommit: (v: number) => void
  step?: number
  min?: number
  max?: number
}) {
  const [v, setV] = useState(String(value))
  useEffect(() => setV(String(Math.round(value * 1000) / 1000)), [value])
  const commit = () => {
    const n = Number(v)
    if (Number.isFinite(n) && n !== value) onCommit(n)
  }
  return (
    <Field label={label}>
      <Input
        type="number"
        step={step}
        min={min}
        max={max}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        className="h-8"
      />
    </Field>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onCommit,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onCommit: (v: number) => void
}) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <Field label={`${label}: ${v.toFixed(2)}`}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={v}
        onChange={(e) => setV(Number(e.target.value))}
        onPointerUp={() => v !== value && onCommit(v)}
        onKeyUp={() => v !== value && onCommit(v)}
        className="w-full accent-[var(--color-brand)]"
      />
    </Field>
  )
}

function Color({
  label,
  value,
  onCommit,
  nullable,
}: {
  label: string
  value: string | null
  onCommit: (v: string | null) => void
  nullable?: boolean
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value ?? '#000000'}
          onChange={(e) => onCommit(e.target.value)}
          className="h-8 w-10 rounded border bg-transparent"
        />
        {nullable ? (
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={value === null}
              onChange={(e) => onCommit(e.target.checked ? null : '#000000')}
            />
            нет
          </label>
        ) : null}
      </div>
    </Field>
  )
}

function MotionFields({
  item,
  compositionId,
  set,
}: {
  item: Extract<Item, { type: 'motion' }>
  compositionId: string
  set: (p: Record<string, unknown>) => void
}) {
  const templates = useMotionTemplates().data ?? []
  const job = useJobFor('motion', item.id)
  const render = useMutation({
    mutationFn: () => api.post(`/api/compositions/${compositionId}/motion/${item.id}`),
    onError: errorToast,
  })
  const template = templates.find((t) => t.engine === item.engine && t.name === item.template)
  const running = job && (job.status === 'running' || job.status === 'queued')
  return (
    <>
      <Field label="Движок">
        <Segmented<MotionEngine>
          value={item.engine}
          onChange={(engine) => {
            const same = templates.find((t) => t.engine === engine && t.name === item.template)
            const first = templates.find((t) => t.engine === engine)
            set({ engine, template: same?.name ?? first?.name ?? item.template })
          }}
          options={[
            { value: 'hyperframes', label: 'HyperFrames' },
            { value: 'remotion', label: 'Remotion' },
          ]}
        />
      </Field>
      <Field label="Шаблон">
        <Choice
          value={item.template}
          onChange={(name) => set({ template: name })}
          options={templates
            .filter((t) => t.engine === item.engine)
            .map((t) => ({ value: t.name, label: t.name }))}
        />
      </Field>
      {template?.variables.map((v) => {
        const value = item.props[v.name] ?? v.default
        return v.type === 'color' ? (
          <Color
            key={v.name}
            label={v.description || v.name}
            value={String(value)}
            onCommit={(c) => set({ props: { ...item.props, [v.name]: c } })}
          />
        ) : v.type === 'boolean' ? (
          <label key={v.name} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!value}
              onChange={(e) => set({ props: { ...item.props, [v.name]: e.target.checked } })}
            />
            {v.description || v.name}
          </label>
        ) : (
          <Field key={v.name} label={v.description || v.name}>
            <Input
              defaultValue={String(value ?? '')}
              key={`${item.id}-${v.name}-${String(value)}`}
              onBlur={(e) => {
                const next = v.type === 'number' ? Number(e.target.value) : e.target.value
                if (next !== value) set({ props: { ...item.props, [v.name]: next } })
              }}
              className="h-8"
            />
          </Field>
        )
      })}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={item.overlay}
          onChange={(e) => set({ overlay: e.target.checked })}
        />
        Поверх видео (с прозрачностью)
      </label>
      <Button
        size="sm"
        variant="outline"
        onClick={() => render.mutate()}
        loading={render.isPending || !!running}
      >
        <Wand2 />
        {item.renderedAssetId ? 'Перерендерить' : 'Отрендерить сейчас'}
      </Button>
      {job?.status === 'error' ? (
        <p className="text-xs text-destructive" data-selectable>
          {job.error}
        </p>
      ) : null}
    </>
  )
}

export function Inspector({
  composition,
  assets,
  apply,
}: {
  composition: Composition
  assets: Map<string, Asset>
  apply: (ops: CompositionOp[]) => void
}) {
  const selected = useEditor((s) => s.selected)
  const time = useEditor((s) => s.time)
  const select = useEditor((s) => s.select)
  const fonts = useLibraryFonts()
  const found = selected ? findItem(composition, selected) : null
  if (!found) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Ничего не выбрано</p>
        <p className="mt-1">
          Кликни элемент на таймлайне. Перетащи медиа слева на дорожку, чтобы добавить.
        </p>
        <ul className="mt-4 space-y-1 text-xs">
          <li>Пробел — плей/пауза</li>
          <li>S — разрезать выбранное по плейхеду</li>
          <li>Delete — удалить, Shift+Delete — со сдвигом</li>
          <li>← → — кадр назад/вперёд</li>
        </ul>
      </div>
    )
  }
  const item = found.item
  const set = (patch: Record<string, unknown>) => apply([{ op: 'update', id: item.id, patch }])
  const canSplit = time > item.start + 0.05 && time < itemEnd(item) - 0.05
  const asset = 'assetId' in item ? assets.get(item.assetId) : undefined

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
          {item.type === 'clip'
            ? 'Клип'
            : item.type === 'audio'
              ? 'Аудио'
              : item.type === 'text'
                ? 'Текст'
                : item.type === 'captions'
                  ? 'Сабы'
                  : 'Моушн'}
          {asset ? (
            <span className="font-normal text-muted-foreground"> · {asset.name}</span>
          ) : null}
        </h3>
        <Button
          size="icon-xs"
          variant="ghost"
          disabled={!canSplit}
          onClick={() => apply([{ op: 'split', id: item.id, at: time }])}
          aria-label="Разрезать"
        >
          <Scissors />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => {
            apply([{ op: 'remove', id: item.id }])
            select(null)
          }}
          aria-label="Удалить"
        >
          <Trash2 />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        {timecode(item.start)} – {timecode(itemEnd(item))}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Num label="Старт, с" value={item.start} onCommit={(v) => set({ start: Math.max(0, v) })} />
        {item.type === 'clip' || item.type === 'audio' ? (
          <>
            <Num label="Из исходника: с" value={item.in} onCommit={(v) => set({ in: v })} />
            <Num
              label="по"
              value={item.out}
              max={asset?.duration ?? undefined}
              onCommit={(v) => set({ out: v })}
            />
          </>
        ) : (
          <Num
            label="Длина, с"
            value={item.duration}
            onCommit={(v) => set({ duration: Math.max(0.1, v) })}
          />
        )}
      </div>

      {item.type === 'clip' ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Num
              label="Скорость"
              value={item.speed}
              step={0.05}
              min={0.25}
              max={4}
              onCommit={(v) => set({ speed: v })}
            />
            <Num
              label="Громкость"
              value={item.volume}
              step={0.05}
              min={0}
              max={2}
              onCommit={(v) => set({ volume: v })}
            />
          </div>
          <Field label="Вписать">
            <Segmented
              value={item.fit}
              onChange={(fit) => set({ fit })}
              options={[
                { value: 'cover', label: 'Заполнить (кроп)' },
                { value: 'contain', label: 'Целиком' },
              ]}
            />
          </Field>
          <Slider
            label="Фокус кропа X"
            value={item.focus.x}
            min={0}
            max={1}
            step={0.01}
            onCommit={(x) => set({ focus: { ...item.focus, x } })}
          />
          <Slider
            label="Фокус кропа Y"
            value={item.focus.y}
            min={0}
            max={1}
            step={0.01}
            onCommit={(y) => set({ focus: { ...item.focus, y } })}
          />
          <Slider
            label="Зум"
            value={item.zoom}
            min={1}
            max={3}
            step={0.05}
            onCommit={(zoom) => set({ zoom })}
          />
          <div className="grid grid-cols-2 gap-3">
            <Num label="Появление, с" value={item.fadeIn} onCommit={(v) => set({ fadeIn: v })} />
            <Num label="Исчезание, с" value={item.fadeOut} onCommit={(v) => set({ fadeOut: v })} />
          </div>
        </>
      ) : null}

      {item.type === 'audio' ? (
        <>
          <Num
            label="Громкость"
            value={item.volume}
            step={0.05}
            min={0}
            max={2}
            onCommit={(v) => set({ volume: v })}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={item.duck}
              onChange={(e) => set({ duck: e.target.checked })}
            />
            Приглушать под голосом
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Num label="Появление, с" value={item.fadeIn} onCommit={(v) => set({ fadeIn: v })} />
            <Num label="Исчезание, с" value={item.fadeOut} onCommit={(v) => set({ fadeOut: v })} />
          </div>
        </>
      ) : null}

      {item.type === 'text' ? (
        <>
          <Field label="Текст">
            <Textarea
              key={`${item.id}-${item.text}`}
              rows={2}
              defaultValue={item.text}
              onBlur={(e) => e.target.value !== item.text && set({ text: e.target.value })}
            />
          </Field>
          <Field label="Шрифт">
            <Choice
              value={item.style.font}
              onChange={(font) => set({ style: { ...item.style, font } })}
              options={[...new Set([item.style.font, ...fonts.map((f) => f.family)])].map((f) => ({
                value: f,
                label: f,
              }))}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Num
              label="Размер, px"
              value={item.style.size}
              step={2}
              onCommit={(size) => set({ style: { ...item.style, size } })}
            />
            <Num
              label="Насыщенность"
              value={item.style.weight}
              step={100}
              min={100}
              max={900}
              onCommit={(weight) => set({ style: { ...item.style, weight } })}
            />
            <Color
              label="Цвет"
              value={item.style.color}
              onCommit={(color) => set({ style: { ...item.style, color } })}
            />
            <Color
              label="Плашка"
              nullable
              value={item.style.background}
              onCommit={(background) => set({ style: { ...item.style, background } })}
            />
            <Color
              label="Обводка"
              nullable
              value={item.style.stroke}
              onCommit={(stroke) => set({ style: { ...item.style, stroke } })}
            />
          </div>
          <Slider
            label="Позиция X"
            value={item.style.x}
            min={0}
            max={1}
            step={0.01}
            onCommit={(x) => set({ style: { ...item.style, x } })}
          />
          <Slider
            label="Позиция Y"
            value={item.style.y}
            min={0}
            max={1}
            step={0.01}
            onCommit={(y) => set({ style: { ...item.style, y } })}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={item.style.uppercase}
              onChange={(e) => set({ style: { ...item.style, uppercase: e.target.checked } })}
            />
            ЗАГЛАВНЫМИ
          </label>
        </>
      ) : null}

      {item.type === 'captions' ? (
        <>
          <Field label="Стиль">
            <Segmented
              value={item.style.preset}
              onChange={(preset) => set({ style: { ...item.style, preset } })}
              options={[
                { value: 'bold-pop', label: 'Поп' },
                { value: 'karaoke', label: 'Караоке' },
                { value: 'minimal', label: 'Минимал' },
              ]}
            />
          </Field>
          <Field label="Шрифт">
            <Choice
              value={item.style.font}
              onChange={(font) => set({ style: { ...item.style, font } })}
              options={[...new Set([item.style.font, ...fonts.map((f) => f.family)])].map((f) => ({
                value: f,
                label: f,
              }))}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Num
              label="Размер, px"
              value={item.style.size}
              step={2}
              onCommit={(size) => set({ style: { ...item.style, size } })}
            />
            <Num
              label="Слов на экране"
              value={item.style.maxWords}
              step={1}
              min={1}
              max={8}
              onCommit={(maxWords) => set({ style: { ...item.style, maxWords } })}
            />
            <Color
              label="Цвет"
              value={item.style.color}
              onCommit={(color) => set({ style: { ...item.style, color } })}
            />
            <Color
              label="Подсветка"
              value={item.style.highlight}
              onCommit={(highlight) => set({ style: { ...item.style, highlight } })}
            />
          </div>
          <Slider
            label="Высота"
            value={item.style.y}
            min={0.05}
            max={0.95}
            step={0.01}
            onCommit={(y) => set({ style: { ...item.style, y } })}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={item.style.uppercase}
              onChange={(e) => set({ style: { ...item.style, uppercase: e.target.checked } })}
            />
            ЗАГЛАВНЫМИ
          </label>
        </>
      ) : null}

      {item.type === 'motion' ? (
        <MotionFields item={item} compositionId={composition.id} set={set} />
      ) : null}
    </div>
  )
}
