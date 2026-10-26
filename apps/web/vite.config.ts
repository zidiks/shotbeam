import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// The same build runs in the browser (dev) and inside Tauri (apps/desktop).
const tauriPlatform = process.env.TAURI_ENV_PLATFORM

/**
 * Dev modules are never written to the browser's disk cache: a WebView2 cache left broken (the
 * window killed mid-write, a full disk) fails module loads with ERR_CACHE_READ_FAILURE and
 * leaves a blank window. Serving from memory is fast enough for one person.
 */
function noStore(): Plugin {
  return {
    name: 'shotbeam:no-store',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        const setHeader = res.setHeader.bind(res)
        res.setHeader = (name, value) =>
          setHeader(name, name.toLowerCase() === 'cache-control' ? 'no-store' : value)
        res.setHeader('Cache-Control', 'no-store')
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), noStore()],
  clearScreen: false,
  server: {
    port: 5180,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: tauriPlatform === 'windows' ? 'chrome110' : 'es2022',
  },
})
