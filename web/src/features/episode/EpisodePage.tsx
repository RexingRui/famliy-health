import { useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { useId, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import * as api from '../../api/endpoints'
import { invalidateAfterWrite, keys, useDiseaseTags, useEpisode, useEpisodeCalendar, useEpisodeTrend, useMember, useRecord, useRecordList } from '../../api/hooks'
import type { Episode, EpisodePatch, EpisodeStatus, Record, RecordType } from '../../api/types'
import { useIsDesktop } from '../../app/useIsDesktop'
import { CalendarLegend, CalendarMonth } from '../../components/calendar'
import { CheckIcon, MoreIcon, PlusIcon } from '../../components/icons'
import { ConfirmDialog, Sheet } from '../../components/Sheet'
import { toast, toastError } from '../../lib/toast'
import { LazyTrendChart as TrendChart } from '../../components/LazyTrendChart'
import { BottomBar, Button, Chip, ChipRow, ErrorState, FieldError, PageHeader, Segmented, Spinner, StatusBadge, TextInput } from '../../components/ui'
import { cx } from '../../lib/cx'
import { STATUS_LABEL, STATUSES_BY_KIND } from '../../lib/labels'
import { formatAge, formatDate, formatDateFull, formatTemperature, monthKey, toApiTime, weekday } from '../../lib/time/format'
import { RecordView } from '../record/RecordDetailPage'
import { Timeline } from '../record/RecordCard'

type View = 'timeline' | 'calendar' | 'trend'
const VIEWS: { value: View; label: string }[] = [
  { value: 'timeline', label: '时间线' },
  { value: 'calendar', label: '日历' },
  { value: 'trend', label: '趋势曲线' },
]

export function EpisodePage() {
  const { id = '' } = useParams()
  const episode = useEpisode(id)
  if (episode.isPending) return <Spinner />
  if (episode.isError) return <ErrorState error={episode.error} onRetry={() => void episode.refetch()} />
  return <EpisodeDetail episode={episode.data} />
}

/** “9月23日开始，今天第 2 天，共 8 条记录”. */
function summaryLine(e: Episode): string {
  if (e.kind === 'long') {
    return `${dayjs(e.startedOn).format('YYYY年M月')}开始${e.open ? '' : `，${e.endedOn ? `${formatDate(e.endedOn)}结束` : ''}`}，共 ${e.recordCount} 条记录`
  }
  if (e.open) return `${formatDate(e.startedOn)}开始，今天第 ${e.days} 天，共 ${e.recordCount} 条记录`
  return `${formatDate(e.startedOn)}到${e.endedOn ? formatDate(e.endedOn) : ''}，共 ${e.days} 天，${e.recordCount} 条记录`
}

function EpisodeDetail({ episode: e }: { episode: Episode }) {
  const isDesktop = useIsDesktop()
  const navigate = useNavigate()
  const member = useMember(e.memberId)
  const [params, setParams] = useSearchParams()
  const view = (VIEWS.some((v) => v.value === params.get('view')) ? params.get('view') : 'timeline') as View
  const [statusOpen, setStatusOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const qc = useQueryClient()

  const update = useMutation({
    mutationFn: (patch: EpisodePatch) => api.updateEpisode(e.id, patch),
    onSuccess: (updated) => {
      qc.setQueryData(keys.episode(e.id), updated)
      invalidateAfterWrite(qc)
      toast('已更新')
      setStatusOpen(false)
      setEditOpen(false)
    },
    onError: (err) => toastError(err),
  })
  const remove = useMutation({
    mutationFn: () => api.deleteEpisode(e.id),
    onSuccess: () => {
      invalidateAfterWrite(qc)
      toast('病程已删除，记录已退回待整理')
      navigate('/', { replace: true })
    },
    onError: (err) => toastError(err),
  })

  const repeat = isDesktop ? undefined : (r: Record) => navigate(`/record/new?copy=${r.id}&returnTo=${encodeURIComponent(`/episodes/${e.id}`)}`)
  const intro = member.data ? (e.kind === 'short' ? `${member.data.nickname}，${formatAge(member.data.birthDate)}` : `${member.data.nickname}，长期病程`) : ''

  const main = (
    <>
      <section className="flex flex-col gap-2 px-5 pb-4 lg:px-0">
        <Link to={`/members/${e.memberId}`} className="self-start text-sm text-ink-muted hover:text-primary">
          {intro}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className={cx('font-display leading-tight font-normal', e.name.length > 5 ? 'text-[34px]' : 'text-[38px]')}>
            {e.kind === 'short' ? e.diseaseName : e.name}
          </h1>
          <StatusBadge status={e.status} />
        </div>
        {e.kind === 'short' && e.name !== `${e.diseaseName} · ${dayjs(e.startedOn).format('YYYY-MM')}` && (
          <span className="-mt-1 text-[13px] text-ink-subtle">{e.name}</span>
        )}
        <p className="text-sm text-ink-muted">{summaryLine(e)}</p>
        {e.suggestRecovered && (
          <div role="status" className="mt-1 flex items-center gap-3 rounded-control bg-alert-soft px-4 py-3 text-sm text-alert">
            <span className="flex-1">已经 14 天没有新记录了，是否已康复？</span>
            <Button size="sm" variant="dark" className="bg-alert" onClick={() => update.mutate({ status: 'recovered' })}>
              已康复
            </Button>
          </div>
        )}
        <div className="mt-1.5 flex gap-2.5">
          <Button block variant="accent-outline" onClick={() => setStatusOpen(true)}>
            切换状态
          </Button>
          <Link
            to={`/export?type=episode&episodeId=${e.id}`}
            className="flex h-11 flex-1 items-center justify-center rounded-control border border-line bg-surface text-[15px]"
          >
            导出报告
          </Link>
        </div>
      </section>

      <Segmented
        label="视图"
        className="mx-4 mb-4 lg:mx-0"
        value={view}
        options={VIEWS}
        onChange={(v) =>
          setParams(
            (p) => {
              p.set('view', v)
              return p
            },
            { replace: true },
          )
        }
      />

      <div className="flex flex-col gap-4 px-4 pb-4 lg:px-0">
        {view === 'timeline' && (
          <EpisodeTimeline episode={e} onRepeat={repeat} onSelect={isDesktop ? (r) => setSelected(r.id) : undefined} selectedId={selected} />
        )}
        {view === 'calendar' && (
          <EpisodeCalendar episode={e} onRepeat={repeat} onSelect={isDesktop ? (r) => setSelected(r.id) : undefined} selectedId={selected} />
        )}
        {view === 'trend' && <EpisodeTrend episode={e} />}
      </div>
    </>
  )

  const sheets = (
    <>
      {statusOpen && <StatusSheet episode={e} busy={update.isPending} onClose={() => setStatusOpen(false)} onSubmit={(p) => update.mutate(p)} />}
      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="病程操作">
        <div className="flex flex-col gap-2 pb-2">
          <Button
            block
            size="lg"
            onClick={() => {
              setMenuOpen(false)
              setEditOpen(true)
            }}
          >
            编辑病程信息
          </Button>
          <Button
            block
            size="lg"
            variant="danger"
            onClick={() => {
              setMenuOpen(false)
              setDeleteOpen(true)
            }}
          >
            删除病程
          </Button>
        </div>
      </Sheet>
      {editOpen && <EditEpisodeSheet episode={e} busy={update.isPending} onClose={() => setEditOpen(false)} onSubmit={(p) => update.mutate(p)} />}
      <ConfirmDialog
        open={deleteOpen}
        title={`删除“${e.name}”？`}
        message="病程删除后，其中的记录不会删除，会退回待整理。"
        confirmLabel="删除病程"
        danger
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onClose={() => setDeleteOpen(false)}
      />
    </>
  )

  const moreButton = (
    <button type="button" aria-label="更多操作" onClick={() => setMenuOpen(true)} className="flex size-11 items-center justify-center">
      <MoreIcon />
    </button>
  )

  if (isDesktop) {
    return (
      <div className="flex gap-8">
        <div className="flex min-w-0 flex-1 flex-col lg:max-w-[640px]">
          <PageHeader back={`/members/${e.memberId}`} backLabel={member.data?.nickname ?? '返回'} right={moreButton} />
          {main}
        </div>
        <aside aria-label="记录详情" className="sticky top-8 hidden max-h-[calc(100dvh-4rem)] w-[400px] shrink-0 overflow-y-auto rounded-[20px] bg-surface/60 p-5 lg:block">
          <SelectedRecord id={selected} />
        </aside>
        {sheets}
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader back={-1} right={moreButton} />
      {main}
      <BottomBar>
        <Link
          to={`/record/new?memberId=${e.memberId}&episodeId=${e.id}`}
          className="flex h-[52px] flex-1 items-center justify-center gap-2 rounded-[14px] bg-primary text-base font-bold text-white"
        >
          <PlusIcon size={20} strokeWidth={2.2} />
          在这个病程里记一笔
        </Link>
      </BottomBar>
      {sheets}
    </div>
  )
}

function SelectedRecord({ id }: { id: string | null }) {
  const record = useRecord(id ?? undefined)
  if (!id) return <p className="py-16 text-center text-sm text-ink-muted">点左侧的记录，在这里查看详情和大图</p>
  if (record.isPending) return <Spinner />
  if (record.isError) return <ErrorState error={record.error} />
  return <RecordView record={record.data} embedded />
}

const LONG_FILTERS: { value: string; label: string; types?: RecordType[]; flare?: boolean }[] = [
  { value: 'all', label: '全部' },
  { value: 'symptom', label: '症状', types: ['symptom'] },
  { value: 'medication', label: '用药', types: ['medication'] },
  { value: 'visit', label: '就诊', types: ['visit'] },
  { value: 'treatment', label: '治疗康复', types: ['treatment'] },
  { value: 'flare', label: '发作', flare: true },
]

function EpisodeTimeline({
  episode: e,
  onRepeat,
  onSelect,
  selectedId,
}: {
  episode: Episode
  onRepeat?: (r: Record) => void
  onSelect?: (r: Record) => void
  selectedId: string | null
}) {
  const [filter, setFilter] = useState('all')
  const f = LONG_FILTERS.find((x) => x.value === filter)!
  const list = useRecordList({ episodeId: e.id, type: f.types, flare: f.flare })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  // Long episodes span months: headings carry the month once per group.
  const heading = e.kind === 'long' ? (day: string) => `${dayjs(day).format('YYYY年M月D日')} ${weekday(day)}` : undefined

  return (
    <>
      {e.kind === 'long' && (
        <ChipRow label="按类型筛选">
          {LONG_FILTERS.map((x) => (
            <Chip key={x.value} selected={filter === x.value} onClick={() => setFilter(x.value)} className="h-9 rounded-full px-3.5">
              {x.label}
            </Chip>
          ))}
        </ChipRow>
      )}
      {list.isPending ? (
        <Spinner />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <Timeline
          records={items}
          onRepeat={onRepeat}
          onSelect={onSelect}
          selectedId={selectedId}
          emptyText={filter === 'all' ? '这个病程还没有记录' : `没有${f.label}记录`}
          {...(heading ? { heading } : {})}
        />
      )}
      {list.hasNextPage && (
        <Button onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage} className="self-center">
          {list.isFetchingNextPage ? '加载中…' : '加载更早的记录'}
        </Button>
      )}
    </>
  )
}

function EpisodeCalendar({
  episode: e,
  onRepeat,
  onSelect,
  selectedId,
}: {
  episode: Episode
  onRepeat?: (r: Record) => void
  onSelect?: (r: Record) => void
  selectedId: string | null
}) {
  const [month, setMonth] = useState(() => monthKey(e.lastRecordAt ?? e.endedOn ?? new Date()))
  const [picked, setDay] = useState<string | null>(null)
  const cal = useEpisodeCalendar(e.id, month)

  // Until a day is picked: the latest day with records in the shown month.
  const day =
    picked && picked.startsWith(month) ? picked : cal.data && !cal.isPlaceholderData ? (cal.data.days[cal.data.days.length - 1]?.date ?? null) : null

  return (
    <>
      <CalendarMonth month={month} days={cal.data?.days ?? []} selected={day} onSelect={setDay} onMonthChange={(m) => {
        setMonth(m)
        setDay(null)
      }} />
      <CalendarLegend className="px-1" />
      {day && <DayRecords scope={{ episodeId: e.id }} day={day} onRepeat={onRepeat} onSelect={onSelect} selectedId={selectedId} />}
    </>
  )
}

/** Records of one day, under a “9月24日 周四，2 条记录” heading. */
export function DayRecords({
  scope,
  day,
  onRepeat,
  onSelect,
  selectedId,
}: {
  scope: { episodeId?: string; memberId?: string }
  day: string
  onRepeat?: (r: Record) => void
  onSelect?: (r: Record) => void
  selectedId?: string | null
}) {
  const list = useRecordList({ ...scope, from: toApiTime(dayjs(day).startOf('day')), to: toApiTime(dayjs(day).add(1, 'day').startOf('day')), limit: 200 })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  if (list.isPending) return <Spinner />
  if (list.isError) return <ErrorState error={list.error} />
  return (
    <Timeline
      records={items}
      onRepeat={onRepeat}
      onSelect={onSelect}
      selectedId={selectedId}
      emptyText={`${formatDate(day)}没有记录`}
      heading={(d) => `${formatDate(d)} ${weekday(d)}，${items.length} 条记录`}
    />
  )
}

function EpisodeTrend({ episode: e }: { episode: Episode }) {
  const trend = useEpisodeTrend(e.id)
  if (trend.isPending) return <Spinner />
  if (trend.isError) return <ErrorState error={trend.error} onRetry={() => void trend.refetch()} />
  const t = trend.data
  if (t.temperature.length === 0 && t.severity.length === 0) {
    return (
      <p className="rounded-card bg-surface px-4 py-8 text-center text-sm leading-relaxed text-ink-muted">
        还没有体温或症状程度记录。记一笔时选“体温”或“症状”并填上数值，这里就会画出曲线。
      </p>
    )
  }
  const temps = t.temperature.map((p) => p.value)
  const sev = t.severity.map((p) => p.value)
  return (
    <>
      <section className="rounded-card bg-surface p-4">
        <TrendChart trend={t} />
      </section>
      <dl className="grid grid-cols-2 gap-3">
        {temps.length > 0 && (
          <>
            <Stat label="最高体温" value={formatTemperature(Math.max(...temps))} />
            <Stat label="最近体温" value={formatTemperature(temps[temps.length - 1])} />
          </>
        )}
        {sev.length > 0 && (
          <>
            <Stat label="最高症状程度" value={`${Math.max(...sev)} / 10`} />
            <Stat label="最近症状程度" value={`${sev[sev.length - 1]} / 10`} />
          </>
        )}
      </dl>
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-card bg-surface px-4 py-3">
      <dt className="text-[13px] text-ink-muted">{label}</dt>
      <dd className="text-xl font-bold">{value}</dd>
    </div>
  )
}

function StatusSheet({
  episode: e,
  busy,
  onClose,
  onSubmit,
}: {
  episode: Episode
  busy: boolean
  onClose: () => void
  onSubmit: (p: EpisodePatch) => void
}) {
  const [status, setStatus] = useState<EpisodeStatus>(e.status)
  const [toLong, setToLong] = useState(false)
  const options = toLong ? STATUSES_BY_KIND.long : STATUSES_BY_KIND[e.kind]
  const hint: { [K in EpisodeStatus]: string } = {
    active: '还在生病',
    recovered: '已经好了，病程结束',
    treating: '发作或加重，正在治疗',
    stable: '症状稳定，定期观察',
    ended: '不再需要跟踪',
  }
  return (
    <Sheet
      open
      onClose={onClose}
      title="切换状态"
      footer={
        <Button
          block
          size="lg"
          variant="primary"
          disabled={busy || (!toLong && status === e.status)}
          onClick={() => onSubmit(toLong ? { kind: 'long', status } : { status })}
        >
          {busy ? '保存中…' : '确定'}
        </Button>
      }
    >
      <div role="radiogroup" aria-label="状态" className="flex flex-col gap-2">
        {options.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={status === s}
            onClick={() => setStatus(s)}
            className={cx(
              'flex min-h-[56px] items-center gap-3 rounded-control border px-4 text-left',
              status === s ? 'border-[1.5px] border-primary bg-primary-soft' : 'border-line',
            )}
          >
            <span className="flex flex-1 flex-col">
              <span className="text-[15px] font-medium">{STATUS_LABEL[s]}</span>
              <span className="text-xs text-ink-muted">{hint[s]}</span>
            </span>
            {status === s && <CheckIcon size={18} className="text-primary" />}
          </button>
        ))}
        {e.kind === 'short' && (
          <label className="mt-2 flex items-start gap-3 rounded-control bg-page p-3 text-sm leading-relaxed">
            <input
              type="checkbox"
              checked={toLong}
              onChange={(ev) => {
                setToLong(ev.target.checked)
                setStatus(ev.target.checked ? (e.status === 'recovered' ? 'stable' : 'treating') : e.status)
              }}
              className="mt-1 size-[18px] accent-primary"
            />
            <span>
              确诊为慢性病，转为长期病程
              <span className="block text-xs text-ink-muted">比如反复喘息后确诊为哮喘。原有记录全部保留，转换后不能改回短期。</span>
            </span>
          </label>
        )}
      </div>
    </Sheet>
  )
}

function EditEpisodeSheet({
  episode: e,
  busy,
  onClose,
  onSubmit,
}: {
  episode: Episode
  busy: boolean
  onClose: () => void
  onSubmit: (p: EpisodePatch) => void
}) {
  const id = useId()
  const tags = useDiseaseTags()
  const [disease, setDisease] = useState(e.diseaseName)
  const [name, setName] = useState(e.name)
  const [startedOn, setStartedOn] = useState(e.startedOn)
  const [endedOn, setEndedOn] = useState(e.endedOn ?? '')
  const [error, setError] = useState('')

  function submit() {
    if (!disease.trim()) return setError('请填写病种')
    if (!name.trim()) return setError('请填写病程名称')
    if (!e.open && endedOn && endedOn < startedOn) return setError('结束日期不能早于开始日期')
    const p: EpisodePatch = {}
    if (disease.trim() !== e.diseaseName) p.diseaseName = disease.trim()
    if (name.trim() !== e.name) p.name = name.trim()
    if (startedOn !== e.startedOn) p.startedOn = startedOn
    if (!e.open && endedOn && endedOn !== e.endedOn) p.endedOn = endedOn
    if (Object.keys(p).length === 0) return onClose()
    onSubmit(p)
  }

  const today = dayjs().format('YYYY-MM-DD')
  return (
    <Sheet
      open
      onClose={onClose}
      title="编辑病程"
      footer={
        <Button block size="lg" variant="primary" disabled={busy} onClick={submit}>
          {busy ? '保存中…' : '保存'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-d`} className="text-[13px] text-ink-muted">
            病种（确诊后可以在这里改，比如“发烧”改成“支原体肺炎”）
          </label>
          <TextInput id={`${id}-d`} list={`${id}-tags`} value={disease} maxLength={30} onChange={(ev) => setDisease(ev.target.value)} />
          <datalist id={`${id}-tags`}>
            {tags.data?.map((t) => (
              <option key={t.id} value={t.name} />
            ))}
          </datalist>
          <span className="text-xs text-ink-muted">名称还是默认名时，会跟着病种一起改。</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-n`} className="text-[13px] text-ink-muted">
            病程名称
          </label>
          <TextInput id={`${id}-n`} value={name} maxLength={50} onChange={(ev) => setName(ev.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-s`} className="text-[13px] text-ink-muted">
              开始日期
            </label>
            <TextInput id={`${id}-s`} type="date" max={today} value={startedOn} onChange={(ev) => setStartedOn(ev.target.value)} />
          </div>
          {!e.open && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-e`} className="text-[13px] text-ink-muted">
                结束日期
              </label>
              <TextInput id={`${id}-e`} type="date" max={today} value={endedOn} onChange={(ev) => setEndedOn(ev.target.value)} />
            </div>
          )}
        </div>
        <p className="text-xs text-ink-muted">
          {e.kind === 'short' ? '短期病程' : '长期病程'}，{formatDateFull(e.startedOn)}开始。短期转长期请用“切换状态”。
        </p>
        <FieldError>{error}</FieldError>
      </div>
    </Sheet>
  )
}
