<script setup lang="ts">
import '../../../css/top-right-panel.css'

const props = defineProps<{
  isAlarmActive: boolean
  alarmRemainingSeconds: number
}>()

const emit = defineEmits<{
  alarm: []
}>()
</script>

<template>
  <aside class="top-right-panel" aria-label="紧急控制面板">
    <section class="top-right-panel__section top-right-panel__section--alarm">
      <button
        class="top-right-panel__alarm-button"
        type="button"
        :disabled="props.isAlarmActive"
        @click="emit('alarm')"
      >
        {{ props.isAlarmActive ? `ALARM ${props.alarmRemainingSeconds}s` : 'ALARM' }}
      </button>
    </section>

    <section class="top-right-panel__section top-right-panel__section--stopwatch" aria-hidden="true"></section>
  </aside>
</template>
