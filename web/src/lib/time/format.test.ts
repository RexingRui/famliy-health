import { describe, expect, it } from 'vitest'
import { formatAge, formatClipLength, formatClipWords, formatDayHeading, formatHoursSince, formatMoney, formatRecordTime, isBackfilled } from './format'

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

describe('formatting helpers', () => {
  const now = new Date('2026-09-24T21:45:00+08:00')

  it('formats day headings', () => {
    expect(formatDayHeading('2026-09-24', now)).toBe('今天，9月24日 周四')
    expect(formatDayHeading('2026-09-23', now)).toBe('昨天，9月23日 周三')
    expect(formatDayHeading('2025-12-01', now)).toBe('2025年12月1日 周一')
  })

  it('formats elapsed hours', () => {
    expect(formatHoursSince(7.6)).toBe('7 小时 36 分钟')
    expect(formatHoursSince(0.5)).toBe('30 分钟')
    expect(formatHoursSince(26)).toBe('1 天 2 小时')
  })

  it('formats clip lengths', () => {
    expect(formatClipLength(42_000)).toBe('0:42')
    expect(formatClipLength(125_400)).toBe('2:05')
    expect(formatClipWords(65_000)).toBe('1 分 5 秒')
  })

  it('formats ages and money', () => {
    expect(formatAge('2019-05-02', now)).toBe('7 岁')
    expect(formatAge('2026-03-01', now)).toBe('6 个月')
    expect(formatMoney(8000)).toBe('80 元')
    expect(formatMoney(8050)).toBe('80.5 元')
  })
})
