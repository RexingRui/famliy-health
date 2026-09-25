import { useEffect, useId, useState } from 'react'
import { useLastMedication } from '../../api/hooks'
import { MED_UNITS, RECORD_TYPES, type MedUnit, type RecordDetails } from '../../api/types'
import { ClockIcon } from '../../components/icons'
import { Chip, ChipRow, FieldError, FieldLabel, TextInput } from '../../components/ui'
import { cx } from '../../lib/cx'
import { RECORD_TYPE_LABEL } from '../../lib/labels'
import { formatHoursSince, formatRecordTime } from '../../lib/time/format'
import type { FormErrors, RecordForm } from './form'

type Props = {
  form: RecordForm
  errors: FormErrors
  onChange: (patch: Partial<RecordForm>) => void
  /** Hide the section heading (desktop panel has its own labels). */
  bare?: boolean
}

/** 类型 chips plus the fields that belong to the chosen type. Everything here is optional. */
export function TypeSection({ form, errors, onChange, bare }: Props) {
  return (
    <section aria-label="类型" className={cx('flex flex-col gap-2.5', !bare && 'overflow-hidden rounded-card bg-surface py-3.5 pl-4')}>
      {!bare && (
        <div className="flex items-baseline justify-between pr-4">
          <h2 className="text-[15px] font-bold">类型</h2>
          <span className="text-xs text-ink-muted">选填，选了可补充详细信息</span>
        </div>
      )}
      <ChipRow label="记录类型">
        {RECORD_TYPES.map((t) => (
          <Chip key={t} tone={t} selected={form.type === t} onClick={() => onChange({ type: form.type === t ? null : t })}>
            {RECORD_TYPE_LABEL[t]}
          </Chip>
        ))}
      </ChipRow>
      {form.type && (
        <div className={cx(!bare && 'pr-4')}>
          <TypeFields form={form} errors={errors} onChange={onChange} />
        </div>
      )}
    </section>
  )
}

export function TypeFields({ form, errors, onChange }: Omit<Props, 'bare'>) {
  const id = useId()
  const setDetail = (k: keyof RecordDetails, v: string) => onChange({ details: { ...form.details, [k]: v } })

  switch (form.type) {
    case 'symptom':
      return <SeverityInput value={form.severity} onChange={(severity) => onChange({ severity })} />
    case 'temperature':
      return (
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor={`${id}-t`}>体温</FieldLabel>
          <div className="flex items-center gap-2">
            <TextInput
              id={`${id}-t`}
              inputMode="decimal"
              placeholder="如 38.5"
              value={form.temperature}
              onChange={(e) => onChange({ temperature: e.target.value })}
              className="w-32"
              aria-invalid={!!errors.temperature}
            />
            <span className="text-[15px] text-ink-muted">°C</span>
          </div>
          <FieldError>{errors.temperature}</FieldError>
        </div>
      )
    case 'medication':
      return (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor={`${id}-m`}>药名</FieldLabel>
            <TextInput id={`${id}-m`} value={form.medName} placeholder="如 止咳糖浆" onChange={(e) => onChange({ medName: e.target.value })} />
          </div>
          <div className="flex gap-2.5">
            <div className="flex flex-1 flex-col gap-1.5">
              <FieldLabel htmlFor={`${id}-d`}>剂量</FieldLabel>
              <TextInput
                id={`${id}-d`}
                inputMode="decimal"
                value={form.medDose}
                onChange={(e) => onChange({ medDose: e.target.value })}
                aria-invalid={!!errors.medDose}
              />
            </div>
            <div className="flex w-28 flex-col gap-1.5">
              <FieldLabel htmlFor={`${id}-u`}>单位</FieldLabel>
              <select
                id={`${id}-u`}
                value={form.medUnit}
                onChange={(e) => onChange({ medUnit: e.target.value as MedUnit })}
                className="h-12 rounded-control border border-line bg-field px-3 text-base"
              >
                {MED_UNITS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </div>
          </div>
          <FieldError>{errors.medDose}</FieldError>
          <LastDoseHint memberId={form.memberId} medName={form.medName} />
        </div>
      )
    case 'visit':
    case 'treatment':
    case 'exam': {
      const fields: { key: keyof RecordDetails; label: string; placeholder: string }[] =
        form.type === 'visit'
          ? [
              { key: 'hospital', label: '医院', placeholder: '如 市儿童医院' },
              { key: 'department', label: '科室', placeholder: '如 呼吸科' },
              { key: 'doctor', label: '医生', placeholder: '选填' },
            ]
          : form.type === 'treatment'
            ? [
                { key: 'item', label: '项目', placeholder: '如 理疗、针灸、推拿' },
                { key: 'institution', label: '机构', placeholder: '如 社区康复中心' },
              ]
            : [{ key: 'item', label: '检查项目', placeholder: '如 血常规、胸片' }]
      return (
        <div className="grid grid-cols-2 gap-3">
          {fields.map((f, i) => (
            <div key={f.key} className={cx('flex flex-col gap-1.5', i === 0 && fields.length !== 2 && 'col-span-2', fields.length === 1 && 'col-span-2')}>
              <FieldLabel htmlFor={`${id}-${f.key}`}>{f.label}</FieldLabel>
              <TextInput
                id={`${id}-${f.key}`}
                value={form.details[f.key] ?? ''}
                placeholder={f.placeholder}
                onChange={(e) => setDetail(f.key, e.target.value)}
              />
            </div>
          ))}
          {form.type !== 'exam' && (
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor={`${id}-c`}>费用（元）</FieldLabel>
              <TextInput
                id={`${id}-c`}
                inputMode="decimal"
                value={form.cost}
                onChange={(e) => onChange({ cost: e.target.value })}
                aria-invalid={!!errors.cost}
              />
              <FieldError>{errors.cost}</FieldError>
            </div>
          )}
        </div>
      )
    }
    default:
      return null
  }
}

/** 0–10 slider that can also be left empty (“未填”). */
export function SeverityInput({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const id = useId()
  return (
    <div className="flex items-center gap-3">
      <label htmlFor={id} className="shrink-0 text-[13px] text-ink-muted">
        程度
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={10}
        step={1}
        value={value ?? 0}
        onChange={(e) => onChange(Number(e.target.value))}
        onClick={(e) => value === null && onChange(Number(e.currentTarget.value))}
        aria-valuetext={value === null ? '未填' : `${value} 分`}
        className={cx('h-11 flex-1 accent-symptom', value === null && 'opacity-40')}
      />
      <span className="w-10 shrink-0 text-right text-[13px] text-ink-muted tabular-nums">{value === null ? '未填' : `${value} 分`}</span>
      {value !== null && (
        <button type="button" onClick={() => onChange(null)} className="h-11 shrink-0 text-[13px] text-primary">
          清除
        </button>
      )}
    </div>
  )
}

/** “止咳糖浆上次服用是今天 14:10，距现在 7 小时 35 分钟”. Only recorded facts, no dosing advice. */
export function LastDoseHint({ memberId, medName }: { memberId: string | null; medName: string }) {
  const [debounced, setDebounced] = useState(medName.trim())
  useEffect(() => {
    const t = setTimeout(() => setDebounced(medName.trim()), 400)
    return () => clearTimeout(t)
  }, [medName])
  const last = useLastMedication(memberId ?? undefined, debounced)
  const dose = last.data?.last
  if (!dose) return null
  return (
    <div className="flex items-start gap-2.5 rounded-control bg-medication-soft p-3 text-sm leading-normal text-medication">
      <ClockIcon size={20} className="mt-px shrink-0" />
      <span>
        {dose.medName}上次服用是{formatRecordTime(dose.occurredAt)}，距现在 {formatHoursSince(dose.hoursSince)}
      </span>
    </div>
  )
}
