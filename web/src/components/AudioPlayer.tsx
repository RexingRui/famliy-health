import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { formatClipLength, formatClipWords } from '../lib/time/format'
import { PauseIcon, PlayIcon } from './icons'
import { cx } from '../lib/cx'

// Only one clip plays at a time across the page.
let playing: HTMLAudioElement | null = null

const BARS = 11

/** Deterministic bar heights so a clip always shows the same "waveform". */
function barsFor(seed: string): number[] {
  let h = 0
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return Array.from({ length: BARS }, (_, i) => {
    h = (h * 1103515245 + 12345) >>> 0
    return 6 + ((h >>> 8) % 13) + (i === 0 || i === BARS - 1 ? -2 : 0)
  })
}

/**
 * Voice clip pill: play/pause, a decorative waveform that fills as it plays, and the length.
 * Tapping the waveform seeks.
 */
export function AudioPlayer({
  src,
  durationMs,
  seed,
  className,
  compact,
}: {
  src: string
  durationMs: number | null
  seed?: string
  className?: string
  compact?: boolean
}) {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [isPlaying, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const bars = useMemo(() => barsFor(seed ?? src), [seed, src])

  useEffect(
    () => () => {
      audio.current?.pause()
      if (playing === audio.current) playing = null
    },
    [],
  )

  function ensureAudio() {
    if (!audio.current) {
      const a = new Audio(src)
      a.preload = 'none'
      a.addEventListener('timeupdate', () => {
        const total = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : (durationMs ?? 0) / 1000
        setProgress(total > 0 ? Math.min(1, a.currentTime / total) : 0)
      })
      a.addEventListener('ended', () => {
        setPlaying(false)
        setProgress(0)
      })
      a.addEventListener('pause', () => setPlaying(false))
      a.addEventListener('play', () => setPlaying(true))
      audio.current = a
    }
    return audio.current
  }

  function toggle() {
    const a = ensureAudio()
    if (!a.paused) {
      a.pause()
      return
    }
    if (playing && playing !== a) playing.pause()
    playing = a
    void a.play().catch(() => setPlaying(false))
  }

  function seek(e: MouseEvent<HTMLSpanElement>) {
    e.stopPropagation()
    const a = ensureAudio()
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const total = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : (durationMs ?? 0) / 1000
    if (total > 0) a.currentTime = ratio * total
    setProgress(ratio)
  }

  const words = formatClipWords(durationMs)
  return (
    <span className={cx('inline-flex h-11 items-center gap-2 rounded-full bg-page pr-3.5 pl-1.5 text-sm', className)}>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          toggle()
        }}
        aria-label={isPlaying ? `暂停语音，${words}` : `播放语音，${words}`}
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink text-white"
      >
        {isPlaying ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
      </button>
      {!compact && (
        <span className="flex h-5 cursor-pointer items-center gap-[3px]" onClick={seek} aria-hidden="true">
          {bars.map((h, i) => (
            <span
              key={i}
              className={cx('w-[3px] rounded-full', i / BARS < progress ? 'bg-primary' : 'bg-ink-muted')}
              style={{ height: h }}
            />
          ))}
        </span>
      )}
      <span className="tabular-nums">{formatClipLength(durationMs)}</span>
    </span>
  )
}
