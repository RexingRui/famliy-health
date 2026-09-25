import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { Link, useNavigate } from 'react-router'
import type { EpisodeStatus, RecordType } from '../api/types'
import { RECORD_TYPE_LABEL, RECORD_TYPE_TONE, STATUS_LABEL, statusTone } from '../lib/labels'
import { cx } from '../lib/cx'
import { ChevronLeftIcon } from './icons'

// ---------- buttons ----------

type Variant = 'primary' | 'dark' | 'outline' | 'accent-outline' | 'ghost' | 'danger'
type Size = 'md' | 'lg' | 'sm'

const VARIANT: { [K in Variant]: string } = {
  primary: 'bg-primary text-white font-bold disabled:bg-primary/50',
  dark: 'bg-ink text-white font-bold disabled:bg-ink/50',
  outline: 'border border-line bg-surface text-ink disabled:text-ink-subtle',
  'accent-outline': 'border-[1.5px] border-primary bg-surface text-primary font-bold',
  ghost: 'bg-transparent text-primary font-medium',
  danger: 'border border-line bg-surface text-alert',
}

const SIZE: { [K in Size]: string } = {
  sm: 'h-9 px-3 text-sm rounded-[10px]',
  md: 'h-11 px-4 text-[15px] rounded-control',
  lg: 'h-[52px] px-5 text-[17px] rounded-[14px]',
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; block?: boolean }

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'outline', size = 'md', block, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap transition-opacity active:opacity-80 disabled:cursor-not-allowed',
        VARIANT[variant],
        SIZE[size],
        block ? 'w-full min-w-0 flex-1' : 'shrink-0',
        className,
      )}
      {...rest}
    />
  )
})

/** Pressable pill used for members, relations, record types and filters. */
export function Chip({
  selected,
  className,
  tone,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; tone?: RecordType }) {
  const t = tone ? RECORD_TYPE_TONE[tone] : null
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cx(
        'h-11 shrink-0 rounded-control px-[14px] text-sm whitespace-nowrap',
        selected
          ? t
            ? `border-[1.5px] font-bold ${t.bg} ${t.fg} border-current`
            : 'bg-primary font-medium text-white'
          : 'border border-line bg-surface text-ink',
        className,
      )}
      {...rest}
    />
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label: string
  className?: string
}) {
  return (
    <div role="group" aria-label={label} className={cx('flex gap-1 rounded-[14px] bg-segment p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            'h-11 flex-1 rounded-[11px] text-sm',
            o.value === value ? 'bg-surface font-bold text-ink shadow-[0_1px_2px_rgba(27,40,38,0.12)]' : 'text-ink-muted',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ---------- tags ----------

export function TypeTag({ type, className }: { type: RecordType | null; className?: string }) {
  if (!type) return null
  const t = RECORD_TYPE_TONE[type]
  return (
    <span className={cx('inline-block rounded-md px-2 py-0.5 text-xs font-bold', t.bg, t.fg, className)}>
      {RECORD_TYPE_LABEL[type]}
    </span>
  )
}

export function StatusBadge({ status, className }: { status: EpisodeStatus; className?: string }) {
  return (
    <span className={cx('inline-block rounded-lg px-2.5 py-1 text-[13px] font-medium whitespace-nowrap', statusTone(status), className)}>
      {STATUS_LABEL[status]}
    </span>
  )
}

export function OutlineTag({ children }: { children: ReactNode }) {
  return <span className="inline-block rounded-md border border-[#C3CCC9] px-[7px] py-px text-xs text-ink-muted">{children}</span>
}

export function FlareTag() {
  return <span className="inline-block rounded-md bg-alert px-2 py-0.5 text-xs font-bold text-white">发作</span>
}

// ---------- form fields ----------

export function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-[13px] text-ink-muted">
      {children}
    </label>
  )
}

export function FieldError({ children }: { children?: ReactNode }) {
  if (!children) return null
  return (
    <p role="alert" className="text-[13px] text-alert">
      {children}
    </p>
  )
}

const inputClass =
  'w-full rounded-control border border-line bg-field px-3 text-base text-ink placeholder:text-ink-subtle focus:border-primary focus:outline-none'

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cx(inputClass, 'h-12', className)} {...rest} />
})

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cx(inputClass, 'resize-none py-2.5 leading-relaxed', className)} {...rest} />
})

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(inputClass, 'h-11 bg-surface text-[15px]', className)} {...rest} />
}

// ---------- layout ----------

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <section className={cx('rounded-card bg-surface', className)} {...rest}>
      {children}
    </section>
  )
}

/**
 * Mobile page header: a back link (or custom left action), a centered title, and an optional
 * right action. On desktop the left action stays as a back link above the content.
 */
export function PageHeader({
  title,
  back,
  backLabel = '返回',
  left,
  right,
}: {
  title?: ReactNode
  back?: string | number
  backLabel?: string
  left?: ReactNode
  right?: ReactNode
}) {
  const navigate = useNavigate()
  const backEl =
    back === undefined ? null : typeof back === 'number' ? (
      <button
        type="button"
        onClick={() => navigate(back)}
        className="flex h-11 items-center gap-0.5 pr-3 pl-1 text-base text-ink"
      >
        <ChevronLeftIcon size={22} />
        {backLabel}
      </button>
    ) : (
      <Link to={back} className="flex h-11 items-center gap-0.5 pr-3 pl-1 text-base text-ink">
        <ChevronLeftIcon size={22} />
        {backLabel}
      </Link>
    )
  return (
    <header className="sticky top-0 z-10 grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center bg-page px-2 lg:static lg:px-0">
      <div className="flex justify-start">{left ?? backEl}</div>
      {title ? <h1 className="text-[17px] font-bold">{title}</h1> : <span />}
      <div className="flex justify-end">{right}</div>
    </header>
  )
}

/** Bottom action bar on full-screen mobile pages; inline on desktop. */
export function BottomBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        'sticky bottom-0 z-10 mt-auto flex gap-2.5 border-t border-line bg-page px-4 pt-3 pb-[max(28px,env(safe-area-inset-bottom))] lg:static lg:border-0 lg:px-0 lg:pb-0',
        className,
      )}
    >
      {children}
    </div>
  )
}

// ---------- states ----------

export function Spinner({ label = '加载中' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-ink-muted">
      <span className="size-4 animate-spin rounded-full border-2 border-line border-t-primary" aria-hidden="true" />
      {label}
    </div>
  )
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card bg-surface px-6 py-10 text-center">
      <p className="text-[15px] font-medium">{title}</p>
      {children}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : '加载失败'
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-card bg-surface px-6 py-10 text-center">
      <p className="text-[15px] text-alert">{message}</p>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          重试
        </Button>
      )}
    </div>
  )
}

/** Horizontal scroller that bleeds to the screen edge on phones (type chips, member chips). */
export function ChipRow({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <div
      role={label ? 'group' : undefined}
      aria-label={label}
      className={cx('-mr-4 flex gap-2 overflow-x-auto pr-4 [scrollbar-width:none] lg:mr-0 lg:flex-wrap lg:pr-0', className)}
    >
      {children}
    </div>
  )
}
