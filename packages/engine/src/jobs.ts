import { type Job, newId, nowIso } from '@shotbeam/core'
import type { EventBus } from './events'
import type { Store } from './store'

/*
 * Background work in lanes, so a long render does not hold up a download:
 * - media: ffmpeg work (indexing, proxies, renders);
 * - model: local models on the GPU/CPU (Whisper, Kokoro, Chatterbox), one at a time;
 * - net: downloads and cloud calls.
 */

export type Lane = 'media' | 'model' | 'net'

const LANE_LIMIT: Record<Lane, number> = { media: 2, model: 1, net: 3 }

export interface JobContext {
  job: Job
  progress(fraction: number, message?: string): void
  signal: AbortSignal
}

type Runner = (ctx: JobContext) => Promise<unknown>

interface Pending {
  job: Job
  lane: Lane
  run: Runner
  controller: AbortController
  resolve: (value: unknown) => void
  reject: (err: unknown) => void
}

export class JobQueue {
  private readonly queued: Pending[] = []
  private readonly running = new Map<string, Pending>()
  private lastEmit = new Map<string, number>()

  constructor(
    private readonly store: Store,
    private readonly bus: EventBus,
  ) {}

  /** Starts a job; the promise settles with its result (callers may ignore it). */
  enqueue(
    kind: string,
    target: string | null,
    lane: Lane,
    run: Runner,
  ): { job: Job; done: Promise<unknown> } {
    const now = nowIso()
    const job: Job = {
      id: newId(),
      kind,
      status: 'queued',
      progress: 0,
      message: '',
      target,
      result: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    }
    this.save(job)
    let resolve!: (v: unknown) => void
    let reject!: (e: unknown) => void
    const done = new Promise<unknown>((res, rej) => {
      resolve = res
      reject = rej
    })
    done.catch(() => {})
    this.queued.push({ job, lane, run, controller: new AbortController(), resolve, reject })
    this.pump()
    return { job, done }
  }

  /** A job of this kind for this target that has not finished yet, if any. */
  active(kind: string, target: string): Job | null {
    for (const p of [...this.running.values(), ...this.queued]) {
      if (p.job.kind === kind && p.job.target === target) return p.job
    }
    return null
  }

  cancel(id: string): boolean {
    const i = this.queued.findIndex((p) => p.job.id === id)
    if (i >= 0) {
      const [p] = this.queued.splice(i, 1)
      if (p) this.finish(p, { error: 'Cancelled' })
      return true
    }
    const running = this.running.get(id)
    if (running) {
      running.controller.abort()
      return true
    }
    return false
  }

  private save(job: Job, force = true) {
    this.store.saveJob(job)
    // Progress can tick many times a second; the UI needs a few updates.
    const now = Date.now()
    if (!force && now - (this.lastEmit.get(job.id) ?? 0) < 250) return
    this.lastEmit.set(job.id, now)
    this.bus.job(job)
  }

  private pump() {
    for (const lane of Object.keys(LANE_LIMIT) as Lane[]) {
      let busy = [...this.running.values()].filter((p) => p.lane === lane).length
      while (busy < LANE_LIMIT[lane]) {
        const i = this.queued.findIndex((p) => p.lane === lane)
        if (i < 0) break
        const [p] = this.queued.splice(i, 1)
        if (!p) break
        busy++
        this.start(p)
      }
    }
  }

  private start(p: Pending) {
    this.running.set(p.job.id, p)
    p.job = { ...p.job, status: 'running', updatedAt: nowIso() }
    this.save(p.job)
    const ctx: JobContext = {
      job: p.job,
      signal: p.controller.signal,
      progress: (fraction, message) => {
        p.job = {
          ...p.job,
          progress: Math.max(0, Math.min(1, fraction)),
          message: message ?? p.job.message,
          updatedAt: nowIso(),
        }
        this.save(p.job, false)
      },
    }
    p.run(ctx)
      .then((result) => this.finish(p, { result }))
      .catch((err) =>
        this.finish(p, { error: err instanceof Error ? err.message : String(err), err }),
      )
  }

  private finish(p: Pending, outcome: { result?: unknown; error?: string; err?: unknown }) {
    this.running.delete(p.job.id)
    this.lastEmit.delete(p.job.id)
    p.job = {
      ...p.job,
      status: outcome.error ? 'error' : 'done',
      progress: outcome.error ? p.job.progress : 1,
      result: outcome.error ? null : (outcome.result ?? null),
      error: outcome.error ?? null,
      updatedAt: nowIso(),
    }
    this.save(p.job)
    if (outcome.error) {
      console.error(`[job ${p.job.kind} ${p.job.id}] ${outcome.error}`)
      p.reject(outcome.err ?? new Error(outcome.error))
    } else p.resolve(outcome.result)
    this.pump()
  }
}
