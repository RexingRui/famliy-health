import { describe, expect, it } from 'vitest'
import { formatRecordTime, isBackfilled } from './format'

const now = new Date(2026, 8, 24, 22, 0)

describe('formatRecordTime', () => {
  it('formats relative days', () => {
    expect(formatRecordTime(new Date(2026, 8, 24, 21, 30), now)).toBe('今天 21:30')
    expect(formatRecordTime(new Date(2026, 8, 23, 7, 40), now)).toBe('昨天 07:40')
    expect(formatRecordTime(new Date(2026, 8, 22, 9, 5), now)).toBe('9月22日 09:05')
    expect(formatRecordTime(new Date(2025, 11, 31, 8, 0), now)).toBe('2025年12月31日 08:00')
  })
})

describe('isBackfilled', () => {
  it('flags records entered more than an hour after they happened', () => {
    expect(isBackfilled(new Date(2026, 8, 24, 20, 0), new Date(2026, 8, 24, 21, 0))).toBe(false)
    expect(isBackfilled(new Date(2026, 8, 24, 19, 59), new Date(2026, 8, 24, 21, 0))).toBe(true)
  })
})
