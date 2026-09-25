import type { Member } from '../api/types'
import { avatarChar, type AvatarTone } from '../lib/avatar'
import { cx } from '../lib/cx'

const TONE: { [K in AvatarTone]: string } = {
  alert: 'bg-alert-soft text-alert',
  primary: 'bg-primary-soft text-primary',
  neutral: 'bg-visit-soft text-ink-muted',
}

export function Avatar({
  member,
  size = 56,
  tone = 'neutral',
  ring,
  className,
}: {
  member: Pick<Member, 'nickname' | 'avatarUrl'>
  size?: number
  tone?: AvatarTone
  ring?: boolean
  className?: string
}) {
  const style = {
    width: size,
    height: size,
    fontSize: Math.round(size * 0.43),
    boxShadow: ring ? '0 0 0 2px var(--color-page), 0 0 0 4px var(--color-alert)' : undefined,
  }
  if (member.avatarUrl) {
    return (
      <img
        src={member.avatarUrl}
        alt=""
        style={style}
        className={cx('shrink-0 rounded-full bg-line object-cover', className)}
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      style={style}
      className={cx('flex shrink-0 items-center justify-center rounded-full font-display leading-none', TONE[tone], className)}
    >
      {avatarChar(member.nickname)}
    </span>
  )
}
