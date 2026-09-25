import { useMutation } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { useSearchParams } from 'react-router'
import { apiUrl } from '../../api/client'
import { createExport, query } from '../../api/endpoints'
import { useEpisodes, useMembers } from '../../api/hooks'
import type { Episode, PhotoOption, ReportType } from '../../api/types'
import { useIsDesktop } from '../../app/useIsDesktop'
import { PrintIcon } from '../../components/icons'
import { toast, toastError } from '../../lib/toast'
import { Button, ErrorState, PageHeader, Spinner } from '../../components/ui'
import { cx } from '../../lib/cx'
import { STATUS_LABEL } from '../../lib/labels'
import { formatDateFull } from '../../lib/time/format'
import { SECTION_LABEL, SECTIONS, type Section } from '../print/printData'

type Period = 'all' | '6m' | '1y' | '3y' | 'custom'
const PERIODS: { value: Period; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: '6m', label: '近 6 个月' },
  { value: '1y', label: '近一年' },
  { value: '3y', label: '近三年' },
  { value: 'custom', label: '自定义' },
]

function periodRange(p: Period, custom: { from: string; to: string }): { from?: string; to?: string } {
  const today = dayjs().format('YYYY-MM-DD')
  switch (p) {
    case '6m':
      return { from: dayjs().subtract(6, 'month').format('YYYY-MM-DD'), to: today }
    case '1y':
      return { from: dayjs().subtract(1, 'year').format('YYYY-MM-DD'), to: today }
    case '3y':
      return { from: dayjs().subtract(3, 'year').format('YYYY-MM-DD'), to: today }
    case 'custom':
      return { from: custom.from || undefined, to: custom.to || undefined }
    default:
      return {}
  }
}

const PHOTO_OPTIONS: { value: PhotoOption; label: string }[] = [
  { value: 'none', label: '不附带' },
  { value: 'thumbnail', label: '附缩略图' },
  { value: 'appendix', label: '作为附录附原图' },
]

/** “小明，感冒，2026年9月23日起” / “我，腰椎间盘突出（长期）”. */
function episodeOption(e: Episode, memberName: string): string {
  if (e.kind === 'long') return `${memberName}，${e.name}（长期，${STATUS_LABEL[e.status]}）`
  return `${memberName}，${e.diseaseName}，${formatDateFull(e.startedOn)}起${e.open ? '' : `（${STATUS_LABEL[e.status]}）`}`
}

export function ExportPage() {
  const id = useId()
  const isDesktop = useIsDesktop()
  const [params] = useSearchParams()
  const members = useMembers(true)
  const episodes = useEpisodes({})
  const [type, setType] = useState<ReportType>(params.get('type') === 'member' ? 'member' : 'episode')
  const [pickedEpisode, setEpisodeId] = useState(params.get('episodeId') ?? '')
  const [pickedMember, setMemberId] = useState(params.get('memberId') ?? '')
  const [period, setPeriod] = useState<Period>(params.get('type') === 'member' ? '1y' : 'all')
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [photos, setPhotos] = useState<PhotoOption>('thumbnail')
  const [sections, setSections] = useState<Set<Section>>(new Set(SECTIONS))
  const frame = useRef<HTMLIFrameElement>(null)

  // Until the user picks one: the most recent episode and the first active member.
  const episodeId = pickedEpisode || episodes.data?.[0]?.id || ''
  const memberId = pickedMember || members.data?.find((m) => !m.archived)?.id || members.data?.[0]?.id || ''

  const names = new Map(members.data?.map((m) => [m.id, m.nickname]))
  const episode = episodes.data?.find((e) => e.id === episodeId)
  const showPeriod = type === 'member' || episode?.kind === 'long'
  const range = showPeriod ? periodRange(period, custom) : {}
  const targetId = type === 'episode' ? episodeId : memberId
  const allSections = sections.size === SECTIONS.length
  const previewUrl = targetId
    ? apiUrl(
        `/print/${type}/${targetId}${query({
          ...range,
          photos,
          sections: type === 'episode' && !allSections ? [...sections].join(',') : undefined,
        })}`,
      )
    : ''

  const download = useMutation({
    mutationFn: () =>
      createExport({
        type,
        photos,
        ...(type === 'episode' ? { episodeId } : { memberId }),
        ...range,
      }),
    onSuccess: ({ blob, fileName }) => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.append(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      toast('已开始下载')
    },
    onError: (e) => toastError(e, '导出失败'),
  })

  function print() {
    if (isDesktop && frame.current?.contentWindow) {
      frame.current.contentWindow.focus()
      frame.current.contentWindow.print()
    } else if (previewUrl) {
      window.open(previewUrl, '_blank')
    }
  }

  if (members.isPending || episodes.isPending) return <Spinner />
  if (members.isError) return <ErrorState error={members.error} onRetry={() => void members.refetch()} />
  if (episodes.isError) return <ErrorState error={episodes.error} onRetry={() => void episodes.refetch()} />

  const legend = 'mb-2 p-0 text-sm font-bold'
  const settings = (
    <section aria-label="导出设置" className="flex flex-col gap-[22px] lg:w-[400px] lg:shrink-0">
      {isDesktop && <h1 className="font-display text-4xl leading-tight font-normal">导出报告</h1>}

      <fieldset className="flex flex-col">
        <legend className={legend}>报告类型</legend>
        <div className="grid grid-cols-2 gap-2.5">
          {(
            [
              ['episode', '病程报告', '一次生病或一段治疗的完整经过'],
              ['member', '成员健康档案', '一个人的基本信息和病程摘要'],
            ] as const
          ).map(([v, label, hint]) => (
            <label
              key={v}
              className={cx(
                'flex cursor-pointer flex-col gap-1 rounded-[14px] bg-surface p-3.5',
                type === v ? 'border-2 border-primary' : 'border border-line',
              )}
            >
              <span className={cx('flex items-center gap-2 text-[15px]', type === v ? 'font-bold' : 'font-medium')}>
                <input type="radio" name="kind" checked={type === v} onChange={() => setType(v)} className="size-4 accent-primary" />
                {label}
              </span>
              <span className="text-xs leading-normal text-ink-muted">{hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {type === 'episode' ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-episode`} className="text-sm font-bold">
            选择病程
          </label>
          {episodes.data.length === 0 ? (
            <p className="text-sm text-ink-muted">还没有病程</p>
          ) : (
            <select
              id={`${id}-episode`}
              value={episodeId}
              onChange={(e) => setEpisodeId(e.target.value)}
              className="h-11 rounded-control border border-line bg-surface px-3 text-[15px]"
            >
              {episodes.data.map((e) => (
                <option key={e.id} value={e.id}>
                  {episodeOption(e, names.get(e.memberId) ?? '')}
                </option>
              ))}
            </select>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-member`} className="text-sm font-bold">
            选择成员
          </label>
          <select
            id={`${id}-member`}
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
            className="h-11 rounded-control border border-line bg-surface px-3 text-[15px]"
          >
            {members.data.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nickname}
                {m.archived ? '（已归档）' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {showPeriod && (
        <fieldset className="flex flex-col gap-2">
          <legend className={legend}>时间段</legend>
          <div className="flex flex-wrap gap-2">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                aria-pressed={period === p.value}
                onClick={() => setPeriod(p.value)}
                className={cx(
                  'h-9 rounded-full px-3.5 text-sm',
                  period === p.value ? 'bg-primary font-medium text-white' : 'border border-line bg-surface',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          {period === 'custom' && (
            <div className="flex items-center gap-2 text-sm">
              <input
                type="date"
                aria-label="开始日期"
                value={custom.from}
                max={custom.to || undefined}
                onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
                className="h-10 flex-1 rounded-[10px] border border-line bg-surface px-2"
              />
              至
              <input
                type="date"
                aria-label="结束日期"
                value={custom.to}
                min={custom.from || undefined}
                onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
                className="h-10 flex-1 rounded-[10px] border border-line bg-surface px-2"
              />
            </div>
          )}
        </fieldset>
      )}

      {type === 'episode' && (
        <fieldset className="flex flex-col gap-1">
          <legend className={legend}>包含内容</legend>
          {SECTIONS.map((s) => (
            <label key={s} className="flex h-9 items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={sections.has(s)}
                onChange={(e) =>
                  setSections((prev) => {
                    const next = new Set(prev)
                    if (e.target.checked) next.add(s)
                    else next.delete(s)
                    return next
                  })
                }
                className="size-[18px] accent-primary"
              />
              {SECTION_LABEL[s]}
            </label>
          ))}
        </fieldset>
      )}

      <fieldset className="flex flex-col gap-1">
        <legend className={legend}>照片</legend>
        {PHOTO_OPTIONS.map((o) => (
          <label key={o.value} className="flex h-9 items-center gap-2.5 text-sm">
            <input type="radio" name="photo" checked={photos === o.value} onChange={() => setPhotos(o.value)} className="size-[18px] accent-primary" />
            {o.label}
          </label>
        ))}
      </fieldset>

      <p className="text-[13px] leading-relaxed text-ink-muted">语音在报告里显示为时长和补充文字。</p>

      <div className="mt-auto flex gap-2.5">
        <Button block size="lg" variant="primary" className="h-12 text-[15px]" disabled={!targetId || download.isPending} onClick={() => download.mutate()}>
          {download.isPending ? '正在生成…' : '下载 PDF'}
        </Button>
        <Button size="lg" className="h-12 w-[120px] text-[15px]" disabled={!targetId} onClick={print}>
          <PrintIcon size={18} />
          {isDesktop ? '打印' : '预览'}
        </Button>
      </div>
    </section>
  )

  if (!isDesktop) {
    return (
      <div className="flex flex-col pb-8">
        <PageHeader back={-1} title="导出报告" />
        <div className="px-4">{settings}</div>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100dvh-4rem)] gap-8">
      {settings}
      <section aria-label="报告预览" className="flex min-w-0 flex-1 flex-col items-center gap-3 overflow-hidden rounded-[20px] bg-segment p-6">
        {previewUrl ? <PreviewFrame src={previewUrl} frameRef={frame} /> : <p className="py-20 text-sm text-ink-muted">选择病程或成员后在这里预览</p>}
        <span className="text-[13px] text-ink-muted">预览，与下载的 PDF 使用同一个打印页面</span>
      </section>
    </div>
  )
}

/** A4 page (794 px wide at 96 dpi) scaled to fit the preview column; the frame grows with the report. */
function PreviewFrame({ src, frameRef }: { src: string; frameRef: RefObject<HTMLIFrameElement | null> }) {
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.65)
  const [height, setHeight] = useState(1123)

  useEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setScale(Math.min(1, (el.clientWidth - 8) / 794)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  function track() {
    const doc = frameRef.current?.contentDocument
    if (!doc) return
    const measure = () => setHeight(Math.max(1123, doc.documentElement.scrollHeight))
    measure()
    new ResizeObserver(measure).observe(doc.documentElement)
  }

  return (
    <div ref={box} className="w-full flex-1 overflow-y-auto">
      <div className="mx-auto overflow-hidden bg-white shadow-[0_4px_16px_rgba(27,40,38,0.14)]" style={{ width: 794 * scale, height: height * scale }}>
        <iframe
          ref={frameRef}
          title="报告预览"
          src={src}
          onLoad={track}
          style={{ width: 794, height, transform: `scale(${scale})`, transformOrigin: '0 0', border: 0, background: '#fff' }}
        />
      </div>
    </div>
  )
}
