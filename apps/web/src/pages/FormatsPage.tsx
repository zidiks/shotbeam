import type { Composition, Format, FormatBeat, FormatRecipe, Project } from '@shotbeam/core'
import { Button, cn, Input } from '@shotbeam/ui'
import { useMutation } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Clapperboard, Film, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Choice,
  Empty,
  Field,
  PageHeader,
  Section,
  Segmented,
  Textarea,
} from '../components/common'
import { FormatMenu } from '../components/menus'
import { api } from '../lib/api'
import { errorToast, useFormat, useFormats, useReferences, useVoices } from '../lib/queries'
import { useUi } from '../lib/store'

function BeatsEditor({
  beats,
  onChange,
}: {
  beats: FormatBeat[]
  onChange: (b: FormatBeat[]) => void
}) {
  const set = (i: number, patch: Partial<FormatBeat>) =>
    onChange(beats.map((b, j) => (j === i ? { ...b, ...patch } : b)))
  const move = (i: number, d: number) => {
    const next = [...beats]
    const [b] = next.splice(i, 1)
    next.splice(i + d, 0, b as FormatBeat)
    onChange(next)
  }
  let at = 0
  return (
    <div className="space-y-2">
      {beats.map((b, i) => {
        const start = at
        at += b.duration
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: beats have no ids; order is the identity
          <div key={i} className="rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-xs text-muted-foreground tabular-nums">
                {start.toFixed(1)}–{at.toFixed(1)} с
              </span>
              <Input
                value={b.name}
                onChange={(e) => set(i, { name: e.target.value })}
                className="h-8 font-medium"
                placeholder="Хук"
              />
              <Input
                type="number"
                step="0.5"
                min="0.5"
                value={b.duration}
                onChange={(e) => set(i, { duration: Number(e.target.value) || 1 })}
                className="h-8 w-20"
              />
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={i === 0}
                onClick={() => move(i, -1)}
                aria-label="Выше"
              >
                <ArrowUp />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={i === beats.length - 1}
                onClick={() => move(i, 1)}
                aria-label="Ниже"
              >
                <ArrowDown />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => onChange(beats.filter((_, j) => j !== i))}
                aria-label="Удалить"
              >
                <Trash2 />
              </Button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(
                [
                  ['purpose', 'Зачем'],
                  ['visual', 'Картинка'],
                  ['text', 'Текст на экране'],
                  ['audio', 'Звук / голос'],
                  ['motion', 'Моушн'],
                ] as const
              ).map(([key, label]) => (
                <Input
                  key={key}
                  value={b[key]}
                  onChange={(e) => set(i, { [key]: e.target.value })}
                  placeholder={label}
                  className="h-8 text-[13px]"
                />
              ))}
            </div>
          </div>
        )
      })}
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          onChange([
            ...beats,
            { name: '', duration: 2, purpose: '', visual: '', text: '', audio: '', motion: '' },
          ])
        }
      >
        <Plus />
        Добавить часть
      </Button>
    </div>
  )
}

function FormatEditor({ id, project }: { id: string; project: Project }) {
  const format = useFormat(id).data
  const voices = useVoices().data ?? []
  const references = useReferences(project.id).data ?? []
  const navigate = useUi((s) => s.navigate)
  const [draft, setDraft] = useState<Format | null>(null)
  useEffect(() => setDraft(format ?? null), [format?.id, format?.updatedAt, format])
  const save = useMutation({
    mutationFn: (f: Format) =>
      api.patch<Format>(`/api/formats/${f.id}`, {
        name: f.name,
        description: f.description,
        recipe: f.recipe,
        referenceIds: f.referenceIds,
      }),
    onSuccess: () => toast.success('Формат сохранён'),
    onError: errorToast,
  })
  const remove = useMutation({
    mutationFn: () => api.del(`/api/formats/${id}`),
    onSuccess: () => navigate({ kind: 'formats' }),
    onError: errorToast,
  })
  const makeVideo = useMutation({
    mutationFn: () =>
      api.post<Composition>('/api/compositions', {
        projectId: project.id,
        name: `${draft?.name} — новое`,
        formatId: id,
      }),
    onSuccess: (c) => navigate({ kind: 'editor', id: c.id }),
    onError: errorToast,
  })
  if (!draft) return null
  const r = draft.recipe
  const setR = (patch: Partial<FormatRecipe>) => setDraft({ ...draft, recipe: { ...r, ...patch } })
  const total = r.beats.reduce((s, b) => s + b.duration, 0)
  const dirty = JSON.stringify(draft) !== JSON.stringify(format)

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 pb-16">
      <div className="sticky top-0 z-10 -mx-6 flex items-center gap-2 border-b bg-background/90 px-6 py-3 backdrop-blur">
        <Input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className="h-9 max-w-sm text-base font-semibold"
        />
        <div className="ml-auto flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => confirm('Удалить формат?') && remove.mutate()}
          >
            <Trash2 />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => makeVideo.mutate()}
            loading={makeVideo.isPending}
          >
            <Film />
            Видео по формату
          </Button>
          <Button
            size="sm"
            variant="brand"
            disabled={!dirty}
            onClick={() => save.mutate(draft)}
            loading={save.isPending}
          >
            Сохранить
          </Button>
        </div>
      </div>
      <Field label="Описание">
        <Textarea
          rows={2}
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />
      </Field>

      <Section title="Основа">
        <div className="grid grid-cols-3 gap-4">
          <Field label="Формат кадра">
            <Segmented
              value={r.aspect}
              onChange={(aspect) => setR({ aspect })}
              options={(['9:16', '1:1', '4:5', '16:9'] as const).map((v) => ({
                value: v,
                label: v,
              }))}
            />
          </Field>
          <Field label="Длина, с" hint={total ? `Части дают ${total.toFixed(1)} с` : undefined}>
            <div className="flex gap-2">
              <Input
                type="number"
                value={r.duration.min}
                onChange={(e) => setR({ duration: { ...r.duration, min: Number(e.target.value) } })}
              />
              <Input
                type="number"
                value={r.duration.max}
                onChange={(e) => setR({ duration: { ...r.duration, max: Number(e.target.value) } })}
              />
            </div>
          </Field>
          <Field label="Средний план, с">
            <Input
              type="number"
              step="0.1"
              value={r.pacing.shot}
              onChange={(e) => setR({ pacing: { ...r.pacing, shot: Number(e.target.value) } })}
            />
          </Field>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={r.pacing.cutOnBeat}
            onChange={(e) => setR({ pacing: { ...r.pacing, cutOnBeat: e.target.checked } })}
          />
          Резать в бит музыки
        </label>
      </Section>

      <Section title="Структура" description="Части ролика по порядку: хук, раскрытие, CTA…">
        <BeatsEditor beats={r.beats} onChange={(beats) => setR({ beats })} />
      </Section>

      <Section title="Хуки" description="Примеры первых фраз, по одной на строку.">
        <Textarea
          rows={3}
          value={r.hooks.join('\n')}
          onChange={(e) => setR({ hooks: e.target.value.split('\n') })}
        />
      </Section>

      <Section title="Сабы">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Стиль">
            <Segmented
              value={r.captions.style as 'bold-pop'}
              onChange={(style) => setR({ captions: { ...r.captions, style } })}
              options={[
                { value: 'bold-pop', label: 'Поп' },
                { value: 'karaoke' as 'bold-pop', label: 'Караоке' },
                { value: 'minimal' as 'bold-pop', label: 'Минимал' },
              ]}
            />
          </Field>
          <Field label="Слов на экране">
            <Input
              type="number"
              min="1"
              max="8"
              value={r.captions.maxWords}
              onChange={(e) =>
                setR({ captions: { ...r.captions, maxWords: Number(e.target.value) } })
              }
            />
          </Field>
          <Field label="Высота (0 — верх, 1 — низ)">
            <Input
              type="number"
              step="0.02"
              min="0"
              max="1"
              value={r.captions.position}
              onChange={(e) =>
                setR({ captions: { ...r.captions, position: Number(e.target.value) } })
              }
            />
          </Field>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={r.captions.uppercase}
              onChange={(e) => setR({ captions: { ...r.captions, uppercase: e.target.checked } })}
            />
            ЗАГЛАВНЫМИ
          </label>
        </div>
      </Section>

      <Section title="Звук и голос">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Музыка: настроение">
            <Input
              value={r.music.mood}
              onChange={(e) => setR({ music: { ...r.music, mood: e.target.value } })}
              placeholder="энергичный фонк"
            />
          </Field>
          <Field label="BPM">
            <Input
              type="number"
              value={r.music.bpm ?? ''}
              onChange={(e) =>
                setR({ music: { ...r.music, bpm: e.target.value ? Number(e.target.value) : null } })
              }
            />
          </Field>
          <Field
            label="Трендовый звук"
            hint="Добавить в приложении соцсети при публикации, в рендер не вшивается."
            className="col-span-2"
          >
            <Input
              value={r.music.trendingSound}
              onChange={(e) => setR({ music: { ...r.music, trendingSound: e.target.value } })}
            />
          </Field>
          <Field label="Голос">
            <Choice
              value={r.voice.voiceId ?? ''}
              onChange={(voiceId) => {
                const v = voices.find((x) => x.id === voiceId)
                setR({ voice: { ...r.voice, voiceId, provider: v?.provider ?? r.voice.provider } })
              }}
              options={voices.map((v) => ({ value: v.id, label: `${v.name} (${v.provider})` }))}
              placeholder="Не выбран"
            />
          </Field>
          <Field label="Язык">
            <Input
              value={r.voice.language}
              onChange={(e) => setR({ voice: { ...r.voice, language: e.target.value } })}
            />
          </Field>
          <Field label="Подача голоса" className="col-span-2">
            <Input
              value={r.voice.style}
              onChange={(e) => setR({ voice: { ...r.voice, style: e.target.value } })}
              placeholder="быстро, с азартом, как другу"
            />
          </Field>
        </div>
      </Section>

      <Section title="Моушн">
        <Field label="Движок по умолчанию">
          <Segmented
            value={r.motionEngine ?? 'none'}
            onChange={(v) => setR({ motionEngine: v === 'none' ? null : (v as 'hyperframes') })}
            options={[
              { value: 'none', label: 'Нет' },
              { value: 'hyperframes', label: 'HyperFrames' },
              { value: 'remotion', label: 'Remotion' },
            ]}
          />
        </Field>
      </Section>

      <Section title="Заметки" description="Всё, что не влезло в поля: что делает формат рабочим.">
        <Textarea rows={6} value={r.notes} onChange={(e) => setR({ notes: e.target.value })} />
      </Section>

      {references.length ? (
        <Section title="Референсы формата">
          <div className="flex flex-wrap gap-2">
            {references.map((ref) => {
              const on = draft.referenceIds.includes(ref.id)
              return (
                <button
                  key={ref.id}
                  type="button"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      referenceIds: on
                        ? draft.referenceIds.filter((x) => x !== ref.id)
                        : [...draft.referenceIds, ref.id],
                    })
                  }
                  className={cn(
                    'max-w-64 truncate rounded-full border px-3 py-1 text-[13px]',
                    on && 'border-brand bg-brand/10',
                  )}
                >
                  {ref.title || ref.url}
                </button>
              )
            })}
          </div>
        </Section>
      ) : null}
    </div>
  )
}

export function FormatsPage({ project, id }: { project: Project; id?: string }) {
  const navigate = useUi((s) => s.navigate)
  const formats = useFormats(project.id).data ?? []
  const create = useMutation({
    mutationFn: () =>
      api.post<Format>('/api/formats', {
        name: 'Новый формат',
        projectId: project.id,
        recipe: {
          beats: [
            { name: 'Хук', duration: 2, purpose: 'Зацепить в первые секунды' },
            { name: 'Раскрытие', duration: 10, purpose: 'Главное' },
            { name: 'CTA', duration: 2, purpose: 'Подписка / действие' },
          ],
        },
      }),
    onSuccess: (f) => navigate({ kind: 'formats', id: f.id }),
    onError: errorToast,
  })
  return (
    <div className="flex h-full min-h-0">
      <div className="w-72 shrink-0 overflow-y-auto border-r">
        <div className="flex items-center gap-2 px-4 pt-5 pb-3">
          <h1 className="flex-1 text-lg font-semibold">Форматы</h1>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => create.mutate()}
            aria-label="Новый формат"
          >
            <Plus />
          </Button>
        </div>
        <ul className="px-2 pb-4">
          {formats.map((f) => (
            <li key={f.id}>
              <FormatMenu format={f}>
                <button
                  type="button"
                  onClick={() => navigate({ kind: 'formats', id: f.id })}
                  className={cn(
                    'w-full rounded-md px-3 py-2 text-left hover:bg-accent',
                    f.id === id && 'bg-accent',
                  )}
                >
                  <p className="truncate text-sm font-medium">{f.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {f.recipe.aspect} · {f.recipe.beats.length} частей
                    {f.projectId ? '' : ' · все проекты'}
                  </p>
                </button>
              </FormatMenu>
            </li>
          ))}
        </ul>
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto">
        {id ? (
          <FormatEditor key={id} id={id} project={project} />
        ) : (
          <>
            <PageHeader
              title="Форматы"
              description="Шаблоны роликов: структура, ритм, сабы, звук, голос, моушн."
            />
            <Empty
              icon={Clapperboard}
              title={formats.length ? 'Выбери формат слева' : 'Форматов пока нет'}
              action={
                <Button variant="brand" onClick={() => create.mutate()} loading={create.isPending}>
                  Создать формат
                </Button>
              }
            >
              Формат удобнее всего выводить в чате с Клодом из референсов: «сделай формат из этих
              двух роликов». Здесь его можно докрутить руками.
            </Empty>
          </>
        )}
      </div>
    </div>
  )
}
