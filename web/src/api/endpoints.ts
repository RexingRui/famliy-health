import { apiFetch, apiUrl, ApiError } from './client'
import type {
  AssignRequest,
  AssignResult,
  Attachment,
  AttachmentKind,
  AttachmentPatch,
  ByDisease,
  ByDiseaseRange,
  Calendar,
  DiseaseTag,
  Episode,
  EpisodeCreate,
  EpisodeKind,
  EpisodePatch,
  ExportRequest,
  Home,
  LastMedication,
  Me,
  Member,
  MemberCreate,
  MemberPatch,
  PhotoOption,
  PrintData,
  Record,
  RecordCreate,
  RecordPage,
  RecordPatch,
  RecordType,
  ReportType,
  Trend,
} from './types'

type QueryValue = string | number | boolean | null | undefined | readonly string[]

/** Builds "?a=1&type=x&type=y", skipping empty values; arrays repeat the key. */
export function query(params: { [key: string]: QueryValue }): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) v.forEach((item) => sp.append(k, item))
    else sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) })

// ---------- auth ----------

export const login = (username: string, password: string, remember: boolean) =>
  apiFetch<Me>('/api/auth/login', { method: 'POST', ...json({ username, password, remember }) })

export const logout = () => apiFetch<void>('/api/auth/logout', { method: 'POST' })

export const getMe = () => apiFetch<Me>('/api/me')

export const getHome = () => apiFetch<Home>('/api/home')

// ---------- members ----------

export const listMembers = (includeArchived = false) =>
  apiFetch<Member[]>(`/api/members${query({ includeArchived: includeArchived || undefined })}`)

export const getMember = (id: string) => apiFetch<Member>(`/api/members/${id}`)

export const createMember = (body: MemberCreate) =>
  apiFetch<Member>('/api/members', { method: 'POST', ...json(body) })

export const updateMember = (id: string, body: MemberPatch) =>
  apiFetch<Member>(`/api/members/${id}`, { method: 'PATCH', ...json(body) })

export const deleteMember = (id: string) =>
  apiFetch<void>(`/api/members/${id}?confirm=true`, { method: 'DELETE' })

export const archiveMember = (id: string, archived: boolean) =>
  apiFetch<Member>(`/api/members/${id}/${archived ? 'archive' : 'unarchive'}`, { method: 'POST' })

export const getMemberByDisease = (id: string, range: ByDiseaseRange) =>
  apiFetch<ByDisease>(`/api/members/${id}/by-disease${query({ range })}`)

export const getMemberCalendar = (id: string, month: string) =>
  apiFetch<Calendar>(`/api/members/${id}/calendar${query({ month })}`)

// ---------- disease tags & episodes ----------

export const listDiseaseTags = () => apiFetch<DiseaseTag[]>('/api/disease-tags')

export type EpisodeFilter = { memberId?: string; open?: boolean; diseaseTagId?: string; kind?: EpisodeKind }

export const listEpisodes = (f: EpisodeFilter = {}) => apiFetch<Episode[]>(`/api/episodes${query(f)}`)

export const getEpisode = (id: string) => apiFetch<Episode>(`/api/episodes/${id}`)

export const createEpisode = (body: EpisodeCreate) =>
  apiFetch<Episode>('/api/episodes', { method: 'POST', ...json(body) })

export const updateEpisode = (id: string, body: EpisodePatch) =>
  apiFetch<Episode>(`/api/episodes/${id}`, { method: 'PATCH', ...json(body) })

export const deleteEpisode = (id: string) => apiFetch<void>(`/api/episodes/${id}`, { method: 'DELETE' })

export const getEpisodeCalendar = (id: string, month: string) =>
  apiFetch<Calendar>(`/api/episodes/${id}/calendar${query({ month })}`)

export const getEpisodeTrend = (id: string, from?: string, to?: string) =>
  apiFetch<Trend>(`/api/episodes/${id}/trend${query({ from, to })}`)

// ---------- records ----------

export type RecordFilter = {
  memberId?: string
  episodeId?: string
  inbox?: boolean
  type?: RecordType[]
  flare?: boolean
  from?: string
  to?: string
  q?: string
  limit?: number
}

export const listRecords = (f: RecordFilter, cursor?: string) =>
  apiFetch<RecordPage>(`/api/records${query({ ...f, cursor })}`)

export const getRecord = (id: string) => apiFetch<Record>(`/api/records/${id}`)

export const putRecord = (id: string, body: RecordCreate) =>
  apiFetch<Record>(`/api/records/${id}`, { method: 'PUT', ...json(body) })

export const updateRecord = (id: string, body: RecordPatch) =>
  apiFetch<Record>(`/api/records/${id}`, { method: 'PATCH', ...json(body) })

export const deleteRecord = (id: string) => apiFetch<void>(`/api/records/${id}`, { method: 'DELETE' })

export const assignRecords = (body: AssignRequest) =>
  apiFetch<AssignResult>('/api/records/assign', { method: 'POST', ...json(body) })

export const getLastMedication = (memberId: string, medName: string) =>
  apiFetch<LastMedication>(`/api/medications/last${query({ memberId, medName })}`)

// ---------- attachments ----------

export type AttachmentUpload = {
  kind: AttachmentKind
  recordId?: string
  durationMs?: number
  caption?: string
  sortOrder?: number
  file: Blob
  fileName?: string
}

export function uploadAttachment(id: string, u: AttachmentUpload) {
  const form = new FormData()
  form.set('kind', u.kind)
  if (u.recordId) form.set('recordId', u.recordId)
  if (u.durationMs !== undefined) form.set('durationMs', String(Math.round(u.durationMs)))
  if (u.caption) form.set('caption', u.caption)
  if (u.sortOrder !== undefined) form.set('sortOrder', String(u.sortOrder))
  form.set('file', u.file, u.fileName ?? 'upload')
  return apiFetch<Attachment>(`/api/attachments/${id}`, { method: 'PUT', body: form })
}

export const updateAttachment = (id: string, body: AttachmentPatch) =>
  apiFetch<Attachment>(`/api/attachments/${id}`, { method: 'PATCH', ...json(body) })

export const deleteAttachment = (id: string) => apiFetch<void>(`/api/attachments/${id}`, { method: 'DELETE' })

export const reprocessAttachment = (id: string) =>
  apiFetch<Attachment>(`/api/attachments/${id}/reprocess`, { method: 'POST' })

// ---------- reports ----------

export type PrintQuery = {
  token?: string
  type?: ReportType
  id?: string
  from?: string
  to?: string
  photos?: PhotoOption
}

export const getPrintData = (q: PrintQuery) => apiFetch<PrintData>(`/api/print-data${query(q)}`)

/** Generates the PDF on the server and returns it with the file name from Content-Disposition. */
export async function createExport(body: ExportRequest): Promise<{ blob: Blob; fileName: string }> {
  const res = await fetch(apiUrl('/api/exports'), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let message = `导出失败（${res.status}）`
    let code = 'http_error'
    try {
      const b = (await res.json()) as { error: { code: string; message: string } }
      message = b.error.message
      code = b.error.code
    } catch {
      // keep the generic message
    }
    throw new ApiError(res.status, code, message)
  }
  const disposition = res.headers.get('Content-Disposition') ?? ''
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
  const plain = /filename="?([^";]+)"?/i.exec(disposition)
  const fileName = star ? decodeURIComponent(star[1]) : (plain?.[1] ?? '健康报告.pdf')
  return { blob: await res.blob(), fileName }
}
