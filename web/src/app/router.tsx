import { createBrowserRouter, type RouteObject } from 'react-router'
import { basePath } from '../api/client'
import { LoginPage } from '../features/auth/LoginPage'
import { EpisodePage } from '../features/episode/EpisodePage'
import { ExportPage } from '../features/export/ExportPage'
import { HomePage } from '../features/home/HomePage'
import { InboxPage } from '../features/inbox/InboxPage'
import { MemberFormPage } from '../features/member/MemberFormPage'
import { MemberListPage } from '../features/member/MemberListPage'
import { MemberPage } from '../features/member/MemberPage'
import { PrintEpisodePage } from '../features/print/PrintEpisodePage'
import { PrintMemberPage } from '../features/print/PrintMemberPage'
import { RecordDetailPage } from '../features/record/RecordDetailPage'
import { RecordNewPage } from '../features/record/RecordNewPage'
import { AppShell } from './AppShell'
import { NotFoundPage } from './NotFoundPage'
import type { RouteHandle } from './routeHandle'

const fullScreen: RouteHandle = { hideMobileTabBar: true }

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  // Print pages render without any shell: Gotenberg, export preview and window.print() share them.
  { path: '/print/episode/:id', element: <PrintEpisodePage /> },
  { path: '/print/member/:id', element: <PrintMemberPage /> },
  {
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'record/new', element: <RecordNewPage />, handle: fullScreen },
      { path: 'records/:id', element: <RecordDetailPage />, handle: fullScreen },
      { path: 'episodes/:id', element: <EpisodePage />, handle: fullScreen },
      { path: 'inbox', element: <InboxPage /> },
      { path: 'members', element: <MemberListPage /> },
      { path: 'members/new', element: <MemberFormPage />, handle: fullScreen },
      { path: 'members/:id', element: <MemberPage /> },
      { path: 'members/:id/edit', element: <MemberFormPage />, handle: fullScreen },
      { path: 'export', element: <ExportPage /> },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]

export const router = createBrowserRouter(routes, { basename: basePath || '/' })
