/*
 * Starter motion templates written into a new library, one of each kind per engine, so both
 * engines work out of the box and Claude has an example to copy.
 */

/** GSAP for HyperFrames templates (the version `hyperframes init` uses). */
export const GSAP = '3.14.2'

const titleVars = [
  { name: 'headline', type: 'string', default: 'Твой заголовок', description: 'Main line, short' },
  { name: 'subtitle', type: 'string', default: '', description: 'Optional second line' },
  { name: 'accent', type: 'color', default: '#ff6a1a', description: 'Bar colour' },
  { name: 'background', type: 'color', default: '#111111', description: 'Background' },
  { name: 'textColor', type: 'color', default: '#ffffff', description: 'Text colour' },
]

const lowerVars = [
  { name: 'title', type: 'string', default: 'Имя Фамилия', description: 'Bold line' },
  { name: 'subtitle', type: 'string', default: 'кто это', description: 'Small line' },
  { name: 'accent', type: 'color', default: '#ff6a1a', description: 'Plate colour' },
  { name: 'textColor', type: 'color', default: '#ffffff', description: 'Text colour' },
]

const manifest = (description: string, duration: number, overlay: boolean, variables: unknown[]) =>
  JSON.stringify({ description, duration, overlay, variables }, null, 2)

const hfVars = (vars: typeof titleVars) =>
  JSON.stringify(
    vars.map((v) => ({ id: v.name, type: v.type, label: v.description, default: v.default })),
  ).replace(/'/g, '&#39;')

export const HYPERFRAMES_STARTERS: Record<string, Record<string, string>> = {
  'kinetic-title': {
    'template.json': manifest(
      'Full-frame kinetic title: headline pops in, accent bar grows, subtitle slides up.',
      3,
      false,
      titleVars,
    ),
    'index.html': `<!doctype html>
<html data-composition-variables='${hfVars(titleVars)}'>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@${GSAP}/dist/gsap.min.js"></script>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
      #root { position: absolute; inset: 0; overflow: hidden; }
      #kt-bg { position: absolute; inset: 0; background: var(--background); }
      #kt-wrap { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 8%; font-family: Montserrat, sans-serif; }
      #kt-headline { color: var(--textColor); font-size: 120px; font-weight: 900; line-height: 1.02; text-align: center; text-transform: uppercase; margin: 0; }
      #kt-bar { width: 0; height: 18px; background: var(--accent); margin-top: 36px; border-radius: 9px; }
      #kt-sub { color: var(--textColor); opacity: 0.85; font-size: 48px; font-weight: 600; margin-top: 28px; text-align: center; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="3" data-width="1080" data-height="1920">
      <div id="kt-bg"></div>
      <div id="kt-wrap">
        <h1 id="kt-headline" data-var-text="headline">Твой заголовок</h1>
        <div id="kt-bar"></div>
        <div id="kt-sub" data-var-text="subtitle"></div>
      </div>
    </div>
    <script>
      const tl = gsap.timeline({ paused: true })
      tl.fromTo('#kt-headline', { opacity: 0, y: 80, scale: 0.92 }, { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: 'back.out(1.4)' }, 0.1)
        .fromTo('#kt-bar', { width: 0 }, { width: 360, duration: 0.45, ease: 'power3.out' }, 0.35)
        .fromTo('#kt-sub', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }, 0.5)
      window.__timelines['main'] = tl
    </script>
  </body>
</html>
`,
  },
  'lower-third': {
    'template.json': manifest(
      'Overlay: name plate sliding in at the bottom left (transparent).',
      4,
      true,
      lowerVars,
    ),
    'index.html': `<!doctype html>
<html data-composition-variables='${hfVars(lowerVars)}'>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@${GSAP}/dist/gsap.min.js"></script>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
      #root { position: absolute; inset: 0; overflow: hidden; }
      #lt-plate { position: absolute; left: 6%; bottom: 22%; padding: 28px 40px; background: var(--accent); border-radius: 22px; font-family: Montserrat, sans-serif; }
      #lt-title { color: var(--textColor); font-size: 64px; font-weight: 900; margin: 0; }
      #lt-sub { color: var(--textColor); opacity: 0.9; font-size: 36px; font-weight: 600; margin-top: 6px; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="1080" data-height="1920">
      <div id="lt-plate">
        <h2 id="lt-title" data-var-text="title">Имя Фамилия</h2>
        <div id="lt-sub" data-var-text="subtitle">кто это</div>
      </div>
    </div>
    <script>
      const tl = gsap.timeline({ paused: true })
      tl.fromTo('#lt-plate', { opacity: 0, x: -120 }, { opacity: 1, x: 0, duration: 0.45, ease: 'power3.out' }, 0.1)
        .fromTo('#lt-sub', { opacity: 0 }, { opacity: 0.9, duration: 0.3 }, 0.4)
        .to('#lt-plate', { opacity: 0, x: -60, duration: 0.35, ease: 'power2.in' }, 3.5)
      window.__timelines['main'] = tl
    </script>
  </body>
</html>
`,
  },
}

export const REMOTION_PROJECT: Record<string, string> = {
  'package.json': `${JSON.stringify(
    {
      name: 'shotbeam-motion',
      private: true,
      dependencies: {
        '@remotion/cli': '^4.0.0',
        remotion: '^4.0.0',
        react: '^19.0.0',
        'react-dom': '^19.0.0',
      },
      devDependencies: { '@types/react': '^19.0.0', typescript: '^5.6.0' },
    },
    null,
    2,
  )}\n`,
  'tsconfig.json': `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        jsx: 'react-jsx',
        strict: true,
        skipLibCheck: true,
      },
      include: ['src'],
    },
    null,
    2,
  )}\n`,
  'src/index.ts': `import { registerRoot } from 'remotion'
import { Root } from './Root'

registerRoot(Root)
`,
  'README.md': `# Shotbeam motion (Remotion)

Each folder in src/templates is a template: index.tsx (export default a component taking the
variables as props) and template.json. src/Root.tsx is generated by Shotbeam.
`,
}

export const REMOTION_STARTERS: Record<string, Record<string, string>> = {
  'kinetic-title': {
    'template.json': manifest(
      'Full-frame kinetic title (spring pop, growing bar, subtitle).',
      3,
      false,
      titleVars,
    ),
    'index.tsx': `import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'

type Props = { headline?: string; subtitle?: string; accent?: string; background?: string; textColor?: string }

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

export default function KineticTitle({
  headline = 'Твой заголовок',
  subtitle = '',
  accent = '#ff6a1a',
  background = '#111111',
  textColor = '#ffffff',
}: Props) {
  const frame = useCurrentFrame()
  const { fps, width, durationInFrames } = useVideoConfig()
  const u = width / 1080
  const pop = spring({ frame: frame - 3, fps, config: { damping: 12 } })
  const bar = interpolate(frame, [8, 22], [0, 1], clamp)
  const sub = interpolate(frame, [14, 26], [0, 1], clamp)
  const out = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], clamp)
  return (
    <AbsoluteFill style={{ background, alignItems: 'center', justifyContent: 'center', padding: 80 * u, opacity: out, fontFamily: 'Montserrat, Arial Black, sans-serif' }}>
      <div style={{ color: textColor, fontSize: 120 * u, fontWeight: 900, textTransform: 'uppercase', textAlign: 'center', lineHeight: 1.02, opacity: pop, transform: \`translateY(\${(1 - pop) * 80 * u}px) scale(\${0.92 + 0.08 * pop})\` }}>
        {headline}
      </div>
      <div style={{ width: 360 * u * bar, height: 18 * u, background: accent, borderRadius: 9 * u, marginTop: 36 * u }} />
      {subtitle ? (
        <div style={{ color: textColor, fontSize: 48 * u, fontWeight: 600, marginTop: 28 * u, opacity: 0.85 * sub, transform: \`translateY(\${(1 - sub) * 30 * u}px)\` }}>
          {subtitle}
        </div>
      ) : null}
    </AbsoluteFill>
  )
}
`,
  },
  'lower-third': {
    'template.json': manifest(
      'Overlay: name plate sliding in at the bottom left (transparent).',
      4,
      true,
      lowerVars,
    ),
    'index.tsx': `import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'

type Props = { title?: string; subtitle?: string; accent?: string; textColor?: string }

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

export default function LowerThird({ title = 'Имя Фамилия', subtitle = 'кто это', accent = '#ff6a1a', textColor = '#ffffff' }: Props) {
  const frame = useCurrentFrame()
  const { width, durationInFrames } = useVideoConfig()
  const u = width / 1080
  const inP = interpolate(frame, [3, 17], [0, 1], clamp)
  const outP = interpolate(frame, [durationInFrames - 15, durationInFrames - 4], [1, 0], clamp)
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: '6%', bottom: '22%', padding: \`\${28 * u}px \${40 * u}px\`, background: accent, borderRadius: 22 * u, opacity: inP * outP, transform: \`translateX(\${(1 - inP) * -120 * u}px)\`, fontFamily: 'Montserrat, Arial Black, sans-serif' }}>
        <div style={{ color: textColor, fontSize: 64 * u, fontWeight: 900 }}>{title}</div>
        <div style={{ color: textColor, opacity: 0.9, fontSize: 36 * u, fontWeight: 600, marginTop: 6 * u }}>{subtitle}</div>
      </div>
    </AbsoluteFill>
  )
}
`,
  },
}
