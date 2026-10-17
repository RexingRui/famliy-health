import { NavLink, Outlet } from 'react-router'
import { HomeIcon, MicIcon } from '../components/icons'
import { cx } from '../lib/cx'
import { useRouteHandle } from './routeHandle'

const tabClass = ({ isActive }: { isActive: boolean }) =>
  cx('flex w-16 flex-col items-center gap-[3px] text-xs', isActive ? 'font-medium text-primary' : 'text-ink-muted')

export function MobileShell() {
  const { hideMobileTabBar } = useRouteHandle()

  return (
    <div className="flex min-h-dvh flex-col">
      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>

      {!hideMobileTabBar && (
        <nav
          aria-label="主导航"
          className="sticky bottom-0 z-20 flex h-[84px] items-end justify-around border-t border-line bg-surface px-7 pb-[max(22px,env(safe-area-inset-bottom))]"
        >
          <NavLink to="/" end className={tabClass}>
            <HomeIcon />
            首页
          </NavLink>
          <NavLink to="/record/new" className="flex flex-col items-center gap-1 text-xs font-bold text-ink">
            <span className="-mt-[30px] flex size-16 items-center justify-center rounded-full bg-primary text-white shadow-[0_0_0_5px_#fff,0_8px_18px_rgba(27,40,38,0.22)]">
              <MicIcon size={28} strokeWidth={2} />
            </span>
            记一笔
          </NavLink>
          {/* Members live in the home page's avatar row; this slot keeps 记一笔 centered. */}
          <span aria-hidden="true" className="w-16" />
        </nav>
      )}
    </div>
  )
}
