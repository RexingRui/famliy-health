import { useSyncExternalStore } from 'react'

// Must match Tailwind's `lg` breakpoint (64rem = 1024px).
const QUERY = '(min-width: 1024px)'

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  )
}
