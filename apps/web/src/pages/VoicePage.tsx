import type { Job, Project, Voice, VoiceProviderId } from '@shotbeam/core'
import { Button, cn, Input } from '@shotbeam/ui'
import { useMutation } from '@tanstack/react-query'
import { AudioLines, FolderOpen, Mic, Square, Trash2, Wand2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Choice,
  Field,
  PageHeader,
  Progress,
  Section,
  Segmented,
  StatusDot,
  Textarea,
} from '../components/common'
import { AssetMenu, deleteAssetAsk, VoiceMenu } from '../components/menus'
import { api, engineUrl, mediaUrl } from '../lib/api'
import { usePageMenu } from '../lib/contextMenu'
import { useLive } from '../lib/events'
import { timecode } from '../lib/format'
import { errorToast, useAssets, useProviders, useSettings, useVoices } from '../lib/queries'
import { useUi } from '../lib/store'

const KOKORO_PRESETS = [
  'af_heart',
  'af_bella',
  'am_michael',
  'am_fenrir',
  'bm_george',
  'ef_dora',
  'em_alex',
]
const LANGS = [
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'de', label: 'Deutsch' },
  { value: 'fr', label: 'Français' },
  { value: 'pt', label: 'Português' },
]

const READING_SAMPLE = `Привет! Сейчас я записываю свой голос для будущих видео. Мне хочется, чтобы речь звучала естественно: спокойно, уверенно и с живой интонацией.

Сегодня утром я открыл окно. За стеклом шумели деревья, проехал автобус, а где-то во дворе весело засмеялись дети. На столе остывал чай с лимоном. Обычный день, но сколько в нём звуков и маленьких деталей!

А теперь представь: у тебя появилась интересная идея. С чего начать? С первого шага. Запиши пару мыслей, выбери лучший кадр и расскажи свою историю. Не спеши. Сделай паузу, вдохни и продолжай.

Иногда я говорю тише, когда делюсь чем-то личным. Иногда — громче и с радостью: вот это получилось здорово! Бывает, я сомневаюсь: а что, если попробовать иначе? Затем нахожу решение и объясняю его простыми словами.

В четверг, в половине девятого, мы встретились у небольшого книжного магазина. Я купил три книги, цветной блокнот и жёлтый карандаш. Впереди ещё много планов, новых встреч и удивительных открытий. Давай начнём!`

/** Records the microphone and uploads it to the engine; gives back the file path. */
function useRecorder(onDone: (path: string) => void) {
  const [recording, setRecording] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const rec = useRef<MediaRecorder | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      const chunks: Blob[] = []
      const r = new MediaRecorder(stream)
      r.ondataavailable = (e) => chunks.push(e.data)
      r.onstop = async () => {
        for (const t of stream.getTracks()) t.stop()
        setUploading(true)
        try {
          const blob = new Blob(chunks, { type: r.mimeType })
          const res = await fetch(engineUrl('/api/uploads?name=voice-sample.webm'), {
            method: 'POST',
            body: blob,
          })
          if (!res.ok) throw new Error('Не удалось сохранить запись. Попробуй ещё раз.')
          const { path } = (await res.json()) as { path: string }
          onDone(path)
        } catch (err) {
          errorToast(err)
        } finally {
          setUploading(false)
        }
      }
      r.start()
      rec.current = r
      setSeconds(0)
      setRecording(true)
      timer.current = setInterval(() => setSeconds((s) => s + 1), 1000)
    } catch (err) {
      errorToast(err)
    }
  }
  const stop = () => {
    rec.current?.stop()
    setRecording(false)
    if (timer.current) clearInterval(timer.current)
  }
  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current)
      if (rec.current) {
        rec.current.onstop = null
        if (rec.current.state !== 'inactive') rec.current.stop()
        for (const track of rec.current.stream.getTracks()) track.stop()
      }
    },
    [],
  )
  return { recording, uploading, seconds, start, stop }
}

function CloneVoice() {
  const providers = useProviders().data ?? []
  const [name, setName] = useState('Мой голос')
  const [provider, setProvider] = useState<VoiceProviderId>('fish-api')
  const [samplePath, setSamplePath] = useState('')
  const [sampleText, setSampleText] = useState('')
  const [reading, setReading] = useState<'suggested' | 'own'>('suggested')
  const [jobId, setJobId] = useState<string | null>(null)
  const job = useLive((s) => (jobId ? s.jobs[jobId] : undefined))
  const recorder = useRecorder((path) => {
    setSamplePath(path)
    toast.success('Запись готова')
  })
  const create = useMutation({
    mutationFn: () =>
      api.post<Job>('/api/voices', {
        name,
        provider,
        samplePath,
        sampleText: sampleText || undefined,
      }),
    onSuccess: (j) => setJobId(j.id),
    onError: errorToast,
  })
  // biome-ignore lint/correctness/useExhaustiveDependencies: react once per status change
  useEffect(() => {
    if (job?.status === 'done') toast.success(`Голос «${name}» готов`)
    if (job?.status === 'error') toast.error(job.error)
  }, [job?.status])
  const cloners = providers.filter((p) => p.clones)
  return (
    <Section
      id="clone-voice"
      title="Клонировать голос"
      description="30 секунд – 3 минуты чистой речи одного человека, без музыки. Говори как в роликах: с той же энергией."
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Название">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Движок">
            <Segmented
              value={provider}
              onChange={setProvider}
              options={cloners.map((p) => ({
                value: p.id,
                label: p.label.replace(/ \(.*\)/, ''),
                hint: p.detail,
              }))}
            />
          </Field>
        </div>
        <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">Что читать при записи</p>
            <Segmented
              value={reading}
              onChange={setReading}
              options={[
                { value: 'suggested', label: 'Готовый текст' },
                { value: 'own', label: 'Своя речь' },
              ]}
            />
          </div>
          {reading === 'suggested' ? (
            <>
              <p className="text-xs text-muted-foreground">
                Примерно 1–2 минуты. Прочитай вслух своим обычным голосом, с естественными паузами.
                Держи микрофон на одном расстоянии, избегай эха и фонового шума.
              </p>
              <p
                className="max-h-60 overflow-y-auto whitespace-pre-line pr-2 text-sm leading-relaxed"
                data-selectable
              >
                {READING_SAMPLE}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Расскажи о своём дне или прочитай отрывок на нужном языке. Меняй интонацию
              естественно, без шёпота и крика.
            </p>
          )}
        </div>
        <Field label="Образец" hint="Запиши с микрофона или укажи путь к файлу (аудио или видео).">
          <div className="flex gap-2">
            <Input
              value={samplePath}
              disabled={recorder.recording || recorder.uploading}
              onChange={(e) => {
                setSamplePath(e.target.value)
                setSampleText('')
              }}
              placeholder="D:\Записи\мой-голос.wav"
            />
            {recorder.recording ? (
              <Button
                onClick={recorder.stop}
                className="bg-destructive text-white hover:bg-destructive/90"
              >
                <Square />
                {timecode(recorder.seconds, true)}
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() => {
                  setSamplePath('')
                  setSampleText('')
                  void recorder.start()
                }}
                loading={recorder.uploading}
              >
                <Mic />
                Записать
              </Button>
            )}
          </div>
        </Field>
        <Field label="Что сказано в образце" hint="Необязательно: если пусто, распознаю сам.">
          <Textarea rows={2} value={sampleText} onChange={(e) => setSampleText(e.target.value)} />
          {reading === 'suggested' ? (
            <Button
              size="sm"
              variant="ghost"
              className="mt-1"
              disabled={!samplePath || recorder.recording || recorder.uploading}
              onClick={() => setSampleText(READING_SAMPLE)}
            >
              Прочитал текст целиком — заполнить расшифровку
            </Button>
          ) : null}
        </Field>
        <div className="flex items-center gap-3">
          <Button
            variant="brand"
            disabled={!samplePath || !name.trim() || recorder.recording || recorder.uploading}
            onClick={() => create.mutate()}
            loading={create.isPending || job?.status === 'running' || job?.status === 'queued'}
          >
            Создать голос
          </Button>
          {job && job.status !== 'done' && job.status !== 'error' ? (
            <Progress value={job.progress} className="w-40" />
          ) : null}
        </div>
      </div>
    </Section>
  )
}

function Speak({ project }: { project: Project }) {
  const providers = useProviders().data ?? []
  const voices = useVoices().data ?? []
  const settings = useSettings().data
  const [provider, setProvider] = useState<VoiceProviderId | null>(null)
  const [voiceId, setVoiceId] = useState('')
  const [preset, setPreset] = useState('am_michael')
  const [language, setLanguage] = useState('ru')
  const [speed, setSpeed] = useState(1)
  const [text, setText] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const job = useLive((s) => (jobId ? s.jobs[jobId] : undefined))
  const current = provider ?? settings?.defaultVoiceProvider ?? 'fish-api'
  const status = providers.find((p) => p.id === current)
  const usable = voices.filter(
    (v) => v.provider === current || current === 'chatterbox' || current === 'fish-local',
  )
  const speak = useMutation({
    mutationFn: () =>
      api.post<Job>('/api/tts', {
        projectId: project.id,
        text,
        provider: current,
        voiceId: current === 'kokoro' ? null : voiceId || null,
        preset: current === 'kokoro' ? preset : undefined,
        language,
        speed,
      }),
    onSuccess: (j) => setJobId(j.id),
    onError: errorToast,
  })
  // biome-ignore lint/correctness/useExhaustiveDependencies: react once per status change
  useEffect(() => {
    if (job?.status === 'error') toast.error(job.error)
  }, [job?.status])
  return (
    <Section
      title="Озвучить текст"
      description="Движок выбирается перед каждой генерацией. Fish S2 понимает подсказки в квадратных скобках: [взволнованно], [шёпотом], [смеётся]."
    >
      <div className="space-y-4">
        <Segmented
          value={current}
          onChange={setProvider}
          options={providers.map((p) => ({
            value: p.id,
            label: (
              <>
                <span
                  className={cn(
                    'size-1.5 rounded-full',
                    p.available ? 'bg-success' : 'bg-muted-foreground/40',
                  )}
                />
                {p.label}
              </>
            ),
            hint: `${p.detail}. ${p.languages}`,
          }))}
        />
        {status && !status.available ? (
          <p className="text-sm text-destructive">{status.detail}</p>
        ) : null}
        <div className="grid grid-cols-3 gap-4">
          {current === 'kokoro' ? (
            <Field label="Голос Kokoro">
              <Choice
                value={preset}
                onChange={setPreset}
                options={KOKORO_PRESETS.map((v) => ({ value: v, label: v }))}
              />
            </Field>
          ) : (
            <Field label="Голос">
              <Choice
                value={voiceId || 'default'}
                onChange={(v) => setVoiceId(v === 'default' ? '' : v)}
                options={[
                  { value: 'default', label: 'По умолчанию' },
                  ...usable.map((v) => ({ value: v.id, label: v.name })),
                ]}
              />
            </Field>
          )}
          <Field label="Язык">
            <Choice value={language} onChange={setLanguage} options={LANGS} />
          </Field>
          <Field label={`Скорость ×${speed.toFixed(2)}`}>
            <input
              type="range"
              min="0.7"
              max="1.4"
              step="0.05"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="mt-2 w-full accent-[var(--color-brand)]"
            />
          </Field>
        </div>
        <Textarea
          id="speak-text"
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="[азартно] Стоп! Вот три трюка, которые удвоят просмотры…"
        />
        <div className="flex items-center gap-3">
          <Button
            variant="brand"
            disabled={!text.trim() || !status?.available}
            onClick={() => speak.mutate()}
            loading={speak.isPending || job?.status === 'running' || job?.status === 'queued'}
          >
            <Wand2 />
            Озвучить
          </Button>
          {job && (job.status === 'running' || job.status === 'queued') ? (
            <Progress value={job.progress} className="w-40" />
          ) : null}
          <span className="text-xs text-muted-foreground">{text.length} символов</span>
        </div>
      </div>
    </Section>
  )
}

function VoiceList() {
  const voices = useVoices().data ?? []
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/voices/${id}`),
    onError: errorToast,
  })
  if (!voices.length) return null
  return (
    <Section title="Голоса">
      <ul className="divide-y">
        {voices.map((v: Voice) => (
          <VoiceMenu key={v.id} voice={v}>
            <li key={v.id} className="flex items-center gap-3 py-2">
              <span className="font-medium">{v.name}</span>
              <span className="text-xs text-muted-foreground">
                {v.provider} · {v.language}
              </span>
              {v.sample ? (
                // biome-ignore lint/a11y/useMediaCaption: a voice sample
                <audio
                  controls
                  src={engineUrl(`/api/voices/${v.id}/sample`)}
                  className="ml-auto h-8"
                />
              ) : (
                <span className="ml-auto" />
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => confirm(`Удалить голос «${v.name}»?`) && remove.mutate(v.id)}
                aria-label="Удалить"
              >
                <Trash2 />
              </Button>
            </li>
          </VoiceMenu>
        ))}
      </ul>
    </Section>
  )
}

function Generated({ project }: { project: Project }) {
  const items = useAssets({ projectId: project.id, role: 'voice', limit: 20 }).data?.items ?? []
  const navigate = useUi((s) => s.navigate)
  if (!items.length) return null
  return (
    <Section
      title="Готовая озвучка"
      description="Лежит в медиа проекта, ставится в видео как аудио."
    >
      <ul className="divide-y">
        {items.map((a) => (
          <AssetMenu key={a.id} asset={a} onOpen={() => navigate({ kind: 'media', assetId: a.id })}>
            <li className="group flex items-center gap-3 py-2">
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
                onClick={() => navigate({ kind: 'media', assetId: a.id })}
              >
                {a.name}
              </button>
              <span className="text-xs text-muted-foreground">{a.tags.join(' · ')}</span>
              {/* biome-ignore lint/a11y/useMediaCaption: generated speech, transcript in media */}
              <audio controls src={mediaUrl(a.id, 'original')} className="h-8" />
              <Button
                variant="ghost"
                size="icon-xs"
                className="opacity-0 group-hover:opacity-100"
                onClick={() => void deleteAssetAsk(a)}
                aria-label="Удалить озвучку"
              >
                <Trash2 />
              </Button>
            </li>
          </AssetMenu>
        ))}
      </ul>
    </Section>
  )
}

export function VoicePage({ project }: { project: Project }) {
  const providers = useProviders().data ?? []
  const navigate = useUi((s) => s.navigate)
  usePageMenu(() => [
    {
      label: 'Написать текст для озвучки',
      icon: Mic,
      onSelect: () => document.getElementById('speak-text')?.focus(),
    },
    {
      label: 'Клонировать голос',
      icon: AudioLines,
      onSelect: () =>
        document
          .getElementById('clone-voice')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    },
    'separator',
    { label: 'Вся озвучка в медиа', icon: FolderOpen, onSelect: () => navigate({ kind: 'media' }) },
  ])
  return (
    <div className="pb-12">
      <PageHeader
        title="Голос"
        description={
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            {providers.map((p) => (
              <StatusDot key={p.id} ok={p.available} label={p.label} />
            ))}
          </span>
        }
      />
      <div className="mx-auto max-w-3xl space-y-4 px-6">
        <Speak project={project} />
        <Generated project={project} />
        <CloneVoice />
        <VoiceList />
      </div>
    </div>
  )
}
