<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import UnderwaterStatusPanel from './UnderwaterStatusPanel.vue'
import submarineUrl from '../../model/type_vii_d_u-boat.glb?url'
import sunUrl from '../../model/sun.glb?url'
import periscopeSightUrl from '../../assets/Uboot Periscope sight/UBootPeriscopeAimingSight.png?url'
import '../../css/test-3d-programized-ocean.css'
import { moveTowards } from './modules/mathUtils'
import {
  disposeObject,
  normalizeSubmarine,
  tuneSubmarineMaterials,
  tuneSunMaterials,
} from './modules/modelUtils'
import {
  createProceduralOcean,
  updateProceduralOcean as updateProceduralOceanMesh,
  type WaveSettings,
} from './modules/proceduralOcean'

// -------------------- 现实单位和场景单位换算 --------------------
// 潜艇模型在 Three.js 中缩放为 22 单位，对应现实中的约 77 米。
const MODEL_LENGTH_SCENE = 22     //缩放成为22个单位
const MODEL_LENGTH_METERS = 77    //Type VII D型潜艇全长76.9m
const METERS_TO_SCENE = MODEL_LENGTH_SCENE / MODEL_LENGTH_METERS
const SCENE_TO_METERS = MODEL_LENGTH_METERS / MODEL_LENGTH_SCENE

// -------------------- 程序化海洋、速度和深度参数 --------------------
const OCEAN_SIZE = 1200 // 一张连续海面覆盖 1200 × 1200 场景单位
const OCEAN_SEGMENTS = 256 // 网格细分；波浪顶点由 GPU 并行计算
const SURFACE_MODEL_OFFSET = -0.01 // 用户指定的潜艇水面标准吃水偏移
const MAX_DEPTH_SCENE = 280 * METERS_TO_SCENE // 最大潜深 280 米，等于 80 场景单位
const MAX_VERTICAL_SPEED = 4 * METERS_TO_SCENE // 最大上浮/下潜速度：现实 4 米/秒
const SURFACE_MAX_SPEED = (30_000 * METERS_TO_SCENE) / 3600 // 水面 30 km/h
const SUBMERGED_MAX_SPEED = (13_000 * METERS_TO_SCENE) / 3600 // 水下 13 km/h
const REVERSE_SPEED_RATIO = 0.4 // 倒车最高速度是对应前进速度的 40%
const MAX_TURN_RATE = THREE.MathUtils.degToRad(2) // 满速满舵每秒最多转向 4°
const SPEED_TRANSITION_DEPTH = 15 * METERS_TO_SCENE // 前 15 米内平滑切换水面/水下限速
const UNDERWATER_UI_DEPTH_METERS = 100  //控制UnderWaterStatusPanel显示的深度指标, 潜深超过这个值后显示UnderWaterStatusPanel界面
const MAX_SUBMARINE_PITCH = THREE.MathUtils.degToRad(60)  //控制潜艇上浮或者下潜的抬头或低头的幅度
const PITCH_RESPONSE_SENSITIVITY = 17;   //俯仰响应灵敏度,数值越大灵敏度越低
const PITCH_SMOOTHING = 1.04;    //俯仰平滑度，数值越小变化越慢
const SURFACE_DEPTH_EPSILON_SCENE = 0.02
const ORBIT_CONTROL_MAX_DEPTH = UNDERWATER_UI_DEPTH_METERS * METERS_TO_SCENE




//潜望镜相关变量
const PERISCOPE_MIN_DEPTH_METERS = 13   //设置潜望镜深度13~15m
const PERISCOPE_MAX_DEPTH_METERS = 15
const PERISCOPE_EYE_HEIGHT = 1.05 // 潜望镜镜头略高于当前海面
const SURFACE_AIM_EYE_HEIGHT = 2 // 水面瞄准视角高度（相对水面），水面瞄准视角在指挥塔附近，允许看到部分船身
const SURFACE_AIM_FORWARD_OFFSET = 3 //水面瞄准视角相对潜艇模型中心的前向偏移量
const cameraWorldOffset = new THREE.Vector3() //偏移量向量
const PERISCOPE_LOOK_DISTANCE = 200 //潜望镜视角可视距离
const PERISCOPE_MOUSE_SENSITIVITY = 0.004 //潜望镜视角的鼠标灵敏度
const CONTROL_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyK', 'KeyL', 'KeyQ'])   //控制按键
const SURFACE_BACKGROUND = new THREE.Color(0x6fb9e8)  //背景色
const SHALLOW_UNDERWATER_BACKGROUND = new THREE.Color(0x0f3f5a) //浅水区背景色
const DEEP_BACKGROUND = new THREE.Color(0x00070d) //深水背景色
const SUN_OFFSET = new THREE.Vector3(-180, 115, -220)
const SUN_DIRECTION = SUN_OFFSET.clone().normalize()
const SUN_MODEL_SCALE = 52

//波浪振幅
const PRIMARY_SWELL = 0.88
const CROSS_SWELL = 0.64
const MEDIUM_CHOPPY_WAVES = 0.24;
const LIGHT_RIPPLES = 0.17
const WAVE_SETTINGS: WaveSettings = {
  primarySwell: PRIMARY_SWELL,
  crossSwell: CROSS_SWELL,
  mediumChoppyWaves: MEDIUM_CHOPPY_WAVES,
  lightRipples: LIGHT_RIPPLES,
}

// -------------------- Vue 页面状态 --------------------
const viewer = ref<HTMLDivElement | null>(null) // Three.js Canvas 的 HTML 容器
const loadingProgress = ref(0) // 两个 GLB 文件的综合加载进度
const loadingError = ref('') // WebGL 或模型加载失败时显示的错误
const isLoaded = ref(false) // 控制加载界面和 HUD 的显示
const showHint = ref(false) // 底部操作提示是否显示
const speedKmh = ref(0) // HUD：当前速度，单位 km/h
const depthMeters = ref(0) // HUD：当前深度，单位 m
const headingDegrees = ref(0) // HUD：当前航向角，范围 0～359°
const periscopeRelativeBearingDegrees = ref(0) // HUD：潜望镜相对艇艏方位，范围 0～359°
const navigationState = ref<'水面' | '水下' | '潜望镜视角' | '水面瞄准视角'>('水面')
const limitNotice = ref('') // 到达水面或最大潜深时的提示
type AimingViewMode = 'none' | 'surfaceAim' | 'periscope'
type UnderwaterStatusPanelMode = 'full' | 'compact'

const aimingViewMode = ref<AimingViewMode>('none')

//潜艇世界坐标，测试时展示
const SubmarineWorldX = ref(0);
const SubmarineWorldZ = ref(0);

const loadingLabel = computed(() => `${Math.round(loadingProgress.value)}%`)
const speedKnots = computed(() => speedKmh.value / 1.852)
const isSubmerged = computed(() => depthMeters.value > 0)
const isAimingViewActive = computed(() => aimingViewMode.value !== 'none')
const underwaterStatusMode = computed<UnderwaterStatusPanelMode>(() => {
  // isAimingViewActive.value ? 'compact' : 'full',
  if (isAimingViewActive.value) return 'compact'
  if (depthMeters.value <= SURFACE_DEPTH_EPSILON_SCENE * SCENE_TO_METERS) return 'compact'
  return 'full'
})
const showUnderwaterStatus = computed(() => {
  if (isAimingViewActive.value) return true
  if (depthMeters.value <= SURFACE_DEPTH_EPSILON_SCENE * SCENE_TO_METERS) return true
  return depthMeters.value > UNDERWATER_UI_DEPTH_METERS
})
const showUnderwaterScreen = computed(
  () => depthMeters.value > UNDERWATER_UI_DEPTH_METERS && !isAimingViewActive.value,
)

// -------------------- 可复用的数学对象和资源集合 --------------------
const movementDelta = new THREE.Vector3()
const previousSubmarinePosition = new THREE.Vector3()
const pressedKeys = new Set<string>()
const resources: THREE.Object3D[] = []
const fileProgress = new Map<string, { loaded: number; total: number }>()

// -------------------- Three.js 核心对象 --------------------
let renderer: THREE.WebGLRenderer | undefined // 将 3D 场景绘制到 Canvas
let scene: THREE.Scene | undefined // 整个 3D 世界
let camera: THREE.PerspectiveCamera | undefined // 玩家观察场景的透视相机
let controls: OrbitControls | undefined // 鼠标旋转和缩放控制器
let submarineRoot: THREE.Group | undefined // 负责潜艇移动、转向的根节点
let submarineVisual: THREE.Object3D | undefined // 只负责模型自身视觉姿态，例如上浮/下潜俯仰
let sunModel: THREE.Object3D | undefined
let proceduralOcean: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | undefined
let resizeObserver: ResizeObserver | undefined
let hemisphereLight: THREE.HemisphereLight | undefined
let keyLight: THREE.DirectionalLight | undefined
let keyLightTarget: THREE.Object3D | undefined
let rimLight: THREE.DirectionalLight | undefined

// -------------------- 游戏运行状态 --------------------
let animationFrame = 0
let hintTimer: ReturnType<typeof setTimeout> | undefined
let noticeTimer: ReturnType<typeof setTimeout> | undefined
let previousFrameTime = 0
let lastHudUpdateTime = 0
let currentSpeed = 0 // 有符号速度：正数前进，负数倒车
let heading = 0 // 航向弧度；潜艇初始朝向模型自身的 +X
let targetDepth = 0 // K/L 修改的目标深度
let currentDepth = 0 // 经过平滑运动后的实际深度
let verticalSpeed = 0 // 当前垂直速度，用于平滑启动和停止
let sampledWaterHeight = 0 // 与 GPU 相同的公式计算出的潜艇当前位置海面高度
let oceanTime = 0 // 程序化海洋从启动后累计的运行时间（秒）
let surfaceLimitWasActive = false
let depthLimitWasActive = false
let periscopeYaw = 0
let isDraggingPeriscope = false
let lastPeriscopePointerX = 0
const savedCameraPosition = new THREE.Vector3()
const savedControlsTarget = new THREE.Vector3()
let hasSavedAimingCamera = false


// 程序化海洋无需下载，这里只记录潜艇 GLB 的下载进度。
function updateLoadingProgress(url: string, event: ProgressEvent<EventTarget>) {
  fileProgress.set(url, {
    loaded: event.loaded,
    total: event.lengthComputable ? event.total : event.loaded,
  })

  let loaded = 0
  let total = 0
  for (const progress of fileProgress.values()) {
    loaded += progress.loaded
    total += progress.total
  }

  if (total > 0) {
    // 下载结束后还需要解析 GLB，所以解析完成前最多显示 99%。
    loadingProgress.value = Math.min(99, (loaded / total) * 100)
  }
}

function updateProceduralOceanState(delta: number) {
  if (!proceduralOcean || !submarineRoot) return

  const nextOceanState = updateProceduralOceanMesh(
    proceduralOcean,
    submarineRoot,
    delta,
    oceanTime,
    WAVE_SETTINGS,
  )
  oceanTime = nextOceanState.oceanTime
  sampledWaterHeight = nextOceanState.sampledWaterHeight
}

function updateSunAndLightPosition() {
  if (!submarineRoot) return

  const sunPosition = submarineRoot.position.clone().add(SUN_OFFSET)
  sunModel?.position.copy(sunPosition)
  keyLight?.position.copy(sunPosition)
  keyLightTarget?.position.copy(submarineRoot.position)
}

function normalizeDegrees(degrees: number) {
  return ((degrees % 360) + 360) % 360
}

function yawToCompassDegrees(yaw: number) {
  // 罗盘约定：000 指向世界 -Z，090 指向 +X，180 指向 +Z，270 指向 -X。
  return normalizeDegrees(90 - THREE.MathUtils.radToDeg(yaw))
}

// 显示水面/最大潜深提示，1.8 秒后自动关闭。
function showLimitNotice(message: string) {
  limitNotice.value = message
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => {
    limitNotice.value = ''
  }, 1800)
}

function isAtPeriscopeDepth() {
  const depth = currentDepth * SCENE_TO_METERS
  return depth >= PERISCOPE_MIN_DEPTH_METERS && depth <= PERISCOPE_MAX_DEPTH_METERS
}

function isAtSurfaceDepth() {
  return currentDepth <= SURFACE_DEPTH_EPSILON_SCENE
}

function disableAimingView(message = '') {
  if (!isAimingViewActive.value) return
  aimingViewMode.value = 'none'
  isDraggingPeriscope = false
  if (controls) controls.enabled = currentDepth <= ORBIT_CONTROL_MAX_DEPTH
  restorePreviousCamera()
  if (message) showLimitNotice(message)
}

function restoreDefaultSurfaceCamera() {
  if (!camera || !controls || !submarineRoot) return
  camera.position.set(
    submarineRoot.position.x + 25,
    submarineRoot.position.y + 11,
    submarineRoot.position.z + 27,
  )
  controls.target.set(submarineRoot.position.x, submarineRoot.position.y + 0.2, submarineRoot.position.z)
  previousSubmarinePosition.copy(submarineRoot.position)
}

function restorePreviousCamera() {
  if (!camera || !controls) return

  if (hasSavedAimingCamera) {
    camera.position.copy(savedCameraPosition)
    controls.target.copy(savedControlsTarget)
    hasSavedAimingCamera = false
  } else {
    restoreDefaultSurfaceCamera()
  }

  if (submarineRoot) previousSubmarinePosition.copy(submarineRoot.position)
}

function togglePeriscope() {
  if (isAimingViewActive.value) {
    disableAimingView()
    return
  }

  const nextAimingMode: AimingViewMode = isAtSurfaceDepth()
    ? 'surfaceAim'
    : isAtPeriscopeDepth()
      ? 'periscope'
      : 'none'

  if (nextAimingMode === 'none') {
    showLimitNotice('请前往水面或潜望镜深度13-15m')
    return
  }

  if (camera && controls) {
    savedCameraPosition.copy(camera.position)
    savedControlsTarget.copy(controls.target)
    hasSavedAimingCamera = true
  }
  aimingViewMode.value = nextAimingMode
  periscopeYaw = heading
  pressedKeys.delete('KeyK')
  pressedKeys.delete('KeyL')
  if (controls) {
    controls.enabled = false
    controls.autoRotate = false
  }
}

function updatePeriscopeState() {
  if (!isAimingViewActive.value) {
    if (controls) controls.enabled = currentDepth <= ORBIT_CONTROL_MAX_DEPTH
    return
  }

  if (aimingViewMode.value === 'surfaceAim' && !isAtSurfaceDepth()) {
    disableAimingView('请保持水面瞄准深度')
    return
  }

  if (aimingViewMode.value === 'periscope' && !isAtPeriscopeDepth()) {
    disableAimingView('请前往潜望镜深度13-15m')
  }
}

function updatePeriscopeCamera() {
  // if (!isAimingViewActive.value || !camera || !submarineRoot) return

  // const eyeHeight =
  //   aimingViewMode.value === 'surfaceAim' ? SURFACE_AIM_EYE_HEIGHT : PERISCOPE_EYE_HEIGHT
  // const eyeY = sampledWaterHeight + eyeHeight
  // camera.position.set(submarineRoot.position.x, eyeY, submarineRoot.position.z)
  // camera.lookAt(
  //   submarineRoot.position.x + Math.cos(periscopeYaw) * PERISCOPE_LOOK_DISTANCE,
  //   eyeY,
  //   submarineRoot.position.z - Math.sin(periscopeYaw) * PERISCOPE_LOOK_DISTANCE,
  // )

  if (!isAimingViewActive.value || !camera || !submarineRoot) return

  const isSurfaceAim = aimingViewMode.value === 'surfaceAim'
  const eyeHeight = isSurfaceAim ? SURFACE_AIM_EYE_HEIGHT : PERISCOPE_EYE_HEIGHT
  const forwardOffset = isSurfaceAim ? SURFACE_AIM_FORWARD_OFFSET : 0
  cameraWorldOffset.set(Math.cos(heading) * forwardOffset, 0, -Math.sin(heading) * forwardOffset)

  const eyeX = submarineRoot.position.x + cameraWorldOffset.x
  const eyeY = sampledWaterHeight + eyeHeight
  const eyeZ = submarineRoot.position.z + cameraWorldOffset.z
  camera.position.set(eyeX, eyeY, eyeZ)
  camera.lookAt(
    eyeX + Math.cos(periscopeYaw) * PERISCOPE_LOOK_DISTANCE,
    eyeY,
    eyeZ - Math.sin(periscopeYaw) * PERISCOPE_LOOK_DISTANCE,
  )
}

// -------------------- 上浮和下潜 --------------------
function updateDepth(delta: number) {
  if (isAimingViewActive.value) {
    pressedKeys.delete('KeyK')
    pressedKeys.delete('KeyL')
  }

  // L 对应 +1（增加深度），K 对应 -1（减小深度）。
  const diveInput = isAimingViewActive.value
    ? 0
    : (pressedKeys.has('KeyL') ? 1 : 0) - (pressedKeys.has('KeyK') ? 1 : 0)

  if (diveInput !== 0) {
    // 目标深度永远限制在 0～280 米之间，因此潜艇不会飞到海面以上。
    targetDepth = THREE.MathUtils.clamp(
      targetDepth + diveInput * MAX_VERTICAL_SPEED * delta,
      0,
      MAX_DEPTH_SCENE,
    )
  }

  const atSurfaceLimit = pressedKeys.has('KeyK') && targetDepth <= 0
  if (atSurfaceLimit && !surfaceLimitWasActive) showLimitNotice('已到达水面')
  surfaceLimitWasActive = atSurfaceLimit

  const atDepthLimit = pressedKeys.has('KeyL') && targetDepth >= MAX_DEPTH_SCENE
  if (atDepthLimit && !depthLimitWasActive) showLimitNotice('已到达最大潜深 280 m')
  depthLimitWasActive = atDepthLimit

  // 实际深度不是直接跳到目标深度，而是通过垂直速度平滑靠近。
  const difference = targetDepth - currentDepth
  const desiredVerticalSpeed = THREE.MathUtils.clamp(
    difference * 2,
    -MAX_VERTICAL_SPEED,
    MAX_VERTICAL_SPEED,
  )
  verticalSpeed = THREE.MathUtils.damp(verticalSpeed, desiredVerticalSpeed, 3, delta)

  // 如果这一帧越过目标，就直接停在目标上，避免在目标附近来回震荡。
  const nextDepth = currentDepth + verticalSpeed * delta
  if (difference !== 0 && Math.sign(targetDepth - nextDepth) !== Math.sign(difference)) {
    currentDepth = targetDepth
    verticalSpeed = 0
  } else {
    currentDepth = THREE.MathUtils.clamp(nextDepth, 0, MAX_DEPTH_SCENE)
  }
}

// 根据下潜深度，在水面 30 km/h 与水下 13 km/h 之间平滑插值。
function currentForwardSpeedLimit() {
  const depthBlend = THREE.MathUtils.smoothstep(currentDepth, 0, SPEED_TRANSITION_DEPTH)
  return THREE.MathUtils.lerp(SURFACE_MAX_SPEED, SUBMERGED_MAX_SPEED, depthBlend)
}

// -------------------- 前进、倒车和转向 --------------------
function updateHorizontalMovement(delta: number) {
  if (!submarineRoot) return

  const throttle = (pressedKeys.has('KeyW') ? 1 : 0) - (pressedKeys.has('KeyS') ? 1 : 0)
  const maxForwardSpeed = currentForwardSpeedLimit()
  const targetSpeed =
    throttle > 0 ? maxForwardSpeed : throttle < 0 ? -maxForwardSpeed * REVERSE_SPEED_RATIO : 0

  // 正车和倒车都需要约 12 秒达到各自上限，松键后约 8 秒滑行停止。
  const requestedSpeedLimit =
    throttle < 0 ? maxForwardSpeed * REVERSE_SPEED_RATIO : maxForwardSpeed
  const currentDirectionLimit =
    currentSpeed < 0 ? maxForwardSpeed * REVERSE_SPEED_RATIO : maxForwardSpeed
  const acceleration = requestedSpeedLimit / 12
  const coastDeceleration = currentDirectionLimit / 8
  const isReversing =
    throttle !== 0 && currentSpeed !== 0 && Math.sign(targetSpeed) !== Math.sign(currentSpeed)
  // 输入反方向时先加强制动，速度归零后才会向反方向加速。
  const rate =
    throttle === 0 ? coastDeceleration : isReversing ? coastDeceleration * 1.5 : acceleration
  currentSpeed = moveTowards(currentSpeed, targetSpeed, rate * delta)
  currentSpeed = THREE.MathUtils.clamp(
    currentSpeed,
    -maxForwardSpeed * REVERSE_SPEED_RATIO,
    maxForwardSpeed,
  )

  const turnInput = (pressedKeys.has('KeyA') ? 1 : 0) - (pressedKeys.has('KeyD') ? 1 : 0)
  if (turnInput !== 0 && Math.abs(currentSpeed) > 0.0001) {
    const directionalLimit = currentSpeed >= 0 ? maxForwardSpeed : maxForwardSpeed * REVERSE_SPEED_RATIO
    const steeringStrength = THREE.MathUtils.clamp(
      Math.abs(currentSpeed) / directionalLimit,
      0,
      1,
    )
    // 舵效随航速增强；倒车时 Math.sign(currentSpeed) 会自然反转转向方向。
    heading +=
      turnInput * Math.sign(currentSpeed) * MAX_TURN_RATE * steeringStrength * delta
    submarineRoot.rotation.y = heading
  }

  // 模型的艇艏沿本地 +X，因此用 cos/sin 将速度转换成世界 X/Z 位移。
  movementDelta.set(
    Math.cos(heading) * currentSpeed * delta,
    0,
    -Math.sin(heading) * currentSpeed * delta,
  )
  submarineRoot.position.add(movementDelta)
}

// 决定潜艇根节点的 Y 坐标：水面随浪漂浮，进入水下后使用稳定深度。
function updateSubmarineHeight(delta: number) {
  if (!submarineRoot) return

  const isAtSurface = currentDepth < 0.02
  const targetY = isAtSurface ? sampledWaterHeight : -currentDepth
  const followStrength = 1 - Math.exp(-delta * (isAtSurface ? 2.8 : 4))
  submarineRoot.position.y = THREE.MathUtils.lerp(
    submarineRoot.position.y,
    targetY,
    followStrength,
  )
}

// 上浮/下潜时只改变模型视觉俯仰，不改变真实深度、碰撞或潜望镜判断。
function updateSubmarinePitch(delta: number) {
  if (!submarineVisual) return

  const pitchRange = PITCH_RESPONSE_SENSITIVITY * METERS_TO_SCENE    //抬头/ 低头的角度变化灵敏度
  const pitchIntent = THREE.MathUtils.clamp((targetDepth - currentDepth) / pitchRange, -1, 1)
  const targetPitch = -pitchIntent * MAX_SUBMARINE_PITCH
  submarineVisual.rotation.z = THREE.MathUtils.damp(
    submarineVisual.rotation.z,
    targetPitch,
    PITCH_SMOOTHING,
    delta,
  )
}

// 相机和 OrbitControls 的观察中心只跟随位移，不跟随潜艇航向强制旋转。
function updateCameraFollow() {
  if (!submarineRoot || !camera || !controls || isAimingViewActive.value) return
  movementDelta.copy(submarineRoot.position).sub(previousSubmarinePosition)
  camera.position.add(movementDelta)
  controls.target.add(movementDelta)
  previousSubmarinePosition.copy(submarineRoot.position)
}

// 深度增加时逐渐切换背景、距离雾和灯光，形成水下视觉效果。
function updateUnderwaterAppearance() {
  if (!scene || !(scene.background instanceof THREE.Color) || !(scene.fog instanceof THREE.FogExp2)) {
    return
  }

  const depthFactor = THREE.MathUtils.smoothstep(currentDepth * SCENE_TO_METERS, 5, 80)
  scene.background.lerpColors(SURFACE_BACKGROUND, DEEP_BACKGROUND, depthFactor)
  scene.fog.color.copy(scene.background)
  scene.fog.density = THREE.MathUtils.lerp(0.0008, 0.03, depthFactor)
  if (hemisphereLight) hemisphereLight.intensity = THREE.MathUtils.lerp(3.4, 0.22, depthFactor)
  if (keyLight) keyLight.intensity = THREE.MathUtils.lerp(6.2, 0.28, depthFactor)
  if (rimLight) rimLight.intensity = THREE.MathUtils.lerp(2.6, 0.75, depthFactor)
}

// HUD 不需要每帧刷新，限制为每 100ms 一次可以减少 Vue 的界面更新次数。
function updateHud(time: number) {
  if (time - lastHudUpdateTime < 100) return
  lastHudUpdateTime = time
  speedKmh.value = currentSpeed * SCENE_TO_METERS * 3.6
  depthMeters.value = currentDepth * SCENE_TO_METERS
  const currentHeadingDegrees = yawToCompassDegrees(heading)
  headingDegrees.value = currentHeadingDegrees
  periscopeRelativeBearingDegrees.value = isAimingViewActive.value
    ? normalizeDegrees(yawToCompassDegrees(periscopeYaw) - currentHeadingDegrees)
    : 0
  navigationState.value =
    aimingViewMode.value === 'surfaceAim'
      ? '水面瞄准视角'
      : aimingViewMode.value === 'periscope'
        ? '潜望镜视角'
        : isAtSurfaceDepth()
          ? '水面'
          : '水下'

  if (submarineRoot) {
    SubmarineWorldX.value = submarineRoot.position.x
    SubmarineWorldZ.value = submarineRoot.position.z
  }
}

// 用户正在输入表单时，不抢占 WASD/KL 按键。
function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  const tagName = target.tagName.toLowerCase()
  return target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select'
}

// 使用 Set 保存当前按住的键，因此可以同时前进、转向和下潜。
function handleKeyDown(event: KeyboardEvent) {
  if (!CONTROL_CODES.has(event.code) || isEditableTarget(event.target)) return
  event.preventDefault()
  if (event.code === 'KeyQ') {
    if (!pressedKeys.has('KeyQ')) togglePeriscope()
    pressedKeys.add(event.code)
    return
  }
  if (isAimingViewActive.value && (event.code === 'KeyK' || event.code === 'KeyL')) {
    showLimitNotice('需要先退出瞄准视角')
    return
  }
  pressedKeys.add(event.code)
  if (controls) controls.autoRotate = false
}

function handleKeyUp(event: KeyboardEvent) {
  if (!CONTROL_CODES.has(event.code)) return
  event.preventDefault()
  pressedKeys.delete(event.code)
}

function clearPressedKeys() {
  // 窗口失焦时清空，避免用户松键发生在窗口外导致潜艇一直移动。
  pressedKeys.clear()
  isDraggingPeriscope = false
}

function handlePeriscopePointerDown(event: PointerEvent) {
  if (!isAimingViewActive.value) return
  isDraggingPeriscope = true
  lastPeriscopePointerX = event.clientX
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
}

function handlePeriscopePointerMove(event: PointerEvent) {
  if (!isAimingViewActive.value || !isDraggingPeriscope) return
  const deltaX = event.clientX - lastPeriscopePointerX
  lastPeriscopePointerX = event.clientX
  periscopeYaw -= deltaX * PERISCOPE_MOUSE_SENSITIVITY
}

function handlePeriscopePointerUp(event: PointerEvent) {
  if (!isDraggingPeriscope) return
  isDraggingPeriscope = false
  const target = event.currentTarget as HTMLElement
  target.releasePointerCapture(event.pointerId)
}

// -------------------- Vue 组件挂载：创建 Three.js 场景 --------------------
onMounted(async () => {
  const container = viewer.value
  if (!container) return

  // 创建场景、背景和距离雾。
  scene = new THREE.Scene()
  scene.background = SURFACE_BACKGROUND.clone()
  scene.fog = new THREE.FogExp2(SURFACE_BACKGROUND, 0.0008)

  // 参数依次为视野角度、宽高比、最近可见距离、最远可见距离。
  camera = new THREE.PerspectiveCamera(42, 1, 0.05, 1200)
  camera.position.set(25, 11, 27)

  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  } catch (error) {
    console.error('Failed to create WebGL renderer:', error)
    loadingError.value = '浏览器无法创建 WebGL 画面，请检查硬件加速设置。'
    return
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  // sRGB + ACES 色调映射可以得到更自然的光照和颜色。
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.28
  container.appendChild(renderer.domElement)

  // 鼠标拖拽旋转、滚轮缩放；首次由玩家操作后关闭自动旋转。
  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.055
  controls.autoRotate = true
  controls.autoRotateSpeed = 0.45
  controls.enablePan = false
  controls.minDistance = 7
  controls.maxDistance = 70
  controls.maxPolarAngle = Math.PI * 0.73
  controls.target.set(0, 0.2, 0)
  controls.addEventListener('start', () => {
    if (controls) controls.autoRotate = false
  })

  // 半球光负责基础环境光，两个方向光负责主体照明和蓝色轮廓。
  hemisphereLight = new THREE.HemisphereLight(0xdff5ff, 0x24465c, 3.4)
  scene.add(hemisphereLight)

  keyLight = new THREE.DirectionalLight(0xfff1d6, 6.2)
  keyLight.position.copy(SUN_OFFSET)
  keyLightTarget = new THREE.Object3D()
  scene.add(keyLightTarget)
  keyLight.target = keyLightTarget
  scene.add(keyLight)

  rimLight = new THREE.DirectionalLight(0x8bd3ff, 2.6)
  rimLight.position.set(14, 8, -18)
  scene.add(rimLight)

  // 容器尺寸变化时同步更新 Canvas 和相机宽高比，避免画面拉伸。
  const resize = () => {
    if (!renderer || !camera) return
    const width = Math.max(container.clientWidth, 1)
    const height = Math.max(container.clientHeight, 1)
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }
  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(container)
  resize()

  // 键盘事件挂在 window 上，即使鼠标没有点击 Canvas 也可以控制潜艇。
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keyup', handleKeyUp)
  window.addEventListener('blur', clearPressedKeys)

  const loader = new GLTFLoader()

  try {
    // 海洋由代码立即创建，网络只需要加载潜艇和太阳 GLB。
    const [submarineGltf, sunGltf] = await Promise.all([
      loader.loadAsync(submarineUrl, (event) => updateLoadingProgress(submarineUrl, event)),
      loader.loadAsync(sunUrl),
    ])

    if (!scene) return

    // 根节点负责世界移动和航向；视觉模型保留自己的缩放、居中和吃水偏移。
    submarineRoot = new THREE.Group()
    const submarine = submarineGltf.scene
    normalizeSubmarine(submarine, MODEL_LENGTH_SCENE, SURFACE_MODEL_OFFSET)
    tuneSubmarineMaterials(submarine)
    submarineVisual = submarine
    submarineRoot.add(submarine)
    scene.add(submarineRoot)
    resources.push(submarine)
    previousSubmarinePosition.copy(submarineRoot.position)

    sunModel = sunGltf.scene
    sunModel.scale.setScalar(SUN_MODEL_SCALE)
    tuneSunMaterials(sunModel)
    scene.add(sunModel)
    resources.push(sunModel)
    updateSunAndLightPosition()

    // 创建单张连续程序化海面，不再加载 ocean.glb，也没有区块接缝。
    proceduralOcean = createProceduralOcean({
      oceanSize: OCEAN_SIZE,
      oceanSegments: OCEAN_SEGMENTS,
      sunDirection: SUN_DIRECTION,
      waves: WAVE_SETTINGS,
    })
    scene.add(proceduralOcean)
    resources.push(proceduralOcean)

    // GLB 下载并解析完成，此时才把进度从 99% 设置为 100%。
    loadingProgress.value = 100
    isLoaded.value = true
    showHint.value = true
    hintTimer = setTimeout(() => {
      showHint.value = false
    }, 5000)
  } catch (error) {
    console.error('Failed to load 3D scene:', error)
    loadingError.value = '模型加载失败，请刷新页面重试。'
  }

  // -------------------- 每帧执行的游戏循环 --------------------
  const render = (time = 0) => {
    animationFrame = requestAnimationFrame(render)
    // delta 是距离上一帧经过的秒数；限制到 0.1 防止切回标签页时运动跳跃。
    const delta = previousFrameTime === 0 ? 0 : Math.min((time - previousFrameTime) / 1000, 0.1)
    previousFrameTime = time

    // 执行顺序很重要：先更新运动，再计算连续海浪高度，最后更新镜头并绘制。
    updateDepth(delta)
    updateHorizontalMovement(delta)
    updateProceduralOceanState(delta)
    updateSunAndLightPosition()
    updateSubmarineHeight(delta)
    updateSubmarinePitch(delta)
    updatePeriscopeState()
    updateCameraFollow()
    updatePeriscopeCamera()
    updateUnderwaterAppearance()
    updateHud(time)
    if (!isAimingViewActive.value) controls?.update()
    if (renderer && scene && camera) renderer.render(scene, camera)
  }
  render()
})

// -------------------- Vue 组件卸载：释放事件和 GPU 资源 --------------------
onBeforeUnmount(() => {
  cancelAnimationFrame(animationFrame)
  if (hintTimer) clearTimeout(hintTimer)
  if (noticeTimer) clearTimeout(noticeTimer)
  resizeObserver?.disconnect()
  controls?.dispose()
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('keyup', handleKeyUp)
  window.removeEventListener('blur', clearPressedKeys)

  proceduralOcean?.removeFromParent()
  sunModel?.removeFromParent()
  submarineRoot?.removeFromParent()
  // 释放潜艇模型以及程序化海面的几何体和 ShaderMaterial。
  for (const object of resources) disposeObject(object)

  renderer?.dispose()
  renderer?.domElement.remove()

  resources.length = 0
  fileProgress.clear()
  pressedKeys.clear()
  scene = undefined
  camera = undefined
  renderer = undefined
  controls = undefined
  submarineRoot = undefined
  submarineVisual = undefined
  sunModel = undefined
  proceduralOcean = undefined
  hemisphereLight = undefined
  keyLight = undefined
  keyLightTarget = undefined
  rimLight = undefined
})
</script>

<template>
  <section ref="viewer" class="viewer" aria-label="3D 潜艇模型查看器">
    <div v-if="isLoaded && showUnderwaterScreen" class="underwater-screen" aria-hidden="true"></div>

    <UnderwaterStatusPanel v-if="isLoaded && showUnderwaterStatus" :mode="underwaterStatusMode"
      :depth-meters="depthMeters" :speed-knots="speedKnots" :heading-degrees="headingDegrees"
      :periscope-relative-bearing-degrees="periscopeRelativeBearingDegrees" :navigation-state="navigationState"
      :submarine-world-x="SubmarineWorldX" :submarine-world-z="SubmarineWorldZ" />

    <div v-if="isLoaded && isAimingViewActive" class="periscope-view"
      :aria-label="aimingViewMode === 'surfaceAim' ? '水面瞄准视角' : '潜望镜视角'" @pointerdown="handlePeriscopePointerDown"
      @pointermove="handlePeriscopePointerMove" @pointerup="handlePeriscopePointerUp"
      @pointercancel="handlePeriscopePointerUp" @pointerleave="handlePeriscopePointerUp">
      <img :src="periscopeSightUrl" alt="" aria-hidden="true" draggable="false" />
    </div>

    <!-- 潜艇 GLB 下载和解析完成前显示加载进度。 -->
    <div v-if="!isLoaded && !loadingError" class="loading-panel" role="status">
      <div class="spinner" aria-hidden="true"></div>
      <p>正在生成海洋并载入潜艇</p>
      <strong>{{ loadingLabel }}</strong>
      <div class="progress-track" aria-hidden="true">
        <span :style="{ width: loadingLabel }"></span>
      </div>
    </div>

    <!-- WebGL 初始化或模型加载失败时显示。 -->
    <p v-if="loadingError" class="error-panel" role="alert">{{ loadingError }}</p>

    <!-- 首次进入页面时短暂显示操作说明。 -->
    <Transition name="hint">
      <p v-if="showHint && !isSubmerged" class="control-hint">
        W/S 前进倒退 · A/D 转向 · K 上浮 · L 下潜 · 鼠标观察
      </p>
    </Transition>

    <!-- 到达水面上限或 280 米最大潜深时的临时提示。 -->
    <Transition name="notice">
      <p v-if="limitNotice" class="limit-notice" role="status">{{ limitNotice }}</p>
    </Transition>
  </section>
</template>
