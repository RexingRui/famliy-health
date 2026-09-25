import { useState } from 'react'
import { Sheet } from '../../components/Sheet'
import { AlertIcon, UploadIcon } from '../../components/icons'
import { Button } from '../../components/ui'
import { cx } from '../../lib/cx'
import { uploadQueue } from '../../lib/drafts/queue'
import { useUploadQueue } from '../../lib/drafts/useUploadQueue'

/** “有 2 条还没上传”: shown while drafts wait in IndexedDB; tap to retry or review. */
export function PendingUploadsBanner({ className }: { className?: string }) {
  const { drafts, syncing, offline } = useUploadQueue()
  const [open, setOpen] = useState(false)
  if (drafts.length === 0) return null

  const rejected = drafts.filter((d) => d.rejected)
  const waiting = drafts.length - rejected.length
  const text = rejected.length
    ? `有 ${rejected.length} 条保存失败，点这里处理`
    : syncing
      ? `正在上传 ${waiting} 条记录…`
      : `有 ${waiting} 条还没上传${offline ? '，网络恢复后自动重试' : ''}`

  return (
    <>
      <button
        type="button"
        onClick={() => (rejected.length ? setOpen(true) : void uploadQueue.retry())}
        className={cx(
          'flex w-full items-center gap-2.5 rounded-control px-4 py-3 text-left text-sm',
          rejected.length ? 'bg-alert-soft text-alert' : 'bg-medication-soft text-medication',
          className,
        )}
      >
        {rejected.length ? <AlertIcon size={20} /> : <UploadIcon size={20} className={syncing ? 'animate-pulse' : ''} />}
        <span className="flex-1">{text}</span>
        {!rejected.length && !syncing && <span className="font-medium">重试</span>}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="保存失败的记录">
        <ul className="flex flex-col gap-3">
          {rejected.map((d) => (
            <li key={d.id} className="flex flex-col gap-2 rounded-control bg-page p-3">
              <span className="text-[15px] font-medium">{d.summary}</span>
              <span className="text-[13px] text-alert">{d.rejected}</span>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void uploadQueue.retry(d.id)}>
                  再试一次
                </Button>
                <Button size="sm" variant="danger" onClick={() => void uploadQueue.discard(d.id)}>
                  放弃这条
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  )
}
