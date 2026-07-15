/**
 * GameEngine — 管理 Three.js 核心基础设施
 *
 * 职责：
 * - 创建 Scene / Camera / Renderer / Controls
 * - 管理灯光、雾、背景色
 * - 运行动画循环，调度所有 Updatable 对象
 * - 处理窗口大小调整
 * - 管理水下视觉效果（背景色、雾密度、灯光强度随深度变化）
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {
  SURFACE_BACKGROUND,
  DEEP_BACKGROUND,
} from '../constant/sceneUnits'

export interface Updatable {
  update(delta: number, time: number): void
}

export interface UnderwaterAppearanceOptions {
  fogDensityMultiplier?: number
}

export interface GameEngineOptions {
  container: HTMLElement
  cameraFov?: number
  cameraNear?: number
  cameraFar?: number
  surfaceBackground?: THREE.Color
  deepBackground?: THREE.Color
  sunOffset?: THREE.Vector3
  sunModelScale?: number
}

const DEFAULT_OPTIONS: Required<Omit<GameEngineOptions, 'container'>> = {
  cameraFov: 42,
  cameraNear: 0.05,
  cameraFar: 1200,
  surfaceBackground: SURFACE_BACKGROUND,
  deepBackground: DEEP_BACKGROUND,
  sunOffset: new THREE.Vector3(-180, 115, -220),
  sunModelScale: 52,
}

export class GameEngine {
  public readonly scene: THREE.Scene
  public readonly camera: THREE.PerspectiveCamera
  public readonly renderer: THREE.WebGLRenderer
  public readonly controls: OrbitControls

  private updatables = new Set<Updatable>()
  private animationFrame = 0
  private previousFrameTime = 0
  private resizeObserver: ResizeObserver | undefined

  private hemisphereLight!: THREE.HemisphereLight
  private keyLight!: THREE.DirectionalLight
  private keyLightTarget!: THREE.Object3D
  private rimLight!: THREE.DirectionalLight
  private sunModel: THREE.Object3D | undefined

  private readonly sunOffset: THREE.Vector3
  private readonly sunModelScale: number

  private hasSunModel = false

  constructor(private options: GameEngineOptions) {
    const opts = { ...DEFAULT_OPTIONS, ...options }

    // 场景
    this.scene = new THREE.Scene()
    this.scene.background = opts.surfaceBackground.clone()
    this.scene.fog = new THREE.FogExp2(opts.surfaceBackground, 0.0008)

    // 相机
    this.camera = new THREE.PerspectiveCamera(
      opts.cameraFov,
      1,
      opts.cameraNear,
      opts.cameraFar,
    )
    this.camera.position.set(25, 11, 27)

    // 渲染器
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.28
    options.container.appendChild(this.renderer.domElement)

    // OrbitControls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.055
    this.controls.autoRotate = true
    this.controls.autoRotateSpeed = 0.45
    this.controls.enablePan = false
    this.controls.minDistance = 7
    this.controls.maxDistance = 70
    this.controls.maxPolarAngle = Math.PI * 0.73
    this.controls.target.set(0, 0.2, 0)
    this.controls.addEventListener('start', () => {
      this.controls.autoRotate = false
    })

    // 灯光
    this.hemisphereLight = new THREE.HemisphereLight(0xdff5ff, 0x24465c, 3.4)
    this.scene.add(this.hemisphereLight)

    this.keyLight = new THREE.DirectionalLight(0xfff1d6, 6.2)
    this.keyLight.position.copy(opts.sunOffset)
    this.keyLightTarget = new THREE.Object3D()
    this.scene.add(this.keyLightTarget)
    this.keyLight.target = this.keyLightTarget
    this.scene.add(this.keyLight)

    this.rimLight = new THREE.DirectionalLight(0x8bd3ff, 2.6)
    this.rimLight.position.set(14, 8, -18)
    this.scene.add(this.rimLight)

    // 太阳相关参数
    this.sunOffset = opts.sunOffset.clone()
    this.sunModelScale = opts.sunModelScale

    // 窗口大小调整
    const resize = () => {
      const width = Math.max(options.container.clientWidth, 1)
      const height = Math.max(options.container.clientHeight, 1)
      this.renderer.setSize(width, height, false)
      this.camera.aspect = width / height
      this.camera.updateProjectionMatrix()
    }
    this.resizeObserver = new ResizeObserver(resize)
    this.resizeObserver.observe(options.container)
    resize()

    // 启动渲染循环
    this.startLoop()
  }

  /** 添加 Sun 模型，并使其跟随指定目标 (通常为潜艇) */
  addSunModel(sunModel: THREE.Object3D): void {
    this.sunModel = sunModel
    this.sunModel.scale.setScalar(this.sunModelScale)
    this.scene.add(this.sunModel)
    this.hasSunModel = true
  }

  /** 更新太阳和方向光的位置，使其始终围绕跟随目标 */
  updateSunAndLight(followTarget: THREE.Vector3): void {
    if (!this.hasSunModel) return
    const sunPosition = followTarget.clone().add(this.sunOffset)
    this.sunModel?.position.copy(sunPosition)
    this.keyLight.position.copy(sunPosition)
    this.keyLightTarget.position.copy(followTarget)
  }

  /** 注册需要每帧调用的对象 */
  addUpdatable(updatable: Updatable): void {
    this.updatables.add(updatable)
  }

  /** 移除已注册的对象 */
  removeUpdatable(updatable: Updatable): void {
    this.updatables.delete(updatable)
  }

  /** 根据深度更新水下视觉效果（背景、雾、灯光） */
  updateUnderwaterAppearance(
    depthSceneUnits: number,
    depthMeters: number,
    options: UnderwaterAppearanceOptions = {},
  ): void {
    if (
      !(this.scene.background instanceof THREE.Color) ||
      !(this.scene.fog instanceof THREE.FogExp2)
    ) {
      return
    }

    const surfaceBg = SURFACE_BACKGROUND
    const deepBg = DEEP_BACKGROUND
    const depthFactor = THREE.MathUtils.smoothstep(depthMeters, 5, 80)

    this.scene.background.lerpColors(surfaceBg, deepBg, depthFactor)
    this.scene.fog.color.copy(this.scene.background)
    const fogDensity = THREE.MathUtils.lerp(0.0008, 0.03, depthFactor)
    this.scene.fog.density = fogDensity * (options.fogDensityMultiplier ?? 1)
    this.hemisphereLight.intensity = THREE.MathUtils.lerp(3.4, 0.22, depthFactor)
    this.keyLight.intensity = THREE.MathUtils.lerp(6.2, 0.28, depthFactor)
    this.rimLight.intensity = THREE.MathUtils.lerp(2.6, 0.75, depthFactor)
  }

  private startLoop(): void {
    const render = (time = 0) => {
      this.animationFrame = requestAnimationFrame(render)
      const delta =
        this.previousFrameTime === 0
          ? 0
          : Math.min((time - this.previousFrameTime) / 1000, 0.1)
      this.previousFrameTime = time

      // 调度所有注册对象
      for (const updatable of this.updatables) {
        updatable.update(delta, time)
      }

      if (this.controls.enabled) this.controls.update()
      this.renderer.render(this.scene, this.camera)
    }
    render()
  }

  /** 彻底清理引擎，释放所有 GPU 资源 */
  dispose(): void {
    cancelAnimationFrame(this.animationFrame)
    this.resizeObserver?.disconnect()
    this.controls.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
