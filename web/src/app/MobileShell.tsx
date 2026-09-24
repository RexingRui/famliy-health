import { NavLink, Outlet } from 'react-router'
import { HomeIcon, MembersIcon, MicIcon } from '../components/icons'
import { useRouteHandle } from './routeHandle'

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `flex w-16 flex-col items-center gap-[3px] text-xs ${isActive ? 'font-medium text-primary' : 'text-ink-muted'}`

export function MobileShell() {
  const { hideMobileTabBar } = useRouteHandle()

  return (
    <div className="flex min-h-dvh flex-col">
      <main className="flex-1">
        <Outlet />
      </main>

      {!hideMobileTabBar && (
        <nav
          aria-label="主导航"
          className="sticky bottom-0 flex h-[84px] items-end justify-around border-t border-line bg-surface px-7 pb-[max(22px,env(safe-area-inset-bottom))]"
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
          <NavLink to="/members" className={tabClass}>
            <MembersIcon />
            成员
          </NavLink>
        </nav>
      )}
    </div>
  )
}
