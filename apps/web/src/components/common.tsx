import {
  cn,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from '@shotbeam/ui'
import type { LucideIcon } from 'lucide-react'
import type * as React from 'react'

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-4 px-6 pt-5 pb-4">
      <div className="min-w-0 flex-1">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function Empty({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon
  title: string
  children?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-16 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-muted">
        <Icon className="size-6 text-muted-foreground" />
      </div>
      <h2 className="font-semibold">{title}</h2>
      {children ? <div className="mt-1.5 text-sm text-muted-foreground">{children}</div> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn('h-1 overflow-hidden rounded-full bg-muted', className)}>
      <div
        className="h-full rounded-full bg-brand transition-[width] duration-300"
        style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }}
      />
    </div>
  )
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string
  hint?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is the child
    <label className={cn('block', className)}>
      <span className="mb-1.5 block text-[13px] font-medium">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  )
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

/** A row of mutually exclusive choices (the provider or engine to use for this generation). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: React.ReactNode; disabled?: boolean; hint?: string }[]
  className?: string
}) {
  return (
    <div className={cn('inline-flex flex-wrap gap-0.5 rounded-lg bg-muted p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.hint}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          aria-pressed={o.value === value}
          className={cn(
            'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40',
            o.value === value && 'bg-card font-medium text-foreground shadow-xs',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Choice<T extends string>({
  value,
  onChange,
  options,
  placeholder,
  className,
}: {
  value: T | ''
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  placeholder?: string
  className?: string
}) {
  return (
    <Select value={value || undefined} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger className={cn('h-9', className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function StatusDot({ ok, label }: { ok: boolean; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn('size-2 rounded-full', ok ? 'bg-success' : 'bg-muted-foreground/40')} />
      {label}
    </span>
  )
}

export function Busy({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner />
      {label}
    </span>
  )
}

export function Section({
  title,
  description,
  children,
  actions,
  id,
}: {
  title: string
  description?: React.ReactNode
  children: React.ReactNode
  actions?: React.ReactNode
  id?: string
}) {
  return (
    <section id={id} className="rounded-xl border bg-card p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}
