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
import type { CollisionEntitySnapshot, CollisionEvent } from '../modules/hitdetect'
import { CollisionDecision, CollisionSituationType } from '../modules/hitdetect.ts'
import { normalizeSubmarine, disposeObject } from '../modules/modelUtils'
import { MODEL_LENGTH_SCENE, METERS_TO_SCENE } from '../constant/sceneUnits'
import { GameEntityRegistry } from '../entitymanager/GameEntityRegistry.ts'

/** 鱼雷最大存活时间（秒） */
const TORPEDO_MAX_LIFETIME = 480 //G7e鱼雷的动力有效维持时间是5~8分钟
/** 鱼雷航速（场景单位/秒，约 30 节） */
const TORPEDO_SPEED = (55_600 * METERS_TO_SCENE) / 3600

//鱼雷只支持传世界坐标作为初始化
export interface TorpedoOptions {
  id: string
  ownerId: string  //鱼雷的发射方
  initialPosition: THREE.Vector3
  heading: number
  depth?: number
  modelUrl: string

  /** 模型管理对象 */
  entityRegistry: GameEntityRegistry
}

export class TorpedorController implements Updatable {
  public readonly id: string
  public readonly ownerId: string | undefined
  public readonly root: THREE.Group
  public readonly visual: THREE.Object3D
  public readonly modelLength: number
  public readonly modelHeight: number

  /** 保存模型管理对象 */
  private readonly entityRegistry: GameEntityRegistry

  public heading: number
  public currentSpeed: number
  public depth: number

  private age = 0
  private movementDelta = new THREE.Vector3()

  constructor(
    id: string,
    ownerId: string | undefined,
    root: THREE.Group,
    visual: THREE.Object3D,
    options: { heading: number; speed: number; depth: number; modelLength: number; modelHeight: number },
    entityRegistry: GameEntityRegistry
  ) {
    this.id = id
    this.ownerId = ownerId
    this.root = root
    this.visual = visual
    this.modelLength = options.modelLength
    this.modelHeight = options.modelHeight
    this.heading = options.heading
    this.currentSpeed = options.speed
    this.depth = options.depth
    this.root.rotation.y = this.heading
    this.entityRegistry = entityRegistry
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

    const bbox = new THREE.Box3().setFromObject(visual)
    const modelSize = bbox.getSize(new THREE.Vector3())

    root.add(visual)

    //向模型管理器注册模型
    options.entityRegistry.register({
      id: options.id,
      type: 'torpedo',
      root: root
    })

    return new TorpedorController(options.id, options.ownerId, root, visual, {
      heading: options.heading,
      speed: TORPEDO_SPEED,
      depth: options.depth ?? 0,
      modelLength: modelSize.x,
      modelHeight: modelSize.y,
    },
      options.entityRegistry,)
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

  handleCollision(_event: CollisionEvent, self: CollisionEntitySnapshot): void {
    // console.log(`[collision:${self.type}] ${self.id}`)

    //碰撞情景
    let CollisionSituation: CollisionSituationType
    CollisionSituation = CollisionDecision(_event)

    switch (CollisionSituation) {
      case CollisionSituationType.Submarine_Hits_Submarine:
        break


      case CollisionSituationType.Submarine_Hits_Cargoship:
        break


      case CollisionSituationType.Cargoship_Hits_Cargoship:
        break


      case CollisionSituationType.Torpedor_Hits_Submarine:
        //击沉一艘潜艇
        this.currentSpeed = 0

        //播放爆炸动画

        //上传击沉记录

        break

      case CollisionSituationType.Torpedor_Hits_Cargoship:
        //击沉一艘商船
        this.currentSpeed = 0

        //播放爆炸动画

        //上传击沉记录


        break


    }


  }

  dispose(): void {
    this.entityRegistry.unregister(this.id)
    this.root.removeFromParent()
    disposeObject(this.visual)
  }
}
