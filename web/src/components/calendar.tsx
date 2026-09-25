import dayjs from 'dayjs'
import type { CalendarDay } from '../api/types'
import { daySummaryLabel } from '../lib/calendar'
import { ChevronLeftIcon, ChevronRightIcon } from './icons'
import { cx } from '../lib/cx'

const WEEK_HEAD = ['一', '二', '三', '四', '五', '六', '日']

/**
 * The marks for one day, as in the design legend: a filled circle with the highest symptom
 * severity (or a small dot when symptoms have no severity), a blue bar for medication, a
 * green ring for treatment, a black square for a visit.
 */
export function DayMarks({ day, size = 'md' }: { day: CalendarDay | undefined; size?: 'sm' | 'md' }) {
  if (!day) return <span className="h-[18px]" />
  const c = day.counts
  const circle = size === 'sm' ? 'size-4 text-[10px]' : 'size-[18px] text-[11px]'
  return (
    <span className="flex h-[18px] items-center gap-0.5">
      {c.symptom > 0 &&
        (day.maxSeverity !== null ? (
          <span className={cx('flex items-center justify-center rounded-full bg-symptom font-bold text-white', circle)}>
            {day.maxSeverity}
          </span>
        ) : (
          <span className="size-2 rounded-full bg-symptom" />
        ))}
      {c.medication > 0 && <span className="h-3 w-1 rounded-sm bg-medication" />}
      {c.treatment > 0 && <span className="size-[11px] rounded-full border-2 border-treatment" />}
      {c.visit > 0 && <span className="size-[9px] bg-visit" />}
    </span>
  )
}

export function CalendarLegend({ className }: { className?: string }) {
  return (
    <div className={cx('flex flex-wrap gap-x-4 gap-y-2 text-xs text-ink-muted', className)}>
      <span className="flex items-center gap-1.5">
        <span className="flex size-4 items-center justify-center rounded-full bg-symptom text-[10px] font-bold text-white">5</span>
        症状，数字为程度
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-[11px] rounded-full border-2 border-treatment" />
        治疗康复
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-[9px] bg-visit" />
        就诊
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-1 rounded-sm bg-medication" />
        用药
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-3.5 rounded bg-alert-soft" />
        发作
      </span>
    </div>
  )
}

/** Month grid starting on Monday. Days with records are buttons; the selected day is outlined. */
export function CalendarMonth({
  month,
  days,
  selected,
  onSelect,
  onMonthChange,
}: {
  month: string
  days: CalendarDay[]
  selected: string | null
  onSelect: (date: string) => void
  onMonthChange: (month: string) => void
}) {
  const first = dayjs(`${month}-01`)
  const lead = (first.day() + 6) % 7
  const count = first.daysInMonth()
  const byDate = new Map(days.map((d) => [d.date, d]))
  const today = dayjs().format('YYYY-MM-DD')
  const isCurrentMonth = first.isSame(dayjs(), 'month')
  const cells = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => first.date(i + 1).format('YYYY-MM-DD'))]

  return (
    <section aria-label={`${first.format('YYYY年M月')}日历`} className="flex flex-col gap-1.5 rounded-card bg-surface px-3 pt-1.5 pb-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="上个月"
          onClick={() => onMonthChange(first.subtract(1, 'month').format('YYYY-MM'))}
          className="flex size-11 items-center justify-center"
        >
          <ChevronLeftIcon size={20} />
        </button>
        <h2 className="text-base font-bold">{first.format('YYYY年M月')}</h2>
        <button
          type="button"
          aria-label="下个月"
          disabled={isCurrentMonth}
          onClick={() => onMonthChange(first.add(1, 'month').format('YYYY-MM'))}
          className="flex size-11 items-center justify-center disabled:text-line"
        >
          <ChevronRightIcon size={20} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {WEEK_HEAD.map((w) => (
          <span key={w} className="text-center text-xs text-ink-muted">
            {w}
          </span>
        ))}
        {cells.map((date, i) => {
          if (!date) return <div key={`lead-${i}`} />
          const d = byDate.get(date)
          const isSelected = date === selected
          return (
            <button
              key={date}
              type="button"
              onClick={() => onSelect(date)}
              aria-pressed={isSelected}
              aria-label={`${dayjs(date).format('M月D日')}，${daySummaryLabel(d)}`}
              className={cx(
                'flex h-14 flex-col items-center gap-[5px] rounded-[10px]',
                isSelected ? 'border-2 border-primary pt-[5px]' : 'pt-[7px]',
                d?.flare && 'bg-alert-soft',
              )}
            >
              <span className={cx('text-sm leading-none', date === today && 'font-bold')}>{dayjs(date).date()}</span>
              <DayMarks day={d} />
            </button>
          )
        })}
      </div>
    </section>
  )
}

/** Seven-day strip for the current week (home cards and overview). */
export function WeekStrip({ days }: { days: CalendarDay[] }) {
  const start = dayjs().startOf('day').subtract((dayjs().day() + 6) % 7, 'day')
  const byDate = new Map(days.map((d) => [d.date, d]))
  return (
    <div className="grid grid-cols-7 gap-1">
      {Array.from({ length: 7 }, (_, i) => {
        const date = start.add(i, 'day')
        const key = date.format('YYYY-MM-DD')
        const isToday = date.isSame(dayjs(), 'day')
        const d = byDate.get(key)
        return (
          <div
            key={key}
            aria-label={`${date.format('M月D日')}，${daySummaryLabel(d)}`}
            className={cx(
              'flex flex-col items-center gap-[3px] rounded-[10px]',
              isToday ? 'border-2 border-primary py-1' : 'py-1.5',
              d?.flare && 'bg-alert-soft',
            )}
          >
            <span className="text-[11px] text-ink-muted">{isToday ? '今天' : WEEK_HEAD[i]}</span>
            <span className={cx('text-sm', isToday && 'font-bold')}>{date.date()}</span>
            <DayMarks day={d} />
          </div>
        )
      })}
    </div>
  )
}
