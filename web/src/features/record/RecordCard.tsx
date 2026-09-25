import dayjs from 'dayjs'
import { Link } from 'react-router'
import type { Record } from '../../api/types'
import { AudioPlayer } from '../../components/AudioPlayer'
import { SeverityBar } from '../../components/charts'
import { PhotoThumbs } from '../../components/Photos'
import { FlareTag, OutlineTag, TypeTag } from '../../components/ui'
import { cx } from '../../lib/cx'
import { audioOf, photosOf, recordHeadline, recordSubline } from '../../lib/record'
import { formatClock, formatDayHeading } from '../../lib/time/format'

export function AudioClips({ record, compact }: { record: Record; compact?: boolean }) {
  return (
    <>
      {audioOf(record).map((a) => (
        <div key={a.id} className="relative z-10 flex flex-col gap-1 self-start">
          {a.status === 'failed' ? (
            <span className="text-sm text-alert">语音处理失败，可在详情里重新处理</span>
          ) : (
            <AudioPlayer src={a.url} durationMs={a.durationMs} seed={a.id} compact={compact} />
          )}
          {a.caption && <span className="text-sm text-ink-muted">{a.caption}</span>}
        </div>
      ))}
    </>
  )
}

/**
 * One record in a timeline. The whole card opens the record (or selects it on desktop);
 * voice playback and 再记一次 sit above that link.
 */
export function RecordCard({
  record,
  to,
  onSelect,
  selected,
  onRepeat,
  memberName,
}: {
  record: Record
  to?: string
  onSelect?: () => void
  selected?: boolean
  onRepeat?: (r: Record) => void
  memberName?: string
}) {
  const headline = recordHeadline(record)
  const sub = recordSubline(record)
  const photos = photosOf(record)
  const hasAudio = audioOf(record).length > 0
  const label = `${formatClock(record.occurredAt)} ${headline || record.body.slice(0, 20) || '记录'}`
  const tags = (
    <>
      {memberName && <span className="text-[13px] font-medium">{memberName}</span>}
      {record.type ? <TypeTag type={record.type} /> : <span className="text-xs text-ink-muted">未选类型</span>}
      {record.isFlare && <FlareTag />}
      {record.backfilled && <OutlineTag>补录</OutlineTag>}
    </>
  )
  const cover = onSelect ? (
    <button type="button" onClick={onSelect} aria-label={`查看 ${label}`} className="absolute inset-0 rounded-[14px]" />
  ) : (
    <Link to={to ?? `/records/${record.id}`} aria-label={`查看 ${label}`} className="absolute inset-0 rounded-[14px]" />
  )
  const shell = cx('relative flex min-w-0 flex-1 rounded-[14px] bg-surface', selected && 'ring-2 ring-primary')
  const bare = !hasAudio && photos.length === 0 && record.severity === null && !sub

  // 体温 37.8°C / 其他 已向学校请假 2 天: one line.
  const inlineText = headline && !record.body ? headline : !headline && record.body.length <= 24 ? record.body : null
  if (bare && record.type !== 'medication' && inlineText !== null) {
    return (
      <div className={cx(shell, 'min-h-[52px] items-center gap-2.5 px-3.5 py-2.5')}>
        {cover}
        {tags}
        <span className={record.type === 'temperature' ? 'text-lg font-bold text-temperature' : 'text-[15px]'}>{inlineText}</span>
      </div>
    )
  }

  // 用药: tag and dose on the left, 再记一次 on the right.
  if (bare && record.type === 'medication' && !record.body) {
    return (
      <div className={cx(shell, 'items-center gap-2.5 py-2.5 pr-2.5 pl-3.5')}>
        {cover}
        <div className="flex flex-1 flex-col items-start gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5">{tags}</div>
          <span className="text-base font-medium">{headline || '用药'}</span>
        </div>
        {onRepeat && record.medName && (
          <button
            type="button"
            onClick={() => onRepeat(record)}
            className="relative z-10 h-11 shrink-0 rounded-[10px] border border-line bg-surface px-3 text-sm font-medium text-medication"
          >
            再记一次
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={cx(shell, 'flex-col gap-2 px-3.5 py-3')}>
      {cover}
      <div className="flex flex-wrap items-center gap-1.5">{tags}</div>
      {headline && (
        <span className={record.type === 'temperature' ? 'text-lg font-bold text-temperature' : 'text-base font-medium'}>{headline}</span>
      )}
      {sub && <span className="text-[13px] text-ink-muted">{sub}</span>}
      {record.type === 'symptom' && record.severity !== null && <SeverityBar value={record.severity} />}
      <AudioClips record={record} />
      {record.body && <p className="text-[15px] leading-relaxed break-words whitespace-pre-wrap">{record.body}</p>}
      {photos.length > 0 && (
        <div className="relative z-10 self-start">
          <PhotoThumbs photos={photos} />
        </div>
      )}
      {record.type === 'medication' && onRepeat && record.medName && (
        <button
          type="button"
          onClick={() => onRepeat(record)}
          className="relative z-10 h-11 self-start rounded-[10px] border border-line bg-surface px-3 text-sm font-medium text-medication"
        >
          再记一次
        </button>
      )}
    </div>
  )
}

/** Records grouped by day, newest first: “今天，9月24日 周四” then time + card rows. */
export function Timeline({
  records,
  onRepeat,
  onSelect,
  selectedId,
  memberNames,
  emptyText = '还没有记录',
  heading = formatDayHeading,
}: {
  records: Record[]
  onRepeat?: (r: Record) => void
  onSelect?: (r: Record) => void
  selectedId?: string | null
  memberNames?: Map<string, string>
  emptyText?: string
  heading?: (day: string) => string
}) {
  if (records.length === 0) return <p className="rounded-card bg-surface px-4 py-8 text-center text-sm text-ink-muted">{emptyText}</p>
  const groups: { day: string; items: Record[] }[] = []
  for (const r of records) {
    const day = dayjs(r.occurredAt).format('YYYY-MM-DD')
    const last = groups[groups.length - 1]
    if (last?.day === day) last.items.push(r)
    else groups.push({ day, items: [r] })
  }
  return (
    <div className="flex flex-col gap-[18px]">
      {groups.map((g) => (
        <section key={g.day} className="flex flex-col gap-2">
          <h2 className="px-1 text-sm font-bold text-ink-muted">{heading(g.day)}</h2>
          <ol className="flex flex-col gap-2">
            {g.items.map((r) => (
              <li key={r.id} className="flex gap-2.5">
                <div className="w-[42px] shrink-0 pt-4 text-right text-[13px] text-ink-muted">{formatClock(r.occurredAt)}</div>
                <RecordCard
                  record={r}
                  onRepeat={onRepeat}
                  onSelect={onSelect ? () => onSelect(r) : undefined}
                  selected={selectedId === r.id}
                  memberName={memberNames?.get(r.memberId)}
                />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}
