import dayjs from 'dayjs'
import type {
  Attachment,
  Episode,
  EpisodeKind,
  MedUnit,
  Record,
  RecordCreate,
  RecordDetails,
  RecordPatch,
  RecordType,
} from '../../api/types'
import { RECORD_TYPES } from '../../api/types'
import { toApiTime, toLocalInput } from '../../lib/time/format'

/** Audio or photo captured on this device, not yet on the server. */
export type LocalMedia = {
  id: string
  kind: 'audio' | 'photo'
  blob: Blob
  /** Object URL for preview and playback. */
  url: string
  durationMs?: number
  caption: string
}

export type EpisodeChoice =
  | { mode: 'existing'; id: string }
  | { mode: 'none' }
  | { mode: 'new'; diseaseName: string; kind: EpisodeKind }

export type RecordForm = {
  memberId: string | null
  /** datetime-local value */
  occurredAt: string
  body: string
  type: RecordType | null
  severity: number | null
  temperature: string
  medName: string
  medDose: string
  medUnit: MedUnit
  /** Yuan as typed */
  cost: string
  details: RecordDetails
  isFlare: boolean
  episode: EpisodeChoice
  /** Set once the user picks an episode, so switching members stops re-applying the default. */
  episodeTouched: boolean
  added: LocalMedia[]
  /** Existing attachments (edit mode) */
  existing: Attachment[]
  removed: string[]
  captions: { [attachmentId: string]: string }
}

export const MAX_PHOTOS = 9

export function emptyForm(memberId: string | null, now = new Date()): RecordForm {
  return {
    memberId,
    occurredAt: toLocalInput(now),
    body: '',
    type: null,
    severity: null,
    temperature: '',
    medName: '',
    medDose: '',
    medUnit: 'ml',
    cost: '',
    details: {},
    isFlare: false,
    episode: { mode: 'none' },
    episodeTouched: false,
    added: [],
    existing: [],
    removed: [],
    captions: {},
  }
}

export function formFromRecord(r: Record): RecordForm {
  return {
    ...emptyForm(r.memberId),
    occurredAt: toLocalInput(r.occurredAt),
    body: r.body,
    type: r.type,
    severity: r.severity,
    temperature: r.temperature !== null ? String(r.temperature) : '',
    medName: r.medName ?? '',
    medDose: r.medDose !== null ? String(r.medDose) : '',
    medUnit: r.medUnit ?? 'ml',
    cost: r.costCents !== null ? String(r.costCents / 100) : '',
    details: { ...r.details },
    isFlare: r.isFlare,
    episode: r.episodeId ? { mode: 'existing', id: r.episodeId } : { mode: 'none' },
    episodeTouched: true,
    existing: r.attachments,
    captions: Object.fromEntries(r.attachments.map((a) => [a.id, a.caption ?? ''])),
  }
}

/**
 * Default episode for a new record (product rule): the member's open episodes, most recently
 * recorded first. One → it; several → the first, with the list expanded; none → 暂不归类.
 */
export function defaultEpisode(openEpisodes: Episode[]): { choice: EpisodeChoice; expand: boolean } {
  if (openEpisodes.length === 0) return { choice: { mode: 'none' }, expand: false }
  const sorted = [...openEpisodes].sort((a, b) => (b.lastRecordAt ?? b.startedOn).localeCompare(a.lastRecordAt ?? a.startedOn))
  return { choice: { mode: 'existing', id: sorted[0].id }, expand: sorted.length > 1 }
}

// ---------- validation ----------

export type FormErrors = { [field: string]: string }

const num = (s: string) => (s.trim() === '' ? null : Number(s))

export function validate(f: RecordForm, isEdit = false): FormErrors {
  const e: FormErrors = {}
  if (!f.memberId) e.memberId = '请选择给谁记'
  if (!f.occurredAt || !dayjs(f.occurredAt).isValid()) e.occurredAt = '请选择发生时间'
  else if (dayjs(f.occurredAt).isAfter(dayjs().add(5, 'minute'))) e.occurredAt = '发生时间不能晚于现在'
  if (f.type === 'temperature') {
    const t = num(f.temperature)
    if (t !== null && (Number.isNaN(t) || t < 34 || t > 43)) e.temperature = '体温需在 34.0 到 43.0 之间'
  }
  if (f.type === 'medication') {
    const d = num(f.medDose)
    if (d !== null && (Number.isNaN(d) || d <= 0)) e.medDose = '剂量需大于 0'
  }
  if (f.type === 'visit' || f.type === 'treatment') {
    const c = num(f.cost)
    if (c !== null && (Number.isNaN(c) || c < 0)) e.cost = '费用不能为负数'
  }
  if (f.episode.mode === 'new' && !f.episode.diseaseName.trim()) e.episode = '请填写病种，比如“发烧”'
  const hasContent =
    f.body.trim() !== '' ||
    f.added.length > 0 ||
    f.existing.some((a) => !f.removed.includes(a.id)) ||
    (f.type !== null && f.type !== 'other')
  if (!isEdit && !hasContent) e.content = '说句话、拍张照或写几个字再保存'
  return e
}

// ---------- payloads ----------

function typeFields(f: RecordForm) {
  const out: Pick<RecordCreate, 'severity' | 'temperature' | 'medName' | 'medDose' | 'medUnit' | 'costCents' | 'details'> = {}
  switch (f.type) {
    case 'symptom':
      if (f.severity !== null) out.severity = f.severity
      break
    case 'temperature': {
      const t = num(f.temperature)
      if (t !== null) out.temperature = Math.round(t * 10) / 10
      break
    }
    case 'medication': {
      if (f.medName.trim()) out.medName = f.medName.trim()
      const d = num(f.medDose)
      if (d !== null) {
        out.medDose = d
        out.medUnit = f.medUnit
      }
      break
    }
    case 'visit':
    case 'treatment':
    case 'exam': {
      const keys: (keyof RecordDetails)[] =
        f.type === 'visit' ? ['hospital', 'department', 'doctor'] : f.type === 'treatment' ? ['item', 'institution'] : ['item']
      const details: RecordDetails = {}
      for (const k of keys) {
        const v = f.details[k]?.trim()
        if (v) details[k] = v
      }
      out.details = details
      if (f.type !== 'exam') {
        const c = num(f.cost)
        if (c !== null) out.costCents = Math.round(c * 100)
      }
      break
    }
  }
  return out
}

export function buildCreate(f: RecordForm, episodes: Episode[]): RecordCreate {
  const body: RecordCreate = {
    memberId: f.memberId!,
    occurredAt: toApiTime(f.occurredAt),
    body: f.body.trim(),
    ...typeFields(f),
  }
  if (f.type) body.type = f.type
  if (f.episode.mode === 'existing') {
    const episodeId = f.episode.id
    body.episodeId = episodeId
    const ep = episodes.find((e) => e.id === episodeId)
    if (f.isFlare && ep?.kind === 'long') body.isFlare = true
  } else if (f.episode.mode === 'new') {
    body.newEpisode = { diseaseName: f.episode.diseaseName.trim(), kind: f.episode.kind }
  }
  return body
}

/** Only the fields that changed; type-specific fields are sent in full when the type changes. */
export function buildPatch(original: Record, f: RecordForm, episodes: Episode[]): RecordPatch {
  const p: RecordPatch = {}
  if (f.memberId && f.memberId !== original.memberId) p.memberId = f.memberId
  if (!dayjs(f.occurredAt).isSame(dayjs(original.occurredAt), 'minute')) p.occurredAt = toApiTime(f.occurredAt)
  if (f.body.trim() !== original.body) p.body = f.body.trim()
  if (f.type !== original.type) p.type = f.type

  const next = typeFields(f)
  const typeChanged = f.type !== original.type
  const pick = <K extends keyof typeof next>(k: K, current: unknown) => {
    const v = next[k] ?? null
    if (typeChanged || JSON.stringify(v) !== JSON.stringify(current ?? null)) {
      ;(p as { [key: string]: unknown })[k] = v
    }
  }
  if (f.type === 'symptom') pick('severity', original.severity)
  if (f.type === 'temperature') pick('temperature', original.temperature)
  if (f.type === 'medication') {
    pick('medName', original.medName)
    pick('medDose', original.medDose)
    if (next.medDose !== undefined || typeChanged) pick('medUnit', original.medUnit)
  }
  if (f.type === 'visit' || f.type === 'treatment') pick('costCents', original.costCents)
  if (f.type === 'visit' || f.type === 'treatment' || f.type === 'exam') {
    const d = next.details ?? {}
    if (typeChanged || JSON.stringify(d) !== JSON.stringify(original.details)) p.details = d
  }

  const episodeId = f.episode.mode === 'existing' ? f.episode.id : null
  if (f.episode.mode !== 'new' && episodeId !== original.episodeId) p.episodeId = episodeId
  const ep = episodes.find((e) => e.id === episodeId)
  const flare = f.isFlare && ep?.kind === 'long'
  if (flare !== original.isFlare) p.isFlare = flare
  return p
}

export const isEmptyPatch = (p: RecordPatch) => Object.keys(p).length === 0

export const photoCount = (f: RecordForm) =>
  f.added.filter((m) => m.kind === 'photo').length + f.existing.filter((a) => a.kind === 'photo' && !f.removed.includes(a.id)).length

export function recordTypeOrNull(v: string | null): RecordType | null {
  return v && (RECORD_TYPES as string[]).includes(v) ? (v as RecordType) : null
}
