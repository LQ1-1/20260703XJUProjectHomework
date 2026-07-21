import * as THREE from 'three'

export type WaveSettings = {
  primarySwell: number
  crossSwell: number
  mediumChoppyWaves: number
  lightRipples: number
}

type CreateProceduralOceanOptions = {
  oceanSize: number
  oceanSegments: number
  sunDirection: THREE.Vector3
  waves: WaveSettings
}

const FOAM_ASSET_ROOT = '/assets/Foam003_1K-JPG'

function loadRepeatingDataTexture(path: string): THREE.Texture {
  const texture = new THREE.TextureLoader().load(path)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.NoColorSpace
  return texture
}

export function proceduralWaveHeight(x: number, z: number, time: number, waves: WaveSettings) {
  return (
    Math.sin(x * 0.075 + time * 0.85) * waves.primarySwell +
    Math.sin(z * 0.095 + time * 0.68) * waves.crossSwell +
    Math.sin((x + z) * 0.14 + time * 1.1) * waves.mediumChoppyWaves +
    Math.sin(x * 0.32 - z * 0.27 + time * 1.8) * waves.lightRipples
  )
}

export function createProceduralOcean({
  oceanSize,
  oceanSegments,
  sunDirection,
  waves,
}: CreateProceduralOceanOptions) {
  const geometry = new THREE.PlaneGeometry(oceanSize, oceanSize, oceanSegments, oceanSegments)
  geometry.rotateX(-Math.PI / 2)
  const foamMask = loadRepeatingDataTexture(`${FOAM_ASSET_ROOT}/Foam003_1K-JPG_Opacity.jpg`)
  const foamNormal = loadRepeatingDataTexture(`${FOAM_ASSET_ROOT}/Foam003_1K-JPG_NormalGL.jpg`)

  const material = new THREE.ShaderMaterial({
    fog: true,
    side: THREE.DoubleSide,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uDeepColor: { value: new THREE.Color(0x012f4d) },
        uShallowColor: { value: new THREE.Color(0x147b96) },
        uSunColor: { value: new THREE.Color(0xfff1c0) },
        uSunDirection: { value: sunDirection.clone() },
        uPrimarySwell: { value: waves.primarySwell },
        uCrossSwell: { value: waves.crossSwell },
        uMediumChoppyWaves: { value: waves.mediumChoppyWaves },
        uLightRipples: { value: waves.lightRipples },
        uFoamMask: { value: foamMask },
        uFoamNormal: { value: foamNormal },
      },
    ]),
    vertexShader: `
      uniform float uTime;
      uniform float uPrimarySwell;
      uniform float uCrossSwell;
      uniform float uMediumChoppyWaves;
      uniform float uLightRipples;
      uniform sampler2D uFoamMask;
      uniform sampler2D uFoamNormal;

      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;

      #include <fog_pars_vertex>

      void main() {
        vec4 worldBase = modelMatrix * vec4(position, 1.0);
        float x = worldBase.x;
        float z = worldBase.z;

        float wave1 = sin(x * 0.075 + uTime * 0.85) * uPrimarySwell;
        float wave2 = sin(z * 0.095 + uTime * 0.68) * uCrossSwell;
        float wave3 = sin((x + z) * 0.14 + uTime * 1.1) * uMediumChoppyWaves;
        float wave4 = sin(x * 0.32 - z * 0.27 + uTime * 1.8) * uLightRipples;
        float height = wave1 + wave2 + wave3 + wave4;

        float slopeX =
          cos(x * 0.075 + uTime * 0.85) * uPrimarySwell * 0.075 +
          cos((x + z) * 0.14 + uTime * 1.1) * uMediumChoppyWaves * 0.14 +
          cos(x * 0.32 - z * 0.27 + uTime * 1.8) * uLightRipples * 0.32;
        float slopeZ =
          cos(z * 0.095 + uTime * 0.68) * uCrossSwell * 0.095 +
          cos((x + z) * 0.14 + uTime * 1.1) * uMediumChoppyWaves * 0.14 -
          cos(x * 0.32 - z * 0.27 + uTime * 1.8) * uLightRipples * 0.27;

        vWorldPosition = vec3(x, worldBase.y + height, z);
        vWorldNormal = normalize(vec3(-slopeX * 2.8, 1.0, -slopeZ * 2.8));

        vec4 mvPosition = viewMatrix * vec4(vWorldPosition, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uDeepColor;
      uniform vec3 uShallowColor;
      uniform vec3 uSunColor;
      uniform vec3 uSunDirection;
      uniform sampler2D uFoamMask;
      uniform sampler2D uFoamNormal;

      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;

      #include <fog_pars_fragment>

      void main() {
        vec3 normal = normalize(vWorldNormal);
        if (!gl_FrontFacing) normal = -normal;

        float rippleX =
          sin(vWorldPosition.x * 0.42 + uTime * 2.1) * 0.075 +
          sin((vWorldPosition.x + vWorldPosition.z) * 0.68 - uTime * 1.7) * 0.035;
        float rippleZ =
          cos(vWorldPosition.z * 0.5 + uTime * 1.8) * 0.07 +
          cos((vWorldPosition.x - vWorldPosition.z) * 0.74 + uTime * 1.35) * 0.03;
        normal = normalize(normal + vec3(rippleX, 0.0, rippleZ));

        // 两层泡沫纹理以不同速度交错移动，避免规则的平铺痕迹。
        vec2 foamUvA = vWorldPosition.xz * 0.075 + vec2(uTime * 0.012, -uTime * 0.018);
        vec2 foamUvB = vWorldPosition.zx * 0.118 + vec2(-uTime * 0.021, uTime * 0.014);
        float foamMask = texture2D(uFoamMask, foamUvA).r;
        foamMask = max(foamMask, texture2D(uFoamMask, foamUvB).r * 0.72);
        vec3 foamNormal = texture2D(uFoamNormal, foamUvA).xyz * 2.0 - 1.0;
        normal = normalize(normal + vec3(foamNormal.x, 0.0, foamNormal.y) * 0.16);

        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        float diffuse = max(dot(normal, uSunDirection), 0.0);
        float fresnel = pow(1.0 - max(dot(viewDirection, normal), 0.0), 2.4);

        vec3 halfDirection = normalize(uSunDirection + viewDirection);
        float specular = pow(max(dot(normal, halfDirection), 0.0), 68.0);
        float crest = smoothstep(0.72, 1.3, vWorldPosition.y);
        float foam = smoothstep(0.34, 0.72, foamMask) * smoothstep(0.38, 1.08, crest);
        float movingGlint =
          pow(max(sin(vWorldPosition.x * 0.3 + vWorldPosition.z * 0.22 + uTime * 1.4), 0.0), 10.0);

        vec3 waterColor = mix(uDeepColor, uShallowColor, 0.28 + crest * 0.35);
        waterColor *= 0.68 + diffuse * 0.5;
        waterColor += uSunColor * specular * 0.95;
        waterColor += uSunColor * movingGlint * crest * 0.16;
        waterColor += vec3(0.055, 0.19, 0.27) * fresnel * 0.72;
        waterColor = mix(waterColor, vec3(0.68, 0.9, 0.96), crest * 0.16);
        waterColor = mix(waterColor, vec3(0.88, 0.96, 0.98), foam * 0.72);

        gl_FragColor = vec4(waterColor, 1.0);

        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  })

  const ocean = new THREE.Mesh(geometry, material)
  ocean.name = 'ProceduralOcean'
  ocean.frustumCulled = false
  return ocean
}

export function updateProceduralOcean(
  ocean: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>,
  submarineRoot: THREE.Object3D,
  delta: number,
  oceanTime: number,
  waves: WaveSettings,
) {
  const nextOceanTime = oceanTime + delta
  ocean.material.uniforms.uTime!.value = nextOceanTime
  ocean.position.x = submarineRoot.position.x
  ocean.position.z = submarineRoot.position.z
  const sampledWaterHeight = proceduralWaveHeight(
    submarineRoot.position.x,
    submarineRoot.position.z,
    nextOceanTime,
    waves,
  )

  return { oceanTime: nextOceanTime, sampledWaterHeight }
}
