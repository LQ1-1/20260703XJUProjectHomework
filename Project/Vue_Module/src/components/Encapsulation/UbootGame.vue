<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

import { GameEngine } from './engine/GameEngine'
import { InputController } from './engine/InputController'
import { CameraController } from './engine/CameraController'
import { SubmarineController } from './uboot/SubmarineController'
import { CargoShipController } from './cargoship/CargoShipController'
import { OceanController } from './ocean/OceanController'
import { tuneSunMaterials, disposeObject } from './modules/modelUtils'
import UnderwaterStatusPanel from './panel/UnderwaterStatusPanel.vue'

import submarineUrl from '../../model/type_vii_d_u-boat.glb?url'
import cargoshipUrl from '../../model/liberty_ship.glb?url'
import sunUrl from '../../model/sun.glb?url'
import periscopeSightUrl from '../../assets/Uboot Periscope sight/UBootPeriscopeAimingSight.png?url'
import '../../css/test-3d-programized-ocean.css'

import { v4 as uuidv4, v1 as uuidv1, validate } from 'uuid';

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
const UNDERWATER_UI_DEPTH_METERS = 12

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
let sunModel: THREE.Object3D | undefined
let hintTimer: ReturnType<typeof setTimeout> | undefined
let noticeTimer: ReturnType<typeof setTimeout> | undefined

// -------------------- 加载进度 --------------------
const fileProgress = new Map<string, { loaded: number; total: number }>()

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
    submarine = await SubmarineController.create(engine, input, cameraCtrl, {
      id: uuidv4(), //使用uuid作为模型编号
      // coordinateCode: 'AD16',
      worldPosition: {
        x: 1000,
        z: 550
      },
      initialHeadingDegrees: 180,
      initialDepthMeters: 0,
      isPlayerControlled: true,
      modelUrl: submarineUrl,
    })

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
    }

    submarine.onLimitNotice = (msg) => showLimitNotice(msg)

    // 货船（AI 水面航行）
    cargoShips.push(
      await CargoShipController.create(engine, {
        coordinateCode: 'AD43',
        headingDegrees: 90,
        speedKnots: 0,
        modelUrl: cargoshipUrl,
      }),
    )
    console.log(`货船高度: ${cargoShips[0]?.modelHeight}`)

    // 注册到引擎更新循环
    for (const ship of cargoShips) {
      engine.addUpdatable(ship)
    }

    // Q 键：瞄准切换
    input.onAction = (code, pressed) => {
      if (code === 'KeyQ' && pressed && submarine && cameraCtrl) {
        const msg = cameraCtrl.toggleAiming(submarine)
        if (msg) showLimitNotice(msg)
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
      v-if="isLoaded && showUnderwaterStatus"
      :mode="underwaterStatusMode"
      :depth-meters="depthMeters"
      :speed-knots="speedKnots"
      :heading-degrees="headingDegrees"
      :periscope-relative-bearing-degrees="periscopeRelativeBearingDegrees"
      :navigation-state="navigationState"
      :submarine-world-x="submarineWorldX"
      :submarine-world-z="submarineWorldZ"
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
        W/S 前进倒退 · A/D 转向 · K 上浮 · L 下潜 · 鼠标观察
      </p>
    </Transition>

    <!-- 限制提示 -->
    <Transition name="notice">
      <p v-if="limitNotice" class="limit-notice" role="status">{{ limitNotice }}</p>
    </Transition>
  </section>
</template>
