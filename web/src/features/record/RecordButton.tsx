import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MicIcon } from '../../components/icons'
import { toast } from '../../lib/toast'
import { cx } from '../../lib/cx'
import { MAX_CLIP_MS, recordingSupported, type Clip, type VoiceRecorder } from '../../lib/recorder/recorder'
import { formatClipLength } from '../../lib/time/format'

const CANCEL_DISTANCE = 80
const WAVE_BARS = 30

type Phase = 'idle' | 'recording' | 'cancel-armed'

/**
 * 按住说话: press and hold to record, release to keep, slide up 80 px to cancel. Keyboard
 * users press Enter/Space once to start and again to stop. The long-press system menu and text
 * selection are suppressed so the gesture is not interrupted.
 */
export function RecordButton({
  recorder,
  onClip,
  children,
  className,
}: {
  recorder: VoiceRecorder
  onClip: (clip: Clip) => void
  children: ReactNode
  className?: string
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [levels, setLevels] = useState<number[]>(() => Array(WAVE_BARS).fill(0.15))
  const startY = useRef(0)
  const pressing = useRef(false)
  const phaseRef = useRef<Phase>('idle')
  useLayoutEffect(() => {
    phaseRef.current = phase
  })

  // Live timer and waveform while recording.
  useEffect(() => {
    if (phase === 'idle') return
    let frame = 0
    let last = 0
    const tick = (t: number) => {
      if (t - last > 90) {
        last = t
        setElapsed(recorder.elapsedMs())
        setLevels((prev) => [...prev.slice(1), Math.max(0.12, recorder.level())])
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [phase, recorder])

  const finish = (clip: Clip | null, auto = false) => {
    setPhase('idle')
    setElapsed(0)
    if (clip) {
      onClip(clip)
      if (auto) toast('已录满 3 分钟，自动保存')
    } else {
      toast('说话时间太短')
    }
  }

  async function begin(): Promise<boolean> {
    if (!recordingSupported()) {
      toast('这个浏览器不支持录音，请用系统浏览器打开', 'error')
      return false
    }
    const prep = await recorder.prepare()
    if (prep === 'denied') {
      toast('没有麦克风权限，请在浏览器设置里允许', 'error')
      return false
    }
    if (prep === 'granted-now') {
      // The permission prompt interrupted this press; it does not count.
      toast('已开启麦克风，请再按住说话')
      return false
    }
    if (!recorder.start((clip) => finish(clip, true))) return false
    setLevels(Array(WAVE_BARS).fill(0.15))
    setPhase('recording')
    return true
  }

  async function onPointerDown(e: PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0 || phaseRef.current !== 'idle') return
    e.currentTarget.setPointerCapture(e.pointerId)
    pressing.current = true
    startY.current = e.clientY
    const started = await begin()
    // Released while the recorder was starting up.
    if (started && !pressing.current) void recorder.stop().then((c) => finish(c))
  }

  function onPointerMove(e: PointerEvent<HTMLButtonElement>) {
    if (phaseRef.current === 'idle') return
    setPhase(startY.current - e.clientY > CANCEL_DISTANCE ? 'cancel-armed' : 'recording')
  }

  function onPointerUp() {
    pressing.current = false
    if (phaseRef.current === 'cancel-armed') {
      recorder.cancel()
      setPhase('idle')
      setElapsed(0)
      toast('已取消录音')
    } else if (phaseRef.current === 'recording') {
      void recorder.stop().then((c) => finish(c))
    }
  }

  function onPointerCancel() {
    pressing.current = false
    if (phaseRef.current !== 'idle') {
      recorder.cancel()
      setPhase('idle')
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    if (e.repeat) return
    if (phaseRef.current === 'idle') void begin()
    else void recorder.stop().then((c) => finish(c))
  }

  const armed = phase === 'cancel-armed'
  return (
    <>
      <button
        type="button"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onKeyDown={onKeyDown}
        onClick={(e) => e.preventDefault()}
        onContextMenu={(e) => e.preventDefault()}
        aria-label={phase === 'idle' ? '按住说话' : '松开结束录音'}
        className={cx('touch-none select-none [-webkit-touch-callout:none]', className)}
      >
        {children}
      </button>
      {phase !== 'idle' &&
        createPortal(
          <div className="pointer-events-none fixed inset-0 z-50" aria-live="assertive">
            <div className="absolute inset-0 bg-ink/30" />
            <section
              aria-label="正在录音"
              className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3.5 rounded-t-[28px] bg-surface px-6 pt-6 pb-9 shadow-[0_-8px_24px_rgba(27,40,38,0.18)] lg:mx-auto lg:max-w-[480px]"
            >
              <div className={cx('flex items-center gap-2 text-[15px] font-medium', armed ? 'text-ink' : 'text-alert')}>
                <span className={cx('size-2 rounded-full', armed ? 'bg-ink' : 'animate-pulse bg-alert')} />
                {armed ? '松开取消' : '正在录音'}
              </div>
              <div className="text-[44px] leading-none font-bold tabular-nums">{formatClipLength(elapsed)}</div>
              {elapsed > MAX_CLIP_MS - 15_000 && <div className="text-[13px] text-alert">最长 3 分钟，快到了</div>}
              <div className="flex h-12 items-center gap-[5px]" aria-hidden="true">
                {levels.map((l, i) => (
                  <span
                    key={i}
                    className={cx('w-[5px] rounded-full', armed ? 'bg-line' : 'bg-primary')}
                    style={{ height: Math.max(8, Math.round(l * 44)) }}
                  />
                ))}
              </div>
              <span
                className={cx(
                  'my-2.5 flex size-[88px] items-center justify-center rounded-full text-white transition-colors',
                  armed ? 'bg-alert shadow-[0_0_0_12px_var(--color-alert-soft)]' : 'bg-primary shadow-[0_0_0_12px_var(--color-primary-soft)]',
                )}
              >
                <MicIcon size={36} strokeWidth={2} />
              </span>
              <div className="text-sm text-ink-muted">{armed ? '松开手指，这段不保存' : '松开保存，上滑取消'}</div>
            </section>
          </div>,
          document.body,
        )}
    </>
  )
}
