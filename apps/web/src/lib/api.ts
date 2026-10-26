import { DEFAULT_ENGINE_PORT, EngineClient } from '@shotbeam/core'

/** The local engine. VITE_ENGINE_URL points elsewhere (a second library on another port). */
export const ENGINE_URL: string =
  import.meta.env.VITE_ENGINE_URL || `http://127.0.0.1:${DEFAULT_ENGINE_PORT}`

export const api = new EngineClient(ENGINE_URL)

export type MediaVariant = 'play' | 'thumb' | 'original' | 'proxy' | 'audio'

export function mediaUrl(assetId: string, variant: MediaVariant, bust?: string | number) {
  return `${ENGINE_URL}/api/assets/${assetId}/media/${variant}${bust ? `?v=${encodeURIComponent(String(bust))}` : ''}`
}

export function sheetUrl(assetId: string, index: number) {
  return `${ENGINE_URL}/api/assets/${assetId}/sheets/${index}`
}

export function engineUrl(path: string) {
  return `${ENGINE_URL}${path}`
}
