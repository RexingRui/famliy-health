import { describe, expect, it } from 'vitest'
import { avatarChar } from './avatar'
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
