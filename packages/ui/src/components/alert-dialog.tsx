import { AlertDialog as Primitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '../lib/utils'
import { buttonVariants } from './button'

/** Small confirm dialog. Works the same in browsers and Tauri, unlike window.confirm. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  destructive,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  destructive?: boolean
}) {
  return (
    <Primitive.Root open={open} onOpenChange={onOpenChange}>
      <Primitive.Portal>
        <Primitive.Overlay className="fixed inset-0 z-50 bg-black/25 animate-in fade-in-0 dark:bg-black/50" />
        <Primitive.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-popover p-5 text-popover-foreground shadow-float animate-in fade-in-0 zoom-in-95">
          <Primitive.Title className="font-semibold">{title}</Primitive.Title>
          {description ? (
            <Primitive.Description className="mt-1.5 text-sm text-muted-foreground">
              {description}
            </Primitive.Description>
          ) : null}
          <div className="mt-5 flex justify-end gap-2">
            <Primitive.Cancel className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
              {cancelLabel}
            </Primitive.Cancel>
            <Primitive.Action
              onClick={onConfirm}
              className={cn(
                buttonVariants({ size: 'sm' }),
                destructive && 'bg-destructive text-white hover:bg-destructive/90',
              )}
            >
              {confirmLabel}
            </Primitive.Action>
          </div>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  )
}
