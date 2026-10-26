import { HoverCard as HoverCardPrimitive, Popover as PopoverPrimitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '../lib/utils'

const surface =
  'z-50 rounded-lg border bg-popover text-popover-foreground shadow-float animate-in fade-in-0 zoom-in-95'

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger

export function PopoverContent({
  className,
  align = 'end',
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(surface, 'w-80 p-1 outline-none', className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

/** A card shown while the pointer rests on its trigger (who someone is, and so on). */
export const HoverCard = ({
  openDelay = 150,
  closeDelay = 100,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Root>) => (
  <HoverCardPrimitive.Root openDelay={openDelay} closeDelay={closeDelay} {...props} />
)
export const HoverCardTrigger = HoverCardPrimitive.Trigger

export function HoverCardContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Content>) {
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Content
        sideOffset={sideOffset}
        className={cn(surface, 'px-3 py-2 text-sm outline-none', className)}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  )
}
