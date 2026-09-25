import { lazy, Suspense, type ComponentProps } from 'react'

// ECharts is most of the bundle weight; load it only when a chart is on screen.
const TrendChart = lazy(() => import('./TrendChart').then((m) => ({ default: m.TrendChart })))

export function LazyTrendChart(props: ComponentProps<typeof TrendChart>) {
  return (
    <Suspense fallback={<div style={{ height: props.height ?? 260 }} aria-hidden="true" />}>
      <TrendChart {...props} />
    </Suspense>
  )
}
