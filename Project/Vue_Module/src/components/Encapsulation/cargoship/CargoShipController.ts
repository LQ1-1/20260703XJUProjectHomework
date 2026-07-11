/**
 * CargoShipController — 货船控制器
 *
 * 货船在水面航行，沿固定航向匀速行驶，不潜水。
 * 高度由外部每帧注入（通过 OceanController 采样）。
 *
 * 使用方式（静态异步工厂）：
 *   const ship = await CargoShipController.create(engine, {
 *     coordinateCode: 'BE21',
 *     headingDegrees: 45,
 *     speedKnots: 10,
 *     modelUrl: libertyShipUrl,
 *   })
 *   engine.addUpdatable(ship)
 *   // 每帧 ship.updateHeight(ocean.sampledWaterHeight)
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { Updatable } from '../engine/GameEngine'
import type { GameEngine } from '../engine/GameEngine'
import type { CollisionEntitySnapshot, CollisionEvent } from '../modules/hitdetect'
import { CollisionDecision, CollisionSituationType } from '../modules/hitdetect.ts'
import { normalizeSubmarine, disposeObject } from '../modules/modelUtils'
import { MapCode } from '../../../common/map/mapcode'
import { CARGO_MODEL_LENGTH_SCENE, CARGO_SURFACE_MODEL_OFFSET, METERS_TO_SCENE, SINK_DEPTH } from '../constant/sceneUnits'
import { GameEntityRegistry } from '../entitymanager/GameEntityRegistry.ts'

export interface CargoShipOptions {
  /** 唯一标识（用于碰撞、战役状态同步等） */
  id: string
  /** 地图坐标代码，如 "BE21" */
  coordinateCode?: string
  /** 地图坐标（数字）  */
  worldPosition?: {
    x: number
    z: number
  }
  /** 初始航向（罗盘度数，0=北，90=东） */
  headingDegrees: number
  /** 航速（节） */
  speedKnots: number
  /** GLB 模型文件路径 */
  modelUrl: string

  /** 模型管理对象 */
  entityRegistry: GameEntityRegistry
}

export class CargoShipController implements Updatable {
  public readonly id: string
  public readonly root: THREE.Group
  public readonly visual: THREE.Object3D

  /** 模型归一化后的实际高度（场景单位），可用于距离测算 */
  public readonly modelHeight: number
  /** 模型归一化后的实际长度（场景单位） */
  public readonly modelLength: number

  /** 保存模型管理对象 */
  private readonly entityRegistry: GameEntityRegistry

  public heading = 0
  public currentSpeed = 0

  public isDestroyed = false  //商船是否被击沉
  public isSink = false //商船是否下沉到底，沉底后碰撞检测失效

  private movementDelta = new THREE.Vector3()
  private readonly sinkPitch = THREE.MathUtils.degToRad(-45)

  // ==================== 静态异步工厂 ====================

  /**
   * 创建完整初始化的货船控制器。
   * 自动加载模型、转换坐标代码、归一化并添加到场景。
   */
  static async create(
    engine: GameEngine,
    options: CargoShipOptions,
  ): Promise<CargoShipController> {
    // 1. 坐标代码 → 世界坐标

    // const mapCode = new MapCode(0, 0)
    // const worldPos = mapCode.getWorldLocation(options.coordinateCode)
    // const initialPosition = new THREE.Vector3(worldPos.first, 0, worldPos.second)

    //2026-07-09 兼容传入世界坐标的初始化方式
    let initialPosition: THREE.Vector3
    if (options.worldPosition) {
      initialPosition = new THREE.Vector3(options.worldPosition.x, 0, options.worldPosition.z)
    } else if (options.coordinateCode) {
      const mapCode = new MapCode(0, 0)
      const worldPos = mapCode.getWorldLocation(options.coordinateCode)
      initialPosition = new THREE.Vector3(worldPos.first, 0, worldPos.second)
    } else {
      throw new Error('SubmarineOptions requires either coordinateCode or worldPosition',)
    }


    // 2. 罗盘航向 → Three.js 弧度
    const headingRad = THREE.MathUtils.degToRad(90 - options.headingDegrees)

    // 3. 速度：节 → 场景单位/秒
    const speedScene = (options.speedKnots * 1852 * METERS_TO_SCENE) / 3600

    // 4. 加载模型
    const loader = new GLTFLoader()
    const gltf = await loader.loadAsync(options.modelUrl)
    const visual = gltf.scene
    normalizeSubmarine(visual, CARGO_MODEL_LENGTH_SCENE, CARGO_SURFACE_MODEL_OFFSET)

    // 修正模型默认朝向：确保船头沿 +X（与潜艇一致）
    const box = new THREE.Box3().setFromObject(visual)
    const size = box.getSize(new THREE.Vector3())
    if (size.z > size.x) {
      // 模型船头默认沿 Z 轴，旋转 90° 使船头对齐 +X
      visual.rotation.y = Math.PI / 2
      // 旋转后重新居中
      const rotatedBox = new THREE.Box3().setFromObject(visual)
      const center = rotatedBox.getCenter(new THREE.Vector3())
      visual.position.x -= center.x
      visual.position.z -= center.z
    }

    visual.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      for (const material of materials) {
        if (material instanceof THREE.MeshStandardMaterial) {
          material.roughness = 0.5
          material.metalness = 0.3
          material.needsUpdate = true
        }
      }
    })

    // 5. 读取归一化后的模型尺寸
    const bbox = new THREE.Box3().setFromObject(visual)
    const modelSize = bbox.getSize(new THREE.Vector3())

    // 6. 创建根节点
    const root = new THREE.Group()
    root.position.copy(initialPosition)
    root.rotation.y = headingRad
    root.add(visual)

    // 7. 添加到场景
    engine.scene.add(root)

    //8. 向模型管理器注册模型
    options.entityRegistry.register({
      id: options.id,
      type: 'cargoShip',
      root: root
    })

    return new CargoShipController(
      options.id,
      root,
      visual,
      headingRad,
      speedScene,
      modelSize.x,
      modelSize.y,
      options.entityRegistry,
    )
  }

  // ==================== 构造函数 ====================

  constructor(
    id: string,
    root: THREE.Group,
    visual: THREE.Object3D,
    heading: number,
    speed: number,
    modelLength: number,
    modelHeight: number,
    entityRegistry: GameEntityRegistry
  ) {
    this.id = id
    this.root = root
    this.visual = visual
    this.heading = heading
    this.currentSpeed = speed
    this.modelLength = modelLength
    this.modelHeight = modelHeight
    this.entityRegistry = entityRegistry
  }

  // ==================== 每帧更新 ====================

  update(delta: number): void {
    if (this.isDestroyed) {
      this.updateSinking(delta)
      return
    }

    if (Math.abs(this.currentSpeed) < 0.0001) return

    this.root.rotation.y = this.heading

    this.movementDelta.set(
      Math.cos(this.heading) * this.currentSpeed * delta,
      0,
      -Math.sin(this.heading) * this.currentSpeed * delta,
    )
    this.root.position.add(this.movementDelta)
  }

  /** 跟随海面波浪高度 */
  updateHeight(sampledWaterHeight: number): void {
    if (this.isDestroyed) return
    this.root.position.y = sampledWaterHeight
  }

  /** 标记被摧毁 */
  destroy(): void {
    if (this.isDestroyed) return
    this.isDestroyed = true
    this.currentSpeed = 0
  }

  private updateSinking(delta: number): void {
    if (this.isSink) return

    const targetY = -SINK_DEPTH
    const sinkSpeed = 3 // 场景单位/秒
    this.root.position.y = Math.max(
      this.root.position.y - sinkSpeed * delta,
      targetY,
    )

    this.visual.rotation.z = THREE.MathUtils.damp(
      this.visual.rotation.z,
      this.sinkPitch,
      0.7,
      delta,
    )

    if (Math.abs(this.root.position.y - targetY) <= 0.5) {
      this.root.position.y = targetY
      this.visual.rotation.z = this.sinkPitch
      this.isSink = true
    }
  }

  handleCollision(_event: CollisionEvent, self: CollisionEntitySnapshot): void {
    // console.log(`[collision:${self.type}] ${self.id}`)

    //Test
    // console.log(`Hi this carship! a type: ${_event.a.type}, b type: ${_event.b.type}`)


    //碰撞情景
    let CollisionSituation: CollisionSituationType
    CollisionSituation = CollisionDecision(_event)

    switch (CollisionSituation) {
      case CollisionSituationType.Submarine_Hits_Submarine:
        break


      case CollisionSituationType.Submarine_Hits_Cargoship:
        //货船航向航速不变
        break

      case CollisionSituationType.Cargoship_Hits_Cargoship:

        //停船，并反向行驶
        this.currentSpeed = 0
        this.heading = this.heading * -1
        break

      case CollisionSituationType.Torpedor_Hits_Submarine:
        break


      case CollisionSituationType.Torpedor_Hits_Cargoship:

        //货船被击沉
        this.destroy()

        //向后端更新Convoy信息，该船被击沉

        break

      default:
        break

    }


  }

  /** 释放资源 */
  dispose(): void {
    this.entityRegistry.unregister(this.id)
    this.root.removeFromParent()
    disposeObject(this.visual)
  }
}
