import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it } from 'vitest'
import { setViewportWidth } from '../test/setup'
import { routes } from './router'

function renderAt(path: string) {
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />)
}

describe('AppShell', () => {
  it('shows the bottom tab bar on mobile', () => {
    setViewportWidth(390)
    renderAt('/')
    expect(screen.getByRole('heading', { name: '家里的病程' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '记一笔' })).toHaveAttribute('href', '/record/new')
  })

  it('hides the tab bar on full-screen mobile pages', () => {
    setViewportWidth(390)
    renderAt('/record/new')
    expect(screen.queryByRole('navigation', { name: '主导航' })).not.toBeInTheDocument()
  })

  it('shows the sidebar on desktop', () => {
    setViewportWidth(1440)
    renderAt('/')
    expect(screen.getByRole('heading', { name: '家庭总览' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '待整理' })).toHaveAttribute('href', '/inbox')
    expect(screen.queryByRole('link', { name: '记一笔' })).not.toBeInTheDocument()
  })
})
