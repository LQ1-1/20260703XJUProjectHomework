import * as THREE from 'three'
import type {
  OceanSimulation,
  OceanSimulationOptions,
  OceanSurfaceSample,
} from './OceanSimulation'

/*
 * Ported from /Users/zero/Documents/GithubItem/fft-ocean/fft-ocean.
 * Original project license: MIT, Copyright (c) 2014 Jeremy Bouny.
 * The GPU simulation shader structure follows js/effects/Ocean.js and
 * js/shaders/FFTOceanShader.js from that reference project.
 */

type ComplexField = {
  re: Float32Array
  im: Float32Array
}

const GRAVITY = 9.81
const TWO_PI = Math.PI * 2
const CAPILLARY_WAVE_NUMBER = 370
const MINIMUM_PHASE_SPEED = 0.23
const MIN_WAVE_NUMBER = 0.000001

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
  for (let row = 0; row < n; row += 1) inverseFft1d(field.re, field.im, row * n, 1, n)
  for (let col = 0; col < n; col += 1) inverseFft1d(field.re, field.im, col, n, n)

  const scale = 1 / (n * n)
  for (let i = 0; i < field.re.length; i += 1) {
    field.re[i] = field.re[i]! * scale
    field.im[i] = field.im[i]! * scale
  }
}

function square(value: number): number {
  return value * value
}

function referenceOmega(k: number): number {
  return Math.sqrt(GRAVITY * k * (1 + square(k / CAPILLARY_WAVE_NUMBER)))
}

const SIM_VERTEX_SHADER = `
  varying vec2 vUV;

  void main() {
    vUV = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position, 1.0);
  }
`

const SUBTRANSFORM_SHADER = `
  const float PI = 3.14159265359;

  uniform sampler2D u_input;
  uniform float u_transformSize;
  uniform float u_subtransformSize;

  varying vec2 vUV;

  vec2 multiplyComplex(vec2 a, vec2 b) {
    return vec2(a.x * b.x - a.y * b.y, a.y * b.x + a.x * b.y);
  }

  void main() {
    #ifdef HORIZONTAL
      float index = vUV.x * u_transformSize - 0.5;
    #else
      float index = vUV.y * u_transformSize - 0.5;
    #endif

    float evenIndex = floor(index / u_subtransformSize) * (u_subtransformSize * 0.5) + mod(index, u_subtransformSize * 0.5);

    #ifdef HORIZONTAL
      vec4 even = texture2D(u_input, vec2(evenIndex + 0.5, gl_FragCoord.y) / u_transformSize).rgba;
      vec4 odd = texture2D(u_input, vec2(evenIndex + u_transformSize * 0.5 + 0.5, gl_FragCoord.y) / u_transformSize).rgba;
    #else
      vec4 even = texture2D(u_input, vec2(gl_FragCoord.x, evenIndex + 0.5) / u_transformSize).rgba;
      vec4 odd = texture2D(u_input, vec2(gl_FragCoord.x, evenIndex + u_transformSize * 0.5 + 0.5) / u_transformSize).rgba;
    #endif

    float twiddleArgument = -2.0 * PI * (index / u_subtransformSize);
    vec2 twiddle = vec2(cos(twiddleArgument), sin(twiddleArgument));
    vec2 outputA = even.xy + multiplyComplex(twiddle, odd.xy);
    vec2 outputB = even.zw + multiplyComplex(twiddle, odd.zw);
    gl_FragColor = vec4(outputA, outputB);
  }
`

const INITIAL_SPECTRUM_SHADER = `
  const float PI = 3.14159265359;
  const float G = 9.81;
  const float KM = 370.0;
  const float CM = 0.23;

  uniform vec2 u_wind;
  uniform float u_resolution;
  uniform float u_size;
  uniform float u_heightScale;

  float square(float x) {
    return x * x;
  }

  float omega(float k) {
    return sqrt(G * k * (1.0 + square(k / KM)));
  }

  float tanhReference(float x) {
    return (1.0 - exp(-2.0 * x)) / (1.0 + exp(-2.0 * x));
  }

  void main() {
    vec2 coordinates = gl_FragCoord.xy - 0.5;
    float n = (coordinates.x < u_resolution * 0.5) ? coordinates.x : coordinates.x - u_resolution;
    float m = (coordinates.y < u_resolution * 0.5) ? coordinates.y : coordinates.y - u_resolution;
    vec2 K = (2.0 * PI * vec2(n, m)) / u_size;
    float k = length(K);
    if (k < 0.000001) {
      gl_FragColor = vec4(0.0);
      return;
    }
    float l_wind = length(u_wind);
    float Omega = 0.84;
    float kp = G * square(Omega / l_wind);
    float c = omega(k) / k;
    float cp = omega(kp) / kp;
    float Lpm = exp(-1.25 * square(kp / k));
    float gamma = 1.7;
    float sigma = 0.08 * (1.0 + 4.0 * pow(Omega, -3.0));
    float Gamma = exp(-square(sqrt(k / kp) - 1.0) / (2.0 * square(sigma)));
    float Jp = pow(gamma, Gamma);
    float Fp = Lpm * Jp * exp(-Omega / sqrt(10.0) * (sqrt(k / kp) - 1.0));
    float alphap = 0.006 * sqrt(Omega);
    float Bl = 0.5 * alphap * cp / c * Fp;
    float z0 = 0.000037 * square(l_wind) / G * pow(l_wind / cp, 0.9);
    float uStar = 0.41 * l_wind / log(10.0 / z0);
    float alpham = 0.01 * ((uStar < CM) ? (1.0 + log(uStar / CM)) : (1.0 + 3.0 * log(uStar / CM)));
    float Fm = exp(-0.25 * square(k / KM - 1.0));
    float Bh = 0.5 * alpham * CM / c * Fm * Lpm;
    float a0 = log(2.0) / 4.0;
    float am = 0.13 * uStar / CM;
    float Delta = tanhReference(a0 + 4.0 * pow(c / cp, 2.5) + am * pow(CM / c, 2.5));
    float cosPhi = dot(normalize(u_wind), normalize(K));
    float S = (1.0 / (2.0 * PI)) * pow(k, -4.0) * (Bl + Bh) * (1.0 + Delta * (2.0 * cosPhi * cosPhi - 1.0));
    float dk = 2.0 * PI / u_size;
    float h = sqrt(S / 2.0) * dk * u_heightScale;
    gl_FragColor = vec4(h, 0.0, 0.0, 0.0);
  }
`

const PHASE_SHADER = `
  const float PI = 3.14159265359;
  const float G = 9.81;
  const float KM = 370.0;

  varying vec2 vUV;

  uniform sampler2D u_phases;
  uniform float u_deltaTime;
  uniform float u_resolution;
  uniform float u_size;

  float omega(float k) {
    return sqrt(G * k * (1.0 + k * k / KM * KM));
  }

  void main() {
    vec2 coordinates = gl_FragCoord.xy - 0.5;
    float n = (coordinates.x < u_resolution * 0.5) ? coordinates.x : coordinates.x - u_resolution;
    float m = (coordinates.y < u_resolution * 0.5) ? coordinates.y : coordinates.y - u_resolution;
    vec2 waveVector = (2.0 * PI * vec2(n, m)) / u_size;
    float phase = texture2D(u_phases, vUV).r;
    float deltaPhase = omega(length(waveVector)) * u_deltaTime;
    phase = mod(phase + deltaPhase, 2.0 * PI);
    gl_FragColor = vec4(phase, 0.0, 0.0, 0.0);
  }
`

const SPECTRUM_SHADER = `
  const float PI = 3.14159265359;

  varying vec2 vUV;

  uniform float u_size;
  uniform float u_resolution;
  uniform float u_choppiness;
  uniform sampler2D u_phases;
  uniform sampler2D u_initialSpectrum;

  vec2 multiplyComplex(vec2 a, vec2 b) {
    return vec2(a.x * b.x - a.y * b.y, a.y * b.x + a.x * b.y);
  }

  vec2 multiplyByI(vec2 z) {
    return vec2(-z.y, z.x);
  }

  void main() {
    vec2 coordinates = gl_FragCoord.xy - 0.5;
    float n = (coordinates.x < u_resolution * 0.5) ? coordinates.x : coordinates.x - u_resolution;
    float m = (coordinates.y < u_resolution * 0.5) ? coordinates.y : coordinates.y - u_resolution;
    vec2 waveVector = (2.0 * PI * vec2(n, m)) / u_size;
    float phase = texture2D(u_phases, vUV).r;
    vec2 phaseVector = vec2(cos(phase), sin(phase));
    vec2 h0 = texture2D(u_initialSpectrum, vUV).rg;
    vec2 h0Star = texture2D(u_initialSpectrum, vec2(1.0 - vUV + 1.0 / u_resolution)).rg;
    h0Star.y *= -1.0;
    vec2 h = multiplyComplex(h0, phaseVector) + multiplyComplex(h0Star, vec2(phaseVector.x, -phaseVector.y));
    vec2 hX = -multiplyByI(h * (waveVector.x / length(waveVector))) * u_choppiness;
    vec2 hZ = -multiplyByI(h * (waveVector.y / length(waveVector))) * u_choppiness;
    if (waveVector.x == 0.0 && waveVector.y == 0.0) {
      h = vec2(0.0);
      hX = vec2(0.0);
      hZ = vec2(0.0);
    }
    gl_FragColor = vec4(hX + multiplyByI(h), hZ);
  }
`

const NORMAL_SHADER = `
  varying vec2 vUV;

  uniform sampler2D u_displacementMap;
  uniform float u_resolution;
  uniform float u_size;

  void main() {
    float texel = 1.0 / u_resolution;
    float texelSize = u_size / u_resolution;
    vec3 center = texture2D(u_displacementMap, vUV).rgb;
    vec3 right = vec3(texelSize, 0.0, 0.0) + texture2D(u_displacementMap, vUV + vec2(texel, 0.0)).rgb - center;
    vec3 left = vec3(-texelSize, 0.0, 0.0) + texture2D(u_displacementMap, vUV + vec2(-texel, 0.0)).rgb - center;
    vec3 top = vec3(0.0, 0.0, -texelSize) + texture2D(u_displacementMap, vUV + vec2(0.0, -texel)).rgb - center;
    vec3 bottom = vec3(0.0, 0.0, texelSize) + texture2D(u_displacementMap, vUV + vec2(0.0, texel)).rgb - center;
    vec3 topRight = cross(right, top);
    vec3 topLeft = cross(top, left);
    vec3 bottomLeft = cross(left, bottom);
    vec3 bottomRight = cross(bottom, right);
    gl_FragColor = vec4(normalize(topRight + topLeft + bottomLeft + bottomRight), 1.0);
  }
`

export class ReferenceFftOceanSimulation implements OceanSimulation {
  readonly size: number
  readonly resolution: number
  readonly mode: 'gpu' | 'cpu' = 'gpu'

  readonly material: THREE.ShaderMaterial

  private readonly renderer: THREE.WebGLRenderer
  private readonly reflectionTarget: THREE.WebGLRenderTarget
  private readonly wavePatchSize: number
  private readonly reflectionCamera = new THREE.PerspectiveCamera()
  private readonly reflectionTextureMatrix = new THREE.Matrix4()
  private readonly mirrorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private readonly clipPlane = new THREE.Vector4()
  private readonly simSize = 200
  private readonly wind = new THREE.Vector2(10, 10)
  private readonly choppiness = 3.6
  private readonly heightScale = 40_000
  private readonly displacementScale: number
  private readonly count: number
  private readonly simScene = new THREE.Scene()
  private readonly simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly screenQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2))
  private readonly initialSpectrumTarget: THREE.WebGLRenderTarget
  private readonly spectrumTarget: THREE.WebGLRenderTarget
  private readonly pingPhaseTarget: THREE.WebGLRenderTarget
  private readonly pongPhaseTarget: THREE.WebGLRenderTarget
  private readonly pingTransformTarget: THREE.WebGLRenderTarget
  private readonly pongTransformTarget: THREE.WebGLRenderTarget
  private readonly displacementMapTarget: THREE.WebGLRenderTarget
  private readonly normalMapTarget: THREE.WebGLRenderTarget
  private readonly phaseTexture: THREE.DataTexture
  private readonly horizontalMaterial: THREE.ShaderMaterial
  private readonly verticalMaterial: THREE.ShaderMaterial
  private readonly initialSpectrumMaterial: THREE.ShaderMaterial
  private readonly phaseMaterial: THREE.ShaderMaterial
  private readonly spectrumMaterial: THREE.ShaderMaterial
  private readonly normalMaterial: THREE.ShaderMaterial
  private readonly h0Re: Float32Array
  private readonly h0Im: Float32Array
  private readonly h0MinusRe: Float32Array
  private readonly h0MinusIm: Float32Array
  private readonly phase: Float32Array
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
  private readonly geometryBasePositions = new WeakMap<THREE.BufferGeometry, Float32Array>()
  private elapsedTime = 0
  private updateAccumulator = Number.POSITIVE_INFINITY
  private pingPhase = true
  private initial = true

  constructor(options: OceanSimulationOptions) {
    if (!options.renderer) {
      throw new Error('ReferenceFftOceanSimulation requires a WebGLRenderer.')
    }
    this.renderer = options.renderer
    this.size = options.size
    this.resolution = options.resolution
    this.wavePatchSize = options.wavePatchSize ?? this.size
    this.displacementScale = this.wavePatchSize / this.simSize
    this.count = this.resolution * this.resolution
    this.h0Re = new Float32Array(this.count)
    this.h0Im = new Float32Array(this.count)
    this.h0MinusRe = new Float32Array(this.count)
    this.h0MinusIm = new Float32Array(this.count)
    this.phase = new Float32Array(this.count)
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

    this.initialSpectrumTarget = this.createTarget(THREE.NearestFilter, THREE.RepeatWrapping)
    this.spectrumTarget = this.createTarget(THREE.NearestFilter, THREE.ClampToEdgeWrapping)
    this.pingPhaseTarget = this.createTarget(THREE.NearestFilter, THREE.ClampToEdgeWrapping)
    this.pongPhaseTarget = this.createTarget(THREE.NearestFilter, THREE.ClampToEdgeWrapping)
    this.pingTransformTarget = this.createTarget(THREE.NearestFilter, THREE.ClampToEdgeWrapping)
    this.pongTransformTarget = this.createTarget(THREE.NearestFilter, THREE.ClampToEdgeWrapping)
    this.displacementMapTarget = this.createTarget(THREE.LinearFilter, THREE.RepeatWrapping)
    this.normalMapTarget = this.createTarget(THREE.LinearFilter, THREE.RepeatWrapping)
    this.reflectionTarget = new THREE.WebGLRenderTarget(512, 512, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    })
    this.phaseTexture = this.createSeedPhaseTexture()
    this.simScene.add(this.screenQuad)

    this.horizontalMaterial = this.createSubtransformMaterial(true)
    this.verticalMaterial = this.createSubtransformMaterial(false)
    this.initialSpectrumMaterial = this.createInitialSpectrumMaterial()
    this.phaseMaterial = this.createPhaseMaterial()
    this.spectrumMaterial = this.createSpectrumMaterial()
    this.normalMaterial = this.createNormalMaterial()
    this.material = this.createOceanMaterial(options.sunDirection ?? new THREE.Vector3(-1, 1, 1))

    this.initializeCpuMirrorSpectrum()
    this.renderInitialSpectrum()
    this.rebuildCpuMirrorFields(0)
    this.update(1 / 30)
  }

  update(delta: number): boolean {
    this.elapsedTime += delta
    this.renderWavePhase(delta)
    this.renderSpectrum()
    this.renderSpectrumFft()
    this.renderNormalMap()

    this.updateAccumulator += delta
    let mirrorUpdated = false
    if (this.updateAccumulator >= 1 / 30) {
      this.updateAccumulator = 0
      this.advanceCpuMirror(delta)
      this.rebuildCpuMirrorFields(this.elapsedTime)
      mirrorUpdated = true
    }
    return mirrorUpdated
  }

  renderReflection(scene: THREE.Scene, camera: THREE.PerspectiveCamera, oceanMesh: THREE.Object3D): void {
    this.updateReflectionCamera(camera)
    const previousTarget = this.renderer.getRenderTarget()
    const previousXrEnabled = this.renderer.xr.enabled
    const previousShadowAutoUpdate = this.renderer.shadowMap.autoUpdate
    const wasVisible = oceanMesh.visible
    oceanMesh.visible = false
    this.renderer.xr.enabled = false
    this.renderer.shadowMap.autoUpdate = false
    this.renderer.setRenderTarget(this.reflectionTarget)
    this.renderer.clear()
    this.renderer.render(scene, this.reflectionCamera)
    this.renderer.setRenderTarget(previousTarget)
    this.renderer.xr.enabled = previousXrEnabled
    this.renderer.shadowMap.autoUpdate = previousShadowAutoUpdate
    oceanMesh.visible = wasVisible
  }

  sampleSurfaceAt(x: number, z: number): OceanSurfaceSample {
    this.reusableSample.height = this.sampleGrid(this.height, x, z)
    this.reusableSample.normal
      .set(
        this.sampleGrid(this.normalX, x, z),
        this.sampleGrid(this.normalY, x, z),
        this.sampleGrid(this.normalZ, x, z),
      )
      .normalize()
    this.reusableSample.displacement.set(
      this.sampleGrid(this.displacementX, x, z),
      this.sampleGrid(this.displacementZ, x, z),
    )
    return this.reusableSample
  }

  applyToGeometry(geometry: THREE.PlaneGeometry, centerX: number, centerZ: number): void {
    const position = geometry.attributes.position
    if (!(position instanceof THREE.BufferAttribute)) return
    let basePositions = this.geometryBasePositions.get(geometry)
    if (!basePositions) {
      basePositions = new Float32Array(position.array)
      this.geometryBasePositions.set(geometry, basePositions)
    }

    for (let i = 0; i < position.count; i += 1) {
      const baseIndex = i * 3
      const localX = basePositions[baseIndex]!
      const localZ = basePositions[baseIndex + 2]!
      const x = centerX + localX
      const z = centerZ + localZ
      position.setXYZ(
        i,
        localX + this.sampleGrid(this.displacementX, x, z),
        this.sampleGrid(this.height, x, z),
        localZ + this.sampleGrid(this.displacementZ, x, z),
      )
    }
    position.needsUpdate = true
    geometry.computeVertexNormals()
  }

  dispose(): void {
    this.screenQuad.geometry.dispose()
    this.phaseTexture.dispose()
    for (const target of [
      this.initialSpectrumTarget,
      this.spectrumTarget,
      this.pingPhaseTarget,
      this.pongPhaseTarget,
      this.pingTransformTarget,
      this.pongTransformTarget,
      this.displacementMapTarget,
      this.normalMapTarget,
      this.reflectionTarget,
    ]) {
      target.dispose()
    }
    for (const material of [
      this.horizontalMaterial,
      this.verticalMaterial,
      this.initialSpectrumMaterial,
      this.phaseMaterial,
      this.spectrumMaterial,
      this.normalMaterial,
      this.material,
    ]) {
      material.dispose()
    }
  }

  private createTarget(
    filter: THREE.MinificationTextureFilter & THREE.MagnificationTextureFilter,
    wrapping: THREE.Wrapping,
  ): THREE.WebGLRenderTarget {
    const target = new THREE.WebGLRenderTarget(this.resolution, this.resolution, {
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
      minFilter: filter,
      magFilter: filter,
      wrapS: wrapping,
      wrapT: wrapping,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    })
    target.texture.name = 'ReferenceFftOceanTarget'
    return target
  }

  private createSeedPhaseTexture(): THREE.DataTexture {
    const data = new Float32Array(this.count * 4)
    for (let i = 0; i < this.count; i += 1) {
      const p = hashToUnit(i * 747796405 + 2891336453) * TWO_PI
      data[i * 4] = p
      this.phase[i] = p
    }
    const texture = new THREE.DataTexture(data, this.resolution, this.resolution, THREE.RGBAFormat, THREE.FloatType)
    texture.minFilter = THREE.NearestFilter
    texture.magFilter = THREE.NearestFilter
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.needsUpdate = true
    return texture
  }

  private createSubtransformMaterial(horizontal: boolean): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        u_input: { value: null },
        u_transformSize: { value: this.resolution },
        u_subtransformSize: { value: 0 },
      },
      vertexShader: SIM_VERTEX_SHADER,
      fragmentShader: `${horizontal ? '#define HORIZONTAL\n' : ''}${SUBTRANSFORM_SHADER}`,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    })
  }

  private createInitialSpectrumMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        u_wind: { value: this.wind.clone() },
        u_resolution: { value: this.resolution },
        u_size: { value: this.simSize },
        u_heightScale: { value: this.heightScale },
      },
      vertexShader: SIM_VERTEX_SHADER,
      fragmentShader: INITIAL_SPECTRUM_SHADER,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    })
  }

  private createPhaseMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        u_phases: { value: null },
        u_deltaTime: { value: 0 },
        u_resolution: { value: this.resolution },
        u_size: { value: this.simSize },
      },
      vertexShader: SIM_VERTEX_SHADER,
      fragmentShader: PHASE_SHADER,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    })
  }

  private createSpectrumMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        u_size: { value: this.simSize },
        u_resolution: { value: this.resolution },
        u_choppiness: { value: this.choppiness },
        u_phases: { value: null },
        u_initialSpectrum: { value: this.initialSpectrumTarget.texture },
      },
      vertexShader: SIM_VERTEX_SHADER,
      fragmentShader: SPECTRUM_SHADER,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    })
  }

  private createNormalMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        u_displacementMap: { value: this.displacementMapTarget.texture },
        u_resolution: { value: this.resolution },
        u_size: { value: this.simSize },
      },
      vertexShader: SIM_VERTEX_SHADER,
      fragmentShader: NORMAL_SHADER,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    })
  }

  private createOceanMaterial(sunDirection: THREE.Vector3): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      fog: true,
      side: THREE.DoubleSide,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uDisplacementMap: { value: this.displacementMapTarget.texture },
          uNormalMap: { value: this.normalMapTarget.texture },
          uReflection: { value: this.reflectionTarget.texture },
          uMirrorMatrix: { value: this.reflectionTextureMatrix },
          uSize: { value: this.simSize },
          uWavePatchSize: { value: this.wavePatchSize },
          uDisplacementScale: { value: this.displacementScale },
          uOceanColor: { value: new THREE.Color(0x90aebe) },
          uSkyColor: { value: new THREE.Color(0xa8d8ff) },
          uSunDirection: { value: sunDirection.clone().normalize() },
          uExposure: { value: 0.15 },
        },
      ]),
      vertexShader: `
        uniform float uWavePatchSize;
        uniform mat4 uMirrorMatrix;

        varying vec3 vWorldPosition;
        varying vec3 vWorldNormal;
        varying vec2 vOceanUv;
        varying vec4 vReflectCoordinates;
        varying vec3 vCamPosition;

        #include <fog_pars_vertex>

        void main() {
          vec4 worldBase = modelMatrix * vec4(position, 1.0);
          vCamPosition = cameraPosition;
          vOceanUv = fract(worldBase.xz / uWavePatchSize + 0.5);
          vWorldPosition = worldBase.xyz;
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          vReflectCoordinates = uMirrorMatrix * worldBase;
          vec4 mvPosition = viewMatrix * vec4(vWorldPosition, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: `
        uniform sampler2D uNormalMap;
        uniform sampler2D uReflection;
        uniform vec3 uOceanColor;
        uniform vec3 uSkyColor;
        uniform vec3 uSunDirection;
        uniform float uExposure;

        varying vec3 vWorldPosition;
        varying vec3 vWorldNormal;
        varying vec2 vOceanUv;
        varying vec4 vReflectCoordinates;
        varying vec3 vCamPosition;

        #include <fog_pars_fragment>

        vec3 hdr(vec3 color, float exposure) {
          return 1.0 - exp(-color * exposure);
        }

        void main() {
          vec3 normal = texture2D(uNormalMap, vOceanUv).rgb;
          normal = normalize(normal + normalize(vWorldNormal) * 0.18);
          if (!gl_FrontFacing) normal = -normal;

          vec3 viewDirection = normalize(vCamPosition - vWorldPosition);
          vec3 reflection = normalize(reflect(-uSunDirection, normal));
          float specularPower = 500.0;
          float specularFactor = pow(max(0.0, dot(viewDirection, reflection)), specularPower) * 10.0;
          vec3 distortion = 90.0 * normal * vec3(1.0, 0.0, 0.1);
          vec3 reflectionColor = texture2DProj(uReflection, vReflectCoordinates + vec4(distortion, 0.0)).rgb;
          float distanceRatio = min(1.0, log(1.0 / length(vCamPosition - vWorldPosition) * 3000.0 + 1.0));
          distanceRatio = distanceRatio * distanceRatio * 0.7 + 0.3;
          normal = normalize((distanceRatio * normal + vec3(0.0, 1.0 - distanceRatio, 0.0)) * 0.5);
          float fresnel = pow(1.0 - max(dot(normal, viewDirection), 0.0), 2.0);
          float skyFactor = (fresnel + 0.2) * 3.2;
          vec3 waterColor = (1.0 - fresnel) * uOceanColor;
          vec3 reflectedSky = mix(reflectionColor, uSkyColor, clamp(skyFactor * 0.15, 0.0, 1.0));
          vec3 color = (skyFactor + specularFactor + waterColor) * reflectedSky + waterColor * 0.5;
          color = hdr(color, uExposure);
          gl_FragColor = vec4(color, 1.0);

          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `,
    })
  }

  updateVisualState(options: {
    oceanColor?: THREE.Color
    skyColor?: THREE.Color
    exposure?: number
    sunDirection?: THREE.Vector3
  }): void {
    if (options.oceanColor) {
      ;(this.material.uniforms.uOceanColor?.value as THREE.Color | undefined)?.copy(options.oceanColor)
    }
    if (options.skyColor) {
      ;(this.material.uniforms.uSkyColor?.value as THREE.Color | undefined)?.copy(options.skyColor)
    }
    if (options.exposure !== undefined) this.material.uniforms.uExposure!.value = options.exposure
    if (options.sunDirection) {
      ;(this.material.uniforms.uSunDirection?.value as THREE.Vector3 | undefined)
        ?.copy(options.sunDirection)
        .normalize()
    }
  }

  private updateReflectionCamera(camera: THREE.PerspectiveCamera): void {
    camera.updateMatrixWorld()
    this.reflectionCamera.copy(camera)
    this.reflectionCamera.position.y *= -1
    this.reflectionCamera.up.set(camera.up.x, -camera.up.y, camera.up.z)
    const lookDirection = new THREE.Vector3()
    camera.getWorldDirection(lookDirection)
    lookDirection.y *= -1
    this.reflectionCamera.lookAt(this.reflectionCamera.position.clone().add(lookDirection))
    this.reflectionCamera.updateMatrixWorld()
    this.reflectionCamera.matrixWorldInverse.copy(this.reflectionCamera.matrixWorld).invert()

    this.reflectionTextureMatrix.set(
      0.5, 0.0, 0.0, 0.5,
      0.0, 0.5, 0.0, 0.5,
      0.0, 0.0, 0.5, 0.5,
      0.0, 0.0, 0.0, 1.0,
    )
    this.reflectionTextureMatrix.multiply(this.reflectionCamera.projectionMatrix)
    this.reflectionTextureMatrix.multiply(this.reflectionCamera.matrixWorldInverse)

    this.mirrorPlane.set(new THREE.Vector3(0, 1, 0), 0)
    this.mirrorPlane.applyMatrix4(this.reflectionCamera.matrixWorldInverse)
    this.clipPlane.set(
      this.mirrorPlane.normal.x,
      this.mirrorPlane.normal.y,
      this.mirrorPlane.normal.z,
      this.mirrorPlane.constant,
    )
  }

  private renderInitialSpectrum(): void {
    this.renderToTarget(this.initialSpectrumMaterial, this.initialSpectrumTarget)
  }

  private renderWavePhase(delta: number): void {
    this.phaseMaterial.uniforms.u_phases!.value = this.initial
      ? this.phaseTexture
      : this.pingPhase
        ? this.pingPhaseTarget.texture
        : this.pongPhaseTarget.texture
    this.phaseMaterial.uniforms.u_deltaTime!.value = delta
    this.renderToTarget(this.phaseMaterial, this.pingPhase ? this.pongPhaseTarget : this.pingPhaseTarget)
    this.initial = false
    this.pingPhase = !this.pingPhase
  }

  private renderSpectrum(): void {
    this.spectrumMaterial.uniforms.u_initialSpectrum!.value = this.initialSpectrumTarget.texture
    this.spectrumMaterial.uniforms.u_phases!.value = this.pingPhase
      ? this.pingPhaseTarget.texture
      : this.pongPhaseTarget.texture
    this.renderToTarget(this.spectrumMaterial, this.spectrumTarget)
  }

  private renderSpectrumFft(): void {
    const iterations = Math.log2(this.resolution) * 2
    let material = this.horizontalMaterial

    for (let i = 0; i < iterations; i += 1) {
      let input: THREE.Texture
      let output: THREE.WebGLRenderTarget
      if (i === 0) {
        input = this.spectrumTarget.texture
        output = this.pingTransformTarget
      } else if (i === iterations - 1) {
        input = (iterations % 2 === 0 ? this.pingTransformTarget : this.pongTransformTarget).texture
        output = this.displacementMapTarget
      } else if (i % 2 === 1) {
        input = this.pingTransformTarget.texture
        output = this.pongTransformTarget
      } else {
        input = this.pongTransformTarget.texture
        output = this.pingTransformTarget
      }

      if (i === iterations / 2) material = this.verticalMaterial
      material.uniforms.u_input!.value = input
      material.uniforms.u_subtransformSize!.value = Math.pow(2, (i % (iterations / 2)) + 1)
      this.renderToTarget(material, output)
    }
  }

  private renderNormalMap(): void {
    this.normalMaterial.uniforms.u_displacementMap!.value = this.displacementMapTarget.texture
    this.renderToTarget(this.normalMaterial, this.normalMapTarget)
  }

  private renderToTarget(material: THREE.Material, target: THREE.WebGLRenderTarget): void {
    const previousTarget = this.renderer.getRenderTarget()
    const previousAutoClear = this.renderer.autoClear
    this.screenQuad.material = material
    this.renderer.setRenderTarget(target)
    this.renderer.autoClear = true
    this.renderer.clear()
    this.renderer.render(this.simScene, this.simCamera)
    this.renderer.setRenderTarget(previousTarget)
    this.renderer.autoClear = previousAutoClear
  }

  private initializeCpuMirrorSpectrum(): void {
    const n = this.resolution
    for (let y = 0; y < n; y += 1) {
      const frequencyY = y < n / 2 ? y : y - n
      const kz = TWO_PI * frequencyY / this.simSize
      for (let x = 0; x < n; x += 1) {
        const frequencyX = x < n / 2 ? x : x - n
        const kx = TWO_PI * frequencyX / this.simSize
        const index = y * n + x
        const k = Math.hypot(kx, kz)
        const amplitude = this.referenceSpectrumAmplitude(kx, kz)
        this.waveNumberX[index] = kx
        this.waveNumberZ[index] = kz
        this.omega[index] = referenceOmega(Math.max(k, MIN_WAVE_NUMBER))
        this.h0Re[index] = amplitude
        this.h0Im[index] = 0
      }
    }

    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        const index = y * n + x
        const minusIndex = ((n - y) % n) * n + ((n - x) % n)
        this.h0MinusRe[index] = this.h0Re[minusIndex]!
        this.h0MinusIm[index] = -this.h0Im[minusIndex]!
      }
    }
  }

  private advanceCpuMirror(delta: number): void {
    for (let i = 0; i < this.phase.length; i += 1) {
      this.phase[i] = (this.phase[i]! + this.omega[i]! * delta) % TWO_PI
    }
  }

  private rebuildCpuMirrorFields(_time: number): void {
    const height = this.spectrum.height
    const displaceX = this.spectrum.displaceX
    const displaceZ = this.spectrum.displaceZ

    for (let i = 0; i < this.count; i += 1) {
      const cosPhase = Math.cos(this.phase[i]!)
      const sinPhase = Math.sin(this.phase[i]!)
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
      const kx = this.waveNumberX[i]!
      const kz = this.waveNumberZ[i]!
      const kLength = Math.max(Math.hypot(kx, kz), MIN_WAVE_NUMBER)

      height.re[i] = hRe
      height.im[i] = hIm
      displaceX.re[i] = hIm * (kx / kLength) * this.choppiness
      displaceX.im[i] = -hRe * (kx / kLength) * this.choppiness
      displaceZ.re[i] = hIm * (kz / kLength) * this.choppiness
      displaceZ.im[i] = -hRe * (kz / kLength) * this.choppiness
    }

    inverseFft2d(height, this.resolution)
    inverseFft2d(displaceX, this.resolution)
    inverseFft2d(displaceZ, this.resolution)

    for (let i = 0; i < this.count; i += 1) {
      this.height[i] = height.re[i]! * this.displacementScale
      this.displacementX[i] = displaceX.re[i]! * this.displacementScale
      this.displacementZ[i] = displaceZ.re[i]! * this.displacementScale
    }
    this.rebuildCpuMirrorNormals()
  }

  private referenceSpectrumAmplitude(kx: number, kz: number): number {
    const k = Math.hypot(kx, kz)
    if (k < MIN_WAVE_NUMBER) return 0
    const windLength = this.wind.length()
    const kp = GRAVITY * square(0.84 / windLength)
    const c = referenceOmega(k) / k
    const cp = referenceOmega(kp) / kp
    const lpm = Math.exp(-1.25 * square(kp / k))
    const sigma = 0.08 * (1 + 4 * Math.pow(0.84, -3))
    const gammaPeak = Math.exp(-square(Math.sqrt(k / kp) - 1) / (2 * square(sigma)))
    const jp = Math.pow(1.7, gammaPeak)
    const fp = lpm * jp * Math.exp((-0.84 / Math.sqrt(10)) * (Math.sqrt(k / kp) - 1))
    const alphap = 0.006 * Math.sqrt(0.84)
    const bl = 0.5 * alphap * (cp / c) * fp
    const z0 = 0.000037 * square(windLength) / GRAVITY * Math.pow(windLength / cp, 0.9)
    const uStar = 0.41 * windLength / Math.log(10 / Math.max(z0, 1e-7))
    const alpham =
      0.01 *
      (uStar < MINIMUM_PHASE_SPEED
        ? 1 + Math.log(Math.max(uStar / MINIMUM_PHASE_SPEED, 1e-7))
        : 1 + 3 * Math.log(uStar / MINIMUM_PHASE_SPEED))
    const fm = Math.exp(-0.25 * square(k / CAPILLARY_WAVE_NUMBER - 1))
    const bh = 0.5 * alpham * (MINIMUM_PHASE_SPEED / c) * fm * lpm
    const a0 = Math.log(2) / 4
    const am = 0.13 * uStar / MINIMUM_PHASE_SPEED
    const delta = Math.tanh(a0 + 4 * Math.pow(c / cp, 2.5) + am * Math.pow(MINIMUM_PHASE_SPEED / c, 2.5))
    const cosPhi = new THREE.Vector2(kx / k, kz / k).dot(this.wind.clone().normalize())
    const spectralDensity = (1 / TWO_PI) * Math.pow(k, -4) * (bl + bh) * (1 + delta * (2 * cosPhi * cosPhi - 1))
    const dk = TWO_PI / this.simSize
    return Math.sqrt(Math.max(spectralDensity, 0) / 2) * dk * this.heightScale
  }

  private rebuildCpuMirrorNormals(): void {
    const n = this.resolution
    const cellSize = this.wavePatchSize / n
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

  private displacedVector(x: number, y: number, centerIndex: number, baseX: number, baseZ: number): THREE.Vector3 {
    const neighborIndex = y * this.resolution + x
    return new THREE.Vector3(
      baseX + this.displacementX[neighborIndex]! - this.displacementX[centerIndex]!,
      this.height[neighborIndex]! - this.height[centerIndex]!,
      baseZ + this.displacementZ[neighborIndex]! - this.displacementZ[centerIndex]!,
    )
  }

  private sampleGrid(field: Float32Array, x: number, z: number): number {
    const n = this.resolution
    const cellSize = this.wavePatchSize / n
    const u = positiveModulo(x + this.wavePatchSize / 2, this.wavePatchSize) / cellSize
    const v = positiveModulo(z + this.wavePatchSize / 2, this.wavePatchSize) / cellSize
    const x0 = Math.floor(u) % n
    const z0 = Math.floor(v) % n
    const x1 = (x0 + 1) % n
    const z1 = (z0 + 1) % n
    const tx = u - Math.floor(u)
    const tz = v - Math.floor(v)
    const a = field[z0 * n + x0]!
    const b = field[z0 * n + x1]!
    const c = field[z1 * n + x0]!
    const d = field[z1 * n + x1]!
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), tz)
  }
}
