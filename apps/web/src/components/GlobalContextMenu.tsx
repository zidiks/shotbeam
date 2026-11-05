import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MenuShortcut,
} from '@shotbeam/ui'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  ArrowRight,
  ClipboardPaste,
  Copy,
  ExternalLink,
  Keyboard,
  PanelLeft,
  Redo2,
  RefreshCw,
  Scissors,
  Settings,
  TextSelect,
  Undo2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { type MenuEntry, menuZone, tidy } from '../lib/contextMenu'
import { comboLabel } from '../lib/hotkeys'
import { useUi } from '../lib/store'

/*
 * The one menu for right clicks that no card or timeline item claims (see lib/contextMenu.ts):
 * text fields get cut / copy / paste, selected text gets copy, links get open / copy, and
 * everything else gets the actions of the zone under the pointer or of the page. The browser's
 * own menu never shows.
 */

type Field = HTMLInputElement | HTMLTextAreaElement

const TEXT_INPUTS = new Set(['text', 'search', 'url', 'email', 'tel', 'password', 'number', ''])

function editableOf(el: Element | null): Field | HTMLElement | null {
  const field = el?.closest('input, textarea, [contenteditable="true"], [contenteditable=""]')
  if (!field) return null
  if (field instanceof HTMLInputElement && !TEXT_INPUTS.has(field.type)) return null
  return field as Field | HTMLElement
}

const isField = (el: Element): el is Field =>
  el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement

/** Selected text that the right click landed on (outside fields). */
function selectionAt(target: Element): string {
  const sel = window.getSelection()
  const text = sel?.toString() ?? ''
  if (!sel || sel.isCollapsed || !text.trim()) return ''
  for (let i = 0; i < sel.rangeCount; i++) {
    if (sel.getRangeAt(i).intersectsNode(target)) return text
  }
  return ''
}

const keys = {
  undo: comboLabel({ code: 'KeyZ', mod: true }),
  redo: comboLabel({ code: 'KeyY', mod: true }),
  cut: comboLabel({ code: 'KeyX', mod: true }),
  copy: comboLabel({ code: 'KeyC', mod: true }),
  paste: comboLabel({ code: 'KeyV', mod: true }),
  all: comboLabel({ code: 'KeyA', mod: true }),
}

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    toast.error('Нет доступа к буферу обмена')
  }
}

/** Cut, copy, paste… for a text field, keeping its undo history and React's state in step. */
function fieldMenu(el: Field | HTMLElement): MenuEntry[] {
  const field = isField(el) ? el : null
  const start = field?.selectionStart ?? 0
  const end = field?.selectionEnd ?? 0
  const current = window.getSelection()
  const range = !field && current?.rangeCount ? current.getRangeAt(0).cloneRange() : undefined
  const selected = field ? field.value.slice(start, end) : (window.getSelection()?.toString() ?? '')
  const readOnly = field ? field.readOnly || field.disabled : false
  // Number inputs have no selection API.
  const canSelect = !(field instanceof HTMLInputElement && field.type === 'number')
  const restore = () => {
    el.focus()
    if (field && canSelect) field.setSelectionRange(start, end)
    else if (range) {
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
  }
  const exec = (cmd: string, value?: string) => {
    restore()
    document.execCommand(cmd, false, value)
  }
  return [
    {
      label: 'Отменить',
      icon: Undo2,
      shortcut: keys.undo,
      onSelect: () => exec('undo'),
      disabled: readOnly,
    },
    {
      label: 'Повторить',
      icon: Redo2,
      shortcut: keys.redo,
      onSelect: () => exec('redo'),
      disabled: readOnly,
    },
    'separator',
    {
      label: 'Вырезать',
      icon: Scissors,
      shortcut: keys.cut,
      disabled: readOnly || !selected,
      onSelect: () => {
        void writeClipboard(selected)
        exec('delete')
      },
    },
    {
      label: 'Копировать',
      icon: Copy,
      shortcut: keys.copy,
      disabled: !selected,
      onSelect: () => void writeClipboard(selected),
    },
    {
      label: 'Вставить',
      icon: ClipboardPaste,
      shortcut: keys.paste,
      disabled: readOnly,
      onSelect: () =>
        void navigator.clipboard
          .readText()
          .then((text) => exec('insertText', text))
          .catch(() => toast.error(`Нет доступа к буферу обмена — вставь через ${keys.paste}`)),
    },
    'separator',
    {
      label: 'Выделить всё',
      icon: TextSelect,
      shortcut: keys.all,
      onSelect: () => {
        el.focus()
        if (field && canSelect) field.select()
        else document.execCommand('selectAll')
      },
    },
  ]
}

function appMenu(refresh: () => void): MenuEntry[] {
  const ui = useUi.getState()
  return [
    {
      label: 'Назад',
      icon: ArrowLeft,
      shortcut: comboLabel({ code: 'ArrowLeft', alt: true }),
      disabled: !ui.back.length,
      onSelect: ui.goBack,
    },
    {
      label: 'Вперёд',
      icon: ArrowRight,
      shortcut: comboLabel({ code: 'ArrowRight', alt: true }),
      disabled: !ui.forward.length,
      onSelect: ui.goForward,
    },
    'separator',
    { label: 'Обновить данные', icon: RefreshCw, onSelect: refresh },
    ...(ui.route.kind === 'editor'
      ? []
      : [
          {
            label: ui.sidebarOpen ? 'Скрыть боковую панель' : 'Показать боковую панель',
            icon: PanelLeft,
            shortcut: comboLabel({ code: 'Backslash', mod: true }),
            onSelect: ui.toggleSidebar,
          },
        ]),
    {
      label: 'Горячие клавиши',
      icon: Keyboard,
      shortcut: comboLabel({ code: 'Slash', mod: true }),
      onSelect: () => ui.setShortcutsOpen(true),
    },
    {
      label: 'Настройки',
      icon: Settings,
      shortcut: comboLabel({ code: 'Comma', mod: true }),
      onSelect: () => ui.navigate({ kind: 'settings' }),
    },
  ]
}

/** The zone's actions under the pointer, else the page's and the app's. */
function zoneMenu(target: Element, x: number, y: number, refresh: () => void): MenuEntry[] {
  for (let el: Element | null = target; el; el = el.parentElement) {
    const name = el.getAttribute('data-menu')
    // The title bar: the app's own actions only.
    if (name === 'app') return appMenu(refresh)
    const build = name ? menuZone(name) : undefined
    if (!build) continue
    const entries = build({ target, zone: el, x, y })
    if (entries.length) return entries
  }
  const page = menuZone('page')?.({ target, zone: document.body, x, y }) ?? []
  return [...page, 'separator', ...appMenu(refresh)]
}

interface Open {
  x: number
  y: number
  entries: MenuEntry[]
  key: number
}

export function GlobalContextMenu() {
  const qc = useQueryClient()
  const [menu, setMenu] = useState<Open | null>(null)
  const count = useRef(0)

  useEffect(() => {
    const refresh = () => void qc.invalidateQueries()
    const open = (e: MouseEvent, entries: MenuEntry[]) => {
      const tidied = tidy(entries)
      if (!tidied.length) return
      count.current += 1
      setMenu({ x: e.clientX, y: e.clientY, entries: tidied, key: count.current })
    }
    // Text first, before any card's own menu: a field or selected text inside a card is about
    // the text.
    const onCapture = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null
      if (!target) return
      // Inside an open menu: nothing.
      if (target.closest('[data-radix-popper-content-wrapper]')) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      const field = editableOf(target)
      const link = target.closest('a[href]') as HTMLAnchorElement | null
      const text = field ? '' : selectionAt(target)
      if (!field && !text && !link) return
      e.preventDefault()
      e.stopPropagation()
      if (field) return open(e, fieldMenu(field))
      const entries: MenuEntry[] = []
      if (text)
        entries.push({
          label: 'Копировать',
          icon: Copy,
          shortcut: keys.copy,
          onSelect: () => void writeClipboard(text),
        })
      if (link)
        entries.push(
          'separator',
          {
            label: 'Открыть ссылку',
            icon: ExternalLink,
            onSelect: () => window.open(link.href, '_blank', 'noreferrer'),
          },
          {
            label: 'Копировать ссылку',
            icon: Copy,
            onSelect: () => void writeClipboard(link.href),
          },
        )
      entries.push('separator', ...zoneMenu(target, e.clientX, e.clientY, refresh))
      open(e, entries)
    }
    // Then whatever no card or timeline item took (they call preventDefault).
    const onBubble = (e: MouseEvent) => {
      if (e.defaultPrevented) return
      e.preventDefault()
      const target = e.target instanceof Element ? e.target : document.body
      open(e, zoneMenu(target, e.clientX, e.clientY, refresh))
    }
    window.addEventListener('contextmenu', onCapture, true)
    window.addEventListener('contextmenu', onBubble)
    return () => {
      window.removeEventListener('contextmenu', onCapture, true)
      window.removeEventListener('contextmenu', onBubble)
    }
  }, [qc])

  if (!menu) return null
  return (
    <DropdownMenu key={menu.key} open modal={false} onOpenChange={(o) => !o && setMenu(null)}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden="true"
          className="pointer-events-none fixed size-0"
          style={{ left: menu.x, top: menu.y }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={2}
        collisionPadding={8}
        className="w-60"
        // Text actions put the focus back where it belongs themselves.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {menu.entries.map((entry, i) => {
          if (entry === 'separator')
            // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity
            return <DropdownMenuSeparator key={`sep-${i}`} />
          if ('heading' in entry)
            return (
              <DropdownMenuLabel key={`h-${entry.heading}`} className="truncate">
                {entry.heading}
              </DropdownMenuLabel>
            )
          const Icon = entry.icon
          return (
            <DropdownMenuItem
              // biome-ignore lint/suspicious/noArrayIndexKey: labels can repeat across groups
              key={`${entry.label}-${i}`}
              disabled={entry.disabled}
              destructive={entry.destructive}
              onSelect={entry.onSelect}
              className="text-[13px]"
            >
              {Icon ? <Icon /> : <span className="size-4" />}
              <span className="min-w-0 flex-1 truncate">{entry.label}</span>
              {entry.shortcut ? <MenuShortcut>{entry.shortcut}</MenuShortcut> : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
