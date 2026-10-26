import type { Asset, CompositionOp, Item, Track } from '@shotbeam/core'
import { isFree, itemEnd, TRACK_ITEMS } from '@shotbeam/core'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  MenuShortcut,
} from '@shotbeam/ui'
import { Copy, CopyPlus, FolderOpen, Scissors, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { reveal } from '../../components/menus'
import { useEditor } from './state'

export function TimelineItemMenu({
  item,
  track,
  asset,
  apply,
  children,
}: {
  item: Item
  track: Track
  asset?: Asset
  apply: (ops: CompositionOp[]) => void
  children: ReactNode
}) {
  const time = useEditor((s) => s.time)
  const clipboard = useEditor((s) => s.clipboard)
  const split = time > item.start + 0.05 && time < itemEnd(item) - 0.05
  const remove = (ripple = false) => {
    useEditor.getState().select(null)
    apply([{ op: 'remove', id: item.id, ripple }])
  }
  const addCopy = (source: Item, start: number) => {
    const { id: _id, ...copy } = source
    const fits =
      TRACK_ITEMS[track.kind].includes(source.type) &&
      isFree(track, start, start + itemEnd(source) - source.start)
    apply([{ op: 'add', item: { ...copy, start }, trackId: fits ? track.id : undefined }])
  }
  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open) useEditor.getState().select(item.id)
      }}
    >
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-72">
        <ContextMenuItem onSelect={() => useEditor.getState().copy(item)}>
          <Copy />
          Копировать<MenuShortcut>Ctrl+C</MenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            useEditor.getState().copy(item)
            remove()
          }}
        >
          <Scissors />
          Вырезать<MenuShortcut>Ctrl+X</MenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!clipboard}
          onSelect={() => clipboard && addCopy(clipboard, time)}
        >
          <CopyPlus />
          Вставить у курсора<MenuShortcut>Ctrl+V</MenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => addCopy(item, itemEnd(item))}>
          <CopyPlus />
          Дублировать<MenuShortcut>Ctrl+D</MenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={!split}
          onSelect={() => apply([{ op: 'split', id: item.id, at: time }])}
        >
          <Scissors />
          Разрезать у курсора<MenuShortcut>S</MenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => useEditor.getState().setTime(item.start)}>
          Перейти к началу
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => useEditor.getState().setTime(itemEnd(item))}>
          Перейти к концу
        </ContextMenuItem>
        {asset ? (
          <ContextMenuItem onSelect={() => void reveal(asset.path)}>
            <FolderOpen />
            Показать исходник
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuItem destructive onSelect={() => remove()}>
          <Trash2 />
          Удалить<MenuShortcut>Delete</MenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem destructive onSelect={() => remove(true)}>
          <Trash2 />
          Удалить со сдвигом<MenuShortcut>Shift+Del</MenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
