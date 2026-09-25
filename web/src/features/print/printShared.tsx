import type { ReactNode } from 'react'
import type { Member } from '../../api/types'
import { formatDateFull } from '../../lib/time/format'
import { memberBasics } from './printData'

/** A4 sheet: 210 mm wide on screen, page-sized margins in print. */
export function PrintSheet({ children }: { children: ReactNode }) {
  return (
    <div className="print-root min-h-dvh bg-white text-[10.5pt] leading-normal text-ink">
      <style>{`
        @page { size: A4; margin: 14mm 13mm 16mm; }
        @media print {
          html, body { background: #fff !important; }
          .print-page { width: auto !important; padding: 0 !important; box-shadow: none !important; }
          .print-footer { position: fixed; bottom: -9mm; left: 0; right: 0; }
          .avoid-break { break-inside: avoid; }
          .page-break { break-before: page; }
        }
      `}</style>
      <article className="print-page mx-auto flex w-[210mm] flex-col gap-[14px] bg-white px-[13mm] py-[14mm]">{children}</article>
    </div>
  )
}

export function PrintHeader({ kind, title, generatedAt }: { kind: string; title: string; generatedAt: string }) {
  return (
    <header className="flex items-end justify-between border-b-[1.5px] border-ink pb-2.5">
      <div className="flex flex-col gap-0.5">
        <span className="text-[9pt] text-ink-muted">{kind}</span>
        <span className="font-display text-[22pt] leading-tight">{title}</span>
      </div>
      <div className="flex flex-col items-end text-[9pt] text-ink-muted">
        <span>生成于 {formatDateFull(generatedAt)}</span>
        <span>家庭健康管理</span>
      </div>
    </header>
  )
}

export function MemberBlock({ member, at }: { member: Member; at: string }) {
  return (
    <div className="avoid-break flex items-center gap-2.5">
      <div className="flex flex-1 flex-col gap-px">
        <span className="text-[8pt] text-ink-muted">基本信息</span>
        <span>
          {member.nickname}，{memberBasics(member, at)}
        </span>
        {member.notes && <span className="text-[9pt] text-ink-muted">备注：{member.notes}</span>}
      </div>
      <div className={member.allergies ? 'rounded bg-alert-soft px-2.5 py-1 font-bold text-alert' : 'rounded bg-visit-soft px-2.5 py-1 text-ink-muted'}>
        {member.allergies ? `过敏：${member.allergies}` : '无已知过敏'}
      </div>
    </div>
  )
}

export function PrintSection({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`flex flex-col gap-1 ${className ?? ''}`}>
      <h2 className="text-[11pt] font-bold">{title}</h2>
      {children}
    </section>
  )
}

export function PrintFooter() {
  return (
    <footer className="print-footer mt-auto flex justify-between border-t border-line pt-2 text-[8pt] text-ink-muted">
      <span>家庭自行记录，仅供就诊时参考，不作为诊断依据</span>
      <span>家庭健康管理</span>
    </footer>
  )
}

export function PrintState({ children }: { children: ReactNode }) {
  return <p className="p-10 text-center text-sm text-ink-muted">{children}</p>
}
