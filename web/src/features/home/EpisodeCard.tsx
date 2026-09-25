import { Link } from 'react-router'
import { useEpisodeTrend } from '../../api/hooks'
import type { EpisodeSummary, Member, Record } from '../../api/types'
import { WeekStrip } from '../../components/calendar'
import { weekSummary } from '../../lib/calendar'
import { Sparkline } from '../../components/charts'
import { StatusBadge } from '../../components/ui'
import { cx } from '../../lib/cx'
import { formatDose } from '../../lib/record'
import { formatDate, formatRecordTime, formatTemperature } from '../../lib/time/format'

function TemperatureStrip({ summary }: { summary: EpisodeSummary }) {
  const trend = useEpisodeTrend(summary.episode.id)
  const latest = summary.latestTemperature
  if (!latest) return null
  const values = (trend.data?.temperature ?? []).slice(-5).map((p) => p.value)
  return (
    <div className="flex items-center gap-3 rounded-control bg-temperature-soft px-3 py-2">
      <span className="text-[13px] font-medium text-temperature">体温</span>
      <Sparkline values={values.length ? values : [latest.value]} />
      <span className="ml-auto flex flex-col items-end">
        <span className="text-base font-bold text-temperature">{formatTemperature(latest.value)}</span>
        <span className="text-[11px] text-temperature">{formatRecordTime(latest.occurredAt).replace(/^今天 /, '')}</span>
      </span>
    </div>
  )
}

/** Open-episode card on the home page and family overview (短期：第 N 天 + 体温 + 用药；长期：本周日历). */
export function EpisodeCard({
  summary,
  member,
  recent,
  showMember = true,
  className,
}: {
  summary: EpisodeSummary
  member: Member
  /** Member's recent records, used for “最近就诊” on quiet long-term episodes. */
  recent?: Record[]
  showMember?: boolean
  className?: string
}) {
  const e = summary.episode
  const med = summary.lastMedication
  const lastVisit = recent?.find((r) => r.episodeId === e.id && r.type === 'visit')

  return (
    <Link
      to={`/episodes/${e.id}`}
      className={cx('flex flex-col gap-3 rounded-card bg-surface p-4 text-ink', className)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[13px] text-ink-muted">
            {showMember ? `${member.nickname}，` : ''}
            {e.kind === 'short' ? (showMember ? '短期病程' : '短期病程，进行中') : '长期病程'}
          </span>
          <span className={cx('font-display leading-tight', e.kind === 'short' ? 'text-[28px]' : 'text-[26px]')}>
            {e.kind === 'short' ? e.diseaseName : e.name}
          </span>
        </div>
        {e.kind === 'short' ? (
          <div className="flex shrink-0 items-baseline gap-1 text-alert">
            <span className="text-sm">第</span>
            <span className="text-[40px] leading-none font-bold">{e.days}</span>
            <span className="text-sm">天</span>
          </div>
        ) : (
          <StatusBadge status={e.status} />
        )}
      </div>

      {e.kind === 'short' ? (
        <>
          <TemperatureStrip summary={summary} />
          {med && (
            <div className="flex items-center justify-between gap-3 text-[13px]">
              <span className="font-medium text-medication">上次用药</span>
              <span className="truncate">
                {formatDose(med.medName, med.medDose, med.medUnit)}，{formatRecordTime(med.occurredAt)}
              </span>
            </div>
          )}
          {!summary.latestTemperature && !med && <span className="text-[13px] text-ink-muted">共 {e.recordCount} 条记录</span>}
        </>
      ) : summary.week.length > 0 || e.status === 'treating' ? (
        <>
          <WeekStrip days={summary.week} />
          <div className="text-[13px] text-ink-muted">{weekSummary(summary.week)}</div>
        </>
      ) : (
        <div className="flex flex-col gap-1.5 text-[13px]">
          <div className="flex justify-between gap-3">
            <span className="text-ink-muted">最近就诊</span>
            <span>{lastVisit ? `${formatDate(lastVisit.occurredAt)}，${lastVisit.details.hospital ?? '就诊'}` : '暂无'}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-ink-muted">最近记录</span>
            <span>{e.lastRecordAt ? formatRecordTime(e.lastRecordAt) : '暂无'}</span>
          </div>
        </div>
      )}
    </Link>
  )
}
