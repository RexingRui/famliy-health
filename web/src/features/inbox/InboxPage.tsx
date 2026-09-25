import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useId, useRef, useState, type ChangeEvent } from 'react'
import * as api from '../../api/endpoints'
import { invalidateAfterWrite, useEpisodes, useMembers, useRecordList } from '../../api/hooks'
import type { Episode, Member, Record } from '../../api/types'
import { useIsDesktop } from '../../app/useIsDesktop'
import { AudioPlayer } from '../../components/AudioPlayer'
import { Avatar } from '../../components/Avatar'
import { CloseIcon, MicIcon, PhotoIcon, TrashIcon } from '../../components/icons'
import { Lightbox, type PhotoItem } from '../../components/Photos'
import { ConfirmDialog } from '../../components/Sheet'
import { toast, toastError } from '../../lib/toast'
import { Button, ErrorState, FieldError, PageHeader, Spinner, TextArea, TypeTag } from '../../components/ui'
import { cx } from '../../lib/cx'
import { uuidv7 } from '../../lib/id'
import { compressImage } from '../../lib/image/compress'
import { audioOf, photosOf, recordSummary } from '../../lib/record'
import { formatRecordTime, toLocalInput } from '../../lib/time/format'
import { EpisodeSheet } from '../record/EpisodePicker'
import { episodeLabel } from '../record/episodeLabels'
import { defaultEpisode, formFromRecord, MAX_PHOTOS, photoCount, validate, type EpisodeChoice, type FormErrors, type LocalMedia, type RecordForm } from '../record/form'
import { saveEdits } from '../record/actions'
import { Timeline } from '../record/RecordCard'
import { TypeSection } from '../record/TypeFields'

export function InboxPage() {
  const isDesktop = useIsDesktop()
  const list = useRecordList({ inbox: true, limit: 200 })
  const members = useMembers(true)

  if (list.isPending || members.isPending) return <Spinner />
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />
  if (members.isError) return <ErrorState error={members.error} onRetry={() => void members.refetch()} />
  const records = list.data.pages.flatMap((p) => p.items)
  return isDesktop ? <DesktopInbox records={records} members={members.data} /> : <MobileInbox records={records} members={members.data} />
}

function MobileInbox({ records, members }: { records: Record[]; members: Member[] }) {
  const names = new Map(members.map((m) => [m.id, m.nickname]))
  return (
    <div className="flex flex-col pb-6">
      <PageHeader back="/" backLabel="首页" title="待整理" />
      <p className="px-5 pb-4 text-sm leading-relaxed text-ink-muted">
        {records.length ? `${records.length} 条记录还没有归入病程。点开一条，用“移到其他病程”归入。` : '都整理好了，没有未归类的记录。'}
      </p>
      {records.length > 0 && (
        <div className="px-4">
          <Timeline records={records} memberNames={names} />
        </div>
      )}
    </div>
  )
}

function DesktopInbox({ records, members }: { records: Record[]; members: Member[] }) {
  const qc = useQueryClient()
  const [picked, setChecked] = useState<string[]>([])
  const [activePick, setActive] = useState<string | null>(null)
  const [bulkTarget, setBulkTarget] = useState('')
  const [newEpisodeOpen, setNewEpisodeOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const byId = new Map(members.map((m) => [m.id, m]))

  // Records leave the inbox as they are assigned; selections only count while they are listed.
  const checked = picked.filter((id) => records.some((r) => r.id === id))
  const active = activePick && records.some((r) => r.id === activePick) ? activePick : (records[0]?.id ?? null)

  const selected = records.filter((r) => checked.includes(r.id))
  const memberIds = [...new Set(selected.map((r) => r.memberId))]
  const bulkMember = memberIds.length === 1 ? memberIds[0] : undefined
  const bulkEpisodes = useEpisodes({ memberId: bulkMember }, !!bulkMember)

  const assign = useMutation({
    mutationFn: (c: EpisodeChoice) =>
      c.mode === 'new'
        ? api.assignRecords({ ids: checked, episodeId: null, newEpisode: { diseaseName: c.diseaseName, kind: c.kind } })
        : api.assignRecords({ ids: checked, episodeId: c.mode === 'existing' ? c.id : null }),
    onSuccess: (res) => {
      invalidateAfterWrite(qc)
      toast(`已归入 ${res.updated} 条`)
      setChecked([])
      setBulkTarget('')
      setNewEpisodeOpen(false)
    },
    onError: (e) => toastError(e),
  })
  const bulkDelete = useMutation({
    mutationFn: async () => {
      for (const id of checked) await api.deleteRecord(id)
    },
    onSuccess: () => {
      invalidateAfterWrite(qc)
      toast(`已删除 ${checked.length} 条`)
      setChecked([])
      setConfirmDelete(false)
    },
    onError: (e) => {
      invalidateAfterWrite(qc)
      toastError(e)
    },
  })

  const allChecked = records.length > 0 && checked.length === records.length
  const activeRecord = records.find((r) => r.id === active)

  return (
    <div className="flex items-start gap-8">
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <header className="flex flex-col gap-1.5">
          <h1 className="font-display text-4xl leading-tight font-normal">待整理</h1>
          <p className="text-sm text-ink-muted">
            {records.length
              ? `${records.length} 条记录还没有归入病程。点一条在右侧编辑，勾选多条可以一起归入。`
              : '都整理好了，没有未归类的记录。'}
          </p>
        </header>

        {records.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-[14px] bg-surface px-4 py-3">
            <label className="flex h-9 items-center gap-2.5 text-sm font-medium">
              <input
                type="checkbox"
                checked={allChecked}
                ref={(el) => {
                  if (el) el.indeterminate = checked.length > 0 && !allChecked
                }}
                onChange={() => setChecked(allChecked ? [] : records.map((r) => r.id))}
                className="size-[18px] accent-primary"
              />
              {checked.length ? `已选 ${checked.length} 条` : '全选'}
            </label>
            <span className="flex-1" />
            <label htmlFor="bulk-episode" className="text-sm text-ink-muted">
              一起归入
            </label>
            <select
              id="bulk-episode"
              value={bulkTarget}
              disabled={!bulkMember}
              onChange={(e) => {
                if (e.target.value === '__new') setNewEpisodeOpen(true)
                else setBulkTarget(e.target.value)
              }}
              className="h-10 max-w-[280px] rounded-[10px] border border-line bg-surface px-3 text-sm disabled:text-ink-subtle"
            >
              <option value="">{checked.length === 0 ? '先勾选记录' : bulkMember ? '选择病程' : '只能一起归入同一个人的记录'}</option>
              {bulkEpisodes.data?.map((e) => (
                <option key={e.id} value={e.id}>
                  {episodeLabel(e)}
                </option>
              ))}
              <option value="__new">新建病程…</option>
            </select>
            <Button size="sm" variant="primary" disabled={!bulkTarget || assign.isPending} onClick={() => assign.mutate({ mode: 'existing', id: bulkTarget })}>
              归入
            </Button>
            <Button size="sm" variant="danger" disabled={!checked.length} onClick={() => setConfirmDelete(true)}>
              删除
            </Button>
          </div>
        )}

        <ol className="flex flex-col gap-2">
          {records.map((r) => {
            const m = byId.get(r.memberId)
            const isActive = r.id === active
            const audio = audioOf(r)
            const photos = photosOf(r)
            return (
              <li key={r.id} className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={checked.includes(r.id)}
                  onChange={(e) => setChecked((c) => (e.target.checked ? [...c, r.id] : c.filter((x) => x !== r.id)))}
                  aria-label={`选择：${m?.nickname ?? ''}，${formatRecordTime(r.occurredAt)}`}
                  className="size-[18px] shrink-0 accent-primary"
                />
                <button
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setActive(r.id)}
                  className={cx(
                    'flex min-w-0 flex-1 items-center gap-3 rounded-[14px] bg-surface px-4 py-3 text-left',
                    isActive ? 'ring-2 ring-primary' : 'hover:bg-line-soft',
                  )}
                >
                  {m && <Avatar member={m} size={36} tone="neutral" />}
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[15px]">
                      <span className="font-medium">{m?.nickname}</span>
                      <span className="text-ink-muted">　{formatRecordTime(r.occurredAt)}</span>
                    </span>
                    <span className="flex items-center gap-1.5 truncate text-sm text-ink-muted">
                      {audio.length > 0 ? <MicIcon size={16} /> : photos.length > 0 ? <PhotoIcon size={16} /> : null}
                      <span className="truncate">{recordSummary(r, 30)}</span>
                    </span>
                  </span>
                  {r.type ? <TypeTag type={r.type} /> : <span className="shrink-0 text-xs text-ink-muted">未选类型</span>}
                  {isActive && <span className="shrink-0 text-xs font-medium text-primary">编辑中</span>}
                </button>
              </li>
            )
          })}
        </ol>
      </div>

      <section aria-label="编辑记录" className="sticky top-8 w-[440px] shrink-0 rounded-[20px] bg-surface p-5">
        {activeRecord ? (
          <InboxEditor key={activeRecord.id} record={activeRecord} members={members.filter((m) => !m.archived || m.id === activeRecord.memberId)} />
        ) : (
          <p className="py-16 text-center text-sm text-ink-muted">没有需要整理的记录</p>
        )}
      </section>

      {newEpisodeOpen && (
        <EpisodeSheet
          open
          title="新建病程并归入"
          allowNone={false}
          value={{ mode: 'new', diseaseName: '', kind: 'short' }}
          episodes={[]}
          confirmLabel={assign.isPending ? '处理中…' : '新建并归入'}
          onClose={() => setNewEpisodeOpen(false)}
          onChange={(c) => assign.mutate(c)}
        />
      )}
      <ConfirmDialog
        open={confirmDelete}
        title={`删除选中的 ${checked.length} 条记录？`}
        message="记录和其中的照片、语音都会删除，不能恢复。"
        confirmLabel="删除"
        danger
        busy={bulkDelete.isPending}
        onConfirm={() => bulkDelete.mutate()}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  )
}

const EPISODE_NEW = '__new'
const EPISODE_NONE = ''

/** Desktop edit panel: same fields as 编辑记录, laid out for a side column. No voice capture on desktop. */
function InboxEditor({ record, members }: { record: Record; members: Member[] }) {
  const id = useId()
  const qc = useQueryClient()
  const photoInput = useRef<HTMLInputElement>(null)
  const [draft, setForm] = useState<RecordForm>(() => ({ ...formFromRecord(record), episodeTouched: record.episodeId !== null }))
  const [errors, setErrors] = useState<FormErrors>({})
  const [newEpisodeOpen, setNewEpisodeOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [viewer, setViewer] = useState<number | null>(null)
  const episodes = useEpisodes({ memberId: draft.memberId ?? undefined }, !!draft.memberId)
  const added = useRef(draft.added)
  useLayoutEffect(() => {
    added.current = draft.added
  })
  useEffect(() => () => added.current.forEach((m) => URL.revokeObjectURL(m.url)), [])

  // Suggest the member's current episode (same rule as 记一笔) until one is picked; 暂不归类 stays one click away.
  const suggestion = episodes.data ? defaultEpisode(episodes.data.filter((e) => e.open)).choice : ({ mode: 'none' } as const)
  const form: RecordForm = draft.episodeTouched ? draft : { ...draft, episode: suggestion }

  const change = (patch: Partial<RecordForm>) =>
    setForm((f) => {
      const next = { ...f, ...patch }
      if (patch.episode) next.episodeTouched = true
      if (patch.memberId && patch.memberId !== f.memberId) {
        next.episode = { mode: 'none' }
        next.episodeTouched = false
      }
      return next
    })

  const save = useMutation({
    mutationFn: () => saveEdits(record, form, episodes.data ?? [], members),
    onSuccess: () => {
      invalidateAfterWrite(qc)
      toast(form.episode.mode === 'none' ? '已保存' : '已保存并归入病程')
    },
    onError: (e) => toastError(e),
  })
  const del = useMutation({
    mutationFn: () => api.deleteRecord(record.id),
    onSuccess: () => {
      invalidateAfterWrite(qc)
      toast('已删除')
    },
    onError: (e) => toastError(e),
  })

  async function addPhotos(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, Math.max(0, MAX_PHOTOS - photoCount(form)))
    e.target.value = ''
    const next: LocalMedia[] = []
    for (const file of files) {
      try {
        const { blob } = await compressImage(file)
        next.push({ id: uuidv7(), kind: 'photo', blob, url: URL.createObjectURL(blob), caption: '' })
      } catch (err) {
        toastError(err)
      }
    }
    if (next.length) setForm((f) => ({ ...f, added: [...f.added, ...next] }))
  }

  const episodeValue = form.episode.mode === 'existing' ? form.episode.id : form.episode.mode === 'new' ? EPISODE_NEW : EPISODE_NONE
  const audio = form.existing.filter((a) => a.kind === 'audio' && !form.removed.includes(a.id))
  const photos: (PhotoItem & { local?: boolean })[] = [
    ...form.existing.filter((a) => a.kind === 'photo' && !form.removed.includes(a.id)).map((a) => ({ id: a.id, url: a.url, thumbUrl: a.thumbUrl })),
    ...form.added.filter((m) => m.kind === 'photo').map((m) => ({ id: m.id, url: m.url, local: true })),
  ]
  const labelClass = 'text-[13px] text-ink-muted'
  const fieldClass = 'h-11 rounded-control border border-line bg-field px-3 text-[15px] focus:border-primary focus:outline-none'

  return (
    <div className="flex max-h-[calc(100dvh-6.5rem)] flex-col gap-4 overflow-y-auto pr-1">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <h2 className="text-lg font-bold">编辑记录</h2>
          <span className="text-[13px] text-ink-muted">{formatRecordTime(record.createdAt)} 录入</span>
        </div>
        <button type="button" aria-label="删除这条记录" onClick={() => setConfirmDelete(true)} className="flex size-10 items-center justify-center rounded-[10px] text-alert hover:bg-alert-soft">
          <TrashIcon size={20} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-member`} className={labelClass}>
            成员
          </label>
          <select id={`${id}-member`} value={form.memberId ?? ''} onChange={(e) => change({ memberId: e.target.value })} className={fieldClass}>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nickname}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-when`} className={labelClass}>
            发生时间
          </label>
          <input
            id={`${id}-when`}
            type="datetime-local"
            value={form.occurredAt}
            max={toLocalInput(new Date())}
            onChange={(e) => change({ occurredAt: e.target.value })}
            className={cx(fieldClass, 'px-2 text-sm')}
          />
        </div>
      </div>
      <FieldError>{errors.occurredAt}</FieldError>

      <div className="flex flex-col gap-2">
        <span className={labelClass}>类型</span>
        <TypeSection form={form} errors={errors} onChange={change} bare />
      </div>

      {audio.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className={labelClass}>语音</span>
          {audio.map((a) => (
            <div key={a.id} className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <AudioPlayer src={a.url} durationMs={a.durationMs} seed={a.id} />
                <button
                  type="button"
                  aria-label="删除这段语音"
                  onClick={() => change({ removed: [...form.removed, a.id] })}
                  className="ml-auto flex size-10 items-center justify-center text-ink-muted"
                >
                  <CloseIcon size={18} />
                </button>
              </div>
              <input
                type="text"
                aria-label="语音补充文字"
                placeholder="给这段语音补一句文字"
                value={form.captions[a.id] ?? ''}
                maxLength={200}
                onChange={(e) => change({ captions: { ...form.captions, [a.id]: e.target.value } })}
                className={fieldClass}
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-text`} className={labelClass}>
          文字
        </label>
        <TextArea id={`${id}-text`} rows={2} placeholder="补充说明" value={form.body} onChange={(e) => change({ body: e.target.value })} className="h-20 text-[15px]" />
      </div>

      <div className="flex flex-col gap-2">
        <span className={labelClass}>照片</span>
        <div className="flex flex-wrap gap-2.5">
          {photos.map((p, i) => (
            <div key={p.id} className="relative size-16 overflow-hidden rounded-[10px] bg-line">
              <button type="button" aria-label={`查看照片 ${i + 1}`} onClick={() => setViewer(i)} className="size-full">
                <img src={p.thumbUrl ?? p.url} alt="" className="size-full object-cover" />
              </button>
              <button
                type="button"
                aria-label="删除这张照片"
                onClick={() =>
                  p.local
                    ? change({ added: form.added.filter((m) => m.id !== p.id) })
                    : change({ removed: [...form.removed, p.id] })
                }
                className="absolute top-0.5 right-0.5 flex size-6 items-center justify-center rounded-full bg-ink/80 text-white"
              >
                <CloseIcon size={12} strokeWidth={3} />
              </button>
            </div>
          ))}
          {photoCount(form) < MAX_PHOTOS && (
            <Button size="sm" onClick={() => photoInput.current?.click()} className="h-16 border-dashed">
              <PhotoIcon size={18} />
              添加照片
            </Button>
          )}
        </div>
        <input ref={photoInput} type="file" accept="image/*" multiple hidden onChange={addPhotos} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-episode`} className={labelClass}>
          归入病程
        </label>
        <select
          id={`${id}-episode`}
          value={episodeValue}
          onChange={(e) => {
            if (e.target.value === EPISODE_NEW) setNewEpisodeOpen(true)
            else change({ episode: e.target.value ? { mode: 'existing', id: e.target.value } : { mode: 'none' } })
          }}
          className={fieldClass}
        >
          {episodes.data?.map((e: Episode) => (
            <option key={e.id} value={e.id}>
              {episodeLabel(e)}
            </option>
          ))}
          <option value={EPISODE_NONE}>暂不归类</option>
          {form.episode.mode === 'new' && <option value={EPISODE_NEW}>新建：{form.episode.diseaseName}</option>}
          {form.episode.mode !== 'new' && <option value={EPISODE_NEW}>新建病程…</option>}
        </select>
        {episodes.data?.find((e) => form.episode.mode === 'existing' && e.id === form.episode.id)?.kind === 'long' && (
          <label className="mt-1 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isFlare} onChange={(e) => change({ isFlare: e.target.checked })} className="size-[18px] accent-alert" />
            标记为发作
          </label>
        )}
      </div>

      <div className="flex gap-2.5 pt-1">
        <Button
          block
          variant="primary"
          disabled={save.isPending}
          onClick={() => {
            const errs = validate(form, true)
            setErrors(errs)
            if (!Object.keys(errs).length) save.mutate()
          }}
        >
          {save.isPending ? '保存中…' : '保存'}
        </Button>
        <Button
          className="w-28"
          onClick={() => {
            form.added.forEach((m) => URL.revokeObjectURL(m.url))
            setForm({ ...formFromRecord(record), episodeTouched: record.episodeId !== null })
            setErrors({})
          }}
        >
          取消
        </Button>
      </div>

      {newEpisodeOpen && (
        <EpisodeSheet
          open
          title="新建病程"
          allowNone={false}
          value={{ mode: 'new', diseaseName: '', kind: 'short' }}
          episodes={[]}
          onClose={() => setNewEpisodeOpen(false)}
          onChange={(c) => {
            change({ episode: c })
            setNewEpisodeOpen(false)
          }}
        />
      )}
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
      {viewer !== null && <Lightbox photos={photos} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />}
    </div>
  )
}
