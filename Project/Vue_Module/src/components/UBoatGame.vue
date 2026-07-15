<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import axios from 'axios'

const props = defineProps<{
  uuid: string
  username: string
}>()

const emit = defineEmits<{
  (e: 'logout'): void
}>()

const containerRef = ref<HTMLDivElement | null>(null)
const torpedoCount = ref(14)
const depth = ref(0)
const speed = ref(0)
const heading = ref(0)
const score = ref(0)
const message = ref('')
const receivedMessages = ref<string[]>([])

let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let renderer: THREE.WebGLRenderer
let submarine: THREE.Object3D
let cargoShips: THREE.Object3D[] = []
let torpedoes: THREE.Mesh[] = []
let sun: THREE.Object3D
let ocean: THREE.Object3D
let animationId: number
let lastUpdateTime = 0
let lastWolfpackUpdateTime = 0

const submarineUrl = '/model/type_vii_d_u-boat.glb'
const cargoshipUrl = '/model/liberty_ship.glb'
const torpedoUrl = '/model/mkxii_torpedo.glb'
const sunUrl = '/model/sun.glb'
const oceanUrl = '/model/ocean.glb'

const gameAreaSize = 12150
const loader = new GLTFLoader()

interface Position {
  x: number
  z: number
}

interface ShipInfo {
  id: string
  headingDegrees: number
  speed: number
  location: Position
  depth: number
}

interface CargoshipInfo extends ShipInfo {
  destroyed: boolean
}

interface UBoatInfo extends ShipInfo {
  torpedoCount: number
  username: string
}

let initialPosition: Position = { x: 0, z: 0 }
let initialHeading = 0
let otherPlayers: Map<string, UBoatInfo> = new Map()

const initScene = () => {
  if (!containerRef.value) return

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0a1628)

  camera = new THREE.PerspectiveCamera(60, containerRef.value.clientWidth / containerRef.value.clientHeight, 0.1, 100000)
  
  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(containerRef.value.clientWidth, containerRef.value.clientHeight)
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.shadowMap.enabled = true
  containerRef.value.appendChild(renderer.domElement)

  const ambientLight = new THREE.AmbientLight(0x404040, 0.5)
  scene.add(ambientLight)

  const directionalLight = new THREE.DirectionalLight(0xffffff, 1)
  directionalLight.position.set(1000, 2000, 1000)
  directionalLight.castShadow = true
  scene.add(directionalLight)

  const gridHelper = new THREE.GridHelper(gameAreaSize, 50, 0x444444, 0x222222)
  gridHelper.position.y = 0.1
  scene.add(gridHelper)

  const centerX = gameAreaSize / 2
  const centerZ = gameAreaSize / 2
  const geometry = new THREE.BoxGeometry(gameAreaSize, 2, gameAreaSize)
  const material = new THREE.MeshPhongMaterial({ 
    color: 0x0066aa, 
    transparent: true, 
    opacity: 0.3 
  })
  const seaFloor = new THREE.Mesh(geometry, material)
  seaFloor.position.set(centerX, -1, centerZ)
  seaFloor.receiveShadow = true
  scene.add(seaFloor)
}

const loadModel = async (url: string): Promise<THREE.Object3D> => {
  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => {
      const model = gltf.scene
      model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true
          child.receiveShadow = true
        }
      })
      resolve(model)
    }, undefined, (error) => {
      reject(error)
    })
  })
}

const initGame = async () => {
  try {
    const response = await axios.post('/api/auth/login', { username: props.username })
    const data = response.data
    initialPosition = data.initialPosition
    initialHeading = data.initialHeadingDegrees
    
    const submarineModel = await loadModel(submarineUrl)
    submarine = submarineModel.clone()
    submarine.position.set(initialPosition.x, 0, initialPosition.z)
    submarine.rotation.y = THREE.MathUtils.degToRad(initialHeading)
    scene.add(submarine)

    const oceanModel = await loadModel(oceanUrl)
    ocean = oceanModel.clone()
    ocean.position.set(gameAreaSize / 2, 0, gameAreaSize / 2)
    ocean.scale.set(10, 1, 10)
    scene.add(ocean)

    const sunModel = await loadModel(sunUrl)
    sun = sunModel.clone()
    sun.position.set(gameAreaSize / 2 + 5000, 5000, gameAreaSize / 2 + 5000)
    sun.scale.set(100, 100, 100)
    scene.add(sun)

    const cargoShipModel = await loadModel(cargoshipUrl)
    for (const cargoData of data.convoy) {
      const cargo = cargoShipModel.clone()
      cargo.position.set(cargoData.location.x, cargoData.depth, cargoData.location.z)
      cargo.rotation.y = THREE.MathUtils.degToRad(cargoData.headingDegrees)
      cargo.userData = { id: cargoData.id, destroyed: cargoData.destroyed }
      cargoShips.push(cargo)
      scene.add(cargo)
    }

    updateCamera()
    animate()
    startGameLoop()
    
  } catch (error) {
    console.error('Failed to initialize game:', error)
    message.value = '游戏初始化失败，请刷新页面重试'
  }
}

const updateCamera = () => {
  if (!submarine) return
  
  const offset = new THREE.Vector3(0, 20, 40)
  offset.applyQuaternion(submarine.quaternion)
  camera.position.copy(submarine.position).add(offset)
  camera.lookAt(submarine.position)
}

const animate = () => {
  animationId = requestAnimationFrame(animate)
  
  if (sun) {
    sun.rotation.y += 0.001
  }
  
  for (const torpedo of torpedoes) {
    torpedo.position.x += Math.sin(torpedo.rotation.y) * 0.5
    torpedo.position.z -= Math.cos(torpedo.rotation.y) * 0.5
    torpedo.rotation.z += 0.1
    
    if (torpedo.position.x < 0 || torpedo.position.x > gameAreaSize ||
        torpedo.position.z < 0 || torpedo.position.z > gameAreaSize) {
      scene.remove(torpedo)
    }
  }
  
  torpedoes = torpedoes.filter(t => scene.children.includes(t))
  
  updateCamera()
  renderer.render(scene, camera)
}

const startGameLoop = () => {
  setInterval(() => {
    updateConvoy()
  }, 150)

  setInterval(() => {
    updateWolfpack()
  }, 100)
}

const updateConvoy = async () => {
  try {
    const response = await axios.get('/api/convoy/info')
    const convoyData = response.data.convoy as CargoshipInfo[]
    
    for (const cargoData of convoyData) {
      const cargo = cargoShips.find(c => c.userData.id === cargoData.id)
      if (cargo) {
        cargo.position.set(cargoData.location.x, cargoData.depth, cargoData.location.z)
        cargo.rotation.y = THREE.MathUtils.degToRad(cargoData.headingDegrees)
        cargo.userData.destroyed = cargoData.destroyed
        cargo.visible = !cargoData.destroyed
      }
    }
  } catch (error) {
    console.error('Failed to update convoy:', error)
  }
}

const updateWolfpack = async () => {
  try {
    await axios.post('/api/wolfpack/upload', {
      id: props.uuid,
      headingDegrees: heading.value,
      speed: speed.value,
      location: { x: submarine?.position.x || initialPosition.x, z: submarine?.position.z || initialPosition.z },
      depth: depth.value,
      torpedoCount: torpedoCount.value
    })

    const response = await axios.get('/api/wolfpack/infos')
    const wolfpackData = response.data.wolfpack as UBoatInfo[]
    
    otherPlayers.clear()
    for (const playerData of wolfpackData) {
      if (playerData.id !== props.uuid) {
        otherPlayers.set(playerData.id, playerData)
      }
    }
  } catch (error) {
    console.error('Failed to update wolfpack:', error)
  }
}

const handleKeyDown = (event: KeyboardEvent) => {
  if (!submarine) return
  
  const speedIncrement = 0.5
  const turnIncrement = 2
  
  switch (event.key.toLowerCase()) {
    case 'w':
      speed.value = Math.min(speed.value + speedIncrement, 20)
      break
    case 's':
      speed.value = Math.max(speed.value - speedIncrement, -10)
      break
    case 'a':
      heading.value -= turnIncrement
      break
    case 'd':
      heading.value += turnIncrement
      break
    case 'q':
      depth.value = Math.max(depth.value - 1, 0)
      break
    case 'e':
      depth.value = Math.min(depth.value + 1, 100)
      break
    case ' ':
      fireTorpedo()
      break
  }
  
  submarine.rotation.y = THREE.MathUtils.degToRad(heading.value)
  submarine.position.y = -depth.value
  
  const moveSpeed = speed.value * 0.1
  submarine.position.x += Math.sin(THREE.MathUtils.degToRad(heading.value)) * moveSpeed
  submarine.position.z -= Math.cos(THREE.MathUtils.degToRad(heading.value)) * moveSpeed
  
  submarine.position.x = Math.max(0, Math.min(gameAreaSize, submarine.position.x))
  submarine.position.z = Math.max(0, Math.min(gameAreaSize, submarine.position.z))
}

const fireTorpedo = async () => {
  if (torpedoCount.value <= 0 || !submarine) return
  
  torpedoCount.value--
  
  try {
    const torpedoModel = await loadModel(torpedoUrl)
    const torpedo = torpedoModel.clone()
    torpedo.position.copy(submarine.position)
    torpedo.position.y += 2
    torpedo.rotation.y = submarine.rotation.y
    scene.add(torpedo)
    torpedoes.push(torpedo)
  } catch (error) {
    console.error('Failed to load torpedo:', error)
  }
}

const handleResize = () => {
  if (!containerRef.value || !camera || !renderer) return
  
  camera.aspect = containerRef.value.clientWidth / containerRef.value.clientHeight
  camera.updateProjectionMatrix()
  renderer.setSize(containerRef.value.clientWidth, containerRef.value.clientHeight)
}

const handleLogout = async () => {
  try {
    await axios.post('/api/auth/logout', { uuid: props.uuid })
    emit('logout')
  } catch (error) {
    console.error('Logout failed:', error)
  }
}

onMounted(() => {
  initScene()
  initGame()
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  if (animationId) {
    cancelAnimationFrame(animationId)
  }
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('resize', handleResize)
  if (renderer) {
    renderer.dispose()
  }
})
</script>

<template>
  <div class="game-container">
    <div ref="containerRef" class="game-canvas"></div>
    
    <div class="hud">
      <div class="hud-left">
        <div class="hud-item">
          <span class="label">潜艇</span>
          <span class="value">{{ username }}</span>
        </div>
        <div class="hud-item">
          <span class="label">鱼雷</span>
          <span class="value">{{ torpedoCount }}</span>
        </div>
        <div class="hud-item">
          <span class="label">潜深</span>
          <span class="value">{{ depth }}m</span>
        </div>
      </div>
      
      <div class="hud-center">
        <div class="compass">
          <div class="compass-ring">
            <div class="compass-mark" v-for="i in 12" :key="i" :style="{ transform: `rotate(${i * 30}deg)` }">
              {{ i * 30 }}
            </div>
          </div>
          <div class="compass-needle" :style="{ transform: `rotate(${heading}deg)` }"></div>
        </div>
        <div class="heading-display">
          {{ heading.toFixed(0) }}°
        </div>
      </div>
      
      <div class="hud-right">
        <div class="hud-item">
          <span class="label">航速</span>
          <span class="value">{{ speed.toFixed(1) }} kn</span>
        </div>
        <div class="hud-item">
          <span class="label">击沉</span>
          <span class="value">{{ score }}</span>
        </div>
        <button class="logout-btn" @click="handleLogout">退出</button>
      </div>
    </div>
    
    <div class="controls">
      <div class="control-section">
        <h3>移动</h3>
        <div class="key-hint">W/↑ 加速 | S/↓ 减速 | A/← 左转 | D/→ 右转</div>
      </div>
      <div class="control-section">
        <h3>潜深</h3>
        <div class="key-hint">Q 上浮 | E 下潜</div>
      </div>
      <div class="control-section">
        <h3>武器</h3>
        <div class="key-hint">空格 发射鱼雷</div>
      </div>
    </div>
    
    <div v-if="message" class="message-popup">{{ message }}</div>
  </div>
</template>

<style scoped>
.game-container {
  width: 100%;
  height: 100%;
  position: relative;
}

.game-canvas {
  width: 100%;
  height: 100%;
}

.hud {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  padding: 20px;
  display: flex;
  justify-content: space-between;
  pointer-events: none;
}

.hud-left, .hud-right {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.hud-item {
  background: rgba(10, 22, 40, 0.8);
  backdrop-filter: blur(5px);
  border: 1px solid rgba(100, 150, 255, 0.3);
  border-radius: 8px;
  padding: 10px 15px;
  display: flex;
  justify-content: space-between;
  min-width: 120px;
}

.label {
  color: #8892a6;
  font-size: 0.9rem;
}

.value {
  color: #6496ff;
  font-weight: bold;
  font-size: 1.1rem;
}

.hud-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.compass {
  width: 120px;
  height: 120px;
  background: rgba(10, 22, 40, 0.8);
  border: 2px solid rgba(100, 150, 255, 0.5);
  border-radius: 50%;
  position: relative;
}

.compass-ring {
  width: 100%;
  height: 100%;
  position: absolute;
}

.compass-mark {
  position: absolute;
  top: 5px;
  left: 50%;
  transform-origin: 50% 55px;
  color: #6496ff;
  font-size: 0.7rem;
  width: 20px;
  text-align: center;
  margin-left: -10px;
}

.compass-needle {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 4px;
  height: 50px;
  background: linear-gradient(to bottom, #ff6b6b, #cc5555);
  transform-origin: center bottom;
  margin-left: -2px;
  margin-top: -50px;
  border-radius: 2px;
}

.heading-display {
  background: rgba(10, 22, 40, 0.8);
  border: 1px solid rgba(100, 150, 255, 0.3);
  border-radius: 8px;
  padding: 8px 20px;
  color: #6496ff;
  font-size: 1.5rem;
  font-weight: bold;
}

.logout-btn {
  background: rgba(255, 107, 107, 0.2);
  border: 1px solid rgba(255, 107, 107, 0.5);
  border-radius: 8px;
  padding: 10px 20px;
  color: #ff6b6b;
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.3s ease;
  pointer-events: auto;
}

.logout-btn:hover {
  background: rgba(255, 107, 107, 0.3);
}

.controls {
  position: absolute;
  bottom: 20px;
  left: 20px;
  background: rgba(10, 22, 40, 0.8);
  backdrop-filter: blur(5px);
  border: 1px solid rgba(100, 150, 255, 0.3);
  border-radius: 10px;
  padding: 15px;
  display: flex;
  gap: 30px;
}

.control-section h3 {
  color: #6496ff;
  font-size: 0.9rem;
  margin-bottom: 5px;
}

.key-hint {
  color: #8892a6;
  font-size: 0.8rem;
}

.message-popup {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(255, 107, 107, 0.9);
  border: 1px solid #ff6b6b;
  border-radius: 10px;
  padding: 20px 40px;
  color: white;
  font-size: 1.2rem;
  z-index: 100;
}
</style>