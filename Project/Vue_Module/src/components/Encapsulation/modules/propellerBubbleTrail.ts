import * as THREE from 'three'
import type { Updatable, GameEngine } from '../engine/GameEngine'

export interface PropellerBubbleTrailOptions {
  sources: THREE.Object3D[]
  getSpeed: () => number
  maxBubbles?: number
  emitRate?: number
  minSpeed?: number
}

export class PropellerBubbleTrail implements Updatable {
  public readonly root = new THREE.Group()

  private readonly sources: THREE.Object3D[]
  private readonly getSpeed: () => number
  private readonly maxBubbles: number
  private readonly emitRate: number
  private readonly minSpeed: number
  private readonly positions: Float32Array
  private readonly velocities: THREE.Vector3[] = []
  private readonly ages: Float32Array
  private readonly lifetimes: Float32Array
  private readonly bubbles: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
  private readonly sourceWorldPosition = new THREE.Vector3()
  private readonly sourceWorldQuaternion = new THREE.Quaternion()
  private readonly forward = new THREE.Vector3()
  private readonly right = new THREE.Vector3()
  private readonly up = new THREE.Vector3()
  private emitAccumulator = 0
  private nextBubbleIndex = 0
  private disposed = false

  constructor(
    private readonly engine: GameEngine,
    options: PropellerBubbleTrailOptions,
  ) {
    this.sources = options.sources
    this.getSpeed = options.getSpeed
    this.maxBubbles = options.maxBubbles ?? 220
    this.emitRate = options.emitRate ?? 36
    this.minSpeed = options.minSpeed ?? 0.0001

    this.positions = new Float32Array(this.maxBubbles * 3)
    this.ages = new Float32Array(this.maxBubbles)
    this.lifetimes = new Float32Array(this.maxBubbles)

    for (let i = 0; i < this.maxBubbles; i += 1) {
      this.positions[i * 3 + 1] = -9999
      this.ages[i] = Number.POSITIVE_INFINITY
      this.lifetimes[i] = 1
      this.velocities.push(new THREE.Vector3())
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))

    const material = new THREE.PointsMaterial({
      color: 0xdaf8ff,
      size: 0.17,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      sizeAttenuation: true,
      map: PropellerBubbleTrail.createBubbleTexture(),
      alphaTest: 0.08,
    })

    this.bubbles = new THREE.Points(geometry, material)
    this.bubbles.name = 'PropellerBubbleTrailPoints'
    this.bubbles.frustumCulled = false
    this.root.name = 'PropellerBubbleTrail'
    this.root.add(this.bubbles)
  }

  update(delta: number): void {
    if (this.disposed) return

    this.emitBubbles(delta)
    this.updateBubbles(delta)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.engine.removeUpdatable(this)
    this.root.removeFromParent()
    this.bubbles.geometry.dispose()
    this.bubbles.material.map?.dispose()
    this.bubbles.material.dispose()
  }

  private emitBubbles(delta: number): void {
    const speed = this.getSpeed()
    const absSpeed = Math.abs(speed)
    if (absSpeed < this.minSpeed || this.sources.length === 0) return

    this.emitAccumulator += delta * this.emitRate * THREE.MathUtils.clamp(absSpeed / 2.4, 0.2, 1.4)
    while (this.emitAccumulator >= 1) {
      this.emitAccumulator -= 1
      const source = this.sources[this.nextBubbleIndex % this.sources.length]
      if (source) this.emitBubble(source, speed)
    }
  }

  private emitBubble(source: THREE.Object3D, speed: number): void {
    const index = this.nextBubbleIndex
    this.nextBubbleIndex = (this.nextBubbleIndex + 1) % this.maxBubbles

    source.getWorldPosition(this.sourceWorldPosition)
    source.getWorldQuaternion(this.sourceWorldQuaternion)
    this.forward.set(1, 0, 0).applyQuaternion(this.sourceWorldQuaternion).normalize()
    this.right.set(0, 1, 0).applyQuaternion(this.sourceWorldQuaternion).normalize()
    this.up.set(0, 0, 1).applyQuaternion(this.sourceWorldQuaternion).normalize()

    const speedSign = Math.sign(speed) || 1
    const backwash = this.forward.clone().multiplyScalar(-speedSign * THREE.MathUtils.randFloat(0.04, 0.12))
    const sideJitter = this.right.clone().multiplyScalar(THREE.MathUtils.randFloatSpread(0.09))
    const verticalJitter = this.up.clone().multiplyScalar(THREE.MathUtils.randFloatSpread(0.07))
    const worldPosition = this.sourceWorldPosition.clone().add(backwash).add(sideJitter).add(verticalJitter)

    this.positions[index * 3] = worldPosition.x
    this.positions[index * 3 + 1] = worldPosition.y
    this.positions[index * 3 + 2] = worldPosition.z
    this.ages[index] = 0
    this.lifetimes[index] = THREE.MathUtils.randFloat(0.25, 0.55)

    const velocity = this.velocities[index]
    if (!velocity) return
    velocity
      .copy(backwash)
      .multiplyScalar(THREE.MathUtils.randFloat(0.35, 0.8))
      .add(new THREE.Vector3(0, THREE.MathUtils.randFloat(0.025, 0.075), 0))
      .add(new THREE.Vector3(THREE.MathUtils.randFloatSpread(0.035), 0, THREE.MathUtils.randFloatSpread(0.035)))

    this.bubbles.geometry.attributes.position!.needsUpdate = true
  }

  private updateBubbles(delta: number): void {
    for (let i = 0; i < this.maxBubbles; i += 1) {
      const age = (this.ages[i] ?? Number.POSITIVE_INFINITY) + delta
      this.ages[i] = age

      if (age >= (this.lifetimes[i] ?? 0)) {
        this.positions[i * 3 + 1] = -9999
        continue
      }

      const velocity = this.velocities[i]
      if (!velocity) continue

      const drift = 1 - Math.min(delta * 1.6, 0.85)
      velocity.x *= drift
      velocity.z *= drift
      velocity.y += delta * 0.006

      this.positions[i * 3] = (this.positions[i * 3] ?? 0) + velocity.x * delta
      this.positions[i * 3 + 1] = (this.positions[i * 3 + 1] ?? 0) + velocity.y * delta
      this.positions[i * 3 + 2] = (this.positions[i * 3 + 2] ?? 0) + velocity.z * delta
    }

    this.bubbles.geometry.attributes.position!.needsUpdate = true
  }

  private static createBubbleTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas')
    canvas.width = 48
    canvas.height = 48
    const context = canvas.getContext('2d')
    if (context) {
      const gradient = context.createRadialGradient(18, 16, 3, 24, 24, 22)
      gradient.addColorStop(0, 'rgba(255,255,255,0.95)')
      gradient.addColorStop(0.36, 'rgba(218,248,255,0.48)')
      gradient.addColorStop(0.72, 'rgba(155,225,240,0.2)')
      gradient.addColorStop(1, 'rgba(155,225,240,0)')
      context.fillStyle = gradient
      context.beginPath()
      context.arc(24, 24, 22, 0, Math.PI * 2)
      context.fill()
    }

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }
}
