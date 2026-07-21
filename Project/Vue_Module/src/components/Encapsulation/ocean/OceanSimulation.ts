import * as THREE from 'three'

export interface OceanSurfaceSample {
  height: number
  normal: THREE.Vector3
  displacement: THREE.Vector2
}

export interface OceanSimulation {
  readonly size: number
  readonly resolution: number
  readonly mode: 'gpu' | 'cpu'

  update(delta: number): boolean
  renderReflection?(scene: THREE.Scene, camera: THREE.PerspectiveCamera, oceanMesh: THREE.Object3D): void
  sampleSurfaceAt(x: number, z: number): OceanSurfaceSample
  applyToGeometry(geometry: THREE.PlaneGeometry, centerX: number, centerZ: number): void
  dispose(): void
}

export interface OceanSimulationOptions {
  /** Visible ocean mesh patch size in scene units. */
  size: number
  /** Period of the repeated FFT wave tile in scene units. */
  wavePatchSize?: number
  resolution: number
  windSpeed: number
  fetch: number
  windDirection: THREE.Vector2
  gamma: number
  heightScale: number
  choppiness: number
  sampleHz: number
  renderer?: THREE.WebGLRenderer
  sunDirection?: THREE.Vector3
}
