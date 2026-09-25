import dayjs from 'dayjs'
import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useByDisease, useMember, useMemberCalendar, useRecordList } from '../../api/hooks'
import type { ByDiseaseRange, DiseaseSummary, Member, Record, RecordType } from '../../api/types'
import { useIsDesktop } from '../../app/useIsDesktop'
import { Avatar } from '../../components/Avatar'
import { CalendarLegend, CalendarMonth } from '../../components/calendar'
import { CloseIcon, SearchIcon } from '../../components/icons'
import { Button, Chip, ChipRow, ErrorState, PageHeader, Segmented, Spinner, StatusBadge } from '../../components/ui'
import { cx } from '../../lib/cx'
import { BLOOD_LABEL, GENDER_LABEL, RECORD_TYPE_LABEL } from '../../lib/labels'
import { formatAge, formatDate, formatDateFull, formatTemperature, monthKey } from '../../lib/time/format'
import { DayRecords } from '../episode/EpisodePage'
import { diseaseSentence, RANGE_LABEL } from './diseaseSentence'
import { Timeline } from '../record/RecordCard'

type View = 'timeline' | 'calendar' | 'disease'
const VIEWS: { value: View; label: string }[] = [
  { value: 'timeline', label: '时间线' },
  { value: 'calendar', label: '日历' },
  { value: 'disease', label: '按病种' },
]


export function MemberPage() {
  const { id = '' } = useParams()
  const member = useMember(id)
  if (member.isPending) return <Spinner />
  if (member.isError) return <ErrorState error={member.error} onRetry={() => void member.refetch()} />
  return <MemberDetail member={member.data} />
}

function MemberDetail({ member: m }: { member: Member }) {
  const isDesktop = useIsDesktop()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const view = (VIEWS.some((v) => v.value === params.get('view')) ? params.get('view') : isDesktop ? 'disease' : 'timeline') as View
  const setView = (v: View) =>
    setParams(
      (p) => {
        p.set('view', v)
        return p
      },
      { replace: true },
    )
  const repeat = isDesktop ? undefined : (r: Record) => navigate(`/record/new?copy=${r.id}&returnTo=${encodeURIComponent(`/members/${m.id}`)}`)

  return (
    <div className="flex flex-col pb-6">
      {!isDesktop && (
        <PageHeader
          back="/"
          backLabel="首页"
          right={
            <Link to={`/members/${m.id}/edit`} className="flex h-11 items-center px-3 text-[15px] text-primary">
              编辑
            </Link>
          }
        />
      )}
      <header className="flex flex-wrap items-center gap-4 px-5 pb-5 lg:px-0">
        <Avatar member={m} size={isDesktop ? 64 : 56} tone="primary" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h1 className="font-display text-[32px] leading-tight font-normal lg:text-4xl">
            {m.nickname}
            {m.archived && <span className="ml-2 align-middle font-sans text-sm text-ink-muted">（已归档）</span>}
          </h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-ink-muted">
            <span>
              {GENDER_LABEL[m.gender]}，{formatAge(m.birthDate)}，{formatDateFull(m.birthDate)}生
            </span>
            {m.allergies ? (
              <span className="rounded-lg bg-alert-soft px-2.5 py-0.5 font-medium text-alert">过敏：{m.allergies}</span>
            ) : (
              <span>无已知过敏</span>
            )}
            {m.bloodType && m.bloodType !== 'unknown' && <span>血型 {BLOOD_LABEL[m.bloodType]}</span>}
          </div>
          {m.notes && <p className="text-[13px] text-ink-muted">备注：{m.notes}</p>}
        </div>
        <Link
          to={`/export?type=member&memberId=${m.id}`}
          className="flex h-11 items-center rounded-control border border-line bg-surface px-4 text-[15px] max-lg:w-full max-lg:justify-center"
        >
          导出健康档案
        </Link>
      </header>

      {m.longEpisodes.length > 0 && (
        <section aria-label="长期病程" className="mb-4 flex flex-wrap gap-2 px-4 lg:px-0">
          {m.longEpisodes.map((e) => (
            <Link key={e.id} to={`/episodes/${e.id}`} className="flex h-11 items-center gap-2 rounded-control bg-surface px-3.5 text-[15px] text-ink">
              <span className="text-xs text-ink-muted">长期</span>
              {e.name}
              <StatusBadge status={e.status} className="py-0.5 text-xs" />
            </Link>
          ))}
        </section>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3 px-4 lg:px-0">
        <Segmented label="视图" className="min-w-[300px] flex-1 lg:max-w-[420px] lg:flex-none" value={view} options={VIEWS} onChange={setView} />
        {view === 'disease' && <RangeSelect />}
      </div>

      <div className="flex flex-col gap-4 px-4 lg:px-0">
        {view === 'timeline' && <MemberTimeline member={m} onRepeat={repeat} />}
        {view === 'calendar' && <MemberCalendar member={m} onRepeat={repeat} />}
        {view === 'disease' && <ByDiseaseView member={m} />}
      </div>
    </div>
  )
}

function RangeSelect() {
  const [params, setParams] = useSearchParams()
  const range = (params.get('range') ?? '1y') as ByDiseaseRange
  return (
    <label className="flex items-center gap-2 text-sm text-ink-muted">
      时间段
      <select
        value={range}
        onChange={(e) =>
          setParams(
            (p) => {
              p.set('range', e.target.value)
              return p
            },
            { replace: true },
          )
        }
        className="h-11 rounded-control border border-line bg-surface px-3 text-[15px] text-ink"
      >
        {(Object.keys(RANGE_LABEL) as ByDiseaseRange[]).map((r) => (
          <option key={r} value={r}>
            {RANGE_LABEL[r]}
          </option>
        ))}
      </select>
    </label>
  )
}

const TYPE_FILTERS: (RecordType | 'all')[] = ['all', 'symptom', 'temperature', 'medication', 'visit', 'treatment', 'exam', 'other']

function MemberTimeline({ member: m, onRepeat }: { member: Member; onRepeat?: (r: Record) => void }) {
  const [type, setType] = useState<RecordType | 'all'>('all')
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const list = useRecordList({ memberId: m.id, type: type === 'all' ? undefined : [type], q: search || undefined })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []

  return (
    <>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          setSearch(q.trim())
        }}
        className="flex h-11 items-center gap-2 rounded-control border border-line bg-surface px-3 focus-within:border-primary lg:max-w-md"
      >
        <SearchIcon size={18} className="text-ink-muted" />
        <input
          type="search"
          aria-label={`搜索${m.nickname}的记录`}
          placeholder="搜索文字、药名、医院"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            if (!e.target.value) setSearch('')
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-subtle [&::-webkit-search-cancel-button]:hidden"
        />
        {q && (
          <button
            type="button"
            aria-label="清除搜索"
            onClick={() => {
              setQ('')
              setSearch('')
            }}
            className="text-ink-muted"
          >
            <CloseIcon size={16} />
          </button>
        )}
      </form>
      <ChipRow label="按类型筛选">
        {TYPE_FILTERS.map((t) => (
          <Chip key={t} selected={type === t} onClick={() => setType(t)} className="h-9 rounded-full px-3.5">
            {t === 'all' ? '全部' : RECORD_TYPE_LABEL[t]}
          </Chip>
        ))}
      </ChipRow>
      {list.isPending ? (
        <Spinner />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <div className="lg:max-w-[640px]">
          <Timeline records={items} onRepeat={onRepeat} emptyText={search ? '没有找到相关记录' : '还没有记录'} />
        </div>
      )}
      {list.hasNextPage && (
        <Button onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage} className="self-center">
          {list.isFetchingNextPage ? '加载中…' : '加载更早的记录'}
        </Button>
      )}
    </>
  )
}

function MemberCalendar({ member: m, onRepeat }: { member: Member; onRepeat?: (r: Record) => void }) {
  const [month, setMonth] = useState(() => monthKey(new Date()))
  const [picked, setDay] = useState<string | null>(null)
  const cal = useMemberCalendar(m.id, month)

  // Until a day is picked: the latest day with records in the shown month.
  const day =
    picked && picked.startsWith(month) ? picked : cal.data && !cal.isPlaceholderData ? (cal.data.days[cal.data.days.length - 1]?.date ?? null) : null

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:items-start lg:gap-8">
      <div className="flex flex-col gap-3">
        <CalendarMonth
          month={month}
          days={cal.data?.days ?? []}
          selected={day}
          onSelect={setDay}
          onMonthChange={(mo) => {
            setMonth(mo)
            setDay(null)
          }}
        />
        <CalendarLegend className="px-1" />
      </div>
      {day ? <DayRecords scope={{ memberId: m.id }} day={day} onRepeat={onRepeat} /> : <p className="text-sm text-ink-muted">这个月没有记录</p>}
    </div>
  )
}

function ByDiseaseView({ member: m }: { member: Member }) {
  const [params] = useSearchParams()
  const range = (params.get('range') ?? '1y') as ByDiseaseRange
  const data = useByDisease(m.id, range)
  const [selected, setSelected] = useState<string | null>(null)

  if (data.isPending) return <Spinner />
  if (data.isError) return <ErrorState error={data.error} onRetry={() => void data.refetch()} />
  const diseases = data.data.diseases
  if (diseases.length === 0) {
    return <p className="rounded-card bg-surface px-4 py-8 text-center text-sm text-ink-muted">{RANGE_LABEL[range]}没有病程</p>
  }
  const current = diseases.find((d) => d.diseaseTagId === selected) ?? diseases[0]
  const total = diseases.reduce((s, d) => s + d.episodeCount, 0)

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start lg:gap-6">
      <nav aria-label="病种" className="flex flex-col gap-2">
        <span className="px-1 text-[13px] text-ink-muted">
          {RANGE_LABEL[range]} {total} 个病程
        </span>
        {diseases.map((d) => {
          const latest = d.episodes[0]?.episode
          const isSel = d.diseaseTagId === current.diseaseTagId
          return (
            <button
              key={d.diseaseTagId}
              type="button"
              aria-pressed={isSel}
              onClick={() => setSelected(d.diseaseTagId)}
              className={cx(
                'flex items-center gap-3 rounded-[14px] px-4 py-3 text-left',
                isSel ? 'border-2 border-primary bg-surface' : 'border border-transparent bg-surface',
              )}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-base font-bold">{d.diseaseName}</span>
                {latest && (
                  <span className="truncate text-xs text-ink-muted">
                    最近：{latest.open ? `${formatDate(latest.startedOn)}起，进行中` : dayjs(latest.startedOn).format('YYYY年M月')}
                  </span>
                )}
              </span>
              <span className="text-2xl font-bold">
                {d.episodeCount}
                <span className="text-xs font-normal text-ink-muted"> 次</span>
              </span>
            </button>
          )
        })}
      </nav>
      <DiseaseDetail summary={current} range={range} />
    </div>
  )
}

function DiseaseDetail({ summary: d, range }: { summary: DiseaseSummary; range: ByDiseaseRange }) {
  const isDesktop = useIsDesktop()
  const episodes = d.episodes
  return (
    <section aria-label={d.diseaseName} className="flex flex-col gap-5 rounded-[20px] bg-surface p-5">
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-[28px] leading-tight font-normal">{d.diseaseName}</h2>
        <p className="text-[15px] leading-relaxed text-ink-muted">{diseaseSentence(d, range)}</p>
      </div>

      <MonthStrip summary={d} range={range} />

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-bold">每一次的经过</h3>
        {isDesktop ? (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-[13px] text-ink-muted">
                {['开始日期', '持续（天）', '最高体温（°C）', '用过的药', '就诊（次）', '状态', ''].map((h) => (
                  <th key={h} className="border-b border-line px-2 py-2 font-medium">
                    {h || <span className="sr-only">操作</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {episodes.map(({ episode: e, maxTemperature, medications, visitCount }) => (
                <tr key={e.id} className="border-b border-line-soft last:border-0">
                  <td className="px-2 py-2.5 tabular-nums">{e.startedOn}</td>
                  <td className="px-2 py-2.5">{e.open ? `${e.days}，进行中` : e.days}</td>
                  <td className="px-2 py-2.5">{maxTemperature !== null ? maxTemperature.toFixed(1) : '—'}</td>
                  <td className="px-2 py-2.5">{medications.join('、') || '—'}</td>
                  <td className="px-2 py-2.5">{visitCount}</td>
                  <td className="px-2 py-2.5">
                    <StatusBadge status={e.status} className="py-0.5 text-xs" />
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <Link to={`/episodes/${e.id}`} className="font-medium text-primary">
                      查看
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <ul className="flex flex-col gap-2">
            {episodes.map(({ episode: e, maxTemperature, medications, visitCount }) => (
              <li key={e.id}>
                <Link to={`/episodes/${e.id}`} className="flex flex-col gap-1 rounded-[14px] bg-page px-4 py-3 text-ink">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">{formatDateFull(e.startedOn)}</span>
                    <StatusBadge status={e.status} className="py-0.5 text-xs" />
                  </span>
                  <span className="text-[13px] text-ink-muted">
                    {e.open ? `第 ${e.days} 天` : `持续 ${e.days} 天`}
                    {maxTemperature !== null && `，最高 ${formatTemperature(maxTemperature)}`}
                    {visitCount > 0 && `，就诊 ${visitCount} 次`}
                  </span>
                  {medications.length > 0 && <span className="text-[13px]">用药：{medications.join('、')}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

/** “什么时候生的病”: one bar per episode on a month axis. */
function MonthStrip({ summary: d, range }: { summary: DiseaseSummary; range: ByDiseaseRange }) {
  const end = dayjs().endOf('month')
  const earliest = d.episodes.reduce((min, x) => (x.episode.startedOn < min ? x.episode.startedOn : min), dayjs().format('YYYY-MM-DD'))
  const months = range === '1y' ? 12 : range === '3y' ? 36 : Math.max(12, end.diff(dayjs(earliest), 'month') + 1)
  const start = end.subtract(months - 1, 'month').startOf('month')
  const span = end.diff(start, 'day') + 1
  const step = months <= 12 ? 1 : months <= 36 ? 3 : 6
  // The first label carries the year and is wider; skip the one right after it.
  const labels = Array.from({ length: months }, (_, i) => start.add(i, 'month')).filter((_, i) => i % step === 0 && !(step === 1 && i === 1))

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-bold">什么时候生的病</h3>
      <div className="relative h-9 rounded-[10px] bg-page" role="list" aria-label="病程分布">
        {d.episodes.map(({ episode: e }) => {
          const left = Math.max(0, dayjs(e.startedOn).diff(start, 'day')) / span
          const width = Math.max(e.days / span, 0.012)
          const label = `${formatDateFull(e.startedOn)}${e.open ? '起，进行中' : `，${e.days} 天`}`
          return (
            <span
              key={e.id}
              role="listitem"
              aria-label={label}
              title={label}
              className={cx('absolute top-2 h-5 rounded-md', e.open ? 'bg-alert' : 'bg-primary')}
              style={{ left: `${left * 100}%`, width: `${Math.min(width, 1 - left) * 100}%` }}
            />
          )
        })}
      </div>
      <div className="relative h-4 text-[11px] text-ink-muted">
        {labels.map((mo) => (
          <span key={mo.format('YYYY-MM')} className="absolute -translate-x-0" style={{ left: `${(mo.diff(start, 'day') / span) * 100}%` }}>
            {mo.month() === 0 || mo.isSame(start, 'month') ? mo.format('YYYY年M月') : `${mo.month() + 1}月`}
          </span>
        ))}
      </div>
    </div>
  )
}
