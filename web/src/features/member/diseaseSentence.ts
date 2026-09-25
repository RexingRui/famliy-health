import type { ByDiseaseRange, DiseaseSummary } from '../../api/types'

export const RANGE_LABEL: { [K in ByDiseaseRange]: string } = { '1y': '近一年', '3y': '近三年', all: '全部' }

/** “近一年 4 次。已康复的 3 次平均持续 5.7 天，最长 8 天。用得最多的药是退烧药和止咳糖浆，各 3 次。” */
export function diseaseSentence(d: DiseaseSummary, range: ByDiseaseRange): string {
  const parts = [`${RANGE_LABEL[range]} ${d.episodeCount} 次`]
  const ended = d.episodes.filter((x) => !x.episode.open).length
  if (d.recoveredAvgDays !== null && ended > 0) {
    parts.push(`已结束的 ${ended} 次平均持续 ${Number.isInteger(d.recoveredAvgDays) ? d.recoveredAvgDays : d.recoveredAvgDays.toFixed(1)} 天${d.maxDays ? `，最长 ${d.maxDays} 天` : ''}`)
  }
  const top = d.topMedications
  if (top.length) {
    const best = top.filter((t) => t.count === top[0].count)
    parts.push(
      best.length > 1
        ? `用得最多的药是${best.map((t) => t.name).join('和')}，各 ${best[0].count} 次`
        : `用得最多的药是${best[0].name}，${best[0].count} 次`,
    )
  }
  return `${parts.join('。')}。`
}
