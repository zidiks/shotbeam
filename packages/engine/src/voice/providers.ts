import { readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { encode } from '@msgpack/msgpack'
import type { Settings, Voice, VoiceProviderId } from '@shotbeam/core'
import { mimeOf } from '../media/kinds'
import type { Python } from '../python'

/*
 * Text-to-speech engines, chosen per generation. Each one says whether it can run right now,
 * may make a voice from a sample (clone), and speaks text into a WAV file.
 */

export interface ProviderStatus {
  id: VoiceProviderId
  label: string
  available: boolean
  detail: string
  /** Makes a voice from a recording of the person. */
  clones: boolean
  local: boolean
  languages: string
}

export interface SpeakInput {
  text: string
  voice: Voice | null
  language: string
  speed: number
  /** A built-in voice (Kokoro) when no cloned voice is given. */
  preset?: string
  /** Provider-specific knobs (temperature, exaggeration, …). */
  options: Record<string, unknown>
  signal?: AbortSignal
  onProgress?: (f: number, m: string) => void
}

export interface CloneInput {
  id: string
  name: string
  sample: string
  sampleText: string
  language: string
  signal?: AbortSignal
}

export interface VoiceProvider {
  id: VoiceProviderId
  status(): Promise<ProviderStatus>
  /** Returns the provider's handle for the new voice (stored as `Voice.ref`). */
  clone(input: CloneInput): Promise<string>
  speak(input: SpeakInput, out: string): Promise<void>
}

const FISH_API = 'https://api.fish.audio'

async function failure(res: Response, what: string) {
  let detail = ''
  try {
    const body = (await res.json()) as { message?: string; reason?: string; detail?: unknown }
    detail = body.message ?? body.reason ?? JSON.stringify(body.detail ?? body)
  } catch {
    detail = res.statusText
  }
  return new Error(`${what} failed (${res.status}): ${detail}`)
}

function fileBlob(path: string) {
  return new Blob([readFileSync(path)], { type: mimeOf(path) })
}

export class FishApi implements VoiceProvider {
  readonly id = 'fish-api' as const
  constructor(private readonly settings: () => Settings) {}

  private headers(): Record<string, string> {
    const key = this.settings().fishApiKey
    if (!key) throw new Error('Add a Fish Audio API key in Settings → Voice')
    return { authorization: `Bearer ${key}` }
  }

  async status(): Promise<ProviderStatus> {
    const s = this.settings()
    return {
      id: this.id,
      label: 'Fish Audio API',
      available: !!s.fishApiKey,
      detail: s.fishApiKey ? `Model ${s.fishModel}` : 'No API key',
      clones: true,
      local: false,
      languages: '80+ languages, Russian included',
    }
  }

  async clone(input: CloneInput): Promise<string> {
    const form = new FormData()
    form.append('type', 'tts')
    form.append('title', input.name)
    form.append('train_mode', 'fast')
    form.append('visibility', 'private')
    form.append('enhance_audio_quality', 'true')
    form.append('voices', fileBlob(input.sample), basename(input.sample))
    if (input.sampleText.trim()) form.append('texts', input.sampleText.trim())
    const res = await fetch(`${FISH_API}/model`, {
      method: 'POST',
      headers: this.headers(),
      body: form,
      signal: input.signal,
    })
    if (!res.ok) throw await failure(res, 'Fish Audio voice clone')
    const body = (await res.json()) as { _id?: string }
    if (!body._id) throw new Error('Fish Audio did not return a voice id')
    return body._id
  }

  async speak(input: SpeakInput, out: string) {
    const s = this.settings()
    input.onProgress?.(0.1, 'Fish Audio is speaking')
    const res = await fetch(`${FISH_API}/v1/tts`, {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': 'application/json', model: s.fishModel },
      body: JSON.stringify({
        text: input.text,
        reference_id: input.voice?.ref || undefined,
        format: 'wav',
        normalize: true,
        latency: 'normal',
        temperature: input.options.temperature ?? 0.7,
        top_p: input.options.topP ?? 0.7,
        prosody: { speed: input.speed, volume: 0, normalize_loudness: true },
      }),
      signal: input.signal,
    })
    if (!res.ok) throw await failure(res, 'Fish Audio speech')
    writeFileSync(out, Buffer.from(await res.arrayBuffer()))
  }
}

/** A fish-speech server (tools/api_server.py) on this computer, the home one or a rented GPU. */
export class FishLocal implements VoiceProvider {
  readonly id = 'fish-local' as const
  constructor(private readonly settings: () => Settings) {}

  private get url() {
    return this.settings().fishLocalUrl.replace(/\/+$/, '')
  }

  async status(): Promise<ProviderStatus> {
    let available = false
    let detail = ''
    try {
      const res = await fetch(`${this.url}/v1/health`, { signal: AbortSignal.timeout(2500) })
      available = res.ok
      detail = res.ok ? `Running at ${this.url}` : `${this.url} answered ${res.status}`
    } catch {
      detail = `No fish-speech server at ${this.url}`
    }
    return {
      id: this.id,
      label: 'Fish local (fish-speech)',
      available,
      detail,
      clones: true,
      local: true,
      languages: 'S2 Pro: 80+ languages',
    }
  }

  async clone(input: CloneInput): Promise<string> {
    const form = new FormData()
    form.append('id', input.id)
    form.append('audio', fileBlob(input.sample), basename(input.sample))
    form.append('text', input.sampleText)
    const res = await fetch(`${this.url}/v1/references/add`, {
      method: 'POST',
      body: form,
      signal: input.signal,
    })
    // Already there (a second clone of the same voice): fine, the id is ours.
    if (!res.ok && res.status !== 409) throw await failure(res, 'fish-speech reference')
    return input.id
  }

  async speak(input: SpeakInput, out: string) {
    input.onProgress?.(0.1, 'fish-speech is speaking')
    const voice = input.voice
    const body = {
      text: input.text,
      reference_id: voice?.ref ?? null,
      // The sample travels with the request too, so a server that lost its saved references
      // (another machine, a reinstall) still speaks in the right voice.
      references:
        voice?.sample && voice.sampleText
          ? [{ audio: readFileSync(voice.sample), text: voice.sampleText }]
          : [],
      format: 'wav',
      streaming: false,
      normalize: true,
      chunk_length: 200,
      max_new_tokens: 1024,
      temperature: input.options.temperature ?? 0.7,
      top_p: input.options.topP ?? 0.7,
      repetition_penalty: 1.1,
      seed: null,
      use_memory_cache: 'on',
    }
    const res = await fetch(`${this.url}/v1/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/msgpack' },
      body: Buffer.from(encode(body)),
      signal: input.signal,
    })
    if (!res.ok) throw await failure(res, 'fish-speech')
    writeFileSync(out, Buffer.from(await res.arrayBuffer()))
  }
}

/** Kokoro voices by language (kokoro-onnx v1.0). No Russian. */
export const KOKORO_LANGS: Record<string, { lang: string; voices: string[] }> = {
  en: {
    lang: 'en-us',
    voices: ['af_heart', 'af_bella', 'af_nicole', 'am_michael', 'am_fenrir', 'bm_george'],
  },
  es: { lang: 'es', voices: ['ef_dora', 'em_alex'] },
  fr: { lang: 'fr-fr', voices: ['ff_siwis'] },
  it: { lang: 'it', voices: ['if_sara', 'im_nicola'] },
  pt: { lang: 'pt-br', voices: ['pf_dora', 'pm_alex'] },
  ja: { lang: 'ja', voices: ['jf_alpha', 'jm_kumo'] },
  zh: { lang: 'cmn', voices: ['zf_xiaobei', 'zm_yunjian'] },
  hi: { lang: 'hi', voices: ['hf_alpha', 'hm_omega'] },
}

export class Kokoro implements VoiceProvider {
  readonly id = 'kokoro' as const
  constructor(private readonly python: Python) {}

  async status(): Promise<ProviderStatus> {
    const f = await this.python.features().catch(() => null)
    return {
      id: this.id,
      label: 'Kokoro (local)',
      available: !!f?.kokoro,
      detail: f?.kokoro
        ? 'Built-in voices, fast drafts'
        : 'Not installed (Settings → Local models)',
      clones: false,
      local: true,
      languages: 'en, es, fr, it, pt, ja, zh, hi (no Russian)',
    }
  }

  async clone(): Promise<string> {
    throw new Error('Kokoro has only built-in voices; clone with Fish or Chatterbox')
  }

  async speak(input: SpeakInput, out: string) {
    const lang = KOKORO_LANGS[input.language.slice(0, 2)]
    if (!lang) throw new Error(`Kokoro does not speak "${input.language}"; try Fish or Chatterbox`)
    const text = this.python.textFile(input.text)
    try {
      const res = await this.python.call(
        'kokoro',
        [
          '--text-file',
          text.file,
          '--models',
          join(this.python.modelsDir, 'kokoro'),
          '--voice',
          input.preset || (lang.voices[0] as string),
          '--lang',
          lang.lang,
          '--speed',
          String(input.speed),
        ],
        { ext: 'wav', signal: input.signal, onProgress: input.onProgress },
      )
      writeFileSync(out, readFileSync(res.file))
      res.cleanup()
    } finally {
      text.cleanup()
    }
  }
}

export class Chatterbox implements VoiceProvider {
  readonly id = 'chatterbox' as const
  constructor(private readonly python: Python) {}

  async status(): Promise<ProviderStatus> {
    const f = await this.python.features().catch(() => null)
    return {
      id: this.id,
      label: 'Chatterbox Multilingual (local)',
      available: !!f?.chatterbox,
      detail: f?.chatterbox
        ? 'Clones from a sample, runs on this computer'
        : 'Not installed (Settings → Local models)',
      clones: true,
      local: true,
      languages: '23 languages, Russian included',
    }
  }

  /** Chatterbox clones on every request from the sample; nothing to register. */
  async clone(input: CloneInput): Promise<string> {
    return input.sample
  }

  async speak(input: SpeakInput, out: string) {
    const text = this.python.textFile(input.text)
    try {
      const res = await this.python.call(
        'chatterbox',
        [
          '--text-file',
          text.file,
          '--lang',
          input.language.slice(0, 2),
          '--ref',
          input.voice?.sample ?? '',
          '--exaggeration',
          String(input.options.exaggeration ?? 0.5),
          '--cfg',
          String(input.options.cfg ?? 0.5),
        ],
        { ext: 'wav', signal: input.signal, onProgress: input.onProgress },
      )
      writeFileSync(out, readFileSync(res.file))
      res.cleanup()
    } finally {
      text.cleanup()
    }
  }
}
