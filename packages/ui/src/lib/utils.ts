import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** True on macOS/iOS, where the primary modifier is ⌘ instead of Ctrl. */
export const isApple =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

export const modKeyLabel = isApple ? '⌘' : 'Ctrl'

/** Human label for Mod+key: `⌘K` on Apple, `Ctrl+K` elsewhere. */
export function shortcutLabel(key: string) {
  return isApple ? `${modKeyLabel}${key.toUpperCase()}` : `${modKeyLabel}+${key.toUpperCase()}`
}
