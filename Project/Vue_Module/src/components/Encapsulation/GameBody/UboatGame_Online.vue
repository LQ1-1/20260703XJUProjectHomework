<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
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
import { HitDetectSystem, type CollisionEvent } from '../modules/hitdetect.ts'
import UnderwaterStatusPanel from '../panel/UnderwaterStatusPanel.vue'
import TopRightPanel from '../panel/TopRightPanel.vue'
import {
  MANUAL_HEADING_COMMAND,
  MANUAL_SPEED_COMMAND,
  headingStringToDegrees,
  yawToCompassDegrees,
} from '../modules/navigationMath.ts'
import VoyageMap from '../../../common/map/VoyageMap.vue'
import PlayAudio from '../../../common/audiotool/PlayAudio.ts'
import CommunicationPanel from '../communication/Communication.vue'
import type { OnlineRoomPlayer } from '../communication/communication.ts'
import {
  confirmModelSunk,
  getRoomDetail,
  getWorldSync,
  leaveRoom,
  reportModelHit,
  uploadOnlineUBoatState,
  uploadOnlineTorpedoState,
  type OnlineCargoShipStateDTO,
  type OnlineUBoatStateDTO,
  type GameResultDTO,
  type SettlementDTO,
} from '../api/ContactTool.ts'
import {
  getCargoStateHeading,
  getCargoStateLocation,
  getCargoStateModelID,
  getCargoStateSpeedKnots,
  getInitialUBoatSpawn as getSharedInitialUBoatSpawn,
  getUBoatStateDepth,
  getUBoatStateHeading,
  getUBoatStateLocation,
  getTorpedoesRemainingFromPayload,
  isSelfUBoatState,
  normalizeArrayPayload,
  normalizeRoomPlayers,
  normalizeUBoatStates,
  shouldRestoreRejectedTorpedo,
  updateLoadingProgressValue,
} from './gameBodyShared.ts'

import '../../../css/test-3d-programized-ocean.css'

import { v4 as uuidv4 } from 'uuid'
import { ExplosionSplashEffect } from '../ExplosionSplashEffect/explosionSplashEffect.ts'
import { GameEntityRegistry } from '../entitymanager/GameEntityRegistry.ts'
import type { TorpedorController } from '../torpedor/TorpedorController.ts'
import type { TorpedoLaunchPlan } from '../torpedor/torpedoTypes.ts'

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
const FALLBACK_U_BOAT_SPAWN = {
  location: { x: 900, z: 450 },
  headingDegrees: 180,
  depthMeters: 0,
}

// -------------------- Vue 响应式状态 --------------------
const route = useRoute()
const router = useRouter()
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
const isAlarmActive = ref(false)
const alarmRemainingSeconds = ref(0)
const roomId = ref(String(route.query.RoomID ?? localStorage.getItem('RoomID') ?? ''))
const selfUUID = ref(localStorage.getItem('KommandantUUID') ?? '')
const selfName = ref(localStorage.getItem('KommandantName') ?? 'Kommandant')
const selfUBoatID = ref(localStorage.getItem('UBoatID') ?? '')
const onlinePlayers = ref<OnlineRoomPlayer[]>([])
const worldRevision = ref('')
const settlement = ref<SettlementDTO | null>(null)
const isSelfSunk = ref(false)
const gameResult = ref<GameResultDTO | null>(null)
const isLeavingRoom = ref(false)
const ownUBoatModelID = ref('')

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
const finalGameResult = computed(() => gameResult.value && gameResult.value.state !== 'playing' ? gameResult.value : null)

// -------------------- 非响应式引用 --------------------
let engine: GameEngine | undefined
let input: InputController | undefined
let cameraCtrl: CameraController | undefined
let submarine: SubmarineController | undefined
let remoteSubmarines = new Map<string, SubmarineController>()
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
let uboatUploadTimer: ReturnType<typeof setInterval> | undefined
let worldSyncTimer: ReturnType<typeof setInterval> | undefined
let roomDetailTimer: ReturnType<typeof setInterval> | undefined
const sunkConfirmingModels = new Set<string>()
const activeSyncedTorpedoes = new Map<string, TorpedorController>()
const cargoShipCreateTasks = new Map<string, Promise<CargoShipController | undefined>>()
const remoteSubmarineCreateTasks = new Map<string, Promise<SubmarineController | undefined>>()
const reportedHitTorpedoes = new Set<string>()

// -------------------- 面板引用 --------------------
const statusPanelRef = ref<InstanceType<typeof UnderwaterStatusPanel> | null>(null)
const communicationRef = ref<InstanceType<typeof CommunicationPanel> | null>(null)

// -------------------- 加载进度 --------------------
const fileProgress = new Map<string, { loaded: number; total: number }>()

// -------------------- 模型管理器 -------------------//
let entityRegistry: GameEntityRegistry | undefined

async function fetchWorldSyncPayload(): Promise<any | undefined> {
  if (!roomId.value) return undefined
  try {
    return await getWorldSync(roomId.value)
  } catch (error) {
    console.warn('初始世界状态获取失败。', error)
    return undefined
  }
}

function getInitialUBoatSpawn(payload: any): {
  id: string
  worldPosition: { x: number; z: number }
  initialHeadingDegrees: number
  initialDepthMeters: number
  torpedoesRemaining?: number
} {
  return getSharedInitialUBoatSpawn(
    payload,
    { selfUUID: selfUUID.value, selfUBoatID: selfUBoatID.value },
    FALLBACK_U_BOAT_SPAWN,
  )
}

async function pollRoomDetail() {
  if (!roomId.value) return
  try {
    const result = await getRoomDetail(roomId.value)
    const players = normalizeRoomPlayers(result)
    if (players.length > 0) {
      onlinePlayers.value = players
      return
    }
  } catch (error) {
    console.warn('房间成员轮询失败。', error)
  }

  if (onlinePlayers.value.length === 0) {
    onlinePlayers.value = [
      {
        KommandantUUID: selfUUID.value,
        KommandantName: selfName.value,
        UBoatID: selfUBoatID.value,
        online: true,
      },
      {
        KommandantUUID: 'DEMO-WOLFPACK-02',
        KommandantName: 'Otto',
        UBoatID: 'U-96',
        online: true,
      },
      {
        KommandantUUID: 'DEMO-WOLFPACK-03',
        KommandantName: 'Kretschmer',
        UBoatID: 'U-99',
        online: true,
      },
    ]
  }
}

async function uploadSelfState() {
  if (!roomId.value || !submarine || isSelfSunk.value) return

  try {
    const result: any = await uploadOnlineUBoatState({
      RoomID: roomId.value,
      selfUBoat: {
        modelID: submarine.id,
        lifecycleState: submarine.isDestroyed ? 'sinking' : 'active',
        KommandantUUID: selfUUID.value,
        KommandantName: selfName.value,
        UBoatID: selfUBoatID.value,
        headingDegrees: headingDegrees.value,
        speedKmh: speedKmh.value,
        location: {
          x: submarine.root.position.x,
          z: submarine.root.position.z,
        },
        depthMeters: depthMeters.value,
        torpedoesRemaining: remainingTorpedoes.value,
        navigationState: navigationState.value,
        lastUpdateAt: new Date().toISOString(),
      },
    })
    syncTorpedoesRemaining(result)
  } catch (error) {
    console.warn('本艇状态上传失败。', error)
  }
}

function syncTorpedoesRemaining(payload: any): void {
  const nextRemaining = getTorpedoesRemainingFromPayload(payload)
  if (nextRemaining === undefined) return

  remainingTorpedoes.value = nextRemaining
  submarine?.setTorpedorCount(nextRemaining)
}

function restoreRejectedTorpedo(torpedo: TorpedorController): void {
  activeSyncedTorpedoes.delete(torpedo.id)
  torpedo.dispose()
  const restoredRemaining = remainingTorpedoes.value + 1
  remainingTorpedoes.value = restoredRemaining
  submarine?.setTorpedorCount(restoredRemaining)
}

async function uploadTorpedoState(torpedo: TorpedorController, removeIfRejected = false): Promise<boolean> {
  if (!roomId.value || !submarine || isSelfSunk.value || torpedo.isExpired) {
    activeSyncedTorpedoes.delete(torpedo.id)
    return false
  }

  try {
    const result: any = await uploadOnlineTorpedoState({
      RoomID: roomId.value,
      torpedo: {
        modelID: torpedo.id,
        ownerModelID: torpedo.ownerId ?? submarine.id,
        headingDegrees: yawToCompassDegrees(torpedo.heading),
        speedKnots: (torpedo.currentSpeed * SCENE_TO_METERS * 3.6) / 1.852,
        location: {
          x: torpedo.root.position.x,
          z: torpedo.root.position.z,
        },
        depthMeters: torpedo.depth * SCENE_TO_METERS,
        lastUpdateAt: new Date().toISOString(),
      },
    })
    syncTorpedoesRemaining(result)
    applyWorldGameResult(result)

    if (removeIfRejected && shouldRestoreRejectedTorpedo(result)) {
      restoreRejectedTorpedo(torpedo)
      return false
    }
    return true
  } catch (error: any) {
    console.warn('鱼雷状态上传失败。', error)
    if (removeIfRejected) {
      restoreRejectedTorpedo(torpedo)
      return false
    }
    return true
  }
}

function uploadActiveTorpedoes(): void {
  for (const torpedo of activeSyncedTorpedoes.values()) {
    void uploadTorpedoState(torpedo)
  }
}

function handleOnlineCollision(event: CollisionEvent): void {
  const torpedoEntity = event.a.type === 'torpedo' ? event.a : event.b.type === 'torpedo' ? event.b : undefined
  const targetEntity = event.a === torpedoEntity ? event.b : event.a
  if (!torpedoEntity || (targetEntity.type !== 'cargoShip' && targetEntity.type !== 'submarine')) return

  const torpedo = torpedoEntity.controller as TorpedorController
  if (!submarine || torpedo.ownerId !== submarine.id || reportedHitTorpedoes.has(torpedo.id)) return
  if (targetEntity.type === 'submarine' && targetEntity.id === torpedo.ownerId) return

  reportedHitTorpedoes.add(torpedo.id)
  activeSyncedTorpedoes.delete(torpedo.id)
  void reportOnlineTorpedoHit(torpedo, targetEntity.id, targetEntity.type === 'cargoShip' ? 'cargoShip' : 'uBoat')
}

async function reportOnlineTorpedoHit(
  torpedo: TorpedorController,
  targetModelID: string,
  targetType: 'cargoShip' | 'uBoat',
): Promise<void> {
  if (!roomId.value || !submarine) return

  try {
    const result: any = await reportModelHit({
      RoomID: roomId.value,
      attackerModelID: torpedo.ownerId ?? submarine.id,
      targetModelID,
      targetType,
      torpedoModelID: torpedo.id,
      hitTime: new Date().toISOString(),
    })
    applyWorldGameResult(result)
  } catch (error) {
    console.warn('鱼雷命中上报失败。', error)
    reportedHitTorpedoes.delete(torpedo.id)
  }
}

async function ensureCargoShip(cargoState: OnlineCargoShipStateDTO): Promise<CargoShipController | undefined> {
  if (!engine || !entityRegistry) return undefined

  const modelID = getCargoStateModelID(cargoState)
  if (!modelID) return undefined

  const existing = cargoShips.find((item) => item.id === modelID)
  if (existing) return existing

  const creating = cargoShipCreateTasks.get(modelID)
  if (creating) return creating

  const task = CargoShipController.create(engine, {
    id: modelID,
    worldPosition: getCargoStateLocation(cargoState),
    headingDegrees: getCargoStateHeading(cargoState),
    speedKnots: getCargoStateSpeedKnots(cargoState),
    modelUrl: cargoshipUrl,
    entityRegistry,
  })
    .then((ship) => {
      cargoShips.push(ship)
      engine?.addUpdatable(ship)
      hitDetect?.registerCargoShip(ship)
      if (targetDefaultHeight.value <= 0) {
        targetDefaultHeight.value = ship.modelHeight
      }
      return ship
    })
    .catch((error) => {
      console.warn('后端商船模型创建失败。', error)
      return undefined
    })
    .finally(() => {
      cargoShipCreateTasks.delete(modelID)
    })

  cargoShipCreateTasks.set(modelID, task)
  return task
}

async function applyCargoLifecycle(cargoStates: OnlineCargoShipStateDTO[]) {
  for (const [index, cargoState] of cargoStates.entries()) {
    const normalizedCargoState = {
      ...cargoState,
      modelID: getCargoStateModelID(cargoState) || `convoy-${index + 1}`,
      lifecycleState: cargoState.lifecycleState ?? 'active',
      location: getCargoStateLocation(cargoState),
      headingDegrees: getCargoStateHeading(cargoState),
      speedKnots: getCargoStateSpeedKnots(cargoState),
    }
    const ship = await ensureCargoShip(normalizedCargoState)
    if (!ship) continue
    const lifecycleState = normalizedCargoState.lifecycleState

    if ((lifecycleState === 'sinking' || lifecycleState === 'sunk') && !ship.isDestroyed) {
      ship.destroy()
    }

    if (lifecycleState === 'active' && !ship.isDestroyed) {
      const location = getCargoStateLocation(normalizedCargoState)
      ship.root.position.x = THREE.MathUtils.lerp(ship.root.position.x, location.x, 0.18)
      ship.root.position.z = THREE.MathUtils.lerp(ship.root.position.z, location.z, 0.18)
      ship.heading = THREE.MathUtils.degToRad(90 - getCargoStateHeading(normalizedCargoState))
      ship.currentSpeed = (getCargoStateSpeedKnots(normalizedCargoState) * 1852 * (1 / SCENE_TO_METERS)) / 3600
    }
  }
}

function getUBoatStateModelID(uBoatState: Partial<OnlineUBoatStateDTO>): string {
  return String(uBoatState.modelID ?? '')
}

function isOwnUBoatState(uBoatState: Partial<OnlineUBoatStateDTO>): boolean {
  const modelID = getUBoatStateModelID(uBoatState)
  if (submarine?.id && modelID && modelID === submarine.id) return true
  return isSelfUBoatState(uBoatState, { selfUUID: selfUUID.value, selfUBoatID: selfUBoatID.value })
}

async function ensureRemoteSubmarine(
  uBoatState: OnlineUBoatStateDTO,
): Promise<SubmarineController | undefined> {
  if (!engine || !input || !cameraCtrl || !entityRegistry) return undefined

  const modelID = getUBoatStateModelID(uBoatState)
  if (!modelID || isOwnUBoatState(uBoatState)) return undefined

  const existing = remoteSubmarines.get(modelID)
  if (existing) return existing

  const creating = remoteSubmarineCreateTasks.get(modelID)
  if (creating) return creating

  const location = getUBoatStateLocation(uBoatState)
  if (!location) return undefined

  const task = SubmarineController.create(engine, input, cameraCtrl, {
    id: modelID,
    worldPosition: location,
    initialHeadingDegrees: getUBoatStateHeading(uBoatState, 0),
    initialDepthMeters: getUBoatStateDepth(uBoatState, 0),
    isPlayerControlled: false,
    modelUrl: submarineUrl,
    entityRegistry,
  })
    .then((remoteSubmarine) => {
      remoteSubmarines.set(modelID, remoteSubmarine)
      hitDetect?.registerSubmarine(remoteSubmarine)
      return remoteSubmarine
    })
    .catch((error) => {
      console.warn('后端潜艇模型创建失败。', error)
      return undefined
    })
    .finally(() => {
      remoteSubmarineCreateTasks.delete(modelID)
    })

  remoteSubmarineCreateTasks.set(modelID, task)
  return task
}

async function applyRemoteUBoatLifecycle(uBoatStates: OnlineUBoatStateDTO[]) {
  const activeRemoteIDs = new Set<string>()

  for (const uBoatState of uBoatStates) {
    if (isOwnUBoatState(uBoatState)) continue

    const modelID = getUBoatStateModelID(uBoatState)
    if (!modelID) continue
    activeRemoteIDs.add(modelID)

    const remoteSubmarine = await ensureRemoteSubmarine(uBoatState)
    if (!remoteSubmarine) continue

    const lifecycleState = uBoatState.lifecycleState ?? 'active'
    if ((lifecycleState === 'sinking' || lifecycleState === 'sunk') && !remoteSubmarine.isDestroyed) {
      remoteSubmarine.isDestroyed = true
    }

    if (lifecycleState === 'active' && !remoteSubmarine.isDestroyed) {
      const location = getUBoatStateLocation(uBoatState)
      if (location) {
        remoteSubmarine.root.position.x = THREE.MathUtils.lerp(remoteSubmarine.root.position.x, location.x, 0.18)
        remoteSubmarine.root.position.z = THREE.MathUtils.lerp(remoteSubmarine.root.position.z, location.z, 0.18)
      }
      remoteSubmarine.heading = THREE.MathUtils.degToRad(90 - getUBoatStateHeading(uBoatState, remoteSubmarine.compassHeading))
      remoteSubmarine.root.rotation.y = remoteSubmarine.heading
      remoteSubmarine.currentSpeed = Number.isFinite(Number(uBoatState.speedKmh))
        ? Number(uBoatState.speedKmh) / 3.6 / SCENE_TO_METERS
        : 0
      const depthScene = getUBoatStateDepth(uBoatState, remoteSubmarine.depthMeters) / SCENE_TO_METERS
      remoteSubmarine.currentDepth = depthScene
      remoteSubmarine.targetDepth = depthScene
    }
  }

  if (uBoatStates.length === 0) return

  for (const [modelID, remoteSubmarine] of remoteSubmarines) {
    if (activeRemoteIDs.has(modelID)) continue
    hitDetect?.unregister(modelID)
    remoteSubmarine.dispose()
    remoteSubmarines.delete(modelID)
  }
}

function disposeCargoShip(ship: CargoShipController): void {
  engine?.removeUpdatable(ship)
  hitDetect?.unregister(ship.id)
  ship.dispose()
}

function removeCargoShipById(modelID: string): void {
  const ship = cargoShips.find((item) => item.id === modelID)
  if (!ship) return
  disposeCargoShip(ship)
  cargoShips = cargoShips.filter((item) => item.id !== modelID)
}

async function confirmSunkModels() {
  if (!roomId.value) return

  const candidates: Array<{ id: string; type: 'cargoShip' | 'uBoat' }> = cargoShips
    .filter((ship) => ship.isSink)
    .map((ship) => ({ id: ship.id, type: 'cargoShip' as const }))

  if (submarine?.isSink) {
    candidates.push({ id: submarine.id, type: 'uBoat' as const })
  }

  for (const candidate of candidates) {
    if (sunkConfirmingModels.has(candidate.id)) continue
    sunkConfirmingModels.add(candidate.id)
    try {
      await confirmModelSunk({
        RoomID: roomId.value,
        modelID: candidate.id,
        modelType: candidate.type,
        sunkAt: new Date().toISOString(),
      })
      if (candidate.type === 'cargoShip') {
        removeCargoShipById(candidate.id)
      }
    } catch (error) {
      sunkConfirmingModels.delete(candidate.id)
      console.warn('沉底确认上报失败。', error)
    }
  }
}

function applyWorldSettlement(payload: any) {
  const nextSettlement = payload?.settlement ?? payload?.data?.settlement
  if (!nextSettlement) return
  settlement.value = {
    RoomID: nextSettlement.RoomID ?? roomId.value,
    KommandantUUID: nextSettlement.KommandantUUID ?? selfUUID.value,
    cargoShipsSunk: Number(nextSettlement.cargoShipsSunk ?? 0),
    uBoatsSunk: Number(nextSettlement.uBoatsSunk ?? nextSettlement.u_boats_sunk ?? 0),
    totalTonnage: Number(nextSettlement.totalTonnage ?? 0),
  }
}

function applyWorldGameResult(payload: any) {
  const nextGameResult = payload?.gameResult ?? payload?.data?.gameResult
  if (!nextGameResult) return

  gameResult.value = {
    RoomID: String(nextGameResult.RoomID ?? roomId.value),
    state: nextGameResult.state ?? 'playing',
    reason: nextGameResult.reason,
    cargoShipsSunk: Number(nextGameResult.cargoShipsSunk ?? 0),
    totalCargoShips: Number(nextGameResult.totalCargoShips ?? 0),
    sunkRatio: Number(nextGameResult.sunkRatio ?? 0),
  }
}

function getGameResultTitle(result: GameResultDTO): string {
  return result.state === 'victory' ? '任务完成' : '任务失败'
}

function getGameResultReason(result: GameResultDTO): string {
  const reasonLabels: Record<string, string> = {
    cargo_sunk_threshold: '目标吨位已达成',
    cargo_arrived: '商船队已抵达',
    torpedoes_depleted: '全部潜艇鱼雷耗尽',
    all_uboats_sunk: '所有潜艇沉没',
  }
  return result.reason ? reasonLabels[result.reason] ?? result.reason : '战局已结束'
}

async function pollWorldSync(): Promise<boolean> {
  if (!roomId.value) return false
  try {
    const result: any = await getWorldSync(roomId.value)
    return await applyWorldSyncPayload(result)
  } catch (error) {
    console.warn('世界状态轮询失败。', error)
    return false
  }
}

async function createFallbackCargoShips() {
  if (!engine || !entityRegistry || cargoShips.length > 0) return

  const fallbackCargoStates: OnlineCargoShipStateDTO[] = [
    {
      modelID: uuidv4(),
      lifecycleState: 'active',
      location: { x: 750, z: 910 },
      headingDegrees: 160,
      speedKnots: 7,
      depthMeters: 0,
    },
    {
      modelID: uuidv4(),
      lifecycleState: 'active',
      location: { x: 750, z: 1010 },
      headingDegrees: 160,
      speedKnots: 7,
      depthMeters: 0,
    },
    {
      modelID: uuidv4(),
      lifecycleState: 'active',
      location: { x: 950, z: 1150 },
      headingDegrees: 160,
      speedKnots: 7,
      depthMeters: 0,
    },
  ]

  await applyCargoLifecycle(fallbackCargoStates)
}

async function applyWorldSyncPayload(payload: any): Promise<boolean> {
  const cargoStates = normalizeArrayPayload<OnlineCargoShipStateDTO>(payload, ['cargoShips', 'convoy'])
  const uBoatStates = normalizeUBoatStates(payload)
  await applyCargoLifecycle(cargoStates)
  await applyRemoteUBoatLifecycle(uBoatStates)
  applyWorldSettlement(payload)
  applyWorldGameResult(payload)
  syncTorpedoesRemaining(payload)
  worldRevision.value = String(payload?.revision ?? payload?.data?.revision ?? worldRevision.value)
  await confirmSunkModels()
  return cargoStates.length > 0
}

function startOnlinePolling() {
  stopOnlinePolling()
  void pollRoomDetail()
  void uploadSelfState()
  uploadActiveTorpedoes()
  void pollWorldSync()
  uboatUploadTimer = setInterval(() => {
    void uploadSelfState()
    uploadActiveTorpedoes()
  }, 300)
  worldSyncTimer = setInterval(pollWorldSync, 500)
  roomDetailTimer = setInterval(pollRoomDetail, 5000)
}

function stopOnlinePolling() {
  if (uboatUploadTimer) clearInterval(uboatUploadTimer)
  if (worldSyncTimer) clearInterval(worldSyncTimer)
  if (roomDetailTimer) clearInterval(roomDetailTimer)
  uboatUploadTimer = undefined
  worldSyncTimer = undefined
  roomDetailTimer = undefined
  activeSyncedTorpedoes.clear()
  cargoShipCreateTasks.clear()
  remoteSubmarineCreateTasks.clear()
  communicationRef.value?.stopPolling()
}

async function leaveCurrentRoom() {
  if (isLeavingRoom.value) return
  isLeavingRoom.value = true
  stopOnlinePolling()
  try {
    if (roomId.value) {
      await leaveRoom({ RoomID: roomId.value })
    }
  } catch (error) {
    console.warn('退出房间接口失败，本地继续清理。', error)
  } finally {
    localStorage.removeItem('RoomID')
    localStorage.removeItem('RoomMaxPlayers')
    await router.push({ name: 'Room' })
  }
}

function sendLeaveBeacon() {
  if (!roomId.value) return
  const body = new Blob([JSON.stringify({ RoomID: roomId.value })], { type: 'application/json' })
  navigator.sendBeacon?.('/api/room/leave', body)
}


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

  let playAudio = new PlayAudio('/assets/audio/Alarm.wav', ALARM_BUFF_DURATION_SECONDS)
  playAudio.play()

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
        activeSyncedTorpedoes.set(torpedo.id, torpedo)
        const accepted = await uploadTorpedoState(torpedo, true)
        if (accepted) {
          statusPanelRef.value?.markTubesFired([plan.tubeId])
        }
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
  if (!roomId.value) {
    await router.replace({ name: 'Room' })
    return
  }

  const container = viewer.value
  if (!container) return

  window.addEventListener('beforeunload', sendLeaveBeacon)

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

    const initialWorldPayload = await fetchWorldSyncPayload()
    const initialUBoatSpawn = getInitialUBoatSpawn(initialWorldPayload)

    // 潜艇
    //用户操作的潜艇
    submarine = await SubmarineController.create(
      engine,
      input,
      cameraCtrl, {
      id: initialUBoatSpawn.id,
      // coordinateCode: 'AD16',
      worldPosition: initialUBoatSpawn.worldPosition,
      initialHeadingDegrees: initialUBoatSpawn.initialHeadingDegrees,
      initialDepthMeters: initialUBoatSpawn.initialDepthMeters,
      isPlayerControlled: true,
      modelUrl: submarineUrl,
      torpedoModelUrl: torpedoUrl,
      entityRegistry
    })

    if (initialUBoatSpawn.torpedoesRemaining !== undefined) {
      remainingTorpedoes.value = initialUBoatSpawn.torpedoesRemaining
      submarine.setTorpedorCount(initialUBoatSpawn.torpedoesRemaining)
    }

    submarineWorldX.value = submarine.root.position.x
    submarineWorldZ.value = submarine.root.position.z
    headingDegrees.value = submarine.compassHeading
    ownUBoatModelID.value = submarine.id

    // HUD 回调
    submarine.onHudUpdate = (data) => {
      isSelfSunk.value = Boolean(submarine?.isSink)
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
    hitDetect.onCollision = handleOnlineCollision
    hitDetect.registerSubmarine(submarine)
    engine.addUpdatable(hitDetect)

    const hasBackendConvoy = initialWorldPayload
      ? await applyWorldSyncPayload(initialWorldPayload)
      : await pollWorldSync()
    if (!hasBackendConvoy) {
      await createFallbackCargoShips()
    }

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
        for (const remoteSubmarine of remoteSubmarines.values()) {
          remoteSubmarine.setSampledWaterHeight(oceanUpdatable.sampledWaterHeight)
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

    let playAudio = new PlayAudio('/assets/audio/AufGefechstation.wav', 2)
    playAudio.play()

    showHint.value = true
    hintTimer = setTimeout(() => { showHint.value = false }, 5000)
    startOnlinePolling()

  } catch (error) {
    console.error('Failed to load 3D scene:', error)
    loadingError.value = '模型加载失败，请刷新页面重试。'
  }
})

// -------------------- 卸载 --------------------
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', sendLeaveBeacon)
  stopOnlinePolling()
  if (hintTimer) clearTimeout(hintTimer)
  if (noticeTimer) clearTimeout(noticeTimer)
  for (const timer of salvoTimers) clearTimeout(timer)
  salvoTimers.length = 0
  finishAlarmBuff()
  if (hitDetect && engine) {
    engine.removeUpdatable(hitDetect)
    hitDetect.clear()
  }
  submarine?.dispose()
  for (const remoteSubmarine of remoteSubmarines.values()) remoteSubmarine.dispose()
  remoteSubmarines.clear()
  for (const ship of cargoShips) ship.dispose()
  cargoShips = []
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
        <span>ROOM</span>
        <strong>{{ roomId }}</strong>
      </div>
      <el-button type="danger" size="small" :loading="isLeavingRoom" @click="leaveCurrentRoom">
        退出房间
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

    <CommunicationPanel ref="communicationRef" v-if="isLoaded && !isSelfSunk && !finalGameResult" :room-id="roomId"
      :players="onlinePlayers" :self-uuid="selfUUID" />

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

    <div v-if="isSelfSunk && settlement" class="settlement-overlay" role="dialog" aria-modal="true" aria-label="本艇已被击沉">
      <section class="settlement-panel">
        <p>本艇已被击沉</p>
        <h2>本次游戏结算</h2>
        <dl>
          <div>
            <dt>击沉货船数量</dt>
            <dd>{{ settlement.cargoShipsSunk }}</dd>
          </div>
          <div>
            <dt>击沉潜艇数量</dt>
            <dd>{{ settlement.uBoatsSunk }}</dd>
          </div>
          <div>
            <dt>总吨位数</dt>
            <dd>{{ settlement.totalTonnage }}</dd>
          </div>
        </dl>
        <el-button type="primary" :loading="isLeavingRoom" @click="leaveCurrentRoom">
          退出房间
        </el-button>
      </section>
    </div>

    <div v-if="finalGameResult" class="settlement-overlay" role="dialog" aria-modal="true" aria-label="战局结束">
      <section class="settlement-panel">
        <p>战局结束</p>
        <h2>{{ getGameResultTitle(finalGameResult) }}</h2>
        <dl>
          <div>
            <dt>结束原因</dt>
            <dd class="settlement-panel__text">{{ getGameResultReason(finalGameResult) }}</dd>
          </div>
          <div>
            <dt>击沉货船</dt>
            <dd>{{ finalGameResult.cargoShipsSunk }} / {{ finalGameResult.totalCargoShips }}</dd>
          </div>
        </dl>
        <el-button type="primary" :loading="isLeavingRoom" @click="leaveCurrentRoom">
          退出房间
        </el-button>
      </section>
    </div>
  </section>
</template>
