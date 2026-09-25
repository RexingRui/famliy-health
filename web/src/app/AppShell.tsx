import { Navigate, useLocation } from 'react-router'
import { useMe } from '../api/hooks'
import { ErrorState, Spinner } from '../components/ui'
import { useUploadQueueRunner } from '../lib/drafts/useUploadQueue'
import { DesktopShell } from './DesktopShell'
import { MobileShell } from './MobileShell'
import { useIsDesktop } from './useIsDesktop'

/** Same routes on both ends; only the chrome switches at 1024px. Requires a session. */
export function AppShell() {
  const me = useMe()
  const isDesktop = useIsDesktop()
  const location = useLocation()

  if (me.isPending) return <Spinner />
  if (me.data === null) {
    const next = location.pathname + location.search
    return <Navigate to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`} replace />
  }
  if (me.isError) {
    return (
      <div className="p-5">
        <ErrorState error={me.error} onRetry={() => void me.refetch()} />
      </div>
    )
  }
  return <SignedIn isDesktop={isDesktop} />
}

function SignedIn({ isDesktop }: { isDesktop: boolean }) {
  useUploadQueueRunner()
  return isDesktop ? <DesktopShell /> : <MobileShell />
}
