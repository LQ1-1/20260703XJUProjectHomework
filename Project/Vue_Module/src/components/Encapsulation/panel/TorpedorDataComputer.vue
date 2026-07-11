<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { TorpedoFireControlComputerParameter } from '../../../common/calculator/calculator'
import { normalizeDegrees } from '../modules/navigationMath'
import {
  TORPEDO_MAX_LIFETIME_G7A,
  TORPEDO_MAX_LIFETIME_G7E,
  TORPEDO_SPEED_G7A,
  TORPEDO_SPEED_G7E,
  type TorpedoType,
} from '../torpedor/TorpedorController'
import type { TorpedoLaunchPlan, TorpedoTubeState } from '../torpedor/torpedoTypes'

interface TubeBinding {
  torpedoType: TorpedoType
  baseHeadingDegrees: number
  finalDepthMeters: number
  spreadDegrees: number
  interceptAngleDegrees: number
  timeSeconds: number
  isOutOfRange: boolean
}

interface Tube {
  id: number
  selected: boolean
  isLoaded: boolean
  reloadEndTime: number | null
  binding: TubeBinding | null
}

const props = defineProps<{
  headingDegrees: number
  currentDepthMeters: number
  remainingTorpedoes: number
}>()

const AOB_MIN = -180
const AOB_MAX = 180
const RELOAD_SECONDS = 60

const torpedoOptions: { label: string; value: TorpedoType; speed: number; maxLifetime: number }[] = [
  { label: 'G7e 30节', value: 'G7e', speed: TORPEDO_SPEED_G7E, maxLifetime: TORPEDO_MAX_LIFETIME_G7E },
  { label: 'G7a 44节', value: 'G7a', speed: TORPEDO_SPEED_G7A, maxLifetime: TORPEDO_MAX_LIFETIME_G7A },
]

const aob = ref<number | null>(0)
const targetDistance = ref<number | null>(null)
const targetSpeedKnots = ref<number | null>(0)
const torpedoType = ref<TorpedoType>('G7e')
const finalDepthMeters = ref<number | null>(0)
const spreadDegrees = ref<number | null>(0)
const message = ref('')
const now = ref(Date.now())

const tubes = ref<Tube[]>([1, 2, 3, 4].map((id) => ({
  id,
  selected: false,
  isLoaded: true,
  reloadEndTime: null,
  binding: null,
})))

const boundTubeSummary = computed(() => tubes.value
  .filter((tube) => tube.binding)
  .map((tube) => `${tube.id}号 ${tube.binding?.isOutOfRange ? '已装订/射程外' : '已装订'}`)
  .join(' | '))

const firstBinding = computed(() => tubes.value.find((tube) => tube.binding)?.binding ?? null)

watch(
  () => props.currentDepthMeters,
  (depth) => {
    if (finalDepthMeters.value === null || finalDepthMeters.value === undefined) {
      finalDepthMeters.value = depth
    }
  },
)

const timer = window.setInterval(() => {
  now.value = Date.now()
  for (const tube of tubes.value) {
    if (tube.reloadEndTime !== null && tube.reloadEndTime <= now.value) {
      tube.reloadEndTime = null
      tube.isLoaded = props.remainingTorpedoes > 0
    }
  }
}, 1000)

onBeforeUnmount(() => {
  window.clearInterval(timer)
})

function knotsToSceneSpeed(knots: number): number {
  return (knots * 1852 * (22 / 77)) / 3600
}

function numberIsInRange(value: number | null, min: number, max?: number): value is number {
  if (value === null || value === undefined || !Number.isFinite(value)) return false
  if (value < min) return false
  return max === undefined || value <= max
}

function signForAob(value: number): number {
  return value < 0 ? -1 : 1
}

function selectedTorpedoConfig() {
  return torpedoOptions.find((option) => option.value === torpedoType.value) ?? torpedoOptions[0]!
}

function validateInputs(): string | null {
  if (!numberIsInRange(aob.value, AOB_MIN, AOB_MAX)) return 'AOB 必须在 -180 到 180 之间'
  if (!numberIsInRange(targetDistance.value, 0.000001)) return '目标距离必须大于 0'
  if (!numberIsInRange(targetSpeedKnots.value, 0)) return '目标航速必须大于等于 0'
  if (!numberIsInRange(finalDepthMeters.value, 0)) return '最终深度必须大于等于 0'
  if (!numberIsInRange(spreadDegrees.value, 0)) return '散射值必须大于等于 0'
  return null
}

function calculateBinding(): TubeBinding | null {
  const validationMessage = validateInputs()
  if (validationMessage) {
    message.value = validationMessage
    return null
  }

  const validAob = aob.value!
  const validTargetDistance = targetDistance.value!
  const validTargetSpeedKnots = targetSpeedKnots.value!
  const validFinalDepthMeters = finalDepthMeters.value!
  const validSpreadDegrees = spreadDegrees.value!
  const config = selectedTorpedoConfig()
  const targetSpeed = knotsToSceneSpeed(validTargetSpeedKnots)
  const computer = new TorpedoFireControlComputerParameter(
    validAob,
    validTargetDistance,
    targetSpeed,
    config.speed,
  )
  const timeSeconds = computer.getTime()
  const interceptAngleDegrees = computer.getInterceptAngel()

  if (
    !Number.isFinite(timeSeconds) ||
    timeSeconds < 0 ||
    !Number.isFinite(interceptAngleDegrees)
  ) {
    message.value = '弹道无效'
    return null
  }

  const baseHeadingDegrees = normalizeDegrees(
    props.headingDegrees + interceptAngleDegrees * signForAob(validAob),
  )

  return {
    torpedoType: torpedoType.value,
    baseHeadingDegrees,
    finalDepthMeters: validFinalDepthMeters,
    spreadDegrees: validSpreadDegrees,
    interceptAngleDegrees,
    timeSeconds,
    isOutOfRange: timeSeconds > config.maxLifetime,
  }
}

function selectedAvailableTubes(): Tube[] {
  return tubes.value.filter((tube) => tube.selected && tube.isLoaded && tube.reloadEndTime === null)
}

function bindSelectedTubes(): void {
  const selectedTubes = selectedAvailableTubes()
  if (selectedTubes.length === 0) {
    message.value = '请选择可用发射管'
    return
  }

  const binding = calculateBinding()
  if (!binding) return

  for (const tube of selectedTubes) {
    tube.binding = { ...binding }
  }

  const timeLabel = `预计时间 ${binding.timeSeconds.toFixed(1)}s`
  message.value = binding.isOutOfRange
    ? `目标超出射程，已装订，${timeLabel}`
    : `弹道已装订，${timeLabel}`
}

function clearSelectedBindings(): void {
  const selectedTubes = tubes.value.filter((tube) => tube.selected)
  if (selectedTubes.length === 0) {
    message.value = '请选择发射管'
    return
  }

  for (const tube of selectedTubes) {
    tube.binding = null
  }
  message.value = '已取消所选发射管装订'
}

function spreadOffsets(count: number, spread: number): number[] {
  if (count <= 1) return [0]
  const start = -((count - 1) / 2) * spread
  return Array.from({ length: count }, (_, index) => start + index * spread)
}

function getSelectedLaunchPlans(): TorpedoLaunchPlan[] {
  const readyTubes = tubes.value
    .filter((tube) => tube.selected && tube.isLoaded && tube.reloadEndTime === null && tube.binding)
    .sort((left, right) => left.id - right.id)

  if (readyTubes.length === 0) return []

  const spread = readyTubes[0]?.binding?.spreadDegrees ?? 0
  const offsets = spreadOffsets(readyTubes.length, spread)

  return readyTubes.map((tube, index) => ({
    tubeId: tube.id,
    torpedoType: tube.binding!.torpedoType,
    headingDegrees: normalizeDegrees(tube.binding!.baseHeadingDegrees + (offsets[index] ?? 0)),
    finalDepthMeters: tube.binding!.finalDepthMeters,
    isOutOfRange: tube.binding!.isOutOfRange,
  }))
}

function markTubesFired(tubeIds: number[]): void {
  const firedIds = new Set(tubeIds)
  const reloadEndTime = Date.now() + RELOAD_SECONDS * 1000

  for (const tube of tubes.value) {
    if (!firedIds.has(tube.id)) continue
    tube.selected = false
    tube.binding = null
    tube.isLoaded = false
    tube.reloadEndTime = reloadEndTime
  }
}

function setTargetDistance(distance: number): void {
  if (!Number.isFinite(distance) || distance <= 0) {
    message.value = '目标距离必须大于 0'
    return
  }
  targetDistance.value = distance
  message.value = '目标距离已填入'
}

function getTubeStates(): TorpedoTubeState[] {
  return tubes.value.map((tube) => ({
    id: tube.id,
    selected: tube.selected,
    isLoaded: tube.isLoaded,
    isReloading: tube.reloadEndTime !== null,
    reloadRemainingSeconds: reloadRemainingSeconds(tube),
    hasBinding: tube.binding !== null,
    isOutOfRange: tube.binding?.isOutOfRange ?? false,
  }))
}

function reloadRemainingSeconds(tube: Tube): number {
  if (tube.reloadEndTime === null) return 0
  return Math.max(0, Math.ceil((tube.reloadEndTime - now.value) / 1000))
}

function tubeDisabled(tube: Tube): boolean {
  if (tube.reloadEndTime !== null) return true
  return !tube.isLoaded
}

function tubeStatus(tube: Tube): string {
  if (tube.reloadEndTime !== null) return `装填中 ${reloadRemainingSeconds(tube)}s`
  if (!tube.isLoaded) return '无备用鱼雷'
  if (tube.binding?.isOutOfRange) return '已装订/射程外'
  if (tube.binding) return '已装订'
  return '可用'
}

defineExpose({
  getSelectedLaunchPlans,
  markTubesFired,
  setTargetDistance,
  getTubeStates,
})
</script>

<template>
  <section class="computer-panel torpedo-data-computer" aria-label="鱼雷弹道计算机">
    <header class="computer-panel__header">
      <h3>鱼雷弹道计算机</h3>
      <span>剩余鱼雷：{{ remainingTorpedoes }}</span>
    </header>

    <div class="computer-grid">
      <label>
        AOB
        <input v-model.number="aob" type="number" min="-180" max="180" step="0.1" />
      </label>
      <label>
        目标距离
        <input v-model.number="targetDistance" type="number" min="0" step="0.1" />
      </label>
      <label>
        目标航速 节
        <input v-model.number="targetSpeedKnots" type="number" min="0" step="0.1" />
      </label>
      <label>
        鱼雷型号
        <select v-model="torpedoType">
          <option v-for="option in torpedoOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>
      <label>
        最终深度 m
        <input v-model.number="finalDepthMeters" type="number" min="0" step="0.1" />
      </label>
      <label>
        散射值
        <input v-model.number="spreadDegrees" type="number" min="0" step="0.1" />
      </label>
    </div>

    <fieldset class="tube-list">
      <legend>鱼雷发射管</legend>
      <label v-for="tube in tubes" :key="tube.id" class="tube-option">
        <input
          v-model="tube.selected"
          type="checkbox"
          :disabled="tubeDisabled(tube)"
        />
        <span>{{ tube.id }}号</span>
        <small>{{ tubeStatus(tube) }}</small>
      </label>
    </fieldset>

    <div class="computer-actions">
      <button type="button" @click="bindSelectedTubes">装订弹道</button>
      <button type="button" @click="clearSelectedBindings">取消装订</button>
    </div>

    <dl class="computer-readout">
      <div>
        <dt>截击角</dt>
        <dd>{{ firstBinding?.interceptAngleDegrees.toFixed(1) ?? '--' }}</dd>
      </div>
      <div>
        <dt>发射航向</dt>
        <dd>{{ firstBinding?.baseHeadingDegrees.toFixed(0).padStart(3, '0') ?? '--' }}</dd>
      </div>
      <div>
        <dt>预计时间</dt>
        <dd>{{ firstBinding ? `${firstBinding.timeSeconds.toFixed(1)}s` : '--' }}</dd>
      </div>
    </dl>

    <p v-if="boundTubeSummary" class="computer-summary">{{ boundTubeSummary }}</p>
    <p v-if="message" class="computer-message">{{ message }}</p>
  </section>
</template>
