import * as THREE from 'three'

export function normalizeSubmarine(
  submarine: THREE.Object3D,
  modelLengthScene: number,
  surfaceModelOffset: number,
) {
  const box = new THREE.Box3().setFromObject(submarine)
  const size = box.getSize(new THREE.Vector3())
  const longestSide = Math.max(size.x, size.y, size.z)

  if (longestSide > 0) {
    submarine.scale.multiplyScalar(modelLengthScene / longestSide)
  }

  const normalizedBox = new THREE.Box3().setFromObject(submarine)
  const center = normalizedBox.getCenter(new THREE.Vector3())
  submarine.position.x -= center.x
  submarine.position.z -= center.z
  submarine.position.y -= center.y + surfaceModelOffset
}

export function tuneSubmarineMaterials(submarine: THREE.Object3D) {
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

export function tuneSunMaterials(sun: THREE.Object3D) {
  sun.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) material.dispose()
    child.material = new THREE.MeshBasicMaterial({
      color: 0xfff2b6,
      fog: false,
      toneMapped: false,
    })
  })
}

export function disposeObject(object: THREE.Object3D) {
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
