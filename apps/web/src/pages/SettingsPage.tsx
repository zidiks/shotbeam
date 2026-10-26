import type { Settings } from '@shotbeam/core'
import { FISH_MODELS } from '@shotbeam/core'
import { Button, Input } from '@shotbeam/ui'
import { useMutation } from '@tanstack/react-query'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { Copy, Plug } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Choice, Field, PageHeader, Section, Segmented, StatusDot } from '../components/common'
import { api } from '../lib/api'
import { errorToast, useSettings, useSetup } from '../lib/queries'
import { type Theme, useUi } from '../lib/store'

const FEATURES: { id: string; label: string; hint: string }[] = [
  {
    id: 'whisper',
    label: 'Распознавание речи (faster-whisper)',
    hint: 'Транскрипты со словами: сабы, поиск, моменты',
  },
  { id: 'cuda', label: 'CUDA для Whisper', hint: 'Ускорение на видеокарте NVIDIA (~1 ГБ)' },
  { id: 'ytdlp', label: 'yt-dlp', hint: 'Скачивание референсов по ссылкам' },
  { id: 'beats', label: 'Биты музыки (librosa)', hint: 'BPM и монтаж в бит' },
  { id: 'kokoro', label: 'Kokoro TTS', hint: 'Локальная озвучка-черновик (~350 МБ)' },
  {
    id: 'chatterbox',
    label: 'Chatterbox Multilingual',
    hint: 'Локальный клон голоса, есть русский (PyTorch, несколько ГБ)',
  },
]

function McpHelp({ library, entry }: { library: string; entry: string }) {
  const [connecting, setConnecting] = useState<string | null>(null)
  const [installedPath, setInstalledPath] = useState('')
  const cmd = `claude mcp add --scope user shotbeam -- node "${entry}"`
  const connect = async (client: string) => {
    setConnecting(client)
    try {
      const path = await invoke<string>('mcp_connect', { client })
      setInstalledPath(path)
      toast.success('Shotbeam добавлен. Перезапусти выбранное приложение.')
    } catch (err) {
      errorToast(err)
    } finally {
      setConnecting(null)
    }
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(
          {
            mcpServers: {
              shotbeam: { command: 'node', args: [entry], env: { SHOTBEAM_HOME: library } },
            },
          },
          null,
          2,
        ),
      )
      toast.success('Настройки MCP скопированы')
    } catch (err) {
      errorToast(err)
    }
  }
  return (
    <Section
      title="Подключённые приложения (MCP)"
      description="Подключи студию к своему AI-помощнику. После добавления перезапусти выбранное приложение."
    >
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['claude', 'Claude Desktop'],
            ['cursor', 'Cursor'],
            ['codex', 'Codex'],
          ] as const
        ).map(([client, label]) => (
          <Button
            key={client}
            variant="outline"
            size="sm"
            disabled={!isTauri() || connecting !== null}
            loading={connecting === client}
            onClick={() => void connect(client)}
          >
            <Plug />
            Добавить в {label}
          </Button>
        ))}
        <Button variant="ghost" size="sm" onClick={() => void copy()}>
          <Copy />
          Скопировать настройки
        </Button>
      </div>
      {!isTauri() ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Автоподключение доступно в приложении Shotbeam для компьютера. Здесь можно скопировать
          настройки.
        </p>
      ) : null}
      {installedPath ? (
        <p className="mt-2 break-all text-xs text-muted-foreground" data-selectable>
          Настройки сохранены: {installedPath}
        </p>
      ) : null}
      <details className="mt-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer">Подключить Claude Code командой</summary>
        <pre className="mt-2 whitespace-pre-wrap break-all rounded-md bg-muted p-2" data-selectable>
          {cmd}
        </pre>
      </details>
    </Section>
  )
}

export function SettingsPage() {
  const settings = useSettings().data
  const setup = useSetup().data
  const theme = useUi((s) => s.theme)
  const setTheme = useUi((s) => s.setTheme)
  const [fishKey, setFishKey] = useState('')
  const patch = useMutation({
    mutationFn: (p: Partial<Settings>) => api.patch('/api/settings', p),
    onSuccess: () => toast.success('Сохранено'),
    onError: errorToast,
  })
  const install = useMutation({
    mutationFn: (features: string[]) => api.post('/api/setup/python', { features }),
    onSuccess: () => toast('Устанавливаю, прогресс — в списке задач сверху'),
    onError: errorToast,
  })
  if (!settings) return null
  const f = setup?.python.features ?? {}
  return (
    <div className="pb-12">
      <PageHeader title="Настройки" />
      <div className="mx-auto max-w-3xl space-y-4 px-6">
        <Section title="Вид">
          <Segmented<Theme>
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'system', label: 'Как в системе' },
              { value: 'light', label: 'Светлая' },
              { value: 'dark', label: 'Тёмная' },
            ]}
          />
        </Section>

        {setup ? <McpHelp library={setup.library} entry={setup.mcpEntry} /> : null}

        <Section
          title="Голос"
          description="Fish Audio: ключ на fish.audio → API Keys. Локальный Fish — сервер fish-speech (tools/api_server.py) на этом или домашнем компе."
        >
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Fish Audio API ключ"
              hint={settings.fishApiKeySet ? 'Ключ сохранён' : 'Не задан'}
            >
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={fishKey}
                  onChange={(e) => setFishKey(e.target.value)}
                  placeholder={settings.fishApiKeySet ? '••••••••' : 'sk-…'}
                />
                <Button
                  variant="outline"
                  disabled={!fishKey}
                  onClick={() =>
                    patch.mutate({ fishApiKey: fishKey }, { onSuccess: () => setFishKey('') })
                  }
                >
                  Сохранить
                </Button>
              </div>
            </Field>
            <Field label="Модель Fish API">
              <Choice
                value={settings.fishModel}
                onChange={(fishModel) => patch.mutate({ fishModel })}
                options={FISH_MODELS.map((m) => ({ value: m, label: m }))}
              />
            </Field>
            <Field
              label="Адрес локального Fish"
              hint="Например http://192.168.1.20:8080 для домашнего компа"
            >
              <Input
                defaultValue={settings.fishLocalUrl}
                onBlur={(e) =>
                  e.target.value !== settings.fishLocalUrl &&
                  patch.mutate({ fishLocalUrl: e.target.value })
                }
              />
            </Field>
            <Field label="Движок по умолчанию">
              <Choice
                value={settings.defaultVoiceProvider}
                onChange={(defaultVoiceProvider) => patch.mutate({ defaultVoiceProvider })}
                options={[
                  { value: 'fish-api', label: 'Fish Audio API' },
                  { value: 'fish-local', label: 'Fish локальный' },
                  { value: 'kokoro', label: 'Kokoro' },
                  { value: 'chatterbox', label: 'Chatterbox' },
                ]}
              />
            </Field>
          </div>
        </Section>

        <Section
          title="Локальные модели"
          description="Ставятся в Python-окружение внутри библиотеки."
        >
          <ul className="divide-y">
            {FEATURES.map((x) => (
              <li key={x.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{x.label}</p>
                  <p className="text-xs text-muted-foreground">{x.hint}</p>
                </div>
                {f[x.id] ? (
                  <StatusDot ok label="установлено" />
                ) : (
                  <Button size="sm" variant="outline" onClick={() => install.mutate([x.id])}>
                    Установить
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <Field
              label="Модель Whisper"
              hint="small — быстро, medium/large точнее (нужно больше видеопамяти)"
            >
              <Choice
                value={settings.whisperModel}
                onChange={(whisperModel) => patch.mutate({ whisperModel })}
                options={['base', 'small', 'medium', 'large-v3-turbo', 'large-v3'].map((m) => ({
                  value: m as Settings['whisperModel'],
                  label: m,
                }))}
              />
            </Field>
            <Field label="Где запускать Whisper">
              <Segmented
                value={settings.whisperDevice}
                onChange={(whisperDevice) => patch.mutate({ whisperDevice })}
                options={[
                  { value: 'auto', label: 'Авто' },
                  { value: 'cuda', label: 'GPU' },
                  { value: 'cpu', label: 'CPU' },
                ]}
              />
            </Field>
          </div>
        </Section>

        <Section title="Рендер и референсы">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Кодировщик" hint="NVENC — видеокарта NVIDIA, если драйвер свежий">
              <Segmented
                value={settings.encoder}
                onChange={(encoder) => patch.mutate({ encoder })}
                options={[
                  { value: 'auto', label: 'Авто' },
                  { value: 'nvenc', label: 'NVENC' },
                  { value: 'cpu', label: 'CPU' },
                ]}
              />
            </Field>
            <Field label="Куки для Instagram" hint="Браузер, где ты залогинен (лучше Firefox)">
              <Choice
                value={settings.cookiesBrowser}
                onChange={(cookiesBrowser) => patch.mutate({ cookiesBrowser })}
                options={(['none', 'firefox', 'chrome', 'edge', 'brave'] as const).map((b) => ({
                  value: b,
                  label: b === 'none' ? 'Без куки' : b,
                }))}
              />
            </Field>
            <Field label="Моушн по умолчанию">
              <Segmented
                value={settings.defaultMotionEngine}
                onChange={(defaultMotionEngine) => patch.mutate({ defaultMotionEngine })}
                options={[
                  { value: 'hyperframes', label: 'HyperFrames' },
                  { value: 'remotion', label: 'Remotion' },
                ]}
              />
            </Field>
          </div>
        </Section>
      </div>
    </div>
  )
}
