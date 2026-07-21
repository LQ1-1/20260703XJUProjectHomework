import * as THREE from 'three'
import type {
  OceanSimulation,
  OceanSimulationOptions,
  OceanSurfaceSample,
} from './OceanSimulation'

type ComplexField = {
  re: Float32Array
  im: Float32Array
}

const GRAVITY = 9.81
const TWO_PI = Math.PI * 2
const CAPILLARY_WAVE_NUMBER = 370
const MINIMUM_PHASE_SPEED = 0.23
const MIN_WAVE_NUMBER = 0.000001

function clampUnit(value: number): number {
  return THREE.MathUtils.clamp(value, 0, 1)
}

function positiveModulo(value: number, size: number): number {
  return ((value % size) + size) % size
}

function hashToUnit(seed: number): number {
  let x = Math.imul(seed ^ 0x6d2b79f5, 0x1b873593)
  x ^= x >>> 15
  x = Math.imul(x, 0x85ebca6b)
  x ^= x >>> 13
  return ((x >>> 0) + 0.5) / 4294967296
}

function reverseBits(value: number, bits: number): number {
  let reversed = 0
  for (let i = 0; i < bits; i += 1) {
    reversed = (reversed << 1) | (value & 1)
    value >>>= 1
  }
  return reversed
}

function inverseFft1d(re: Float32Array, im: Float32Array, offset: number, stride: number, n: number): void {
  const bits = Math.log2(n)
  for (let i = 0; i < n; i += 1) {
    const j = reverseBits(i, bits)
    if (j <= i) continue
    const ai = offset + i * stride
    const aj = offset + j * stride
    const tr = re[ai]!
    const ti = im[ai]!
    re[ai] = re[aj]!
    im[ai] = im[aj]!
    re[aj] = tr
    im[aj] = ti
  }

  for (let length = 2; length <= n; length *= 2) {
    const half = length / 2
    const phaseStep = TWO_PI / length
    for (let start = 0; start < n; start += length) {
      for (let j = 0; j < half; j += 1) {
        const angle = phaseStep * j
        const wr = Math.cos(angle)
        const wi = Math.sin(angle)
        const evenIndex = offset + (start + j) * stride
        const oddIndex = offset + (start + j + half) * stride
        const oddRe = re[oddIndex]! * wr - im[oddIndex]! * wi
        const oddIm = re[oddIndex]! * wi + im[oddIndex]! * wr
        const evenRe = re[evenIndex]!
        const evenIm = im[evenIndex]!
        re[evenIndex] = evenRe + oddRe
        im[evenIndex] = evenIm + oddIm
        re[oddIndex] = evenRe - oddRe
        im[oddIndex] = evenIm - oddIm
      }
    }
  }
}

function inverseFft2d(field: ComplexField, n: number): void {
  for (let row = 0; row < n; row += 1) {
    inverseFft1d(field.re, field.im, row * n, 1, n)
  }
  for (let col = 0; col < n; col += 1) {
    inverseFft1d(field.re, field.im, col, n, n)
  }

  const scale = 1 / (n * n)
  for (let i = 0; i < field.re.length; i += 1) {
    field.re[i] = field.re[i]! * scale
    field.im[i] = field.im[i]! * scale
  }
}

export class TessendorfJonswapOceanSimulation implements OceanSimulation {
  readonly size: number
  readonly resolution: number
  readonly mode: 'gpu' | 'cpu'

  private readonly windDirection: THREE.Vector2
  private readonly windSpeed: number
  private readonly fetch: number
  private readonly gamma: number
  private readonly heightScale: number
  private readonly choppiness: number
  private readonly sampleStepSeconds: number
  private readonly count: number
  private readonly h0Re: Float32Array
  private readonly h0Im: Float32Array
  private readonly h0MinusRe: Float32Array
  private readonly h0MinusIm: Float32Array
  private readonly omega: Float32Array
  private readonly waveNumberX: Float32Array
  private readonly waveNumberZ: Float32Array
  private readonly spectrum = {
    height: { re: new Float32Array(), im: new Float32Array() },
    displaceX: { re: new Float32Array(), im: new Float32Array() },
    displaceZ: { re: new Float32Array(), im: new Float32Array() },
  }
  private readonly height: Float32Array
  private readonly displacementX: Float32Array
  private readonly displacementZ: Float32Array
  private readonly normalX: Float32Array
  private readonly normalY: Float32Array
  private readonly normalZ: Float32Array
  private readonly reusableSample: OceanSurfaceSample = {
    height: 0,
    normal: new THREE.Vector3(0, 1, 0),
    displacement: new THREE.Vector2(),
  }
  private elapsedTime = 0
  private updateAccumulator = Number.POSITIVE_INFINITY

  constructor(options: OceanSimulationOptions) {
    this.size = options.size
    this.resolution = options.resolution
    this.mode = this.canUseGpuDisplacement(options.renderer) ? 'gpu' : 'cpu'
    this.windDirection = options.windDirection.clone().normalize()
    this.windSpeed = options.windSpeed
    this.fetch = options.fetch
    this.gamma = options.gamma
    this.heightScale = options.heightScale
    this.choppiness = options.choppiness
    this.sampleStepSeconds = 1 / options.sampleHz
    this.count = this.resolution * this.resolution
    this.h0Re = new Float32Array(this.count)
    this.h0Im = new Float32Array(this.count)
    this.h0MinusRe = new Float32Array(this.count)
    this.h0MinusIm = new Float32Array(this.count)
    this.omega = new Float32Array(this.count)
    this.waveNumberX = new Float32Array(this.count)
    this.waveNumberZ = new Float32Array(this.count)
    this.spectrum.height = { re: new Float32Array(this.count), im: new Float32Array(this.count) }
    this.spectrum.displaceX = { re: new Float32Array(this.count), im: new Float32Array(this.count) }
    this.spectrum.displaceZ = { re: new Float32Array(this.count), im: new Float32Array(this.count) }
    this.height = new Float32Array(this.count)
    this.displacementX = new Float32Array(this.count)
    this.displacementZ = new Float32Array(this.count)
    this.normalX = new Float32Array(this.count)
    this.normalY = new Float32Array(this.count)
    this.normalZ = new Float32Array(this.count)

    this.initializeSpectrum()
    this.rebuildFields(0)
  }

  update(delta: number): boolean {
    this.elapsedTime += delta
    this.updateAccumulator += delta
    if (this.updateAccumulator < this.sampleStepSeconds) return false
    this.updateAccumulator = 0
    this.rebuildFields(this.elapsedTime)
    return true
  }

  sampleSurfaceAt(x: number, z: number): OceanSurfaceSample {
    const sample = this.sampleGrid(this.height, x, z)
    const normalX = this.sampleGrid(this.normalX, x, z)
    const normalY = this.sampleGrid(this.normalY, x, z)
    const normalZ = this.sampleGrid(this.normalZ, x, z)
    const displacementX = this.sampleGrid(this.displacementX, x, z)
    const displacementZ = this.sampleGrid(this.displacementZ, x, z)
    this.reusableSample.height = sample
    this.reusableSample.normal.set(normalX, normalY, normalZ).normalize()
    this.reusableSample.displacement.set(displacementX, displacementZ)
    return this.reusableSample
  }

  applyToGeometry(geometry: THREE.PlaneGeometry, centerX: number, centerZ: number): void {
    const position = geometry.attributes.position
    if (!(position instanceof THREE.BufferAttribute)) return

    for (let i = 0; i < position.count; i += 1) {
      const localX = position.getX(i)
      const localZ = position.getZ(i)
      const x = centerX + localX
      const z = centerZ + localZ
      const height = this.sampleGrid(this.height, x, z)
      const dx = this.sampleGrid(this.displacementX, x, z)
      const dz = this.sampleGrid(this.displacementZ, x, z)
      position.setXYZ(i, localX + dx, height, localZ + dz)
    }

    position.needsUpdate = true
    geometry.computeVertexNormals()
  }

  dispose(): void {
    // Typed arrays are owned by this simulation and are released by GC.
  }

  private canUseGpuDisplacement(renderer: THREE.WebGLRenderer | undefined): boolean {
    if (!renderer) return false
    return renderer.capabilities.isWebGL2 || renderer.capabilities.maxVertexTextures > 0
  }

  private initializeSpectrum(): void {
    const n = this.resolution
    for (let y = 0; y < n; y += 1) {
      const frequencyY = y < n / 2 ? y : y - n
      const kz = TWO_PI * frequencyY / this.size
      for (let x = 0; x < n; x += 1) {
        const index = y * n + x
        const frequencyX = x < n / 2 ? x : x - n
        const kx = TWO_PI * frequencyX / this.size
        const kLength = Math.hypot(kx, kz)
        this.waveNumberX[index] = kx
        this.waveNumberZ[index] = kz
        this.omega[index] = this.dispersion(Math.max(kLength, MIN_WAVE_NUMBER))

        const spectrum = this.jonswapDirectionalSpectrum(kx, kz)
        const phase = hashToUnit(index * 747796405 + 2891336453) * TWO_PI
        const amplitude = Math.sqrt(Math.max(spectrum, 0) / 2) * this.heightScale
        this.h0Re[index] = Math.cos(phase) * amplitude
        this.h0Im[index] = Math.sin(phase) * amplitude
      }
    }

    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        const index = y * n + x
        const minusX = (n - x) % n
        const minusY = (n - y) % n
        const minusIndex = minusY * n + minusX
        this.h0MinusRe[index] = this.h0Re[minusIndex]!
        this.h0MinusIm[index] = -this.h0Im[minusIndex]!
      }
    }
  }

  private jonswapDirectionalSpectrum(kx: number, kz: number): number {
    const k = Math.hypot(kx, kz)
    if (k < MIN_WAVE_NUMBER) return 0
    const windSpeed = Math.max(this.windSpeed, 0.1)
    const omega = 0.84
    const kp = GRAVITY * Math.pow(omega / windSpeed, 2)
    const c = this.dispersion(k) / k
    const cp = this.dispersion(kp) / kp
    const lpm = Math.exp(-1.25 * Math.pow(kp / k, 2))
    const sigma = 0.08 * (1 + 4 * Math.pow(omega, -3))
    const gammaPeak = Math.exp(-Math.pow(Math.sqrt(k / kp) - 1, 2) / (2 * Math.pow(sigma, 2)))
    const jp = Math.pow(this.gamma || 1.7, gammaPeak)
    const fp = lpm * jp * Math.exp((-omega / Math.sqrt(10)) * (Math.sqrt(k / kp) - 1))
    const alphap = 0.006 * Math.sqrt(omega)
    const bl = 0.5 * alphap * (cp / c) * fp

    const z0 = 0.000037 * windSpeed * windSpeed / GRAVITY * Math.pow(windSpeed / cp, 0.9)
    const uStar = 0.41 * windSpeed / Math.log(10 / Math.max(z0, 1e-7))
    const alpham =
      0.01 *
      (uStar < MINIMUM_PHASE_SPEED
        ? 1 + Math.log(Math.max(uStar / MINIMUM_PHASE_SPEED, 1e-7))
        : 1 + 3 * Math.log(uStar / MINIMUM_PHASE_SPEED))
    const fm = Math.exp(-0.25 * Math.pow(k / CAPILLARY_WAVE_NUMBER - 1, 2))
    const bh = 0.5 * alpham * (MINIMUM_PHASE_SPEED / c) * fm * lpm

    const a0 = Math.log(2) / 4
    const am = 0.13 * uStar / MINIMUM_PHASE_SPEED
    const delta = Math.tanh(
      a0 +
      4 * Math.pow(c / cp, 2.5) +
      am * Math.pow(MINIMUM_PHASE_SPEED / c, 2.5),
    )
    const direction = new THREE.Vector2(kx / k, kz / k)
    const cosPhi = direction.dot(this.windDirection)
    const spread = 1 + delta * (2 * cosPhi * cosPhi - 1)
    const spectralDensity = (1 / TWO_PI) * Math.pow(k, -4) * (bl + bh) * spread
    const dk = TWO_PI / this.size
    return Math.max(spectralDensity, 0) * dk * dk
  }

  private dispersion(k: number): number {
    return Math.sqrt(GRAVITY * k * (1 + Math.pow(k / CAPILLARY_WAVE_NUMBER, 2)))
  }

  private rebuildFields(time: number): void {
    const height = this.spectrum.height
    const displaceX = this.spectrum.displaceX
    const displaceZ = this.spectrum.displaceZ

    for (let i = 0; i < this.count; i += 1) {
      const phase = this.omega[i]! * time
      const cosPhase = Math.cos(phase)
      const sinPhase = Math.sin(phase)
      const h0Re = this.h0Re[i]!
      const h0Im = this.h0Im[i]!
      const hmRe = this.h0MinusRe[i]!
      const hmIm = this.h0MinusIm[i]!

      const aRe = h0Re * cosPhase - h0Im * sinPhase
      const aIm = h0Re * sinPhase + h0Im * cosPhase
      const bRe = hmRe * cosPhase + hmIm * sinPhase
      const bIm = -hmRe * sinPhase + hmIm * cosPhase
      const hRe = aRe + bRe
      const hIm = aIm + bIm
      height.re[i] = hRe
      height.im[i] = hIm

      const kx = this.waveNumberX[i]!
      const kz = this.waveNumberZ[i]!
      const kLength = Math.max(Math.hypot(kx, kz), MIN_WAVE_NUMBER)
      const scaleX = -this.choppiness * kx / kLength
      const scaleZ = -this.choppiness * kz / kLength
      displaceX.re[i] = -hIm * scaleX
      displaceX.im[i] = hRe * scaleX
      displaceZ.re[i] = -hIm * scaleZ
      displaceZ.im[i] = hRe * scaleZ
    }

    inverseFft2d(height, this.resolution)
    inverseFft2d(displaceX, this.resolution)
    inverseFft2d(displaceZ, this.resolution)

    for (let i = 0; i < this.count; i += 1) {
      this.height[i] = height.re[i]!
      this.displacementX[i] = displaceX.re[i]!
      this.displacementZ[i] = displaceZ.re[i]!
    }
    this.rebuildNormals()
  }

  private rebuildNormals(): void {
    const n = this.resolution
    const cellSize = this.size / n
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        const index = y * n + x
        const right = this.displacedVector((x + 1) % n, y, index, cellSize, 0)
        const left = this.displacedVector((x - 1 + n) % n, y, index, -cellSize, 0)
        const top = this.displacedVector(x, (y - 1 + n) % n, index, 0, -cellSize)
        const bottom = this.displacedVector(x, (y + 1) % n, index, 0, cellSize)
        const normal = new THREE.Vector3()
          .add(new THREE.Vector3().crossVectors(right, top))
          .add(new THREE.Vector3().crossVectors(top, left))
          .add(new THREE.Vector3().crossVectors(left, bottom))
          .add(new THREE.Vector3().crossVectors(bottom, right))
          .normalize()
        this.normalX[index] = normal.x
        this.normalY[index] = normal.y
        this.normalZ[index] = normal.z
      }
    }
  }

  private displacedVector(
    x: number,
    y: number,
    centerIndex: number,
    baseX: number,
    baseZ: number,
  ): THREE.Vector3 {
    const neighborIndex = y * this.resolution + x
    return new THREE.Vector3(
      baseX + this.displacementX[neighborIndex]! - this.displacementX[centerIndex]!,
      this.height[neighborIndex]! - this.height[centerIndex]!,
      baseZ + this.displacementZ[neighborIndex]! - this.displacementZ[centerIndex]!,
    )
  }

  private sampleGrid(field: Float32Array, x: number, z: number): number {
    const n = this.resolution
    const cellSize = this.size / n
    const u = positiveModulo(x + this.size / 2, this.size) / cellSize
    const v = positiveModulo(z + this.size / 2, this.size) / cellSize
    const x0 = Math.floor(u) % n
    const z0 = Math.floor(v) % n
    const x1 = (x0 + 1) % n
    const z1 = (z0 + 1) % n
    const tx = clampUnit(u - Math.floor(u))
    const tz = clampUnit(v - Math.floor(v))
    const a = field[z0 * n + x0]!
    const b = field[z0 * n + x1]!
    const c = field[z1 * n + x0]!
    const d = field[z1 * n + x1]!
    return THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(a, b, tx),
      THREE.MathUtils.lerp(c, d, tx),
      tz,
    )
  }
}
