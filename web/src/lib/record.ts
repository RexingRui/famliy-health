import type { Attachment, Record } from '../api/types'
import { formatClipWords, formatMoney, formatTemperature } from './time/format'

export const audioOf = (r: Pick<Record, 'attachments'>) => r.attachments.filter((a) => a.kind === 'audio')
export const photosOf = (r: Pick<Record, 'attachments'>) => r.attachments.filter((a) => a.kind === 'photo')

export function formatDose(name: string | null, dose: number | null, unit: string | null): string {
  return [name, dose !== null ? `${dose}${unit ? ` ${unit}` : ''}` : null].filter(Boolean).join(' ')
}

/**
 * The structured part of a record: “37.8°C”, “止咳糖浆 5 ml”, “理疗”, “骨科”. Empty when the
 * record has no type-specific field filled in.
 */
export function recordHeadline(r: Record): string {
  switch (r.type) {
    case 'temperature':
      return r.temperature !== null ? formatTemperature(r.temperature) : ''
    case 'medication':
      return formatDose(r.medName, r.medDose, r.medUnit)
    case 'visit':
      return [r.details.hospital, r.details.department, r.details.doctor].filter(Boolean).join(' ')
    case 'treatment':
    case 'exam':
      return r.details.item ?? ''
    default:
      return ''
  }
}

/** Secondary line for visits and treatments: “社区康复中心，80 元”. */
export function recordSubline(r: Record): string {
  if (r.type !== 'visit' && r.type !== 'treatment') return ''
  const parts = [r.type === 'treatment' ? r.details.institution : null, r.costCents !== null ? formatMoney(r.costCents) : null]
  return parts.filter(Boolean).join('，')
}

function audioWords(clips: Attachment[]): string {
  if (clips.length === 0) return ''
  if (clips.length === 1) return `语音 ${formatClipWords(clips[0].durationMs)}`
  const total = clips.reduce((s, a) => s + (a.durationMs ?? 0), 0)
  return `语音 ${clips.length} 段，${formatClipWords(total)}`
}

/**
 * One-line summary for compact lists (home, overview, inbox): the structured headline,
 * severity, voice length, text and photo count, in that order of preference.
 */
export function recordSummary(r: Record, maxText = 24): string {
  const parts: string[] = []
  const head = recordHeadline(r)
  if (head) parts.push(head)
  if (r.type === 'symptom' && r.severity !== null) parts.push(`程度 ${r.severity}`)
  const sub = recordSubline(r)
  if (sub && r.costCents !== null) parts.push(formatMoney(r.costCents))
  const audio = audioOf(r)
  if (audio.length) parts.push(audioWords(audio))
  const text = r.body.trim() || audio.map((a) => a.caption).find(Boolean) || ''
  if (text) parts.push(text.length > maxText ? `${text.slice(0, maxText)}…` : text)
  const photos = photosOf(r)
  if (photos.length) parts.push(`照片 ${photos.length} 张`)
  return parts.join('，') || '（空记录）'
}

/** Report / print wording for voice: “语音 42 秒。补充文字”. */
export function audioReportText(r: Record): string {
  return audioOf(r)
    .map((a) => `语音 ${formatClipWords(a.durationMs)}${a.caption ? `（${a.caption}）` : ''}`)
    .join('；')
}
