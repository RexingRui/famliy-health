import dayjs, { type ConfigType } from 'dayjs'
import 'dayjs/locale/zh-cn'

dayjs.locale('zh-cn')

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** “今天 21:30” / “昨天 21:30” / “9月22日 21:30” / “2025年9月22日 21:30”. */
export function formatRecordTime(value: ConfigType, now: ConfigType = new Date()): string {
  const t = dayjs(value)
  const today = dayjs(now).startOf('day')
  const time = t.format('HH:mm')

  if (t.isSame(today, 'day')) return `今天 ${time}`
  if (t.isSame(today.subtract(1, 'day'), 'day')) return `昨天 ${time}`
  if (t.isSame(today, 'year')) return `${t.format('M月D日')} ${time}`
  return `${t.format('YYYY年M月D日')} ${time}`
}

/** Short date without time, same rules: “今天” / “昨天” / “9月22日” / “2025年9月22日”. */
export function formatRecordDay(value: ConfigType, now: ConfigType = new Date()): string {
  const t = dayjs(value)
  const today = dayjs(now).startOf('day')
  if (t.isSame(today, 'day')) return '今天'
  if (t.isSame(today.subtract(1, 'day'), 'day')) return '昨天'
  return formatDate(t, now)
}

/** Records whose occurred time is more than an hour from entry time are shown as “补录”. */
export function isBackfilled(occurredAt: ConfigType, createdAt: ConfigType): boolean {
  return Math.abs(dayjs(createdAt).diff(dayjs(occurredAt), 'minute')) > 60
}

export const weekday = (value: ConfigType) => WEEKDAYS[dayjs(value).day()]

/** “9月23日”, with the year when it is not this year. */
export function formatDate(value: ConfigType, now: ConfigType = new Date()): string {
  const t = dayjs(value)
  return t.isSame(dayjs(now), 'year') ? t.format('M月D日') : t.format('YYYY年M月D日')
}

export const formatDateFull = (value: ConfigType) => dayjs(value).format('YYYY年M月D日')

/** “9月24日 周四” for page headers. */
export const formatToday = (now: ConfigType = new Date()) => `${dayjs(now).format('M月D日')} ${weekday(now)}`

/** Timeline day heading: “今天，9月24日 周四” / “昨天，9月23日 周三” / “9月22日 周二”. */
export function formatDayHeading(value: ConfigType, now: ConfigType = new Date()): string {
  const t = dayjs(value)
  const today = dayjs(now).startOf('day')
  const day = `${formatDate(t, now)} ${weekday(t)}`
  if (t.isSame(today, 'day')) return `今天，${day}`
  if (t.isSame(today.subtract(1, 'day'), 'day')) return `昨天，${day}`
  return day
}

export const formatClock = (value: ConfigType) => dayjs(value).format('HH:mm')

/** Local date "2026-09-24". */
export const toDateString = (value: ConfigType) => dayjs(value).format('YYYY-MM-DD')

/** API timestamps: ISO 8601 with the local offset. */
export const toApiTime = (value: ConfigType) => dayjs(value).format()

export const monthKey = (value: ConfigType) => dayjs(value).format('YYYY-MM')

/** Value for <input type="datetime-local">. */
export const toLocalInput = (value: ConfigType) => dayjs(value).format('YYYY-MM-DDTHH:mm')

/** Age in whole years at a date (default now). */
export function ageYears(birthDate: ConfigType, at: ConfigType = new Date()): number {
  return dayjs(at).diff(dayjs(birthDate), 'year')
}

/** “7 岁”; babies under one show months. */
export function formatAge(birthDate: ConfigType, at: ConfigType = new Date()): string {
  const years = ageYears(birthDate, at)
  if (years >= 1) return `${years} 岁`
  return `${Math.max(0, dayjs(at).diff(dayjs(birthDate), 'month'))} 个月`
}

/** Clip length as the player shows it: “0:42”, “2:05”. */
export function formatClipLength(ms: number | null | undefined): string {
  const total = Math.max(0, Math.round((ms ?? 0) / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** Clip length in words: “42 秒”, “1 分 5 秒”. */
export function formatClipWords(ms: number | null | undefined): string {
  const total = Math.max(0, Math.round((ms ?? 0) / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  if (m === 0) return `${s} 秒`
  return s === 0 ? `${m} 分钟` : `${m} 分 ${s} 秒`
}

/** “7 小时 35 分钟”, “40 分钟”, “2 天 3 小时”. */
export function formatHoursSince(hours: number): string {
  const minutes = Math.max(0, Math.round(hours * 60))
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  if (d > 0) return h > 0 ? `${d} 天 ${h} 小时` : `${d} 天`
  if (h > 0) return m > 0 ? `${h} 小时 ${m} 分钟` : `${h} 小时`
  return `${m} 分钟`
}

/** Cents to “80 元” / “80.5 元”. */
export function formatMoney(cents: number | null | undefined): string {
  const yuan = (cents ?? 0) / 100
  return `${Number.isInteger(yuan) ? yuan : yuan.toFixed(2).replace(/0$/, '')} 元`
}

export const formatTemperature = (v: number) => `${v.toFixed(1)}°C`
