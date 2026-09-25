import { useId, useState } from 'react'
import { useDiseaseTags } from '../../api/hooks'
import type { Episode, EpisodeKind } from '../../api/types'
import { Sheet } from '../../components/Sheet'
import { CheckIcon, ChevronRightIcon } from '../../components/icons'
import { Button, FieldError, Segmented, TextInput } from '../../components/ui'
import { cx } from '../../lib/cx'
import { STATUS_LABEL } from '../../lib/labels'
import { choiceLabel, episodeLabel } from './episodeLabels'
import type { EpisodeChoice } from './form'

function dotClass(choice: EpisodeChoice, episodes: Episode[]): string {
  if (choice.mode !== 'existing') return 'bg-ink-subtle'
  const e = episodes.find((x) => x.id === choice.id)
  if (!e) return 'bg-ink-subtle'
  return e.status === 'active' || e.status === 'treating' ? 'bg-alert' : e.open ? 'bg-primary' : 'bg-ink-subtle'
}

/**
 * 归入病程 row with 更换. When the member has several open episodes the choices are listed
 * inline (product rule), otherwise they live in a sheet.
 */
export function EpisodeRow({
  value,
  episodes,
  onChange,
  expanded,
  error,
  disabled,
}: {
  value: EpisodeChoice
  episodes: Episode[]
  onChange: (c: EpisodeChoice) => void
  expanded?: boolean
  error?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const openEpisodes = episodes.filter((e) => e.open)

  return (
    <section aria-label="归入病程" className="flex flex-col rounded-card bg-surface">
      <div className="flex items-center gap-3 py-2.5 pr-2 pl-4">
        <span className={cx('size-2.5 shrink-0 rounded-full', dotClass(value, episodes))} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-xs text-ink-muted">归入病程</span>
          <span className="truncate text-[15px] font-medium">{choiceLabel(value, episodes)}</span>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className="flex h-11 items-center gap-0.5 pr-2 pl-3 text-sm font-medium text-primary disabled:text-ink-subtle"
        >
          更换
          <ChevronRightIcon size={18} />
        </button>
      </div>
      {expanded && openEpisodes.length > 1 && (
        <div role="radiogroup" aria-label="选择病程" className="flex flex-col border-t border-line-soft px-2 py-1">
          {openEpisodes.map((e) => {
            const selected = value.mode === 'existing' && value.id === e.id
            return (
              <button
                key={e.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange({ mode: 'existing', id: e.id })}
                className="flex h-11 items-center gap-2 rounded-[10px] px-2 text-left text-[15px]"
              >
                <span className={cx('flex size-5 items-center justify-center rounded-full border', selected ? 'border-primary bg-primary text-white' : 'border-line')}>
                  {selected && <CheckIcon size={14} />}
                </span>
                {episodeLabel(e)}
              </button>
            )
          })}
        </div>
      )}
      <FieldError>{error && <span className="block px-4 pb-3">{error}</span>}</FieldError>
      {open && (
        <EpisodeSheet
          open
          onClose={() => setOpen(false)}
          value={value}
          episodes={episodes}
          onChange={(c) => {
            onChange(c)
            setOpen(false)
          }}
        />
      )}
    </section>
  )
}

/**
 * Choose an episode, 暂不归类, or create a new one (disease name + short/long). Mount it only
 * while open so its draft state starts from the current value.
 */
export function EpisodeSheet({
  open,
  onClose,
  value,
  episodes,
  onChange,
  title = '归入病程',
  allowNone = true,
  confirmLabel,
}: {
  open: boolean
  onClose: () => void
  value: EpisodeChoice
  episodes: Episode[]
  onChange: (c: EpisodeChoice) => void
  title?: string
  allowNone?: boolean
  confirmLabel?: string
}) {
  const id = useId()
  const tags = useDiseaseTags()
  const [showClosed, setShowClosed] = useState(false)
  const [draft, setDraft] = useState<EpisodeChoice>(value)
  const [creating, setCreating] = useState(value.mode === 'new')
  const [disease, setDisease] = useState(value.mode === 'new' ? value.diseaseName : '')
  const [kind, setKind] = useState<EpisodeKind>(value.mode === 'new' ? value.kind : 'short')
  const [error, setError] = useState('')

  const openEps = episodes.filter((e) => e.open)
  const closedEps = episodes.filter((e) => !e.open)

  const option = (key: string, label: string, sub: string | null, selected: boolean, choose: () => void) => (
    <button
      key={key}
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => {
        setCreating(false)
        choose()
      }}
      className={cx(
        'flex min-h-[52px] items-center gap-3 rounded-control border px-3 text-left',
        selected ? 'border-[1.5px] border-primary bg-primary-soft' : 'border-line bg-surface',
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-medium">{label}</span>
        {sub && <span className="text-xs text-ink-muted">{sub}</span>}
      </span>
      {selected && <CheckIcon size={18} className="text-primary" />}
    </button>
  )

  function confirm() {
    if (creating) {
      if (!disease.trim()) {
        setError('请填写病种，比如“发烧”，确诊后可以再改')
        return
      }
      onChange({ mode: 'new', diseaseName: disease.trim(), kind })
    } else {
      onChange(draft)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <Button block size="lg" variant="primary" onClick={confirm}>
          {confirmLabel ?? '确定'}
        </Button>
      }
    >
      <div role="radiogroup" aria-label={title} className="flex flex-col gap-2">
        {openEps.length > 0 && <span className="pt-1 text-xs text-ink-muted">未结束的病程</span>}
        {openEps.map((e) =>
          option(e.id, e.name, `${STATUS_LABEL[e.status]}，${e.kind === 'short' ? `第 ${e.days} 天` : `共 ${e.recordCount} 条记录`}`, !creating && draft.mode === 'existing' && draft.id === e.id, () =>
            setDraft({ mode: 'existing', id: e.id }),
          ),
        )}
        {closedEps.length > 0 && (
          <button type="button" onClick={() => setShowClosed((v) => !v)} className="h-9 self-start text-sm text-primary">
            {showClosed ? '收起已结束的病程' : `已结束的病程（${closedEps.length}）`}
          </button>
        )}
        {showClosed &&
          closedEps.map((e) =>
            option(e.id, e.name, `${STATUS_LABEL[e.status]}，${e.startedOn} 起`, !creating && draft.mode === 'existing' && draft.id === e.id, () =>
              setDraft({ mode: 'existing', id: e.id }),
            ),
          )}
        {allowNone && option('none', '暂不归类', '放进待整理，之后再归入', !creating && draft.mode === 'none', () => setDraft({ mode: 'none' }))}
        <button
          type="button"
          role="radio"
          aria-checked={creating}
          onClick={() => setCreating(true)}
          className={cx(
            'flex min-h-[52px] items-center gap-3 rounded-control border px-3 text-left text-[15px] font-medium',
            creating ? 'border-[1.5px] border-primary bg-primary-soft' : 'border-dashed border-ink-subtle text-primary',
          )}
        >
          + 新建病程
        </button>
        {creating && (
          <div className="flex flex-col gap-3 rounded-control bg-page p-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-disease`} className="text-[13px] text-ink-muted">
                病种（不确定可以先填症状，比如“发烧”）
              </label>
              <TextInput
                id={`${id}-disease`}
                list={`${id}-tags`}
                value={disease}
                maxLength={30}
                onChange={(e) => {
                  setDisease(e.target.value)
                  setError('')
                }}
                placeholder="如 感冒"
                className="bg-surface"
              />
              <datalist id={`${id}-tags`}>
                {tags.data?.map((t) => (
                  <option key={t.id} value={t.name} />
                ))}
              </datalist>
              <FieldError>{error}</FieldError>
            </div>
            <Segmented<EpisodeKind>
              label="病程类型"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'short', label: '短期（感冒、发烧）' },
                { value: 'long', label: '长期（哮喘、高血压）' },
              ]}
            />
          </div>
        )}
      </div>
    </Sheet>
  )
}
