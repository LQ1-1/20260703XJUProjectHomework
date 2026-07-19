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
import { SpriteNodeMaterial } from 'three/webgpu'

//鱼雷弹道数据对象
interface TubeBinding {
  torpedoType: TorpedoType
  baseHeadingDegrees: number
  targetRelativeBearingDegrees: number
  finalDepthMeters: number
  spreadDegrees: number
  interceptAngleDegrees: number
  timeSeconds: number
  isOutOfRange: boolean
}

//鱼雷发射管对象
interface Tube {
  id: number
  selected: boolean
  isLoaded: boolean
  reloadEndTime: number | null
  binding: TubeBinding | null
}

//绑定数据
const props = defineProps<{
  headingDegrees: number  //本艇的航向
  periscopeRelativeBearingDegrees: number   //目标相对方位
  currentDepthMeters: number  //本艇潜深
  remainingTorpedoes: number  //剩余潜数量
}>()

const AOB_MIN = -180
const AOB_MAX = 180
const RELATIVE_BEARING_MIN = -180
const RELATIVE_BEARING_MAX = 180
const RELOAD_SECONDS = 60
const RELOAD_MS = RELOAD_SECONDS * 1000

//鱼雷类型----G7a, G7e
const torpedoOptions: { label: string; value: TorpedoType; speed: number; maxLifetime: number }[] = [
  { label: 'G7e 30节', value: 'G7e', speed: TORPEDO_SPEED_G7E, maxLifetime: TORPEDO_MAX_LIFETIME_G7E },
  { label: 'G7a 44节', value: 'G7a', speed: TORPEDO_SPEED_G7A, maxLifetime: TORPEDO_MAX_LIFETIME_G7A },
]

const aob = ref<number | null>(0)
const targetRelativeBearingDegrees = ref<number | null>(0)
const targetDistance = ref<number | null>(null)
const targetSpeedKnots = ref<number | null>(0)
const torpedoType = ref<TorpedoType>('G7e')
const finalDepthMeters = ref<number | null>(0)  //定深
const spreadDegrees = ref<number | null>(0) //散射角
const message = ref('') //提示消息
const now = ref(Date.now()) //当前时间

//鱼雷发射管
const tubes = ref<Tube[]>([1, 2, 3, 4].map((id) => ({
  id, //鱼雷模型编号
  selected: false, 
  isLoaded: true,
  reloadEndTime: null,
  binding: null,  //绑定鱼雷模型，TubeBinding类型
})))

const boundTubeSummary = computed(() => tubes.value
  .filter((tube) => tube.binding)   //只有已经装订数据的发射管才会进入下一步
  .map((tube) => `${tube.id}号 ${tube.binding?.isOutOfRange ? '已装订/射程外' : '已装订'}`) //把每个已装订数据的发射管转成一段文字
  .join(' | ')) //将多段文字拼接起来


//绑定第一个发射管已经装订的数据
const firstBinding = computed(() => tubes.value.find((tube) => tube.binding)?.binding ?? null)
//找一个弹道数据不为空的发射管然后读取发射数据

//监听当前深度变化
watch(
  () => props.currentDepthMeters, //监听从父组件传进来的currentMeters
  (depth) => {  //props.currentDepthMeters发生变化时，执行这个函数更新深度值
    if (finalDepthMeters.value === null || finalDepthMeters.value === undefined) {
      finalDepthMeters.value = depth
    }
  },
)

//监听目标相对方位（潜望镜瞄准的方向）
watch(
  () => props.periscopeRelativeBearingDegrees,
  (bearing) => {
    if (!Number.isFinite(bearing)) return
    targetRelativeBearingDegrees.value = bearing
  },
  { immediate: true },
)

//设置装填时间
const timer = window.setInterval(() => {
  now.value = Date.now()
  for (const tube of tubes.value) {
    if (tube.reloadEndTime !== null && tube.reloadEndTime <= now.value) {
      tube.reloadEndTime = null
      tube.isLoaded = props.remainingTorpedoes > 0
    }
  }
}, 1000)

//监听从父组件传了的剩余鱼雷数
watch(
  () => props.remainingTorpedoes,
  (remaining) => {
    for (const tube of tubes.value) {
      if (tube.reloadEndTime === null) {
        tube.isLoaded = remaining > 0
      }
    }
  },
)

//该组件销毁要被销毁时停止装填计时
onBeforeUnmount(() => {
  window.clearInterval(timer)
})//小机制，关闭鱼雷弹道计算加再快速开启即可立刻将鱼雷装填完成

function knotsToSceneSpeed(knots: number): number {
  return knots * 0.5144 * (22 / 77)
}//nautical mile => scene speed


//判断输入的参数是否有效，相对方位是-180～180。
function numberIsInRange(value: number | null, min: number, max?: number): value is number {
  if (value === null || value === undefined || !Number.isFinite(value)) return false
  if (value < min) return false
  return max === undefined || value <= max
}

function signForAob(value: number): number {
  return value < 0 ? -1 : 1
}//左舷为负，右舷为正
//AOB为正，潜艇在目标右舷，偏移角度（拦截角度）的符号为正
//AOB为负，潜艇在目标左舷，偏移角度（拦截角度）的符号为正

//将角度转换成带正负号，三位正数的字符串
//目标方位
function formatSignedDegrees(value: number): string {
  return `${value >= 0 ? '+' : '-'}${Math.abs(Math.round(value)).toString().padStart(3, '0')}`
}//四舍五入, 位数不够就在前面补0

//根据当前的鱼雷类型从torpedoOptions里找对应的配置
function selectedTorpedoConfig() {
  //找到了就返回用户选择的鱼雷类型，没有则默认使用第一个
  return torpedoOptions.find((option) => option.value === torpedoType.value) ?? torpedoOptions[0]!
}

//检查输入是否有效
function validateInputs(): string | null {
  if (!numberIsInRange(aob.value, AOB_MIN, AOB_MAX)) return 'AOB 必须在 -180 到 180 之间'
  if (!numberIsInRange(targetRelativeBearingDegrees.value, RELATIVE_BEARING_MIN, RELATIVE_BEARING_MAX)) {
    return '目标相对方位必须在 -180 到 180 之间'
  }
  if (!numberIsInRange(targetDistance.value, 0.000001)) return '目标距离必须大于 0'
  if (!numberIsInRange(targetSpeedKnots.value, 0)) return '目标航速必须大于等于 0'
  if (!numberIsInRange(finalDepthMeters.value, 0)) return '最终深度必须大于等于 0'
  if (!numberIsInRange(spreadDegrees.value, 0)) return '散射值必须大于等于 0'
  return null
}

//计算绑定
function calculateBinding(): TubeBinding | null {
  const validationMessage = validateInputs()
  if (validationMessage) {
    message.value = validationMessage
    return null
  }

  const validAob = aob.value!   //AOB（艇长计算）                      //非空断言
  const validTargetRelativeBearingDegrees = targetRelativeBearingDegrees.value! //目标相对方位
  const validTargetDistance = targetDistance.value! //目标距离（艇长计算）
  const validTargetSpeedKnots = targetSpeedKnots.value! //目标航速（艇长计算）
  const validFinalDepthMeters = finalDepthMeters.value! //鱼雷定深（Lauftiefe）
  const validSpreadDegrees = spreadDegrees.value! //散射角 Streuwinkel
  const config = selectedTorpedoConfig()  //选择的发射管
  const targetSpeed = knotsToSceneSpeed(validTargetSpeedKnots)  //将目标航速转换成游戏速度
  

  //调用鱼雷弹道计算类
  const computer = new TorpedoFireControlComputerParameter(
    validAob,
    validTargetDistance,
    targetSpeed,  //目标速度（游戏单位）
    config.speed, //鱼雷速度（游戏单位）
  )
  const timeSeconds = computer.getTime()  //命中时间
  const interceptAngleDegrees = computer.getInterceptAngel()  //偏移角度（拦截角度）

  //判断弹道是否有效
  if (
    !Number.isFinite(timeSeconds) ||
    timeSeconds < 0 ||
    !Number.isFinite(interceptAngleDegrees)
  ) {
    message.value = '弹道无效'
    return null
  }

  //鱼雷最终航向
  const baseHeadingDegrees = normalizeDegrees(
    props.headingDegrees +
      validTargetRelativeBearingDegrees +
      interceptAngleDegrees * signForAob(validAob),   
  )
  /*
  目标绝对方位=本艇的航向+目标相对方位（带符号）

  提前量的正负和AOB角有关，
  AOB为负说明潜艇在目标左舷，鱼雷航向=目标的绝对方位-提前量
  AOB为正说明潜艇在目标的右舷，鱼雷航向=目标绝对方位+提前量
  */

  return {
    torpedoType: torpedoType.value,
    baseHeadingDegrees,
    targetRelativeBearingDegrees: validTargetRelativeBearingDegrees,
    finalDepthMeters: validFinalDepthMeters,
    spreadDegrees: validSpreadDegrees,
    interceptAngleDegrees,
    timeSeconds,
    isOutOfRange: timeSeconds > config.maxLifetime,
  }
}

//选择可用的发射管（装填完毕的）
function selectedAvailableTubes(): Tube[] {
  return tubes.value.filter((tube) => tube.selected && tube.isLoaded && tube.reloadEndTime === null)
}//返回Tube对象数组

//装订发射数据
function bindSelectedTubes(): void {
  const selectedTubes = selectedAvailableTubes()
  if (selectedTubes.length === 0) {
    message.value = '请选择可用发射管'
    return
  }

  //绑定弹道数据
  const binding = calculateBinding()
  if (!binding) return

  for (const tube of selectedTubes) {
    tube.binding = { ...binding }//展开运算符把binding 对象的所有属性‘摊开’到一个新的空对象里面
  }//鱼雷弹道计算机算出来的航向信息在这里存入每个鱼雷管的binding里面

  const timeLabel = `预计时间 ${binding.timeSeconds.toFixed(1)}s`
  message.value = binding.isOutOfRange
    ? `目标超出射程，已装订，${timeLabel}`
    : `弹道已装订，${timeLabel}`
}

//取消装订
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

//散射角计算，参数：鱼雷数，散射角
function spreadOffsets(count: number, spread: number): number[] {
  // if (count <= 1) return [0]
  // const start = -((count - 1) / 2) * spread
  // return Array.from({ length: count }, (_, index) => start + index * spread)
  if(count % 2 ==1){
    let center = Math.floor(count / 2)
    let res: Array<number> = []
    for(let i=0;i<count;i++){
      let offset = (i-center)*spread
      res.push(offset)
    } 
    return res
  }else{
    let res: Array<number> = []
    let begin=(count/2)*-1*spread //首项是(count/2)*spread, 公差是spread
    let addition = spread / 2 //给每个数再加上一个相对中心的偏移量
    for(let i=0;i<count;i++){
      let offset = begin+spread*i+addition
      res.push(offset)
    }
    return res;
  }
}//返回每条鱼雷应该相对于中心线偏转的角度

//生成鱼雷发射计划
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
    headingDegrees: normalizeDegrees(tube.binding!.baseHeadingDegrees + (offsets[index] ?? 0)), //给鱼雷航向添加偏转量
    finalDepthMeters: tube.binding!.finalDepthMeters,
    isOutOfRange: tube.binding!.isOutOfRange,
  }))
}

//标记发射管已经开火
function markTubesFired(tubeIds: number[]): void {
  const firedIds = new Set(tubeIds)
  const currentTime = Date.now()
  const queuedReloadEndTimes = tubes.value
    .map((tube) => tube.reloadEndTime ?? 0)
    .filter((reloadEndTime) => reloadEndTime > currentTime)
  const firedTubes = tubes.value
    .filter((tube) => firedIds.has(tube.id))
    .sort((left, right) => left.id - right.id)
  let nextReloadEndTime = Math.max(
    currentTime,
    ...queuedReloadEndTimes,
  )

  for (const tube of firedTubes) {
    nextReloadEndTime += RELOAD_MS
    tube.selected = false
    tube.binding = null
    tube.isLoaded = false
    tube.reloadEndTime = nextReloadEndTime
  }
}

//填入目标距离
function setTargetDistance(distance: number): void {
  if (!Number.isFinite(distance) || distance <= 0) {
    message.value = '目标距离必须大于 0'
    return
  }
  targetDistance.value = distance
  message.value = '目标距离已填入'
}

//填入AOB角度
function setAOB(aobValue: number): void {
  aob.value = aobValue
  message.value = 'AOB已填入'
}

//获取发射管状态
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
  setAOB,
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
        目标相对方位
        <input v-model.number="targetRelativeBearingDegrees" type="number" min="-180" max="180" step="0.1" />
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
        鱼雷定深 m
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
        <dt>目标相对方位</dt>
        <dd>{{ firstBinding ? formatSignedDegrees(firstBinding.targetRelativeBearingDegrees) : '--' }}</dd>
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
