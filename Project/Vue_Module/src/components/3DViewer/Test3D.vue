<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import oceanUrl from '../../model/ocean.glb?url'    //海洋动画模型导入
import submarineUrl from '../../model/type_vii_d_u-boat.glb?url'    //u艇模型导入

const viewer = ref<HTMLDivElement | null>(null)     //Three.js的画布容器
const loadingProgress = ref(0)      //加载百分比
const loadingError = ref('')        //加载错误信息
const isLoaded = ref(false)         //检查模型是否完成加载
const showHint = ref(false)         //是否显示鼠标操作提示

const loadingLabel = computed(() => `${Math.round(loadingProgress.value)}%`)//将数值转成35%这样的字符串,用来显示加载进度

//射线检测对象
const raycaster=new THREE.Raycaster()   //射线检测器
const rayOrigin=new THREE.Vector3()     //射线起点
const downDirection=new THREE.Vector3(0,-1,0);  //垂直向下方向，参数对应X, Y, Z轴

const oceanMeshes: THREE.Mesh[]=[] //海洋模型中的所有网格

let renderer: THREE.WebGLRenderer | undefined   //用于将场景绘制到Canvas
let scene: THREE.Scene | undefined  //整个3D世界
let camera: THREE.PerspectiveCamera | undefined     //观察场景的相机
let controls: OrbitControls | undefined     //相机控制器
let oceanMixer: THREE.AnimationMixer | undefined    //用于播放海浪动画
let submarineObject: THREE.Object3D | undefined     //潜艇模型的应用
let resizeObserver: ResizeObserver | undefined      
let animationFrame = 0
let hintTimer: ReturnType<typeof setTimeout> | undefined
let submarineBaseY = 0  //潜艇最初设置的深度
let targetSubmarineY = 0    //射线计算后的目标高度
let lastWaterSampleTime = 0     //上一次检测到海面高度的时间

const resources: THREE.Object3D[] = []
const fileProgress = new Map<string, { loaded: number; total: number }>()
let previousFrameTime = 0

//分别记录潜艇和海洋的加载数据的进度
function updateLoadingProgress(url: string, event: ProgressEvent<EventTarget>) {
  fileProgress.set(url, {
    loaded: event.loaded,
    total: event.lengthComputable ? event.total : event.loaded,
  })

  let loaded = 0
  let total = 0
  for (const progress of fileProgress.values()) {
    loaded += progress.loaded
    total += progress.total
  }

  if (total > 0) {
    loadingProgress.value = Math.min(99, (loaded / total) * 100)
  }
}

//调整海洋尺寸和位置
function normalizeOcean(ocean: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(ocean) //一个正好包住整个模型的长方体
  const size = box.getSize(new THREE.Vector3())
  const horizontalSize = Math.max(size.x, size.z)   //获取水平尺寸

  if (horizontalSize > 0) {
    ocean.scale.multiplyScalar(150 / horizontalSize) //将海洋最大水平边缩放到150个场景单位
  }

  const normalizedBox = new THREE.Box3().setFromObject(ocean)   //加载海洋后，先计算包围盒
  const center = normalizedBox.getCenter(new THREE.Vector3())
  ocean.position.x -= center.x  //重新计算缩放后的包围盒，并将海洋水平居中
  ocean.position.z -= center.z 
  ocean.position.y -= normalizedBox.max.y   //将海面最高点放到y=0
}


//调整海洋材质
function tuneOceanMaterials(ocean: THREE.Object3D) {
  ocean.traverse((child) => {   //遍历海洋模型的所有子对象
    if (!(child instanceof THREE.Mesh)) return  //如果子对象是网格，就修改它的材质
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue
      material.color.set(0x17688a)  //设置颜色
      material.roughness = 0.32 //设置水面反光的模糊程度
      material.metalness = 0.03 //设置金属感
      material.envMapIntensity = 0.7    //设置环境反射强度
      material.needsUpdate = true   //通知Three.js重新处理材质
    }
  })

    ocean.traverse((child)=>{
        if(child instanceof THREE.Mesh){
            oceanMeshes.push(child)
        }
    })
}

function sampleWaterHeight(time: number) {
  if (!submarineObject || oceanMeshes.length === 0 || time - lastWaterSampleTime < 250) {
    return
  }
  lastWaterSampleTime = time

  submarineObject.getWorldPosition(rayOrigin)
  rayOrigin.y += 20
  raycaster.set(rayOrigin, downDirection)

  // 海洋包含大量 Morph Target，所以降低射线检测频率，再用逐帧插值平滑移动。
  const hit = raycaster.intersectObjects(oceanMeshes, false)[0]
  if (hit) {
    targetSubmarineY = submarineBaseY + hit.point.y
  }
}

function normalizeSubmarine(submarine: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(submarine)
  const size = box.getSize(new THREE.Vector3())
  const longestSide = Math.max(size.x, size.y, size.z)

  if (longestSide > 0) {
    submarine.scale.multiplyScalar(22 / longestSide)
  }

  const normalizedBox = new THREE.Box3().setFromObject(submarine)
  const center = normalizedBox.getCenter(new THREE.Vector3())
  submarine.position.x -= center.x
  submarine.position.z -= center.z

  // Sink most of the pressure hull while keeping the deck and conning tower above water.
  submarine.position.y -= center.y + -0.25   // 控制潜艇的深度
}

function tuneSubmarineMaterials(submarine: THREE.Object3D) {
  submarine.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue
      material.color.multiply(new THREE.Color(0x718087))
      material.roughness = 0.5
      material.metalness = 0.3
      material.needsUpdate = true
    }
  })
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return

    child.geometry.dispose()
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose()
      }
      material.dispose()
    }
  })
}

onMounted(async () => {
  const container = viewer.value
  if (!container) return

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x061522)
  scene.fog = new THREE.FogExp2(0x061522, 0.012)

  camera = new THREE.PerspectiveCamera(42, 1, 0.05, 250)
  camera.position.set(25, 11, 27)

  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  } catch (error) {
    console.error('Failed to create WebGL renderer:', error)
    loadingError.value = '浏览器无法创建 WebGL 画面，请检查硬件加速设置。'
    return
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15
  container.appendChild(renderer.domElement)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.055
  controls.autoRotate = true
  controls.autoRotateSpeed = 0.45
  controls.enablePan = false
  controls.minDistance = 7
  controls.maxDistance = 70
  controls.maxPolarAngle = Math.PI * 0.73    //   控制视角的移动
  controls.target.set(0, 0.2, 0)
  controls.addEventListener('start', () => {
    if (controls) controls.autoRotate = false
  })

  scene.add(new THREE.HemisphereLight(0xb9dcff, 0x071018, 2.25))

  const keyLight = new THREE.DirectionalLight(0xfff1d6, 4.5)
  keyLight.position.set(-12, 18, 14)
  scene.add(keyLight)

  const rimLight = new THREE.DirectionalLight(0x4fa7ff, 3.2)
  rimLight.position.set(14, 8, -18)
  scene.add(rimLight)

  const resize = () => {
    if (!renderer || !camera) return
    const width = Math.max(container.clientWidth, 1)
    const height = Math.max(container.clientHeight, 1)
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }
  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(container)
  resize()

  const loader = new GLTFLoader()

  try {
    const [oceanGltf, submarineGltf] = await Promise.all([
      loader.loadAsync(oceanUrl, (event) => updateLoadingProgress(oceanUrl, event)),
      loader.loadAsync(submarineUrl, (event) => updateLoadingProgress(submarineUrl, event)),
    ])

    if (!scene) return

    const ocean = oceanGltf.scene
    normalizeOcean(ocean)
    tuneOceanMaterials(ocean)
    resources.push(ocean)
    scene.add(ocean)

    if (oceanGltf.animations.length > 0) {
      const oceanAnimation =
        THREE.AnimationClip.findByName(oceanGltf.animations, 'KeyAction') ?? oceanGltf.animations[0]
      if (oceanAnimation) {
        oceanMixer = new THREE.AnimationMixer(ocean)

        // 控制海洋动画播放速度
        const oceanAction = oceanMixer.clipAction(oceanAnimation)
        oceanAction.timeScale = 0.31
        oceanAction.setLoop(THREE.LoopRepeat, Infinity).play()
      }
    }

    const submarine = submarineGltf.scene
    normalizeSubmarine(submarine)
    tuneSubmarineMaterials(submarine)
    submarineObject = submarine
    submarineBaseY = submarine.position.y
    targetSubmarineY = submarine.position.y
    resources.push(submarine)
    scene.add(submarine)

    loadingProgress.value = 100
    isLoaded.value = true
    showHint.value = true
    hintTimer = setTimeout(() => {
      showHint.value = false
    }, 4000)
  } catch (error) {
    console.error('Failed to load 3D scene:', error)
    loadingError.value = '模型加载失败，请刷新页面重试。'
  }

  const render = (time = 0) => {
    animationFrame = requestAnimationFrame(render)
    const delta = previousFrameTime === 0 ? 0 : Math.min((time - previousFrameTime) / 1000, 0.1)
    previousFrameTime = time
    oceanMixer?.update(delta)
    scene?.updateMatrixWorld(true)
    sampleWaterHeight(time)
    if (submarineObject) {
      const followStrength = 1 - Math.exp(-delta * 2.8)
      submarineObject.position.y = THREE.MathUtils.lerp(
        submarineObject.position.y,
        targetSubmarineY,
        followStrength,
      )
    }
    controls?.update()
    if (renderer && scene && camera) renderer.render(scene, camera)
  }
  render()
})

onBeforeUnmount(() => {
  cancelAnimationFrame(animationFrame)
  if (hintTimer) clearTimeout(hintTimer)
  resizeObserver?.disconnect()
  oceanMixer?.stopAllAction()
  controls?.dispose()

  for (const object of resources) disposeObject(object)
  renderer?.dispose()
  renderer?.domElement.remove()

  resources.length = 0
  oceanMeshes.length = 0
  fileProgress.clear()
  scene = undefined
  camera = undefined
  renderer = undefined
  controls = undefined
  oceanMixer = undefined
  submarineObject = undefined
})
</script>

<template>
  <section ref="viewer" class="viewer" aria-label="3D 潜艇模型查看器">
    <div v-if="!isLoaded && !loadingError" class="loading-panel" role="status">
      <div class="spinner" aria-hidden="true"></div>
      <p>正在载入海洋与潜艇</p>
      <strong>{{ loadingLabel }}</strong>
      <div class="progress-track" aria-hidden="true">
        <span :style="{ width: loadingLabel }"></span>
      </div>
    </div>

    <p v-if="loadingError" class="error-panel" role="alert">{{ loadingError }}</p>

    <Transition name="hint">
      <p v-if="showHint" class="control-hint">拖动旋转 · 滚轮缩放</p>
    </Transition>
  </section>
</template>

<style scoped>
.viewer {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background:
    radial-gradient(circle at 50% 35%, rgba(23, 74, 105, 0.65), transparent 42%),
    linear-gradient(180deg, #0a2639 0%, #061522 68%, #02080d 100%);
  touch-action: none;
}

.viewer :deep(canvas) {
  display: block;
  width: 100%;
  height: 100%;
}

.loading-panel,
.error-panel,
.control-hint {
  position: absolute;
  z-index: 2;
  color: rgba(239, 248, 255, 0.96);
  font-family: Inter, system-ui, sans-serif;
  letter-spacing: 0.03em;
}

.loading-panel {
  top: 50%;
  left: 50%;
  display: grid;
  width: min(280px, calc(100vw - 48px));
  justify-items: center;
  transform: translate(-50%, -50%);
}

.loading-panel p {
  margin-top: 16px;
  font-size: 14px;
}

.loading-panel strong {
  margin: 5px 0 10px;
  font-size: 12px;
  color: rgba(189, 225, 247, 0.78);
}

.spinner {
  width: 38px;
  height: 38px;
  border: 2px solid rgba(133, 202, 243, 0.2);
  border-top-color: #a9ddfa;
  border-radius: 50%;
  animation: spin 0.85s linear infinite;
}

.progress-track {
  width: 100%;
  height: 2px;
  overflow: hidden;
  border-radius: 2px;
  background: rgba(157, 213, 246, 0.15);
}

.progress-track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #5ca8d4, #c5ecff);
  transition: width 180ms ease;
}

.error-panel {
  top: 50%;
  left: 50%;
  margin: 0;
  padding: 14px 20px;
  transform: translate(-50%, -50%);
  border: 1px solid rgba(255, 140, 140, 0.35);
  border-radius: 10px;
  background: rgba(45, 7, 11, 0.78);
}

.control-hint {
  bottom: 28px;
  left: 50%;
  margin: 0;
  padding: 8px 14px;
  transform: translateX(-50%);
  border: 1px solid rgba(190, 225, 244, 0.18);
  border-radius: 999px;
  background: rgba(3, 16, 25, 0.58);
  font-size: 12px;
  backdrop-filter: blur(8px);
  pointer-events: none;
}

.hint-enter-active,
.hint-leave-active {
  transition:
    opacity 0.45s ease,
    transform 0.45s ease;
}

.hint-enter-from,
.hint-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation-duration: 1.8s;
  }

  .progress-track span,
  .hint-enter-active,
  .hint-leave-active {
    transition: none;
  }
}
</style>
