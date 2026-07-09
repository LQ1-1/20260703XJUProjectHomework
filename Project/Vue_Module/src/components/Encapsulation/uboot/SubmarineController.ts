/**
 * SubmarineController — 潜艇完整控制器
 *
 * 封装潜艇的全部行为：模型加载、物理运动、输入响应、相机跟随。
 *
 * 使用方式（静态异步工厂）：
 *   const uboat = await SubmarineController.create(engine, inputCtrl, cameraCtrl, {
 *     id: 'player-1',
 *     coordinateCode: 'AD16',
 *     initialHeadingDegrees: 0,
 *     initialDepthMeters: 0,
 *     isPlayerControlled: true,
 *     modelUrl: submarineModelUrl,
 *   })
 *   // 之后每帧由 GameEngine 自动调用 uboat.update(delta, time)
 *   // 销毁：uboat.dispose()
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { Updatable } from '../engine/GameEngine'
import type { GameEngine } from '../engine/GameEngine'
import type { InputController } from '../engine/InputController'
import type { CameraController } from '../engine/CameraController'
import { moveTowards } from '../modules/mathUtils'
import { normalizeSubmarine, tuneSubmarineMaterials, disposeObject } from '../modules/modelUtils'
import { normalizeDegrees, yawToCompassDegrees } from '../modules/navigationMath'
import { MapCode } from '../../../common/map/mapcode'
import {
  MAX_DEPTH_SCENE,
  MAX_TURN_RATE,
  MAX_VERTICAL_SPEED,
  REVERSE_SPEED_RATIO,
  SCENE_TO_METERS,
  SPEED_TRANSITION_DEPTH,
  SUBMERGED_MAX_SPEED,
  SURFACE_DEPTH_EPSILON_SCENE,
  SURFACE_MAX_SPEED,
  METERS_TO_SCENE,
  MODEL_LENGTH_SCENE,
  SURFACE_MODEL_OFFSET,
} from '../constant/sceneUnits'

export interface SubmarineOptions {
  /** 唯一标识（用于多潜艇管理、HUD 等） */
  id: string
  /** 地图坐标代码，如 "AD16"，通过 MapCode 转换为世界坐标 */
  coordinateCode: string
  /** 初始航向（罗盘度数，0=北，90=东） */
  initialHeadingDegrees: number
  /** 初始深度（米） */
  initialDepthMeters: number
  /** 是否玩家操作（绑定输入、相机跟随） */
  isPlayerControlled: boolean
  /** GLB 模型文件路径 */
  modelUrl: string
}

const PERISCOPE_MOUSE_SENSITIVITY = 0.004

export class SubmarineController implements Updatable {
  // ---- 基础属性 ----
  public readonly id: string
  public readonly isPlayerControlled: boolean

  /** 模型归一化后的实际长度（场景单位） */
  public readonly modelLength: number
  /** 模型归一化后的实际高度（场景单位），可用于距离测算 */
  public readonly modelHeight: number

  // ---- Three.js 节点 ----
  public readonly root: THREE.Group
  public visual!: THREE.Object3D

  // ---- 运动状态 ----
  public heading = 0
  public currentSpeed = 0
  public targetDepth = 0
  public currentDepth = 0
  public verticalSpeed = 0

  // ---- 外部引用 ----
  private engine: GameEngine
  private input: InputController
  private cameraCtrl: CameraController

  // ---- 内部状态 ----
  private movementDelta = new THREE.Vector3()
  private readonly maxPitch = THREE.MathUtils.degToRad(60)
  private readonly pitchResponseSensitivity = 17
  private readonly pitchSmoothing = 1.04
  private lastHudUpdateTime = 0
  private surfaceLimitWasActive = false
  private depthLimitWasActive = false
  private _sampledWaterHeight = 0

  // ---- 鱼雷数量 ----
  private torpedorCount: number = 14; //鱼雷数量固定14发

  // ---- HUD 回调（由 Vue 组件注入） ----
  onHudUpdate?: (data: {
    speedKmh: number
    depthMeters: number
    headingDegrees: number
    periscopeRelativeBearingDegrees: number
    navigationState: '水面' | '水下' | '潜望镜视角' | '水面瞄准视角'
    worldX: number
    worldZ: number
    isSubmerged: boolean
  }) => void

  onLimitNotice?: (message: string) => void

  // ==================== 静态异步工厂 ====================

  /**
   * 创建完整初始化的潜艇控制器。
   * 会自动加载模型、设置物理参数、添加到场景，如果是玩家控制的则绑定输入和相机。
   */
  static async create(
    engine: GameEngine,
    input: InputController,
    cameraCtrl: CameraController,
    options: SubmarineOptions,
  ): Promise<SubmarineController> {
    // 1. 坐标代码 → 世界坐标
    const mapCode = new MapCode(0, 0)
    const worldPos = mapCode.getWorldLocation(options.coordinateCode)
    const initialPosition = new THREE.Vector3(worldPos.first, 0, worldPos.second)

    // 2. 罗盘航向 → 弧度（罗盘 0°=世界 -Z，90°=世界 +X）
    const headingRad = THREE.MathUtils.degToRad(90 - options.initialHeadingDegrees)

    // 3. 加载模型
    const loader = new GLTFLoader()
    const gltf = await loader.loadAsync(options.modelUrl)
    const visual = gltf.scene
    normalizeSubmarine(visual, MODEL_LENGTH_SCENE, SURFACE_MODEL_OFFSET)
    tuneSubmarineMaterials(visual)

    // 读取归一化后的模型尺寸
    const bbox = new THREE.Box3().setFromObject(visual)
    const modelSize = bbox.getSize(new THREE.Vector3())

    // 4. 创建根节点
    const root = new THREE.Group()
    root.position.copy(initialPosition)
    root.rotation.y = headingRad
    root.add(visual)

    // 5. 添加到场景
    engine.scene.add(root)

    // 6. 注册到引擎更新循环
    const controller = new SubmarineController(
      engine, input, cameraCtrl, root, visual, options, modelSize.x, modelSize.y,
    )
    engine.addUpdatable(controller)

    // 7. 初始化相机（仅玩家潜艇）
    if (options.isPlayerControlled) {
      cameraCtrl.initDefaultPosition(root.position)
    }

    return controller
  }

  // ==================== 构造函数 ====================

  private constructor(
    engine: GameEngine,
    input: InputController,
    cameraCtrl: CameraController,
    root: THREE.Group,
    visual: THREE.Object3D,
    options: SubmarineOptions,
    modelLength: number,
    modelHeight: number,
  ) {
    this.engine = engine
    this.input = input
    this.cameraCtrl = cameraCtrl
    this.root = root
    this.visual = visual
    this.id = options.id
    this.isPlayerControlled = options.isPlayerControlled
    this.modelLength = modelLength
    this.modelHeight = modelHeight

    // 初始航向由 root.rotation.y 决定（已在工厂中设置）
    this.heading = root.rotation.y

    // 初始深度
    const initialDepthScene = options.initialDepthMeters * METERS_TO_SCENE
    this.targetDepth = initialDepthScene
    this.currentDepth = initialDepthScene
  }

  // ==================== 计算属性 ====================

  get depthMeters(): number {
    return this.currentDepth * SCENE_TO_METERS
  }

  get speedKmh(): number {
    return this.currentSpeed * SCENE_TO_METERS * 3.6
  }

  get speedKnots(): number {
    return this.speedKmh / 1.852
  }

  get sampledWaterHeight(): number {
    return this._sampledWaterHeight
  }

  setSampledWaterHeight(h: number): void {
    this._sampledWaterHeight = h
  }

  isAtSurface(): boolean {
    return this.currentDepth <= SURFACE_DEPTH_EPSILON_SCENE
  }

  isAtPeriscopeDepth(): boolean {
    const d = this.depthMeters
    return d >= 13 && d <= 15
  }

  get compassHeading(): number {
    return yawToCompassDegrees(this.heading)
  }

  // ==================== 每帧更新（由 GameEngine 调用） ====================

  update(delta: number, time: number): void {
    if (!this.isPlayerControlled) {
      // AI 潜艇：仅更新水平运动和高度
      this.updateHorizontalMovement(delta)
      this.updateSubmarineHeight(delta)
      this.updateSubmarinePitch(delta)
      return
    }

    // ---- 玩家潜艇 ----

    // Q 键触发瞄准切换
    if (this.input.pressedKeys.has('KeyQ') && !this.cameraCtrl.isAiming) {
      // Q 键由外部（Vue 层或 InputController 的 onAction）处理，这里不重复
    }

    // 瞄准模式禁止 KL 深度控制
    const isAiming = this.cameraCtrl.isAiming
    if (isAiming) {
      this.input.pressedKeys.delete('KeyK')
      this.input.pressedKeys.delete('KeyL')
    }

    // 深度控制
    this.updatePlayerDepth(delta, isAiming)

    // 水平移动
    this.updateHorizontalMovement(delta)

    // 俯仰
    this.updateSubmarinePitch(delta)

    // 高度跟随海面
    this.updateSubmarineHeight(delta)

    // 更新相机
    this.cameraCtrl.update(this)

    // 更新太阳和灯光
    this.engine.updateSunAndLight(this.root.position)

    // 水下视觉效果
    this.engine.updateUnderwaterAppearance(this.currentDepth, this.depthMeters)

    // HUD 更新（限制 100ms 一次）
    if (time - this.lastHudUpdateTime >= 100) {
      this.lastHudUpdateTime = time
      this.emitHudUpdate()
    }
  }

  // ==================== 深度控制 ====================

  private updatePlayerDepth(delta: number, isAiming: boolean): void {
    const diveInput = isAiming
      ? 0
      : (this.input.pressedKeys.has('KeyL') ? 1 : 0) -
        (this.input.pressedKeys.has('KeyK') ? 1 : 0)

    if (diveInput !== 0) {
      this.targetDepth = THREE.MathUtils.clamp(
        this.targetDepth + diveInput * MAX_VERTICAL_SPEED * delta,
        0,
        MAX_DEPTH_SCENE,
      )
    }

    // 水面/深度限制提示
    const atSurfaceLimit = this.input.pressedKeys.has('KeyK') && this.targetDepth <= 0
    if (atSurfaceLimit && !this.surfaceLimitWasActive) {
      this.onLimitNotice?.('已到达水面')
    }
    this.surfaceLimitWasActive = atSurfaceLimit

    const atDepthLimit = this.input.pressedKeys.has('KeyL') && this.targetDepth >= MAX_DEPTH_SCENE
    if (atDepthLimit && !this.depthLimitWasActive) {
      this.onLimitNotice?.('已到达最大潜深 280 m')
    }
    this.depthLimitWasActive = atDepthLimit

    // 平滑垂直运动
    const difference = this.targetDepth - this.currentDepth
    const desiredVerticalSpeed = THREE.MathUtils.clamp(
      difference * 2,
      -MAX_VERTICAL_SPEED,
      MAX_VERTICAL_SPEED,
    )
    this.verticalSpeed = THREE.MathUtils.damp(this.verticalSpeed, desiredVerticalSpeed, 3, delta)

    const nextDepth = this.currentDepth + this.verticalSpeed * delta
    if (difference !== 0 && Math.sign(this.targetDepth - nextDepth) !== Math.sign(difference)) {
      this.currentDepth = this.targetDepth
      this.verticalSpeed = 0
    } else {
      this.currentDepth = THREE.MathUtils.clamp(nextDepth, 0, MAX_DEPTH_SCENE)
    }
  }

  // ==================== 水平移动 ====================

  updateHorizontalMovement(delta: number): void {
    const throttle = this.isPlayerControlled
      ? (this.input.pressedKeys.has('KeyW') ? 1 : 0) -
        (this.input.pressedKeys.has('KeyS') ? 1 : 0)
      : 0

    const maxForwardSpeed = this.currentForwardSpeedLimit()
    const targetSpeed =
      throttle > 0
        ? maxForwardSpeed
        : throttle < 0
          ? -maxForwardSpeed * REVERSE_SPEED_RATIO
          : 0

    const requestedSpeedLimit =
      throttle < 0 ? maxForwardSpeed * REVERSE_SPEED_RATIO : maxForwardSpeed
    const currentDirectionLimit =
      this.currentSpeed < 0 ? maxForwardSpeed * REVERSE_SPEED_RATIO : maxForwardSpeed
    const acceleration = requestedSpeedLimit / 12
    const coastDeceleration = currentDirectionLimit / 8
    const isReversing =
      throttle !== 0 &&
      this.currentSpeed !== 0 &&
      Math.sign(targetSpeed) !== Math.sign(this.currentSpeed)
    const rate =
      throttle === 0
        ? coastDeceleration
        : isReversing
          ? coastDeceleration * 1.5
          : acceleration

    this.currentSpeed = moveTowards(this.currentSpeed, targetSpeed, rate * delta)
    this.currentSpeed = THREE.MathUtils.clamp(
      this.currentSpeed,
      -maxForwardSpeed * REVERSE_SPEED_RATIO,
      maxForwardSpeed,
    )

    const turnInput = this.isPlayerControlled
      ? (this.input.pressedKeys.has('KeyA') ? 1 : 0) -
        (this.input.pressedKeys.has('KeyD') ? 1 : 0)
      : 0

    if (turnInput !== 0 && Math.abs(this.currentSpeed) > 0.0001) {
      const directionalLimit =
        this.currentSpeed >= 0 ? maxForwardSpeed : maxForwardSpeed * REVERSE_SPEED_RATIO
      const steeringStrength = THREE.MathUtils.clamp(
        Math.abs(this.currentSpeed) / directionalLimit,
        0,
        1,
      )
      this.heading +=
        turnInput *
        Math.sign(this.currentSpeed) *
        MAX_TURN_RATE *
        steeringStrength *
        delta
      this.root.rotation.y = this.heading
    }

    this.movementDelta.set(
      Math.cos(this.heading) * this.currentSpeed * delta,
      0,
      -Math.sin(this.heading) * this.currentSpeed * delta,
    )
    this.root.position.add(this.movementDelta)

  }

  // ==================== 高度 ====================

  private updateSubmarineHeight(delta: number): void {
    const isAtSurface = this.currentDepth < 0.02
    const targetY = isAtSurface ? this._sampledWaterHeight : -this.currentDepth
    const followStrength = 1 - Math.exp(-delta * (isAtSurface ? 2.8 : 4))
    this.root.position.y = THREE.MathUtils.lerp(
      this.root.position.y,
      targetY,
      followStrength,
    )
  }

  // ==================== 俯仰 ====================

  private updateSubmarinePitch(delta: number): void {
    if (!this.visual) return
    const pitchRange = this.pitchResponseSensitivity * METERS_TO_SCENE
    const pitchIntent = THREE.MathUtils.clamp(
      (this.targetDepth - this.currentDepth) / pitchRange,
      -1,
      1,
    )
    const targetPitch = -pitchIntent * this.maxPitch
    this.visual.rotation.z = THREE.MathUtils.damp(
      this.visual.rotation.z,
      targetPitch,
      this.pitchSmoothing,
      delta,
    )
  }

  // ==================== 速度限制 ====================

  private currentForwardSpeedLimit(): number {
    const depthBlend = THREE.MathUtils.smoothstep(this.currentDepth, 0, SPEED_TRANSITION_DEPTH)
    return THREE.MathUtils.lerp(SURFACE_MAX_SPEED, SUBMERGED_MAX_SPEED, depthBlend)
  }

  // ==================== HUD ====================

  private emitHudUpdate(): void {
    if (!this.onHudUpdate) return
    const isAiming = this.cameraCtrl.isAiming
    const periscopeYaw = this.cameraCtrl.aimViewController.periscopeYaw
    const currentHeadingDegrees = this.compassHeading

    this.onHudUpdate({
      speedKmh: this.speedKmh,
      depthMeters: this.depthMeters,
      headingDegrees: currentHeadingDegrees,
      periscopeRelativeBearingDegrees: isAiming
        ? normalizeDegrees(yawToCompassDegrees(periscopeYaw) - currentHeadingDegrees)
        : 0,
      navigationState:
        this.cameraCtrl.aimingMode === 'surfaceAim'
          ? '水面瞄准视角'
          : this.cameraCtrl.aimingMode === 'periscope'
            ? '潜望镜视角'
            : this.isAtSurface()
              ? '水面'
              : '水下',
      worldX: this.root.position.x,
      worldZ: this.root.position.z,
      isSubmerged: this.depthMeters > 0,
    })
  }

  getTorpedorCount(){
    return this.torpedorCount;
  }

  setTorpedorCount(newTorpedorCount: number){
    this.torpedorCount=newTorpedorCount
  }

  // ==================== 清理 ====================

  dispose(): void {
    this.engine.removeUpdatable(this)
    this.root.removeFromParent()
    disposeObject(this.visual)
  }
}
