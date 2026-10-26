import { extname } from 'node:path'
import type { AssetKind } from '@shotbeam/core'

const KINDS: Record<string, AssetKind> = {}
for (const ext of [
  'mp4',
  'mov',
  'mkv',
  'webm',
  'avi',
  'm4v',
  'mts',
  'm2ts',
  'wmv',
  'flv',
  '3gp',
  'mxf',
]) {
  KINDS[ext] = 'video'
}
for (const ext of ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wma', 'aif', 'aiff']) {
  KINDS[ext] = 'audio'
}
for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff']) {
  KINDS[ext] = 'image'
}

/** The kind of media a file holds, by its extension; null for anything else. */
export function kindOf(path: string): AssetKind | null {
  return KINDS[extname(path).slice(1).toLowerCase()] ?? null
}

export const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  json: 'application/json',
}

export function mimeOf(path: string): string {
  return MIME[extname(path).slice(1).toLowerCase()] ?? 'application/octet-stream'
}
