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
const UNDERWATER_UI_DEPTH_METERS = 130  //控制UnderWaterStatusPanel显示的深度指标, 潜深超过这个值后显示UnderWaterStatusPanel界面
const MAX_SUBMARINE_PITCH = THREE.MathUtils.degToRad(39)  //控制潜艇上浮或者下潜的抬头或低头的幅度
const PITCH_RESPONSE_SENSITIVITY=17;   //俯仰响应灵敏度,数值越大灵敏度越低
const PITCH_SMOOTHING=1.04;    //俯仰平滑度，数值越小变化越慢




//潜望镜相关变量
const PERISCOPE_MIN_DEPTH_METERS = 13   //设置潜望镜深度13~15m
const PERISCOPE_MAX_DEPTH_METERS = 15
const PERISCOPE_EYE_HEIGHT = 1.05 // 潜望镜镜头略高于当前海面
const PERISCOPE_LOOK_DISTANCE = 200
const PERISCOPE_MOUSE_SENSITIVITY = 0.004 //潜望镜视角的鼠标灵敏度
const CONTROL_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyK', 'KeyL', 'KeyQ'])   //控制按键
const SURFACE_BACKGROUND = new THREE.Color(0x6fb9e8)  //背景色
const DEEP_BACKGROUND = new THREE.Color(0x00070d)
const SUN_OFFSET = new THREE.Vector3(-180, 115, -220)
const SUN_DIRECTION = SUN_OFFSET.clone().normalize()
const SUN_MODEL_SCALE = 52

//波浪振幅
const PRIMARY_SWELL=0.88
const CROSS_SWELL=0.64
const MEDIUM_CHOPPY_WAVES=0.24;
const LIGHT_RIPPLES=0.17

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
const isPeriscopeActive = ref(false)

//潜艇世界坐标，测试时展示
const SubmarineWorldX=ref(0);
const SubmarineWorldZ=ref(0);

const loadingLabel = computed(() => `${Math.round(loadingProgress.value)}%`)
const speedKnots = computed(() => speedKmh.value / 1.852)
const isSubmerged = computed(() => depthMeters.value > 0)
const showUnderwaterStatus = computed(
  () => depthMeters.value > UNDERWATER_UI_DEPTH_METERS && !isPeriscopeActive.value,
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

// CPU 与 GPU 必须使用完全相同的波浪公式。
// GPU 用它改变整张海面的顶点；CPU 用它计算潜艇当前位置的水面高度。
function proceduralWaveHeight(x: number, z: number, time: number) {
  return (
    Math.sin(x * 0.075 + time * 0.85) * PRIMARY_SWELL +
    Math.sin(z * 0.095 + time * 0.68) * CROSS_SWELL +
    Math.sin((x + z) * 0.14 + time * 1.1) * MEDIUM_CHOPPY_WAVES +
    Math.sin(x * 0.32 - z * 0.27 + time * 1.8) * LIGHT_RIPPLES
  )
}

// 创建一张连续的大型平面。波浪计算全部在显卡的顶点着色器中完成，
// 因此不存在多个 GLB 模型拼接时的边缘高度和法线不一致问题。
function createProceduralOcean() {
  const geometry = new THREE.PlaneGeometry(
    OCEAN_SIZE,
    OCEAN_SIZE,
    OCEAN_SEGMENTS,
    OCEAN_SEGMENTS,
  )
  geometry.rotateX(-Math.PI / 2)

  const material = new THREE.ShaderMaterial({
    fog: true,
    side: THREE.DoubleSide,
    // ShaderMaterial 不会自动创建 fogColor/fogDensity。
    // 必须合并 UniformsLib.fog，否则渲染器更新雾参数时会读取 undefined.value。
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uDeepColor: { value: new THREE.Color(0x04517a) },
        uShallowColor: { value: new THREE.Color(0x39b9d0) },
        uSunColor: { value: new THREE.Color(0xfff1c0) },
        uSunDirection: { value: SUN_DIRECTION.clone() },
      },
    ]),
    vertexShader: `
      uniform float uTime;

      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;

      #include <fog_pars_vertex>

      void main() {
        vec4 worldBase = modelMatrix * vec4(position, 1.0);
        float x = worldBase.x;
        float z = worldBase.z;

        float wave1 = sin(x * 0.075 + uTime * 0.85) * 0.65;
        float wave2 = sin(z * 0.095 + uTime * 0.68) * 0.48;
        float wave3 = sin((x + z) * 0.14 + uTime * 1.1) * 0.25;
        float wave4 = sin(x * 0.32 - z * 0.27 + uTime * 1.8) * 0.07;
        float height = wave1 + wave2 + wave3 + wave4;

        // 对波浪公式分别求 X/Z 偏导数，用来得到连续的世界空间法线。
        float slopeX =
          cos(x * 0.075 + uTime * 0.85) * 0.65 * 0.075 +
          cos((x + z) * 0.14 + uTime * 1.1) * 0.25 * 0.14 +
          cos(x * 0.32 - z * 0.27 + uTime * 1.8) * 0.07 * 0.32;
        float slopeZ =
          cos(z * 0.095 + uTime * 0.68) * 0.48 * 0.095 +
          cos((x + z) * 0.14 + uTime * 1.1) * 0.25 * 0.14 -
          cos(x * 0.32 - z * 0.27 + uTime * 1.8) * 0.07 * 0.27;

        vWorldPosition = vec3(x, worldBase.y + height, z);
        // 适当放大法线坡度，让光照能清楚表现波峰和波谷。
        vWorldNormal = normalize(vec3(-slopeX * 2.8, 1.0, -slopeZ * 2.8));

        vec4 mvPosition = viewMatrix * vec4(vWorldPosition, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uDeepColor;
      uniform vec3 uShallowColor;
      uniform vec3 uSunColor;
      uniform vec3 uSunDirection;

      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;

      #include <fog_pars_fragment>

      void main() {
        vec3 normal = normalize(vWorldNormal);
        if (!gl_FrontFacing) normal = -normal;

        // 只改变光照法线、不改变几何轮廓的细碎波纹。
        float rippleX =
          sin(vWorldPosition.x * 0.42 + uTime * 2.1) * 0.075 +
          sin((vWorldPosition.x + vWorldPosition.z) * 0.68 - uTime * 1.7) * 0.035;
        float rippleZ =
          cos(vWorldPosition.z * 0.5 + uTime * 1.8) * 0.07 +
          cos((vWorldPosition.x - vWorldPosition.z) * 0.74 + uTime * 1.35) * 0.03;
        normal = normalize(normal + vec3(rippleX, 0.0, rippleZ));

        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        float diffuse = max(dot(normal, uSunDirection), 0.0);
        float fresnel = pow(1.0 - max(dot(viewDirection, normal), 0.0), 2.4);

        vec3 halfDirection = normalize(uSunDirection + viewDirection);
        float specular = pow(max(dot(normal, halfDirection), 0.0), 68.0);
        float crest = smoothstep(0.72, 1.3, vWorldPosition.y);
        float movingGlint =
          pow(max(sin(vWorldPosition.x * 0.3 + vWorldPosition.z * 0.22 + uTime * 1.4), 0.0), 10.0);

        vec3 waterColor = mix(uDeepColor, uShallowColor, 0.28 + crest * 0.35);
        waterColor *= 0.68 + diffuse * 0.5;
        waterColor += uSunColor * specular * 0.95;
        waterColor += uSunColor * movingGlint * crest * 0.16;
        waterColor += vec3(0.12, 0.34, 0.44) * fresnel * 0.85;
        waterColor = mix(waterColor, vec3(0.68, 0.9, 0.96), crest * 0.16);

        gl_FragColor = vec4(waterColor, 1.0);

        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  })

  const ocean = new THREE.Mesh(geometry, material)
  ocean.name = 'ProceduralOcean'
  ocean.frustumCulled = false
  scene?.add(ocean)
  return ocean
}

// 海面跟随潜艇的 X/Z 位置，视觉上可以无限航行。
// 波浪使用世界坐标计算，所以移动平面不会让波形“粘”在潜艇上。
function updateProceduralOcean(delta: number) {
  if (!proceduralOcean || !submarineRoot) return

  oceanTime += delta
  proceduralOcean.material.uniforms.uTime!.value = oceanTime
  proceduralOcean.position.x = submarineRoot.position.x
  proceduralOcean.position.z = submarineRoot.position.z
  sampledWaterHeight = proceduralWaveHeight(
    submarineRoot.position.x,
    submarineRoot.position.z,
    oceanTime,
  )
}

function updateSunAndLightPosition() {
  if (!submarineRoot) return

  const sunPosition = submarineRoot.position.clone().add(SUN_OFFSET)
  sunModel?.position.copy(sunPosition)
  keyLight?.position.copy(sunPosition)
  keyLightTarget?.position.copy(submarineRoot.position)
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

function tuneSunMaterials(sun: THREE.Object3D) {
  sun.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) material.dispose()
    child.material = new THREE.MeshBasicMaterial({
      color: 0xfff2b6,
      fog: false,
      toneMapped: false,
    })
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

function isAtPeriscopeDepth() {
  const depth = currentDepth * SCENE_TO_METERS
  return depth >= PERISCOPE_MIN_DEPTH_METERS && depth <= PERISCOPE_MAX_DEPTH_METERS
}

function disablePeriscope(message = '') {
  if (!isPeriscopeActive.value) return
  isPeriscopeActive.value = false
  isDraggingPeriscope = false
  if (controls) controls.enabled = currentDepth < 0.02
  restoreSurfaceCamera()
  if (message) showLimitNotice(message)
}

function restoreSurfaceCamera() {
  if (!camera || !controls || !submarineRoot) return
  camera.position.set(
    submarineRoot.position.x + 25,
    submarineRoot.position.y + 11,
    submarineRoot.position.z + 27,
  )
  controls.target.set(submarineRoot.position.x, submarineRoot.position.y + 0.2, submarineRoot.position.z)
  previousSubmarinePosition.copy(submarineRoot.position)
}

function togglePeriscope() {
  if (isPeriscopeActive.value) {
    disablePeriscope()
    return
  }

  if (!isAtPeriscopeDepth()) {
    showLimitNotice('不在潜望镜深度')
    return
  }

  isPeriscopeActive.value = true
  periscopeYaw = heading
  pressedKeys.delete('KeyK')
  pressedKeys.delete('KeyL')
  if (controls) {
    controls.enabled = false
    controls.autoRotate = false
  }
}

function updatePeriscopeState() {
  if (!isPeriscopeActive.value) {
    if (controls) controls.enabled = currentDepth < 0.02
    return
  }

  if (!isAtPeriscopeDepth()) {
    disablePeriscope('请前往潜望镜深度13-15m')
  }
}

function updatePeriscopeCamera() {
  if (!isPeriscopeActive.value || !camera || !submarineRoot) return

  const eyeY = sampledWaterHeight + PERISCOPE_EYE_HEIGHT
  camera.position.set(submarineRoot.position.x, eyeY, submarineRoot.position.z)
  camera.lookAt(
    submarineRoot.position.x + Math.cos(periscopeYaw) * PERISCOPE_LOOK_DISTANCE,
    eyeY,
    submarineRoot.position.z - Math.sin(periscopeYaw) * PERISCOPE_LOOK_DISTANCE,
  )
}

// -------------------- 上浮和下潜 --------------------
function updateDepth(delta: number) {
  if (isPeriscopeActive.value) {
    pressedKeys.delete('KeyK')
    pressedKeys.delete('KeyL')
  }

  // L 对应 +1（增加深度），K 对应 -1（减小深度）。
  const diveInput = isPeriscopeActive.value
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
  if (!submarineRoot || !camera || !controls || isPeriscopeActive.value) return
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
  // 罗盘约定：000 指向世界 -Z，090 指向 +X，180 指向 +Z，270 指向 -X。
  headingDegrees.value = ((90 - THREE.MathUtils.radToDeg(heading)) % 360 + 360) % 360
  navigationState.value = currentDepth < 0.02 ? '水面' : '水下'

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
  if (isPeriscopeActive.value && (event.code === 'KeyK' || event.code === 'KeyL')) {
    showLimitNotice('需要先收起潜望镜')
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
  if (!isPeriscopeActive.value) return
  isDraggingPeriscope = true
  lastPeriscopePointerX = event.clientX
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
}

function handlePeriscopePointerMove(event: PointerEvent) {
  if (!isPeriscopeActive.value || !isDraggingPeriscope) return
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
    normalizeSubmarine(submarine)
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
    proceduralOcean = createProceduralOcean()
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
    updateProceduralOcean(delta)
    updateSunAndLightPosition()
    updateSubmarineHeight(delta)
    updateSubmarinePitch(delta)
    updatePeriscopeState()
    updateCameraFollow()
    updatePeriscopeCamera()
    updateUnderwaterAppearance()
    updateHud(time)
    if (!isPeriscopeActive.value) controls?.update()
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
    <div v-if="isLoaded && showUnderwaterStatus" class="underwater-screen" aria-hidden="true"></div>

    <UnderwaterStatusPanel
      v-if="isLoaded"
      :depth-meters="depthMeters"
      :speed-knots="speedKnots"
      :heading-degrees="headingDegrees"
      :navigation-state="navigationState"
      :submarine-world-x="SubmarineWorldX"
      :submarine-world-z="SubmarineWorldZ"
    />

    <div
      v-if="isLoaded && isPeriscopeActive"
      class="periscope-view"
      aria-label="潜望镜视角"
      @pointerdown="handlePeriscopePointerDown"
      @pointermove="handlePeriscopePointerMove"
      @pointerup="handlePeriscopePointerUp"
      @pointercancel="handlePeriscopePointerUp"
      @pointerleave="handlePeriscopePointerUp"
    >
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
