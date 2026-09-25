import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useSearchParams } from 'react-router'
import { getPrintData, type PrintQuery } from '../../api/endpoints'
import type { Member, PhotoOption, PrintData, ReportType } from '../../api/types'
import { BLOOD_LABEL, GENDER_LABEL } from '../../lib/labels'
import { formatAge, formatDateFull } from '../../lib/time/format'

declare global {
  interface Window {
    /** Set when the print page has its data, charts and images; Gotenberg waits for it. */
    __PRINT_READY__?: boolean
  }
}

export const SECTIONS = ['trend', 'meds', 'visits', 'timeline'] as const
export type Section = (typeof SECTIONS)[number]

export const SECTION_LABEL: { [K in Section]: string } = {
  trend: '体温和症状程度曲线',
  meds: '服药明细',
  visits: '就诊与费用',
  timeline: '全部记录时间线',
}

/**
 * Reads the print page's query: Gotenberg passes `token`; the export preview and browser
 * printing pass type/id/from/to/photos and use the session. `sections` (comma separated)
 * picks the report parts; all by default.
 */
export function usePrintQuery(type: ReportType, id: string) {
  const [params] = useSearchParams()
  const token = params.get('token') ?? undefined
  const q: PrintQuery = token
    ? { token }
    : {
        type,
        id,
        from: params.get('from') ?? undefined,
        to: params.get('to') ?? undefined,
        photos: (params.get('photos') as PhotoOption | null) ?? undefined,
      }
  const raw = params.get('sections')
  const sections = new Set<Section>(raw === null ? SECTIONS : (raw.split(',').filter((s) => (SECTIONS as readonly string[]).includes(s)) as Section[]))
  const data = useQuery({ queryKey: ['print-data', q], queryFn: () => getPrintData(q), retry: false, staleTime: Infinity })
  return { data, sections, token }
}

/** Appends the print token to attachment URLs so Gotenberg can fetch images without a session. */
export function withToken(url: string, token: string | null | undefined): string {
  if (!token) return url
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
}

/**
 * Sets window.__PRINT_READY__ once `ready` is true, fonts are loaded and every image has
 * finished (or failed) loading.
 */
export function usePrintReady(ready: boolean) {
  useEffect(() => {
    window.__PRINT_READY__ = false
    if (!ready) return
    let cancelled = false
    const images = Array.from(document.images)
    const loads = images.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve(), { once: true })
            img.addEventListener('error', () => resolve(), { once: true })
          }),
    )
    const fonts = document.fonts?.ready ?? Promise.resolve()
    void Promise.all([fonts, ...loads]).then(() => {
      if (!cancelled) window.__PRINT_READY__ = true
    })
    return () => {
      cancelled = true
    }
  }, [ready])
}

export function memberBasics(m: Member, at: string | Date = new Date()): string {
  const parts = [`${GENDER_LABEL[m.gender]}，${formatAge(m.birthDate, at)}`, `${formatDateFull(m.birthDate)}生`]
  if (m.bloodType && m.bloodType !== 'unknown') parts.push(`血型 ${BLOOD_LABEL[m.bloodType]}`)
  return parts.join('，')
}

export const rangeText = (d: PrintData) =>
  d.from || d.to ? `${d.from ? formatDateFull(d.from) : '最早'} 至 ${d.to ? formatDateFull(d.to) : '今天'}` : null
