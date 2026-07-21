export interface OceanWeatherAudioState {
  seaIntensity: number
  rainIntensity: number
}

export class OceanAmbientAudioController {
  private readonly waveAudio: HTMLAudioElement
  private readonly rainAudio: HTMLAudioElement
  private seaIntensity = 0
  private rainIntensity = 0
  private isStarted = false

  constructor(
    private readonly wavePath = '/assets/audio/wave.wav',
    private readonly rainPath = '/assets/audio/rain.wav',
  ) {
    this.waveAudio = this.createLoopingAudio(this.wavePath)
    this.rainAudio = this.createLoopingAudio(this.rainPath)
  }

  async start(): Promise<void> {
    if (this.isStarted) return
    this.isStarted = true
    this.applyVolumes()
    await Promise.allSettled([this.waveAudio.play(), this.rainAudio.play()])
  }

  stop(): void {
    this.isStarted = false
    this.waveAudio.pause()
    this.rainAudio.pause()
  }

  setSeaState(intensity: number): void {
    this.seaIntensity = this.clampIntensity(intensity)
    this.applyVolumes()
  }

  setRainIntensity(intensity: number): void {
    this.rainIntensity = this.clampIntensity(intensity)
    this.applyVolumes()
  }

  setWeatherAudioState(state: Partial<OceanWeatherAudioState>): void {
    if (state.seaIntensity !== undefined) this.seaIntensity = this.clampIntensity(state.seaIntensity)
    if (state.rainIntensity !== undefined) this.rainIntensity = this.clampIntensity(state.rainIntensity)
    this.applyVolumes()
  }

  dispose(): void {
    this.stop()
    this.waveAudio.src = ''
    this.rainAudio.src = ''
  }

  private createLoopingAudio(path: string): HTMLAudioElement {
    const audio = new Audio(path)
    audio.loop = true
    audio.preload = 'auto'
    audio.volume = 0
    return audio
  }

  private applyVolumes(): void {
    this.waveAudio.volume = this.isStarted ? this.seaIntensity * 0.42 : 0
    this.rainAudio.volume = this.isStarted ? this.rainIntensity * 0.36 : 0
  }

  private clampIntensity(value: number): number {
    return Math.min(Math.max(value, 0), 1)
  }
}

