export type AvatarTone = 'alert' | 'primary' | 'neutral'

/** The character shown in an avatar: “小明” → 明, “老王” → 王, “奶奶” → 奶, “我” → 我. */
export function avatarChar(nickname: string): string {
  const chars = [...nickname.trim()]
  if (chars.length >= 2 && '小老阿大'.includes(chars[0])) return chars[1]
  return chars[0] ?? '?'
}

/** Tone from the member's current state: acute illness → alert, long-term care → primary. */
export function toneForStatuses(openStatuses: string[]): AvatarTone {
  if (openStatuses.includes('active')) return 'alert'
  return openStatuses.length > 0 ? 'primary' : 'neutral'
}
