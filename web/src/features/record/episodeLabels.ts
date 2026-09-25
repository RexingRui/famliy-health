import type { Episode } from '../../api/types'
import { STATUS_LABEL } from '../../lib/labels'
import type { EpisodeChoice } from './form'

/** “感冒，第 2 天” for open short episodes, “腰椎间盘突出（治疗中）” otherwise. */
export function episodeLabel(e: Episode): string {
  if (e.kind === 'short' && e.open) return `${e.diseaseName}，第 ${e.days} 天`
  return `${e.name}（${STATUS_LABEL[e.status]}）`
}

export function choiceLabel(choice: EpisodeChoice, episodes: Episode[]): string {
  if (choice.mode === 'none') return '暂不归类，放进待整理'
  if (choice.mode === 'new') return `新建：${choice.diseaseName || '未填病种'}（${choice.kind === 'long' ? '长期' : '短期'}）`
  const e = episodes.find((x) => x.id === choice.id)
  return e ? episodeLabel(e) : '病程'
}
