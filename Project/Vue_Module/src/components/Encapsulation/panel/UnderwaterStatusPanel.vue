<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import BearingCompassPanel from './BearingCompassPanel.vue'
import RangeComputer from './RangeComputer.vue'
import TorpedorDataComputer from './TorpedorDataComputer.vue'
import { headingStringToDegrees } from '../modules/navigationMath.ts'
import type { TorpedoLaunchPlan, TorpedoTubeState } from '../torpedor/torpedoTypes'
import '../../../css/underwater-status-panel.css'

// -------------------- 航速选项 --------------------
interface SpeedOption {
  label: string
  value: number
}

const SPEED_OPTIONS: SpeedOption[] = [
  { label: '最大出力（Äusserste Kraft / A.K.）', value: 1 },
  { label: '全速前进（Große Fahrt / G.F.）', value: 0.9 },
  { label: '半速前进（Halbe Fahrt / H.F.）', value: 0.75 },
  { label: '慢速前进（Langsame Fahrt / L.F.）', value: 0.5 },
  { label: '微速前进（Kleine Fahrt / K.F.）', value: 0.25 },
  { label: '停车（Stopp）', value: 0 },
  { label: '微速后退（Kleine Fahrt zurück）', value: -0.25 },
  { label: '慢速后退（Langsame Fahrt zurück）', value: -0.5 },
  { label: '半速退（Halbe Fahrt zurück）', value: -0.75 },
  { label: '全速后退（Äusserste Kraft zurück）', value: -1 },
]

/** fraction → 显示标签 */
function speedFractionToLabel(fraction: number): string {
  return SPEED_OPTIONS.find((o) => o.value === fraction)?.label ?? '停车（Stopp）'
}

// -------------------- 航向选项 --------------------
function buildHeadingOptions(): { label: string; value: string }[] {
  const opts: { label: string; value: string }[] = []
  for (let deg = 0; deg <= 360; deg += 5) {
    const label = deg.toString().padStart(3, '0') + '°'
    opts.push({ label, value: label })
  }
  return opts
}

const HEADING_OPTIONS = buildHeadingOptions()

/** 将实际航向圆整到最近的 5° */
function roundToNearest5(degrees: number): number {
  return Math.round(degrees / 5) * 5
}

function degreesToHeadingString(degrees: number): string {
  return roundToNearest5(degrees).toString().padStart(3, '0') + '°'
}

// -------------------- Props --------------------
const props = defineProps<{
  mode: 'full' | 'compact'
  depthMeters: number
  speedKnots: number
  headingDegrees: number
  periscopeRelativeBearingDegrees: number
  navigationState: string

  submarineWorldX: number
  submarineWorldZ: number
  targetDefaultHeight: number
  remainingTorpedoes: number
  /** 外部（Q/E 键）同步的航速指令，null 时不覆盖下拉选择 */
  commandedSpeedFraction?: number | null
}>()

// -------------------- Emits --------------------
const emit = defineEmits<{
  'speed-command': [fraction: number]
  'heading-command': [headingString: string]
}>()

// -------------------- 内部状态 --------------------
const selectedSpeedFraction = ref(0)
const selectedHeadingString = ref(degreesToHeadingString(props.headingDegrees))
const showTorpedoComputer = ref(false)
const showRangeComputer = ref(false)
const torpedoComputerRef = ref<InstanceType<typeof TorpedorDataComputer> | null>(null)

// 选择变更时通知外部
watch(selectedSpeedFraction, (val) => emit('speed-command', val))
watch(selectedHeadingString, (val) => emit('heading-command', val))

// Q/E 键外部变更 → 同步下拉显示
watch(
  () => props.commandedSpeedFraction,
  (val) => {
    if (val !== null && val !== undefined && val !== selectedSpeedFraction.value) {
      selectedSpeedFraction.value = val
    }
  },
)

// -------------------- 计算属性 --------------------
const selectedHeadingDegrees = computed(() =>
  headingStringToDegrees(selectedHeadingString.value),
)

// -------------------- 暴露接口 --------------------
defineExpose({
  /** 获取当前选择的航速 fraction（-1 到 1） */
  getSelectedSpeedFraction: () => selectedSpeedFraction.value,
  /** 获取当前选择的航速显示文本 */
  getSelectedSpeedLabel: () => speedFractionToLabel(selectedSpeedFraction.value),
  /** 获取当前选择航向的数字度数（0–360） */
  getSelectedHeadingDegrees: () => selectedHeadingDegrees.value,
  /** 获取当前选择航向的字符串（如 "045°"） */
  getSelectedHeadingString: () => selectedHeadingString.value,
  /** 重置：停车 + 同步航向到给定值 */
  reset(headingDegrees: number) {
    selectedSpeedFraction.value = 0
    selectedHeadingString.value = degreesToHeadingString(headingDegrees)
  },
  getSelectedLaunchPlans: (): TorpedoLaunchPlan[] =>
    torpedoComputerRef.value?.getSelectedLaunchPlans() ?? [],
  markTubesFired: (tubeIds: number[]) => torpedoComputerRef.value?.markTubesFired(tubeIds),
  setTorpedoTargetDistance: (distance: number) =>
    torpedoComputerRef.value?.setTargetDistance(distance),
  getTubeStates: (): TorpedoTubeState[] => torpedoComputerRef.value?.getTubeStates() ?? [],
})

function handleUseRangeDistance(distance: number): void {
  torpedoComputerRef.value?.setTargetDistance(distance)
  showTorpedoComputer.value = true
}
</script>

<template>
  <!-- 以侧边栏的形式 -->
  <aside class="underwater-status" :class="`underwater-status--${mode}`" aria-label="航行信息">
    <dl class="instrument-strip">
      <div>
        <dt>潜深</dt>
        <dd>{{ depthMeters.toFixed(1) }} m</dd>
      </div>
      <div>
        <dt>航速</dt>
        <dd>{{ speedKnots.toFixed(1) }} kn</dd>
        <select v-model="selectedSpeedFraction" class="instrument-select" aria-label="航速指令">
          <option v-for="opt in SPEED_OPTIONS" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </div>
      <div>
        <dt>航向</dt>
        <dd>{{ headingDegrees.toFixed(0).padStart(3, '0') }}°</dd>
        <select v-model="selectedHeadingString" class="instrument-select" aria-label="航向指令">
          <option v-for="opt in HEADING_OPTIONS" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </div>
      <div>
        <dt>状态</dt>
        <dd>{{ navigationState }}</dd>
      </div>
      <div>
        <dt>世界坐标-测试使用</dt>
        <dd>坐标:{{ submarineWorldX.toFixed(1) }},{{ submarineWorldZ.toFixed(1) }}</dd>
      </div>
      <div>
        <dt>鱼雷</dt>
        <dd>剩余鱼雷：{{ remainingTorpedoes }}</dd>
      </div>
    </dl>

    <div class="computer-switches" aria-label="计算机开关">
      <fieldset>
        <legend>是否打开测距计算机</legend>
        <label>
          <input v-model="showRangeComputer" type="radio" :value="true" />
          true
        </label>
        <label>
          <input v-model="showRangeComputer" type="radio" :value="false" />
          false
        </label>
      </fieldset>
      <fieldset>
        <legend>是否打开鱼雷弹道计算机</legend>
        <label>
          <input v-model="showTorpedoComputer" type="radio" :value="true" />
          true
        </label>
        <label>
          <input v-model="showTorpedoComputer" type="radio" :value="false" />
          false
        </label>
      </fieldset>
    </div>

    <div v-if="showTorpedoComputer || showRangeComputer" class="computer-stack">
      
      <RangeComputer v-if="showRangeComputer" :default-target-height="targetDefaultHeight"
        @use-distance="handleUseRangeDistance" />

      <TorpedorDataComputer v-if="showTorpedoComputer" ref="torpedoComputerRef" :heading-degrees="headingDegrees"
        :periscope-relative-bearing-degrees="periscopeRelativeBearingDegrees"
        :current-depth-meters="depthMeters" :remaining-torpedoes="remainingTorpedoes" />
    </div>

    <BearingCompassPanel :heading-degrees="headingDegrees"
      :periscope-relative-bearing-degrees="periscopeRelativeBearingDegrees" />
  </aside>
</template>
