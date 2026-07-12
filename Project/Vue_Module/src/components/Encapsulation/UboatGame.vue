<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

import { GameEngine } from './engine/GameEngine.ts'
import { InputController } from './engine/InputController.ts'
import { CameraController } from './engine/CameraController.ts'
import { SubmarineController } from './uboat/SubmarineController.ts'
import { CargoShipController } from './cargoship/CargoShipController.ts'
import { OceanController } from './ocean/OceanController.ts'
import { tuneSunMaterials, disposeObject } from './modules/modelUtils.ts'
import { HitDetectSystem } from './modules/hitdetect.ts'
import UnderwaterStatusPanel from './panel/UnderwaterStatusPanel.vue'
import { headingStringToDegrees } from './modules/navigationMath.ts'
import VoyageMap from '../../common/map/voyagemap.vue'

import '../../css/test-3d-programized-ocean.css'

import { v4 as uuidv4 } from 'uuid'
import { ExplosionSplashEffect } from './ExplosionSplashEffect/explosionSplashEffect.ts'
import { GameEntityRegistry } from './entitymanager/GameEntityRegistry.ts'
import type { TorpedoLaunchPlan } from './torpedor/torpedoTypes.ts'

const submarineUrl = '/assets/model/type_vii_d_u-boat.glb'
const cargoshipUrl = '/assets/model/liberty_ship.glb'
const torpedoUrl = '/assets/model/mkxii_torpedo.glb'
const sunUrl = '/assets/model/sun.glb'
const periscopeSightUrl = '/assets/Uboot Periscope sight/UBootPeriscopeAimingSight.png'

//------本地测试的版本(尚未和后端服务器进行交互)-------//


// -------------------- 海洋配置 --------------------
const OCEAN_SIZE = 1200
const OCEAN_SEGMENTS = 256
const SUN_OFFSET = new THREE.Vector3(-180, 115, -220)
const SUN_DIRECTION = SUN_OFFSET.clone().normalize()

const WAVE_SETTINGS = {
  primarySwell: 0.88,
  crossSwell: 0.64,
  mediumChoppyWaves: 0.24,
  lightRipples: 0.17,
}

const SURFACE_DEPTH_EPSILON_SCENE = 0.02
const SCENE_TO_METERS = 77 / 22 // MODEL_LENGTH_METERS / MODEL_LENGTH_SCENE
const UNDERWATER_UI_DEPTH_METERS = 11 //控制UnderWaterStatusPanel显示的深度指标, 潜深超过这个值后显示UnderWaterStatusPanel界面

// -------------------- Vue 响应式状态 --------------------
const viewer = ref<HTMLDivElement | null>(null)
const loadingProgress = ref(0)
const loadingError = ref('')
const isLoaded = ref(false)
const showHint = ref(false)
const limitNotice = ref('')

const speedKmh = ref(0)
const depthMeters = ref(0)
const headingDegrees = ref(0)
const periscopeRelativeBearingDegrees = ref(0)
const navigationState = ref<'水面' | '水下' | '潜望镜视角' | '水面瞄准视角'>('水面')
const submarineWorldX = ref(0)
const submarineWorldZ = ref(0)
const isAimingViewActive = ref(false)
const commandedSpeedFraction = ref<number | null>(null)
const remainingTorpedoes = ref(14)
const targetDefaultHeight = ref(0)

// -------------------- 计算属性 --------------------
const loadingLabel = computed(() => `${Math.round(loadingProgress.value)}%`)
const speedKnots = computed(() => speedKmh.value / 1.852)
const isSubmerged = computed(() => depthMeters.value > 0)

// 始终显示 Panel；深水时最大化，其余场景左下角精简显示
const underwaterStatusMode = computed<'full' | 'compact'>(() =>
  depthMeters.value > UNDERWATER_UI_DEPTH_METERS && !isAimingViewActive.value ? 'full' : 'compact',
)

const showUnderwaterStatus = computed(() => true)

const showUnderwaterScreen = computed(
  () => depthMeters.value > UNDERWATER_UI_DEPTH_METERS && !isAimingViewActive.value,
)

// -------------------- 非响应式引用 --------------------
let engine: GameEngine | undefined
let input: InputController | undefined
let cameraCtrl: CameraController | undefined
let submarine: SubmarineController | undefined
let cargoShips: CargoShipController[] = []
let ocean: OceanController | undefined
let hitDetect: HitDetectSystem | undefined
let sunModel: THREE.Object3D | undefined
let hintTimer: ReturnType<typeof setTimeout> | undefined
let noticeTimer: ReturnType<typeof setTimeout> | undefined
let salvoInProgress = false
const salvoTimers: ReturnType<typeof setTimeout>[] = []

// -------------------- 面板引用 --------------------
const statusPanelRef = ref<InstanceType<typeof UnderwaterStatusPanel> | null>(null)

// -------------------- 加载进度 --------------------
const fileProgress = new Map<string, { loaded: number; total: number }>()

// -------------------- 模型管理器 -------------------//
let entityRegistry: GameEntityRegistry | undefined


function updateLoadingProgress(url: string, event: ProgressEvent<EventTarget>) {
  fileProgress.set(url, {
    loaded: event.loaded,
    total: event.lengthComputable ? event.total : event.loaded,
  })
  let loaded = 0
  let total = 0
  for (const p of fileProgress.values()) {
    loaded += p.loaded
    total += p.total
  }
  if (total > 0) loadingProgress.value = Math.min(99, (loaded / total) * 100)
}

// -------------------- 限制提示 --------------------
function showLimitNotice(message: string) {
  limitNotice.value = message
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => { limitNotice.value = '' }, 1800)
}

// -------------------- 面板指令 → 潜艇 --------------------
function handleSpeedCommand(fraction: number) {
  submarine?.setSpeedCommand(fraction)
}

function handleHeadingCommand(headingString: string) {
  const degrees = headingStringToDegrees(headingString)
  submarine?.setHeadingCommand(degrees)
}

function handleSpaceFire() {
  if (salvoInProgress || !submarine || !statusPanelRef.value) return

  const tubeStates = statusPanelRef.value.getTubeStates()
  const selectedTubeCount = tubeStates.filter((tube) => tube.selected).length
  if (selectedTubeCount === 0) {
    showLimitNotice('请选择鱼雷发射管')
    return
  }

  const plans = statusPanelRef.value.getSelectedLaunchPlans()
  if (plans.length === 0) {
    showLimitNotice('所选发射管未装订弹道')
    return
  }

  if (plans.some((plan) => plan.isOutOfRange)) {
    showLimitNotice('目标超出射程')
  }

  scheduleTorpedoSalvo(plans)
}

function scheduleTorpedoSalvo(plans: TorpedoLaunchPlan[]) {
  salvoInProgress = true
  let completed = 0

  plans.forEach((plan, index) => {
    const timer = setTimeout(async () => {
      const torpedo = await submarine?.fireTorpedo(plan)
      if (torpedo) {
        hitDetect?.registerTorpedo(torpedo)
        statusPanelRef.value?.markTubesFired([plan.tubeId])
      } else {
        showLimitNotice('无备用鱼雷')
      }

      completed += 1
      if (completed >= plans.length) {
        salvoInProgress = false
      }
    }, index * 350)
    salvoTimers.push(timer)
  })
}

// -------------------- 挂载 --------------------
onMounted(async () => {
  const container = viewer.value
  if (!container) return

  // 1. 创建引擎
  try {
    engine = new GameEngine({ container })
  } catch (error) {
    console.error('Failed to create WebGL renderer:', error)
    loadingError.value = '浏览器无法创建 WebGL 画面，请检查硬件加速设置。'
    return
  }

  // 2. 输入控制器
  input = new InputController()
  input.attach(engine.renderer.domElement)

  // 3. 相机控制器
  cameraCtrl = new CameraController(engine.camera, engine.controls)

  // 4. 海洋
  ocean = new OceanController({
    oceanSize: OCEAN_SIZE,
    oceanSegments: OCEAN_SEGMENTS,
    sunDirection: SUN_DIRECTION,
    waves: WAVE_SETTINGS,
  })
  engine.scene.add(ocean.mesh)
  engine.addUpdatable(ocean)

  // 5. 加载模型（潜艇 + 太阳，并行）
  const loader = new GLTFLoader()

  //注册 模型控制器
  entityRegistry = new GameEntityRegistry()

  try {
    const [submarineGltf, sunGltf] = await Promise.all([
      loader.loadAsync(submarineUrl, (e) => updateLoadingProgress(submarineUrl, e)),
      loader.loadAsync(sunUrl),
    ])

    if (!engine) return

    // 太阳
    sunModel = sunGltf.scene
    tuneSunMaterials(sunModel)
    engine.addSunModel(sunModel)

    // 潜艇
    //用户操作的潜艇
    submarine = await SubmarineController.create(
      engine, 
      input, 
      cameraCtrl, {
      id: uuidv4(), //使用uuid作为模型编号
      // coordinateCode: 'AD16',
      worldPosition: {
        x: 900,
        z: 450
      },
      initialHeadingDegrees: 180,
      initialDepthMeters: 0,
      isPlayerControlled: true,
      modelUrl: submarineUrl,
      torpedoModelUrl: torpedoUrl,
      entityRegistry
      })

    submarineWorldX.value = submarine.root.position.x
    submarineWorldZ.value = submarine.root.position.z
    headingDegrees.value = submarine.compassHeading

    // HUD 回调
    submarine.onHudUpdate = (data) => {
      speedKmh.value = data.speedKmh
      depthMeters.value = data.depthMeters
      headingDegrees.value = data.headingDegrees
      periscopeRelativeBearingDegrees.value = data.periscopeRelativeBearingDegrees
      navigationState.value = data.navigationState
      submarineWorldX.value = data.worldX
      submarineWorldZ.value = data.worldZ
      isAimingViewActive.value = cameraCtrl?.isAiming ?? false
      if (data.commandedSpeedFraction !== commandedSpeedFraction.value) {
        commandedSpeedFraction.value = data.commandedSpeedFraction
      }
      remainingTorpedoes.value = data.torpedorCount
    }

    submarine.onLimitNotice = (msg) => showLimitNotice(msg)

    // 货船（AI 水面航行）
    cargoShips.push(
      await CargoShipController.create(engine, {
        id: uuidv4(),
        // coordinateCode: 'AD43',

        worldPosition: {
        x: 750,
        z: 910
        },

        headingDegrees: 160,
        speedKnots: 7,
        modelUrl: cargoshipUrl,
        entityRegistry
      }),

        await CargoShipController.create(engine, {
        id: uuidv4(),

        worldPosition: {
        x: 750,
        z: 1010
        },

        headingDegrees: 160,
        speedKnots: 7,
        modelUrl: cargoshipUrl,
        entityRegistry
      }),

      await CargoShipController.create(engine, {
        id: uuidv4(),
        worldPosition: {
        x: 950,
        z: 1150
        },

        headingDegrees: 160,
        speedKnots: 7,
        modelUrl: cargoshipUrl,
        entityRegistry
      }),
    )
    console.log(`货船高度: ${cargoShips[0]?.modelHeight}`)
    targetDefaultHeight.value = cargoShips[0]?.modelHeight ?? 0

    // 注册到引擎更新循环
    for (const ship of cargoShips) {
      engine.addUpdatable(ship)
    }

    //注册碰撞检测
    hitDetect = new HitDetectSystem({ scene: engine.scene })
    hitDetect.registerSubmarine(submarine)
    hitDetect.registerCargoShips(cargoShips)
    engine.addUpdatable(hitDetect)

    // F 键：瞄准切换
    input.onAction = (code, pressed) => {
      if (code === 'KeyF' && pressed && submarine && cameraCtrl) {
        const msg = cameraCtrl.toggleAiming(submarine)
        if (msg) showLimitNotice(msg)
      }
      if (code === 'Space' && pressed) {
        handleSpaceFire()
      }
    }

    // 海洋跟随潜艇
    // （在每帧中由引擎调度，但需要在 update 循环中注入采样高度）
    const oceanUpdatable = ocean
    const originalOceanUpdate = oceanUpdatable.update.bind(oceanUpdatable)
    oceanUpdatable.update = (delta: number) => {
      if (submarine) {
        oceanUpdatable.follow(submarine.root.position)
        submarine.setSampledWaterHeight(oceanUpdatable.sampledWaterHeight)
        // 货船跟随波浪高度
        for (const ship of cargoShips) {
          ship.updateHeight(oceanUpdatable.sampledWaterHeight)
        }
      }
      originalOceanUpdate(delta)
      // 同步更新太阳位置
      if (submarine && engine) {
        engine.updateSunAndLight(submarine.root.position)
      }
    }

    // 完成加载
    loadingProgress.value = 100
    isLoaded.value = true
    showHint.value = true
    hintTimer = setTimeout(() => { showHint.value = false }, 5000)

  } catch (error) {
    console.error('Failed to load 3D scene:', error)
    loadingError.value = '模型加载失败，请刷新页面重试。'
  }
})

// -------------------- 卸载 --------------------
onBeforeUnmount(() => {
  if (hintTimer) clearTimeout(hintTimer)
  if (noticeTimer) clearTimeout(noticeTimer)
  for (const timer of salvoTimers) clearTimeout(timer)
  salvoTimers.length = 0
  if (hitDetect && engine) {
    engine.removeUpdatable(hitDetect)
    hitDetect.clear()
  }
  submarine?.dispose()
  for (const ship of cargoShips) ship.dispose()
  cargoShips = []
  if (sunModel) {
    sunModel.removeFromParent()
    disposeObject(sunModel)
  }
  ocean?.dispose()
  input?.detach()
  engine?.dispose()
  fileProgress.clear()
})
</script>

<template>
  <section ref="viewer" class="viewer" aria-label="3D 潜艇模拟器">
    <!-- 深水渐变遮罩 -->
    <div v-if="isLoaded && showUnderwaterScreen" class="underwater-screen" aria-hidden="true"></div>

    <!-- HUD 面板 -->
    <UnderwaterStatusPanel
      ref="statusPanelRef"
      v-if="isLoaded && showUnderwaterStatus"
      :mode="underwaterStatusMode"
      :depth-meters="depthMeters"
      :speed-knots="speedKnots"
      :heading-degrees="headingDegrees"
      :periscope-relative-bearing-degrees="periscopeRelativeBearingDegrees"
      :navigation-state="navigationState"
      :submarine-world-x="submarineWorldX"
      :submarine-world-z="submarineWorldZ"
      :target-default-height="targetDefaultHeight"
      :remaining-torpedoes="remainingTorpedoes"
      :commanded-speed-fraction="commandedSpeedFraction"
      @speed-command="handleSpeedCommand"
      @heading-command="handleHeadingCommand"
    />

    <VoyageMap
      v-if="isLoaded"
      :submarine-world-x="submarineWorldX"
      :submarine-world-z="submarineWorldZ"
      :heading-degrees="headingDegrees"
    />

    <!-- 潜望镜/水面瞄准叠加层 -->
    <div
      v-if="isLoaded && isAimingViewActive"
      class="periscope-view"
      :aria-label="navigationState"
      @pointerdown="cameraCtrl?.handlePointerDown($event)"
      @pointermove="cameraCtrl?.handlePointerMove($event)"
      @pointerup="cameraCtrl?.handlePointerUp($event)"
      @pointercancel="cameraCtrl?.handlePointerUp($event)"
      @pointerleave="cameraCtrl?.handlePointerUp($event)"
    >
      <img :src="periscopeSightUrl" alt="" aria-hidden="true" draggable="false" />
    </div>

    <!-- 加载进度 -->
    <div v-if="!isLoaded && !loadingError" class="loading-panel" role="status">
      <div class="spinner" aria-hidden="true"></div>
      <p>正在生成海洋并载入潜艇</p>
      <strong>{{ loadingLabel }}</strong>
      <div class="progress-track" aria-hidden="true">
        <span :style="{ width: loadingLabel }"></span>
      </div>
    </div>

    <!-- 加载错误 -->
    <p v-if="loadingError" class="error-panel" role="alert">{{ loadingError }}</p>

    <!-- 操作提示 -->
    <Transition name="hint">
      <p v-if="showHint && !isSubmerged" class="control-hint">
        W/S 前进倒退 · A/D 转向 · K 上浮 · L 下潜 · F 瞄准观察 · 空格发射鱼雷
      </p>
    </Transition>

    <!-- 限制提示 -->
    <Transition name="notice">
      <p v-if="limitNotice" class="limit-notice" role="status">{{ limitNotice }}</p>
    </Transition>
  </section>
</template>
