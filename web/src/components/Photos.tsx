import { useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from './icons'
import { cx } from '../lib/cx'

export type PhotoItem = { id: string; url: string; thumbUrl?: string | null }

/** Row of square thumbnails; tapping one opens the full-screen viewer. */
export function PhotoThumbs({ photos, size = 72, className }: { photos: PhotoItem[]; size?: number; className?: string }) {
  const [open, setOpen] = useState<number | null>(null)
  if (photos.length === 0) return null
  return (
    <>
      <div className={cx('flex flex-wrap gap-2', className)}>
        {photos.map((p, i) => (
          <button
            key={p.id}
            type="button"
            aria-label={`查看照片 ${i + 1}`}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setOpen(i)
            }}
            className="overflow-hidden rounded-[10px] bg-line"
            style={{ width: size, height: size }}
          >
            <img src={p.thumbUrl ?? p.url} alt="" loading="lazy" className="size-full object-cover" />
          </button>
        ))}
      </div>
      {open !== null && <Lightbox photos={photos} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </>
  )
}

export function Lightbox({
  photos,
  index,
  onIndex,
  onClose,
}: {
  photos: PhotoItem[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
}) {
  const p = photos[index]
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`照片 ${index + 1} / ${photos.length}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
        if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
        if (e.key === 'ArrowRight' && index < photos.length - 1) onIndex(index + 1)
      }}
      tabIndex={-1}
      ref={(el) => el?.focus()}
    >
      <img src={p.url} alt={`照片 ${index + 1}`} className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute top-4 right-4 flex size-11 items-center justify-center text-white">
        <CloseIcon />
      </button>
      {photos.length > 1 && (
        <>
          <button
            type="button"
            aria-label="上一张"
            disabled={index === 0}
            onClick={(e) => {
              e.stopPropagation()
              onIndex(index - 1)
            }}
            className="absolute left-2 flex size-11 items-center justify-center text-white disabled:opacity-30"
          >
            <ChevronLeftIcon size={28} />
          </button>
          <button
            type="button"
            aria-label="下一张"
            disabled={index === photos.length - 1}
            onClick={(e) => {
              e.stopPropagation()
              onIndex(index + 1)
            }}
            className="absolute right-2 flex size-11 items-center justify-center text-white disabled:opacity-30"
          >
            <ChevronRightIcon size={28} />
          </button>
          <span className="absolute bottom-6 text-sm text-white">
            {index + 1} / {photos.length}
          </span>
        </>
      )}
    </div>,
    document.body,
  )
}
