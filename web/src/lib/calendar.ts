import type { CalendarDay } from '../api/types'

export function daySummaryLabel(day: CalendarDay | undefined): string {
  if (!day) return '没有记录'
  const c = day.counts
  const parts: string[] = []
  if (c.symptom) parts.push(day.maxSeverity !== null ? `症状，最高程度 ${day.maxSeverity}` : '症状')
  if (c.medication) parts.push('用药')
  if (c.treatment) parts.push('治疗康复')
  if (c.visit) parts.push('就诊')
  if (c.temperature) parts.push('体温')
  if (day.flare) parts.push('发作')
  const total = Object.values(c).reduce((a, b) => a + b, 0)
  return `${total} 条记录${parts.length ? `：${parts.join('、')}` : ''}`
}

/** “本周疼痛 2 天，就诊 1 次，康复 1 次”. */
export function weekSummary(days: CalendarDay[]): string {
  const symptomDays = days.filter((d) => d.counts.symptom > 0).length
  const visits = days.reduce((s, d) => s + d.counts.visit, 0)
  const treatments = days.reduce((s, d) => s + d.counts.treatment, 0)
  const meds = days.reduce((s, d) => s + d.counts.medication, 0)
  // Temperatures, exams, 其他 and untyped records have no phrase of their own but still count.
  const rest = days.reduce((s, d) => s + d.counts.temperature + d.counts.exam + d.counts.other + d.counts.untyped, 0)
  const parts: string[] = []
  if (symptomDays) parts.push(`有症状 ${symptomDays} 天`)
  if (visits) parts.push(`就诊 ${visits} 次`)
  if (treatments) parts.push(`康复 ${treatments} 次`)
  if (meds) parts.push(`用药 ${meds} 次`)
  if (rest) parts.push(parts.length ? `其他记录 ${rest} 条` : `记录 ${rest} 条`)
  return parts.length ? `本周${parts.join('，')}` : '本周还没有记录'
}
