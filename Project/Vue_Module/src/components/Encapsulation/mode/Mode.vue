<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import '../../../css/mode.css'

const router = useRouter()
const route = useRoute()

function enterOnlineMode() {
  router.push({
    name: 'UboatGame_Online',
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
  <main class="mode-container">
    <section class="mode-card" aria-label="游戏模式选择">
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
