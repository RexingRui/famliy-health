import type { BloodType, EpisodeKind, EpisodeStatus, Gender, MemberRelation, RecordType } from '../api/types'

export const RECORD_TYPE_LABEL: { [K in RecordType]: string } = {
  symptom: '症状',
  temperature: '体温',
  medication: '用药',
  visit: '就诊',
  treatment: '治疗康复',
  exam: '检查',
  other: '其他',
}

/** Tailwind classes for the type tag: foreground on the soft background. */
export const RECORD_TYPE_TONE: { [K in RecordType]: { fg: string; bg: string; text: string } } = {
  symptom: { fg: 'text-symptom', bg: 'bg-symptom-soft', text: 'text-symptom' },
  temperature: { fg: 'text-temperature', bg: 'bg-temperature-soft', text: 'text-temperature' },
  medication: { fg: 'text-medication', bg: 'bg-medication-soft', text: 'text-medication' },
  visit: { fg: 'text-visit', bg: 'bg-visit-soft', text: 'text-visit' },
  treatment: { fg: 'text-treatment', bg: 'bg-treatment-soft', text: 'text-treatment' },
  exam: { fg: 'text-other', bg: 'bg-other-soft', text: 'text-other' },
  other: { fg: 'text-other', bg: 'bg-other-soft', text: 'text-other' },
}

/** Raw colors for SVG, charts and print. */
export const RECORD_TYPE_COLOR: { [K in RecordType]: string } = {
  symptom: '#B04E15',
  temperature: '#8C560A',
  medication: '#2C679E',
  visit: '#1B2826',
  treatment: '#1E6B58',
  exam: '#4E5D5A',
  other: '#4E5D5A',
}

export const STATUS_LABEL: { [K in EpisodeStatus]: string } = {
  active: '进行中',
  recovered: '已康复',
  treating: '治疗中',
  stable: '稳定期',
  ended: '已结束',
}

export const STATUSES_BY_KIND: { [K in EpisodeKind]: EpisodeStatus[] } = {
  short: ['active', 'recovered'],
  long: ['treating', 'stable', 'ended'],
}

/** Status chip tone: alert for acute states, primary for calm, muted once ended. */
export function statusTone(s: EpisodeStatus): string {
  switch (s) {
    case 'active':
    case 'treating':
      return 'bg-alert-soft text-alert'
    case 'stable':
      return 'bg-primary-soft text-primary'
    default:
      return 'bg-visit-soft text-ink-muted'
  }
}

export const KIND_LABEL: { [K in EpisodeKind]: string } = { short: '短期', long: '长期' }

export const RELATION_LABEL: { [K in MemberRelation]: string } = {
  self: '本人',
  spouse: '配偶',
  child: '子女',
  parent: '父母',
  grandparent: '祖辈',
  other: '其他',
}

export const RELATIONS: MemberRelation[] = ['self', 'spouse', 'child', 'parent', 'grandparent', 'other']

export const GENDER_LABEL: { [K in Gender]: string } = { male: '男', female: '女' }

export const BLOOD_TYPES: BloodType[] = ['A', 'B', 'AB', 'O', 'unknown']

export const BLOOD_LABEL: { [K in BloodType]: string } = { A: 'A', B: 'B', AB: 'AB', O: 'O', unknown: '不清楚' }
