import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { getRecord } from '../../api/endpoints'
import { mockDb } from '../../mocks/handlers'
import { server } from '../../test/setup'
import { uuidv7 } from '../id'
import { resetIdbConnection } from './idb'
import { UploadQueue } from './queue'

beforeEach(async () => {
  resetIdbConnection()
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('healthlog')
    req.onsuccess = req.onerror = req.onblocked = () => resolve()
  })
})

function draft(memberId: string) {
  const id = uuidv7()
  return {
    id,
    record: { memberId, occurredAt: new Date().toISOString(), body: '咳嗽' },
    attachments: [
      { id: uuidv7(), kind: 'audio' as const, blob: new Blob(['voice'], { type: 'audio/webm' }), durationMs: 4200, caption: '晚上咳了几声', sortOrder: 0 },
      { id: uuidv7(), kind: 'photo' as const, blob: new Blob(['jpeg'], { type: 'image/jpeg' }), sortOrder: 1 },
    ],
    summary: '小明：咳嗽',
  }
}

describe('UploadQueue', () => {
  it('uploads the record and its attachments, then forgets the draft', async () => {
    const q = new UploadQueue()
    const synced: string[][] = []
    q.onSynced((ids) => synced.push(ids))
    const d = draft(mockDb().members[0].id)

    await q.enqueue(d)
    await q.flush()

    const saved = await getRecord(d.id)
    expect(saved.body).toBe('咳嗽')
    expect(saved.attachments.map((a) => a.kind).sort()).toEqual(['audio', 'photo'])
    expect(saved.attachments.find((a) => a.kind === 'audio')?.caption).toBe('晚上咳了几声')
    expect(q.getState().drafts).toEqual([])
    expect(synced.flat()).toContain(d.id)
  })

  it('keeps the draft while offline and finishes on the next flush', async () => {
    const q = new UploadQueue()
    const d = draft(mockDb().members[0].id)
    server.use(http.put('*/api/attachments/:id', () => HttpResponse.error()))

    await q.enqueue(d)
    await q.flush()
    const kept = q.getState().drafts
    expect(kept).toHaveLength(1)
    expect(kept[0].record).toBeUndefined() // the record itself already reached the server
    expect(kept[0].attachments).toHaveLength(2)
    expect(q.getState().offline).toBe(true)

    // A fresh queue (as after a page reload) picks the draft up from IndexedDB.
    server.resetHandlers()
    const reloaded = new UploadQueue()
    await reloaded.flush()
    expect(reloaded.getState().drafts).toEqual([])
    expect((await getRecord(d.id)).attachments).toHaveLength(2)
  })

  it('marks drafts the server rejects instead of retrying them forever', async () => {
    const q = new UploadQueue()
    const d = { ...draft('00000000-0000-7000-8000-000000000000'), attachments: [] }

    await q.enqueue(d)
    await q.flush()
    const [kept] = q.getState().drafts
    expect(kept.rejected).toBe('成员不存在')

    await q.discard(d.id)
    expect(q.getState().drafts).toEqual([])
  })
})
