import type * as React from 'react'
import { cn } from '../lib/utils'

export function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'pointer-events-none inline-flex h-5 pointer-coarse:hidden min-w-5 select-none items-center justify-center gap-0.5 rounded border bg-muted px-1 font-sans text-[11px] font-medium text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}
