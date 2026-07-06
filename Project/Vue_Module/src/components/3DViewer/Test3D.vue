<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import oceanUrl from '../../model/ocean.glb?url'
import submarineUrl from '../../model/type_vii_d_u-boat.glb?url'

// 单个海洋区块的数据。每个区块共用模型资源，但拥有独立的位置和动画播放器。
type OceanTile = {
  root: THREE.Object3D // 区块的模型根节点
  mixer?: THREE.AnimationMixer // 负责播放这个区块的海浪动画
  meshes: THREE.Mesh[] // 射线检测需要使用的海面网格
  gridX: number // 区块在海洋网格中的 X 编号
  gridZ: number // 区块在海洋网格中的 Z 编号
}

// -------------------- 现实单位和场景单位换算 --------------------
// 潜艇模型在 Three.js 中缩放为 22 单位，对应现实中的约 77 米。
const MODEL_LENGTH_SCENE = 22
const MODEL_LENGTH_METERS = 77
const METERS_TO_SCENE = MODEL_LENGTH_SCENE / MODEL_LENGTH_METERS
const SCENE_TO_METERS = MODEL_LENGTH_METERS / MODEL_LENGTH_SCENE

// -------------------- 海洋、速度和深度参数 --------------------
const OCEAN_TILE_SIZE = 400 // 每块海洋模型的水平尺寸为 400 × 400
const OCEAN_TILE_SPACING = 398 // 相邻块搭接 2 单位，用来遮挡模型边缘裂缝
const OCEAN_ANIMATION_SPEED = 0.15 // 海浪动画播放速度，1 为模型原速
const SURFACE_MODEL_OFFSET = -1.0 // 用户指定的潜艇水面标准吃水偏移
const MAX_DEPTH_SCENE = 280 * METERS_TO_SCENE // 最大潜深 280 米，等于 80 场景单位
const MAX_VERTICAL_SPEED = 4 * METERS_TO_SCENE // 最大上浮/下潜速度：现实 4 米/秒
const SURFACE_MAX_SPEED = (30_000 * METERS_TO_SCENE) / 3600 // 水面 30 km/h
const SUBMERGED_MAX_SPEED = (13_000 * METERS_TO_SCENE) / 3600 // 水下 13 km/h
const REVERSE_SPEED_RATIO = 0.4 // 倒车最高速度是对应前进速度的 40%
const MAX_TURN_RATE = THREE.MathUtils.degToRad(4) // 满速满舵每秒最多转向 4°
const SPEED_TRANSITION_DEPTH = 15 * METERS_TO_SCENE // 前 15 米内平滑切换水面/水下限速
const WATER_RAY_HEIGHT = 30 // 射线固定从基准海面上方 30 单位向下发射
const CONTROL_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyK', 'KeyL'])
const SURFACE_BACKGROUND = new THREE.Color(0x061522)
const DEEP_BACKGROUND = new THREE.Color(0x00121d)

// -------------------- Vue 页面状态 --------------------
const viewer = ref<HTMLDivElement | null>(null) // Three.js Canvas 的 HTML 容器
const loadingProgress = ref(0) // 两个 GLB 文件的综合加载进度
const loadingError = ref('') // WebGL 或模型加载失败时显示的错误
const isLoaded = ref(false) // 控制加载界面和 HUD 的显示
const showHint = ref(false) // 底部操作提示是否显示
const speedKmh = ref(0) // HUD：当前速度，单位 km/h
const depthMeters = ref(0) // HUD：当前深度，单位 m
const headingDegrees = ref(0) // HUD：当前航向角，范围 0～359°
const navigationState = ref<'水面' | '水下'>('水面')
const limitNotice = ref('') // 到达水面或最大潜深时的提示

const loadingLabel = computed(() => `${Math.round(loadingProgress.value)}%`)

// -------------------- 可复用的数学对象和资源集合 --------------------
// 这些对象会在每一帧反复使用，提前创建可以减少垃圾回收。
const raycaster = new THREE.Raycaster()
const rayOrigin = new THREE.Vector3()
const downDirection = new THREE.Vector3(0, -1, 0)
const movementDelta = new THREE.Vector3()
const previousSubmarinePosition = new THREE.Vector3()
const oceanBasePosition = new THREE.Vector3()
const pressedKeys = new Set<string>()
const resources: THREE.Object3D[] = []
const fileProgress = new Map<string, { loaded: number; total: number }>()
const oceanTiles: OceanTile[] = []

// -------------------- Three.js 核心对象 --------------------
let renderer: THREE.WebGLRenderer | undefined // 将 3D 场景绘制到 Canvas
let scene: THREE.Scene | undefined // 整个 3D 世界
let camera: THREE.PerspectiveCamera | undefined // 玩家观察场景的透视相机
let controls: OrbitControls | undefined // 鼠标旋转和缩放控制器
let submarineRoot: THREE.Group | undefined // 负责潜艇移动、转向的根节点
let oceanTemplate: THREE.Object3D | undefined // 首次加载的海洋模板
let resizeObserver: ResizeObserver | undefined
let hemisphereLight: THREE.HemisphereLight | undefined
let keyLight: THREE.DirectionalLight | undefined
let rimLight: THREE.DirectionalLight | undefined

// -------------------- 游戏运行状态 --------------------
let animationFrame = 0
let hintTimer: ReturnType<typeof setTimeout> | undefined
let noticeTimer: ReturnType<typeof setTimeout> | undefined
let previousFrameTime = 0
let lastWaterSampleTime = 0
let lastHudUpdateTime = 0
let currentGridX = Number.NaN
let currentGridZ = Number.NaN
let currentSpeed = 0 // 有符号速度：正数前进，负数倒车
let heading = 0 // 航向弧度；潜艇初始朝向模型自身的 +X
let targetDepth = 0 // K/L 修改的目标深度
let currentDepth = 0 // 经过平滑运动后的实际深度
let verticalSpeed = 0 // 当前垂直速度，用于平滑启动和停止
let sampledWaterHeight = 0 // 射线检测到的潜艇当前位置海面高度
let surfaceLimitWasActive = false
let depthLimitWasActive = false

// 分别记录 ocean.glb 和 submarine.glb 的已加载字节，计算综合进度。
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

// 将下载来的海洋模型调整为 400 × 400，并把初始最高点对齐到 y = 0。
function normalizeOcean(ocean: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(ocean)
  const size = box.getSize(new THREE.Vector3())

  // 只放大水平 X/Z，避免把波浪高度也扩大。
  if (size.x > 0) ocean.scale.x *= OCEAN_TILE_SIZE / size.x
  if (size.z > 0) ocean.scale.z *= OCEAN_TILE_SIZE / size.z

  const normalizedBox = new THREE.Box3().setFromObject(ocean)
  const center = normalizedBox.getCenter(new THREE.Vector3())
  ocean.position.x -= center.x
  ocean.position.z -= center.z
  ocean.position.y -= normalizedBox.max.y
  ocean.updateMatrixWorld(true)
}

// 原模型使用的旧材质扩展不能被当前 Three.js 完整识别，因此主动设置现代 PBR 参数。
function tuneOceanMaterials(ocean: THREE.Object3D) {
  ocean.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue
      material.color.set(0x17688a)
      material.roughness = 0.32
      material.metalness = 0.03
      material.envMapIntensity = 0.7
      material.needsUpdate = true
    }
  })
}

// 收集模型内部所有 Mesh，射线只与 Mesh 求交，不能直接与普通 Group 求交。
function collectMeshes(root: THREE.Object3D) {
  const meshes: THREE.Mesh[] = []
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) meshes.push(child)
  })
  return meshes
}

// 首次只解析一个 ocean.glb，然后 clone 出 9 个共享几何体、材质和纹理的区块。
// clone 不会重新发起网络请求，因此不会重复下载约 27 MB 的模型文件。
function createOceanTiles(template: THREE.Object3D, animation?: THREE.AnimationClip) {
  const basePosition = template.position.clone()
  oceanBasePosition.copy(basePosition)

  for (let index = 0; index < 9; index += 1) {
    // 第 0 块直接使用模板，其余 8 块复用模板内部资源。
    const root = index === 0 ? template : template.clone(true)
    root.position.copy(basePosition)
    scene?.add(root)

    let mixer: THREE.AnimationMixer | undefined
    if (animation) {
      // 每个克隆节点需要自己的 AnimationMixer，但动画速度和相位保持一致。
      mixer = new THREE.AnimationMixer(root)
      const action = mixer.clipAction(animation)
      action.timeScale = OCEAN_ANIMATION_SPEED
      action.setLoop(THREE.LoopRepeat, Infinity).play()
    }

    oceanTiles.push({
      root,
      mixer,
      meshes: collectMeshes(root),
      gridX: 0,
      gridZ: 0,
    })
  }

  updateOceanGrid(true)
}

// 让 9 个区块始终组成以潜艇所在块为中心的 3 × 3 九宫格。
// 潜艇越过区块中心边界后，直接重新定位旧实例，相当于回收并复用对象池。
function updateOceanGrid(force = false) {
  if (!submarineRoot || oceanTiles.length !== 9) return

  const centerX = Math.round(submarineRoot.position.x / OCEAN_TILE_SPACING)
  const centerZ = Math.round(submarineRoot.position.z / OCEAN_TILE_SPACING)
  if (!force && centerX === currentGridX && centerZ === currentGridZ) return

  currentGridX = centerX
  currentGridZ = centerZ
  let tileIndex = 0

  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const tile = oceanTiles[tileIndex]
      if (!tile) continue

      tile.gridX = centerX + dx
      tile.gridZ = centerZ + dz
      // 使用 398 而不是 400，使相邻块边缘轻微搭接，减少可见裂缝。
      tile.root.position.x = oceanBasePosition.x + tile.gridX * OCEAN_TILE_SPACING
      tile.root.position.z = oceanBasePosition.z + tile.gridZ * OCEAN_TILE_SPACING
      tileIndex += 1
    }
  }

  scene?.updateMatrixWorld(true)
}

// 根据潜艇位置找到它当前正下方的海洋区块，避免对全部 9 块做昂贵射线检测。
function currentOceanTile() {
  const tileX = Math.round((submarineRoot?.position.x ?? 0) / OCEAN_TILE_SPACING)
  const tileZ = Math.round((submarineRoot?.position.z ?? 0) / OCEAN_TILE_SPACING)
  return oceanTiles.find((tile) => tile.gridX === tileX && tile.gridZ === tileZ)
}

// 检测潜艇所在位置的动态海面高度。
// 海洋有 222 个 Morph Target，射线检测较重，因此限制为每 250ms 一次。
function sampleWaterHeight(time: number) {
  if (!submarineRoot || time - lastWaterSampleTime < 250) return

  const tile = currentOceanTile()
  if (!tile || tile.meshes.length === 0) return
  lastWaterSampleTime = time

  // 射线固定从海面上方发出，而不是从潜艇上方发出。
  // 这样潜到 280 米时，射线起点仍然位于水面之上。
  rayOrigin.set(submarineRoot.position.x, WATER_RAY_HEIGHT, submarineRoot.position.z)
  raycaster.set(rayOrigin, downDirection)
  const hit = raycaster.intersectObjects(tile.meshes, false)[0]
  if (hit) sampledWaterHeight = hit.point.y
}

// 统一潜艇尺寸、水平居中，并设置用户确认的水面吃水线。
function normalizeSubmarine(submarine: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(submarine)
  const size = box.getSize(new THREE.Vector3())
  const longestSide = Math.max(size.x, size.y, size.z)

  if (longestSide > 0) {
    submarine.scale.multiplyScalar(MODEL_LENGTH_SCENE / longestSide)
  }

  const normalizedBox = new THREE.Box3().setFromObject(submarine)
  const center = normalizedBox.getCenter(new THREE.Vector3())
  submarine.position.x -= center.x
  submarine.position.z -= center.z

  // 用户指定：-1.00 是潜艇浮到水面时的标准吃水位置。
  submarine.position.y -= center.y + SURFACE_MODEL_OFFSET
}

// 对潜艇材质增加灰蓝色、粗糙度和金属感，突出艇体细节。
function tuneSubmarineMaterials(submarine: THREE.Object3D) {
  submarine.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue
      material.color.multiply(new THREE.Color(0x718087))
      material.roughness = 0.5
      material.metalness = 0.3
      material.needsUpdate = true
    }
  })
}

// Three.js 的 GPU 资源不会随 Vue DOM 自动释放，需要手动销毁几何体、纹理和材质。
function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.geometry.dispose()
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose()
      }
      material.dispose()
    }
  })
}

// 让 current 每次最多向 target 靠近 maximumDelta，常用于固定加速度和减速度。
function moveTowards(current: number, target: number, maximumDelta: number) {
  if (Math.abs(target - current) <= maximumDelta) return target
  return current + Math.sign(target - current) * maximumDelta
}

// 显示水面/最大潜深提示，1.8 秒后自动关闭。
function showLimitNotice(message: string) {
  limitNotice.value = message
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => {
    limitNotice.value = ''
  }, 1800)
}

// -------------------- 上浮和下潜 --------------------
function updateDepth(delta: number) {
  // L 对应 +1（增加深度），K 对应 -1（减小深度）。
  const diveInput = (pressedKeys.has('KeyL') ? 1 : 0) - (pressedKeys.has('KeyK') ? 1 : 0)

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

// 相机和 OrbitControls 的观察中心只跟随位移，不跟随潜艇航向强制旋转。
function updateCameraFollow() {
  if (!submarineRoot || !camera || !controls) return
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

  const depthFactor = THREE.MathUtils.smoothstep(currentDepth * SCENE_TO_METERS, 0, 80)
  scene.background.lerpColors(SURFACE_BACKGROUND, DEEP_BACKGROUND, depthFactor)
  scene.fog.color.copy(scene.background)
  scene.fog.density = THREE.MathUtils.lerp(0.01, 0.026, depthFactor)
  if (hemisphereLight) hemisphereLight.intensity = THREE.MathUtils.lerp(2.25, 0.4, depthFactor)
  if (keyLight) keyLight.intensity = THREE.MathUtils.lerp(4.5, 0.75, depthFactor)
  if (rimLight) rimLight.intensity = THREE.MathUtils.lerp(3.2, 1.4, depthFactor)
}

// HUD 不需要每帧刷新，限制为每 100ms 一次可以减少 Vue 的界面更新次数。
function updateHud(time: number) {
  if (time - lastHudUpdateTime < 100) return
  lastHudUpdateTime = time
  speedKmh.value = currentSpeed * SCENE_TO_METERS * 3.6
  depthMeters.value = currentDepth * SCENE_TO_METERS
  headingDegrees.value = ((THREE.MathUtils.radToDeg(heading) % 360) + 360) % 360
  navigationState.value = currentDepth < 0.02 ? '水面' : '水下'
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
}

// -------------------- Vue 组件挂载：创建 Three.js 场景 --------------------
onMounted(async () => {
  const container = viewer.value
  if (!container) return

  // 创建场景、背景和距离雾。
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x061522)
  scene.fog = new THREE.FogExp2(0x061522, 0.01)

  // 参数依次为视野角度、宽高比、最近可见距离、最远可见距离。
  camera = new THREE.PerspectiveCamera(42, 1, 0.05, 350)
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
  renderer.toneMappingExposure = 1.15
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
  hemisphereLight = new THREE.HemisphereLight(0xb9dcff, 0x071018, 2.25)
  scene.add(hemisphereLight)

  keyLight = new THREE.DirectionalLight(0xfff1d6, 4.5)
  keyLight.position.set(-12, 18, 14)
  scene.add(keyLight)

  rimLight = new THREE.DirectionalLight(0x4fa7ff, 3.2)
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
    // 海洋和潜艇并行加载，减少总等待时间。
    const [oceanGltf, submarineGltf] = await Promise.all([
      loader.loadAsync(oceanUrl, (event) => updateLoadingProgress(oceanUrl, event)),
      loader.loadAsync(submarineUrl, (event) => updateLoadingProgress(submarineUrl, event)),
    ])

    if (!scene) return

    // 先准备海洋模板，之后 9 个区块共享这份模型资源。
    oceanTemplate = oceanGltf.scene
    normalizeOcean(oceanTemplate)
    tuneOceanMaterials(oceanTemplate)
    resources.push(oceanTemplate)

    const oceanAnimation =
      THREE.AnimationClip.findByName(oceanGltf.animations, 'KeyAction') ?? oceanGltf.animations[0]

    // 根节点负责世界移动和航向；视觉模型保留自己的缩放、居中和吃水偏移。
    submarineRoot = new THREE.Group()
    const submarine = submarineGltf.scene
    normalizeSubmarine(submarine)
    tuneSubmarineMaterials(submarine)
    submarineRoot.add(submarine)
    scene.add(submarineRoot)
    resources.push(submarine)
    previousSubmarinePosition.copy(submarineRoot.position)

    createOceanTiles(oceanTemplate, oceanAnimation)

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

    // 执行顺序很重要：先更新海浪和运动，再检测海面，最后更新镜头并绘制。
    for (const tile of oceanTiles) tile.mixer?.update(delta)
    updateDepth(delta)
    updateHorizontalMovement(delta)
    updateOceanGrid()
    scene?.updateMatrixWorld(true)
    sampleWaterHeight(time)
    updateSubmarineHeight(delta)
    updateCameraFollow()
    updateUnderwaterAppearance()
    updateHud(time)
    controls?.update()
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

  // 先停止动画并从场景移除 9 个海洋实例。
  for (const tile of oceanTiles) {
    tile.mixer?.stopAllAction()
    tile.root.removeFromParent()
  }
  submarineRoot?.removeFromParent()
  // 海洋克隆共享底层资源，所以只释放 resources 中记录的模板和潜艇资源。
  for (const object of resources) disposeObject(object)

  renderer?.dispose()
  renderer?.domElement.remove()

  oceanTiles.length = 0
  resources.length = 0
  fileProgress.clear()
  pressedKeys.clear()
  scene = undefined
  camera = undefined
  renderer = undefined
  controls = undefined
  submarineRoot = undefined
  oceanTemplate = undefined
  hemisphereLight = undefined
  keyLight = undefined
  rimLight = undefined
})
</script>

<template>
  <section ref="viewer" class="viewer" aria-label="3D 潜艇模型查看器">
    <!-- 左上角航行仪表，每 100ms 从 Three.js 运行状态同步一次。 -->
    <aside v-if="isLoaded" class="navigation-hud" aria-label="潜艇航行信息">
      <div>
        <span>速度</span>
        <strong>{{ speedKmh.toFixed(1) }} km/h</strong>
      </div>
      <div>
        <span>深度</span>
        <strong>{{ depthMeters.toFixed(1) }} m</strong>
      </div>
      <div>
        <span>航向</span>
        <strong>{{ headingDegrees.toFixed(0).padStart(3, '0') }}°</strong>
      </div>
      <div>
        <span>状态</span>
        <strong>{{ navigationState }}</strong>
      </div>
    </aside>

    <!-- 两个 GLB 下载和解析完成前显示加载进度。 -->
    <div v-if="!isLoaded && !loadingError" class="loading-panel" role="status">
      <div class="spinner" aria-hidden="true"></div>
      <p>正在载入海洋与潜艇</p>
      <strong>{{ loadingLabel }}</strong>
      <div class="progress-track" aria-hidden="true">
        <span :style="{ width: loadingLabel }"></span>
      </div>
    </div>

    <!-- WebGL 初始化或模型加载失败时显示。 -->
    <p v-if="loadingError" class="error-panel" role="alert">{{ loadingError }}</p>

    <!-- 首次进入页面时短暂显示操作说明。 -->
    <Transition name="hint">
      <p v-if="showHint" class="control-hint">
        W/S 前进倒退 · A/D 转向 · K 上浮 · L 下潜 · 鼠标观察
      </p>
    </Transition>

    <!-- 到达水面上限或 280 米最大潜深时的临时提示。 -->
    <Transition name="notice">
      <p v-if="limitNotice" class="limit-notice" role="status">{{ limitNotice }}</p>
    </Transition>
  </section>
</template>

<style scoped>
/* 固定铺满浏览器窗口，Canvas 和所有 HUD 都放在这个容器中。 */
.viewer {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background:
    radial-gradient(circle at 50% 35%, rgba(23, 74, 105, 0.65), transparent 42%),
    linear-gradient(180deg, #0a2639 0%, #061522 68%, #02080d 100%);
  touch-action: none;
}

/* :deep() 用来选中 Three.js 动态插入的 canvas 元素。 */
.viewer :deep(canvas) {
  display: block;
  width: 100%;
  height: 100%;
}

.loading-panel,
.error-panel,
.control-hint,
.limit-notice,
.navigation-hud {
  position: absolute;
  z-index: 2;
  color: rgba(239, 248, 255, 0.96);
  font-family: Inter, system-ui, sans-serif;
  letter-spacing: 0.03em;
}

/* 航行 HUD 使用半透明背景，避免完全遮住后面的 3D 场景。 */
.navigation-hud {
  top: 22px;
  left: 22px;
  display: grid;
  min-width: 190px;
  overflow: hidden;
  border: 1px solid rgba(167, 218, 246, 0.2);
  border-radius: 12px;
  background: rgba(2, 16, 25, 0.68);
  box-shadow: 0 18px 45px rgba(0, 5, 10, 0.22);
  backdrop-filter: blur(10px);
  pointer-events: none;
}

.navigation-hud div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(167, 218, 246, 0.1);
}

.navigation-hud div:last-child {
  border-bottom: 0;
}

.navigation-hud span {
  color: rgba(184, 217, 235, 0.68);
  font-size: 11px;
}

.navigation-hud strong {
  color: #eef9ff;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

/* 加载界面始终位于画面中心。 */
.loading-panel {
  top: 50%;
  left: 50%;
  display: grid;
  width: min(280px, calc(100vw - 48px));
  justify-items: center;
  transform: translate(-50%, -50%);
}

.loading-panel p {
  margin-top: 16px;
  font-size: 14px;
}

.loading-panel strong {
  margin: 5px 0 10px;
  font-size: 12px;
  color: rgba(189, 225, 247, 0.78);
}

/* CSS 圆环加载动画。 */
.spinner {
  width: 38px;
  height: 38px;
  border: 2px solid rgba(133, 202, 243, 0.2);
  border-top-color: #a9ddfa;
  border-radius: 50%;
  animation: spin 0.85s linear infinite;
}

.progress-track {
  width: 100%;
  height: 2px;
  overflow: hidden;
  border-radius: 2px;
  background: rgba(157, 213, 246, 0.15);
}

.progress-track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #5ca8d4, #c5ecff);
  transition: width 180ms ease;
}

.error-panel {
  top: 50%;
  left: 50%;
  margin: 0;
  padding: 14px 20px;
  transform: translate(-50%, -50%);
  border: 1px solid rgba(255, 140, 140, 0.35);
  border-radius: 10px;
  background: rgba(45, 7, 11, 0.78);
}

/* 底部操作提示不接收鼠标事件，避免影响 OrbitControls。 */
.control-hint {
  bottom: 28px;
  left: 50%;
  margin: 0;
  padding: 8px 14px;
  transform: translateX(-50%);
  border: 1px solid rgba(190, 225, 244, 0.18);
  border-radius: 999px;
  background: rgba(3, 16, 25, 0.58);
  font-size: 12px;
  backdrop-filter: blur(8px);
  pointer-events: none;
}

/* 上下限提示显示在页面顶部中间。 */
.limit-notice {
  top: 26px;
  left: 50%;
  margin: 0;
  padding: 9px 16px;
  transform: translateX(-50%);
  border: 1px solid rgba(255, 218, 143, 0.3);
  border-radius: 999px;
  background: rgba(47, 31, 5, 0.76);
  color: #ffe3a7;
  font-size: 12px;
  backdrop-filter: blur(8px);
  pointer-events: none;
}

/* Vue Transition 使用的淡入、淡出动画。 */
.hint-enter-active,
.hint-leave-active,
.notice-enter-active,
.notice-leave-active {
  transition:
    opacity 0.45s ease,
    transform 0.45s ease;
}

.hint-enter-from,
.hint-leave-to,
.notice-enter-from,
.notice-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation-duration: 1.8s;
  }

  .progress-track span,
  .hint-enter-active,
  .hint-leave-active,
  .notice-enter-active,
  .notice-leave-active {
    transition: none;
  }
}

@media (max-width: 600px) {
  .navigation-hud {
    top: 12px;
    left: 12px;
    min-width: 165px;
  }

  .control-hint {
    width: max-content;
    max-width: calc(100vw - 24px);
    text-align: center;
  }
}
</style>
