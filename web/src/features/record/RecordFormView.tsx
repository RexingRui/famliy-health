import { useId, useRef, useState, type ChangeEvent } from 'react'
import type { Episode, Member } from '../../api/types'
import { AudioPlayer } from '../../components/AudioPlayer'
import { CameraIcon, ChevronRightIcon, CloseIcon, MicIcon, PhotoIcon, PlusIcon } from '../../components/icons'
import { Lightbox, type PhotoItem } from '../../components/Photos'
import { toast, toastError } from '../../lib/toast'
import { Chip, ChipRow, FieldError } from '../../components/ui'
import { cx } from '../../lib/cx'
import { uuidv7 } from '../../lib/id'
import { compressImage } from '../../lib/image/compress'
import type { VoiceRecorder } from '../../lib/recorder/recorder'
import { formatRecordTime, toLocalInput } from '../../lib/time/format'
import { EpisodeRow } from './EpisodePicker'
import { MAX_PHOTOS, photoCount, type EpisodeChoice, type FormErrors, type LocalMedia, type RecordForm } from './form'
import { RecordButton } from './RecordButton'
import { TypeSection } from './TypeFields'

type Props = {
  mode: 'new' | 'edit'
  form: RecordForm
  errors: FormErrors
  onChange: (patch: Partial<RecordForm>) => void
  members: Member[]
  episodes: Episode[]
  expandEpisodes: boolean
  onEpisodeChange: (c: EpisodeChoice) => void
  recorder: VoiceRecorder
  /** Edit mode: the record's entry time, shown as “录入于 …”. */
  createdAt?: string
  /** Voice and camera capture; off on desktop, where only photos from files can be added. */
  canRecord?: boolean
}

/** Member, time, text, voice, photos, type and episode: the body of 记一笔 and 编辑记录. */
export function RecordFormView({
  mode,
  form,
  errors,
  onChange,
  members,
  episodes,
  expandEpisodes,
  onEpisodeChange,
  recorder,
  createdAt,
  canRecord = true,
}: Props) {
  const id = useId()
  const camera = useRef<HTMLInputElement>(null)
  const album = useRef<HTMLInputElement>(null)
  const [processing, setProcessing] = useState(0)
  const [viewer, setViewer] = useState<number | null>(null)

  const selectedEpisode = form.episode.mode === 'existing' ? episodes.find((e) => e.id === (form.episode as { id: string }).id) : undefined
  const existingAudio = form.existing.filter((a) => a.kind === 'audio' && !form.removed.includes(a.id))
  const existingPhotos = form.existing.filter((a) => a.kind === 'photo' && !form.removed.includes(a.id))
  const newAudio = form.added.filter((m) => m.kind === 'audio')
  const newPhotos = form.added.filter((m) => m.kind === 'photo')
  const photos: (PhotoItem & { local?: boolean })[] = [
    ...existingPhotos.map((a) => ({ id: a.id, url: a.url, thumbUrl: a.thumbUrl })),
    ...newPhotos.map((m) => ({ id: m.id, url: m.url, local: true })),
  ]

  async function addPhotos(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    const room = MAX_PHOTOS - photoCount(form)
    if (files.length > room) toast(`每条最多 ${MAX_PHOTOS} 张照片，多出的没有加入`)
    const picked = files.slice(0, Math.max(0, room))
    setProcessing((n) => n + picked.length)
    const added: LocalMedia[] = []
    for (const file of picked) {
      try {
        const { blob } = await compressImage(file)
        added.push({ id: uuidv7(), kind: 'photo', blob, url: URL.createObjectURL(blob), caption: '' })
      } catch (err) {
        toastError(err)
      } finally {
        setProcessing((n) => n - 1)
      }
    }
    if (added.length) onChange({ added: [...form.added, ...added] })
  }

  function removeAdded(mediaId: string) {
    const m = form.added.find((x) => x.id === mediaId)
    if (m) URL.revokeObjectURL(m.url)
    onChange({ added: form.added.filter((x) => x.id !== mediaId) })
  }

  const photoTile = 'relative size-16 shrink-0 overflow-hidden rounded-[10px] bg-line'
  const removeBtn =
    'absolute -top-2 -right-2 flex size-[26px] items-center justify-center rounded-full border-2 border-white bg-ink p-0 text-white'

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <span id={`${id}-who`} className="text-[13px] text-ink-muted">
          {mode === 'new' ? '给谁记' : '成员'}
        </span>
        <ChipRow label={mode === 'new' ? '给谁记' : '成员'}>
          {members.map((m) => (
            <Chip
              key={m.id}
              selected={form.memberId === m.id}
              onClick={() => onChange({ memberId: m.id })}
              className="rounded-full px-5 text-[15px]"
            >
              {m.nickname}
            </Chip>
          ))}
        </ChipRow>
        <FieldError>{errors.memberId}</FieldError>
      </div>

      <section aria-label="记录内容" className="flex flex-col gap-2.5 rounded-card bg-surface px-4 pt-2 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[13px] text-ink-muted">发生时间</span>
            {createdAt && <span className="text-xs text-ink-muted">录入于 {formatRecordTime(createdAt)}</span>}
          </div>
          <label className="relative flex h-11 cursor-pointer items-center gap-1 pl-3 text-[15px] font-medium">
            {form.occurredAt ? formatRecordTime(form.occurredAt) : '选择时间'}
            <ChevronRightIcon size={18} className="text-ink-muted" />
            <input
              type="datetime-local"
              aria-label="发生时间"
              value={form.occurredAt}
              max={toLocalInput(new Date())}
              onChange={(e) => onChange({ occurredAt: e.target.value })}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
        </div>
        <FieldError>{errors.occurredAt}</FieldError>
        <textarea
          aria-label="文字记录"
          rows={3}
          value={form.body}
          maxLength={5000}
          placeholder="打几个字，或者按住下面的按钮说话"
          onChange={(e) => onChange({ body: e.target.value })}
          className="h-[76px] w-full resize-none rounded-control border border-line bg-field px-3 py-2.5 text-base leading-relaxed placeholder:text-ink-subtle focus:border-primary focus:outline-none"
        />

        {existingAudio.map((a) => (
          <div key={a.id} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              {a.status === 'failed' ? (
                <span className="text-sm text-alert">语音处理失败</span>
              ) : (
                <AudioPlayer src={a.url} durationMs={a.durationMs} seed={a.id} />
              )}
              <button
                type="button"
                aria-label="删除这段语音"
                onClick={() => onChange({ removed: [...form.removed, a.id] })}
                className="ml-auto flex size-10 items-center justify-center text-ink-muted"
              >
                <CloseIcon size={18} />
              </button>
            </div>
            <input
              type="text"
              aria-label="给这段语音补一句文字"
              placeholder="给这段语音补一句文字"
              maxLength={200}
              value={form.captions[a.id] ?? ''}
              onChange={(e) => onChange({ captions: { ...form.captions, [a.id]: e.target.value } })}
              className="h-11 rounded-control border border-line bg-field px-3 text-[15px] placeholder:text-ink-subtle focus:border-primary focus:outline-none"
            />
          </div>
        ))}
        {newAudio.map((m) => (
          <NewClip key={m.id} media={m} isEdit={mode === 'edit'} onCaption={(caption) => onChange({ added: form.added.map((x) => (x.id === m.id ? { ...x, caption } : x)) })} onRemove={() => removeAdded(m.id)} />
        ))}

        {(photos.length > 0 || mode === 'edit' || processing > 0) && (
          <div className="flex flex-wrap gap-2.5 pt-2">
            {photos.map((p, i) => (
              <div key={p.id} className={photoTile}>
                <button type="button" aria-label={`查看照片 ${i + 1}`} onClick={() => setViewer(i)} className="size-full">
                  <img src={p.thumbUrl ?? p.url} alt="" className="size-full object-cover" />
                </button>
                <button
                  type="button"
                  aria-label="删除这张照片"
                  onClick={() => (p.local ? removeAdded(p.id) : onChange({ removed: [...form.removed, p.id] }))}
                  className={removeBtn}
                >
                  <CloseIcon size={12} strokeWidth={3} />
                </button>
              </div>
            ))}
            {Array.from({ length: processing }, (_, i) => (
              <div key={`p${i}`} className={cx(photoTile, 'animate-pulse')} aria-label="正在处理照片" />
            ))}
            {mode === 'edit' && photoCount(form) < MAX_PHOTOS && (
              <button
                type="button"
                aria-label="添加照片"
                onClick={() => album.current?.click()}
                className="flex size-16 items-center justify-center rounded-[10px] border-[1.5px] border-dashed border-ink-subtle bg-surface text-ink-muted"
              >
                <PlusIcon size={22} />
              </button>
            )}
          </div>
        )}
        <FieldError>{errors.content}</FieldError>
      </section>

      <div className={cx('flex gap-2.5', !canRecord && 'hidden')}>
        <RecordButton
          recorder={recorder}
          onClip={(clip) =>
            onChange({
              added: [
                ...form.added,
                { id: uuidv7(), kind: 'audio', blob: clip.blob, url: URL.createObjectURL(clip.blob), durationMs: clip.durationMs, caption: '' },
              ],
            })
          }
          className={cx(
            'flex flex-1 items-center justify-center gap-2.5 rounded-full bg-primary font-bold text-white',
            mode === 'new' ? 'h-[60px] text-[17px]' : 'h-14 text-base',
          )}
        >
          <MicIcon size={mode === 'new' ? 26 : 24} strokeWidth={2} />
          {mode === 'new' ? '按住说话' : '按住说话，再补一段'}
        </RecordButton>
        <button
          type="button"
          aria-label="拍照"
          onClick={() => camera.current?.click()}
          className={cx(
            'flex shrink-0 items-center justify-center rounded-full border border-line bg-surface',
            mode === 'new' ? 'size-[60px]' : 'size-14',
          )}
        >
          <CameraIcon />
        </button>
        {mode === 'new' && (
          <button
            type="button"
            aria-label="从相册选择"
            onClick={() => album.current?.click()}
            className="flex size-[60px] shrink-0 items-center justify-center rounded-full border border-line bg-surface"
          >
            <PhotoIcon />
          </button>
        )}
      </div>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={addPhotos} />
      <input ref={album} type="file" accept="image/*" multiple hidden onChange={addPhotos} />

      <TypeSection form={form} errors={errors} onChange={onChange} />

      <EpisodeRow
        value={form.episode}
        episodes={episodes}
        onChange={onEpisodeChange}
        expanded={expandEpisodes}
        error={errors.episode}
        disabled={!form.memberId}
      />
      {selectedEpisode?.kind === 'long' && (
        <label className="flex h-12 items-center gap-3 rounded-card bg-surface px-4 text-[15px]">
          <input
            type="checkbox"
            checked={form.isFlare}
            onChange={(e) => onChange({ isFlare: e.target.checked })}
            className="size-5 accent-alert"
          />
          <span className="flex-1">标记为发作</span>
          <span className="text-xs text-ink-muted">急性发作或加重时勾选</span>
        </label>
      )}

      {viewer !== null && <Lightbox photos={photos} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />}
    </div>
  )
}

function NewClip({
  media,
  isEdit,
  onCaption,
  onRemove,
}: {
  media: LocalMedia
  isEdit: boolean
  onCaption: (c: string) => void
  onRemove: () => void
}) {
  const [showCaption, setShowCaption] = useState(media.caption !== '' || isEdit)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <AudioPlayer src={media.url} durationMs={media.durationMs ?? null} seed={media.id} />
        {isEdit && <span className="rounded-md bg-primary-soft px-2 py-0.5 text-xs font-bold text-primary">新补录</span>}
        {!showCaption && (
          <button type="button" onClick={() => setShowCaption(true)} className="h-11 px-2 text-sm font-medium whitespace-nowrap text-primary">
            给语音补一句文字
          </button>
        )}
        <button type="button" aria-label="删除这段语音" onClick={onRemove} className="ml-auto flex size-10 items-center justify-center text-ink-muted">
          <CloseIcon size={18} />
        </button>
      </div>
      {showCaption && (
        <input
          type="text"
          aria-label="给这段语音补一句文字"
          placeholder="给这段语音补一句文字"
          maxLength={200}
          value={media.caption}
          autoFocus={!isEdit}
          onChange={(e) => onCaption(e.target.value)}
          className="h-11 rounded-control border border-line bg-field px-3 text-[15px] placeholder:text-ink-subtle focus:border-primary focus:outline-none"
        />
      )}
    </div>
  )
}
