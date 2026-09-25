// Voice recording over MediaRecorder. iOS Safari records audio/mp4 (AAC), Android Chrome
// audio/webm (Opus); the server transcodes both to m4a.

export const MAX_CLIP_MS = 180_000
export const MIN_CLIP_MS = 1_000

const CANDIDATES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']

/** First container the browser can record, or undefined to let MediaRecorder pick. */
export function pickMimeType(isSupported: (t: string) => boolean = (t) => MediaRecorder.isTypeSupported(t)): string | undefined {
  return CANDIDATES.find((t) => {
    try {
      return isSupported(t)
    } catch {
      return false
    }
  })
}

export function recordingSupported(): boolean {
  return typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

export type Clip = { blob: Blob; durationMs: number; mimeType: string }

export type PrepareResult = 'ready' | 'granted-now' | 'denied' | 'unsupported'

/**
 * Keeps one microphone stream open while the record page is visible so pressing the button
 * starts recording without the getUserMedia delay.
 */
export class VoiceRecorder {
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private startedAt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private stopResolve: ((c: Clip | null) => void) | null = null

  get ready() {
    return this.stream !== null && this.stream.getAudioTracks().some((t) => t.readyState === 'live')
  }

  get recording() {
    return this.recorder?.state === 'recording'
  }

  /** Opens the stream only if permission was granted before, so no prompt appears on page load. */
  async warmUp(): Promise<void> {
    if (!recordingSupported() || this.ready) return
    try {
      const status = await navigator.permissions?.query({ name: 'microphone' as PermissionName })
      if (status?.state === 'granted') await this.prepare()
    } catch {
      // Safari before 16 has no microphone permission query; wait for the first press.
    }
  }

  /**
   * Makes sure the stream is open. 'granted-now' means the user just saw the permission
   * prompt: that press is discarded and they are asked to press again.
   */
  async prepare(): Promise<PrepareResult> {
    if (!recordingSupported()) return 'unsupported'
    if (this.ready) return 'ready'
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      return 'granted-now'
    } catch {
      return 'denied'
    }
  }

  /** Starts a clip. `onAutoStop` fires when the 3-minute limit ends it. */
  start(onAutoStop: (clip: Clip | null) => void): boolean {
    if (!this.stream || this.recording) return false
    const mimeType = pickMimeType()
    this.chunks = []
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined)
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }
    this.recorder.onstop = () => {
      const durationMs = Math.min(MAX_CLIP_MS, Date.now() - this.startedAt)
      const type = this.recorder?.mimeType || mimeType || 'audio/webm'
      const clip = durationMs >= MIN_CLIP_MS && this.chunks.length ? { blob: new Blob(this.chunks, { type }), durationMs, mimeType: type } : null
      this.stopResolve?.(clip)
      this.stopResolve = null
    }
    this.startedAt = Date.now()
    this.recorder.start(250)
    this.timer = setTimeout(() => {
      void this.stop().then(onAutoStop)
    }, MAX_CLIP_MS)
    return true
  }

  elapsedMs(): number {
    return this.recording ? Date.now() - this.startedAt : 0
  }

  /** Current input level 0–1 for the live waveform. */
  level(): number {
    if (!this.stream) return 0
    if (!this.analyser) {
      try {
        this.ctx = new AudioContext()
        this.analyser = this.ctx.createAnalyser()
        this.analyser.fftSize = 512
        this.ctx.createMediaStreamSource(this.stream).connect(this.analyser)
      } catch {
        return 0
      }
    }
    const data = new Uint8Array(this.analyser.fftSize)
    this.analyser.getByteTimeDomainData(data)
    let sum = 0
    for (const v of data) sum += ((v - 128) / 128) ** 2
    return Math.min(1, Math.sqrt(sum / data.length) * 4)
  }

  /** Stops and returns the clip, or null when it was shorter than a second. */
  stop(): Promise<Clip | null> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.recorder || this.recorder.state === 'inactive') return Promise.resolve(null)
    return new Promise((resolve) => {
      this.stopResolve = resolve
      this.recorder!.stop()
    })
  }

  cancel() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.stopResolve = null
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.onstop = null
      this.recorder.stop()
    }
    this.chunks = []
  }

  /** Releases the microphone when leaving the page. */
  release() {
    this.cancel()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    void this.ctx?.close().catch(() => undefined)
    this.ctx = null
    this.analyser = null
  }
}
