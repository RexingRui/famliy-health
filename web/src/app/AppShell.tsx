import { DesktopShell } from './DesktopShell'
import { MobileShell } from './MobileShell'
import { useIsDesktop } from './useIsDesktop'

/** Same routes on both ends; only the chrome switches at 1024px. */
export function AppShell() {
  return useIsDesktop() ? <DesktopShell /> : <MobileShell />
}
