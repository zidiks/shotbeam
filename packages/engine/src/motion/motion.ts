import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, normalize, relative } from 'node:path'
import { type MotionEngine, type MotionItem, newId } from '@shotbeam/core'
import type { JobQueue } from '../jobs'
import { nodeTool, run } from '../media/run'
import type { Library } from '../paths'
import type { Sources } from '../sources'
import type { Store } from '../store'
import { HYPERFRAMES_STARTERS, REMOTION_PROJECT, REMOTION_STARTERS } from './starters'

/*
 * Motion design in two engines, picked per item:
 * - HyperFrames: each template is a HyperFrames project (HTML + GSAP) in
 *   motion/hyperframes/<template>/, variables declared on <html>;
 * - Remotion: one React project in motion/remotion/, each template a component in
 *   src/templates/<template>.tsx registered by a generated Root.tsx.
 * Every template has template.json (what it is, its variables, whether it is an overlay).
 * A render makes an asset (role `motion`) that the composition places like a clip.
 */

export interface TemplateVariable {
  name: string
  type: 'string' | 'number' | 'color' | 'boolean'
  default: unknown
  description: string
}

export interface MotionTemplate {
  engine: MotionEngine
  name: string
  description: string
  /** Seconds when the item does not say. */
  duration: number
  /** Drawn over the video with transparency (lower thirds, stickers) instead of full frame. */
  overlay: boolean
  variables: TemplateVariable[]
}

const NAME = /^[a-z0-9][a-z0-9-]{0,48}$/

/** Pinned so templates keep rendering the same; raise it deliberately. */
export const HYPERFRAMES_VERSION = '0.8.202'

export class Motion {
  constructor(
    private readonly library: Library,
    private readonly store: Store,
    private readonly jobs: JobQueue,
    private readonly sources: Sources,
  ) {
    this.ensureStarters()
  }

  root(engine: MotionEngine) {
    return this.library.motionDir(engine)
  }

  private templateDir(engine: MotionEngine, name: string) {
    return engine === 'hyperframes'
      ? join(this.root(engine), name)
      : join(this.root(engine), 'src', 'templates', name)
  }

  /** Starter templates and the Remotion project skeleton, written once. */
  private ensureStarters() {
    const hf = this.root('hyperframes')
    for (const [name, files] of Object.entries(HYPERFRAMES_STARTERS)) {
      if (!existsSync(join(hf, name))) this.writeFiles(join(hf, name), files)
    }
    const rm = this.root('remotion')
    if (!existsSync(join(rm, 'package.json'))) this.writeFiles(rm, REMOTION_PROJECT)
    for (const [name, files] of Object.entries(REMOTION_STARTERS)) {
      if (!existsSync(join(rm, 'src', 'templates', name)))
        this.writeFiles(join(rm, 'src', 'templates', name), files)
    }
    this.writeRemotionRoot()
  }

  private writeFiles(dir: string, files: Record<string, string>) {
    for (const [path, content] of Object.entries(files)) {
      const full = normalize(join(dir, path))
      if (relative(dir, full).startsWith('..'))
        throw new Error(`File outside the template: ${path}`)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, content, 'utf8')
    }
  }

  list(engine?: MotionEngine): MotionTemplate[] {
    const out: MotionTemplate[] = []
    for (const e of engine ? [engine] : (['hyperframes', 'remotion'] as const)) {
      const base = e === 'hyperframes' ? this.root(e) : join(this.root(e), 'src', 'templates')
      if (!existsSync(base)) continue
      for (const name of readdirSync(base)) {
        const manifest = join(base, name, 'template.json')
        if (!existsSync(manifest)) continue
        try {
          out.push({
            ...(JSON.parse(readFileSync(manifest, 'utf8')) as MotionTemplate),
            engine: e,
            name,
          })
        } catch {}
      }
    }
    return out
  }

  get(engine: MotionEngine, name: string): MotionTemplate {
    const t = this.list(engine).find((x) => x.name === name)
    if (!t) throw new Error(`No ${engine} template "${name}"`)
    return t
  }

  /** The files of a template, for Claude to read before changing one. */
  files(engine: MotionEngine, name: string): Record<string, string> {
    const dir = this.templateDir(engine, name)
    if (!existsSync(dir)) throw new Error(`No ${engine} template "${name}"`)
    const out: Record<string, string> = {}
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.') || e.name === 'renders') continue
        const p = join(d, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.(html|css|js|ts|tsx|json|svg|md)$/.test(e.name)) {
          out[relative(dir, p).replace(/\\/g, '/')] = readFileSync(p, 'utf8')
        }
      }
    }
    walk(dir)
    return out
  }

  /**
   * Creates or replaces a template (written by Claude or the person). For Remotion the
   * component file must export default a React component taking the variables as props.
   */
  save(
    engine: MotionEngine,
    name: string,
    manifest: Omit<MotionTemplate, 'engine' | 'name'>,
    files: Record<string, string>,
  ) {
    if (!NAME.test(name)) throw new Error('Template names are lowercase letters, digits and dashes')
    if (
      engine === 'hyperframes' &&
      !files['index.html'] &&
      !existsSync(join(this.templateDir(engine, name), 'index.html'))
    ) {
      throw new Error('A HyperFrames template needs index.html')
    }
    if (
      engine === 'remotion' &&
      !files['index.tsx'] &&
      !existsSync(join(this.templateDir(engine, name), 'index.tsx'))
    ) {
      throw new Error('A Remotion template needs index.tsx (export default the component)')
    }
    const dir = this.templateDir(engine, name)
    this.writeFiles(dir, {
      ...files,
      'template.json': JSON.stringify({ ...manifest, engine, name }, null, 2),
    })
    if (engine === 'remotion') this.writeRemotionRoot()
    return this.get(engine, name)
  }

  remove(engine: MotionEngine, name: string) {
    rmSync(this.templateDir(engine, name), { recursive: true, force: true })
    if (engine === 'remotion') this.writeRemotionRoot()
  }

  /** Root.tsx registering every Remotion template, sized by the props it is rendered with. */
  private writeRemotionRoot() {
    const names = this.list('remotion').map((t) => t.name)
    const ident = (n: string) => `T_${n.replace(/-/g, '_')}`
    const src = `// Generated by Shotbeam from src/templates/*: do not edit.
import { Composition } from 'remotion'
${names.map((n) => `import ${ident(n)} from './templates/${n}/index'`).join('\n')}

type Sized = { width?: number; height?: number; fps?: number; duration?: number }
const size = ({ props }: { props: Sized }) => ({
  width: props.width ?? 1080,
  height: props.height ?? 1920,
  fps: props.fps ?? 30,
  durationInFrames: Math.max(1, Math.round((props.duration ?? 3) * (props.fps ?? 30))),
})

export const Root = () => (
  <>
${names
  .map(
    (n) =>
      `    <Composition id="${n}" component={${ident(n)} as never} calculateMetadata={size as never} width={1080} height={1920} fps={30} durationInFrames={90} defaultProps={{}} />`,
  )
  .join('\n')}
  </>
)
`
    writeFileSync(join(this.root('remotion'), 'src', 'Root.tsx'), src, 'utf8')
  }

  /** Whether each engine can render now (Node tools installed). */
  async status() {
    const remotion = existsSync(join(this.root('remotion'), 'node_modules', '@remotion', 'cli'))
    return {
      hyperframes: { ready: true, detail: 'Runs through npx (first render downloads it)' },
      remotion: {
        ready: remotion,
        detail: remotion ? 'Installed' : 'Install once (Settings → Motion)',
      },
    }
  }

  /** npm install for the Remotion project. */
  setupRemotion() {
    return this.jobs.enqueue('motion-setup', 'remotion', 'net', async (ctx) => {
      ctx.progress(0.1, 'npm install (Remotion)')
      const [cmd, args] = nodeTool('npm', ['install', '--no-audit', '--no-fund'])
      await run(cmd, args, { cwd: this.root('remotion'), signal: ctx.signal })
      return this.status()
    })
  }

  /** Renders one motion item as a job; `onDone` gets the new asset id. */
  render(
    compositionId: string,
    item: MotionItem,
    size: { width: number; height: number; fps: number },
    onDone: (assetId: string) => void,
  ) {
    return this.jobs.enqueue('motion', item.id, 'media', async (ctx) => {
      const assetId = await this.renderNow(compositionId, item, size, ctx.progress, ctx.signal)
      onDone(assetId)
      return { assetId }
    })
  }

  /** Renders one motion item to a `motion` asset of the composition's project. */
  async renderNow(
    compositionId: string,
    item: MotionItem,
    size: { width: number; height: number; fps: number },
    progress: (f: number, m?: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const template = this.get(item.engine, item.template)
    const composition = this.store.getComposition(compositionId)
    const ctx = { progress, signal: signal ?? new AbortController().signal }
    {
      const id = newId()
      const transparent = item.overlay || template.overlay
      const ext = transparent ? 'webm' : 'mp4'
      const out = join(this.library.generated('motion'), `${item.template}-${id}.${ext}`)
      const values: Record<string, unknown> = {}
      for (const v of template.variables) values[v.name] = item.props[v.name] ?? v.default
      const work = join(this.library.generated('motion'), `work-${id}`)
      mkdirSync(work, { recursive: true })
      try {
        if (item.engine === 'hyperframes') {
          // A copy sized for this item: the root's size and duration are not variables.
          const project = join(work, 'project')
          cpSync(this.templateDir('hyperframes', item.template), project, { recursive: true })
          const index = join(project, 'index.html')
          writeFileSync(
            index,
            readFileSync(index, 'utf8')
              .replace(/data-duration="[\d.]+"/, `data-duration="${item.duration}"`)
              .replace(/data-width="\d+"/, `data-width="${size.width}"`)
              .replace(/data-height="\d+"/, `data-height="${size.height}"`)
              .replace(
                /(name="viewport" content=")[^"]*"/,
                `$1width=${size.width}, height=${size.height}"`,
              ),
          )
          const vars = join(work, 'vars.json')
          writeFileSync(vars, JSON.stringify(values))
          ctx.progress(0.05, 'HyperFrames render')
          const [cmd, args] = nodeTool('npx', [
            '--yes',
            `hyperframes@${HYPERFRAMES_VERSION}`,
            'render',
            project,
            '--output',
            out,
            '--variables-file',
            vars,
            '--fps',
            String(size.fps),
            '--quality',
            'looks',
            '--format',
            ext,
            '--quiet',
          ])
          await run(cmd, args, { signal: ctx.signal, cwd: work })
        } else {
          const props = join(work, 'props.json')
          writeFileSync(props, JSON.stringify({ ...values, ...size, duration: item.duration }))
          ctx.progress(0.05, 'Remotion render')
          const codec = transparent
            ? ['--codec=vp9', '--pixel-format=yuva420p', '--image-format=png']
            : ['--codec=h264']
          const [cmd, args] = nodeTool('npx', [
            'remotion',
            'render',
            'src/index.ts',
            item.template,
            out,
            `--props=${props}`,
            ...codec,
          ])
          await run(cmd, args, {
            cwd: this.root('remotion'),
            signal: ctx.signal,
            onStdoutLine: (l) => {
              const m = /(\d+)\/(\d+)/.exec(l)
              if (m) ctx.progress(0.05 + (Number(m[1]) / Number(m[2])) * 0.9, 'Remotion render')
            },
          })
        }
      } finally {
        rmSync(work, { recursive: true, force: true })
      }
      if (!existsSync(out)) throw new Error(`${item.engine} wrote no video`)
      const asset = this.sources.importFile(out, {
        projectId: composition.projectId,
        role: 'motion',
      })
      this.store.saveAsset({
        ...this.store.getAsset(asset.id),
        name: `${item.template} (${item.engine})`,
        tags: ['motion', item.engine],
      })
      return asset.id
    }
  }
}
