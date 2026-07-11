import * as THREE from 'three'
import type { Updatable, GameEngine } from '../engine/GameEngine'

export type ExplosionSplashEffectPosition = THREE.Vector3 | { x: number; y?: number; z: number }

/** 特效总持续时间（秒），结束后会自动 dispose 并触发 onFinished */
const EFFECT_DURATION_SECONDS = 7.2

/** 水花从爆炸点快速冲到最高点所需时间（秒），越小上冲越猛 */
const RISE_SECONDS = 0.45

/** 程序化浪花网格的边长（场景单位），决定特效覆盖的最大方形区域 */
const MESH_SIZE = 42

/** 程序化浪花网格细分数，越高浪面越细腻但顶点越多 */
const MESH_SEGMENTS = 96

/** 爆炸浪花最高高度（场景单位），主要控制中央水柱/浪峰高度 */
const MAX_WAVE_HEIGHT = 30.5

/** 扩散环的初始半径（场景单位），控制水花刚出现时离中心多远 */
const RING_START_RADIUS = 4.2

/** 扩散环的最终半径（场景单位），控制水花向外扩散的最大范围 */
const RING_END_RADIUS = 15

/** 扩散环宽度（场景单位），越大浪花环越厚、边缘越柔 */
const RING_WIDTH = 2.2

/** 白色浪沫基础透明度，只影响浪花网格，不影响粒子水沫 */
const FOAM_OPACITY = 0.8

/** 水沫粒子数量，越多飞溅越密集但渲染成本越高 */
const SPRAY_PARTICLE_COUNT = 250

/** 水沫粒子初始上冲速度上限，视觉上控制粒子最高能飞多高 */
const SPRAY_MAX_HEIGHT = 34

/** 水沫粒子水平散布半径，越大飞溅范围越宽 */
const SPRAY_RADIUS = 6.5

/** 水沫粒子下落重力强度，越大粒子越快落回水面 */
const SPRAY_GRAVITY = 17

/** 水沫粒子速度阻尼，越大粒子越快失速、扩散越短 */
const SPRAY_DRAG = 1.63

/** 透明度 */
const SPRAY_OPACITY = 1.45

/** 复用颜色对象，避免创建粒子材质时额外分配临时 Color */
const tempColor = new THREE.Color()

export class ExplosionSplashEffect implements Updatable {
  public readonly root = new THREE.Group()
  public readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  public readonly spray: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
  onFinished?: (effect: ExplosionSplashEffect) => void

  private elapsed = 0
  private disposed = false
  private readonly sprayPositions = new Float32Array(SPRAY_PARTICLE_COUNT * 3)
  private readonly sprayVelocities: THREE.Vector3[] = []
  private readonly sprayLifetimes = new Float32Array(SPRAY_PARTICLE_COUNT)

  constructor(position: ExplosionSplashEffectPosition) {
    const origin = position instanceof THREE.Vector3
      ? position
      : new THREE.Vector3(position.x, position.y ?? 0, position.z)

    this.root.name = 'ExplosionSplashEffect'
    this.root.position.copy(origin)

    this.mesh = this.createWaveMesh()
    this.spray = this.createSpray()
    this.root.add(this.mesh, this.spray)
  }

  get isFinished(): boolean {
    return this.disposed || this.elapsed >= EFFECT_DURATION_SECONDS
  }

  update(delta: number): void {
    if (this.disposed) return

    this.elapsed = Math.min(this.elapsed + delta, EFFECT_DURATION_SECONDS)
    const progress = this.elapsed / EFFECT_DURATION_SECONDS
    const riseProgress = THREE.MathUtils.clamp(this.elapsed / RISE_SECONDS, 0, 1)
    const fallProgress = THREE.MathUtils.clamp(
      (this.elapsed - RISE_SECONDS) / (EFFECT_DURATION_SECONDS - RISE_SECONDS),
      0,
      1,
    )
    const heightEnvelope = this.elapsed <= RISE_SECONDS
      ? easeOutCubic(riseProgress)
      : 1 - easeInOutQuad(fallProgress)
    const opacityEnvelope = 1 - smoothstep(0.72, 1, progress)

    this.mesh.material.uniforms.uTime!.value = this.elapsed
    this.mesh.material.uniforms.uProgress!.value = progress
    this.mesh.material.uniforms.uHeightEnvelope!.value = heightEnvelope
    this.mesh.material.uniforms.uOpacity!.value = FOAM_OPACITY * opacityEnvelope
    this.updateSpray(delta, opacityEnvelope)

    if (this.elapsed >= EFFECT_DURATION_SECONDS) {
      this.finish()
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.root.removeFromParent()
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
    this.spray.geometry.dispose()
    this.spray.material.dispose()
  }

  private finish(): void {
    this.dispose()
    this.onFinished?.(this)
  }

  private createWaveMesh(): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
    const geometry = new THREE.PlaneGeometry(MESH_SIZE, MESH_SIZE, MESH_SEGMENTS, MESH_SEGMENTS)
    geometry.rotateX(-Math.PI / 2)

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uProgress: { value: 0 },
        uHeightEnvelope: { value: 0 },
        uOpacity: { value: FOAM_OPACITY },
        uMaxHeight: { value: MAX_WAVE_HEIGHT },
        uRingStartRadius: { value: RING_START_RADIUS },
        uRingEndRadius: { value: RING_END_RADIUS },
        uRingWidth: { value: RING_WIDTH },
        uFoamColor: { value: new THREE.Color(0xeaf8ff) },
        uWaterTint: { value: new THREE.Color(0xa9e8f2) },
      },
      vertexShader: `
        uniform float uTime;
        uniform float uProgress;
        uniform float uHeightEnvelope;
        uniform float uMaxHeight;
        uniform float uRingStartRadius;
        uniform float uRingEndRadius;
        uniform float uRingWidth;

        varying float vFoam;
        varying float vHeight;
        varying float vRadialFade;
        varying vec3 vWorldPosition;

        void main() {
          vec3 transformed = position;
          float r = length(position.xz);
          float ringRadius = mix(uRingStartRadius, uRingEndRadius, smoothstep(0.0, 1.0, uProgress));
          float ring = exp(-pow((r - ringRadius) / uRingWidth, 2.0));
          float center = exp(-pow(r / 4.6, 2.0)) * (1.0 - smoothstep(0.08, 0.58, uProgress));
          float chop =
            sin(position.x * 1.45 + uTime * 7.0) *
            cos(position.z * 1.22 - uTime * 5.6) *
            0.22;
          float radialFade = 1.0 - smoothstep(0.42, 0.5, r / ${MESH_SIZE.toFixed(1)});
          float height = (ring * 0.88 + center * 1.15 + chop * ring) * uMaxHeight * uHeightEnvelope * radialFade;

          transformed.y += height;
          vFoam = clamp(ring * 1.15 + center * 0.9, 0.0, 1.0) * radialFade;
          vHeight = height;
          vRadialFade = radialFade;

          vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uOpacity;
        uniform vec3 uFoamColor;
        uniform vec3 uWaterTint;

        varying float vFoam;
        varying float vHeight;
        varying float vRadialFade;
        varying vec3 vWorldPosition;

        void main() {
          float streak =
            sin(vWorldPosition.x * 0.95 + uTime * 10.0) *
            sin(vWorldPosition.z * 1.07 - uTime * 8.0) *
            0.12;
          float foam = clamp(vFoam + streak, 0.0, 1.0);
          vec3 color = mix(uWaterTint, uFoamColor, foam);
          color += vec3(0.12, 0.16, 0.18) * smoothstep(1.0, ${MAX_WAVE_HEIGHT.toFixed(1)}, vHeight);
          float alpha = uOpacity * foam * vRadialFade;
          if (alpha < 0.015) discard;
          gl_FragColor = vec4(color, alpha);

          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    })

    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = 'ExplosionSplashEffectWave'
    mesh.frustumCulled = false
    return mesh
  }

  private createSpray(): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
    for (let i = 0; i < SPRAY_PARTICLE_COUNT; i += 1) {
      const angle = Math.random() * Math.PI * 2
      const radius = Math.random() ** 0.55 * SPRAY_RADIUS
      const upward = THREE.MathUtils.lerp(SPRAY_MAX_HEIGHT * 0.45, SPRAY_MAX_HEIGHT, Math.random())
      const outward = THREE.MathUtils.lerp(2.4, 8.8, Math.random())

      this.sprayPositions[i * 3] = Math.cos(angle) * radius * 0.18
      this.sprayPositions[i * 3 + 1] = 0
      this.sprayPositions[i * 3 + 2] = Math.sin(angle) * radius * 0.18
      this.sprayVelocities.push(new THREE.Vector3(
        Math.cos(angle) * outward,
        upward,
        Math.sin(angle) * outward,
      ))
      this.sprayLifetimes[i] = THREE.MathUtils.lerp(0.65, 1.35, Math.random())
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(this.sprayPositions, 3))
    const material = new THREE.PointsMaterial({
      color: tempColor.set(0xf1fbff),
      size: 0.34,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      sizeAttenuation: true,
    })

    const spray = new THREE.Points(geometry, material)
    spray.name = 'ExplosionSplashEffectSpray'
    spray.frustumCulled = false
    return spray
  }

  private updateSpray(delta: number, opacityEnvelope: number): void {
    const positions = this.spray.geometry.attributes.position
    if (!positions) return

    for (let i = 0; i < SPRAY_PARTICLE_COUNT; i += 1) {
      const lifetime = this.sprayLifetimes[i]
      const velocity = this.sprayVelocities[i]
      if (lifetime === undefined || !velocity) continue

      const lifetimeFactor = THREE.MathUtils.clamp(this.elapsed / lifetime, 0, 1)
      if (lifetimeFactor >= 1) continue

      velocity.y -= SPRAY_GRAVITY * delta
      velocity.multiplyScalar(1 - Math.min(SPRAY_DRAG * delta, 0.85))

      const xIndex = i * 3
      const yIndex = xIndex + 1
      const zIndex = xIndex + 2
      this.sprayPositions[xIndex] = (this.sprayPositions[xIndex] ?? 0) + velocity.x * delta
      this.sprayPositions[yIndex] = Math.max(0, (this.sprayPositions[yIndex] ?? 0) + velocity.y * delta)
      this.sprayPositions[zIndex] = (this.sprayPositions[zIndex] ?? 0) + velocity.z * delta
    }
    positions.needsUpdate = true
    this.spray.material.opacity = SPRAY_OPACITY * opacityEnvelope
  }
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}



/*
使用方式：
const effect = new ExplosionSplashEffect(position)

effect.onFinished = (finishedEffect) => {
  engine.removeUpdatable(finishedEffect)
}

engine.scene.add(effect.root)
engine.addUpdatable(effect)

*/