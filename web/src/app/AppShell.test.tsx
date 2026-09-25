import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it } from 'vitest'
import { mockDb, resetDb } from '../mocks/handlers'
import { setViewportWidth } from '../test/setup'
import { Providers } from './providers'
import { routes } from './router'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  )
  return router
}

const firstEpisode = (name: string) => mockDb().episodes.find((e) => e.name.startsWith(name) && ['active', 'treating'].includes(e.status))!

describe('shell and auth', () => {
  it('sends visitors without a session to login, then back after signing in', async () => {
    resetDb(false)
    setViewportWidth(390)
    const router = renderAt('/inbox')
    await screen.findByRole('heading', { name: '家庭病程' })
    expect(router.state.location.pathname).toBe('/login')

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('账号'), 'demo')
    await user.type(screen.getByLabelText('密码'), 'wrong')
    await user.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('用户名或密码不正确')

    await user.clear(screen.getByLabelText('密码'))
    await user.type(screen.getByLabelText('密码'), 'demo')
    await user.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByRole('heading', { name: '待整理' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/inbox')
  })

  it('shows the home page with the bottom tab bar on mobile', async () => {
    setViewportWidth(390)
    renderAt('/')
    expect(await screen.findByRole('heading', { name: '家里的病程' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: '主导航' })
    expect(within(nav).getByRole('link', { name: '记一笔' })).toHaveAttribute('href', '/record/new')
    // Open episodes of every member, and the member row doubles as the member list.
    expect(await screen.findByText('第')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /长期病程.*腰椎间盘突出/ })).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: '成员' })).getByRole('link', { name: /小明/ })).toBeInTheDocument()
  })

  it('shows the sidebar and overview on desktop, without a 记一笔 entry', async () => {
    setViewportWidth(1440)
    renderAt('/')
    expect(await screen.findByRole('heading', { name: '家庭总览' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /待整理/ })).toHaveAttribute('href', '/inbox')
    expect(screen.queryByRole('link', { name: '记一笔' })).not.toBeInTheDocument()
    expect(await screen.findByRole('region', { name: '小明' })).toHaveTextContent('过敏：花粉')
  })

  it('hides the tab bar on full-screen mobile pages', async () => {
    setViewportWidth(390)
    renderAt('/record/new')
    expect(await screen.findByRole('button', { name: '按住说话' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '主导航' })).not.toBeInTheDocument()
  })

  it('tells desktop users to record on the phone', async () => {
    setViewportWidth(1440)
    renderAt('/record/new')
    expect(await screen.findByText('记录只在手机上进行')).toBeInTheDocument()
  })
})

describe('pages', () => {
  it('records a temperature from the phone and shows it in the episode', async () => {
    setViewportWidth(390)
    const cold = firstEpisode('感冒')
    const router = renderAt(`/record/new?episodeId=${cold.id}`)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: '体温' }))
    await user.type(screen.getByLabelText('体温'), '39.2')
    expect(await screen.findByText(/感冒，第 \d+ 天/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(router.state.location.pathname).toBe(`/episodes/${cold.id}`))
    expect(await screen.findByText('39.2°C')).toBeInTheDocument()
  })

  it('switches an episode to recovered', async () => {
    setViewportWidth(390)
    const cold = firstEpisode('感冒')
    renderAt(`/episodes/${cold.id}`)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: '切换状态' }))
    await user.click(screen.getByRole('radio', { name: /已康复/ }))
    await user.click(screen.getByRole('button', { name: '确定' }))
    expect(await screen.findByText('已康复', { selector: 'span.rounded-lg' })).toBeInTheDocument()
    expect(mockDb().episodes.find((e) => e.id === cold.id)?.status).toBe('recovered')
  })

  it('assigns inbox records in bulk on desktop', async () => {
    setViewportWidth(1440)
    renderAt('/inbox')
    const user = userEvent.setup()
    const boxes = await screen.findAllByRole('checkbox', { name: /选择：小明/ })
    for (const b of boxes) await user.click(b)
    const cold = firstEpisode('感冒')
    const select = screen.getByLabelText('一起归入')
    await waitFor(() => expect(within(select).getByRole('option', { name: /感冒，第/ })).toBeInTheDocument())
    await user.selectOptions(select, cold.id)
    await user.click(screen.getByRole('button', { name: '归入' }))

    await waitFor(() => expect(screen.queryAllByRole('checkbox', { name: /选择：小明/ })).toHaveLength(0))
    expect(mockDb().records.filter((r) => r.episodeId === null)).toHaveLength(1)
  })

  it('summarises a member by disease', async () => {
    setViewportWidth(1440)
    const ming = mockDb().members[0]
    renderAt(`/members/${ming.id}?view=disease`)
    expect(await screen.findByText(/近一年 4 次。已结束的 3 次平均持续 5\.7 天，最长 8 天/)).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: '查看' })).toHaveLength(4)
  })
})
