import { setupWorker } from 'msw/browser'
import { handlers, resetDb } from './handlers'

/** Starts the mock backend in the browser (npm run dev:mock). */
export async function startMockBackend() {
  // `?reset-mock` in the URL restores the seed data.
  if (new URLSearchParams(location.search).has('reset-mock')) resetDb()
  await setupWorker(...handlers).start({
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
    onUnhandledRequest: 'bypass',
    quiet: true,
  })
}
