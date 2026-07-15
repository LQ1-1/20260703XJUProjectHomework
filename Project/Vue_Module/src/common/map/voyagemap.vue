<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { MapRender, type VoyageTrackPoint } from './maprender'
import '../../css/voyage-map.css'

const SAMPLE_INTERVAL_MS = 30_000
const DEFAULT_CENTER = { x: 0, z: 0 }

const props = defineProps<{
  submarineWorldX: number
  submarineWorldZ: number
  headingDegrees: number
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const isFullscreen = ref(false)
const isFollowingSubmarine = ref(true)
const trackPoints = ref<VoyageTrackPoint[]>([])

let renderer: MapRender | null = null
let resizeObserver: ResizeObserver | null = null
let sampleTimer: ReturnType<typeof setInterval> | null = null
let isDragging = false
let lastPointerX = 0
let lastPointerY = 0

const rootClass = computed(() => ({
  'voyage-map': true,
  'voyage-map--fullscreen': isFullscreen.value,
}))

function currentTrackPoint(): VoyageTrackPoint {
  return {
    x: props.submarineWorldX,
    z: props.submarineWorldZ,
    headingDegrees: props.headingDegrees,
    sampledAt: Date.now(),
  }
}

function renderMap(): void {
  renderer?.render(trackPoints.value)
}

function sampleCurrentPosition(): void {
  const point = currentTrackPoint()
  trackPoints.value.push(point)

  if (isFollowingSubmarine.value) {
    renderer?.setCenter(point)
  }

  renderMap()
}

function ensureInitialSample(): void {
  if (trackPoints.value.length > 0) return
  sampleCurrentPosition()
}

function recenterOnSubmarine(): void {
  ensureInitialSample()
  const latest = trackPoints.value.at(-1)
  if (!latest) return

  isFollowingSubmarine.value = true
  renderer?.setCenter(latest)
  renderMap()
}

function toggleFullscreen(): void {
  isFullscreen.value = !isFullscreen.value
  nextTick(() => {
    renderer?.resize()
    renderMap()
  })
}

function exitFullscreen(): void {
  isFullscreen.value = false
  nextTick(() => {
    renderer?.resize()
    renderMap()
  })
}

function handleWheel(event: WheelEvent): void {
  event.preventDefault()
  event.stopPropagation()
  renderer?.zoomBy(event.deltaY)
  renderMap()
}

function handlePointerDown(event: PointerEvent): void {
  event.preventDefault()
  event.stopPropagation()
  if (event.button !== 0) return

  isDragging = true
  isFollowingSubmarine.value = false
  lastPointerX = event.clientX
  lastPointerY = event.clientY
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
}

function handlePointerMove(event: PointerEvent): void {
  event.preventDefault()
  event.stopPropagation()
  if (!isDragging) return

  const deltaX = event.clientX - lastPointerX
  const deltaY = event.clientY - lastPointerY
  lastPointerX = event.clientX
  lastPointerY = event.clientY
  renderer?.panByPixels(deltaX, deltaY)
  renderMap()
}

function finishPointerDrag(event: PointerEvent): void {
  event.preventDefault()
  event.stopPropagation()
  if (!isDragging) return

  isDragging = false
  ;(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId)
}

onMounted(() => {
  if (!canvasRef.value) return

  renderer = new MapRender({ canvas: canvasRef.value })
  renderer.setCenter(DEFAULT_CENTER)
  ensureInitialSample()

  resizeObserver = new ResizeObserver(() => {
    renderer?.resize()
    renderMap()
  })
  resizeObserver.observe(canvasRef.value)

  sampleTimer = setInterval(sampleCurrentPosition, SAMPLE_INTERVAL_MS)
})

watch(
  () => [props.submarineWorldX, props.submarineWorldZ, props.headingDegrees],
  () => {
    ensureInitialSample()
  },
)

onBeforeUnmount(() => {
  if (sampleTimer) clearInterval(sampleTimer)
  resizeObserver?.disconnect()
  renderer?.dispose()
  renderer = null
})
</script>

<template>
  <aside :class="rootClass" aria-label="航海地图" @wheel="handleWheel">
    <div
      class="voyage-map__surface"
      @pointerdown="handlePointerDown"
      @pointermove="handlePointerMove"
      @pointerup="finishPointerDrag"
      @pointercancel="finishPointerDrag"
      @pointerleave="finishPointerDrag"
    >
      <canvas ref="canvasRef" aria-hidden="true"></canvas>
    </div>

    <div class="voyage-map__tools" @pointerdown.stop @wheel.stop.prevent>
      <button type="button" title="回到潜艇" aria-label="回到潜艇" @click="recenterOnSubmarine">
        ⌖
      </button>
      <button
        v-if="!isFullscreen"
        type="button"
        title="全屏展示"
        aria-label="全屏展示"
        @click="toggleFullscreen"
      >
        ⛶
      </button>
      <button
        v-else
        type="button"
        title="退出全屏"
        aria-label="退出全屏"
        @click="exitFullscreen"
      >
        ×
      </button>
    </div>
  </aside>
</template>
