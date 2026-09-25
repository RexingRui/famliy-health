import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './ui'
import { cx } from '../lib/cx'
import { CloseIcon } from './icons'

/**
 * Modal panel: a bottom sheet on phones, a centered dialog on desktop. Escape and the
 * backdrop close it; focus moves into the panel and back to the opener afterwards.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  className,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
}) {
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const onCloseRef = useRef(onClose)
  useLayoutEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const focusable = panel.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])')
    ;(focusable ?? panel.current)?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      opener?.focus?.()
    }
  }, [open])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center lg:items-center">
      <div className="absolute inset-0 bg-ink/30" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx(
          'relative flex max-h-[88dvh] w-full flex-col rounded-t-[28px] bg-surface shadow-[0_-8px_24px_rgba(27,40,38,0.18)] outline-none lg:max-w-[480px] lg:rounded-[24px]',
          className,
        )}
      >
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-2">
          <h2 id={titleId} className="text-[17px] font-bold">
            {title}
          </h2>
          <button
            type="button"
            data-close
            aria-label="关闭"
            onClick={onClose}
            className="-mr-2 flex size-11 items-center justify-center text-ink-muted"
          >
            <CloseIcon size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <div className="flex gap-2.5 px-5 pt-2 pb-[max(24px,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '确定',
  danger,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button block size="lg" onClick={onClose}>
            取消
          </Button>
          <Button
            block
            size="lg"
            variant={danger ? 'dark' : 'primary'}
            className={danger ? 'bg-alert' : undefined}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? '处理中…' : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-[15px] leading-relaxed text-ink-muted">{message}</div>
    </Sheet>
  )
}
