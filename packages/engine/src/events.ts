import { EventEmitter } from 'node:events'
import type { EngineEvent, EntityName, Job } from '@shotbeam/core'

/** Changes the engine announces to the UI (/api/events). */
export class EventBus {
  private readonly emitter = new EventEmitter()

  constructor() {
    this.emitter.setMaxListeners(100)
  }

  changed(entity: EntityName, id: string | null = null) {
    this.emit({ type: 'changed', entity, id })
  }

  job(job: Job) {
    this.emit({ type: 'job', job })
  }

  emit(event: EngineEvent) {
    this.emitter.emit('event', event)
  }

  subscribe(fn: (event: EngineEvent) => void): () => void {
    this.emitter.on('event', fn)
    return () => this.emitter.off('event', fn)
  }
}
