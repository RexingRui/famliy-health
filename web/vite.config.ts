import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vitest/config'

// Production is served under a path on a shared domain (BASE_PATH=/health); the Docker build
// passes it as VITE_BASE_PATH so asset URLs, the router and API calls all carry the prefix.
const basePath = (process.env.VITE_BASE_PATH ?? '').replace(/\/+$/, '')

/**
 * Serves MSW's service worker in the dev server only (npm run dev:mock), straight from the
 * installed package, so it never lands in public/ or a production build.
 */
function mockServiceWorker(): Plugin {
  const file = createRequire(import.meta.url).resolve('msw/mockServiceWorker.js')
  return {
    name: 'mock-service-worker',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(`${basePath}/mockServiceWorker.js`, (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript')
        res.end(readFileSync(file))
      })
    },
  }
}

export default defineConfig({
  base: `${basePath}/`,
  plugins: [react(), tailwindcss(), mockServiceWorker()],
  // The only chunk over the default limit is ECharts, which is lazy-loaded with the trend chart.
  build: { chunkSizeWarningLimit: 600 },
  server: {
    host: true,
    // Gotenberg in Docker opens print pages through this host name during development.
    allowedHosts: ['host.docker.internal'],
    proxy: {
      '/api': 'http://localhost:8080',
      '/healthz': 'http://localhost:8080',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Business dates are Asia/Shanghai; pin it so date assertions do not depend on the machine.
    env: { TZ: 'Asia/Shanghai' },
  },
})
