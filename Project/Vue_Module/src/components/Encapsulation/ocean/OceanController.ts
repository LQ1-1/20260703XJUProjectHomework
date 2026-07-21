/**
 * OceanController — FFT 海洋管理
 *
 * 职责：
 * - 创建可见海洋 Mesh
 * - 每帧更新 FFT 海浪并跟随目标位置
 * - 提供任意世界坐标的波浪高度/法线采样值
 */
import * as THREE from 'three'
import type { Updatable } from '../engine/GameEngine'
import type { OceanSurfaceSample } from './OceanSimulation'
import { ReferenceFftOceanSimulation } from './ReferenceFftOceanSimulation'

export interface OceanOptions {
  oceanSize: number
  wavePatchSize?: number
  oceanSegments: number
  sunDirection: THREE.Vector3
  renderer?: THREE.WebGLRenderer
  scene?: THREE.Scene
  camera?: THREE.PerspectiveCamera
}

export class OceanController implements Updatable {
  public readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  private _sampledWaterHeight = 0
  private readonly fallbackSample: OceanSurfaceSample = {
    height: 0,
    normal: new THREE.Vector3(0, 1, 0),
    displacement: new THREE.Vector2(),
  }
  private followTarget: THREE.Vector3 | undefined
  private readonly simulation: ReferenceFftOceanSimulation
  private readonly scene: THREE.Scene | undefined
  private readonly camera: THREE.PerspectiveCamera | undefined

  constructor(options: OceanOptions) {
    this.scene = options.scene
    this.camera = options.camera
    this.simulation = new ReferenceFftOceanSimulation({
      size: options.oceanSize,
      wavePatchSize: options.wavePatchSize ?? 450,
      resolution: options.oceanSegments,
      windSpeed: 11,
      fetch: 80_000,
      windDirection: new THREE.Vector2(Math.sin(THREE.MathUtils.degToRad(20)), 1).normalize(),
      gamma: 1.7,
      heightScale: 1,
      choppiness: 3.6,
      sampleHz: 30,
      renderer: options.renderer,
      sunDirection: options.sunDirection,
    })
    const geometry = new THREE.PlaneGeometry(
      options.oceanSize,
      options.oceanSize,
      options.oceanSegments,
      options.oceanSegments,
    )
    geometry.rotateX(-Math.PI / 2)
    this.mesh = new THREE.Mesh(geometry, this.simulation.material)
    this.mesh.name = 'ReferenceFftOcean'
    this.mesh.frustumCulled = false
  }

  /** 当前跟随位置采样到的水面高度（世界 Y 坐标） */
  get sampledWaterHeight(): number {
    return this._sampledWaterHeight
  }

  get backendMode(): 'gpu' | 'cpu' {
    return this.simulation.mode
  }

  /** 设置采样位置（通常每帧设为潜艇位置） */
  follow(position: THREE.Vector3): void {
    this.followTarget = position.clone()
  }

  sampleSurfaceAt(x: number, z: number): OceanSurfaceSample {
    if (!this.simulation) return this.fallbackSample
    const sample = this.simulation.sampleSurfaceAt(x, z)
    this.fallbackSample.height = sample.height
    this.fallbackSample.normal.copy(sample.normal)
    this.fallbackSample.displacement.copy(sample.displacement)
    return this.fallbackSample
  }

  update(delta: number): void {
    const didUpdate = this.simulation.update(delta)
    if (this.scene && this.camera) {
      this.simulation.renderReflection(this.scene, this.camera, this.mesh)
    }
    if (this.followTarget) {
      const sample = this.simulation.sampleSurfaceAt(this.followTarget.x, this.followTarget.z)
      this._sampledWaterHeight = sample.height
      this.mesh.position.x = this.followTarget.x
      this.mesh.position.z = this.followTarget.z
      if (didUpdate) {
        this.simulation.applyToGeometry(
          this.mesh.geometry,
          this.followTarget.x,
          this.followTarget.z,
        )
      }
    }
  }

  updateVisualState(options: Parameters<ReferenceFftOceanSimulation['updateVisualState']>[0]): void {
    this.simulation.updateVisualState(options)
  }

  dispose(): void {
    this.mesh.removeFromParent()
    this.mesh.geometry.dispose()
    this.simulation.dispose()
  }
}
