import { z } from 'zod'
import { MotionEngine, VoiceProviderId } from './model'

export const FISH_MODELS = ['s2.1-pro', 's2.1-pro-free', 's2-pro', 'drama-3'] as const

export const Settings = z.object({
  fishApiKey: z.string().default(''),
  fishModel: z.enum(FISH_MODELS).default('s2.1-pro-free'),
  /** A fish-speech server (tools/api_server.py): this computer, the home one, a rented GPU. */
  fishLocalUrl: z.string().default('http://127.0.0.1:8080'),
  defaultVoiceProvider: VoiceProviderId.default('fish-api'),
  defaultMotionEngine: MotionEngine.default('hyperframes'),
  whisperModel: z.enum(['base', 'small', 'medium', 'large-v3', 'large-v3-turbo']).default('small'),
  whisperDevice: z.enum(['auto', 'cuda', 'cpu']).default('auto'),
  /** H.264 encoder for renders and proxies. */
  encoder: z.enum(['auto', 'nvenc', 'cpu']).default('auto'),
  /** Browser whose cookies yt-dlp uses (Instagram wants a signed-in session). */
  cookiesBrowser: z.enum(['none', 'firefox', 'chrome', 'edge', 'brave']).default('none'),
})
export type Settings = z.infer<typeof Settings>

/** Settings as the UI and MCP see them: secrets are only said to be set. */
export type PublicSettings = Omit<Settings, 'fishApiKey'> & { fishApiKeySet: boolean }

export function publicSettings(s: Settings): PublicSettings {
  const { fishApiKey, ...rest } = s
  return { ...rest, fishApiKeySet: fishApiKey.length > 0 }
}
