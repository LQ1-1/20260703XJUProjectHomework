/**
 * TorpedorController — 鱼雷控制器
 *
 * 鱼雷从发射位置沿初始航向直线运动，恒定速度。
 * 有最大存活时间，超时自动标记为过期。
 *
 * 使用方式（静态工厂）：
 *   const torpedo = await TorpedorController.create({...})
 *   engine.addUpdatable(torpedo)
 *   // 每帧 torpedo.update(delta) 由 GameEngine 调用
 *   if (torpedo.isExpired) { ... }
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { Updatable } from '../engine/GameEngine'
import { normalizeSubmarine, disposeObject } from '../modules/modelUtils'
import { MODEL_LENGTH_SCENE, METERS_TO_SCENE } from '../constant/sceneUnits'

/** 鱼雷最大存活时间（秒） */
const TORPEDO_MAX_LIFETIME = 480 //G7e鱼雷的动力有效维持时间是5~8分钟
/** 鱼雷航速（场景单位/秒，约 30 节） */
const TORPEDO_SPEED = (55_600 * METERS_TO_SCENE) / 3600

//鱼雷只支持传世界坐标作为初始化
export interface TorpedoOptions {
  initialPosition: THREE.Vector3
  heading: number
  depth?: number
  modelUrl: string
}

export class TorpedorController implements Updatable {
  public readonly root: THREE.Group
  public readonly visual: THREE.Object3D

  public heading: number
  public currentSpeed: number
  public depth: number

  private age = 0
  private movementDelta = new THREE.Vector3()

  constructor(
    root: THREE.Group,
    visual: THREE.Object3D,
    options: { heading: number; speed: number; depth: number },
  ) {
    this.root = root
    this.visual = visual
    this.heading = options.heading
    this.currentSpeed = options.speed
    this.depth = options.depth
    this.root.rotation.y = this.heading
  }

  /** 异步工厂：加载鱼雷模型并创建完整控制器 */
  static async create(options: TorpedoOptions): Promise<TorpedorController> {
    const root = new THREE.Group()
    root.position.copy(options.initialPosition)
    if (options.depth !== undefined) {
      root.position.y = -options.depth
    }

    const loader = new GLTFLoader()
    const gltf = await loader.loadAsync(options.modelUrl)
    const visual = gltf.scene

    // 鱼雷归一化到场景比例
    normalizeSubmarine(visual, MODEL_LENGTH_SCENE * 0.15, 0)
    visual.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      for (const material of materials) {
        if (material instanceof THREE.MeshStandardMaterial) {
          material.roughness = 0.3
          material.metalness = 0.7
          material.needsUpdate = true
        }
      }
    })

    root.add(visual)

    return new TorpedorController(root, visual, {
      heading: options.heading,
      speed: TORPEDO_SPEED,
      depth: options.depth ?? 0,
    })
  }

  /** 鱼雷是否已过期（超时或命中销毁） */
  get isExpired(): boolean {
    return this.age >= TORPEDO_MAX_LIFETIME
  }

  update(delta: number): void {
    if (this.isExpired) return
    this.age += delta

    this.movementDelta.set(
      Math.cos(this.heading) * this.currentSpeed * delta,
      0,
      -Math.sin(this.heading) * this.currentSpeed * delta,
    )
    this.root.position.add(this.movementDelta)
    // 深度固定
    this.root.position.y = -this.depth
  }

  dispose(): void {
    this.root.removeFromParent()
    disposeObject(this.visual)
  }
}
