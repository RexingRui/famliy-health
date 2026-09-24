import dayjs, { type ConfigType } from 'dayjs'
import 'dayjs/locale/zh-cn'

dayjs.locale('zh-cn')

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

/** Records whose occurred time is more than an hour from entry time are shown as “补录”. */
export function isBackfilled(occurredAt: ConfigType, createdAt: ConfigType): boolean {
  return Math.abs(dayjs(createdAt).diff(dayjs(occurredAt), 'minute')) > 60
}
