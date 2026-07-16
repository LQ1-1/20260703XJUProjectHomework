import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PlayAudio from '../audiotool/PlayAudio'

export const SECOND_POINTER_SCALE = 1
export const MINUTE_POINTER_SCALE = 0.48

const ASSET_BASE = '/assets/MechanicalStopwatch'
const STOPWATCH_WIDTH = 1000
const STOPWATCH_HEIGHT = 1310
const ALPHA_HIT_THRESHOLD = 16
const BUTTON_NOISE_CUTOFF_Y = 380
const SINGLE_CLICK_DELAY_MS = 220
const SECONDS_PER_FULL_TURN = 60
const MINUTES_PER_FULL_TURN = 60

const playMechanicalSoundEffect = ref(false)
const playAudio = new PlayAudio('/assets/audio/TickdaTickda.wav', 20)

type ImagePoint = {
  x: number
  y: number
}

type PointerPlacement = {
  left: string
  top: string
  width: string
  transformOrigin: string
  transform: string
}

type AlphaMask = {
  width: number
  height: number
  alpha: Uint8ClampedArray
}

export const mechanicalStopwatchAssets = {
  background: `${ASSET_BASE}/MechanicalStopwatch.png`,
  buttonMask: `${ASSET_BASE}/MechanicalStopwatch_button.png`,
  buttonIndicator: `${ASSET_BASE}/MechanicalStopwatch_button_MouseIndicator.png`,
  pointer: `${ASSET_BASE}/Pointer.png`,
}

const secondDialCenter: ImagePoint = { x: 493, y: 807 }
const minuteDialCenter: ImagePoint = { x: 492, y: 977 }
const pointerRotateCenter: ImagePoint = { x: 32, y: 319 }
const pointerNaturalSize = {
  width: 66,
  height: 489,
}

const toPercent = (value: number, total: number) => `${(value / total) * 100}%`

const createPointerPlacement = (
  center: ImagePoint,
  scale: number,
  rotationDegrees: number,
): PointerPlacement => {
  const scaledWidth = pointerNaturalSize.width * scale
  const scaledHeight = pointerNaturalSize.height * scale
  const pivotX = pointerRotateCenter.x * scale
  const pivotY = pointerRotateCenter.y * scale

  return {
    left: toPercent(center.x - pivotX, STOPWATCH_WIDTH),
    top: toPercent(center.y - pivotY, STOPWATCH_HEIGHT),
    width: toPercent(scaledWidth, STOPWATCH_WIDTH),
    transformOrigin: `${(pivotX / scaledWidth) * 100}% ${(pivotY / scaledHeight) * 100}%`,
    transform: `rotate(${rotationDegrees}deg)`,
  }
}

const loadAlphaMask = (src: string): Promise<AlphaMask> =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight

      const context = canvas.getContext('2d')
      if (!context) {
        reject(new Error('Canvas 2D context is not available.'))
        return
      }

      context.drawImage(image, 0, 0)
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
      const alpha = new Uint8ClampedArray(canvas.width * canvas.height)

      for (let index = 0; index < alpha.length; index += 1) {
        alpha[index] = imageData.data[index * 4 + 3] ?? 0
      }

      resolve({
        width: canvas.width,
        height: canvas.height,
        alpha,
      })
    }
    image.onerror = () => reject(new Error(`Failed to load image: ${src}`))
    image.src = src
  })

export const useMechanicalStopwatch = () => {
  const rootElement = ref<HTMLElement | null>(null)
  const isButtonHovered = ref(false)
  const isRunning = ref(false)
  const elapsedMs = ref(0)
  const nowMs = ref(0)

  let buttonMask: AlphaMask | null = null
  let startedAtMs = 0
  let animationFrameId = 0
  let singleClickTimer: number | undefined

  const currentElapsedMs = computed(() =>
    isRunning.value ? elapsedMs.value + Math.max(0, nowMs.value - startedAtMs) : elapsedMs.value,
  )

  const secondRotationDegrees = computed(
    () => ((currentElapsedMs.value / 1000) % SECONDS_PER_FULL_TURN) * 6,
  )
  const minuteRotationDegrees = computed(
    () => ((currentElapsedMs.value / 60000) % MINUTES_PER_FULL_TURN) * 6,
  )

  const secondPointerStyle = computed(() =>
    createPointerPlacement(secondDialCenter, SECOND_POINTER_SCALE, secondRotationDegrees.value),
  )
  const minutePointerStyle = computed(() =>
    createPointerPlacement(minuteDialCenter, MINUTE_POINTER_SCALE, minuteRotationDegrees.value),
  )

  const updateFrame = (timestamp: number) => {
    nowMs.value = timestamp
    animationFrameId = window.requestAnimationFrame(updateFrame)
  }

  const start = () => {
    if (isRunning.value) {
      return
    }

    startedAtMs = performance.now()
    nowMs.value = startedAtMs
    isRunning.value = true
  }

  const stop = () => {
    if (!isRunning.value) {
      return
    }

    elapsedMs.value += Math.max(0, performance.now() - startedAtMs)
    isRunning.value = false
  }

  const toggle = () => {
    if (isRunning.value) {
      stop()
      playMechanicalSoundEffect.value = false
      return
    }

    start()
    playMechanicalSoundEffect.value = true
  }

  const reset = () => {
    if (isRunning.value) {
      return
    }

    elapsedMs.value = 0
    nowMs.value = performance.now()
  }

  const clearSingleClickTimer = () => {
    if (singleClickTimer === undefined) {
      return
    }

    window.clearTimeout(singleClickTimer)
    singleClickTimer = undefined
  }

  const getImagePointFromPointerEvent = (event: PointerEvent | MouseEvent): ImagePoint | null => {
    const element = rootElement.value
    if (!element) {
      return null
    }

    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      return null
    }

    return {
      x: ((event.clientX - rect.left) / rect.width) * STOPWATCH_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * STOPWATCH_HEIGHT,
    }
  }

  const isButtonPoint = (point: ImagePoint | null) => {
    if (!point || !buttonMask) {
      return false
    }

    const x = Math.floor(point.x)
    const y = Math.floor(point.y)
    if (x < 0 || y < 0 || x >= buttonMask.width || y >= buttonMask.height) {
      return false
    }

    if (y > BUTTON_NOISE_CUTOFF_Y) {
      return false
    }

    return (buttonMask.alpha[y * buttonMask.width + x] ?? 0) > ALPHA_HIT_THRESHOLD
  }

  const handlePointerMove = (event: PointerEvent) => {
    isButtonHovered.value = isButtonPoint(getImagePointFromPointerEvent(event))
  }

  const handlePointerLeave = () => {
    isButtonHovered.value = false
  }

  const handleClick = (event: MouseEvent) => {
    if (event.button !== 0 || !isButtonPoint(getImagePointFromPointerEvent(event))) {
      return
    }

    clearSingleClickTimer()
    singleClickTimer = window.setTimeout(() => {
      toggle()
      singleClickTimer = undefined
    }, SINGLE_CLICK_DELAY_MS)
  }

  const handleDoubleClick = (event: MouseEvent) => {
    if (event.button !== 0 || !isButtonPoint(getImagePointFromPointerEvent(event))) {
      return
    }

    clearSingleClickTimer()
    reset()
  }



  onMounted(async () => {
    animationFrameId = window.requestAnimationFrame(updateFrame)
    buttonMask = await loadAlphaMask(mechanicalStopwatchAssets.buttonMask)

    watch(playMechanicalSoundEffect, (isPlaying) => {
      if (isPlaying) {
        void (async () => {
          while (playMechanicalSoundEffect.value) {
            await playAudio.play()
          }
        })()
      } else {
        playAudio.stop()
      }
    })
  })

  onBeforeUnmount(() => {
    window.cancelAnimationFrame(animationFrameId)
    clearSingleClickTimer()
  })

  return {
    rootElement,
    isButtonHovered,
    isRunning,
    minutePointerStyle,
    secondPointerStyle,
    handleClick,
    handleDoubleClick,
    handlePointerLeave,
    handlePointerMove,
  }
}
