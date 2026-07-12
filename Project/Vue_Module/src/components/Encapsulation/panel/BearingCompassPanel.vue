<script setup lang="ts">
import { computed } from 'vue'
import '../../../css/bearing-compass-panel.css'

const marineCompassUrl = '/assets/Bearing Dial/MarineCompass_0.png'
const relativeBearingDialUrl = '/assets/Bearing Dial/RelativeBearingDial_0.png'
const hullIndicatorUrl = '/assets/Bearing Dial/hullIndicator.png'

const props = defineProps<{
  headingDegrees: number
  periscopeRelativeBearingDegrees: number
}>()

const headingLabel = computed(() =>
  Math.round(props.headingDegrees).toString().padStart(3, '0'),
)
const relativeBearingLabel = computed(() =>
  `${props.periscopeRelativeBearingDegrees >= 0 ? '+' : '-'}${Math.abs(
    Math.round(props.periscopeRelativeBearingDegrees),
  ).toString().padStart(3, '0')}`,
)
const hullIndicatorStyle = computed(() => ({
  transform: `translate(-55.8%, -52.2%) rotate(${props.headingDegrees}deg)`,
}))
const periscopeArrowStyle = computed(() => ({
  transform: `translate(-50%, -100%) rotate(${props.periscopeRelativeBearingDegrees}deg)`,
}))
</script>

<template>
  <section class="bearing-compass-panel" aria-label="航向与相对方位">
    <article class="bearing-gauge">
      <div class="bearing-dial" aria-hidden="true">
        <img class="bearing-dial-image" :src="marineCompassUrl" alt="" draggable="false" />
        <img
          class="hull-indicator"
          :src="hullIndicatorUrl"
          alt=""
          draggable="false"
          :style="hullIndicatorStyle"
        />
      </div>
      <p class="bearing-readout"><span>HDG（绝对方位）</span>{{ headingLabel }}°</p>
    </article>

    <article class="bearing-gauge">
      <div class="bearing-dial" aria-hidden="true">
        <img class="bearing-dial-image" :src="relativeBearingDialUrl" alt="" draggable="false" />
        <span class="periscope-relative-arrow" :style="periscopeArrowStyle"></span>
      </div>
      <p class="bearing-readout"><span>REL（相对方位）</span>{{ relativeBearingLabel }}°</p>
    </article>
  </section>
</template>
