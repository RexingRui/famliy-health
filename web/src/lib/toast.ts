export type Toast = { id: number; message: string; tone: 'info' | 'error' }

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** Shows a short message at the top of the screen for a few seconds. */
export function toast(message: string, tone: Toast['tone'] = 'info') {
  const t = { id: nextId++, message, tone }
  toasts = [...toasts, t]
  emit()
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id)
    emit()
  }, 3000)
}

export const toastError = (err: unknown, fallback = '操作失败') =>
  toast(err instanceof Error && err.message ? err.message : fallback, 'error')

export const getToasts = () => toasts

export function subscribeToasts(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
