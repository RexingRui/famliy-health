import { useSyncExternalStore } from 'react'
import { getToasts, subscribeToasts } from '../lib/toast'

export function Toaster() {
  const list = useSyncExternalStore(subscribeToasts, getToasts)
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4">
      {list.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'error' ? 'alert' : 'status'}
          className={`max-w-sm rounded-control px-4 py-2.5 text-sm shadow-lg ${t.tone === 'error' ? 'bg-alert text-white' : 'bg-ink text-white'}`}
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}
