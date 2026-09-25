import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'
import { queryClient } from '../api/queryClient'
import { handlers, resetDb } from '../mocks/handlers'

// The mock backend used by `npm run dev:mock` also serves the tests.
export const server = setupServer(...handlers)

// Uploads go through Node's fetch, which only understands Node's FormData/Blob; jsdom's File from
// FormData.set(name, blob, filename) breaks vitest's conversion. Give the page Node's classes,
// defined on globalThis only so jsdom's own window stays untouched.
// (jsdom has no Response, so these come from Node.)
const NodeFormData = (await new Response(new URLSearchParams('x=1')).formData()).constructor as typeof FormData
const NodeBlob = (await new Response('x').blob()).constructor as typeof Blob
const probe = new NodeFormData()
probe.append('f', new NodeBlob(['x']), 'x.txt')
const NodeFile = (probe.get('f') as File).constructor
for (const [name, value] of Object.entries({ FormData: NodeFormData, Blob: NodeBlob, File: NodeFile })) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
}

// Node's fetch rejects relative URLs; resolve them against the jsdom page like a browser would.
const nodeFetch = globalThis.fetch
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
  nodeFetch(typeof input === 'string' && input.startsWith('/') ? new URL(input, location.origin) : input, init)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
beforeEach(() => resetDb(true))
afterEach(() => {
  cleanup()
  queryClient.clear()
  server.resetHandlers()
})
afterAll(() => server.close())

let viewportWidth = 390

export function setViewportWidth(width: number) {
  viewportWidth = width
}

// jsdom has no matchMedia; support the min-width queries the app uses.
window.matchMedia = (query: string) => {
  const min = /min-width:\s*(\d+)px/.exec(query)
  return {
    matches: min ? viewportWidth >= Number(min[1]) : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }
}
