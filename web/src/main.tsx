import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { Providers } from './app/providers'
import { router } from './app/router'
import './styles/index.css'

async function start() {
  // Dev only: `npm run dev:mock` runs against the in-browser mock backend. The branch is
  // compiled out of production builds.
  if (import.meta.env.DEV && import.meta.env.VITE_MOCK === '1') {
    const { startMockBackend } = await import('./mocks/browser')
    await startMockBackend()
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Providers>
        <RouterProvider router={router} />
      </Providers>
    </StrictMode>,
  )
}

void start()
