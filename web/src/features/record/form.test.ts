import { describe, expect, it } from 'vitest'
import type { Episode, Record } from '../../api/types'
import { buildCreate, buildPatch, defaultEpisode, emptyForm, formFromRecord, validate, type RecordForm } from './form'

function episode(over: Partial<Episode>): Episode {
  return {
    id: 'e1',
    memberId: 'm1',
    diseaseTagId: 't1',
    diseaseName: '感冒',
    name: '感冒 · 2026-09',
    kind: 'short',
    status: 'active',
    open: true,
    startedOn: '2026-09-20',
    endedOn: null,
    days: 5,
    recordCount: 3,
    lastRecordAt: '2026-09-24T10:00:00+08:00',
    costTotalCents: 0,
    suggestRecovered: false,
    createdAt: '2026-09-20T08:00:00+08:00',
    updatedAt: '2026-09-20T08:00:00+08:00',
    ...over,
  }
}

function record(over: Partial<Record>): Record {
  return {
    id: 'r1',
    memberId: 'm1',
    episodeId: 'e1',
    type: 'temperature',
    occurredAt: '2026-09-24T21:30:00+08:00',
    createdAt: '2026-09-24T21:31:00+08:00',
    updatedAt: '2026-09-24T21:31:00+08:00',
    backfilled: false,
    body: '',
    isFlare: false,
    severity: null,
    temperature: 38.6,
    medName: null,
    medDose: null,
    medUnit: null,
    costCents: null,
    details: {},
    attachments: [],
    ...over,
  }
}

const form = (over: Partial<RecordForm>): RecordForm => ({ ...emptyForm('m1', new Date('2026-09-24T21:30:00+08:00')), ...over })

describe('defaultEpisode', () => {
  it('uses 暂不归类 when the member has no open episode', () => {
    expect(defaultEpisode([])).toEqual({ choice: { mode: 'none' }, expand: false })
  })

  it('selects the only open episode', () => {
    expect(defaultEpisode([episode({ id: 'a' })])).toEqual({ choice: { mode: 'existing', id: 'a' }, expand: false })
  })

  it('selects the most recently recorded of several and expands the list', () => {
    const older = episode({ id: 'old', lastRecordAt: '2026-09-01T10:00:00+08:00' })
    const newer = episode({ id: 'new', lastRecordAt: '2026-09-24T09:00:00+08:00' })
    expect(defaultEpisode([older, newer])).toEqual({ choice: { mode: 'existing', id: 'new' }, expand: true })
  })
})

describe('buildCreate', () => {
  it('sends only the fields of the chosen type', () => {
    const f = form({ type: 'medication', medName: ' 止咳糖浆 ', medDose: '5', medUnit: 'ml', temperature: '38.5', severity: 4 })
    const body = buildCreate(f, [])
    expect(body).toMatchObject({ memberId: 'm1', type: 'medication', medName: '止咳糖浆', medDose: 5, medUnit: 'ml' })
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('severity')
    expect(body.episodeId).toBeUndefined()
  })

  it('converts yuan to cents and trims details', () => {
    const f = form({ type: 'treatment', cost: '80.5', details: { item: ' 理疗 ', institution: '', hospital: '不相关' } })
    expect(buildCreate(f, [])).toMatchObject({ costCents: 8050, details: { item: '理疗' } })
  })

  it('creates a new episode inline', () => {
    const f = form({ body: '发烧', episode: { mode: 'new', diseaseName: ' 发烧 ', kind: 'short' } })
    expect(buildCreate(f, []).newEpisode).toEqual({ diseaseName: '发烧', kind: 'short' })
  })

  it('keeps the flare mark only for long-term episodes', () => {
    const long = episode({ id: 'L', kind: 'long', status: 'treating' })
    const short = episode({ id: 'S' })
    expect(buildCreate(form({ isFlare: true, episode: { mode: 'existing', id: 'L' } }), [long, short]).isFlare).toBe(true)
    expect(buildCreate(form({ isFlare: true, episode: { mode: 'existing', id: 'S' } }), [long, short]).isFlare).toBeUndefined()
  })
})

describe('buildPatch', () => {
  it('is empty when nothing changed', () => {
    const r = record({})
    expect(buildPatch(r, formFromRecord(r), [episode({})])).toEqual({})
  })

  it('sends a changed temperature only', () => {
    const r = record({})
    expect(buildPatch(r, { ...formFromRecord(r), temperature: '37.9' }, [episode({})])).toEqual({ temperature: 37.9 })
  })

  it('moves the record back to the inbox', () => {
    const r = record({})
    expect(buildPatch(r, { ...formFromRecord(r), episode: { mode: 'none' } }, [])).toEqual({ episodeId: null })
  })

  it('sends the new type with its fields when the type changes', () => {
    const r = record({})
    const patch = buildPatch(r, { ...formFromRecord(r), type: 'symptom', severity: 6 }, [episode({})])
    expect(patch).toEqual({ type: 'symptom', severity: 6 })
  })
})

describe('validate', () => {
  it('rejects an empty new record', () => {
    expect(validate(form({}))).toHaveProperty('content')
  })

  it('checks the temperature range', () => {
    expect(validate(form({ type: 'temperature', temperature: '45' }))).toEqual({ temperature: '体温需在 34.0 到 43.0 之间' })
    expect(validate(form({ type: 'temperature', temperature: '38.2' }))).toEqual({})
  })

  it('requires a disease name for a new episode', () => {
    expect(validate(form({ body: 'x', episode: { mode: 'new', diseaseName: ' ', kind: 'short' } }))).toHaveProperty('episode')
  })

  it('rejects a time in the future', () => {
    expect(validate(form({ body: 'x', occurredAt: '2999-01-01T08:00' }))).toHaveProperty('occurredAt')
  })
})
