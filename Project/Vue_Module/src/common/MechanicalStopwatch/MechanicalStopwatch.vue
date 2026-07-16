<script setup lang="ts">
import { onMounted } from 'vue';
import {
  mechanicalStopwatchAssets,
  useMechanicalStopwatch,
} from './MechanicalStopwatch'

const {
  rootElement,
  isButtonHovered,
  minutePointerStyle,
  secondPointerStyle,
  handleClick,
  handleDoubleClick,
  handlePointerLeave,
  handlePointerMove,
} = useMechanicalStopwatch()
</script>

<template>
  <div
    ref="rootElement"
    class="mechanical-stopwatch"
    aria-label="机械秒表"
    @click="handleClick"
    @dblclick="handleDoubleClick"
    @pointermove="handlePointerMove"
    @pointerleave="handlePointerLeave"
  >
    <img
      class="mechanical-stopwatch__layer"
      :src="mechanicalStopwatchAssets.background"
      alt=""
      draggable="false"
    />
    <img
      v-show="isButtonHovered"
      class="mechanical-stopwatch__overlay"
      :src="mechanicalStopwatchAssets.buttonIndicator"
      alt=""
      draggable="false"
    />
    <img
      class="mechanical-stopwatch__pointer mechanical-stopwatch__pointer--minute"
      :src="mechanicalStopwatchAssets.pointer"
      alt=""
      draggable="false"
      :style="minutePointerStyle"
    />
    <img
      class="mechanical-stopwatch__pointer mechanical-stopwatch__pointer--second"
      :src="mechanicalStopwatchAssets.pointer"
      alt=""
      draggable="false"
      :style="secondPointerStyle"
    />
  </div>
</template>

<style scoped>
.mechanical-stopwatch {
  position: relative;
  width: min(100%, 520px);
  aspect-ratio: 1000 / 1310;
  user-select: none;
  -webkit-user-select: none;
  touch-action: manipulation;
}

.mechanical-stopwatch__layer,
.mechanical-stopwatch__overlay,
.mechanical-stopwatch__pointer {
  display: block;
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
}

.mechanical-stopwatch__layer,
.mechanical-stopwatch__overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.mechanical-stopwatch__layer {
  position: relative;
  z-index: 1;
}

.mechanical-stopwatch__overlay {
  z-index: 2;
}

.mechanical-stopwatch__pointer {
  position: absolute;
  z-index: 3;
  height: auto;
  will-change: transform;
}

.mechanical-stopwatch__pointer--minute {
  z-index: 3;
}

.mechanical-stopwatch__pointer--second {
  z-index: 4;
}
</style>
