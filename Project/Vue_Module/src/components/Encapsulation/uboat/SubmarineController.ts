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
import type { Updatable } from '../engine/GameEngine.ts'
import type { GameEngine } from '../engine/GameEngine.ts'
import type { InputController } from '../engine/InputController.ts'
import type { CameraController } from '../engine/CameraController.ts'
import type { CollisionEntitySnapshot, CollisionEvent } from '../modules/hitdetect.ts'
import { CollisionDecision, CollisionSituationType } from '../modules/hitdetect.ts'
import { moveTowards } from '../modules/mathUtils.ts'
import { normalizeSubmarine, tuneSubmarineMaterials, disposeObject } from '../modules/modelUtils.ts'
import { normalizeDegrees, normalizeSignedDegrees, yawToCompassDegrees } from '../modules/navigationMath.ts'
import { findPropellerMeshes, updatePropellerRotation } from '../modules/propellerAnimation.ts'
import { PropellerBubbleTrail } from '../modules/propellerBubbleTrail.ts'
import { MapCode } from '../../../common/map/mapcode.ts'
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
  SINK_DEPTH,
} from '../constant/sceneUnits.ts'
import { ExplosionSplashEffect } from '../ExplosionSplashEffect/explosionSplashEffect.ts'
import { GameEntityRegistry } from '../entitymanager/GameEntityRegistry.ts'
import { TorpedorController } from '../torpedor/TorpedorController.ts'
import type { TorpedoLaunchPlan } from '../torpedor/torpedoTypes.ts'
import PlayAudio from '@/common/audiotool/PlayAudio.ts'
import type { OceanSurfaceSample } from '../ocean/OceanSimulation.ts'

export const TORPEDO_FORWARD_OFFSET_FROM_THE_BOW = 3.5
export const TORPEDO_LATERAL_OFFSET_FROM_THE_CENTERLINE=1

/** ALARM buff 持续时间：右上角 ALARM 按钮触发后保持 10 秒。 */
export const ALARM_BUFF_DURATION_SECONDS = 10
/** ALARM 下潜速度倍率：仅增强 L 键下潜速度，不影响 K 键上浮速度。 */
export const ALARM_DIVE_SPEED_MULTIPLIER = 2.15
/** ALARM 最大俯仰角：buff 期间上浮抬头和下潜低头上限提升到 75 度。 */
export const ALARM_MAX_PITCH_DEGREES = 75
/** 潜望镜贴近海面但需要保留更远识别距离，单独减弱该模式的雾效。 */
const PERISCOPE_FOG_DENSITY_MULTIPLIER = 0.35


export interface SubmarineOptions {
  /** 唯一标识（用于多潜艇管理、HUD 等） */
  id: string
  /** 地图坐标代码，如 "AD16"，通过 MapCode 转换为世界坐标 */
  coordinateCode?: string
  /** 地图坐标（数字）  */
  worldPosition?: {
    x: number
    z: number
  }
  /** 初始航向（罗盘度数，0=北，90=东） */
  initialHeadingDegrees: number
  /** 初始深度（米） */
  initialDepthMeters: number
  /** 是否玩家操作（绑定输入、相机跟随） */
  isPlayerControlled: boolean
  /** GLB 模型文件路径 */
  modelUrl: string
  /** 鱼雷 GLB 模型文件路径 */
  torpedoModelUrl?: string

  /** 模型管理对象 */
  entityRegistry: GameEntityRegistry
}

const PERISCOPE_MOUSE_SENSITIVITY = 0.004

/** 航速档位（从快到慢，供 Q/E 键循环使用） */
const SPEED_FRACTION_STEPS = [1, 0.9, 0.75, 0.5, 0.25, 0, -0.25, -0.5, -0.75, -1]

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
  private propellers: THREE.Object3D[] = []
  private propellerBubbleTrail: PropellerBubbleTrail | undefined

  /** 保存模型管理对象 */
  private readonly entityRegistry: GameEntityRegistry

  // ---- 运动状态 ----
  public heading = 0
  public currentSpeed = 0
  public targetDepth = 0
  public currentDepth = 0
  public verticalSpeed = 0

  // ---- 面板指令（非 null 时覆盖键盘输入） ----
  private commandedSpeedFraction: number | null = null
  private commandedHeadingDegrees: number | null = null

  // ---- 外部引用 ----
  private engine: GameEngine
  private input: InputController
  private cameraCtrl: CameraController
  private torpedoModelUrl: string | undefined

  // ---- 内部状态 ----
  private movementDelta = new THREE.Vector3()
  private readonly maxPitch = THREE.MathUtils.degToRad(60)
  private readonly alarmMaxPitch = THREE.MathUtils.degToRad(ALARM_MAX_PITCH_DEGREES)
  private readonly sinkPitch = THREE.MathUtils.degToRad(-60)
  private readonly pitchResponseSensitivity = 17
  private readonly pitchSmoothing = 1.04
  private lastHudUpdateTime = 0
  private surfaceLimitWasActive = false
  private depthLimitWasActive = false
  private floodAudioPlayedForCurrentDive = false
  private blowAudioPlayedForCurrentAscent = false
  private _sampledWaterHeight = 0
  private sampledWaterNormal = new THREE.Vector3(0, 1, 0)
  private wavePitch = 0
  private waveRoll = 0

  // ---- 鱼雷数量 ----
  private torpedorCount: number = 14; //鱼雷数量固定14发

  //---- 是否被击沉 ----
  public isDestroyed = false
  public isSink = false //是否已经沉底，沉底后碰撞检测失效
  private isAlarmBuffActive = false

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
    commandedSpeedFraction: number | null
    torpedorCount: number
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
    // 1. 坐标代码/世界坐标 → 世界坐标
    // const mapCode = new MapCode(0, 0)
    // const worldPos = mapCode.getWorldLocation(options.coordinateCode)
    // const initialPosition = new THREE.Vector3(worldPos.first, 0, worldPos.second)

    //2026-07-09 LQH: 兼容直接传入数字世界坐标
    let initialPosition: THREE.Vector3
    if (options.worldPosition) {
      initialPosition = new THREE.Vector3(options.worldPosition.x, 0, options.worldPosition.z)
    } else if (options.coordinateCode) {
      const mapCode = new MapCode(0, 0)
      const worldPos = mapCode.getWorldLocation(options.coordinateCode)
      initialPosition = new THREE.Vector3(worldPos.first, 0, worldPos.second)
    } else {
      throw new Error('SubmarineOptions requires either coordinateCode or worldPositon')
    }


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
      engine,
      input,
      cameraCtrl,
      root,
      visual,
      options,
      modelSize.x,
      modelSize.y,

      options.entityRegistry
    )
    controller.propellers = findPropellerMeshes(visual, {
      names: ['Material2.010'],
      axis: 'x',
      splitMeshByAxis: 'y',
      tailSign: -1,
      maxPropellers: 1,
      label: 'submarine',
    })
    if (controller.propellers.length > 0) {
      controller.propellerBubbleTrail = new PropellerBubbleTrail(engine, {
        sources: controller.propellers,
        getSpeed: () => controller.currentSpeed,
        maxBubbles: 360,
        emitRate: 60,
      })
      engine.scene.add(controller.propellerBubbleTrail.root)
      engine.addUpdatable(controller.propellerBubbleTrail)
    }
    engine.addUpdatable(controller)

    // 7. 初始化相机（仅玩家潜艇）
    if (options.isPlayerControlled) {
      cameraCtrl.initDefaultPosition(root.position)
    }

    //8.向模型管理器注册模型
    options.entityRegistry.register({
      id: options.id,
      type: 'submarine',
      root: root
    })

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
    entityRegistry: GameEntityRegistry
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
    this.torpedoModelUrl = options.torpedoModelUrl

    this.entityRegistry = entityRegistry

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
    this.sampledWaterNormal.set(0, 1, 0)
    this.wavePitch = 0
    this.waveRoll = 0
  }

  setSampledSurface(sample: OceanSurfaceSample): void {
    this._sampledWaterHeight = sample.height
    this.sampledWaterNormal.copy(sample.normal).normalize()
    this.updateWaveAttitudeFromNormal()
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

  activateAlarmBuff(): void {
    this.isAlarmBuffActive = true
  }

  deactivateAlarmBuff(): void {
    this.isAlarmBuffActive = false
  }

  // ==================== 每帧更新（由 GameEngine 调用） ====================

  update(delta: number, time: number): void {
    if (this.isDestroyed) {
      this.updateSinking(delta)

      if (this.isPlayerControlled) {
        this.cameraCtrl.update(this)
        this.engine.updateSunAndLight(this.root.position)
        this.engine.updateUnderwaterAppearance(
          this.currentDepth,
          this.depthMeters,
          this.underwaterAppearanceOptions(),
        )

        if (time - this.lastHudUpdateTime >= 100) {
          this.lastHudUpdateTime = time
          this.emitHudUpdate()
        }
      }
      return
    }

    if (!this.isPlayerControlled) {
      // AI 潜艇：仅更新水平运动和高度
      this.updateHorizontalMovement(delta)
      this.updateSubmarineHeight(delta)
      this.updateSubmarinePitch(delta)
      return
    }

    // ---- 玩家潜艇 ----

    // Q 加速一档 / E 减速一档（非瞄准模式下生效）
    if (!this.cameraCtrl.isAiming) {
      if (this.input.pressedKeys.has('KeyQ')) {
        this.input.pressedKeys.delete('KeyQ')
        this.cycleSpeedCommand(1)
      }
      if (this.input.pressedKeys.has('KeyE')) {
        this.input.pressedKeys.delete('KeyE')
        this.cycleSpeedCommand(-1)
      }
    }

    // 瞄准模式禁止 KL 深度控制，并清除 Q/E 残留
    const isAiming = this.cameraCtrl.isAiming
    if (isAiming) {
      this.input.pressedKeys.delete('KeyK')
      this.input.pressedKeys.delete('KeyL')
      this.input.pressedKeys.delete('KeyQ')
      this.input.pressedKeys.delete('KeyE')
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
    this.engine.updateUnderwaterAppearance(
      this.currentDepth,
      this.depthMeters,
      this.underwaterAppearanceOptions(),
    )

    // HUD 更新（限制 100ms 一次）
    if (time - this.lastHudUpdateTime >= 100) {
      this.lastHudUpdateTime = time
      this.emitHudUpdate()
    }
  }

  // ==================== 深度控制 ====================

  private updatePlayerDepth(delta: number, isAiming: boolean): void {
    const isDiveKeyPressed = !isAiming && this.input.pressedKeys.has('KeyL')
    const isSurfaceKeyPressed = !isAiming && this.input.pressedKeys.has('KeyK')

    if (this.isAtSurface() && isDiveKeyPressed && !this.floodAudioPlayedForCurrentDive) {
      const playAudio = new PlayAudio('/assets/audio/Fluten.wav', 2)
      void playAudio.play()
      this.floodAudioPlayedForCurrentDive = true
    }

    if (this.isAtSurface() && !isDiveKeyPressed) {
      this.floodAudioPlayedForCurrentDive = false
    }

    if (!this.isAtSurface() && isSurfaceKeyPressed && !this.blowAudioPlayedForCurrentAscent) {
      const playAudio = new PlayAudio('/assets/audio/Anblassen.wav', 1)
      void playAudio.play()
      this.blowAudioPlayedForCurrentAscent = true
    }

    if (!isSurfaceKeyPressed) {
      this.blowAudioPlayedForCurrentAscent = false
    }

    const diveInput = isAiming
      ? 0
      : (isDiveKeyPressed ? 1 : 0) -
      (isSurfaceKeyPressed ? 1 : 0)

    if (diveInput !== 0) {
      const verticalSpeed =
        diveInput > 0 && this.isAlarmBuffActive
          ? MAX_VERTICAL_SPEED * ALARM_DIVE_SPEED_MULTIPLIER
          : MAX_VERTICAL_SPEED
      this.targetDepth = THREE.MathUtils.clamp(
        this.targetDepth + diveInput * verticalSpeed * delta,
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
    const maxVerticalSpeed =
      difference > 0 && this.isAlarmBuffActive
        ? MAX_VERTICAL_SPEED * ALARM_DIVE_SPEED_MULTIPLIER
        : MAX_VERTICAL_SPEED
    const desiredVerticalSpeed = THREE.MathUtils.clamp(
      difference * 2,
      -MAX_VERTICAL_SPEED,
      maxVerticalSpeed,
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

  private underwaterAppearanceOptions() {
    return {
      fogDensityMultiplier:
        this.cameraCtrl.aimingMode === 'periscope' ? PERISCOPE_FOG_DENSITY_MULTIPLIER : 1,
    }
  }

  // ==================== 水平移动 ====================

  updateHorizontalMovement(delta: number): void {
    const maxForwardSpeed = this.currentForwardSpeedLimit()

    // ---- 速度指令 ----
    let throttle = 0
    let targetSpeed = 0

    if (this.isPlayerControlled) {
      const rawThrottle =
        (this.input.pressedKeys.has('KeyW') ? 1 : 0) -
        (this.input.pressedKeys.has('KeyS') ? 1 : 0)

      if (this.commandedSpeedFraction !== null) {
        // 面板速度指令
        const fraction = this.commandedSpeedFraction
        if (fraction >= 0) {
          targetSpeed = maxForwardSpeed * fraction
          throttle = fraction > 0 ? 1 : 0
        } else {
          targetSpeed = -maxForwardSpeed * REVERSE_SPEED_RATIO * Math.abs(fraction)
          throttle = -1
        }
      } else if (rawThrottle !== 0) {
        // 仅在航速下拉选择“手动航速（W/S）”时生效。
        throttle = rawThrottle
        targetSpeed =
          throttle > 0
            ? maxForwardSpeed
            : -maxForwardSpeed * REVERSE_SPEED_RATIO
      }
    }

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

    // ---- 转向指令 ----
    if (this.isPlayerControlled) {
      const rawTurn =
        (this.input.pressedKeys.has('KeyA') ? 1 : 0) -
        (this.input.pressedKeys.has('KeyD') ? 1 : 0)

      if (this.commandedHeadingDegrees !== null && Math.abs(this.currentSpeed) > 0.0001) {
        // 面板航向指令：直接转向目标（不受前进/后退方向影响）
        const targetRad = THREE.MathUtils.degToRad(90 - this.commandedHeadingDegrees)
        let diff = targetRad - this.heading
        diff = Math.atan2(Math.sin(diff), Math.cos(diff)) // 归一化到 [-π, π]

        const directionalLimit =
          this.currentSpeed >= 0 ? maxForwardSpeed : maxForwardSpeed * REVERSE_SPEED_RATIO
        const steeringStrength = THREE.MathUtils.clamp(
          Math.abs(this.currentSpeed) / directionalLimit,
          0,
          1,
        )
        const maxTurn = MAX_TURN_RATE * steeringStrength * delta

        if (Math.abs(diff) <= maxTurn) {
          this.heading = targetRad
          this.root.rotation.y = this.heading
        } else {
          this.heading += Math.sign(diff) * maxTurn
          this.root.rotation.y = this.heading
        }
      } else if (rawTurn !== 0) {
        // 仅在航向下拉选择“手动转向（A/D）”时生效。
        if (Math.abs(this.currentSpeed) > 0.0001) {
          const directionalLimit =
            this.currentSpeed >= 0 ? maxForwardSpeed : maxForwardSpeed * REVERSE_SPEED_RATIO
          const steeringStrength = THREE.MathUtils.clamp(
            Math.abs(this.currentSpeed) / directionalLimit,
            0,
            1,
          )
          this.heading +=
            rawTurn *
            Math.sign(this.currentSpeed) *
            MAX_TURN_RATE *
            steeringStrength *
            delta
          this.root.rotation.y = this.heading
        }
      }
    }

    this.movementDelta.set(
      Math.cos(this.heading) * this.currentSpeed * delta,
      0,
      -Math.sin(this.heading) * this.currentSpeed * delta,
    )
    this.root.position.add(this.movementDelta)
    updatePropellerRotation(this.propellers, this.currentSpeed, delta, {
      axis: 'x',
      spinMultiplier: 36,
      directionMultiplier: 1,
    })
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
    const maxPitch = this.isAlarmBuffActive ? this.alarmMaxPitch : this.maxPitch
    const waveFactor = this.surfaceAttitudeFactor()
    const targetPitch = -pitchIntent * maxPitch + this.wavePitch * waveFactor
    this.visual.rotation.z = THREE.MathUtils.damp(
      this.visual.rotation.z,
      targetPitch,
      this.pitchSmoothing,
      delta,
    )
    this.visual.rotation.x = THREE.MathUtils.damp(
      this.visual.rotation.x,
      this.waveRoll * waveFactor,
      1.8,
      delta,
    )
  }

  private updateWaveAttitudeFromNormal(): void {
    const normal = this.sampledWaterNormal
    const normalY = Math.max(normal.y, 0.2)
    const gradientX = -normal.x / normalY
    const gradientZ = -normal.z / normalY
    const forwardX = Math.cos(this.heading)
    const forwardZ = -Math.sin(this.heading)
    const rightX = Math.sin(this.heading)
    const rightZ = Math.cos(this.heading)
    const slopeForward = gradientX * forwardX + gradientZ * forwardZ
    const slopeRight = gradientX * rightX + gradientZ * rightZ
    const maxSurfaceAngle = THREE.MathUtils.degToRad(8)
    this.wavePitch = THREE.MathUtils.clamp(Math.atan(slopeForward), -maxSurfaceAngle, maxSurfaceAngle)
    this.waveRoll = THREE.MathUtils.clamp(-Math.atan(slopeRight), -maxSurfaceAngle, maxSurfaceAngle)
  }

  private surfaceAttitudeFactor(): number {
    const depthMeters = this.currentDepth * SCENE_TO_METERS
    if (depthMeters <= 1) return 1
    if (depthMeters >= 5) return 0
    return 1 - THREE.MathUtils.smoothstep(depthMeters, 1, 5)
  }

  private updateSinking(delta: number): void {
    if (this.isSink) return

    this.currentSpeed = 0
    this.verticalSpeed = 0
    this.targetDepth = SINK_DEPTH
    this.currentDepth = Math.min(SINK_DEPTH, Math.max(this.currentDepth, -this.root.position.y))

    const targetY = -SINK_DEPTH
    const sinkSpeed = 3 // 场景单位/秒
    this.root.position.y = Math.max(
      this.root.position.y - sinkSpeed * delta,
      targetY,
    )
    this.currentDepth = Math.min(SINK_DEPTH, Math.max(0, -this.root.position.y))

    if (this.visual) {
      this.visual.rotation.z = THREE.MathUtils.damp(
        this.visual.rotation.z,
        this.sinkPitch,
        0.7,
        delta,
      )
    }

    if (Math.abs(this.root.position.y - targetY) <= 0.5) {
      this.root.position.y = targetY
      this.currentDepth = SINK_DEPTH
      if (this.visual) this.visual.rotation.z = this.sinkPitch
      this.isSink = true
    }
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
        ? normalizeSignedDegrees(yawToCompassDegrees(periscopeYaw) - currentHeadingDegrees)
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
      commandedSpeedFraction: this.commandedSpeedFraction,
      torpedorCount: this.torpedorCount,
    })
  }

  getTorpedorCount() {
    return this.torpedorCount;
  }

  setTorpedorCount(newTorpedorCount: number) {
    this.torpedorCount = Math.max(0, newTorpedorCount)
    this.emitHudUpdate()
  }

  async fireTorpedo(plan: TorpedoLaunchPlan): Promise<TorpedorController | null> {
    if (this.torpedorCount <= 0 || !this.torpedoModelUrl) return null

    const forward = new THREE.Vector3(
      Math.cos(this.heading),
      0,
      -Math.sin(this.heading),
    ).normalize()
    const right = new THREE.Vector3(-forward.z, 0, forward.x).normalize()
    const tubeOffsetIndex = plan.tubeId - 2.5
    const initialPosition = this.root.position
      .clone()
      .add(forward.multiplyScalar(this.modelLength * 0.55 + TORPEDO_FORWARD_OFFSET_FROM_THE_BOW))
      .add(right.multiplyScalar(tubeOffsetIndex * this.modelLength * 0.035+TORPEDO_LATERAL_OFFSET_FROM_THE_CENTERLINE))

    const torpedo = await TorpedorController.create(this.engine, {
      id: `${this.id}-torpedo-${Date.now()}-${plan.tubeId}`,
      ownerId: this.id,
      torpedoType: plan.torpedoType,
      initialPosition,
      heading: THREE.MathUtils.degToRad(90 - plan.headingDegrees),
      initialDepth: this.currentDepth + 3.5 * METERS_TO_SCENE,
      finalDepth: plan.finalDepthMeters * METERS_TO_SCENE,
      modelUrl: this.torpedoModelUrl,
      entityRegistry: this.entityRegistry,
    })

    //播放鱼雷发射音效
    let playAudio3 = new PlayAudio('/assets/audio/TorpedoLaunchSoundEffect.wav', 3)
    playAudio3.play()

    this.setTorpedorCount(this.torpedorCount - 1)
    return torpedo
  }

  // ---- 面板指令接口 ----

  /** 设置航速指令（fraction：-1 到 1，0 = 停车） */
  setSpeedCommand(fraction: number): void {
    this.commandedSpeedFraction = THREE.MathUtils.clamp(fraction, -1, 1)
  }

  /** 清除航速指令，恢复键盘控制 */
  clearSpeedCommand(): void {
    this.commandedSpeedFraction = null
  }

  /** 设置航向指令（罗盘度数，0–360） */
  setHeadingCommand(degrees: number): void {
    this.commandedHeadingDegrees = normalizeDegrees(degrees)
  }

  /** 清除航向指令，恢复键盘控制 */
  clearHeadingCommand(): void {
    this.commandedHeadingDegrees = null
  }

  /** Q/E 键循环切换航速档位。direction: 1 = 加速（Q），-1 = 减速（E） */
  private cycleSpeedCommand(direction: 1 | -1): void {
    const current = this.commandedSpeedFraction ?? 0
    const currentIndex = SPEED_FRACTION_STEPS.indexOf(current)
    const nextIndex = THREE.MathUtils.clamp(
      currentIndex - direction,
      0,
      SPEED_FRACTION_STEPS.length - 1,
    )
    this.commandedSpeedFraction = SPEED_FRACTION_STEPS[nextIndex] ?? 0
  }

  handleCollision(_event: CollisionEvent, self: CollisionEntitySnapshot): void {
    // console.log(`[collision:${self.type}] ${self.id}`)

    //TEST
    // console.log(`Hi! This is U-822! a type: ${_event.a.type}, b type: ${_event.b.type}`)

    //碰撞情景
    let CollisionSituation: CollisionSituationType
    CollisionSituation = CollisionDecision(_event)

    switch (CollisionSituation) {
      case CollisionSituationType.Submarine_Hits_Submarine:
        //两艇停船
        this.currentSpeed = -1.5
        break

      case CollisionSituationType.Submarine_Hits_Cargoship:
        //潜艇停船，商船不变
        this.currentSpeed = -1.5

        break

      case CollisionSituationType.Cargoship_Hits_Cargoship:
        break


      case CollisionSituationType.Torpedor_Hits_Submarine:
        //潜艇被击沉
        this.currentSpeed = 0
        this.isDestroyed = true

        //播放爆炸动画
        /********/
        

        //向后端更新Wolfpack信息，该潜艇已被击沉

        break

      case CollisionSituationType.Torpedor_Hits_Cargoship:
        break



    }

  }

  // ==================== 清理 ====================

  dispose(): void {
    this.entityRegistry.unregister(this.id)
    this.propellerBubbleTrail?.dispose()
    this.engine.removeUpdatable(this)
    this.root.removeFromParent()
    disposeObject(this.visual)
  }
}



/*
爆炸效果使用方式

const effect = new ExblowEffect(position)

effect.onFinished = (finishedEffect) => {
  engine.removeUpdatable(finishedEffect)
}

engine.scene.add(effect.root)
engine.addUpdatable(effect)

*/
