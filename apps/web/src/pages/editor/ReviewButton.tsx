import type { ReviewNote, ReviewResult } from '@shotbeam/core'
import { Button, cn, Popover, PopoverContent, PopoverTrigger } from '@shotbeam/ui'
import { useQuery } from '@tanstack/react-query'
import { CircleCheck, ClipboardCheck } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../lib/api'
import { timecode } from '../../lib/format'
import { keys } from '../../lib/queries'
import { useEditor } from './state'

/*
 * The edit's review (core/review.ts via the engine): what would trip a first-time viewer on a
 * phone. Refreshes with every change of the composition (its query key lives under it); a note
 * jumps to its moment and selects its item.
 */

const LEVEL_STYLE: Record<ReviewNote['level'], string> = {
  P0: 'bg-destructive text-white',
  P1: 'bg-amber-500 text-black',
  P2: 'bg-muted text-muted-foreground',
}

export function ReviewButton({ compositionId }: { compositionId: string }) {
  const [open, setOpen] = useState(false)
  const review = useQuery({
    queryKey: [...keys.composition(compositionId), 'review'],
    queryFn: () =>
      api.get<ReviewResult & { render: { assetId: string } | null }>(
        `/api/compositions/${compositionId}/review`,
      ),
  })
  const notes = review.data?.notes ?? []
  const p0 = notes.filter((n) => n.level === 'P0').length
  const p1 = notes.filter((n) => n.level === 'P1').length
  const go = (n: ReviewNote) => {
    const s = useEditor.getState()
    if (n.at !== null) s.setTime(n.at)
    if (n.itemId) s.select(n.itemId)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="gap-1.5">
          <ClipboardCheck />
          Проверка
          {p0 ? (
            <span className="rounded bg-destructive px-1.5 text-[11px] font-semibold text-white">
              {p0}
            </span>
          ) : null}
          {p1 ? (
            <span className="rounded bg-amber-500 px-1.5 text-[11px] font-semibold text-black">
              {p1}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[420px] p-0">
        <div className="border-b px-3 py-2">
          <p className="text-sm font-semibold">Проверка перед рендером</p>
          {review.data ? (
            <p className="text-xs text-muted-foreground">
              {timecode(review.data.stats.duration)} · планов на V1: {review.data.stats.shots} ·
              средний {review.data.stats.averageShot.toFixed(1)} с
              {review.data.render
                ? ' · громкость по последнему рендеру'
                : ' · громкость — после рендера'}
            </p>
          ) : null}
        </div>
        <ul className="max-h-[60vh] divide-y overflow-y-auto">
          {review.isLoading ? (
            <li className="p-3 text-sm text-muted-foreground">Проверяю…</li>
          ) : null}
          {review.data && !notes.length ? (
            <li className="flex items-center gap-2 p-3 text-sm">
              <CircleCheck className="size-4 text-emerald-500" />
              Измеримых проблем нет. Всё равно посмотри кадры на склейках.
            </li>
          ) : null}
          {notes.map((n) => (
            <li key={`${n.code}-${n.itemId ?? ''}-${n.at ?? ''}-${n.problem}`}>
              <button
                type="button"
                onClick={() => go(n)}
                className="flex w-full gap-2.5 px-3 py-2 text-left hover:bg-accent"
              >
                <span
                  className={cn(
                    'mt-0.5 h-fit rounded px-1.5 text-[11px] font-semibold',
                    LEVEL_STYLE[n.level],
                  )}
                >
                  {n.level}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px]">{n.problem}</span>
                  <span className="block text-xs text-muted-foreground">→ {n.fix}</span>
                </span>
                {n.at !== null ? (
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                    {timecode(n.at)}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
