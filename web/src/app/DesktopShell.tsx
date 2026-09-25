import type { ComponentType } from 'react'
import { NavLink, Outlet } from 'react-router'
import { ExportIcon, InboxIcon, MembersIcon, OverviewIcon } from '../components/icons'

const navItems: { to: string; label: string; icon: ComponentType<{ size?: number }>; end?: boolean }[] = [
  { to: '/', label: '总览', icon: OverviewIcon, end: true },
  { to: '/inbox', label: '待整理', icon: InboxIcon },
  { to: '/export', label: '导出报告', icon: ExportIcon },
]

const navClass = ({ isActive }: { isActive: boolean }) =>
  `flex h-11 items-center gap-3 rounded-control px-3 text-[15px] ${
    isActive ? 'bg-primary-soft font-bold text-primary' : 'text-ink hover:bg-line-soft'
  }`

// Recording happens on the phone only; the desktop has no 记一笔 entry.
export function DesktopShell() {
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 flex h-dvh w-60 shrink-0 flex-col gap-7 border-r border-line bg-surface px-4 pt-7 pb-6">
        <div className="px-3 font-display text-2xl">家庭健康管理</div>
        <nav aria-label="主导航" className="flex flex-col gap-1">
          {navItems.map(({ to, label, icon: NavIcon, end }) => (
            <NavLink key={to} to={to} end={end} className={navClass}>
              <NavIcon size={20} />
              {label}
            </NavLink>
          ))}
        </nav>
        {/* The design lists each member here with avatar; filled in once /api/members exists. */}
        <section aria-label="成员" className="flex flex-col gap-1">
          <NavLink to="/members" className={navClass}>
            <MembersIcon size={20} />
            成员
          </NavLink>
        </section>
      </aside>
      <main className="min-w-0 flex-1 px-10 py-8">
        <Outlet />
      </main>
    </div>
  )
}
