import dayjs from 'dayjs'
import { useState } from 'react'
import { useParams } from 'react-router'
import type { PrintData, Record, Trend } from '../../api/types'
import { LazyTrendChart as TrendChart } from '../../components/LazyTrendChart'
import { RECORD_TYPE_COLOR, RECORD_TYPE_LABEL, STATUS_LABEL } from '../../lib/labels'
import { audioReportText, formatDose, photosOf, recordHeadline, recordSubline } from '../../lib/record'
import { formatMoney, formatTemperature } from '../../lib/time/format'
import { MemberBlock, PrintFooter, PrintHeader, PrintSection, PrintSheet, PrintState } from './printShared'
import { rangeText, usePrintQuery, usePrintReady, withToken, type Section } from './printData'

/** 病程报告. Rendered by Gotenberg for PDF, embedded in the export preview, and printed from the browser. */
export function PrintEpisodePage() {
  const { id = '' } = useParams()
  const { data, sections, token } = usePrintQuery('episode', id)
  if (data.isPending) return <PrintState>正在生成报告…</PrintState>
  if (data.isError) return <PrintState>{data.error.message}</PrintState>
  if (!data.data.episode) return <PrintState>病程不存在</PrintState>
  return <EpisodeReport d={data.data} sections={sections} token={token ?? data.data.token} />
}

const time = (iso: string) => dayjs(iso).format('M/D HH:mm')

function trendOf(records: Record[]): Trend {
  const pick = (type: Record['type'], value: (r: Record) => number | null) =>
    records.flatMap((r) => {
      const v = r.type === type ? value(r) : null
      return v === null ? [] : [{ recordId: r.id, occurredAt: r.occurredAt, value: v }]
    })
  return { temperature: pick('temperature', (r) => r.temperature), severity: pick('symptom', (r) => r.severity) }
}

function EpisodeReport({ d, sections, token }: { d: PrintData; sections: Set<Section>; token: string | null | undefined }) {
  const e = d.episode!
  const records = d.records
  const trend = trendOf(records)
  const hasTrend = sections.has('trend') && (trend.temperature.length > 0 || trend.severity.length > 0)
  const [chartDone, setChartDone] = useState(false)
  usePrintReady(!hasTrend || chartDone)

  const meds = records.filter((r) => r.type === 'medication')
  const care = records.filter((r) => r.type === 'visit' || r.type === 'treatment')
  const visits = records.filter((r) => r.type === 'visit').length
  const range = rangeText(d)
  const photos = d.photos
  const allPhotos = photos === 'appendix' ? records.flatMap((r) => photosOf(r).map((p) => ({ p, r }))) : []

  return (
    <PrintSheet>
      <PrintHeader kind={e.kind === 'long' && range ? '治疗报告' : '病程报告'} title={`${d.member.nickname}：${e.kind === 'short' ? e.diseaseName : e.name}`} generatedAt={d.generatedAt} />
      <MemberBlock member={d.member} at={e.startedOn} />

      <div className="avoid-break grid grid-cols-4 rounded border border-line">
        {[
          ['开始', e.startedOn],
          ['状态', e.open ? `${STATUS_LABEL[e.status]}，第 ${e.days} 天` : `${STATUS_LABEL[e.status]}，共 ${e.days} 天`],
          ['记录', `${records.length} 条`],
          ['就诊与费用', `${visits ? `就诊 ${visits} 次` : '未就诊'}，${formatMoney(d.costTotalCents)}`],
        ].map(([k, v], i) => (
          <div key={k} className={`flex flex-col px-2 py-1.5 ${i < 3 ? 'border-r border-line' : ''}`}>
            <span className="text-[8pt] text-ink-muted">{k}</span>
            <span className="font-bold">{v}</span>
          </div>
        ))}
      </div>
      {range && <p className="text-[9pt] text-ink-muted">时间段：{range}</p>}

      {hasTrend && (
        <PrintSection title={trend.severity.length && trend.temperature.length ? '体温（°C）和症状程度' : trend.temperature.length ? '体温（°C）' : '症状程度'} className="avoid-break">
          <TrendChart trend={trend} height={150} animation={false} compact onRendered={() => setChartDone(true)} />
        </PrintSection>
      )}

      {sections.has('meds') && meds.length > 0 && (
        <PrintSection title="服药明细" className="avoid-break">
          <table className="w-full border-collapse text-[9.5pt]">
            <thead>
              <tr className="text-left text-[8.5pt] text-ink-muted">
                <th className="border-b border-line px-1.5 py-1 font-medium">时间</th>
                <th className="border-b border-line px-1.5 py-1 font-medium">药名</th>
                <th className="border-b border-line px-1.5 py-1 font-medium">剂量</th>
              </tr>
            </thead>
            <tbody>
              {meds.map((r) => (
                <tr key={r.id} className="border-b border-line-soft last:border-0">
                  <td className="px-1.5 py-1 tabular-nums">{time(r.occurredAt)}</td>
                  <td className="px-1.5 py-1">{r.medName ?? '—'}</td>
                  <td className="px-1.5 py-1">{r.medDose !== null ? formatDose(null, r.medDose, r.medUnit) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </PrintSection>
      )}

      {sections.has('visits') && care.length > 0 && (
        <PrintSection title="就诊与治疗" className="avoid-break">
          <table className="w-full border-collapse text-[9.5pt]">
            <thead>
              <tr className="text-left text-[8.5pt] text-ink-muted">
                {['时间', '类型', '医院 / 机构', '科室 / 项目', '费用'].map((h) => (
                  <th key={h} className="border-b border-line px-1.5 py-1 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {care.map((r) => (
                <tr key={r.id} className="border-b border-line-soft last:border-0">
                  <td className="px-1.5 py-1 tabular-nums">{time(r.occurredAt)}</td>
                  <td className="px-1.5 py-1">{RECORD_TYPE_LABEL[r.type!]}</td>
                  <td className="px-1.5 py-1">{(r.type === 'visit' ? r.details.hospital : r.details.institution) ?? '—'}</td>
                  <td className="px-1.5 py-1">{(r.type === 'visit' ? [r.details.department, r.details.doctor].filter(Boolean).join(' ') : r.details.item) || '—'}</td>
                  <td className="px-1.5 py-1">{r.costCents !== null ? formatMoney(r.costCents) : '—'}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={4} className="px-1.5 py-1 text-right text-ink-muted">
                  合计
                </td>
                <td className="px-1.5 py-1 font-bold">{formatMoney(d.costTotalCents)}</td>
              </tr>
            </tbody>
          </table>
        </PrintSection>
      )}

      {sections.has('timeline') && (
        <PrintSection title="记录时间线">
          {records.length === 0 ? (
            <p className="text-ink-muted">这段时间没有记录</p>
          ) : (
            <div className="grid grid-cols-[78px_52px_minmax(0,1fr)] items-start gap-x-1.5 gap-y-1">
              {records.map((r) => (
                <TimelineRow key={r.id} r={r} withThumbs={photos === 'thumbnail'} token={token} />
              ))}
            </div>
          )}
        </PrintSection>
      )}

      {allPhotos.length > 0 && (
        <section className="page-break flex flex-col gap-3">
          <h2 className="text-[11pt] font-bold">附录：照片原图</h2>
          {allPhotos.map(({ p, r }, i) => (
            <figure key={p.id} className="avoid-break flex flex-col gap-1">
              <img src={withToken(p.url, token)} alt={`照片 ${i + 1}`} className="max-h-[200mm] max-w-full self-start object-contain" />
              <figcaption className="text-[9pt] text-ink-muted">
                图 {i + 1}：{time(r.occurredAt)} {r.type ? RECORD_TYPE_LABEL[r.type] : ''} {r.body.slice(0, 30)}
              </figcaption>
            </figure>
          ))}
        </section>
      )}

      <PrintFooter />
    </PrintSheet>
  )
}

function TimelineRow({ r, withThumbs, token }: { r: Record; withThumbs: boolean; token: string | null | undefined }) {
  const parts = [recordHeadline(r), r.type === 'symptom' && r.severity !== null ? `程度 ${r.severity}` : '', recordSubline(r), r.isFlare ? '发作' : '', audioReportText(r), r.body]
    .filter(Boolean)
    .join('。')
  const thumbs = withThumbs ? photosOf(r) : []
  return (
    <>
      <span className="whitespace-nowrap text-ink-muted tabular-nums">{time(r.occurredAt)}</span>
      <span className="font-bold" style={{ color: r.type ? RECORD_TYPE_COLOR[r.type] : '#4E5D5A' }}>
        {r.type ? RECORD_TYPE_LABEL[r.type] : '记录'}
      </span>
      <span className="flex items-start gap-1.5">
        <span className="flex-1">
          {r.type === 'temperature' && r.temperature !== null ? formatTemperature(r.temperature) : parts || '（无文字）'}
          {r.backfilled && <span className="text-ink-muted">（补录）</span>}
        </span>
        {thumbs.map((p) => (
          <img key={p.id} src={withToken(p.thumbUrl ?? p.url, token)} alt="" className="size-[26px] shrink-0 rounded-sm object-cover" />
        ))}
      </span>
    </>
  )
}
