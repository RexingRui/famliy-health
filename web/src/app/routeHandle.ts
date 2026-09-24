import { useMatches } from 'react-router'

export type RouteHandle = {
  /** Full-screen mobile pages (e.g. 记一笔) hide the bottom tab bar. */
  hideMobileTabBar?: boolean
}

export function useRouteHandle(): RouteHandle {
  const matches = useMatches()
  return matches.reduce<RouteHandle>((acc, m) => ({ ...acc, ...(m.handle as RouteHandle | undefined) }), {})
}
