import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ComponentType } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import { logout } from '../api/endpoints'
import { useHome, useMe } from '../api/hooks'
import { Avatar } from '../components/Avatar'
import { toneForStatuses } from '../lib/avatar'
import { ExportIcon, InboxIcon, LogoutIcon, OverviewIcon } from '../components/icons'
import { cx } from '../lib/cx'
import { PendingUploadsBanner } from '../features/record/PendingUploadsBanner'
import { ArchivedMembers } from '../features/member/ArchivedMembers'

const navItems: { to: string; label: string; icon: ComponentType<{ size?: number }>; end?: boolean; badge?: 'inbox' }[] = [
  { to: '/', label: '总览', icon: OverviewIcon, end: true },
  { to: '/inbox', label: '待整理', icon: InboxIcon, badge: 'inbox' },
  { to: '/export', label: '导出报告', icon: ExportIcon },
]

const navClass = ({ isActive }: { isActive: boolean }) =>
  cx('flex h-11 items-center gap-2.5 rounded-[10px] px-3 text-[15px]', isActive ? 'bg-primary-soft font-bold text-ink' : 'text-ink hover:bg-line-soft')

// Recording happens on the phone only; the desktop has no 记一笔 entry.
export function DesktopShell() {
  const home = useHome()
  const me = useMe()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const signOut = useMutation({
    mutationFn: logout,
    onSettled: () => {
      qc.clear()
      navigate('/login', { replace: true })
    },
  })
  const inbox = home.data?.inboxCount ?? 0

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 flex h-dvh w-60 shrink-0 flex-col gap-7 border-r border-line bg-surface px-4 pt-7 pb-6">
        <div className="px-3 font-display text-[26px] leading-tight">家庭健康管理</div>
        <nav aria-label="主导航" className="flex flex-col gap-1">
          {navItems.map(({ to, label, icon: NavIcon, end, badge }) => (
            <NavLink key={to} to={to} end={end} className={navClass}>
              <NavIcon size={20} />
              {label}
              {badge === 'inbox' && inbox > 0 && (
                <span className="ml-auto flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-alert px-1.5 text-xs font-bold text-white">
                  {inbox}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <nav aria-label="成员" className="flex min-h-0 flex-col gap-1 overflow-y-auto">
          <span className="px-3 pb-1 text-xs text-ink-muted">成员</span>
          {home.data?.members.map(({ member, openEpisodes }) => {
            const statuses = openEpisodes.map((s) => s.episode.status)
            return (
              <NavLink key={member.id} to={`/members/${member.id}`} className={navClass}>
                <Avatar member={member} size={28} tone={toneForStatuses(statuses)} />
                {member.nickname}
                {statuses.length > 0 && (
                  <span
                    className={cx('ml-auto size-2 rounded-full', statuses.includes('active') ? 'bg-alert' : 'bg-primary')}
                    aria-label="有未结束的病程"
                  />
                )}
              </NavLink>
            )
          })}
          {home.data && home.data.members.length === 0 && (
            <p className="px-3 text-[13px] leading-relaxed text-ink-muted">还没有成员，请在手机上添加。</p>
          )}
          <ArchivedMembers className="px-3 pt-1" />
        </nav>
        <div className="mt-auto flex items-center justify-between gap-2 px-3 text-sm text-ink-muted">
          <span className="truncate">{me.data?.account.displayName || me.data?.account.username}</span>
          <button
            type="button"
            onClick={() => signOut.mutate()}
            className="flex h-9 items-center gap-1 rounded-[10px] px-2 hover:bg-line-soft"
          >
            <LogoutIcon size={18} />
            退出
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-10 py-8">
        <PendingUploadsBanner className="mb-6" />
        <Outlet />
      </main>
    </div>
  )
}
