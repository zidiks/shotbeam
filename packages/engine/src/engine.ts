import { join } from 'node:path'
import { Compositions } from './compositions'
import { openDatabase } from './db'
import { EventBus } from './events'
import { JobQueue } from './jobs'
import { Indexer } from './media/indexer'
import { Upscaler } from './media/upscale'
import { Motion } from './motion/motion'
import { Music } from './music'
import { Library } from './paths'
import { Python } from './python'
import { References } from './references'
import { Fonts } from './render/fonts'
import { Sources } from './sources'
import { Store } from './store'
import { Tools } from './tools'
import { Voices } from './voice/voices'

/** Everything the engine is made of, wired once. */
export class Engine {
  readonly bus = new EventBus()
  readonly store: Store
  readonly jobs: JobQueue
  readonly python: Python
  readonly indexer: Indexer
  readonly sources: Sources
  readonly references: References
  readonly voices: Voices
  readonly fonts: Fonts
  readonly compositions: Compositions
  readonly motion: Motion
  readonly upscaler: Upscaler
  readonly music: Music
  readonly tools: Tools

  constructor(readonly library = new Library()) {
    const db = openDatabase(library.database)
    this.store = new Store(db, this.bus)
    this.store.failInterruptedJobs()
    this.jobs = new JobQueue(this.store, this.bus)
    this.tools = new Tools(library, this.jobs)
    this.python = new Python(library)
    this.indexer = new Indexer(library, this.store, this.jobs, this.python)
    this.sources = new Sources(this.store, this.indexer)
    this.references = new References(
      library,
      this.store,
      this.jobs,
      this.python,
      this.sources,
      this.indexer,
    )
    this.voices = new Voices(library, this.store, this.jobs, this.python, this.sources)
    this.fonts = new Fonts(join(library.root, 'fonts'))
    this.motion = new Motion(library, this.store, this.jobs, this.sources)
    this.upscaler = new Upscaler(library, this.store, this.jobs, this.sources)
    this.music = new Music(library, this.store, this.jobs, this.python, this.sources)
    this.compositions = new Compositions(
      library,
      this.store,
      this.jobs,
      this.indexer,
      this.sources,
      this.fonts,
      this.motion,
    )

    // A reference becomes ready when its video finished indexing.
    this.bus.subscribe((e) => {
      if (e.type === 'changed' && e.entity === 'asset' && e.id) {
        try {
          this.references.syncStatus(e.id)
        } catch {}
      }
    })
  }

  /** Starts watching folders and finishes indexing left over, once ffmpeg is there. */
  start() {
    this.tools
      .ensureFfmpeg()
      .catch((err) => console.error(`ffmpeg is not available: ${err}`))
      .finally(() => this.resume())
  }

  private resume() {
    this.sources.watchAll()
    // Assets left half-done by a previous run.
    for (const a of this.store.listAssets({ status: 'indexing', limit: 10_000 }).items)
      this.indexer.index(a.id)
    for (const a of this.store.listAssets({ status: 'new', limit: 10_000 }).items)
      this.indexer.index(a.id)
  }

  close() {
    this.sources.close()
    this.store.db.close()
  }
}
