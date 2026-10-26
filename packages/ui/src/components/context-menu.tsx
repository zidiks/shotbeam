import { ChevronRight } from 'lucide-react'
import { ContextMenu as Primitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '../lib/utils'

export const ContextMenu = Primitive.Root
export const ContextMenuTrigger = Primitive.Trigger
export const ContextMenuSub = Primitive.Sub

const panel =
  'z-50 min-w-48 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-float animate-in fade-in-0 zoom-in-95'
const item =
  'relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-[13px] outline-none data-disabled:pointer-events-none data-highlighted:bg-accent data-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:opacity-70'

export function ContextMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content className={cn(panel, className)} {...props} />
    </Primitive.Portal>
  )
}

export function ContextMenuItem({
  className,
  destructive,
  ...props
}: React.ComponentProps<typeof Primitive.Item> & { destructive?: boolean }) {
  return (
    <Primitive.Item
      className={cn(
        item,
        destructive && 'text-destructive data-highlighted:bg-destructive/10 [&_svg]:opacity-100',
        className,
      )}
      {...props}
    />
  )
}

export function ContextMenuSubTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Primitive.SubTrigger>) {
  return (
    <Primitive.SubTrigger className={cn(item, 'data-[state=open]:bg-accent', className)} {...props}>
      {children}
      <ChevronRight className="ml-auto" />
    </Primitive.SubTrigger>
  )
}

export function ContextMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.SubContent>) {
  return (
    <Primitive.Portal>
      <Primitive.SubContent
        className={cn(panel, 'max-h-80 overflow-y-auto', className)}
        {...props}
      />
    </Primitive.Portal>
  )
}

export function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Separator>) {
  return <Primitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
}

/** Right-aligned shortcut hint inside a menu item. */
export function MenuShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn('ml-auto pl-4 text-[11px] tracking-wide text-muted-foreground', className)}
      {...props}
    />
  )
}
