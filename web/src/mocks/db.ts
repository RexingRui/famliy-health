// In-memory stand-in for the Go backend, used until front and back end are wired together.
// Rows hold what the database stores; views compute the derived fields the API returns.

import dayjs from 'dayjs'
import type {
  Attachment,
  CalendarDay,
  Episode,
  EpisodeKind,
  EpisodeStatus,
  Member,
  Record,
  RecordType,
  TypeCounts,
} from '../api/types'
import { apiUrl } from '../api/client'
import { uuidv7 } from '../lib/id'

export type MemberRow = Omit<Member, 'longEpisodes' | 'avatarUrl'>
export type EpisodeRow = Omit<
  Episode,
  'diseaseName' | 'open' | 'days' | 'recordCount' | 'lastRecordAt' | 'costTotalCents' | 'suggestRecovered'
>
export type RecordRow = Omit<Record, 'attachments' | 'backfilled'>
export type AttachmentRow = Omit<Attachment, 'url' | 'thumbUrl'> & { label?: string }

export type Db = {
  loggedIn: boolean
  account: { id: string; username: string; displayName: string }
  family: { id: string; name: string }
  members: MemberRow[]
  tags: { id: string; name: string; createdAt: string }[]
  episodes: EpisodeRow[]
  records: RecordRow[]
  attachments: AttachmentRow[]
}

/** Uploaded files, kept only in memory. Seeded attachments are generated on demand. */
export const files = new Map<string, Blob>()

export const nowIso = () => dayjs().format()

export const OPEN_STATUSES: EpisodeStatus[] = ['active', 'treating', 'stable']

export function isOpen(s: EpisodeStatus) {
  return OPEN_STATUSES.includes(s)
}

// ---------- views ----------

export function attachmentView(a: AttachmentRow): Attachment {
  const { label: _label, ...rest } = a
  const url = apiUrl(`/api/attachments/${a.id}/file`)
  return { ...rest, url, thumbUrl: a.kind === 'audio' ? null : `${url}?variant=thumb` }
}

export function recordView(db: Db, r: RecordRow): Record {
  return {
    ...r,
    backfilled: Math.abs(dayjs(r.createdAt).diff(dayjs(r.occurredAt), 'minute')) > 60,
    attachments: db.attachments
      .filter((a) => a.recordId === r.id)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt))
      .map(attachmentView),
  }
}

export function episodeView(db: Db, e: EpisodeRow): Episode {
  const recs = db.records.filter((r) => r.episodeId === e.id)
  const last = recs.reduce<string | null>((m, r) => (m === null || r.occurredAt > m ? r.occurredAt : m), null)
  const open = isOpen(e.status)
  const end = !open && e.endedOn ? dayjs(e.endedOn) : dayjs().startOf('day')
  const days = Math.max(1, end.diff(dayjs(e.startedOn), 'day') + 1)
  const quietSince = last ? dayjs(last) : dayjs(e.startedOn)
  return {
    ...e,
    diseaseName: db.tags.find((t) => t.id === e.diseaseTagId)?.name ?? '',
    open,
    days,
    recordCount: recs.length,
    lastRecordAt: last,
    costTotalCents: recs.reduce((s, r) => s + (r.costCents ?? 0), 0),
    suggestRecovered: e.kind === 'short' && e.status === 'active' && dayjs().diff(quietSince, 'day', true) > 14,
  }
}

export function memberView(db: Db, m: MemberRow): Member {
  const avatar = m.avatarId ? db.attachments.find((a) => a.id === m.avatarId) : undefined
  return {
    ...m,
    avatarUrl: avatar ? attachmentView(avatar).url : null,
    longEpisodes: db.episodes
      .filter((e) => e.memberId === m.id && e.kind === 'long')
      .sort((a, b) => a.startedOn.localeCompare(b.startedOn))
      .map((e) => {
        const v = episodeView(db, e)
        return { id: v.id, name: v.name, diseaseName: v.diseaseName, kind: v.kind, status: v.status }
      }),
  }
}

/** Episodes ordered like the API: by latest record (or start) descending. */
export function sortEpisodes(list: Episode[]): Episode[] {
  const key = (e: Episode) => e.lastRecordAt ?? dayjs(e.startedOn).format()
  return [...list].sort((a, b) => key(b).localeCompare(key(a)))
}

function emptyCounts(): TypeCounts {
  return { symptom: 0, temperature: 0, medication: 0, visit: 0, treatment: 0, exam: 0, other: 0, untyped: 0 }
}

/** Per-day counts for records in [from, to] (dates, inclusive). */
export function calendarDays(records: RecordRow[], from: dayjs.Dayjs, to: dayjs.Dayjs): CalendarDay[] {
  const byDay = new Map<string, CalendarDay>()
  for (const r of records) {
    const d = dayjs(r.occurredAt)
    if (d.isBefore(from.startOf('day')) || d.isAfter(to.endOf('day'))) continue
    const key = d.format('YYYY-MM-DD')
    let day = byDay.get(key)
    if (!day) {
      day = { date: key, counts: emptyCounts(), maxSeverity: null, flare: false }
      byDay.set(key, day)
    }
    day.counts[(r.type ?? 'untyped') as keyof TypeCounts]++
    if (r.type === 'symptom' && r.severity !== null) day.maxSeverity = Math.max(day.maxSeverity ?? 0, r.severity)
    if (r.isFlare) day.flare = true
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date))
}

// ---------- seed ----------

type SeedRecord = Partial<RecordRow> & {
  at: dayjs.Dayjs
  enteredAt?: dayjs.Dayjs
  photos?: string[]
  audio?: { ms: number; caption?: string }[]
}

export function seed(): Db {
  const now = dayjs().second(0).millisecond(0)
  const db: Db = {
    loggedIn: false,
    account: { id: uuidv7(), username: 'demo', displayName: '妈妈' },
    family: { id: uuidv7(), name: '我们家' },
    members: [],
    tags: [],
    episodes: [],
    records: [],
    attachments: [],
  }

  const member = (m: Pick<MemberRow, 'nickname' | 'relation' | 'gender' | 'birthDate'> & Partial<MemberRow>) => {
    const row: MemberRow = {
      id: uuidv7(),
      avatarId: null,
      allergies: null,
      bloodType: null,
      notes: null,
      sortOrder: db.members.length,
      archived: false,
      createdAt: now.subtract(2, 'year').format(),
      updatedAt: now.subtract(2, 'year').format(),
      ...m,
    }
    db.members.push(row)
    return row.id
  }

  const tag = (name: string) => {
    let t = db.tags.find((x) => x.name === name)
    if (!t) {
      t = { id: uuidv7(), name, createdAt: now.subtract(2, 'year').add(db.tags.length, 'minute').format() }
      db.tags.push(t)
    }
    return t.id
  }

  const episode = (
    memberId: string,
    disease: string,
    kind: EpisodeKind,
    status: EpisodeStatus,
    startedOn: dayjs.Dayjs,
    endedOn: dayjs.Dayjs | null = null,
  ) => {
    const row: EpisodeRow = {
      id: uuidv7(),
      memberId,
      diseaseTagId: tag(disease),
      name: kind === 'long' ? disease : `${disease} · ${startedOn.format('YYYY-MM')}`,
      kind,
      status,
      startedOn: startedOn.format('YYYY-MM-DD'),
      endedOn: endedOn ? endedOn.format('YYYY-MM-DD') : null,
      createdAt: startedOn.format(),
      updatedAt: startedOn.format(),
    }
    db.episodes.push(row)
    return row.id
  }

  let photoSeed = 0
  const record = (memberId: string, episodeId: string | null, s: SeedRecord) => {
    const { at, enteredAt, photos = [], audio = [], ...fields } = s
    const row: RecordRow = {
      id: uuidv7(at.valueOf()),
      memberId,
      episodeId,
      type: null,
      occurredAt: at.format(),
      createdAt: (enteredAt ?? at.add(2, 'minute')).format(),
      updatedAt: (enteredAt ?? at.add(2, 'minute')).format(),
      body: '',
      isFlare: false,
      severity: null,
      temperature: null,
      medName: null,
      medDose: null,
      medUnit: null,
      costCents: null,
      details: {},
      ...fields,
    }
    db.records.push(row)
    photos.forEach((label, i) =>
      db.attachments.push({
        id: uuidv7(),
        recordId: row.id,
        kind: 'photo',
        status: 'ready',
        mime: 'image/svg+xml',
        sizeBytes: 120_000,
        durationMs: null,
        width: 800,
        height: 600,
        caption: null,
        sortOrder: i,
        createdAt: row.createdAt,
        label: `${label}#${photoSeed++}`,
      }),
    )
    audio.forEach((clip, i) =>
      db.attachments.push({
        id: uuidv7(),
        recordId: row.id,
        kind: 'audio',
        status: 'ready',
        mime: 'audio/mp4',
        sizeBytes: clip.ms * 8,
        durationMs: clip.ms,
        width: null,
        height: null,
        caption: clip.caption ?? null,
        sortOrder: photos.length + i,
        createdAt: row.createdAt,
      }),
    )
    return row.id
  }

  const ago = (minutes: number) => now.subtract(minutes, 'minute')
  const day = (daysAgo: number, hh: number, mm = 0) => now.subtract(daysAgo, 'day').hour(hh).minute(mm)

  // 小明: a cold that started yesterday, plus past illnesses for the by-disease view.
  const ming = member({
    nickname: '小明',
    relation: 'child',
    gender: 'male',
    birthDate: now.subtract(7, 'year').subtract(4, 'month').format('YYYY-MM-DD'),
    allergies: '花粉',
    bloodType: 'A',
  })
  const cold = episode(ming, '感冒', 'short', 'active', now.subtract(1, 'day'))
  record(ming, cold, {
    type: 'symptom',
    at: day(1, 7, 40),
    enteredAt: day(1, 10, 15),
    body: '流鼻涕，咳嗽，早上起来有点没精神',
    photos: ['舌苔'],
  })
  record(ming, cold, { type: 'other', at: day(1, 9), body: '已向学校请假 2 天' })
  record(ming, cold, { type: 'medication', at: day(1, 20), medName: '退烧药', medDose: 4, medUnit: 'ml' })
  record(ming, cold, { type: 'temperature', at: day(1, 22, 10), temperature: 38.6 })
  record(ming, cold, { type: 'temperature', at: ago(13 * 60 + 25), temperature: 38.0 })
  record(ming, cold, { type: 'medication', at: ago(7 * 60 + 35), medName: '止咳糖浆', medDose: 5, medUnit: 'ml' })
  record(ming, cold, {
    type: 'symptom',
    at: ago(160),
    body: '精神还可以，晚饭吃了半碗粥，还有点咳嗽',
    audio: [{ ms: 42_000 }],
  })
  record(ming, cold, { type: 'temperature', at: ago(15), temperature: 37.8 })

  const pastCold = (start: dayjs.Dayjs, days: number, maxT: number, meds: string[], visits: number) => {
    const id = episode(ming, '感冒', 'short', 'recovered', start, start.add(days - 1, 'day'))
    record(ming, id, { type: 'temperature', at: start.hour(20), temperature: maxT })
    record(ming, id, { type: 'temperature', at: start.add(1, 'day').hour(8), temperature: Math.round((maxT - 0.6) * 10) / 10 })
    meds.forEach((m, i) =>
      record(ming, id, { type: 'medication', at: start.add(i, 'day').hour(21), medName: m, medDose: 5, medUnit: 'ml' }),
    )
    for (let i = 0; i < visits; i++) {
      record(ming, id, {
        type: 'visit',
        at: start.add(i + 1, 'day').hour(10),
        details: { hospital: '市儿童医院', department: '儿科' },
        costCents: 12_000,
        body: '医生说是病毒性感冒，多喝水',
      })
    }
    record(ming, id, { type: 'other', at: start.add(days - 1, 'day').hour(19), body: '已经不咳了，恢复正常' })
  }
  pastCold(now.subtract(136, 'day'), 6, 39.1, ['退烧药', '止咳糖浆'], 1)
  pastCold(now.subtract(262, 'day'), 8, 38.9, ['退烧药', '抗生素（医嘱）'], 2)
  pastCold(now.subtract(311, 'day'), 3, 37.9, ['止咳糖浆'], 0)
  const mp = episode(ming, '支原体肺炎', 'short', 'recovered', now.subtract(290, 'day'), now.subtract(276, 'day'))
  record(ming, mp, { type: 'visit', at: now.subtract(290, 'day').hour(9), details: { hospital: '市儿童医院', department: '呼吸科' }, costCents: 35_000 })
  record(ming, mp, { type: 'temperature', at: now.subtract(289, 'day').hour(21), temperature: 39.4 })
  record(ming, mp, { type: 'medication', at: now.subtract(289, 'day').hour(9), medName: '阿奇霉素', medDose: 1, medUnit: '袋' })
  const gastro = episode(ming, '肠胃炎', 'short', 'recovered', now.subtract(190, 'day'), now.subtract(187, 'day'))
  record(ming, gastro, { type: 'symptom', at: now.subtract(190, 'day').hour(14), severity: 5, body: '呕吐两次，肚子疼' })
  record(ming, gastro, { type: 'medication', at: now.subtract(190, 'day').hour(18), medName: '蒙脱石散', medDose: 1, medUnit: '袋' })

  // Inbox: records not yet assigned to an episode.
  record(ming, null, {
    type: 'symptom',
    at: ago(Math.min(6 * 60, Math.max(30, now.hour() * 60 - 60))),
    audio: [{ ms: 38_000, caption: '早上起来咳了几声，精神还行' }],
  })
  record(ming, null, { at: day(1, 23, 40), body: '半夜醒了一次，说嗓子疼' })

  // 我: a long-term lumbar condition with pain, physiotherapy and visits this month.
  const me = member({
    nickname: '我',
    relation: 'self',
    gender: 'female',
    birthDate: now.subtract(38, 'year').subtract(2, 'month').format('YYYY-MM-DD'),
    bloodType: 'O',
  })
  const back = episode(me, '腰椎间盘突出', 'long', 'treating', now.subtract(18, 'month').date(3))
  const pain: [number, number, boolean][] = [
    [0, 3, false],
    [2, 6, false],
    [9, 4, false],
    [16, 8, true],
    [17, 7, true],
    [21, 5, false],
    [35, 6, false],
    [48, 4, false],
  ]
  pain.forEach(([d, sev, flare]) =>
    record(me, back, {
      type: 'symptom',
      at: d === 0 ? ago(Math.min(120, now.hour() * 60)) : day(d, 8, 10),
      severity: sev,
      isFlare: flare,
      body: d === 0 ? '早上起床腰有点僵，活动开后好转' : sev >= 7 ? '弯腰都困难，右腿发麻' : '久坐后加重',
    }),
  )
  ;[0, 7, 14, 19, 28, 42].forEach((d) =>
    record(me, back, {
      type: 'treatment',
      at: d === 0 ? ago(Math.min(60, now.hour() * 60)) : day(d, 18, 30),
      details: { item: '理疗', institution: '社区康复中心' },
      costCents: 8_000,
    }),
  )
  ;[1, 16, 45].forEach((d) =>
    record(me, back, {
      type: 'visit',
      at: day(d, 16, 20),
      details: { hospital: '市第一医院', department: '骨科' },
      costCents: 5_000,
      body: '骨科复诊',
      photos: d === 16 ? ['病历'] : [],
    }),
  )
  ;[16, 17, 18].forEach((d) =>
    record(me, back, { type: 'medication', at: day(d, 12), medName: '布洛芬缓释胶囊', medDose: 1, medUnit: '粒', isFlare: d < 18 }),
  )
  record(me, null, { at: day(2, 12, 5), body: '康复中心收费单', photos: ['收费单'] })

  // 奶奶: stable hypertension.
  const nai = member({
    nickname: '奶奶',
    relation: 'grandparent',
    gender: 'female',
    birthDate: now.subtract(76, 'year').subtract(5, 'month').format('YYYY-MM-DD'),
    allergies: '青霉素',
    bloodType: 'B',
    notes: '每天早上吃一片降压药',
  })
  const bp = episode(nai, '高血压', 'long', 'stable', now.subtract(3, 'year'))
  record(nai, bp, { type: 'visit', at: day(14, 9, 30), details: { hospital: '社区卫生服务中心' }, body: '复查血压', costCents: 2_000 })
  record(nai, bp, { type: 'exam', at: day(14, 9, 50), details: { item: '血压' }, body: '血压报告', photos: ['血压报告'] })
  record(nai, bp, { type: 'visit', at: day(43, 10), details: { hospital: '社区卫生服务中心' }, body: '开药', costCents: 3_500 })
  record(nai, bp, { type: 'medication', at: day(0, 7, 30).isAfter(now) ? day(1, 7, 30) : day(0, 7, 30), medName: '氨氯地平', medDose: 1, medUnit: '片' })

  return db
}

export const newRecordType = (t: string | null | undefined): RecordType | null => (t ? (t as RecordType) : null)
