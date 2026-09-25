import type { Trend } from '../api/types'

/** Screen-reader summary: “体温 38.6°C → 37.8°C，症状程度 3 到 8”. */
export function trendLabel(trend: Trend): string {
  const parts: string[] = []
  const t = trend.temperature
  if (t.length) parts.push(`体温 ${t[0].value.toFixed(1)}°C → ${t[t.length - 1].value.toFixed(1)}°C，最高 ${Math.max(...t.map((p) => p.value)).toFixed(1)}°C`)
  const s = trend.severity.map((p) => p.value)
  if (s.length) parts.push(`症状程度 ${Math.min(...s)} 到 ${Math.max(...s)}`)
  return parts.join('；') || '没有体温和症状程度记录'
}
