import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { logout } from '../../api/endpoints'
import { useHome, useRecordList } from '../../api/hooks'
import type { Home, HomeMember } from '../../api/types'
import { useIsDesktop } from '../../app/useIsDesktop'
import { Avatar } from '../../components/Avatar'
import { toneForStatuses } from '../../lib/avatar'
import { CloseIcon, PlusIcon, SearchIcon } from '../../components/icons'
import { Button, EmptyState, ErrorState, Spinner, TypeTag } from '../../components/ui'
import { cx } from '../../lib/cx'
import { formatAge, formatRecordTime, formatToday } from '../../lib/time/format'
import { GENDER_LABEL, RELATION_LABEL, STATUS_LABEL } from '../../lib/labels'
import { recordSummary } from '../../lib/record'
import { PendingUploadsBanner } from '../record/PendingUploadsBanner'
import { Timeline } from '../record/RecordCard'
import { EpisodeCard } from './EpisodeCard'

/** One route, two layouts: the phone home page and the desktop family overview. */
export function HomePage() {
  const home = useHome()
  const isDesktop = useIsDesktop()
  if (home.isPending) return <Spinner />
  if (home.isError) return <ErrorState error={home.error} onRetry={() => void home.refetch()} />
  return isDesktop ? <Overview home={home.data} /> : <MobileHome home={home.data} />
}

/** “感冒第 2 天” / “腰椎间盘突出治疗中” / “暂无病程” under each avatar. */
function memberStatus(hm: HomeMember): { text: string; alert: boolean } {
  const first = hm.openEpisodes[0]?.episode
  if (!first) return { text: '暂无病程', alert: false }
  if (first.kind === 'short') return { text: `${first.diseaseName}第 ${first.days} 天`, alert: true }
  return { text: `${first.diseaseName}${STATUS_LABEL[first.status]}`, alert: false }
}

function MobileHome({ home }: { home: Home }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const signOut = useMutation({
    mutationFn: logout,
    onSettled: () => {
      qc.clear()
      navigate('/login', { replace: true })
    },
  })
  const cards = home.members
    .flatMap((hm) => hm.openEpisodes.map((s) => ({ s, hm })))
    .sort((a, b) => (b.s.episode.lastRecordAt ?? '').localeCompare(a.s.episode.lastRecordAt ?? ''))

  return (
    <div className="flex flex-col pb-6">
      <header className="flex items-center justify-between px-5 pt-6 pb-1">
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] text-ink-muted">{formatToday()}</span>
          <h1 className="font-display text-[30px] leading-tight font-normal">家里的病程</h1>
        </div>
        <Link
          to="/inbox"
          className="flex h-11 items-center gap-2 rounded-full border border-line bg-surface pr-2.5 pl-4 text-sm"
          aria-label={`待整理 ${home.inboxCount} 条`}
        >
          待整理
          {home.inboxCount > 0 && (
            <span className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-alert px-1.5 text-xs font-bold text-white">
              {home.inboxCount}
            </span>
          )}
        </Link>
      </header>

      <div className="px-4 pt-3">
        <PendingUploadsBanner />
      </div>

      {home.members.length === 0 ? (
        <div className="flex flex-col gap-4 px-4 pt-6">
          <EmptyState title="先添加第一位家人">
            <p className="text-sm leading-relaxed text-ink-muted">添加孩子、自己或父母，之后就可以给他们记录生病和康复的经过。</p>
            <Link to="/members/new" className="flex h-12 items-center rounded-[14px] bg-primary px-6 font-bold text-white">
              添加成员
            </Link>
          </EmptyState>
        </div>
      ) : (
        <>
          <nav aria-label="成员" className="flex gap-1 overflow-x-auto px-3 pt-3.5 pb-1 [scrollbar-width:none]">
            {home.members.map((hm) => {
              const st = memberStatus(hm)
              const statuses = hm.openEpisodes.map((s) => s.episode.status)
              return (
                <Link
                  key={hm.member.id}
                  to={`/members/${hm.member.id}`}
                  className="flex w-20 shrink-0 flex-col items-center gap-0.5 py-1.5 text-ink"
                >
                  <Avatar member={hm.member} tone={toneForStatuses(statuses)} ring={statuses.includes('active')} className="mb-1.5" />
                  <span className="max-w-full truncate text-sm font-medium">{hm.member.nickname}</span>
                  <span className={cx('max-w-full truncate text-xs', st.alert ? 'text-alert' : 'text-ink-muted')}>{st.text}</span>
                </Link>
              )
            })}
            <Link to="/members/new" className="flex w-20 shrink-0 flex-col items-center gap-0.5 py-1.5 text-ink-muted">
              <span className="mb-1.5 flex size-14 items-center justify-center rounded-full border-[1.5px] border-dashed border-ink-subtle">
                <PlusIcon size={22} />
              </span>
              <span className="text-sm">添加</span>
            </Link>
          </nav>

          <main className="flex flex-col gap-3 px-4 pt-3">
            <div className="flex items-baseline justify-between px-1">
              <h2 className="text-base font-bold">进行中的病程</h2>
              <span className="text-[13px] text-ink-muted">{cards.length} 个</span>
            </div>
            {cards.length === 0 && (
              <p className="rounded-card bg-surface px-4 py-8 text-center text-sm leading-relaxed text-ink-muted">
                目前没有进行中的病程。有人不舒服时，点下面的“记一笔”开始记录。
              </p>
            )}
            {cards.map(({ s, hm }) => (
              <EpisodeCard key={s.episode.id} summary={s} member={hm.member} recent={hm.recentRecords} />
            ))}
          </main>
        </>
      )}

      <button
        type="button"
        onClick={() => signOut.mutate()}
        className="mt-6 h-11 self-center px-4 text-[13px] text-ink-subtle"
      >
        退出登录
      </button>
    </div>
  )
}

function memberLine(hm: HomeMember): string {
  const m = hm.member
  const who = m.relation === 'self' ? RELATION_LABEL.self : GENDER_LABEL[m.gender]
  return `${who}，${formatAge(m.birthDate)}`
}

function Overview({ home }: { home: Home }) {
  const [q, setQ] = useState('')
  const [submitted, setSubmitted] = useState('')

  return (
    <div className="flex flex-col gap-7">
      <header className="flex items-end justify-between gap-6">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-ink-muted">{formatToday()}</span>
          <h1 className="font-display text-4xl leading-tight font-normal">家庭总览</h1>
        </div>
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault()
            setSubmitted(q.trim())
          }}
          className="flex h-11 w-[360px] items-center gap-2 rounded-control border border-line bg-surface px-3 focus-within:border-primary"
        >
          <SearchIcon size={18} className="text-ink-muted" />
          <input
            type="search"
            aria-label="搜索记录"
            placeholder="搜索记录、药名、医院"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              if (!e.target.value) setSubmitted('')
            }}
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-subtle [&::-webkit-search-cancel-button]:hidden"
          />
          {q && (
            <button
              type="button"
              aria-label="清除搜索"
              onClick={() => {
                setQ('')
                setSubmitted('')
              }}
              className="text-ink-muted"
            >
              <CloseIcon size={16} />
            </button>
          )}
        </form>
      </header>

      {submitted ? (
        <SearchResults q={submitted} home={home} />
      ) : home.members.length === 0 ? (
        <EmptyState title="还没有成员">
          <p className="text-sm text-ink-muted">成员在手机上添加：用手机打开本站，在首页点“添加”。</p>
        </EmptyState>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] items-start gap-5">
          {home.members.map((hm) => (
            <MemberColumn key={hm.member.id} hm={hm} />
          ))}
        </div>
      )}
    </div>
  )
}

function MemberColumn({ hm }: { hm: HomeMember }) {
  const m = hm.member
  const statuses = hm.openEpisodes.map((s) => s.episode.status)
  return (
    <section aria-label={m.nickname} className="flex flex-col gap-4 rounded-[20px] bg-surface p-5">
      <div className="flex items-center gap-3">
        <Avatar member={m} size={48} tone={toneForStatuses(statuses)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Link to={`/members/${m.id}`} className="truncate text-lg font-bold text-ink hover:text-primary">
            {m.nickname}
          </Link>
          <span className="text-[13px] text-ink-muted">{memberLine(hm)}</span>
        </div>
        {m.allergies ? (
          <span className="max-w-[45%] truncate rounded-lg bg-alert-soft px-2.5 py-1 text-[13px] font-medium text-alert">
            过敏：{m.allergies}
          </span>
        ) : (
          <span className="text-[13px] text-ink-muted">无已知过敏</span>
        )}
      </div>

      {hm.openEpisodes.map((s) => (
        <EpisodeCard key={s.episode.id} summary={s} member={m} recent={hm.recentRecords} showMember={false} className="border border-line-soft bg-page/40" />
      ))}
      {hm.openEpisodes.length === 0 && <p className="rounded-control bg-page px-4 py-3 text-sm text-ink-muted">目前身体都好，没有进行中的病程</p>}

      <div className="flex flex-col gap-1">
        <h2 className="pb-1 text-sm font-bold text-ink-muted">最近记录</h2>
        {hm.recentRecords.length === 0 && <p className="text-sm text-ink-muted">还没有记录</p>}
        {hm.recentRecords.map((r) => (
          <Link
            key={r.id}
            to={`/records/${r.id}`}
            className="grid grid-cols-[88px_auto_1fr] items-center gap-2 rounded-[10px] px-1 py-1.5 text-sm text-ink hover:bg-line-soft"
          >
            <span className="text-[13px] text-ink-muted">{formatRecordTime(r.occurredAt)}</span>
            {r.type ? <TypeTag type={r.type} /> : <span className="text-xs text-ink-muted">未分类</span>}
            <span className="truncate">{recordSummary(r, 14)}</span>
          </Link>
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-line-soft pt-3 text-sm">
        <span className="text-ink-muted">近一年 {hm.episodeCountLastYear} 个病程</span>
        <Link to={`/members/${m.id}`} className="font-medium text-primary">
          查看全部
        </Link>
      </div>
    </section>
  )
}

function SearchResults({ q, home }: { q: string; home: Home }) {
  const list = useRecordList({ q })
  const names = new Map(home.members.map((hm) => [hm.member.id, hm.member.nickname]))
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <section aria-label="搜索结果" className="flex max-w-3xl flex-col gap-4">
      <p className="text-sm text-ink-muted">
        “{q}”的搜索结果{list.data ? `，${items.length}${list.hasNextPage ? '+' : ''} 条` : ''}
      </p>
      {list.isPending ? (
        <Spinner />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <Timeline records={items} memberNames={names} emptyText="没有找到相关记录，换个词试试" />
      )}
      {list.hasNextPage && (
        <Button onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage} className="self-center">
          {list.isFetchingNextPage ? '加载中…' : '加载更多'}
        </Button>
      )}
    </section>
  )
}
