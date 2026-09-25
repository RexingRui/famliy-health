import { useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import * as api from '../../api/endpoints'
import { invalidateAfterWrite, keys, useEpisode, useEpisodes, useMember, useMembers, useRecord } from '../../api/hooks'
import type { Record } from '../../api/types'
import { useIsDesktop } from '../../app/useIsDesktop'
import { AudioPlayer } from '../../components/AudioPlayer'
import { ChevronRightIcon, TrashIcon } from '../../components/icons'
import { PhotoThumbs } from '../../components/Photos'
import { ConfirmDialog } from '../../components/Sheet'
import { toast, toastError } from '../../lib/toast'
import { BottomBar, Button, ErrorState, FlareTag, OutlineTag, PageHeader, Spinner, TypeTag } from '../../components/ui'
import { useUploadQueue } from '../../lib/drafts/useUploadQueue'
import { RECORD_TYPE_LABEL } from '../../lib/labels'
import { audioOf, formatDose, photosOf } from '../../lib/record'
import { VoiceRecorder } from '../../lib/recorder/recorder'
import { formatClock, formatDate, formatMoney, formatRecordTime, formatTemperature, weekday } from '../../lib/time/format'
import { EpisodeSheet } from './EpisodePicker'
import { formFromRecord, validate, type EpisodeChoice, type FormErrors, type RecordForm } from './form'
import { recordContext, saveEdits } from './actions'
import { RecordFormView } from './RecordFormView'

export function RecordDetailPage() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const record = useRecord(id)

  if (record.isPending) return <Spinner />
  if (record.isError) return <ErrorState error={record.error} onRetry={() => void record.refetch()} />
  return params.get('edit') ? <RecordEdit record={record.data} /> : <RecordView record={record.data} />
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 border-b border-line-soft py-2 last:border-0">
      <dt className="shrink-0 text-sm text-ink-muted">{label}</dt>
      <dd className="text-right text-[15px]">{children}</dd>
    </div>
  )
}

/** Type-specific rows for the info list. */
function typeRows(r: Record): [string, string][] {
  const rows: [string, string][] = []
  switch (r.type) {
    case 'symptom':
      rows.push(['程度', r.severity !== null ? `${r.severity} / 10` : '未填'])
      break
    case 'temperature':
      rows.push(['体温', r.temperature !== null ? formatTemperature(r.temperature) : '未填'])
      break
    case 'medication':
      rows.push(['药名与剂量', formatDose(r.medName, r.medDose, r.medUnit) || '未填'])
      break
    case 'visit':
      if (r.details.hospital) rows.push(['医院', r.details.hospital])
      if (r.details.department) rows.push(['科室', r.details.department])
      if (r.details.doctor) rows.push(['医生', r.details.doctor])
      if (r.costCents !== null) rows.push(['费用', formatMoney(r.costCents)])
      break
    case 'treatment':
      if (r.details.item) rows.push(['项目', r.details.item])
      if (r.details.institution) rows.push(['机构', r.details.institution])
      if (r.costCents !== null) rows.push(['费用', formatMoney(r.costCents)])
      break
    case 'exam':
      if (r.details.item) rows.push(['检查项目', r.details.item])
      break
  }
  return rows
}

function useDeleteRecord(r: Record, after: () => void) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.deleteRecord(r.id),
    onSuccess: () => {
      qc.removeQueries({ queryKey: keys.record(r.id) })
      invalidateAfterWrite(qc)
      toast('已删除')
      after()
    },
    onError: (e) => toastError(e),
  })
}

export function RecordView({ record: r, embedded }: { record: Record; embedded?: boolean }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const member = useMember(r.memberId)
  const episode = useEpisode(r.episodeId ?? undefined)
  const memberEpisodes = useEpisodes({ memberId: r.memberId })
  const { drafts } = useUploadQueue()
  const pending = drafts.find((d) => d.id === r.id)?.attachments.length ?? 0
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [moving, setMoving] = useState(false)
  const back = r.episodeId ? `/episodes/${r.episodeId}` : '/inbox'

  const del = useDeleteRecord(r, () => (embedded ? undefined : navigate(back, { replace: true })))
  const move = useMutation({
    mutationFn: async (c: EpisodeChoice) => {
      if (c.mode === 'new') {
        return api.assignRecords({ ids: [r.id], episodeId: null, newEpisode: { diseaseName: c.diseaseName, kind: c.kind } })
      }
      return api.assignRecords({ ids: [r.id], episodeId: c.mode === 'existing' ? c.id : null })
    },
    onSuccess: (res) => {
      invalidateAfterWrite(qc)
      toast(res.episodeId ? '已移到新的病程' : '已移回待整理')
      setMoving(false)
    },
    onError: (e) => toastError(e),
  })
  const reprocess = useMutation({
    mutationFn: (attachmentId: string) => api.reprocessAttachment(attachmentId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.record(r.id) })
      toast('已重新提交处理')
    },
    onError: (e) => toastError(e),
  })

  const audio = audioOf(r)
  const photos = photosOf(r)
  const t = dayjs(r.occurredAt)

  return (
    <div className="flex flex-1 flex-col">
      {!embedded && (
        <PageHeader back={back} backLabel={episode.data?.diseaseName ?? (r.episodeId ? '病程' : '待整理')} title="记录详情" />
      )}
      <section className="flex flex-col gap-2 px-5 pt-1 pb-4 lg:px-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <TypeTag type={r.type} />
          {r.isFlare && <FlareTag />}
          {r.backfilled && <OutlineTag>补录</OutlineTag>}
        </div>
        <h2 className="text-2xl leading-snug font-bold">
          {formatDate(t)} {weekday(t)} {formatClock(t)}
        </h2>
        <span className="text-sm text-ink-muted">{recordContext(r, member.data?.nickname, episode.data)}</span>
      </section>

      <div className="flex flex-col gap-4 px-4 pb-4 lg:px-0">
        {(r.body || audio.length > 0 || photos.length > 0 || pending > 0) && (
          <section aria-label="记录内容" className="flex flex-col gap-3.5 rounded-card bg-surface p-4">
            {r.body && <p className="text-base leading-[1.7] break-words whitespace-pre-wrap">{r.body}</p>}
            {audio.map((a) => (
              <div key={a.id} className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <AudioPlayer src={a.url} durationMs={a.durationMs} seed={a.id} />
                  {a.status === 'processing' && <span className="text-xs text-ink-muted">转码中，可先播放原始录音</span>}
                  {a.status === 'failed' && (
                    <Button size="sm" onClick={() => reprocess.mutate(a.id)} disabled={reprocess.isPending}>
                      重新处理
                    </Button>
                  )}
                </div>
                {a.caption && <span className="text-sm text-ink-muted">{a.caption}</span>}
              </div>
            ))}
            {photos.length > 0 && <PhotoThumbs photos={photos} size={photos.length === 1 ? 220 : 104} />}
            {pending > 0 && <p className="text-[13px] text-medication">还有 {pending} 个附件正在上传</p>}
          </section>
        )}

        <section aria-label="记录信息" className="rounded-card bg-surface px-4 py-1">
          <dl>
            <InfoRow label="发生时间">{formatRecordTime(r.occurredAt)}</InfoRow>
            <InfoRow label="录入时间">
              {formatRecordTime(r.createdAt)}
              {r.backfilled && <span className="ml-1.5 text-[13px] text-ink-muted">补录</span>}
            </InfoRow>
            <InfoRow label="所属病程">
              {episode.data ? (
                <Link to={`/episodes/${episode.data.id}`} className="flex items-center gap-0.5 text-primary">
                  {episode.data.name}（{member.data?.nickname}）
                  <ChevronRightIcon size={16} />
                </Link>
              ) : (
                <span className="text-ink-muted">未归入，在待整理中</span>
              )}
            </InfoRow>
            <InfoRow label="类型">{r.type ? RECORD_TYPE_LABEL[r.type] : <span className="text-ink-muted">未选</span>}</InfoRow>
            {typeRows(r).map(([k, v]) => (
              <InfoRow key={k} label={k}>
                {v}
              </InfoRow>
            ))}
            <InfoRow label="语音">
              {audio.length ? `${audio.length} 段` : <span className="text-ink-muted">无，可在编辑中补录</span>}
            </InfoRow>
          </dl>
        </section>
      </div>

      <BottomBar>
        <button
          type="button"
          aria-label="删除这条记录"
          onClick={() => setConfirmDelete(true)}
          className="flex size-[52px] shrink-0 items-center justify-center rounded-[14px] border border-line bg-surface text-alert"
        >
          <TrashIcon size={20} />
        </button>
        <Button block size="lg" onClick={() => setMoving(true)} className="text-base">
          移到其他病程
        </Button>
        <Button block size="lg" variant="primary" onClick={() => navigate(`/records/${r.id}?edit=1`)} className="text-base">
          编辑
        </Button>
      </BottomBar>

      <ConfirmDialog
        open={confirmDelete}
        title="删除这条记录？"
        message="记录和其中的照片、语音都会删除，不能恢复。"
        confirmLabel="删除"
        danger
        busy={del.isPending}
        onConfirm={() => del.mutate()}
        onClose={() => setConfirmDelete(false)}
      />
      {moving && (
        <EpisodeSheet
          open
          title="移到其他病程"
          confirmLabel={move.isPending ? '移动中…' : '移过去'}
          value={r.episodeId ? { mode: 'existing', id: r.episodeId } : { mode: 'none' }}
          episodes={memberEpisodes.data ?? []}
          onClose={() => setMoving(false)}
          onChange={(c) => move.mutate(c)}
        />
      )}
    </div>
  )
}

function RecordEdit({ record }: { record: Record }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isDesktop = useIsDesktop()
  const members = useMembers()
  const [form, setForm] = useState<RecordForm>(() => formFromRecord(record))
  const [errors, setErrors] = useState<FormErrors>({})
  const [confirmDelete, setConfirmDelete] = useState(false)
  const episodes = useEpisodes({ memberId: form.memberId ?? undefined }, !!form.memberId)
  const recorder = useMemo(() => new VoiceRecorder(), [])
  const added = useRef(form.added)
  useLayoutEffect(() => {
    added.current = form.added
  })
  const view = `/records/${record.id}`

  useEffect(() => {
    if (!isDesktop) void recorder.warmUp()
    return () => {
      recorder.release()
      added.current.forEach((m) => URL.revokeObjectURL(m.url))
    }
  }, [recorder, isDesktop])

  const save = useMutation({
    mutationFn: () => saveEdits(record, form, episodes.data ?? [], members.data ?? []),
    onSuccess: () => {
      invalidateAfterWrite(qc)
      toast('已保存')
      navigate(view, { replace: true })
    },
    onError: (e) => toastError(e),
  })
  const del = useDeleteRecord(record, () => navigate(record.episodeId ? `/episodes/${record.episodeId}` : '/inbox', { replace: true }))

  function submit() {
    const errs = validate(form, true)
    setErrors(errs)
    if (!Object.keys(errs).length) save.mutate()
  }

  const change = (patch: Partial<RecordForm>) => {
    setForm((f) => {
      const next = { ...f, ...patch }
      if (patch.memberId && patch.memberId !== f.memberId) {
        next.episode = { mode: 'none' }
        next.isFlare = false
      }
      return next
    })
  }

  return (
    <div className="flex flex-1 flex-col lg:max-w-xl">
      <PageHeader
        title="编辑记录"
        left={
          <Link to={view} replace className="flex h-11 items-center px-3 text-base text-ink-muted">
            取消
          </Link>
        }
      />
      <div className="flex flex-col gap-3 px-4 pb-4 lg:px-0">
        {members.isPending && <Spinner />}
        {members.isError && <ErrorState error={members.error} onRetry={() => void members.refetch()} />}
        {members.data && (
          <RecordFormView
            mode="edit"
            form={form}
            errors={errors}
            onChange={change}
            members={members.data}
            episodes={episodes.data ?? []}
            expandEpisodes={false}
            onEpisodeChange={(episode) => change({ episode, isFlare: false })}
            recorder={recorder}
            createdAt={record.createdAt}
            canRecord={!isDesktop}
          />
        )}
        <button type="button" onClick={() => setConfirmDelete(true)} className="h-11 self-center px-4 text-[15px] text-alert">
          删除这条记录
        </button>
      </div>
      <BottomBar className="border-t-0">
        <Button block size="lg" variant="dark" onClick={submit} disabled={save.isPending}>
          {save.isPending ? '保存中…' : '保存修改'}
        </Button>
      </BottomBar>
      <ConfirmDialog
        open={confirmDelete}
        title="删除这条记录？"
        message="记录和其中的照片、语音都会删除，不能恢复。"
        confirmLabel="删除"
        danger
        busy={del.isPending}
        onConfirm={() => del.mutate()}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  )
}
