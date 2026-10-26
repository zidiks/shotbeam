import { Dialog as Primitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '../lib/utils'

export const Dialog = Primitive.Root
export const DialogTitle = Primitive.Title
export const DialogDescription = Primitive.Description

/** A dialog with room around its content (p-6); layouts of their own pass `p-0`. */
export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="fixed inset-0 z-50 bg-black/25 animate-in fade-in-0 dark:bg-black/50" />
      <Primitive.Content
        className={cn(
          'fixed top-[18%] left-1/2 z-50 max-h-[calc(82dvh-1rem)] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-x-hidden overflow-y-auto rounded-xl border bg-popover p-6 text-popover-foreground shadow-float outline-none animate-in fade-in-0 zoom-in-95',
          className,
        )}
        {...props}
      >
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  )
}
