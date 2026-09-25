import { cx } from '../lib/cx'

/** Tiny temperature line for home cards: points evenly spaced, latest one emphasized. */
export function Sparkline({
  values,
  width = 150,
  height = 32,
  color = '#8C560A',
}: {
  values: number[]
  width?: number
  height?: number
  color?: string
}) {
  if (values.length === 0) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pad = 6
  const pts = values.map((v, i) => {
    const x = values.length === 1 ? width / 2 : pad + (i * (width - pad * 2)) / (values.length - 1)
    const y = pad + ((max - v) / span) * (height - pad * 2)
    return [x, y] as const
  })
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline
        points={pts.map((p) => p.join(',')).join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === pts.length - 1 ? 3.5 : 2.5} fill={color} />
      ))}
    </svg>
  )
}

/** Ten segments for a 0–10 severity, as in the long-episode timeline. */
export function SeverityBar({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cx('flex items-center gap-2.5', className)}>
      <span aria-label={`程度 ${value}，满分 10`} role="img" className="flex gap-0.5">
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className={cx('h-2 w-2.5 rounded-[2px]', i < value ? 'bg-symptom' : 'bg-visit-soft')} />
        ))}
      </span>
      <span className="text-[13px] text-ink-muted">{value} / 10</span>
    </span>
  )
}
