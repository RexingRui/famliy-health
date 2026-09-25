// Drafts and the upload queue: a record is written to IndexedDB the moment the user taps
// 保存, then uploaded in the background. Network quality only affects when it reaches the
// server, never whether it is lost. Creation endpoints are idempotent by ID, so a retry simply
// starts over from the record PUT.

import { ApiError } from '../../api/client'
import { putRecord, uploadAttachment } from '../../api/endpoints'
import type { RecordCreate } from '../../api/types'
import { idbDelete, idbGet, idbGetAll, idbPut } from './idb'

export type DraftAttachment = {
  id: string
  kind: 'photo' | 'audio'
  blob: Blob
  durationMs?: number
  caption?: string
  sortOrder: number
}

export type Draft = {
  /** The record ID. */
  id: string
  /** Present until the record itself exists on the server; absent for attachments added to an existing record. */
  record?: RecordCreate
  /** Attachments still to upload; each is removed once the server has it. */
  attachments: DraftAttachment[]
  /** Shown in the pending banner, e.g. “小明：语音 42 秒”. */
  summary: string
  createdAt: number
  attempts: number
  /** Set when the server rejected the draft (validation); such drafts are not retried automatically. */
  rejected?: string
}

export type QueueState = {
  drafts: Draft[]
  syncing: boolean
  /** Last network-level failure, cleared by the next successful upload. */
  offline: boolean
}

type Listener = () => void

/** A server answer that retrying cannot fix. */
function isPermanent(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status >= 400 && err.status < 500 && ![401, 408, 429].includes(err.status)
}

function fileName(a: DraftAttachment): string {
  if (a.kind === 'photo') return 'photo.jpg'
  const t = a.blob.type
  return t.includes('mp4') || t.includes('aac') ? 'voice.m4a' : t.includes('ogg') ? 'voice.ogg' : 'voice.webm'
}

export class UploadQueue {
  private state: QueueState = { drafts: [], syncing: false, offline: false }
  private listeners = new Set<Listener>()
  private syncedListeners = new Set<(recordIds: string[]) => void>()
  private loaded: Promise<void> | null = null
  private flushing: Promise<void> | null = null
  private again = false

  getState = () => this.state

  subscribe = (l: Listener) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  /** Called with the record IDs that finished uploading, to refresh server data. */
  onSynced(l: (recordIds: string[]) => void) {
    this.syncedListeners.add(l)
    return () => this.syncedListeners.delete(l)
  }

  private set(patch: Partial<QueueState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((l) => l())
  }

  load(): Promise<void> {
    this.loaded ??= idbGetAll<Draft>()
      .then((drafts) => this.set({ drafts: drafts.sort((a, b) => a.createdAt - b.createdAt) }))
      .catch(() => this.set({ drafts: [] }))
    return this.loaded
  }

  private async persist(d: Draft) {
    await idbPut(d)
    const others = this.state.drafts.filter((x) => x.id !== d.id)
    this.set({ drafts: [...others, d].sort((a, b) => a.createdAt - b.createdAt) })
  }

  private async remove(id: string) {
    await idbDelete(id)
    this.set({ drafts: this.state.drafts.filter((x) => x.id !== id) })
  }

  /**
   * Stores a draft, merging attachments into an existing draft for the same record, and
   * starts uploading. Resolves once the draft is safely in IndexedDB.
   */
  async enqueue(draft: Omit<Draft, 'attempts' | 'createdAt'> & { createdAt?: number }) {
    await this.load()
    const existing = (await idbGet<Draft>(draft.id)) ?? this.state.drafts.find((d) => d.id === draft.id)
    const merged: Draft = existing
      ? {
          ...existing,
          record: existing.record ?? draft.record,
          attachments: [...existing.attachments, ...draft.attachments.filter((a) => !existing.attachments.some((e) => e.id === a.id))],
          rejected: undefined,
        }
      : { ...draft, createdAt: draft.createdAt ?? Date.now(), attempts: 0 }
    await this.persist(merged)
    void this.flush()
  }

  /** Drops a draft the server rejected (or the user gave up on). */
  async discard(id: string) {
    await this.remove(id)
  }

  /** Clears the rejected mark so the next flush tries again. */
  async retry(id?: string) {
    await this.load()
    for (const d of this.state.drafts) {
      if (d.rejected && (!id || d.id === id)) await this.persist({ ...d, rejected: undefined })
    }
    await this.flush()
  }

  /** Uploads every pending draft in order. Concurrent calls share one run. */
  flush(): Promise<void> {
    if (this.flushing) {
      this.again = true
      return this.flushing
    }
    this.flushing = (async () => {
      await this.load()
      do {
        this.again = false
        await this.runOnce()
      } while (this.again)
    })().finally(() => {
      this.flushing = null
    })
    return this.flushing
  }

  private async runOnce() {
    const pending = this.state.drafts.filter((d) => !d.rejected)
    if (pending.length === 0) return
    this.set({ syncing: true })
    const done: string[] = []
    try {
      for (const d of pending) {
        const ok = await this.upload(d)
        if (ok === 'stop') break
        if (ok === 'done') done.push(d.id)
      }
    } finally {
      this.set({ syncing: false })
      if (done.length) this.syncedListeners.forEach((l) => l(done))
    }
  }

  /** 'done' when the draft is fully on the server, 'kept' when it stays, 'stop' on network loss. */
  private async upload(d: Draft): Promise<'done' | 'kept' | 'stop'> {
    let draft: Draft = { ...d, attempts: d.attempts + 1 }
    try {
      if (draft.record) {
        await putRecord(draft.id, draft.record)
        draft = { ...draft, record: undefined }
        await this.persist(draft)
      }
      for (const a of [...draft.attachments]) {
        await uploadAttachment(a.id, {
          kind: a.kind,
          recordId: draft.id,
          durationMs: a.durationMs,
          caption: a.caption,
          sortOrder: a.sortOrder,
          file: a.blob,
          fileName: fileName(a),
        })
        draft = { ...draft, attachments: draft.attachments.filter((x) => x.id !== a.id) }
        await this.persist(draft)
      }
      await this.remove(draft.id)
      this.set({ offline: false })
      return 'done'
    } catch (err) {
      if (isPermanent(err)) {
        await this.persist({ ...draft, rejected: err.message })
        return 'kept'
      }
      await this.persist(draft)
      if (!(err instanceof ApiError)) this.set({ offline: true })
      return 'stop'
    }
  }
}

export const uploadQueue = new UploadQueue()

/** Local playback/preview for attachments that have not reached the server yet. */
export function pendingAttachmentsFor(recordId: string): DraftAttachment[] {
  return uploadQueue.getState().drafts.find((d) => d.id === recordId)?.attachments ?? []
}
