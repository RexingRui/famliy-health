import { Navigate } from 'react-router'
import { useMembers } from '../../api/hooks'
import { ErrorState, Spinner } from '../../components/ui'

/**
 * No separate member list: on the phone the list is the home page's avatar row, on desktop
 * the sidebar. The 成员 tab opens the first member's page (or 添加成员 when there is none).
 */
export function MemberListPage() {
  const members = useMembers()
  if (members.isPending) return <Spinner />
  if (members.isError) return <ErrorState error={members.error} onRetry={() => void members.refetch()} />
  const first = members.data[0]
  return <Navigate to={first ? `/members/${first.id}` : '/members/new'} replace />
}
