import { isApple } from '@shotbeam/ui'

/*
 * Keyboard shortcuts. Keys are matched by physical key (`e.code`), never by `e.key`, so they work
 * in Russian and other layouts. Mod is Ctrl on Windows/Linux, ⌘ on macOS. The list below is what
 * the shortcuts dialog shows; handlers live where the action is (App, EditorPage).
 */

export interface Combo {
  code: string
  mod?: boolean
  shift?: boolean
  alt?: boolean
}

export function matches(e: KeyboardEvent, c: Combo): boolean {
  const mod = isApple ? e.metaKey : e.ctrlKey
  return (
    e.code === c.code &&
    mod === !!c.mod &&
    e.shiftKey === !!c.shift &&
    e.altKey === !!c.alt &&
    // Ctrl and ⌘ are not interchangeable: the other one must be up.
    (isApple ? !e.ctrlKey : !e.metaKey)
  )
}

/** Typing in a field: single-letter shortcuts must not fire. */
export function typing(e: KeyboardEvent): boolean {
  // The target is the window or the document when nothing has focus.
  const t = e.target
  return t instanceof Element && !!t.closest('input, textarea, select, [contenteditable="true"]')
}

const KEY_NAMES: Record<string, string> = {
  Space: 'Пробел',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Delete: 'Delete',
  Backspace: 'Backspace',
  Escape: 'Esc',
  Home: 'Home',
  End: 'End',
  Equal: '+',
  Minus: '−',
  Comma: ',',
  Slash: '/',
  Enter: 'Enter',
  // Mouse, for the list only (never matched against keys).
  Wheel: 'колёсико',
  MiddleDrag: 'средняя кнопка',
}

export function comboLabel(c: Combo): string {
  const key = KEY_NAMES[c.code] ?? c.code.replace(/^Key|^Digit/, '')
  const parts = [
    c.mod ? (isApple ? '⌘' : 'Ctrl') : '',
    c.shift ? 'Shift' : '',
    c.alt ? (isApple ? '⌥' : 'Alt') : '',
    key,
  ]
  return parts.filter(Boolean).join(isApple ? '' : '+')
}

export interface ShortcutGroup {
  title: string
  items: { label: string; combos: Combo[] }[]
}

export const SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Везде',
    items: [
      {
        label: 'Назад / вперёд по экранам',
        combos: [
          { code: 'ArrowLeft', alt: true },
          { code: 'ArrowRight', alt: true },
        ],
      },
      {
        label: 'Медиа, Видео, Референсы, Форматы, Голос, Моушн',
        combos: [
          { code: 'Digit1', mod: true },
          { code: 'Digit6', mod: true },
        ],
      },
      { label: 'Настройки', combos: [{ code: 'Comma', mod: true }] },
      { label: 'Боковая панель', combos: [{ code: 'Backslash', mod: true }] },
      { label: 'Горячие клавиши', combos: [{ code: 'Slash', mod: true }] },
    ],
  },
  {
    title: 'Редактор: правка',
    items: [
      { label: 'Отменить', combos: [{ code: 'KeyZ', mod: true }] },
      {
        label: 'Повторить',
        combos: [
          { code: 'KeyZ', mod: true, shift: true },
          { code: 'KeyY', mod: true },
        ],
      },
      {
        label: 'Копировать / вставить на плейхед',
        combos: [
          { code: 'KeyC', mod: true },
          { code: 'KeyV', mod: true },
        ],
      },
      { label: 'Вырезать', combos: [{ code: 'KeyX', mod: true }] },
      { label: 'Дублировать следом', combos: [{ code: 'KeyD', mod: true }] },
      { label: 'Разрезать по плейхеду', combos: [{ code: 'KeyS' }, { code: 'KeyB', mod: true }] },
      {
        label: 'Удалить / удалить со сдвигом',
        combos: [{ code: 'Delete' }, { code: 'Delete', shift: true }],
      },
      { label: 'Снять выделение', combos: [{ code: 'Escape' }] },
      {
        label: 'Сдвинуть выделенное на кадр (×10 с Shift)',
        combos: [
          { code: 'ArrowLeft', mod: true },
          { code: 'ArrowRight', mod: true },
        ],
      },
    ],
  },
  {
    title: 'Редактор: просмотр и таймлайн',
    items: [
      { label: 'Играть / пауза', combos: [{ code: 'Space' }, { code: 'KeyK' }] },
      {
        label: 'Кадр назад / вперёд (×10 с Shift)',
        combos: [{ code: 'ArrowLeft' }, { code: 'ArrowRight' }],
      },
      {
        label: 'К предыдущей / следующей склейке',
        combos: [{ code: 'ArrowUp' }, { code: 'ArrowDown' }],
      },
      { label: 'В начало / в конец', combos: [{ code: 'Home' }, { code: 'End' }] },
      { label: 'Масштаб таймлайна (у плейхеда)', combos: [{ code: 'Equal' }, { code: 'Minus' }] },
      { label: 'Вписать ролик в таймлайн', combos: [{ code: 'KeyZ', shift: true }] },
      { label: 'Прокрутка по времени', combos: [{ code: 'Wheel' }] },
      { label: 'Прокрутка по дорожкам', combos: [{ code: 'Wheel', shift: true }] },
      { label: 'Масштаб у курсора (и щипок на тачпаде)', combos: [{ code: 'Wheel', mod: true }] },
      { label: 'Двигать область', combos: [{ code: 'MiddleDrag' }] },
      {
        label: 'К предыдущему / следующему биту музыки',
        combos: [
          { code: 'ArrowUp', shift: true },
          { code: 'ArrowDown', shift: true },
        ],
      },
      { label: 'Магнит / наложение', combos: [{ code: 'KeyM' }] },
      { label: 'Склейки дорожки в бит', combos: [{ code: 'KeyB', shift: true }] },
      { label: 'Текст на плейхеде', combos: [{ code: 'KeyT' }] },
      { label: 'Сабы из речи', combos: [{ code: 'KeyC', shift: true }] },
      {
        label: 'Черновой / финальный рендер',
        combos: [
          { code: 'KeyE', mod: true },
          { code: 'KeyE', mod: true, shift: true },
        ],
      },
    ],
  },
]
