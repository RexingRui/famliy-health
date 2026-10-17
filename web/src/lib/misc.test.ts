import { describe, expect, it } from 'vitest'
import type { CalendarDay } from '../api/types'
import { avatarChar } from './avatar'
import { weekSummary } from './calendar'
import { uuidv7 } from './id'
import { pickMimeType } from './recorder/recorder'

describe('uuidv7', () => {
  it('is a version 7 UUID ordered by time', () => {
    const a = uuidv7(1_700_000_000_000)
    const b = uuidv7(1_700_000_000_001)
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(a < b).toBe(true)
  })
})

describe('pickMimeType', () => {
  it('prefers mp4 (iOS Safari), then webm/opus (Android Chrome)', () => {
    expect(pickMimeType((t) => t === 'audio/mp4' || t.startsWith('audio/webm'))).toBe('audio/mp4')
    expect(pickMimeType((t) => t.startsWith('audio/webm'))).toBe('audio/webm;codecs=opus')
    expect(pickMimeType(() => false)).toBeUndefined()
  })
})

describe('avatarChar', () => {
  it('skips diminutive prefixes', () => {
    expect(avatarChar('小明')).toBe('明')
    expect(avatarChar('奶奶')).toBe('奶')
    expect(avatarChar('我')).toBe('我')
  })
})

describe('weekSummary', () => {
  const day = (counts: Partial<CalendarDay['counts']>): CalendarDay => ({
    date: '2026-09-25',
    counts: { symptom: 0, temperature: 0, medication: 0, visit: 0, treatment: 0, exam: 0, other: 0, untyped: 0, ...counts },
    maxSeverity: null,
    flare: false,
  })

  it('names the week empty only when nothing was recorded', () => {
    expect(weekSummary([])).toBe('本周还没有记录')
    expect(weekSummary([day({ untyped: 1 })])).toBe('本周记录 1 条')
  })

  it('counts records without a phrase of their own after the named ones', () => {
    expect(weekSummary([day({ symptom: 2, medication: 1, temperature: 2 }), day({ untyped: 1 })])).toBe('本周有症状 1 天，用药 1 次，其他记录 3 条')
  })
})
