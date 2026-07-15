<script setup lang="ts">
import { ref } from 'vue'
import axios from 'axios'

const emit = defineEmits<{
  (e: 'login', uuid: string, username: string): void
}>()

const username = ref('')
const isLoading = ref(false)
const error = ref('')

const handleLogin = async () => {
  if (!username.value.trim()) {
    error.value = '请输入用户名'
    return
  }
  
  isLoading.value = true
  error.value = ''
  
  try {
    const response = await axios.post('/api/auth/login', {
      username: username.value.trim()
    })
    
    emit('login', response.data.uuid, response.data.username)
  } catch (err) {
    error.value = '登录失败，请重试'
    console.error('Login error:', err)
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <div class="login-panel">
    <div class="login-container">
      <h1 class="title">U-Boat Wolfpack</h1>
      <p class="subtitle">狼群战术模拟</p>
      
      <div class="input-group">
        <label for="username">用户名</label>
        <input 
          id="username"
          v-model="username"
          type="text" 
          placeholder="输入你的潜艇名称"
          @keyup.enter="handleLogin"
        />
      </div>
      
      <div v-if="error" class="error-message">{{ error }}</div>
      
      <button 
        class="login-btn" 
        :disabled="isLoading"
        @click="handleLogin"
      >
        <span v-if="isLoading" class="loading">正在进入战斗...</span>
        <span v-else>加入狼群</span>
      </button>
      
      <div class="info">
        <p>游戏区域：12150 x 12150 单位</p>
        <p>目标：击沉敌方商船队</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-panel {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #0a1628 0%, #1a2a4a 50%, #0a1628 100%);
  position: relative;
  overflow: hidden;
}

.login-panel::before {
  content: '';
  position: absolute;
  width: 100%;
  height: 100%;
  background-image: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.03'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
}

.login-container {
  position: relative;
  z-index: 1;
  background: rgba(10, 22, 40, 0.8);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(100, 150, 255, 0.2);
  border-radius: 20px;
  padding: 40px;
  width: 100%;
  max-width: 400px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
}

.title {
  font-size: 2.5rem;
  font-weight: bold;
  text-align: center;
  color: #6496ff;
  margin-bottom: 10px;
  text-shadow: 0 0 20px rgba(100, 150, 255, 0.5);
}

.subtitle {
  text-align: center;
  color: #8892a6;
  margin-bottom: 30px;
}

.input-group {
  margin-bottom: 20px;
}

.input-group label {
  display: block;
  color: #8892a6;
  margin-bottom: 8px;
  font-size: 0.9rem;
}

.input-group input {
  width: 100%;
  padding: 12px 16px;
  border: 1px solid rgba(100, 150, 255, 0.3);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.05);
  color: #ffffff;
  font-size: 1rem;
  outline: none;
  transition: all 0.3s ease;
}

.input-group input:focus {
  border-color: #6496ff;
  background: rgba(255, 255, 255, 0.1);
  box-shadow: 0 0 15px rgba(100, 150, 255, 0.3);
}

.input-group input::placeholder {
  color: #4a5568;
}

.error-message {
  color: #ff6b6b;
  font-size: 0.9rem;
  margin-bottom: 15px;
  text-align: center;
}

.login-btn {
  width: 100%;
  padding: 14px;
  background: linear-gradient(135deg, #6496ff 0%, #4a77ff 100%);
  border: none;
  border-radius: 10px;
  color: #ffffff;
  font-size: 1.1rem;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.3s ease;
}

.login-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 5px 20px rgba(100, 150, 255, 0.4);
}

.login-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.loading::after {
  content: '';
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #ffffff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.info {
  margin-top: 20px;
  text-align: center;
  color: #6b7280;
  font-size: 0.8rem;
}

.info p {
  margin-bottom: 5px;
}
</style>