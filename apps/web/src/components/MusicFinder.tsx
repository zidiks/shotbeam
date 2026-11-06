import { Button, cn, Dialog, DialogContent, DialogTitle, Input } from '@shotbeam/ui'
import { useMutation } from '@tanstack/react-query'
import { Download, ExternalLink, Search, Sparkles, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { api, engineUrl } from '../lib/api'
import { timecode } from '../lib/format'
import { errorToast, useSetup } from '../lib/queries'
import { useUi } from '../lib/store'
import { Field, Segmented, Textarea } from './common'

/*
 * Music from outside the library (the engine's music.ts): Openverse search and import,
 * Pixabay in the browser (it has no music API) with an upload of what was downloaded, and
 * MusicGen on this computer. Everything lands in the shared music library and gets its beats.
 */

interface Track {
  id: string
  title: string
  creator: string
  license: string
  url: string
  duration: number | null
  source: string
  genres: string[]
  tags: string[]
  landing: string
}

type Tab = 'openverse' | 'pixabay' | 'musicgen'

function Openverse() {
  const [q, setQ] = useState('')
  const [shareAlike, setShareAlike] = useState(false)
  const [kind, setKind] = useState<'music' | 'sfx'>('music')
  const [importing, setImporting] = useState<string | null>(null)
  const search = useMutation({
    mutationFn: () =>
      api.get<{ total: number; results: Track[] }>(
        `/api/music/openverse?q=${encodeURIComponent(q.trim())}&license=${shareAlike ? 'share-alike' : 'credit'}&pageSize=20&kind=${kind}`,
      ),
    onError: errorToast,
  })
  const importTrack = async (t: Track) => {
    setImporting(t.id)
    try {
      await api.post(`/api/music/openverse/${t.id}/import`, { projectId: null, role: kind })
      toast.success(`«${t.title}» скачивается в ${kind === 'sfx' ? 'звуки' : 'музыку'}`, {
        description: t.license.startsWith('BY')
          ? 'CC BY: укажи автора в описании ролика — строка атрибуции в заметках трека.'
          : 'Атрибуция не обязательна.',
      })
    } catch (err) {
      errorToast(err)
    } finally {
      setImporting(null)
    }
  }
  return (
    <div className="space-y-3">
      <Segmented
        value={kind}
        onChange={(k) => {
          setKind(k)
          search.reset()
        }}
        options={[
          { value: 'music', label: 'Музыка' },
          { value: 'sfx', label: 'Звуковые эффекты' },
        ]}
      />
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (q.trim()) search.mutate()
        }}
      >
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={
            kind === 'sfx'
              ? 'whoosh, pop, riser, click, impact…'
              : 'upbeat electronic, lofi chill, epic orchestral…'
          }
          autoFocus
        />
        <Button type="submit" variant="brand" disabled={!q.trim()} loading={search.isPending}>
          <Search />
          Найти
        </Button>
      </form>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={shareAlike}
          onChange={(e) => setShareAlike(e.target.checked)}
        />
        Ещё CC BY-SA (тогда и ролик придётся выкладывать под BY-SA)
      </label>
      <p className="text-xs text-muted-foreground">
        Только лицензии, где можно коммерчески и под видео: CC0, общественное достояние, CC BY. Ищи
        по-английски: жанр, настроение, инструменты.
      </p>
      {search.data ? (
        <ul className="max-h-[52vh] divide-y overflow-y-auto rounded-lg border">
          {search.data.results.length === 0 ? (
            <li className="p-4 text-sm text-muted-foreground">Ничего. Попробуй слова пошире.</li>
          ) : null}
          {search.data.results.map((t) => (
            <li key={t.id} className="flex items-center gap-3 p-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {t.title}
                  {t.creator ? (
                    <span className="font-normal text-muted-foreground"> — {t.creator}</span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {t.duration
                    ? `${t.duration < 10 ? `${t.duration.toFixed(1)} с` : timecode(t.duration, true)} · `
                    : ''}
                  {t.license} · {t.source}
                  {t.genres.length || t.tags.length
                    ? ` · ${[...t.genres, ...t.tags].slice(0, 5).join(', ')}`
                    : ''}
                </p>
              </div>
              {/* biome-ignore lint/a11y/useMediaCaption: music preview */}
              <audio controls preload="none" src={t.url} className="h-8 w-56 shrink-0" />
              <Button
                size="sm"
                variant="outline"
                loading={importing === t.id}
                onClick={() => void importTrack(t)}
              >
                <Download />
                {kind === 'sfx' ? 'В звуки' : 'В музыку'}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function Pixabay() {
  const [q, setQ] = useState('')
  const [uploading, setUploading] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const upload = async (f: File) => {
    setUploading(true)
    try {
      const res = await fetch(engineUrl(`/api/uploads?name=${encodeURIComponent(f.name)}`), {
        method: 'POST',
        body: f,
      })
      if (!res.ok) throw new Error('Не удалось загрузить файл')
      const { path } = (await res.json()) as { path: string }
      await api.post('/api/assets/import', { projectId: null, path, role: 'music' })
      toast.success(`«${f.name}» в музыке`)
    } catch (err) {
      errorToast(err)
    } finally {
      setUploading(false)
    }
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        У Pixabay нет API для музыки: поиск откроется в браузере. Скачай трек и добавь его сюда.
        Учти: на YouTube часть треков Pixabay ловит Content ID.
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const query = q.trim()
          window.open(
            query
              ? `https://pixabay.com/music/search/${encodeURIComponent(query)}/`
              : 'https://pixabay.com/music/',
            '_blank',
            'noreferrer',
          )
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="energetic, phonk…" />
        <Button type="submit" variant="outline">
          <ExternalLink />
          Открыть Pixabay
        </Button>
      </form>
      <input
        ref={file}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void upload(f)
          e.target.value = ''
        }}
      />
      <Button variant="brand" loading={uploading} onClick={() => file.current?.click()}>
        <Upload />
        Добавить скачанный трек
      </Button>
    </div>
  )
}

function MusicGen() {
  const setup = useSetup().data
  const navigate = useUi((s) => s.navigate)
  const [prompt, setPrompt] = useState('')
  const [seconds, setSeconds] = useState(15)
  const [model, setModel] = useState<'small' | 'medium'>('small')
  const generate = useMutation({
    mutationFn: () =>
      api.post('/api/music/generate', { prompt: prompt.trim(), seconds, model, projectId: null }),
    onSuccess: () =>
      toast.success('MusicGen пишет трек', { description: 'Прогресс — в списке задач сверху.' }),
    onError: errorToast,
  })
  const ready = setup?.python.features?.musicgen
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Инструментал до 30 с на этом компьютере. Веса MusicGen под CC BY-NC 4.0 — для монетизируемых
        роликов не подходит.
      </p>
      {setup && !ready ? (
        <div className="flex items-center gap-3 rounded-lg border p-3 text-sm">
          <span className="flex-1">MusicGen не установлен.</span>
          <Button size="sm" variant="outline" onClick={() => navigate({ kind: 'settings' })}>
            В настройки
          </Button>
        </div>
      ) : null}
      <Field label="Описание (по-английски)">
        <Textarea
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="upbeat synthwave, punchy drums, catchy lead, 120 bpm"
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label={`Длина: ${seconds} с`}>
          <input
            type="range"
            min={5}
            max={30}
            value={seconds}
            onChange={(e) => setSeconds(Number(e.target.value))}
            className="w-full accent-[var(--color-brand)]"
          />
        </Field>
        <Field label="Модель">
          <Segmented
            value={model}
            onChange={setModel}
            options={[
              { value: 'small', label: 'small — быстрее' },
              { value: 'medium', label: 'medium — лучше' },
            ]}
          />
        </Field>
      </div>
      <Button
        variant="brand"
        disabled={!ready || prompt.trim().length < 3}
        loading={generate.isPending}
        onClick={() => generate.mutate()}
      >
        <Sparkles />
        Сгенерировать
      </Button>
    </div>
  )
}

export function MusicFinder({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const [tab, setTab] = useState<Tab>('openverse')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('top-[6%] max-w-3xl')}>
        <DialogTitle className="text-lg font-semibold">Музыка для роликов</DialogTitle>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          Треки ложатся в общую музыку: биты и настроение посчитаются сами, Клод найдёт их через
          find_music.
        </p>
        <Segmented
          value={tab}
          onChange={setTab}
          className="mb-4"
          options={[
            { value: 'openverse', label: 'Openverse (CC)' },
            { value: 'pixabay', label: 'Pixabay' },
            { value: 'musicgen', label: 'Сгенерировать' },
          ]}
        />
        {tab === 'openverse' ? <Openverse /> : tab === 'pixabay' ? <Pixabay /> : <MusicGen />}
      </DialogContent>
    </Dialog>
  )
}
