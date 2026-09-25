import type { ComponentType } from 'react'
import { createBrowserRouter, type RouteObject } from 'react-router'
import { basePath } from '../api/client'
import { Spinner } from '../components/ui'
import { LoginPage } from '../features/auth/LoginPage'
import { HomePage } from '../features/home/HomePage'
import { AppShell } from './AppShell'
import { NotFoundPage } from './NotFoundPage'
import type { RouteHandle } from './routeHandle'

const fullScreen: RouteHandle = { hideMobileTabBar: true }

// Home and login ship in the main bundle; every other page loads on first visit.
const page = <K extends string>(load: () => Promise<{ [k in K]: ComponentType }>, name: K) => ({
  lazy: async () => ({ Component: (await load())[name] }),
  // Shown when the app opens directly on this page, while its code loads.
  HydrateFallback: Spinner,
})

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  // Print pages render without any shell: Gotenberg, export preview and window.print() share them.
  { path: '/print/episode/:id', ...page(() => import('../features/print/PrintEpisodePage'), 'PrintEpisodePage') },
  { path: '/print/member/:id', ...page(() => import('../features/print/PrintMemberPage'), 'PrintMemberPage') },
  {
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'record/new', handle: fullScreen, ...page(() => import('../features/record/RecordNewPage'), 'RecordNewPage') },
      { path: 'records/:id', handle: fullScreen, ...page(() => import('../features/record/RecordDetailPage'), 'RecordDetailPage') },
      { path: 'episodes/:id', handle: fullScreen, ...page(() => import('../features/episode/EpisodePage'), 'EpisodePage') },
      { path: 'inbox', ...page(() => import('../features/inbox/InboxPage'), 'InboxPage') },
      { path: 'members/new', handle: fullScreen, ...page(() => import('../features/member/MemberFormPage'), 'MemberFormPage') },
      { path: 'members/:id', ...page(() => import('../features/member/MemberPage'), 'MemberPage') },
      { path: 'members/:id/edit', handle: fullScreen, ...page(() => import('../features/member/MemberFormPage'), 'MemberFormPage') },
      { path: 'export', ...page(() => import('../features/export/ExportPage'), 'ExportPage') },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]

export const router = createBrowserRouter(routes, { basename: basePath || '/' })
