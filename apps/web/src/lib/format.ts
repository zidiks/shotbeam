/** 75.3 → "1:15.3"; whole seconds without the decimal when `short`. */
export function timecode(s: number | null | undefined, short = false): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return '—'
  const m = Math.floor(s / 60)
  const sec = s - m * 60
  return short
    ? `${m}:${String(Math.floor(sec)).padStart(2, '0')}`
    : `${m}:${sec.toFixed(1).padStart(4, '0')}`
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} Б`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} КБ`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} МБ`
  return `${(n / 1024 ** 3).toFixed(2)} ГБ`
}

export const ROLE_LABEL: Record<string, string> = {
  footage: 'Исходники',
  music: 'Музыка',
  sfx: 'Звуки',
  brand: 'Бренд',
  voice: 'Озвучка',
  reference: 'Референс',
  motion: 'Моушн',
  render: 'Рендеры',
}

export const JOB_LABEL: Record<string, string> = {
  index: 'Индексация',
  transcribe: 'Транскрипция',
  beats: 'Биты',
  reference: 'Референс',
  tts: 'Озвучка',
  'voice-clone': 'Клон голоса',
  render: 'Рендер',
  motion: 'Моушн',
  'motion-setup': 'Установка Remotion',
  'python-setup': 'Локальные модели',
}
