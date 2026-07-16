<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

import { GameEngine } from '../engine/GameEngine.ts'
import { InputController } from '../engine/InputController.ts'
import { CameraController } from '../engine/CameraController.ts'
import {
  ALARM_BUFF_DURATION_SECONDS,
  SubmarineController,
} from '../uboat/SubmarineController.ts'
import { CargoShipController } from '../cargoship/CargoShipController.ts'
import { OceanController } from '../ocean/OceanController.ts'
import { tuneSunMaterials, disposeObject } from '../modules/modelUtils.ts'
import { HitDetectSystem } from '../modules/hitdetect.ts'
import UnderwaterStatusPanel from '../panel/UnderwaterStatusPanel.vue'
import TopRightPanel from '../panel/TopRightPanel.vue'
import {
  MANUAL_HEADING_COMMAND,
  MANUAL_SPEED_COMMAND,
  headingStringToDegrees,
} from '../modules/navigationMath.ts'
import VoyageMap from '../../../common/map/VoyageMap.vue'
import PlayAudio from '../../../common/audiotool/PlayAudio.ts'

import '../../../css/test-3d-programized-ocean.css'

import { v4 as uuidv4 } from 'uuid'
import { ExplosionSplashEffect } from '../ExplosionSplashEffect/explosionSplashEffect.ts'
import { GameEntityRegistry } from '../entitymanager/GameEntityRegistry.ts'
import type { TorpedoLaunchPlan } from '../torpedor/torpedoTypes.ts'
import {
  createMapBoundedRadialPosition,
  updateLoadingProgressValue,
} from './gameBodyShared.ts'

const submarineUrl = '/assets/model/type_vii_d_u-boat.glb'
const cargoshipUrl = '/assets/model/liberty_ship.glb'
const torpedoUrl = '/assets/model/mkxii_torpedo.glb'
const sunUrl = '/assets/model/sun.glb'
const periscopeSightUrl = '/assets/UbootPeriscopesight/UBootPeriscopeAimingSight.png'
const alarmAudioUrl = ''

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
const MAP_MIN = 0
const MAP_MAX = 12150
const INITIAL_SUBMARINE_DISTANCE = 1600
const CONVOY_ROWS = 4
const CONVOY_COLUMNS = 5
const CONVOY_LATERAL_SPACING = 261
const CONVOY_LONGITUDINAL_SPACING_MIN = 130
const CONVOY_LONGITUDINAL_SPACING_MAX = 210
const CONVOY_POSITION_JITTER = 50
const CONVOY_SPEED_KNOTS = 7
const TORPEDO_REPLENISH_SECONDS = 5 * 60
const OFFLINE_TORPEDO_COUNT = 14

type ConvoySide = 'left' | 'right'

interface ConvoyPlan {
  side: ConvoySide
  headingDegrees: number
  ships: {
    worldPosition: { x: number; z: number }
    headingDegrees: number
  }[]
  center: THREE.Vector3
}

// -------------------- Vue 响应式状态 --------------------
const viewer = ref<HTMLDivElement | null>(null)
const router = useRouter()
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
const isAlarmActive = ref(false)
const alarmRemainingSeconds = ref(0)

// -------------------- 计算属性 --------------------
const loadingLabel = computed(() => `${Math.round(loadingProgress.value)}%`)
const speedKnots = computed(() => speedKmh.value / 1.852)
const isSubmerged = computed(() => depthMeters.value > 0)

let countFButtonDown = 0

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
let alarmTimeout: ReturnType<typeof setTimeout> | undefined
let alarmCountdownTimer: ReturnType<typeof setInterval> | undefined
let alarmEndsAt = 0
let alarmAudio: PlayAudio | undefined
let torpedoReplenishTimer: ReturnType<typeof setTimeout> | undefined
let convoySpawnInProgress = false
let currentConvoySide: ConvoySide | undefined
let isOfflineGameDisposed = false

// -------------------- 面板引用 --------------------
const statusPanelRef = ref<InstanceType<typeof UnderwaterStatusPanel> | null>(null)

// -------------------- 加载进度 --------------------
const fileProgress = new Map<string, { loaded: number; total: number }>()

// -------------------- 模型管理器 -------------------//
let entityRegistry: GameEntityRegistry | undefined


function updateLoadingProgress(url: string, event: ProgressEvent<EventTarget>) {
  const nextProgress = updateLoadingProgressValue(fileProgress, url, event)
  if (nextProgress !== undefined) loadingProgress.value = nextProgress
}

// -------------------- 限制提示 --------------------
function showLimitNotice(message: string) {
  limitNotice.value = message
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => { limitNotice.value = '' }, 1800)
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function randomIntBetween(min: number, max: number): number {
  return Math.floor(randomBetween(min, max + 1))
}

function clampToMap(value: number): number {
  return THREE.MathUtils.clamp(value, MAP_MIN, MAP_MAX)
}

function shiftConvoyIntoMap(positions: THREE.Vector3[], side: ConvoySide): void {
  const minX = Math.min(...positions.map((position) => position.x))
  const maxX = Math.max(...positions.map((position) => position.x))
  const minZ = Math.min(...positions.map((position) => position.z))
  const maxZ = Math.max(...positions.map((position) => position.z))

  let shiftX = 0
  if (side === 'left' && minX < MAP_MIN) {
    shiftX = MAP_MIN - minX
  } else if (side === 'right' && maxX > MAP_MAX) {
    shiftX = MAP_MAX - maxX
  } else if (minX < MAP_MIN) {
    shiftX = MAP_MIN - minX
  } else if (maxX > MAP_MAX) {
    shiftX = MAP_MAX - maxX
  }

  let shiftZ = 0
  if (minZ < MAP_MIN) {
    shiftZ = MAP_MIN - minZ
  } else if (maxZ > MAP_MAX) {
    shiftZ = MAP_MAX - maxZ
  }

  for (const position of positions) {
    position.x += shiftX
    position.z += shiftZ
  }
}

function randomConvoyHeading(side: ConvoySide): number {
  if (side === 'left') {
    const heading = randomIntBetween(45, 135)
    return heading === 90 ? 91 : heading
  }

  const heading = randomIntBetween(225, 315)
  return heading === 270 ? 271 : heading
}

function compassHeadingToForward(headingDegrees: number): THREE.Vector3 {
  const heading = THREE.MathUtils.degToRad(90 - headingDegrees)
  return new THREE.Vector3(Math.cos(heading), 0, -Math.sin(heading)).normalize()
}

function createRandomConvoyPlan(): ConvoyPlan {
  const side: ConvoySide = Math.random() < 0.5 ? 'left' : 'right'
  const headingDegrees = randomConvoyHeading(side)
  const entryX = side === 'left' ? MAP_MIN : MAP_MAX
  const entryZ = randomBetween(MAP_MIN, MAP_MAX)
  const longitudinalSpacing = randomBetween(
    CONVOY_LONGITUDINAL_SPACING_MIN,
    CONVOY_LONGITUDINAL_SPACING_MAX,
  )
  const forward = compassHeadingToForward(headingDegrees)
  const right = new THREE.Vector3(-forward.z, 0, forward.x).normalize()
  const leadCenter = new THREE.Vector3(entryX, 0, entryZ)
  const positions: THREE.Vector3[] = []
  const ships: ConvoyPlan['ships'] = []
  const center = new THREE.Vector3()

  for (let row = 0; row < CONVOY_ROWS; row += 1) {
    for (let column = 0; column < CONVOY_COLUMNS; column += 1) {
      const lateralOffset = (column - (CONVOY_COLUMNS - 1) / 2) * CONVOY_LATERAL_SPACING
      const longitudinalOffset = row * longitudinalSpacing
      const jitterLateral = randomBetween(-CONVOY_POSITION_JITTER, CONVOY_POSITION_JITTER)
      const jitterLongitudinal = randomBetween(-CONVOY_POSITION_JITTER, CONVOY_POSITION_JITTER)
      const position = leadCenter
        .clone()
        .add(forward.clone().multiplyScalar(longitudinalOffset + jitterLongitudinal))
        .add(right.clone().multiplyScalar(lateralOffset + jitterLateral))

      positions.push(position)
    }
  }

  shiftConvoyIntoMap(positions, side)

  for (const position of positions) {
    const ship = {
      worldPosition: {
        x: position.x,
        z: position.z,
      },
      headingDegrees,
    }
    ships.push(ship)
    center.add(new THREE.Vector3(ship.worldPosition.x, 0, ship.worldPosition.z))
  }

  center.divideScalar(ships.length)
  return { side, headingDegrees, ships, center }
}

function createInitialSubmarinePosition(convoyCenter: THREE.Vector3): { x: number; z: number } {
  const position = createMapBoundedRadialPosition(
    { x: convoyCenter.x, z: convoyCenter.z },
    INITIAL_SUBMARINE_DISTANCE,
    { min: MAP_MIN, max: MAP_MAX },
    40,
  )

  if (position) return position

  const fallbackX = convoyCenter.x < MAP_MAX / 2
    ? convoyCenter.x + INITIAL_SUBMARINE_DISTANCE
    : convoyCenter.x - INITIAL_SUBMARINE_DISTANCE

  return {
    x: clampToMap(fallbackX),
    z: convoyCenter.z,
  }
}

function disposeCargoShip(ship: CargoShipController): void {
  engine?.removeUpdatable(ship)
  hitDetect?.unregister(ship.id)
  ship.dispose()
}

function clearCargoShips(): void {
  for (const ship of cargoShips) {
    disposeCargoShip(ship)
  }
  cargoShips = []
  currentConvoySide = undefined
}

async function spawnConvoy(plan = createRandomConvoyPlan()): Promise<void> {
  if (isOfflineGameDisposed || !engine || !entityRegistry || convoySpawnInProgress) return
  convoySpawnInProgress = true

  try {
    clearCargoShips()
    const nextShips = await Promise.all(plan.ships.map((ship) =>
      CargoShipController.create(engine!, {
        id: uuidv4(),
        worldPosition: ship.worldPosition,
        headingDegrees: ship.headingDegrees,
        speedKnots: CONVOY_SPEED_KNOTS,
        modelUrl: cargoshipUrl,
        entityRegistry: entityRegistry!,
      }),
    ))

    if (isOfflineGameDisposed || !engine || !entityRegistry) {
      for (const ship of nextShips) ship.dispose()
      return
    }

    cargoShips = nextShips
    currentConvoySide = plan.side
    targetDefaultHeight.value = cargoShips[0]?.modelHeight ?? targetDefaultHeight.value

    for (const ship of cargoShips) {
      engine.addUpdatable(ship)
      hitDetect?.registerCargoShip(ship)
    }

    showLimitNotice('新的目标船队已出现')
  } finally {
    convoySpawnInProgress = false
  }
}

function shouldRecycleConvoy(): boolean {
  if (cargoShips.length === 0) return false

  const activeShips = cargoShips.filter((ship) => !ship.isDestroyed)
  if (activeShips.length === 0) return true

  if (currentConvoySide === 'left') {
    return activeShips.every((ship) => ship.root.position.x >= MAP_MAX)
  }

  if (currentConvoySide === 'right') {
    return activeShips.every((ship) => ship.root.position.x <= MAP_MIN)
  }

  return false
}

function scheduleNextConvoyIfNeeded(): void {
  if (convoySpawnInProgress || !shouldRecycleConvoy()) return
  void spawnConvoy()
}

function scheduleTorpedoReplenishIfNeeded(): void {
  if (!submarine || torpedoReplenishTimer || submarine.getTorpedorCount() > 0) return

  showLimitNotice('鱼雷已耗尽，5分钟后重新补给')
  torpedoReplenishTimer = setTimeout(() => {
    submarine?.setTorpedorCount(OFFLINE_TORPEDO_COUNT)
    torpedoReplenishTimer = undefined
    showLimitNotice('鱼雷已重新补给')
  }, TORPEDO_REPLENISH_SECONDS * 1000)
}

async function returnToMode(): Promise<void> {
  await router.push({ name: 'Mode' })
}

// -------------------- 面板指令 → 潜艇 --------------------
function handleSpeedCommand(fraction: number | string) {
  if (fraction === MANUAL_SPEED_COMMAND) {
    submarine?.clearSpeedCommand()
    return
  }
  if (typeof fraction !== 'number') return
  submarine?.setSpeedCommand(fraction)
}

function handleHeadingCommand(headingString: string) {
  if (headingString === MANUAL_HEADING_COMMAND) {
    submarine?.clearHeadingCommand()
    return
  }
  const degrees = headingStringToDegrees(headingString)
  submarine?.setHeadingCommand(degrees)
}

function finishAlarmBuff() {
  if (alarmTimeout) {
    clearTimeout(alarmTimeout)
    alarmTimeout = undefined
  }
  if (alarmCountdownTimer) {
    clearInterval(alarmCountdownTimer)
    alarmCountdownTimer = undefined
  }
  isAlarmActive.value = false
  alarmRemainingSeconds.value = 0
  submarine?.deactivateAlarmBuff()
  alarmAudio?.stop()
  alarmAudio = undefined
}

function updateAlarmCountdown() {
  const remainingMs = Math.max(0, alarmEndsAt - Date.now())
  alarmRemainingSeconds.value = Math.ceil(remainingMs / 1000)
  if (remainingMs <= 0) finishAlarmBuff()
}

function handleAlarm() {
  if (isAlarmActive.value || !submarine) return

  const playAudio = new PlayAudio('/assets/audio/Alarm.wav', ALARM_BUFF_DURATION_SECONDS)
  void playAudio.play()

  isAlarmActive.value = true
  alarmEndsAt = Date.now() + ALARM_BUFF_DURATION_SECONDS * 1000
  alarmRemainingSeconds.value = ALARM_BUFF_DURATION_SECONDS
  submarine.activateAlarmBuff()

  alarmAudio = new PlayAudio(alarmAudioUrl, ALARM_BUFF_DURATION_SECONDS)
  void alarmAudio.play()

  alarmCountdownTimer = setInterval(updateAlarmCountdown, 250)
  alarmTimeout = setTimeout(finishAlarmBuff, ALARM_BUFF_DURATION_SECONDS * 1000)
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
        scheduleTorpedoReplenishIfNeeded()
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
  isOfflineGameDisposed = false
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
    const [, sunGltf] = await Promise.all([
      loader.loadAsync(submarineUrl, (e) => updateLoadingProgress(submarineUrl, e)),
      loader.loadAsync(sunUrl),
    ])

    if (!engine) return

    // 太阳
    sunModel = sunGltf.scene
    tuneSunMaterials(sunModel)
    engine.addSunModel(sunModel)

    const initialConvoyPlan = createRandomConvoyPlan()
    const initialSubmarinePosition = createInitialSubmarinePosition(initialConvoyPlan.center)

    // 潜艇
    //用户操作的潜艇
    submarine = await SubmarineController.create(
      engine,
      input,
      cameraCtrl, {
      id: uuidv4(), //使用uuid作为模型编号
      worldPosition: initialSubmarinePosition,
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

    //注册碰撞检测
    hitDetect = new HitDetectSystem({ scene: engine.scene })
    hitDetect.registerSubmarine(submarine)
    engine.addUpdatable(hitDetect)

    await spawnConvoy(initialConvoyPlan)

    // F 键：瞄准切换
    input.onAction = (code, pressed) => {
      if (code === 'KeyF' && pressed && submarine && cameraCtrl) {

        if (submarine.isAtPeriscopeDepth()) {
          countFButtonDown++
          if (countFButtonDown % 2 === 1) {
            submarine.currentDepth

            void (async () => {
              let playAudio = new PlayAudio('/assets/audio/AufSehrohrtiefegehen.wav', 2)
              await playAudio.play()

              let playAudio2 = new PlayAudio('/assets/audio/BootSteuertSehrohrtiefe.wav', 2)
              await playAudio2.play()
            })()
          }
        }


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
        scheduleNextConvoyIfNeeded()
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

    const playAudio = new PlayAudio('/assets/audio/AufGefechstation.wav', 2)
    void playAudio.play()



    showHint.value = true
    hintTimer = setTimeout(() => { showHint.value = false }, 5000)

  } catch (error) {
    console.error('Failed to load 3D scene:', error)
    loadingError.value = '模型加载失败，请刷新页面重试。'
  }
})

// -------------------- 卸载 --------------------
onBeforeUnmount(() => {
  isOfflineGameDisposed = true
  if (hintTimer) clearTimeout(hintTimer)
  if (noticeTimer) clearTimeout(noticeTimer)
  if (torpedoReplenishTimer) clearTimeout(torpedoReplenishTimer)
  for (const timer of salvoTimers) clearTimeout(timer)
  salvoTimers.length = 0
  finishAlarmBuff()
  if (hitDetect && engine) {
    engine.removeUpdatable(hitDetect)
    hitDetect.clear()
  }
  submarine?.dispose()
  clearCargoShips()
  if (sunModel) {
    sunModel.removeFromParent()
    disposeObject(sunModel)
  }
  ocean?.dispose()
  input?.detach()
  engine?.dispose()
  entityRegistry?.clear()
  fileProgress.clear()
})
</script>

<template>
  <section ref="viewer" class="viewer" aria-label="3D 潜艇模拟器">
    <div v-if="isLoaded" class="online-room-bar">
      <div>
        <span>OFFLINE</span>
        <strong>离线巡航</strong>
      </div>
      <el-button type="danger" size="small" @click="returnToMode">
        返回模式选择
      </el-button>
    </div>

    <!-- 深水渐变遮罩 -->
    <div v-if="isLoaded && showUnderwaterScreen" class="underwater-screen" aria-hidden="true"></div>

    <!-- HUD 面板 -->
    <UnderwaterStatusPanel ref="statusPanelRef" v-if="isLoaded && showUnderwaterStatus" :mode="underwaterStatusMode"
      :depth-meters="depthMeters" :speed-knots="speedKnots" :heading-degrees="headingDegrees"
      :periscope-relative-bearing-degrees="periscopeRelativeBearingDegrees" :navigation-state="navigationState"
      :submarine-world-x="submarineWorldX" :submarine-world-z="submarineWorldZ"
      :target-default-height="targetDefaultHeight" :remaining-torpedoes="remainingTorpedoes"
      :commanded-speed-fraction="commandedSpeedFraction" @speed-command="handleSpeedCommand"
      @heading-command="handleHeadingCommand" />

    <VoyageMap v-if="isLoaded" :submarine-world-x="submarineWorldX" :submarine-world-z="submarineWorldZ"
      :heading-degrees="headingDegrees" />

    <TopRightPanel v-if="isLoaded" :is-alarm-active="isAlarmActive" :alarm-remaining-seconds="alarmRemainingSeconds"
      @alarm="handleAlarm" />

    <!-- 潜望镜/水面瞄准叠加层 -->
    <div v-if="isLoaded && isAimingViewActive" class="periscope-view" :aria-label="navigationState"
      @pointerdown="cameraCtrl?.handlePointerDown($event)" @pointermove="cameraCtrl?.handlePointerMove($event)"
      @pointerup="cameraCtrl?.handlePointerUp($event)" @pointercancel="cameraCtrl?.handlePointerUp($event)"
      @pointerleave="cameraCtrl?.handlePointerUp($event)">
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
