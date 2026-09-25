import dayjs from 'dayjs'
import * as api from '../../api/endpoints'
import type { Episode, Record } from '../../api/types'
import { uploadQueue } from '../../lib/drafts/queue'
import { buildPatch, isEmptyPatch, type RecordForm } from './form'

/** “小明，感冒第 1 天” / “小明，未归入病程”. */
export function recordContext(r: Record, memberName: string | undefined, episode: Episode | undefined): string {
  const who = memberName ?? ''
  if (!episode) return `${who}，未归入病程`
  const day = Math.max(1, dayjs(r.occurredAt).startOf('day').diff(dayjs(episode.startedOn), 'day') + 1)
  return episode.kind === 'short' ? `${who}，${episode.diseaseName}第 ${day} 天` : `${who}，${episode.name}`
}

/**
 * Applies an edit: new episode (if any) → record PATCH → attachment deletions and caption
 * changes → new voice/photos through the upload queue, so they survive a bad network.
 */
export async function saveEdits(record: Record, form: RecordForm, episodes: Episode[], members: { id: string; nickname: string }[]) {
  let f = form
  let eps = episodes
  if (f.episode.mode === 'new') {
    const created = await api.createEpisode({ memberId: f.memberId!, diseaseName: f.episode.diseaseName, kind: f.episode.kind })
    f = { ...f, episode: { mode: 'existing', id: created.id } }
    eps = [...eps, created]
  }
  const patch = buildPatch(record, f, eps)
  if (!isEmptyPatch(patch)) await api.updateRecord(record.id, patch)
  for (const id of f.removed) await api.deleteAttachment(id)
  for (const a of record.attachments) {
    if (f.removed.includes(a.id) || a.kind !== 'audio') continue
    const caption = (f.captions[a.id] ?? '').trim()
    if (caption !== (a.caption ?? '')) await api.updateAttachment(a.id, { caption: caption || null })
  }
  if (f.added.length) {
    const nickname = members.find((m) => m.id === f.memberId)?.nickname ?? ''
    const base = record.attachments.length
    await uploadQueue.enqueue({
      id: record.id,
      attachments: f.added.map((m, i) => ({
        id: m.id,
        kind: m.kind,
        blob: m.blob,
        durationMs: m.durationMs,
        caption: m.caption.trim() || undefined,
        sortOrder: base + i,
      })),
      summary: `${nickname}：补充 ${f.added.length} 个附件`,
    })
  }
}
