/**
 * CameraController — 相机模式管理
 *
 * 职责：
 * - 第三人称跟随（offset 模式，固定在潜艇后方上方）
 * - OrbitControls 启用/禁用切换
 * - 瞄准视角时委托给 AimingViewController
 * - 保存/恢复相机状态
 */
import * as THREE from 'three'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { SubmarineController } from '../uboat/SubmarineController'
import { AimingViewController } from '../aimingsight/AimingViewController'
import { SURFACE_DEPTH_EPSILON_SCENE, SCENE_TO_METERS } from '../constant/sceneUnits'

export class CameraController {
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  private aimingView: AimingViewController

  /** 上一帧潜艇位置，用于计算相机位移增量 */
  private previousSubmarinePosition = new THREE.Vector3()

  /** 保存进入瞄准模式前的相机和 controls 状态 */
  private savedCameraPosition = new THREE.Vector3()
  private savedControlsTarget = new THREE.Vector3()
  private hasSavedState = false

  constructor(camera: THREE.PerspectiveCamera, controls: OrbitControls) {
    this.camera = camera
    this.controls = controls
    this.aimingView = new AimingViewController()
  }

  get isAiming(): boolean {
    return this.aimingView.isActive
  }

  get aimingMode() {
    return this.aimingView.mode
  }

  get aimViewController(): AimingViewController {
    return this.aimingView
  }

  /** 初始化相机位置（水面第三人称视角） */
  initDefaultPosition(target: THREE.Vector3): void {
    this.camera.position.set(
      target.x + 25,
      target.y + 11,
      target.z + 27,
    )
    this.controls.target.set(target.x, target.y + 0.2, target.z)
    this.previousSubmarinePosition.copy(target)
  }

  /** 每帧更新：相机跟随潜艇位移增量 */
  update(submarine: SubmarineController): void {
    if (this.aimingView.isActive) {
      // 瞄准模式：检查深度有效性，更新瞄准相机
      const notice = this.aimingView.updateValidity(submarine)
      if (notice && this.aimingView.mode === 'none') {
        this.exitAiming()
      }
      this.aimingView.updateCamera(this.camera, submarine, submarine.sampledWaterHeight)
      this.controls.enabled = false
      return
    }

    // 非瞄准模式：相机 delta 跟随
    const delta = submarine.root.position.clone().sub(this.previousSubmarinePosition)
    this.camera.position.add(delta)
    this.controls.target.add(delta)

    // 深度超过阈值时禁用 OrbitControls 手动旋转
    const depthMeters = submarine.currentDepth * SCENE_TO_METERS
    this.controls.enabled = depthMeters <= 100

    this.previousSubmarinePosition.copy(submarine.root.position)
  }

  /** 尝试切换瞄准/潜望镜视角 */
  toggleAiming(submarine: SubmarineController): string | null {
    const message = this.aimingView.toggle(submarine, this.camera, this.controls)
    if (message === null && this.aimingView.isActive) {
      // 进入了瞄准模式，保存退出后的恢复状态
      // （AimingViewController 内部已保存）
    }
    return message
  }

  /** 强制退出瞄准模式 */
  exitAiming(): void {
    this.aimingView.disable(this.camera, this.controls)
  }

  /** 处理潜望镜指针拖拽 */
  handlePointerDown(event: PointerEvent): void {
    if (!this.aimingView.isActive) return
    const target = event.currentTarget as HTMLElement
    target?.setPointerCapture?.(event.pointerId)
    this.aimingView.handlePointerDown(event)
  }

  handlePointerMove(event: PointerEvent): void {
    this.aimingView.handlePointerMove(event)
  }

  handlePointerUp(event: PointerEvent): void {
    this.aimingView.handlePointerUp()
    const target = event.currentTarget as HTMLElement
    target?.releasePointerCapture?.(event.pointerId)
  }
}
