import { Link } from 'react-router'
import { useMembers } from '../../api/hooks'
import { cx } from '../../lib/cx'

/**
 * “已归档：奶奶、外公”. Archived members drop out of the home page and the sidebar, so this line is
 * the way back to their pages (and to 取消归档). Renders nothing when nobody is archived.
 */
export function ArchivedMembers({ className }: { className?: string }) {
  const members = useMembers(true)
  const archived = members.data?.filter((m) => m.archived) ?? []
  if (archived.length === 0) return null
  return (
    <p className={cx('flex flex-wrap items-center gap-x-1 text-[13px] text-ink-muted', className)}>
      <span>已归档：</span>
      {archived.map((m, i) => (
        <span key={m.id}>
          <Link to={`/members/${m.id}`} className="text-primary">
            {m.nickname}
          </Link>
          {i < archived.length - 1 && '、'}
        </span>
      ))}
    </p>
  )
}
