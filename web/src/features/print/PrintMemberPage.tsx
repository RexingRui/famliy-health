import { useParams } from 'react-router'
import type { PrintData } from '../../api/types'
import { KIND_LABEL, STATUS_LABEL } from '../../lib/labels'
import { formatMoney } from '../../lib/time/format'
import { MemberBlock, PrintFooter, PrintHeader, PrintSection, PrintSheet, PrintState } from './printShared'
import { rangeText, usePrintQuery, usePrintReady } from './printData'

/** 成员健康档案: member info, long-term conditions and a one-line summary per episode in the period. */
export function PrintMemberPage() {
  const { id = '' } = useParams()
  const { data } = usePrintQuery('member', id)
  usePrintReady(data.isSuccess)
  if (data.isPending) return <PrintState>正在生成报告…</PrintState>
  if (data.isError) return <PrintState>{data.error.message}</PrintState>
  return <MemberReport d={data.data} />
}

function MemberReport({ d }: { d: PrintData }) {
  const m = d.member
  const range = rangeText(d)
  return (
    <PrintSheet>
      <PrintHeader kind="成员健康档案" title={`${m.nickname}的健康档案`} generatedAt={d.generatedAt} />
      <MemberBlock member={m} at={d.generatedAt} />

      <PrintSection title="长期病程" className="avoid-break">
        {m.longEpisodes.length === 0 ? (
          <p className="text-ink-muted">无</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {m.longEpisodes.map((e) => (
              <li key={e.id} className="rounded border border-line px-2.5 py-1">
                {e.name}（{STATUS_LABEL[e.status]}）
              </li>
            ))}
          </ul>
        )}
      </PrintSection>

      <PrintSection title={`病程摘要${range ? `（${range}）` : ''}`}>
        {d.episodes.length === 0 ? (
          <p className="text-ink-muted">这段时间没有病程</p>
        ) : (
          <table className="w-full border-collapse text-[9.5pt]">
            <thead>
              <tr className="text-left text-[8.5pt] text-ink-muted">
                {['病程', '类型', '开始', '结束', '持续', '记录', '费用'].map((h) => (
                  <th key={h} className="border-b border-line px-1.5 py-1 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.episodes.map((e) => (
                <tr key={e.id} className="avoid-break border-b border-line-soft last:border-0">
                  <td className="px-1.5 py-1 font-medium">{e.name}</td>
                  <td className="px-1.5 py-1">{KIND_LABEL[e.kind]}</td>
                  <td className="px-1.5 py-1 tabular-nums">{e.startedOn}</td>
                  <td className="px-1.5 py-1 tabular-nums">{e.open ? STATUS_LABEL[e.status] : (e.endedOn ?? '—')}</td>
                  <td className="px-1.5 py-1">{e.open ? `第 ${e.days} 天` : `${e.days} 天`}</td>
                  <td className="px-1.5 py-1">{e.recordCount} 条</td>
                  <td className="px-1.5 py-1">{e.costTotalCents ? formatMoney(e.costTotalCents) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {d.costTotalCents > 0 && <p className="pt-1 text-right">费用合计 {formatMoney(d.costTotalCents)}</p>}
      </PrintSection>

      <PrintFooter />
    </PrintSheet>
  )
}
