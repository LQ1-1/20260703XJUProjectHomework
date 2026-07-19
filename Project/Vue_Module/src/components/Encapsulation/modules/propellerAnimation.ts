import * as THREE from 'three'

type PropellerAxis = 'x' | 'y' | 'z'

export interface PropellerSearchOptions {
  names?: string[]
  axis?: PropellerAxis
  splitMeshByAxis?: PropellerAxis
  tailSign?: 1 | -1
  tailRegionRatio?: number
  maxMeshLengthRatio?: number
  maxPropellers?: number
  label?: string
  warnWhenEmpty?: boolean
}

export interface PropellerRotationOptions {
  axis?: PropellerAxis
  spinMultiplier?: number
  directionMultiplier?: 1 | -1
  minSpeed?: number
}

const AXIS_INDEX: Record<PropellerAxis, number> = {
  x: 0,
  y: 1,
  z: 2,
}

const warnedLabels = new Set<string>()
const loggedLabels = new Set<string>()

export function findPropellerMeshes(
  model: THREE.Object3D,
  options: PropellerSearchOptions = {},
): THREE.Object3D[] {
  const namedPropellers = findMeshesByNames(model, options.names)
  if (namedPropellers.length > 0) {
    const propellers = preparePropellerMeshes(namedPropellers, options)
    logMatchedPropellers(propellers, options)
    return propellers
  }

  const axis = options.axis ?? 'x'
  const axisIndex = AXIS_INDEX[axis]
  const tailSign = options.tailSign ?? -1
  const tailRegionRatio = options.tailRegionRatio ?? 0.22
  const maxMeshLengthRatio = options.maxMeshLengthRatio ?? 0.08
  const maxPropellers = options.maxPropellers ?? 2

  model.updateMatrixWorld(true)

  const modelBox = new THREE.Box3().setFromObject(model)
  if (modelBox.isEmpty()) return []

  const modelSize = modelBox.getSize(new THREE.Vector3())
  const modelLength = modelSize.getComponent(axisIndex)
  if (modelLength <= 0) return []

  const axisMin = modelBox.min.getComponent(axisIndex)
  const axisMax = modelBox.max.getComponent(axisIndex)
  const tailBoundary =
    tailSign > 0
      ? axisMax - modelLength * tailRegionRatio
      : axisMin + modelLength * tailRegionRatio

  const candidates: Array<{
    object: THREE.Object3D
    tailDistance: number
    sizeRatio: number
  }> = []

  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return

    const box = new THREE.Box3().setFromObject(child)
    if (box.isEmpty()) return

    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const centerOnAxis = center.getComponent(axisIndex)
    const isInTailRegion = tailSign > 0 ? centerOnAxis >= tailBoundary : centerOnAxis <= tailBoundary
    if (!isInTailRegion) return

    const longestSide = Math.max(size.x, size.y, size.z)
    const sizeRatio = longestSide / modelLength
    if (sizeRatio > maxMeshLengthRatio) return

    const tailDistance = tailSign > 0 ? axisMax - centerOnAxis : centerOnAxis - axisMin
    candidates.push({ object: child, tailDistance, sizeRatio })
  })

  candidates.sort((a, b) => {
    const tailDiff = a.tailDistance - b.tailDistance
    if (Math.abs(tailDiff) > modelLength * 0.01) return tailDiff
    return a.sizeRatio - b.sizeRatio
  })

  const propellers = preparePropellerMeshes(
    candidates.slice(0, maxPropellers).map((candidate) => candidate.object),
    options,
  )
  logMatchedPropellers(propellers, options)
  warnMissingPropellers(propellers, options)
  return propellers
}

function preparePropellerMeshes(
  propellers: THREE.Object3D[],
  options: PropellerSearchOptions,
): THREE.Object3D[] {
  const splitMeshByAxis = options.splitMeshByAxis
  if (!splitMeshByAxis) return propellers

  return propellers.flatMap((propeller) => {
    if (!(propeller instanceof THREE.Mesh)) return [propeller]
    const splitPropellers = splitMeshIntoSelfRotatingParts(propeller, splitMeshByAxis)
    return splitPropellers.length > 0 ? splitPropellers : [propeller]
  })
}

function splitMeshIntoSelfRotatingParts(
  mesh: THREE.Mesh,
  splitAxis: PropellerAxis,
): THREE.Object3D[] {
  const parent = mesh.parent
  if (!parent) return []

  const geometry = mesh.geometry
  const position = geometry.getAttribute('position')
  if (!(position instanceof THREE.BufferAttribute)) return []

  const splitAxisIndex = AXIS_INDEX[splitAxis]
  const geometryParts = splitGeometryByTriangleCentroid(geometry, splitAxisIndex)
  if (geometryParts.length < 2) return []

  const wrapper = new THREE.Group()
  wrapper.name = `${mesh.name || 'propeller'}_self_rotating_parts`
  wrapper.position.copy(mesh.position)
  wrapper.rotation.copy(mesh.rotation)
  wrapper.scale.copy(mesh.scale)
  parent.add(wrapper)

  mesh.visible = false

  return geometryParts.map((partGeometry, index) => {
    partGeometry.computeBoundingBox()
    const center = partGeometry.boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3()
    partGeometry.translate(-center.x, -center.y, -center.z)

    const pivot = new THREE.Group()
    pivot.name = `${mesh.name || 'propeller'}_pivot_${index + 1}`
    pivot.position.copy(center)

    const partMesh = new THREE.Mesh(partGeometry, mesh.material)
    partMesh.name = `${mesh.name || 'propeller'}_part_${index + 1}`
    partMesh.castShadow = mesh.castShadow
    partMesh.receiveShadow = mesh.receiveShadow
    pivot.add(partMesh)
    wrapper.add(pivot)

    return pivot
  })
}

function splitGeometryByTriangleCentroid(
  geometry: THREE.BufferGeometry,
  splitAxisIndex: number,
): THREE.BufferGeometry[] {
  const sourceGeometry = geometry.index ? geometry : geometry.toNonIndexed()
  const index = sourceGeometry.index
  const position = sourceGeometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!position) return []

  const attributes = Object.entries(sourceGeometry.attributes).filter(
    ([, attribute]) => attribute instanceof THREE.BufferAttribute,
  ) as Array<[string, THREE.BufferAttribute]>
  const partValues: [Map<string, number[]>, Map<string, number[]>] = [
    new Map<string, number[]>(),
    new Map<string, number[]>(),
  ]

  for (const [name] of attributes) {
    partValues[0].set(name, [])
    partValues[1].set(name, [])
  }

  const triangleCount = index ? index.count / 3 : position.count / 3
  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    const vertexIndices = [0, 1, 2].map((offset) =>
      index ? index.getX(triangleIndex * 3 + offset) : triangleIndex * 3 + offset,
    )
    const centroid =
      vertexIndices.reduce((sum, vertexIndex) => sum + position.getComponent(vertexIndex, splitAxisIndex), 0) / 3
    const partIndex = centroid < 0 ? 0 : 1
    const targetPartValues = partValues[partIndex]

    for (const vertexIndex of vertexIndices) {
      for (const [name, attribute] of attributes) {
        const values = targetPartValues.get(name)
        if (!values) continue
        for (let itemIndex = 0; itemIndex < attribute.itemSize; itemIndex += 1) {
          values.push(attribute.getComponent(vertexIndex, itemIndex))
        }
      }
    }
  }

  return partValues
    .map((valuesByAttribute) => {
      const partGeometry = new THREE.BufferGeometry()
      for (const [name, attribute] of attributes) {
        const values = valuesByAttribute.get(name) ?? []
        if (values.length === 0) return null
        partGeometry.setAttribute(
          name,
          new THREE.BufferAttribute(new Float32Array(values), attribute.itemSize, attribute.normalized),
        )
      }
      return partGeometry
    })
    .filter((partGeometry): partGeometry is THREE.BufferGeometry => Boolean(partGeometry))
}

function findMeshesByNames(
  model: THREE.Object3D,
  names: string[] | undefined,
): THREE.Object3D[] {
  if (!names || names.length === 0) return []

  const wantedNames = new Set(names.flatMap(expandObjectNameAliases))
  const baseNameCounts = new Map<string, number>()
  const matches: THREE.Object3D[] = []

  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return

    const duplicateName = duplicateObjectName(child.name, baseNameCounts)
    if (wantedNames.has(child.name) || wantedNames.has(duplicateName)) {
      matches.push(child)
    }
  })

  return matches
}

function duplicateObjectName(name: string, baseNameCounts: Map<string, number>): string {
  const count = baseNameCounts.get(name) ?? 0
  baseNameCounts.set(name, count + 1)
  return count === 0 ? name : `${name}.${String(count).padStart(3, '0')}`
}

function expandObjectNameAliases(name: string): string[] {
  const aliases = new Set([name])
  const dotMatch = /^(.+)\.(\d{3})$/.exec(name)
  if (dotMatch) {
    const baseName = dotMatch[1] ?? ''
    const index = Number(dotMatch[2])
    aliases.add(`${baseName}.${String(index).padStart(3, '0')}`)
    aliases.add(`${baseName}_${index}`)
  }

  const underscoreMatch = /^(.+)_(\d+)$/.exec(name)
  if (underscoreMatch) {
    const baseName = underscoreMatch[1] ?? ''
    const index = Number(underscoreMatch[2])
    aliases.add(`${baseName}_${index}`)
    aliases.add(`${baseName}.${String(index).padStart(3, '0')}`)
  }

  return [...aliases]
}

export function updatePropellerRotation(
  propellers: THREE.Object3D[],
  currentSpeed: number,
  delta: number,
  options: PropellerRotationOptions = {},
): void {
  if (propellers.length === 0 || delta <= 0) return

  const minSpeed = options.minSpeed ?? 0.0001
  if (Math.abs(currentSpeed) < minSpeed) return

  const axis = options.axis ?? 'x'
  const spinMultiplier = options.spinMultiplier ?? 35
  const directionMultiplier = options.directionMultiplier ?? 1
  const rotationDelta = currentSpeed * spinMultiplier * directionMultiplier * delta

  for (const propeller of propellers) {
    propeller.rotation[axis] += rotationDelta
  }
}

function warnMissingPropellers(
  propellers: THREE.Object3D[],
  options: PropellerSearchOptions,
): void {
  if (propellers.length > 0 || options.warnWhenEmpty === false || !import.meta.env.DEV) return

  const label = options.label ?? 'model'
  if (warnedLabels.has(label)) return
  warnedLabels.add(label)
  console.warn(`[propellerAnimation] No propeller mesh found for ${label}.`)
}

function logMatchedPropellers(
  propellers: THREE.Object3D[],
  options: PropellerSearchOptions,
): void {
  if (propellers.length === 0 || !import.meta.env.DEV) return

  const label = options.label ?? 'model'
  if (loggedLabels.has(label)) return
  loggedLabels.add(label)
  console.info(
    `[propellerAnimation] ${label} propeller mesh: ${propellers
      .map((propeller) => propeller.name || propeller.uuid)
      .join(', ')}`,
  )
}
