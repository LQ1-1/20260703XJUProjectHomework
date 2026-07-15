<script setup lang="ts">
import { ref, onMounted } from 'vue'
import UBoatGame from './components/UBoatGame.vue'
import LoginPanel from './components/LoginPanel.vue'

const isLoggedIn = ref(false)
const playerUUID = ref('')
const playerName = ref('')

const handleLogin = (uuid: string, username: string) => {
  playerUUID.value = uuid
  playerName.value = username
  isLoggedIn.value = true
}

const handleLogout = () => {
  isLoggedIn.value = false
  playerUUID.value = ''
  playerName.value = ''
}

onMounted(() => {})
</script>

<template>
  <div class="app-container">
    <LoginPanel v-if="!isLoggedIn" @login="handleLogin" />
    <UBoatGame 
      v-else 
      :uuid="playerUUID" 
      :username="playerName" 
      @logout="handleLogout" 
    />
  </div>
</template>

<style scoped>
.app-container {
  width: 100%;
  height: 100%;
}
</style>