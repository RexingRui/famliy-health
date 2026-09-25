import dayjs from 'dayjs'
import { LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { Trend } from '../api/types'
import { trendLabel } from '../lib/trend'

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, MarkLineComponent, SVGRenderer])

const TEMP = '#8C560A'
const SEVERITY = '#B04E15'

/**
 * Temperature (left axis, °C) and symptom severity (right axis, 0–10) over time. Print pages
 * turn animation off and wait for `onRendered` before signalling that the page is ready.
 */
export function TrendChart({
  trend,
  height = 260,
  animation = true,
  compact = false,
  onRendered,
}: {
  trend: Trend
  height?: number
  animation?: boolean
  compact?: boolean
  onRendered?: () => void
}) {
  const el = useRef<HTMLDivElement>(null)
  const rendered = useRef(onRendered)
  useLayoutEffect(() => {
    rendered.current = onRendered
  })

  useEffect(() => {
    if (!el.current) return
    const chart = echarts.init(el.current, undefined, { renderer: 'svg' })
    const hasTemp = trend.temperature.length > 0
    const hasSeverity = trend.severity.length > 0
    const temps = trend.temperature.map((p) => p.value)
    const tMin = Math.min(36, ...temps)
    const tMax = Math.max(39, ...temps)
    const fontSize = compact ? 9 : 12
    const times = [...trend.temperature, ...trend.severity].map((p) => dayjs(p.occurredAt).valueOf())
    // A few days of a cold need hours on the axis; months of a long illness only need dates.
    const shortSpan = times.length > 0 && Math.max(...times) - Math.min(...times) < 3 * 86_400_000

    chart.setOption({
      animation,
      textStyle: { fontFamily: "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif", fontSize },
      grid: { left: compact ? 34 : 44, right: hasSeverity ? (compact ? 28 : 36) : 16, top: compact ? 24 : 36, bottom: compact ? 22 : 30 },
      legend: {
        show: hasTemp && hasSeverity,
        top: 0,
        right: 0,
        itemWidth: 14,
        itemHeight: 8,
        textStyle: { color: '#4E5D5A', fontSize },
      },
      tooltip: compact
        ? { show: false }
        : {
            trigger: 'axis',
            valueFormatter: (v: unknown) => String(v),
          },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: '#D5DCD9' } },
        axisLabel: {
          color: '#4E5D5A',
          fontSize,
          hideOverlap: true,
          formatter: (v: number) => dayjs(v).format(shortSpan ? 'M/D HH:mm' : 'M/D'),
        },
        splitNumber: shortSpan ? 3 : 5,
        splitLine: { show: false },
      },
      yAxis: [
        {
          type: 'value',
          name: hasTemp ? '°C' : '',
          min: Math.floor(tMin * 2) / 2,
          max: Math.ceil(tMax * 2) / 2,
          interval: 0.5,
          show: hasTemp,
          nameTextStyle: { color: TEMP, fontSize },
          axisLabel: { color: '#4E5D5A', fontSize, formatter: (v: number) => v.toFixed(1) },
          splitLine: { lineStyle: { color: '#E3E7E6' } },
        },
        {
          type: 'value',
          name: hasSeverity ? '程度' : '',
          min: 0,
          max: 10,
          interval: 2,
          show: hasSeverity,
          position: 'right',
          nameTextStyle: { color: SEVERITY, fontSize },
          axisLabel: { color: '#4E5D5A', fontSize },
          splitLine: { show: !hasTemp, lineStyle: { color: '#E3E7E6' } },
        },
      ],
      series: [
        hasTemp && {
          name: '体温',
          type: 'line',
          yAxisIndex: 0,
          data: trend.temperature.map((p) => [p.occurredAt, p.value]),
          lineStyle: { color: TEMP, width: 2 },
          itemStyle: { color: TEMP },
          symbolSize: compact ? 5 : 7,
          label: { show: compact || trend.temperature.length <= 12, color: TEMP, fontSize, fontWeight: 700, formatter: (p: { value: [string, number] }) => p.value[1].toFixed(1) },
          markLine: {
            silent: true,
            symbol: 'none',
            label: { show: !compact, position: 'insideEndTop', formatter: '37.3', color: '#8A9693', fontSize: 10 },
            lineStyle: { color: '#C3CCC9', type: 'dashed' },
            data: [{ yAxis: 37.3 }],
          },
        },
        hasSeverity && {
          name: '症状程度',
          type: 'line',
          yAxisIndex: 1,
          step: false,
          data: trend.severity.map((p) => [p.occurredAt, p.value]),
          lineStyle: { color: SEVERITY, width: 2, type: 'dashed' },
          itemStyle: { color: SEVERITY },
          symbolSize: compact ? 5 : 7,
        },
      ].filter(Boolean),
    })

    chart.on('finished', () => rendered.current?.())
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => chart.resize()) : null
    ro?.observe(el.current)
    return () => {
      ro?.disconnect()
      chart.dispose()
    }
  }, [trend, animation, compact])

  return <div ref={el} style={{ height, width: '100%' }} role="img" aria-label={trendLabel(trend)} />
}
