<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PlayAudio from '@/common/audiotool/PlayAudio.ts'
import '../../../css/mode.css'


const router = useRouter()
const route = useRoute()
const hasEnteredModeSelect = ref(false)

let backgroundMusic: PlayAudio | undefined

function startModeSelect(): void {
  if (hasEnteredModeSelect.value) return

  hasEnteredModeSelect.value = true
  backgroundMusic = new PlayAudio('/assets/audio/DasBoat2.wav', 116)
  void backgroundMusic.loopTheAudio(true)
}

onBeforeUnmount(() => {
  backgroundMusic?.stop()
  backgroundMusic = undefined
})

function enterOnlineMode() {
  router.push({
    name: 'Login',
    query: route.query,
  })
}

function enterOfflineMode() {
  router.push({
    name: 'UboatGame_Offline',
    query: route.query,
  })
}
</script>

<template>
  <main class="mode-container" @pointerdown.self="startModeSelect">
    <section v-if="!hasEnteredModeSelect" class="mode-card mode-card--start" aria-label="开始游戏" @pointerdown="startModeSelect">
      <header class="mode-header">
        <p>U-BOOT COMMAND</p>
        <h1>点击开始</h1>
      </header>
    </section>

    <section v-else class="mode-card" aria-label="游戏模式选择">
      <header class="mode-header">
        <p>U-BOOT COMMAND</p>
        <h1>选择作战模式</h1>
      </header>

      <div class="mode-actions">
        <button class="mode-option mode-option--online" type="button" @click="enterOnlineMode">
          <span>ONLINE</span>
          <strong>联机模式</strong>
        </button>

        <button class="mode-option mode-option--offline" type="button" @click="enterOfflineMode">
          <span>OFFLINE</span>
          <strong>离线模式</strong>
        </button>
      </div>
    </section>
  </main>
</template>
