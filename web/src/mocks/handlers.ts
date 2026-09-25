import dayjs from 'dayjs'
import { delay, http, HttpResponse, type HttpResponseResolver } from 'msw'
import type {
  AssignRequest,
  AttachmentKind,
  ByDisease,
  DiseaseSummary,
  EpisodeCreate,
  EpisodePatch,
  EpisodeStatus,
  HomeMember,
  MemberCreate,
  MemberPatch,
  NewEpisode,
  PhotoOption,
  PrintData,
  RecordCreate,
  RecordPatch,
  RecordType,
  ReportType,
} from '../api/types'
import { uuidv7 } from '../lib/id'
import {
  attachmentView,
  calendarDays,
  episodeView,
  files,
  isOpen,
  memberView,
  nowIso,
  recordView,
  seed,
  sortEpisodes,
  type AttachmentRow,
  type Db,
  type EpisodeRow,
  type RecordRow,
} from './db'
import { placeholderAudio, placeholderPdf, placeholderPhoto } from './files'

// ---------- state ----------

const STORAGE_KEY = 'healthlog.mock.v1'
const persistent = typeof window !== 'undefined' && typeof localStorage !== 'undefined' && !import.meta.env.VITEST

function load(): Db {
  if (persistent) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) return JSON.parse(raw) as Db
    } catch {
      // fall through to a fresh seed
    }
  }
  return seed()
}

let db = load()

function save() {
  if (!persistent) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
  } catch {
    // quota or private mode: the mock keeps working in memory
  }
}

/** Fresh seed data; tests call this before each case. */
export function resetDb(loggedIn = false) {
  db = seed()
  db.loggedIn = loggedIn
  files.clear()
  save()
}

export const mockDb = () => db

// ---------- helpers ----------

type Fields = { [field: string]: string }

const fail = (status: number, code: string, message: string, fields?: Fields) =>
  HttpResponse.json({ error: { code, message, ...(fields ? { fields } : {}) } }, { status })

const notFound = (what = '记录') => fail(404, 'not_found', `${what}不存在`)

const validation = (message: string, fields: Fields) => fail(422, 'validation_failed', message, fields)

const latency = () => (persistent ? delay(120 + Math.random() * 180) : Promise.resolve())

/** Wraps a resolver with latency, the session check and persistence of writes. */
function route(resolver: HttpResponseResolver, opts: { public?: boolean } = {}): HttpResponseResolver {
  return async (info) => {
    await latency()
    if (!opts.public && !db.loggedIn) return fail(401, 'unauthorized', '请先登录')
    const res = await resolver(info)
    if (info.request.method !== 'GET') save()
    return res
  }
}

const today = () => dayjs().startOf('day')

const findMember = (id: string) => db.members.find((m) => m.id === id)
const findEpisode = (id: string) => db.episodes.find((e) => e.id === id)
const findRecord = (id: string) => db.records.find((r) => r.id === id)

function ensureTag(name: string) {
  const trimmed = name.trim()
  let t = db.tags.find((x) => x.name === trimmed)
  if (!t) {
    t = { id: uuidv7(), name: trimmed, createdAt: nowIso() }
    db.tags.push(t)
  }
  return t
}

function statusAllowed(kind: string, status: EpisodeStatus) {
  return kind === 'short' ? status === 'active' || status === 'recovered' : ['treating', 'stable', 'ended'].includes(status)
}

function normalizeEnd(e: EpisodeRow) {
  if (isOpen(e.status)) e.endedOn = null
  else if (!e.endedOn) e.endedOn = today().format('YYYY-MM-DD')
}

function createEpisodeRow(memberId: string, input: NewEpisode | EpisodeCreate): EpisodeRow | Response {
  const tagName = input.diseaseTagId ? db.tags.find((t) => t.id === input.diseaseTagId)?.name : input.diseaseName
  if (!tagName?.trim()) return validation('请选择或填写病种', { diseaseName: 'required' })
  const tag = ensureTag(tagName)
  const startedOn = input.startedOn ?? today().format('YYYY-MM-DD')
  const status = ('status' in input && input.status) || (input.kind === 'long' ? 'treating' : 'active')
  if (!statusAllowed(input.kind, status)) return validation('该状态不适用于这种病程', { status: 'invalid_for_kind' })
  const row: EpisodeRow = {
    id: uuidv7(),
    memberId,
    diseaseTagId: tag.id,
    name: input.name?.trim() || (input.kind === 'long' ? tag.name : `${tag.name} · ${dayjs(startedOn).format('YYYY-MM')}`),
    kind: input.kind,
    status,
    startedOn,
    endedOn: ('endedOn' in input && input.endedOn) || null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  normalizeEnd(row)
  db.episodes.push(row)
  return row
}

const TYPE_FIELDS: { [K in RecordType]: (keyof RecordRow)[] } = {
  symptom: ['severity'],
  temperature: ['temperature'],
  medication: ['medName', 'medDose', 'medUnit'],
  visit: ['costCents', 'details'],
  treatment: ['costCents', 'details'],
  exam: ['details'],
  other: [],
}

function validateRecord(r: RecordRow): Response | null {
  if (r.temperature !== null && (r.temperature < 34 || r.temperature > 43)) {
    return validation('体温需在 34.0 到 43.0 之间', { temperature: 'out_of_range' })
  }
  if (r.severity !== null && (r.severity < 0 || r.severity > 10)) {
    return validation('程度需在 0 到 10 之间', { severity: 'out_of_range' })
  }
  if (!findMember(r.memberId)) return validation('成员不存在', { memberId: 'not_found' })
  if (r.episodeId) {
    const e = findEpisode(r.episodeId)
    if (!e) return validation('病程不存在', { episodeId: 'not_found' })
    if (e.memberId !== r.memberId) return validation('病程不属于这个成员', { episodeId: 'member_mismatch' })
    if (r.isFlare && e.kind !== 'long') r.isFlare = false
  } else {
    r.isFlare = false
  }
  return null
}

/** Clears type-specific fields that do not belong to the record's type. */
function clearForeignFields(r: RecordRow) {
  const keep = new Set<keyof RecordRow>(r.type ? TYPE_FIELDS[r.type] : [])
  if (!keep.has('severity')) r.severity = null
  if (!keep.has('temperature')) r.temperature = null
  if (!keep.has('medName')) {
    r.medName = null
    r.medDose = null
    r.medUnit = null
  }
  if (!keep.has('costCents')) r.costCents = null
  if (!keep.has('details')) r.details = {}
}

const nicknameOk = (n: string | undefined) => !!n && n.trim().length > 0 && [...n.trim()].length <= 20

function searchable(r: RecordRow): string {
  const captions = db.attachments.filter((a) => a.recordId === r.id).map((a) => a.caption ?? '')
  return [r.body, r.medName ?? '', r.details.hospital ?? '', r.details.department ?? '', r.details.item ?? '', r.details.institution ?? '', ...captions]
    .join(' ')
    .toLowerCase()
}

function deleteAttachmentRow(id: string) {
  db.attachments = db.attachments.filter((a) => a.id !== id)
  files.delete(id)
}

// ---------- handlers ----------

export const handlers = [
  http.post(
    '*/api/auth/login',
    route(
      async ({ request }) => {
        const body = (await request.json()) as { username?: string; password?: string }
        if (body.username?.trim() !== 'demo' || body.password !== 'demo') {
          return fail(401, 'unauthorized', '用户名或密码不正确')
        }
        db.loggedIn = true
        return HttpResponse.json({ account: db.account, family: db.family })
      },
      { public: true },
    ),
  ),

  http.post(
    '*/api/auth/logout',
    route(() => {
      db.loggedIn = false
      return new HttpResponse(null, { status: 204 })
    }),
  ),

  http.get('*/api/me', route(() => HttpResponse.json({ account: db.account, family: db.family }))),

  http.get(
    '*/api/home',
    route(() => {
      const weekStart = today().subtract((today().day() + 6) % 7, 'day')
      const members: HomeMember[] = db.members
        .filter((m) => !m.archived)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((m) => {
          const eps = sortEpisodes(db.episodes.filter((e) => e.memberId === m.id && isOpen(e.status)).map((e) => episodeView(db, e)))
          const recs = db.records.filter((r) => r.memberId === m.id).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
          return {
            member: memberView(db, m),
            openEpisodes: eps.map((episode) => {
              const er = recs.filter((r) => r.episodeId === episode.id)
              const temp = er.find((r) => r.type === 'temperature' && r.temperature !== null)
              const med = er.find((r) => r.type === 'medication' && r.medName)
              return {
                episode,
                latestTemperature: temp ? { recordId: temp.id, value: temp.temperature!, occurredAt: temp.occurredAt } : null,
                lastMedication: med
                  ? {
                      recordId: med.id,
                      medName: med.medName!,
                      medDose: med.medDose,
                      medUnit: med.medUnit,
                      occurredAt: med.occurredAt,
                      hoursSince: Math.round(dayjs().diff(dayjs(med.occurredAt), 'hour', true) * 10) / 10,
                    }
                  : null,
                week: calendarDays(er, weekStart, weekStart.add(6, 'day')),
              }
            }),
            recentRecords: recs.slice(0, 4).map((r) => recordView(db, r)),
            episodeCountLastYear: db.episodes.filter(
              (e) => e.memberId === m.id && (!e.endedOn || dayjs(e.endedOn).isAfter(today().subtract(1, 'year'))),
            ).length,
          }
        })
      return HttpResponse.json({ members, inboxCount: db.records.filter((r) => !r.episodeId).length })
    }),
  ),

  // ---------- members ----------

  http.get(
    '*/api/members',
    route(({ request }) => {
      const all = new URL(request.url).searchParams.get('includeArchived') === 'true'
      return HttpResponse.json(
        db.members
          .filter((m) => all || !m.archived)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((m) => memberView(db, m)),
      )
    }),
  ),

  http.post(
    '*/api/members',
    route(async ({ request }) => {
      const b = (await request.json()) as MemberCreate
      if (!nicknameOk(b.nickname)) return validation('称呼不能为空，且不超过 20 个字', { nickname: 'invalid' })
      if (dayjs(b.birthDate).isAfter(today()) || dayjs(b.birthDate).year() < 1900) return validation('出生日期不正确', { birthDate: 'out_of_range' })
      const row = {
        id: uuidv7(),
        nickname: b.nickname.trim(),
        relation: b.relation,
        gender: b.gender,
        birthDate: b.birthDate,
        avatarId: b.avatarId ?? null,
        allergies: b.allergies?.trim() || null,
        bloodType: b.bloodType ?? null,
        notes: b.notes?.trim() || null,
        sortOrder: db.members.length,
        archived: false,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }
      db.members.push(row)
      return HttpResponse.json(memberView(db, row), { status: 201 })
    }),
  ),

  http.get(
    '*/api/members/:id',
    route(({ params }) => {
      const m = findMember(params.id as string)
      return m ? HttpResponse.json(memberView(db, m)) : notFound('成员')
    }),
  ),

  http.patch(
    '*/api/members/:id',
    route(async ({ params, request }) => {
      const m = findMember(params.id as string)
      if (!m) return notFound('成员')
      const b = (await request.json()) as MemberPatch
      if (b.nickname !== undefined && !nicknameOk(b.nickname)) return validation('称呼不能为空，且不超过 20 个字', { nickname: 'invalid' })
      Object.assign(m, b, { updatedAt: nowIso() })
      return HttpResponse.json(memberView(db, m))
    }),
  ),

  http.delete(
    '*/api/members/:id',
    route(({ params, request }) => {
      const id = params.id as string
      if (new URL(request.url).searchParams.get('confirm') !== 'true') {
        return fail(400, 'confirm_required', '删除成员需要确认')
      }
      if (!findMember(id)) return notFound('成员')
      const recIds = new Set(db.records.filter((r) => r.memberId === id).map((r) => r.id))
      db.attachments.filter((a) => a.recordId && recIds.has(a.recordId)).forEach((a) => deleteAttachmentRow(a.id))
      db.records = db.records.filter((r) => r.memberId !== id)
      db.episodes = db.episodes.filter((e) => e.memberId !== id)
      db.members = db.members.filter((m) => m.id !== id)
      return new HttpResponse(null, { status: 204 })
    }),
  ),

  http.post(
    '*/api/members/:id/:action',
    route(({ params }) => {
      const m = findMember(params.id as string)
      if (!m) return notFound('成员')
      if (params.action !== 'archive' && params.action !== 'unarchive') return notFound('接口')
      m.archived = params.action === 'archive'
      m.updatedAt = nowIso()
      return HttpResponse.json(memberView(db, m))
    }),
  ),

  http.get(
    '*/api/members/:id/by-disease',
    route(({ params, request }) => {
      const id = params.id as string
      if (!findMember(id)) return notFound('成员')
      const range = (new URL(request.url).searchParams.get('range') ?? '1y') as ByDisease['range']
      const since = range === 'all' ? null : today().subtract(range === '1y' ? 1 : 3, 'year')
      const eps = db.episodes
        .filter((e) => e.memberId === id && (!since || !e.endedOn || dayjs(e.endedOn).isAfter(since)))
        .map((e) => episodeView(db, e))
        .sort((a, b) => b.startedOn.localeCompare(a.startedOn))
      const byTag = new Map<string, DiseaseSummary>()
      for (const e of eps) {
        let s = byTag.get(e.diseaseTagId)
        if (!s) {
          s = { diseaseTagId: e.diseaseTagId, diseaseName: e.diseaseName, episodeCount: 0, recoveredAvgDays: null, maxDays: null, topMedications: [], episodes: [] }
          byTag.set(e.diseaseTagId, s)
        }
        const recs = db.records.filter((r) => r.episodeId === e.id)
        const temps = recs.filter((r) => r.temperature !== null).map((r) => r.temperature!)
        s.episodes.push({
          episode: e,
          maxTemperature: temps.length ? Math.max(...temps) : null,
          medications: [...new Set(recs.filter((r) => r.medName).map((r) => r.medName!))],
          visitCount: recs.filter((r) => r.type === 'visit').length,
        })
        s.episodeCount++
      }
      for (const s of byTag.values()) {
        const ended = s.episodes.filter((d) => !d.episode.open).map((d) => d.episode.days)
        s.recoveredAvgDays = ended.length ? Math.round((ended.reduce((a, b) => a + b, 0) / ended.length) * 10) / 10 : null
        s.maxDays = ended.length ? Math.max(...ended) : null
        const counts = new Map<string, number>()
        s.episodes.forEach((d) => d.medications.forEach((m) => counts.set(m, (counts.get(m) ?? 0) + 1)))
        s.topMedications = [...counts.entries()]
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 3)
      }
      const diseases = [...byTag.values()].sort((a, b) => b.episodeCount - a.episodeCount)
      return HttpResponse.json({ range, diseases } satisfies ByDisease)
    }),
  ),

  http.get(
    '*/api/members/:id/calendar',
    route(({ params, request }) => {
      const month = dayjs(`${new URL(request.url).searchParams.get('month')}-01`)
      const from = month.startOf('month')
      const to = month.endOf('month')
      const recs = db.records.filter((r) => r.memberId === params.id)
      return HttpResponse.json({ from: from.format('YYYY-MM-DD'), to: to.format('YYYY-MM-DD'), days: calendarDays(recs, from, to) })
    }),
  ),

  // ---------- disease tags & episodes ----------

  http.get(
    '*/api/disease-tags',
    route(() =>
      HttpResponse.json(
        [...db.tags].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((t) => ({ id: t.id, name: t.name })),
      ),
    ),
  ),

  http.post(
    '*/api/disease-tags',
    route(async ({ request }) => {
      const { name } = (await request.json()) as { name: string }
      if (!name?.trim()) return validation('病种名称不能为空，且不超过 30 个字', { name: 'invalid' })
      const existed = db.tags.some((t) => t.name === name.trim())
      const t = ensureTag(name)
      return HttpResponse.json({ id: t.id, name: t.name }, { status: existed ? 200 : 201 })
    }),
  ),

  http.get(
    '*/api/episodes',
    route(({ request }) => {
      const p = new URL(request.url).searchParams
      const list = db.episodes
        .filter((e) => !p.get('memberId') || e.memberId === p.get('memberId'))
        .filter((e) => !p.get('diseaseTagId') || e.diseaseTagId === p.get('diseaseTagId'))
        .filter((e) => !p.get('kind') || e.kind === p.get('kind'))
        .filter((e) => !p.has('open') || isOpen(e.status) === (p.get('open') === 'true'))
        .map((e) => episodeView(db, e))
      return HttpResponse.json(sortEpisodes(list))
    }),
  ),

  http.post(
    '*/api/episodes',
    route(async ({ request }) => {
      const b = (await request.json()) as EpisodeCreate
      if (!findMember(b.memberId)) return validation('成员不存在', { memberId: 'not_found' })
      const row = createEpisodeRow(b.memberId, b)
      if (row instanceof Response) return row
      return HttpResponse.json(episodeView(db, row), { status: 201 })
    }),
  ),

  http.get(
    '*/api/episodes/:id',
    route(({ params }) => {
      const e = findEpisode(params.id as string)
      return e ? HttpResponse.json(episodeView(db, e)) : notFound('病程')
    }),
  ),

  http.patch(
    '*/api/episodes/:id',
    route(async ({ params, request }) => {
      const e = findEpisode(params.id as string)
      if (!e) return notFound('病程')
      const b = (await request.json()) as EpisodePatch
      const oldTag = db.tags.find((t) => t.id === e.diseaseTagId)!
      const next = { ...e }
      if (b.diseaseTagId || b.diseaseName) {
        const name = b.diseaseTagId ? db.tags.find((t) => t.id === b.diseaseTagId)?.name : b.diseaseName
        if (!name) return validation('病种不存在', { diseaseTagId: 'not_found' })
        const tag = ensureTag(name)
        next.diseaseTagId = tag.id
        const oldDefault = e.kind === 'long' ? oldTag.name : `${oldTag.name} · ${dayjs(e.startedOn).format('YYYY-MM')}`
        if (!b.name && e.name === oldDefault) {
          next.name = e.kind === 'long' ? tag.name : `${tag.name} · ${dayjs(e.startedOn).format('YYYY-MM')}`
        }
      }
      if (b.name) next.name = b.name.trim()
      if (b.kind && b.kind !== e.kind) {
        if (e.kind === 'long') return validation('长期病程不能改回短期', { kind: 'invalid' })
        next.kind = 'long'
        if (!b.status) next.status = e.status === 'recovered' ? 'stable' : 'treating'
      }
      if (b.status) next.status = b.status
      if (!statusAllowed(next.kind, next.status)) return validation('该状态不适用于这种病程', { status: 'invalid_for_kind' })
      if (b.startedOn) next.startedOn = b.startedOn
      if (b.endedOn !== undefined) next.endedOn = b.endedOn
      normalizeEnd(next)
      Object.assign(e, next, { updatedAt: nowIso() })
      return HttpResponse.json(episodeView(db, e))
    }),
  ),

  http.delete(
    '*/api/episodes/:id',
    route(({ params }) => {
      const id = params.id as string
      if (!findEpisode(id)) return notFound('病程')
      db.records.forEach((r) => {
        if (r.episodeId === id) {
          r.episodeId = null
          r.isFlare = false
        }
      })
      db.episodes = db.episodes.filter((e) => e.id !== id)
      return new HttpResponse(null, { status: 204 })
    }),
  ),

  http.get(
    '*/api/episodes/:id/calendar',
    route(({ params, request }) => {
      const month = dayjs(`${new URL(request.url).searchParams.get('month')}-01`)
      const from = month.startOf('month')
      const to = month.endOf('month')
      const recs = db.records.filter((r) => r.episodeId === params.id)
      return HttpResponse.json({ from: from.format('YYYY-MM-DD'), to: to.format('YYYY-MM-DD'), days: calendarDays(recs, from, to) })
    }),
  ),

  http.get(
    '*/api/episodes/:id/trend',
    route(({ params }) => {
      const recs = db.records
        .filter((r) => r.episodeId === params.id)
        .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
      const points = (pick: (r: RecordRow) => number | null) =>
        recs.flatMap((r) => {
          const value = pick(r)
          return value === null ? [] : [{ recordId: r.id, occurredAt: r.occurredAt, value }]
        })
      return HttpResponse.json({
        temperature: points((r) => (r.type === 'temperature' ? r.temperature : null)),
        severity: points((r) => (r.type === 'symptom' ? r.severity : null)),
      })
    }),
  ),

  // ---------- records ----------

  http.get(
    '*/api/records',
    route(({ request }) => {
      const p = new URL(request.url).searchParams
      const types = p.getAll('type')
      const q = p.get('q')?.trim().toLowerCase()
      const list = db.records
        .filter((r) => !p.get('memberId') || r.memberId === p.get('memberId'))
        .filter((r) => !p.get('episodeId') || r.episodeId === p.get('episodeId'))
        .filter((r) => p.get('inbox') !== 'true' || !r.episodeId)
        .filter((r) => types.length === 0 || (r.type !== null && types.includes(r.type)))
        .filter((r) => p.get('flare') !== 'true' || r.isFlare)
        .filter((r) => !p.get('from') || !dayjs(r.occurredAt).isBefore(dayjs(p.get('from'))))
        .filter((r) => !p.get('to') || !dayjs(r.occurredAt).isAfter(dayjs(p.get('to'))))
        .filter((r) => !q || searchable(r).includes(q))
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id))
      const offset = Number(p.get('cursor') ?? 0)
      const limit = Math.min(200, Number(p.get('limit') ?? 50))
      const page = list.slice(offset, offset + limit)
      return HttpResponse.json({
        items: page.map((r) => recordView(db, r)),
        nextCursor: offset + limit < list.length ? String(offset + limit) : null,
      })
    }),
  ),

  http.post(
    '*/api/records/assign',
    route(async ({ request }) => {
      const b = (await request.json()) as AssignRequest
      const recs = b.ids.map(findRecord)
      if (recs.some((r) => !r)) return validation('部分记录不存在', { ids: 'not_found' })
      const memberIds = new Set(recs.map((r) => r!.memberId))
      if (memberIds.size > 1) return validation('一次只能归入同一个成员的记录', { ids: 'member_mismatch' })
      const memberId = [...memberIds][0]
      let episodeId = b.episodeId
      if (b.newEpisode) {
        const row = createEpisodeRow(memberId, b.newEpisode)
        if (row instanceof Response) return row
        episodeId = row.id
      } else if (episodeId) {
        const e = findEpisode(episodeId)
        if (!e) return validation('病程不存在', { episodeId: 'not_found' })
        if (e.memberId !== memberId) return validation('病程不属于这个成员', { episodeId: 'member_mismatch' })
      }
      const target = episodeId ? findEpisode(episodeId) : undefined
      recs.forEach((r) => {
        r!.episodeId = episodeId
        if (!target || target.kind !== 'long') r!.isFlare = false
        r!.updatedAt = nowIso()
      })
      return HttpResponse.json({ episodeId, updated: recs.length })
    }),
  ),

  http.get(
    '*/api/records/:id',
    route(({ params }) => {
      const r = findRecord(params.id as string)
      return r ? HttpResponse.json(recordView(db, r)) : notFound()
    }),
  ),

  http.put(
    '*/api/records/:id',
    route(async ({ params, request }) => {
      const id = params.id as string
      const existing = findRecord(id)
      if (existing) return HttpResponse.json(recordView(db, existing), { status: 200 })
      const b = (await request.json()) as RecordCreate
      const row: RecordRow = {
        id,
        memberId: b.memberId,
        episodeId: b.episodeId ?? null,
        type: b.type ?? null,
        occurredAt: dayjs(b.occurredAt).format(),
        createdAt: nowIso(),
        updatedAt: nowIso(),
        body: b.body ?? '',
        isFlare: b.isFlare ?? false,
        severity: b.severity ?? null,
        temperature: b.temperature ?? null,
        medName: b.medName?.trim() || null,
        medDose: b.medDose ?? null,
        medUnit: b.medUnit ?? null,
        costCents: b.costCents ?? null,
        details: b.details ?? {},
      }
      clearForeignFields(row)
      if (!findMember(row.memberId)) return validation('成员不存在', { memberId: 'not_found' })
      if (b.newEpisode) {
        const e = createEpisodeRow(row.memberId, b.newEpisode)
        if (e instanceof Response) return e
        row.episodeId = e.id
      }
      const err = validateRecord(row)
      if (err) return err
      db.records.push(row)
      return HttpResponse.json(recordView(db, row), { status: 201 })
    }),
  ),

  http.patch(
    '*/api/records/:id',
    route(async ({ params, request }) => {
      const r = findRecord(params.id as string)
      if (!r) return notFound()
      const b = (await request.json()) as RecordPatch
      const next: RecordRow = { ...r, details: { ...r.details } }
      for (const [k, v] of Object.entries(b)) {
        if (v !== undefined) (next as unknown as { [k: string]: unknown })[k] = v
      }
      if (b.occurredAt) next.occurredAt = dayjs(b.occurredAt).format()
      if (b.memberId && b.memberId !== r.memberId && b.episodeId === undefined) next.episodeId = null
      clearForeignFields(next)
      const err = validateRecord(next)
      if (err) return err
      Object.assign(r, next, { updatedAt: nowIso() })
      return HttpResponse.json(recordView(db, r))
    }),
  ),

  http.delete(
    '*/api/records/:id',
    route(({ params }) => {
      const id = params.id as string
      if (!findRecord(id)) return notFound()
      db.attachments.filter((a) => a.recordId === id).forEach((a) => deleteAttachmentRow(a.id))
      db.records = db.records.filter((r) => r.id !== id)
      return new HttpResponse(null, { status: 204 })
    }),
  ),

  http.get(
    '*/api/medications/last',
    route(({ request }) => {
      const p = new URL(request.url).searchParams
      const med = db.records
        .filter((r) => r.memberId === p.get('memberId') && r.type === 'medication' && r.medName === p.get('medName')?.trim())
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0]
      return HttpResponse.json({
        last: med
          ? {
              recordId: med.id,
              medName: med.medName!,
              medDose: med.medDose,
              medUnit: med.medUnit,
              occurredAt: med.occurredAt,
              hoursSince: Math.round(dayjs().diff(dayjs(med.occurredAt), 'hour', true) * 10) / 10,
            }
          : null,
      })
    }),
  ),

  // ---------- attachments ----------

  http.put(
    '*/api/attachments/:id',
    route(async ({ params, request }) => {
      const id = params.id as string
      const existing = db.attachments.find((a) => a.id === id)
      if (existing) return HttpResponse.json(attachmentView(existing), { status: 200 })
      const form = await request.formData()
      const kind = form.get('kind') as AttachmentKind
      const file = form.get('file')
      if (!file || typeof file === 'string') return validation('缺少文件', { file: 'required' })
      const recordId = (form.get('recordId') as string | null) || null
      if (kind !== 'avatar' && (!recordId || !findRecord(recordId))) return validation('记录不存在', { recordId: 'not_found' })
      if (kind === 'photo' && recordId && db.attachments.filter((a) => a.recordId === recordId && a.kind === 'photo').length >= 9) {
        return validation('每条记录最多 9 张照片', { file: 'too_many_photos' })
      }
      const row: AttachmentRow = {
        id,
        recordId: kind === 'avatar' ? null : recordId,
        kind,
        status: kind === 'audio' ? 'processing' : 'ready',
        mime: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        durationMs: form.get('durationMs') ? Number(form.get('durationMs')) : null,
        width: null,
        height: null,
        caption: (form.get('caption') as string | null) || null,
        sortOrder: Number(form.get('sortOrder') ?? 0),
        createdAt: nowIso(),
      }
      files.set(id, file)
      db.attachments.push(row)
      if (kind === 'audio') {
        // Pretend the ffmpeg job finishes a few seconds later.
        setTimeout(() => {
          const a = db.attachments.find((x) => x.id === id)
          if (a) a.status = 'ready'
          save()
        }, 3000)
      }
      return HttpResponse.json(attachmentView(row), { status: 201 })
    }),
  ),

  http.patch(
    '*/api/attachments/:id',
    route(async ({ params, request }) => {
      const a = db.attachments.find((x) => x.id === params.id)
      if (!a) return notFound('附件')
      const b = (await request.json()) as { caption?: string | null; sortOrder?: number }
      if (b.caption !== undefined) a.caption = b.caption?.trim() || null
      if (b.sortOrder !== undefined) a.sortOrder = b.sortOrder
      return HttpResponse.json(attachmentView(a))
    }),
  ),

  http.delete(
    '*/api/attachments/:id',
    route(({ params }) => {
      if (!db.attachments.some((a) => a.id === params.id)) return notFound('附件')
      deleteAttachmentRow(params.id as string)
      return new HttpResponse(null, { status: 204 })
    }),
  ),

  http.get(
    '*/api/attachments/:id/file',
    route(
      ({ params, request }) => {
        const a = db.attachments.find((x) => x.id === params.id)
        if (!a) return notFound('附件')
        if (!db.loggedIn && !new URL(request.url).searchParams.get('token')) return fail(401, 'unauthorized', '请先登录')
        const blob =
          files.get(a.id) ??
          (a.kind === 'audio'
            ? placeholderAudio(a.durationMs ?? 5000)
            : placeholderPhoto((a.label ?? '照片').split('#')[0], Number(a.label?.split('#')[1] ?? 0)))
        return new HttpResponse(blob, { headers: { 'Content-Type': blob.type, 'Cache-Control': 'private' } })
      },
      { public: true },
    ),
  ),

  http.post(
    '*/api/attachments/:id/reprocess',
    route(({ params }) => {
      const a = db.attachments.find((x) => x.id === params.id)
      if (!a) return notFound('附件')
      a.status = 'ready'
      return HttpResponse.json(attachmentView(a))
    }),
  ),

  // ---------- reports ----------

  http.get(
    '*/api/print-data',
    route(
      ({ request }) => {
        const p = new URL(request.url).searchParams
        if (!db.loggedIn && !p.get('token')) return fail(401, 'unauthorized', '请先登录')
        const type = (p.get('type') ?? 'episode') as ReportType
        const id = p.get('id') ?? ''
        const from = p.get('from')
        const to = p.get('to')
        const photos = (p.get('photos') ?? 'thumbnail') as PhotoOption
        const inRange = (iso: string) =>
          (!from || !dayjs(iso).isBefore(dayjs(from))) && (!to || !dayjs(iso).isAfter(dayjs(to).endOf('day')))
        let data: PrintData
        if (type === 'episode') {
          const e = findEpisode(id)
          if (!e) return notFound('病程')
          const records = db.records
            .filter((r) => r.episodeId === e.id && inRange(r.occurredAt))
            .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
            .map((r) => recordView(db, r))
          data = {
            type,
            generatedAt: nowIso(),
            from,
            to,
            photos,
            member: memberView(db, findMember(e.memberId)!),
            episode: episodeView(db, e),
            episodes: [],
            records,
            costTotalCents: records.reduce((s, r) => s + (r.costCents ?? 0), 0),
            token: p.get('token'),
          }
        } else {
          const m = findMember(id)
          if (!m) return notFound('成员')
          const episodes = sortEpisodes(
            db.episodes
              .filter((e) => e.memberId === m.id)
              .filter((e) => (!to || !dayjs(e.startedOn).isAfter(dayjs(to))) && (!from || !e.endedOn || !dayjs(e.endedOn).isBefore(dayjs(from))))
              .map((e) => episodeView(db, e)),
          )
          data = {
            type,
            generatedAt: nowIso(),
            from,
            to,
            photos,
            member: memberView(db, m),
            episode: null,
            episodes,
            records: [],
            costTotalCents: episodes.reduce((s, e) => s + e.costTotalCents, 0),
            token: p.get('token'),
          }
        }
        return HttpResponse.json(data)
      },
      { public: true },
    ),
  ),

  http.post(
    '*/api/exports',
    route(async ({ request }) => {
      const b = (await request.json()) as { type: ReportType; episodeId?: string; memberId?: string }
      const title =
        b.type === 'episode'
          ? `${findMember(findEpisode(b.episodeId ?? '')?.memberId ?? '')?.nickname ?? ''}-${findEpisode(b.episodeId ?? '')?.name ?? ''}`
          : `${findMember(b.memberId ?? '')?.nickname ?? ''}-健康档案`
      const name = `${title}-${dayjs().format('YYYYMMDD')}.pdf`
      return new HttpResponse(placeholderPdf(title), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="report.pdf"; filename*=UTF-8''${encodeURIComponent(name)}`,
        },
      })
    }),
  ),
]
