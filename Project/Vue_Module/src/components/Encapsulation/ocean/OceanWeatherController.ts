import * as THREE from 'three'
import type { Updatable, GameEngine } from '../engine/GameEngine'
import { OceanAmbientAudioController } from './OceanAmbientAudioController'
import type { OceanController } from './OceanController'

type DayPhase = 'day' | 'sunset' | 'night'
type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm'

const WEATHER_INTERVAL_SECONDS = 60 * 60

const SKYBOX_PATHS: Record<DayPhase, string[]> = {
  day: [
    '/assets/fft-ocean/skybox/day/sky_east.jpg',
    '/assets/fft-ocean/skybox/day/sky_west.jpg',
    '/assets/fft-ocean/skybox/day/sky_up.jpg',
    '/assets/fft-ocean/skybox/day/sky_down.jpg',
    '/assets/fft-ocean/skybox/day/sky_north.jpg',
    '/assets/fft-ocean/skybox/day/sky_south.jpg',
  ],
  sunset: [
    '/assets/fft-ocean/skybox/sunset/sunset_east.jpg',
    '/assets/fft-ocean/skybox/sunset/sunset_west.jpg',
    '/assets/fft-ocean/skybox/sunset/sunset_up.jpg',
    '/assets/fft-ocean/skybox/sunset/sunset_down.jpg',
    '/assets/fft-ocean/skybox/sunset/sunset_north.jpg',
    '/assets/fft-ocean/skybox/sunset/sunset_south.jpg',
  ],
  night: [
    '/assets/fft-ocean/skybox/night/grimmnight_east.jpg',
    '/assets/fft-ocean/skybox/night/grimmnight_west.jpg',
    '/assets/fft-ocean/skybox/night/grimmnight_up.jpg',
    '/assets/fft-ocean/skybox/night/grimmnight_down.jpg',
    '/assets/fft-ocean/skybox/night/grimmnight_north.jpg',
    '/assets/fft-ocean/skybox/night/grimmnight_south.jpg',
  ],
}

const PHASE_SEQUENCE: DayPhase[] = ['day', 'sunset', 'night']

const PHASE_PRESETS: Record<DayPhase, {
  sky: THREE.Color
  submerged: THREE.Color
  ocean: THREE.Color
  exposure: number
  hemi: number
  key: number
  rim: number
}> = {
  day: {
    sky: new THREE.Color(0x9fd8f2),
    submerged: new THREE.Color(0x0d4058),
    ocean: new THREE.Color(0x596673),
    exposure: 1.18,
    hemi: 1,
    key: 1,
    rim: 1,
  },
  sunset: {
    sky: new THREE.Color(0xe0a46c),
    submerged: new THREE.Color(0x12364b),
    ocean: new THREE.Color(0x4c5966),
    exposure: 0.92,
    hemi: 0.72,
    key: 0.76,
    rim: 0.9,
  },
  night: {
    sky: new THREE.Color(0x08111f),
    submerged: new THREE.Color(0x031523),
    ocean: new THREE.Color(0x182231),
    exposure: 0.58,
    hemi: 0.26,
    key: 0.22,
    rim: 0.55,
  },
}

const WEATHER_PRESETS: Record<WeatherKind, {
  fog: number
  light: number
  sea: number
  rain: number
  oceanDarken: number
}> = {
  clear: { fog: 1, light: 1, sea: 0.55, rain: 0, oceanDarken: 0 },
  cloudy: { fog: 1.35, light: 0.78, sea: 0.64, rain: 0, oceanDarken: 0.12 },
  rain: { fog: 1.95, light: 0.58, sea: 0.78, rain: 0.62, oceanDarken: 0.24 },
  storm: { fog: 2.7, light: 0.42, sea: 1, rain: 1, oceanDarken: 0.36 },
}

export class OceanWeatherController implements Updatable {
  private readonly audio = new OceanAmbientAudioController()
  private readonly cubeLoader = new THREE.CubeTextureLoader()
  private readonly skyboxes = new Map<DayPhase, THREE.CubeTexture>()
  private elapsedSinceSwitch = 0
  private phaseIndex = 0
  private weather: WeatherKind = 'clear'
  private rain: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | undefined

  constructor(
    private readonly engine: GameEngine,
    private readonly ocean: OceanController,
  ) {
    this.createRain()
    this.loadSkyboxes()
    this.rollWeather()
    this.applyState()
    void this.audio.start()
  }

  update(delta: number): void {
    this.elapsedSinceSwitch += delta
    if (this.elapsedSinceSwitch >= WEATHER_INTERVAL_SECONDS) {
      this.elapsedSinceSwitch = 0
      this.phaseIndex = (this.phaseIndex + 1) % PHASE_SEQUENCE.length
      this.rollWeather()
      this.applyState()
    }
    this.updateRain(delta)
  }

  dispose(): void {
    this.audio.dispose()
    this.rain?.geometry.dispose()
    this.rain?.material.dispose()
    this.rain?.removeFromParent()
    for (const texture of this.skyboxes.values()) texture.dispose()
  }

  private get phase(): DayPhase {
    return PHASE_SEQUENCE[this.phaseIndex] ?? 'day'
  }

  private rollWeather(): void {
    const roll = Math.random()
    if (roll < 0.42) this.weather = 'clear'
    else if (roll < 0.68) this.weather = 'cloudy'
    else if (roll < 0.9) this.weather = 'rain'
    else this.weather = 'storm'
  }

  private loadSkyboxes(): void {
    for (const phase of PHASE_SEQUENCE) {
      const texture = this.cubeLoader.load(SKYBOX_PATHS[phase], () => {
        if (phase === this.phase) this.applyState()
      })
      texture.colorSpace = THREE.SRGBColorSpace
      this.skyboxes.set(phase, texture)
    }
  }

  private applyState(): void {
    const phase = PHASE_PRESETS[this.phase]
    const weather = WEATHER_PRESETS[this.weather]
    const oceanColor = phase.ocean.clone().lerp(new THREE.Color(0x050b12), weather.oceanDarken)
    const skyColor = phase.sky.clone().multiplyScalar(weather.light)

    this.engine.updateAtmosphere({
      surfaceBackground: skyColor,
      submergedBackground: phase.submerged,
      fogColor: skyColor,
      fogDensityMultiplier: weather.fog,
      hemisphereIntensityMultiplier: phase.hemi * weather.light,
      keyLightIntensityMultiplier: phase.key * weather.light,
      rimLightIntensityMultiplier: phase.rim,
      toneMappingExposure: phase.exposure,
      environmentMap: this.skyboxes.get(this.phase) ?? null,
    })
    this.ocean.updateVisualState({
      oceanColor,
      skyColor,
      exposure: this.phase === 'night' ? 0.22 : 0.15,
    })
    this.audio.setWeatherAudioState({
      seaIntensity: weather.sea,
      rainIntensity: weather.rain,
    })
    if (this.rain) this.rain.visible = weather.rain > 0
  }

  private createRain(): void {
    const count = 900
    const positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = (Math.random() - 0.5) * 180
      positions[i * 3 + 1] = Math.random() * 90 + 15
      positions[i * 3 + 2] = (Math.random() - 0.5) * 180
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const texture = new THREE.TextureLoader().load('/assets/fft-ocean/textures/rain-drop.png')
    const material = new THREE.PointsMaterial({
      map: texture,
      size: 1.1,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      color: 0xc9e9ff,
    })
    this.rain = new THREE.Points(geometry, material)
    this.rain.name = 'OceanWeatherRain'
    this.rain.visible = false
    this.engine.scene.add(this.rain)
  }

  private updateRain(delta: number): void {
    if (!this.rain || !this.rain.visible) return
    const camera = this.engine.camera
    this.rain.position.x = camera.position.x
    this.rain.position.z = camera.position.z
    const position = this.rain.geometry.attributes.position
    if (!(position instanceof THREE.BufferAttribute)) return
    for (let i = 0; i < position.count; i += 1) {
      const y = position.getY(i) - delta * 58
      position.setY(i, y < 2 ? Math.random() * 90 + 35 : y)
    }
    position.needsUpdate = true
  }
}

