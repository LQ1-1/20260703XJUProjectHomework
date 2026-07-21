/**
 * OceanController — 程序化海洋管理
 *
 * 职责：
 * - 创建程序化海洋 Mesh
 * - 每帧更新时间 uniform 并跟随目标位置
 * - 提供当前位置的波浪高度采样值
 */
import * as THREE from 'three'
import type { Updatable } from '../engine/GameEngine'
import {
  createProceduralOcean,
  type WaveSettings,
  proceduralWaveHeight,
} from '../modules/proceduralOcean'

export interface OceanOptions {
  oceanSize: number
  oceanSegments: number
  sunDirection: THREE.Vector3
  waves: WaveSettings
}

export class OceanController implements Updatable {
  public readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  private _sampledWaterHeight = 0
  private followTarget: THREE.Vector3 | undefined
  private waves: WaveSettings

  constructor(options: OceanOptions) {
    this.waves = options.waves
    this.mesh = createProceduralOcean({
      oceanSize: options.oceanSize,
      oceanSegments: options.oceanSegments,
      sunDirection: options.sunDirection,
      waves: options.waves,
    })
  }

  /** 当前跟随位置采样到的水面高度（世界 Y 坐标） */
  get sampledWaterHeight(): number {
    return this._sampledWaterHeight
  }

  /** 设置采样位置（通常每帧设为潜艇位置） */
  follow(position: THREE.Vector3): void {
    this.followTarget = position.clone()
  }

  update(delta: number): void {
    if (this.followTarget) {
      this._sampledWaterHeight = proceduralWaveHeight(
        this.followTarget.x,
        this.followTarget.z,
        this.mesh.material.uniforms.uTime!.value,
        this.waves,
      )
      this.mesh.position.x = this.followTarget.x
      this.mesh.position.z = this.followTarget.z
    }
    this.mesh.material.uniforms.uTime!.value += delta
  }

  dispose(): void {
    this.mesh.removeFromParent()
    this.mesh.geometry.dispose()
    const { uFoamMask, uFoamNormal } = this.mesh.material.uniforms
    ;(uFoamMask?.value as THREE.Texture | undefined)?.dispose()
    ;(uFoamNormal?.value as THREE.Texture | undefined)?.dispose()
    this.mesh.material.dispose()
  }
}
