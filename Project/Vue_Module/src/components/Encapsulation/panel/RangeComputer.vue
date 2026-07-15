<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RangeComputer as RangeCalculator } from '../../../common/calculator/calculator'

const props = defineProps<{
  defaultTargetHeight: number
}>()

const emit = defineEmits<{
  'use-distance': [distance: number]
}>()

const milReading = ref<number | null>(null)
const targetRealHeight = ref<number | null>(props.defaultTargetHeight)
const message = ref('')

watch(
  () => props.defaultTargetHeight,
  (height) => {
    if (
      Number.isFinite(height) &&
      height > 0 &&
      (targetRealHeight.value === null || targetRealHeight.value === undefined)
    ) {
      targetRealHeight.value = height
    }
  },
)

const distance = computed(() => {
  if (
    milReading.value === null ||
    targetRealHeight.value === null ||
    !Number.isFinite(milReading.value) ||
    !Number.isFinite(targetRealHeight.value) ||
    milReading.value <= 0 ||
    targetRealHeight.value <= 0
  ) {
    return NaN
  }

  return new RangeCalculator(milReading.value, targetRealHeight.value).getDistance()
})

function validate(): string | null {
  if (milReading.value === null || !Number.isFinite(milReading.value) || milReading.value <= 0) {
    return '目标密位读数必须大于 0'
  }
  if (
    targetRealHeight.value === null ||
    !Number.isFinite(targetRealHeight.value) ||
    targetRealHeight.value <= 0
  ) {
    return '目标真实高度必须大于 0'
  }
  if (!Number.isFinite(distance.value) || distance.value <= 0) {
    return '测距结果无效'
  }
  return null
}

function useDistance(): void {
  const validationMessage = validate()
  if (validationMessage) {
    message.value = validationMessage
    return
  }
  emit('use-distance', distance.value)
  message.value = '已填入鱼雷距离'
}
</script>

<template>
  <section class="computer-panel range-computer" aria-label="测距计算机">
    <header class="computer-panel__header">
      <h3>测距计算机</h3>
    </header>

    <div class="computer-grid">
      <label>
        目标密位读数
        <input v-model.number="milReading" type="number" min="0" step="0.1" />
      </label>
      <label>
        目标真实高度
        <input v-model.number="targetRealHeight" type="number" min="0" step="0.1" />
      </label>
    </div>

    <dl class="computer-readout">
      <div>
        <dt>目标距离</dt>
        <dd>{{ Number.isFinite(distance) ? distance.toFixed(1) : '--' }}</dd>
      </div>
    </dl>

    <div class="computer-actions">
      <button type="button" @click="useDistance">填入鱼雷距离</button>
    </div>

    <p v-if="message" class="computer-message">{{ message }}</p>
  </section>
</template>
