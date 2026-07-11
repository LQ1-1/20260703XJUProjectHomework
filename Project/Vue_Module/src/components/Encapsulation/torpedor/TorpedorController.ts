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
import type { Updatable, GameEngine } from '../engine/GameEngine'
import type { CollisionEntitySnapshot, CollisionEvent } from '../modules/hitdetect'
import { CollisionDecision, CollisionSituationType } from '../modules/hitdetect.ts'
import { normalizeSubmarine, disposeObject } from '../modules/modelUtils'
import { MODEL_LENGTH_SCENE, METERS_TO_SCENE } from '../constant/sceneUnits'
import { GameEntityRegistry } from '../entitymanager/GameEntityRegistry.ts'
import { TorpedoExplosion } from '../ExplosionSplashEffect/explosionSplashEffect.ts'


/** 鱼雷最大存活时间（秒）G7a */
export const TORPEDO_MAX_LIFETIME_G7A = 220 //G7e鱼雷的动力有效维持时间是3~4分钟
/** 鱼雷航速（场景单位/秒，约 44 节）G7a */
export const TORPEDO_SPEED_G7A = (81_500 * METERS_TO_SCENE) / 3600


/** 鱼雷最大存活时间（秒）G7e */
export const TORPEDO_MAX_LIFETIME_G7E = 324 //G7e鱼雷的动力有效维持时间是5~7分钟
/** 鱼雷航速（场景单位/秒，约 30 节）G7e */
export const TORPEDO_SPEED_G7E = (55_600 * METERS_TO_SCENE) / 3600

export const TORPEDO_FINAL_DEPTH_OFFSET=1.5

export type TorpedoType = 'G7a' | 'G7e'

interface TorpedoConfig {
  speed: number
  maxLifetime: number
}

const TORPEDO_CONFIGS: Record<TorpedoType, TorpedoConfig> = {
  G7a: {
    speed: TORPEDO_SPEED_G7A,
    maxLifetime: TORPEDO_MAX_LIFETIME_G7A,
  },
  G7e: {
    speed: TORPEDO_SPEED_G7E,
    maxLifetime: TORPEDO_MAX_LIFETIME_G7E,
  },
}

//鱼雷只支持传世界坐标作为初始化
export interface TorpedoOptions {
  id: string
  ownerId: string  //鱼雷的发射方

  torpedoType: TorpedoType  //鱼雷类型

  initialPosition: THREE.Vector3
  heading: number
  depth?: number
  initialDepth?: number
  finalDepth?: number
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
  public readonly torpedoType: TorpedoType
  public readonly maxLifetime: number

  /** 保存模型管理对象 */
  private readonly entityRegistry: GameEntityRegistry

  public heading: number
  public currentSpeed: number
  public depth: number
  public initialDepth: number
  public finalDepth: number

  private age = 0
  private movementDelta = new THREE.Vector3()

  private disposed = false  //判断鱼雷模型是否被清理的标志位
  private hit = false //判断鱼雷是否命中船只

  // ---- 外部引用 ----
  private engine: GameEngine

  constructor(
    engine: GameEngine,
    id: string,
    ownerId: string | undefined,
    root: THREE.Group,
    visual: THREE.Object3D,
    options: {
      torpedoType: TorpedoType,
      heading: number,
      speed: number,
      depth: number,
      initialDepth: number,
      finalDepth: number,
      maxLifetime: number,
      modelLength: number,
      modelHeight: number
    },
    entityRegistry: GameEntityRegistry
  ) {
    this.engine = engine
    this.id = id
    this.ownerId = ownerId
    this.root = root
    this.visual = visual
    this.modelLength = options.modelLength
    this.modelHeight = options.modelHeight
    this.heading = options.heading
    this.currentSpeed = options.speed
    this.depth = options.depth
    this.initialDepth = options.initialDepth
    this.finalDepth = options.finalDepth
    this.root.rotation.y = this.heading
    this.entityRegistry = entityRegistry
    this.torpedoType = options.torpedoType
    this.maxLifetime = options.maxLifetime
  }

  /** 异步工厂：加载鱼雷模型并创建完整控制器 */
  static async create(
    engine: GameEngine,
    options: TorpedoOptions): Promise<TorpedorController> {
    const config = TORPEDO_CONFIGS[options.torpedoType]

    const initialDepth = options.initialDepth ?? options.depth ?? 0
    const finalDepth = (options.finalDepth ?? options.depth ?? initialDepth) + TORPEDO_FINAL_DEPTH_OFFSET

    const root = new THREE.Group()
    // 鱼雷不跟随海浪高度，只使用发射点的水平坐标；垂直位置由弹道深度控制。
    root.position.set(options.initialPosition.x, -initialDepth, options.initialPosition.z)

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

    const torpedo = new TorpedorController(
      engine,
      options.id,
      options.ownerId,
      root,
      visual,
      {
        torpedoType: options.torpedoType,
        heading: options.heading,
        speed: config.speed,
        maxLifetime: config.maxLifetime,
        depth: initialDepth,
        initialDepth,
        finalDepth,
        modelLength: modelSize.x,
        modelHeight: modelSize.y,
      },
      options.entityRegistry,
    )

    engine.scene.add(torpedo.root)
    engine.addUpdatable(torpedo)

    return torpedo
  }

  /** 鱼雷是否已过期（超时或命中销毁） */
  get isExpired(): boolean {
    return this.disposed || this.age >= this.maxLifetime
  }

  update(delta: number): void {
    if (this.disposed) return

    this.age += delta

    if (this.isExpired) {
      this.dispose()
      return
    }

    this.movementDelta.set(
      Math.cos(this.heading) * this.currentSpeed * delta,
      0,
      -Math.sin(this.heading) * this.currentSpeed * delta,
    )
    this.root.position.add(this.movementDelta)

    this.depth = this.currentDepthForAge()
    this.root.position.y = -this.depth
  }

  private currentDepthForAge(): number {
    if (this.age <= 7) return this.initialDepth
    if (this.age >= 10) return this.finalDepth

    const progress = (this.age - 7) / 3
    const smoothProgress = progress * progress * (3 - 2 * progress)
    return THREE.MathUtils.lerp(this.initialDepth, this.finalDepth, smoothProgress)
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
        console.log('鱼雷命中潜艇')

        //击沉一艘潜艇
        this.hit = true
        this.currentSpeed = 0

        //播放爆炸动画
        TorpedoExplosion(this.root.position.clone(), this.engine)

        //上传击沉记录

        //回收鱼雷模型
        this.dispose()
        break

      case CollisionSituationType.Torpedor_Hits_Cargoship:
        console.log('鱼雷命中商船')

        //击沉一艘商船
        this.hit = true
        this.currentSpeed = 0

        //播放爆炸动画
        TorpedoExplosion(this.root.position.clone(), this.engine)

        //上传击沉记录


        //回收鱼雷模型
        this.dispose()
        break


    }


  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true

    if (this.hit === false) {
      //播放爆炸动画
      TorpedoExplosion(this.root.position.clone(), this.engine)
    }


    this.entityRegistry.unregister(this.id)
    this.engine.removeUpdatable(this)
    this.root.removeFromParent()
    disposeObject(this.visual)
  }
}
