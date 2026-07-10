import * as THREE from 'three'
import type { Updatable } from '../engine/GameEngine'

export type ExplosionSplashEffectPosition =
  | THREE.Vector3
  | {
      x: number
      y?: number
      z: number
    }

export interface ExplosionSplashEffectOptions {
  position: ExplosionSplashEffectPosition
}

/**
 * 大水球爆炸水花特效：
 * - 中央大水球快速膨胀并消散
 * - 水滴向四周飞散
 * - 水滴按抛物线路径落回海面
 * - 落点生成泡沫小环
 */
export class ExplosionSplashEffect implements Updatable {
  public readonly root = new THREE.Group()
  public onFinished?: (effect: ExplosionSplashEffect) => void

  private readonly coreBall: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>
  private readonly droplets: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
  private readonly foamRings: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>[] = []

  private elapsedSeconds = 0
  private disposed = false

  private static readonly EFFECT_DURATION_SECONDS = 12.2

  // 中心水球
  private static readonly CORE_BALL_MAX_RADIUS = 11.5
  private static readonly CORE_BALL_RISE_HEIGHT = 10.5
  private static readonly CORE_BALL_VISIBLE_SECONDS = 2.25
  private static readonly CORE_BALL_OPACITY = 0.92

  // 水滴
  private static readonly DROPLET_COUNT = 1140
  private static readonly DROPLET_SIZE = 0.42
  private static readonly DROPLET_OPACITY = 0.95

  private static readonly DROPLET_MIN_HORIZONTAL_SPEED = 8
  private static readonly DROPLET_MAX_HORIZONTAL_SPEED = 29
  private static readonly DROPLET_MIN_UP_SPEED = 12
  private static readonly DROPLET_MAX_UP_SPEED = 38

  private static readonly GRAVITY = 18
  private static readonly AIR_DRAG = 0.12

  // 起始水滴散布半径
  private static readonly START_RADIUS = 4.2
  private static readonly START_HEIGHT_MIN = 1.5
  private static readonly START_HEIGHT_MAX = 7.5

  // 泡沫环
  private static readonly FOAM_RING_MAX_COUNT = 150
  private static readonly FOAM_RING_START_RADIUS = 0.7
  private static readonly FOAM_RING_END_RADIUS = 3.8
  private static readonly FOAM_RING_DURATION = 3.1
  private static readonly FOAM_RING_OPACITY = 0.72

  private readonly dropletPositions = new Float32Array(
    ExplosionSplashEffect.DROPLET_COUNT * 3,
  )

  private readonly dropletVelocities: THREE.Vector3[] = []
  private readonly dropletStartTimes = new Float32Array(ExplosionSplashEffect.DROPLET_COUNT)
  private readonly dropletLanded = new Uint8Array(ExplosionSplashEffect.DROPLET_COUNT)

  private readonly tempVector = new THREE.Vector3()

  constructor(options: ExplosionSplashEffectOptions) {
    const origin = ExplosionSplashEffect.toVector3(options.position)

    this.root.name = 'ExplosionSplashEffect'
    this.root.position.copy(origin)

    this.coreBall = this.createCoreBall()
    this.droplets = this.createDroplets()

    this.root.add(this.coreBall, this.droplets)
  }

  public get isFinished(): boolean {
    return this.disposed || this.elapsedSeconds >= ExplosionSplashEffect.EFFECT_DURATION_SECONDS
  }

  public update(deltaSeconds: number): void {
    if (this.disposed) return

    this.elapsedSeconds = Math.min(
      this.elapsedSeconds + deltaSeconds,
      ExplosionSplashEffect.EFFECT_DURATION_SECONDS,
    )

    this.updateCoreBall()
    this.updateDroplets(deltaSeconds)
    this.updateFoamRings(deltaSeconds)

    if (this.elapsedSeconds >= ExplosionSplashEffect.EFFECT_DURATION_SECONDS) {
      this.finish()
    }
  }

  public dispose(): void {
    if (this.disposed) return

    this.disposed = true

    this.root.removeFromParent()

    this.coreBall.geometry.dispose()
    this.coreBall.material.dispose()

    this.droplets.geometry.dispose()
    this.droplets.material.dispose()

    for (const ring of this.foamRings) {
      ring.geometry.dispose()
      ring.material.dispose()
    }

    this.foamRings.length = 0
  }

  private finish(): void {
    this.dispose()
    this.onFinished?.(this)
  }

  private createCoreBall(): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
    const geometry = new THREE.SphereGeometry(1, 64, 32)

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: ExplosionSplashEffect.CORE_BALL_OPACITY },
        uWhite: { value: new THREE.Color(0xf7fdff) },
        uBlue: { value: new THREE.Color(0x9eddeb) },
      },
      vertexShader: ExplosionSplashEffect.CORE_BALL_VERTEX_SHADER,
      fragmentShader: ExplosionSplashEffect.CORE_BALL_FRAGMENT_SHADER,
    })

    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = 'ExplosionSplashEffectCoreBall'
    mesh.frustumCulled = false
    mesh.scale.setScalar(0.01)

    return mesh
  }

  private createDroplets(): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
    for (let i = 0; i < ExplosionSplashEffect.DROPLET_COUNT; i += 1) {
      const angle = Math.random() * Math.PI * 2

      // 有些水滴更偏水平飞散，有些更偏向上喷
      const horizontalSpeed = THREE.MathUtils.lerp(
        ExplosionSplashEffect.DROPLET_MIN_HORIZONTAL_SPEED,
        ExplosionSplashEffect.DROPLET_MAX_HORIZONTAL_SPEED,
        Math.random() ** 0.7,
      )

      const upSpeed = THREE.MathUtils.lerp(
        ExplosionSplashEffect.DROPLET_MIN_UP_SPEED,
        ExplosionSplashEffect.DROPLET_MAX_UP_SPEED,
        Math.random() ** 0.85,
      )

      const startRadius = Math.random() ** 0.55 * ExplosionSplashEffect.START_RADIUS
      const startHeight = THREE.MathUtils.lerp(
        ExplosionSplashEffect.START_HEIGHT_MIN,
        ExplosionSplashEffect.START_HEIGHT_MAX,
        Math.random(),
      )

      const x = Math.cos(angle) * startRadius
      const y = startHeight
      const z = Math.sin(angle) * startRadius

      this.dropletPositions[i * 3] = x
      this.dropletPositions[i * 3 + 1] = y
      this.dropletPositions[i * 3 + 2] = z

      // 加一点随机偏角，让飞散方向不完全规则
      const sideJitter = THREE.MathUtils.lerp(-0.22, 0.22, Math.random())
      const finalAngle = angle + sideJitter

      this.dropletVelocities.push(
        new THREE.Vector3(
          Math.cos(finalAngle) * horizontalSpeed,
          upSpeed,
          Math.sin(finalAngle) * horizontalSpeed,
        ),
      )

      // 让水滴不是同一帧全部飞出，形成爆开层次
      this.dropletStartTimes[i] = THREE.MathUtils.lerp(0, 0.18, Math.random())
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(this.dropletPositions, 3))

    const material = new THREE.PointsMaterial({
      color: 0xf3fcff,
      size: ExplosionSplashEffect.DROPLET_SIZE,
      transparent: true,
      opacity: ExplosionSplashEffect.DROPLET_OPACITY,
      depthWrite: false,
      sizeAttenuation: true,
    })

    const points = new THREE.Points(geometry, material)
    points.name = 'ExplosionSplashEffectDroplets'
    points.frustumCulled = false

    return points
  }

  private updateCoreBall(): void {
    const t = THREE.MathUtils.clamp(
      this.elapsedSeconds / ExplosionSplashEffect.CORE_BALL_VISIBLE_SECONDS,
      0,
      1,
    )

    const grow = ExplosionSplashEffect.easeOutCubic(
      THREE.MathUtils.clamp(t / 0.42, 0, 1),
    )

    const fade = 1 - ExplosionSplashEffect.smoothstep(0.46, 1, t)

    const radius = ExplosionSplashEffect.CORE_BALL_MAX_RADIUS * grow

    this.coreBall.scale.setScalar(Math.max(radius, 0.001))

    this.coreBall.position.y =
      ExplosionSplashEffect.CORE_BALL_RISE_HEIGHT *
      ExplosionSplashEffect.easeOutCubic(THREE.MathUtils.clamp(t / 0.55, 0, 1))

    this.coreBall.material.uniforms.uTime!.value = this.elapsedSeconds
    this.coreBall.material.uniforms.uOpacity!.value =
      ExplosionSplashEffect.CORE_BALL_OPACITY * fade

    this.coreBall.visible = fade > 0.02
  }

  private updateDroplets(deltaSeconds: number): void {
    const positions = this.droplets.geometry.attributes.position
    if (!positions) return

    let aliveCount = 0

    for (let i = 0; i < ExplosionSplashEffect.DROPLET_COUNT; i += 1) {
      if (this.dropletLanded[i] === 1) continue

      const startTime = this.dropletStartTimes[i] ?? 0
      if (this.elapsedSeconds < startTime) {
        aliveCount += 1
        continue
      }

      const velocity = this.dropletVelocities[i]
      if (!velocity) continue

      const xIndex = i * 3
      const yIndex = xIndex + 1
      const zIndex = xIndex + 2

      // 空气阻力，只影响水平和整体速度，不要太强
      const dragFactor = 1 - Math.min(ExplosionSplashEffect.AIR_DRAG * deltaSeconds, 0.35)
      velocity.x *= dragFactor
      velocity.z *= dragFactor

      // 重力，形成抛物线
      velocity.y -= ExplosionSplashEffect.GRAVITY * deltaSeconds

      const nextX = (this.dropletPositions[xIndex] ?? 0) + velocity.x * deltaSeconds
      const nextY = (this.dropletPositions[yIndex] ?? 0) + velocity.y * deltaSeconds
      const nextZ = (this.dropletPositions[zIndex] ?? 0) + velocity.z * deltaSeconds

      if (nextY <= 0) {
        this.dropletPositions[xIndex] = nextX
        this.dropletPositions[yIndex] = 0
        this.dropletPositions[zIndex] = nextZ
        this.dropletLanded[i] = 1

        this.spawnFoamRing(nextX, nextZ)
        continue
      }

      this.dropletPositions[xIndex] = nextX
      this.dropletPositions[yIndex] = nextY
      this.dropletPositions[zIndex] = nextZ

      aliveCount += 1
    }

    positions.needsUpdate = true

    // 水滴后期整体渐隐
    const globalFade =
      1 -
      ExplosionSplashEffect.smoothstep(
        0.72,
        1,
        this.elapsedSeconds / ExplosionSplashEffect.EFFECT_DURATION_SECONDS,
      )

    this.droplets.material.opacity =
      ExplosionSplashEffect.DROPLET_OPACITY * globalFade

    this.droplets.visible = aliveCount > 0 && globalFade > 0.02
  }

  private spawnFoamRing(x: number, z: number): void {
    if (this.foamRings.length >= ExplosionSplashEffect.FOAM_RING_MAX_COUNT) return

    const geometry = new THREE.RingGeometry(
      ExplosionSplashEffect.FOAM_RING_START_RADIUS,
      ExplosionSplashEffect.FOAM_RING_START_RADIUS * 1.28,
      32,
    )

    geometry.rotateX(-Math.PI / 2)

    const material = new THREE.MeshBasicMaterial({
      color: 0xf3fcff,
      transparent: true,
      opacity: ExplosionSplashEffect.FOAM_RING_OPACITY,
      depthWrite: false,
      side: THREE.DoubleSide,
    })

    const ring = new THREE.Mesh(geometry, material)

    ring.name = 'ExplosionSplashEffectFoamRing'
    ring.position.set(x, 0.035, z)
    ring.userData.age = 0
    ring.userData.duration = ExplosionSplashEffect.FOAM_RING_DURATION
    ring.userData.startRadius = ExplosionSplashEffect.FOAM_RING_START_RADIUS
    ring.userData.endRadius = THREE.MathUtils.lerp(
      ExplosionSplashEffect.FOAM_RING_END_RADIUS * 0.55,
      ExplosionSplashEffect.FOAM_RING_END_RADIUS,
      Math.random(),
    )

    this.foamRings.push(ring)
    this.root.add(ring)
  }

  private updateFoamRings(deltaSeconds: number): void {
    for (let i = this.foamRings.length - 1; i >= 0; i -= 1) {
      const ring = this.foamRings[i]
      if (!ring) continue

      ring.userData.age += deltaSeconds

      const age = ring.userData.age as number
      const duration = ring.userData.duration as number
      const endRadius = ring.userData.endRadius as number

      const t = THREE.MathUtils.clamp(age / duration, 0, 1)
      const radius = THREE.MathUtils.lerp(1, endRadius, ExplosionSplashEffect.easeOutCubic(t))

      ring.scale.set(radius, radius, radius)
      ring.material.opacity =
        ExplosionSplashEffect.FOAM_RING_OPACITY *
        (1 - ExplosionSplashEffect.smoothstep(0.25, 1, t))

      if (t >= 1) {
        ring.removeFromParent()
        ring.geometry.dispose()
        ring.material.dispose()
        this.foamRings.splice(i, 1)
      }
    }
  }

  private static toVector3(position: ExplosionSplashEffectPosition): THREE.Vector3 {
    if (position instanceof THREE.Vector3) {
      return position.clone()
    }

    return new THREE.Vector3(position.x, position.y ?? 0, position.z)
  }

  private static easeOutCubic(t: number): number {
    return 1 - (1 - t) ** 3
  }

  private static smoothstep(edge0: number, edge1: number, x: number): number {
    const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1)
    return t * t * (3 - 2 * t)
  }

  private static readonly CORE_BALL_VERTEX_SHADER = `
    uniform float uTime;

    varying vec3 vWorldPosition;
    varying vec3 vNormal;
    varying float vNoise;

    void main() {
      vec3 transformed = position;

      float n =
        sin(position.x * 5.5 + uTime * 9.0) *
        cos(position.y * 4.2 - uTime * 7.0) *
        sin(position.z * 5.1 + uTime * 6.0);

      float ripple =
        sin(position.x * 11.0 + position.y * 7.0 + uTime * 13.0) * 0.08 +
        cos(position.z * 10.0 - position.y * 6.0 + uTime * 11.0) * 0.08;

      transformed += normal * (n * 0.08 + ripple);

      vNoise = n;
      vNormal = normalize(normalMatrix * normal);

      vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
      vWorldPosition = worldPosition.xyz;

      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
  `

  private static readonly CORE_BALL_FRAGMENT_SHADER = `
    uniform float uTime;
    uniform float uOpacity;
    uniform vec3 uWhite;
    uniform vec3 uBlue;

    varying vec3 vWorldPosition;
    varying vec3 vNormal;
    varying float vNoise;

    void main() {
      vec3 viewDir = normalize(cameraPosition - vWorldPosition);

      float fresnel = pow(1.0 - max(dot(normalize(vNormal), viewDir), 0.0), 2.0);

      float foamStreak =
        sin(vWorldPosition.x * 0.75 + uTime * 10.0) *
        sin(vWorldPosition.y * 0.55 - uTime * 8.0) *
        0.18;

      float foam = clamp(0.72 + fresnel * 0.35 + foamStreak + vNoise * 0.12, 0.0, 1.0);

      vec3 color = mix(uBlue, uWhite, foam);

      float alpha = clamp(uOpacity * (0.82 + fresnel * 0.22), 0.0, 1.0);

      if (alpha < 0.02) discard;

      gl_FragColor = vec4(color, alpha);

      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `
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