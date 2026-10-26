import type { EngineEvent, Job } from '@shotbeam/core'
import type { QueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { create } from 'zustand'
import { engineUrl } from './api'
import { keys } from './queries'

/*
 * Live updates: the engine's /api/events (SSE) says what changed; matching queries refetch.
 * Running jobs are kept here for the title bar and progress bars.
 */

interface LiveState {
  connected: boolean
  jobs: Record<string, Job>
}

export const useLive = create<LiveState>(() => ({ connected: false, jobs: {} }))

export function useEngineEvents(qc: QueryClient) {
  useEffect(() => {
    let source: EventSource | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let closed = false

    const connect = () => {
      source = new EventSource(engineUrl('/api/events'))
      source.addEventListener('hello', () => {
        useLive.setState({ connected: true })
        // Anything may have changed while we were away.
        qc.invalidateQueries()
      })
      source.addEventListener('changed', (e) => {
        const event = JSON.parse((e as MessageEvent).data) as Extract<
          EngineEvent,
          { type: 'changed' }
        >
        qc.invalidateQueries({ queryKey: [event.entity] })
        if (event.entity === 'asset') qc.invalidateQueries({ queryKey: ['reference'] })
        if (event.entity === 'settings') qc.invalidateQueries({ queryKey: keys.setup })
      })
      source.addEventListener('job', (e) => {
        const { job } = JSON.parse((e as MessageEvent).data) as Extract<
          EngineEvent,
          { type: 'job' }
        >
        useLive.setState((s) => {
          const jobs = { ...s.jobs, [job.id]: job }
          // Keep finished jobs a little while, so their result can show.
          for (const [id, j] of Object.entries(jobs)) {
            if (
              (j.status === 'done' || j.status === 'error') &&
              Date.now() - Date.parse(j.updatedAt) > 120_000
            )
              delete jobs[id]
          }
          return { jobs }
        })
        if (job.status === 'done' || job.status === 'error') {
          qc.invalidateQueries({ queryKey: keys.jobs })
          if (job.kind === 'python-setup' || job.kind === 'motion-setup')
            qc.invalidateQueries({ queryKey: ['settings'] })
          if (job.kind === 'voice-clone') qc.invalidateQueries({ queryKey: keys.voices })
        }
      })
      source.onerror = () => {
        useLive.setState({ connected: false })
        source?.close()
        if (!closed) retry = setTimeout(connect, 2000)
      }
    }
    connect()
    return () => {
      closed = true
      if (retry) clearTimeout(retry)
      source?.close()
    }
  }, [qc])
}

export function useActiveJobs() {
  const jobs = useLive((s) => s.jobs)
  return Object.values(jobs).filter((j) => j.status === 'queued' || j.status === 'running')
}

/** The latest job of a kind for a target (an asset, a composition…). */
export function useJobFor(kind: string, target: string | null | undefined): Job | null {
  const jobs = useLive((s) => s.jobs)
  if (!target) return null
  let latest: Job | null = null
  for (const j of Object.values(jobs)) {
    if (j.kind === kind && j.target === target && (!latest || j.createdAt > latest.createdAt))
      latest = j
  }
  return latest
}
