import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Production is served under a path on a shared domain (BASE_PATH=/health); the Docker build
// passes it as VITE_BASE_PATH so asset URLs, the router and API calls all carry the prefix.
const basePath = (process.env.VITE_BASE_PATH ?? '').replace(/\/+$/, '')

export default defineConfig({
  base: `${basePath}/`,
  plugins: [react(), tailwindcss()],
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
  },
})
