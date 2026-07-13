export default class PlayAudio {
  private readonly audioPath: string
  private readonly singlePlayDurationMs: number
  private audio: HTMLAudioElement | null = null
  private stopTimer: ReturnType<typeof setTimeout> | null = null
  private loopRunId = 0
  private resolveCurrentPlayback: (() => void) | null = null

  constructor(audioPath: string, singlePlaySeconds: number) {
    this.audioPath = audioPath
    this.singlePlayDurationMs = Math.max(0, singlePlaySeconds) * 1000
  }

  async play(): Promise<void> {
    if (!this.audioPath) return

    this.stopCurrentAudio()
    const audio = new Audio(this.audioPath)
    this.audio = audio

    await new Promise<void>((resolve) => {
      this.resolveCurrentPlayback = resolve

      const cleanup = () => {
        if (this.audio === audio) {
          this.clearStopTimer()
          this.audio = null
        }
        if (this.resolveCurrentPlayback === resolve) {
          this.resolveCurrentPlayback = null
        }
        resolve()
      }

      audio.addEventListener('ended', cleanup, { once: true })
      audio.addEventListener('error', cleanup, { once: true })

      if (this.singlePlayDurationMs > 0) {
        this.stopTimer = setTimeout(() => {
          if (this.audio === audio) {
            this.stopCurrentAudio()
            resolve()
          }
        }, this.singlePlayDurationMs)
      }

      audio.play().catch(cleanup)
    })
  }

  async loopTheAudio(shouldLoop: boolean | (() => boolean)): Promise<void> {
    if (!this.audioPath) return

    const isLooping = typeof shouldLoop === 'function' ? shouldLoop : () => shouldLoop
    const runId = ++this.loopRunId

    while (runId === this.loopRunId && isLooping()) {
      let isCurrentRoundDone = false
      const currentRound = this.play().finally(() => {
        isCurrentRoundDone = true
      })

      while (runId === this.loopRunId && isLooping() && !isCurrentRoundDone) {
        await this.wait(50)
      }

      if (runId !== this.loopRunId || !isLooping()) {
        this.stopCurrentAudio()
      }

      await currentRound
    }

    if (runId === this.loopRunId && !isLooping()) {
      this.stop()
    }
  }

  stop(): void {
    this.loopRunId += 1
    this.stopCurrentAudio()
  }

  private stopCurrentAudio(): void {
    this.clearStopTimer()

    if (!this.audio) return
    this.audio.pause()
    this.audio.currentTime = 0
    this.audio = null
    this.resolveCurrentPlayback?.()
    this.resolveCurrentPlayback = null
  }

  private clearStopTimer(): void {
    if (!this.stopTimer) return
    clearTimeout(this.stopTimer)
    this.stopTimer = null
  }

  private wait(durationMs: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, durationMs)
    })
  }
}
