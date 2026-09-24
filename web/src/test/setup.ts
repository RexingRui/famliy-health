import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => cleanup())

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
