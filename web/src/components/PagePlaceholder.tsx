import type { ReactNode } from 'react'

type Props = {
  title: string
  /** What this page will contain, from the product plan. */
  summary: string
  /** Board name in the design canvas, if one exists. */
  design?: string
  children?: ReactNode
}

/** Scaffolding stand-in until the feature is built. */
export function PagePlaceholder({ title, summary, design, children }: Props) {
  return (
    <section className="flex flex-col gap-3 px-5 pt-6 pb-8 lg:px-0 lg:pt-0">
      <h1 className="font-display text-3xl leading-tight">{title}</h1>
      <p className="max-w-prose text-sm leading-relaxed text-ink-muted">{summary}</p>
      <p className="text-xs text-ink-subtle">设计稿：{design ?? '暂无，按设计语言补'}</p>
      {children}
    </section>
  )
}
