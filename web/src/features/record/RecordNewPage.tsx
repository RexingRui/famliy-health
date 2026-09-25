import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useEpisodes, useMembers, useRecord } from '../../api/hooks'
import type { Record } from '../../api/types'
import { useIsDesktop } from '../../app/useIsDesktop'
import { ConfirmDialog } from '../../components/Sheet'
import { toast, toastError } from '../../lib/toast'
import { BottomBar, Button, EmptyState, ErrorState, PageHeader, Spinner } from '../../components/ui'
import { uploadQueue } from '../../lib/drafts/queue'
import { RECORD_TYPE_LABEL } from '../../lib/labels'
import { VoiceRecorder } from '../../lib/recorder/recorder'
import { formatClipWords } from '../../lib/time/format'
import { buildCreate, defaultEpisode, emptyForm, validate, type EpisodeChoice, type FormErrors, type RecordForm } from './form'
import { RecordFormView } from './RecordFormView'
import { recordTypeOrNull } from './form'
import { uuidv7 } from '../../lib/id'

const LAST_MEMBER_KEY = 'healthlog.lastMember'

function lastMember(): string | null {
  try {
    return localStorage.getItem(LAST_MEMBER_KEY)
  } catch {
    return null
  }
}

function rememberMember(id: string) {
  try {
    localStorage.setItem(LAST_MEMBER_KEY, id)
  } catch {
    // private mode: the default just falls back to the first member
  }
}

/** “小明：语音 42 秒” for the pending-upload list. */
function draftSummary(nickname: string, f: RecordForm): string {
  const audio = f.added.filter((m) => m.kind === 'audio')
  const photos = f.added.filter((m) => m.kind === 'photo')
  const what =
    f.body.trim().slice(0, 20) ||
    (audio.length ? `语音 ${formatClipWords(audio.reduce((s, a) => s + (a.durationMs ?? 0), 0))}` : '') ||
    (photos.length ? `照片 ${photos.length} 张` : '') ||
    (f.type ? RECORD_TYPE_LABEL[f.type] : '记录')
  return `${nickname}：${what}`
}

/** 记一笔: phone only. `?memberId`, `?episodeId` preselect; `?copy=<recordId>` is 再记一次 for a dose. */
export function RecordNewPage() {
  const isDesktop = useIsDesktop()
  if (isDesktop) {
    return (
      <div className="flex max-w-lg flex-col gap-4">
        <h1 className="font-display text-3xl">记一笔</h1>
        <EmptyState title="记录只在手机上进行">
          <p className="text-sm text-ink-muted">用手机浏览器打开本站即可录音、拍照。电脑上可以在“待整理”里修改记录。</p>
          <Link to="/inbox" className="text-sm font-medium text-primary">
            去待整理
          </Link>
        </EmptyState>
      </div>
    )
  }
  return <RecordNew />
}

function RecordNew() {
  const [params] = useSearchParams()
  const copyId = params.get('copy') ?? undefined
  const copy = useRecord(copyId)
  const members = useMembers()

  if (members.isPending || (copyId && copy.isPending)) return <Spinner />
  if (members.isError) return <ErrorState error={members.error} onRetry={() => void members.refetch()} />
  if (members.data.length === 0) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <PageHeader back="/" backLabel="取消" title="记一笔" />
        <EmptyState title="先添加一位家人，再开始记录">
          <Link to="/members/new" className="text-[15px] font-medium text-primary">
            添加成员
          </Link>
        </EmptyState>
      </div>
    )
  }
  return <RecordNewForm members={members.data} copy={copy.data} />
}

function RecordNewForm({ members, copy }: { members: NonNullable<ReturnType<typeof useMembers>['data']>; copy?: Record }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const paramEpisode = params.get('episodeId') ?? copy?.episodeId ?? null
  const returnTo = params.get('returnTo') ?? (paramEpisode ? `/episodes/${paramEpisode}` : '/')

  const [form, setForm] = useState<RecordForm>(() => {
    const valid = (id: string | null | undefined) => (id && members.some((m) => m.id === id) ? id : null)
    const memberId = valid(params.get('memberId')) ?? valid(copy?.memberId) ?? valid(lastMember()) ?? members[0].id
    const f = emptyForm(memberId)
    const presetType = recordTypeOrNull(params.get('type'))
    if (copy?.type === 'medication') {
      return { ...f, type: 'medication', medName: copy.medName ?? '', medDose: copy.medDose !== null ? String(copy.medDose) : '', medUnit: copy.medUnit ?? 'ml' }
    }
    return presetType ? { ...f, type: presetType } : f
  })
  const [errors, setErrors] = useState<FormErrors>({})
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [saving, setSaving] = useState(false)
  const recorder = useMemo(() => new VoiceRecorder(), [])
  const added = useRef(form.added)
  useLayoutEffect(() => {
    added.current = form.added
  })

  const episodes = useEpisodes({ memberId: form.memberId ?? undefined }, !!form.memberId)

  // Keep the microphone warm while on this page; release it and preview URLs on leave.
  useEffect(() => {
    void recorder.warmUp()
    return () => {
      recorder.release()
      added.current.forEach((m) => URL.revokeObjectURL(m.url))
    }
  }, [recorder])

  // Default episode for the chosen member, used until the user picks one.
  const suggestion = useMemo((): { choice: EpisodeChoice; expand: boolean } => {
    if (!episodes.data) return { choice: { mode: 'none' }, expand: false }
    const forced = paramEpisode ? episodes.data.find((e) => e.id === paramEpisode) : undefined
    if (forced) return { choice: { mode: 'existing', id: forced.id }, expand: false }
    return defaultEpisode(episodes.data.filter((e) => e.open))
  }, [episodes.data, paramEpisode])
  const effective: RecordForm = form.episodeTouched ? form : { ...form, episode: suggestion.choice }

  const change = (patch: Partial<RecordForm>) => {
    setForm((f) => {
      const next = { ...f, ...patch }
      // Another member's episodes do not apply.
      if (patch.memberId && patch.memberId !== f.memberId) {
        next.episode = { mode: 'none' }
        next.episodeTouched = false
        next.isFlare = false
      }
      return next
    })
    if (Object.keys(errors).length) setErrors({})
  }

  const dirty = form.body.trim() !== '' || form.added.length > 0 || form.type !== null

  async function save() {
    const errs = validate(effective)
    setErrors(errs)
    if (Object.keys(errs).length) return
    setSaving(true)
    try {
      const id = uuidv7()
      const member = members.find((m) => m.id === form.memberId)!
      await uploadQueue.enqueue({
        id,
        record: buildCreate(effective, episodes.data ?? []),
        attachments: form.added.map((m, i) => ({
          id: m.id,
          kind: m.kind,
          blob: m.blob,
          durationMs: m.durationMs,
          caption: m.caption.trim() || undefined,
          sortOrder: i,
        })),
        summary: draftSummary(member.nickname, form),
      })
      rememberMember(member.id)
      toast('已保存')
      navigate(returnTo, { replace: true })
    } catch (err) {
      // IndexedDB unavailable (private mode quota etc.): nothing was stored.
      toastError(err, '保存失败，请重试')
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader
        title="记一笔"
        left={
          <button
            type="button"
            onClick={() => (dirty ? setConfirmLeave(true) : navigate(returnTo))}
            className="flex h-11 items-center px-3 text-base text-ink-muted"
          >
            取消
          </button>
        }
      />
      <div className="flex flex-col gap-3 px-4 pb-4">
        <RecordFormView
          mode="new"
          form={effective}
          errors={errors}
          onChange={change}
          members={members}
          episodes={episodes.data ?? []}
          expandEpisodes={suggestion.expand}
          onEpisodeChange={(episode) => change({ episode, episodeTouched: true, isFlare: false })}
          recorder={recorder}
        />
      </div>
      <BottomBar className="border-t-0">
        <Button block size="lg" variant="dark" onClick={() => void save()} disabled={saving}>
          {saving ? '保存中…' : '保存'}
        </Button>
      </BottomBar>
      <ConfirmDialog
        open={confirmLeave}
        title="放弃这条记录？"
        message="还没保存，离开后内容会丢失。"
        confirmLabel="放弃"
        danger
        onConfirm={() => navigate(returnTo)}
        onClose={() => setConfirmLeave(false)}
      />
    </div>
  )
}
