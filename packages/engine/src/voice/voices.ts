import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { newId, nowIso, Transcript, type Voice, type VoiceProviderId } from '@shotbeam/core'
import type { JobQueue } from '../jobs'
import { ffmpeg } from '../media/ffmpeg'
import { kindOf } from '../media/kinds'
import type { Library } from '../paths'
import type { Python } from '../python'
import type { Sources } from '../sources'
import type { Store } from '../store'
import { Chatterbox, FishApi, FishLocal, Kokoro, type VoiceProvider } from './providers'

/*
 * Voices (clones of the person and others) and speech generation. A generated line becomes a
 * `voice` asset of the project, gets transcribed for word times (captions), and goes on the
 * timeline like any audio.
 */

export class Voices {
  readonly providers: Record<VoiceProviderId, VoiceProvider>

  constructor(
    private readonly library: Library,
    private readonly store: Store,
    private readonly jobs: JobQueue,
    private readonly python: Python,
    private readonly sources: Sources,
  ) {
    const settings = () => this.store.getSettings()
    this.providers = {
      'fish-api': new FishApi(settings),
      'fish-local': new FishLocal(settings),
      kokoro: new Kokoro(python),
      chatterbox: new Chatterbox(python),
    }
  }

  async statuses() {
    return Promise.all(Object.values(this.providers).map((p) => p.status()))
  }

  /**
   * Makes a voice from a recording: the sample is kept in the library (16-bit WAV), transcribed
   * when no text is given (fish-speech needs it), then registered with the provider.
   */
  create(input: {
    name: string
    provider: VoiceProviderId
    samplePath: string
    sampleText?: string
    language?: string
  }) {
    if (!existsSync(input.samplePath)) throw new Error(`Sample not found: ${input.samplePath}`)
    if (!kindOf(input.samplePath)) throw new Error('The sample must be an audio or video file')
    const id = newId()
    return this.jobs.enqueue(
      'voice-clone',
      id,
      input.provider === 'fish-api' ? 'net' : 'model',
      async (ctx) => {
        const dir = this.library.voiceDir(id)
        const sample = join(dir, 'sample.wav')
        ctx.progress(0.05, 'Preparing the sample')
        await extractAudioHiFi(input.samplePath, sample, ctx.signal)
        let sampleText = input.sampleText?.trim() ?? ''
        let language = input.language ?? ''
        if (!sampleText && (await this.python.features()).whisper) {
          ctx.progress(0.2, 'Transcribing the sample')
          const settings = this.store.getSettings()
          const for16k = join(dir, 'sample-16k.wav')
          await ffmpeg(['-i', sample, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', for16k], {
            signal: ctx.signal,
          })
          const res = await this.python.call(
            'transcribe',
            [
              '--audio',
              for16k,
              '--model',
              settings.whisperModel,
              '--models',
              join(this.python.modelsDir, 'whisper'),
              '--device',
              settings.whisperDevice,
            ],
            { signal: ctx.signal },
          )
          const t = Transcript.parse(JSON.parse(readFileSync(res.file, 'utf8')))
          res.cleanup()
          sampleText = t.text
          language ||= t.language
        }
        ctx.progress(0.5, 'Registering the voice')
        const ref = await this.providers[input.provider].clone({
          id,
          name: input.name,
          sample,
          sampleText,
          language,
          signal: ctx.signal,
        })
        const voice = this.store.saveVoice({
          id,
          name: input.name,
          provider: input.provider,
          ref,
          sample,
          sampleText,
          language: language || 'ru',
          createdAt: nowIso(),
        })
        return { voiceId: voice.id }
      },
    )
  }

  /** A voice that only names a provider's built-in voice (Kokoro presets, a Fish library voice). */
  addPreset(input: {
    name: string
    provider: VoiceProviderId
    ref: string
    language: string
  }): Voice {
    return this.store.saveVoice({
      id: newId(),
      name: input.name,
      provider: input.provider,
      ref: input.ref,
      sample: null,
      sampleText: '',
      language: input.language,
      createdAt: nowIso(),
    })
  }

  /** Speaks text into a new `voice` asset of the project. */
  speak(input: {
    projectId: string
    text: string
    provider?: VoiceProviderId
    voiceId?: string | null
    language?: string
    speed?: number
    preset?: string
    name?: string
    options?: Record<string, unknown>
  }) {
    const voice = input.voiceId ? this.store.getVoice(input.voiceId) : null
    const providerId =
      input.provider ?? voice?.provider ?? this.store.getSettings().defaultVoiceProvider
    if (
      voice &&
      voice.provider !== providerId &&
      providerId !== 'chatterbox' &&
      providerId !== 'fish-local'
    ) {
      throw new Error(
        `Voice "${voice.name}" belongs to ${voice.provider}; pick that provider or another voice`,
      )
    }
    const provider = this.providers[providerId]
    const lane = providerId === 'fish-api' || providerId === 'fish-local' ? 'net' : 'model'
    const id = newId()
    return this.jobs.enqueue('tts', input.projectId, lane, async (ctx) => {
      const out = join(this.library.generated('voice'), `${id}.wav`)
      await provider.speak(
        {
          text: input.text,
          voice,
          language: input.language ?? voice?.language ?? 'ru',
          speed: input.speed ?? 1,
          preset: input.preset,
          options: input.options ?? {},
          signal: ctx.signal,
          onProgress: (f, m) => ctx.progress(f * 0.8, m),
        },
        out,
      )
      const label = input.name?.trim() || input.text.replace(/\s+/g, ' ').slice(0, 60)
      const asset = this.sources.importFile(out, { projectId: input.projectId, role: 'voice' })
      this.store.saveAsset({
        ...this.store.getAsset(asset.id),
        name: label,
        notes: input.text,
        tags: [providerId, ...(voice ? [voice.name] : [])],
      })
      return { assetId: asset.id }
    })
  }
}

/** Mono 44.1 kHz WAV for cloning (higher quality than the 16 kHz analysis copy). */
async function extractAudioHiFi(input: string, out: string, signal?: AbortSignal) {
  await ffmpeg(['-i', input, '-vn', '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', out], {
    signal,
  })
}
