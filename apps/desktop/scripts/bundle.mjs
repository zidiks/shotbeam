// Puts the runtime of the installed app into src-tauri/resources (copied next to Shotbeam.exe by
// the installer, see tauri.bundle.json), so it runs on a computer without this checkout:
//   engine/dist/main.mjs   the engine, one file (esbuild)
//   engine/python/         the Python worker it calls
//   mcp/shotbeam-mcp.mjs   the MCP server, one file
//   node/                  the Node that runs both, with npm (motion uses npm / npx)
// ffmpeg and Python are not shipped: the engine downloads them into the library when missing.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..', '..')
const out = join(here, '..', 'src-tauri', 'resources')

const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 5))
  throw new Error(
    `Node ${process.versions.node} has no node:sqlite; build with Node 22.5+ (24 here)`,
  )

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

// Some dependencies are CommonJS and call require(); give the ES module bundle one.
const banner = {
  js: "import { createRequire as __shotbeamRequire } from 'node:module'; const require = __shotbeamRequire(import.meta.url);",
}
const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: `node${major}`,
  banner,
  legalComments: 'none',
  logLevel: 'warning',
}

await build({
  ...common,
  entryPoints: [join(repo, 'packages', 'engine', 'src', 'main.ts')],
  outfile: join(out, 'engine', 'dist', 'main.mjs'),
})
cpSync(join(repo, 'packages', 'engine', 'python'), join(out, 'engine', 'python'), {
  recursive: true,
  filter: (src) => !src.includes('__pycache__'),
})

await build({
  ...common,
  entryPoints: [join(repo, 'apps', 'mcp', 'src', 'main.ts')],
  outfile: join(out, 'mcp', 'shotbeam-mcp.mjs'),
})

// The Node running this script (the one the app was tested with), and its npm.
const nodeDir = dirname(process.execPath)
const exe = process.platform === 'win32' ? 'node.exe' : 'node'
cpSync(process.execPath, join(out, 'node', exe))
const npm = join(nodeDir, 'node_modules', 'npm')
if (existsSync(npm)) cpSync(npm, join(out, 'node', 'node_modules', 'npm'), { recursive: true })
else console.warn(`npm not found next to ${process.execPath}: motion templates will not install`)

console.log(`Runtime bundled into ${out} (Node ${process.versions.node})`)
