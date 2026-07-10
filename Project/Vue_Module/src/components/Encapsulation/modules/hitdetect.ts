import * as THREE from 'three'
import type { Updatable } from '../engine/GameEngine'
import type { SubmarineController } from '../uboot/SubmarineController'
import type { CargoShipController } from '../cargoship/CargoShipController'
import type { TorpedorController } from '../torpedor/TorpedorController'

export type CollisionEntityType = 'submarine' | 'cargoShip' | 'torpedo'

export interface CollisionSphere {
  id: string
  offset: THREE.Vector3
  radius: number
}

export interface CollisionEntitySnapshot {
  id: string
  type: CollisionEntityType
  root: THREE.Object3D
  controller: CollisionHandler
  radius: number
  position: THREE.Vector3
}

export interface CollisionEvent {
  id: string
  pairKey: string
  timeMs: number
  timeSeconds: number

  //这一次碰撞中的实体参与方, 顺序来自HitDetectSystem内部遍历注册表时的顺序。也就是说，谁先注册、谁在循环里先被取到，谁就可能是 a。
  a: CollisionEntitySnapshot
  b: CollisionEntitySnapshot


  sphereAId: string
  sphereBId: string
  distance: number
  penetrationDepth: number
  contactPoint: THREE.Vector3
}

export interface CollisionHandler {
  handleCollision(event: CollisionEvent, self: CollisionEntitySnapshot): void
}

export interface CollisionEntity {
  id: string
  type: CollisionEntityType
  root: THREE.Object3D
  controller: CollisionHandler
  spheres: CollisionSphere[]
  createdAtSeconds?: number
  collisionDelaySeconds?: number
  enabled?: boolean
  isEnabled?: () => boolean
}

export interface HitDetectSystemOptions {
  scene?: THREE.Scene
  debugVisible?: boolean
  logCollisions?: boolean
}

interface RegisteredCollisionEntity extends CollisionEntity {
  roughRadius: number
  debugMeshes: THREE.Mesh[]
}

interface SphereHit {
  sphereAId: string
  sphereBId: string
  centerA: THREE.Vector3
  centerB: THREE.Vector3
  distance: number
  penetrationDepth: number
}

const DEFAULT_OPTIONS: Required<Omit<HitDetectSystemOptions, 'scene'>> = {
  debugVisible: true,   //显示包围碰撞检测球，用于调试
  logCollisions: true,
}

//radiusRatio碰撞包围球的比例系数，越大碰撞范围越宽
const COLLISION_CONFIG = {
  submarine: {
    spheresPerLayer: 5,
    yLayerRatio: 0.18,
    radiusRatio: 0.08,
    color: 0x00aaff,
  },
  cargoShip: {
    spheresPerLayer: 10,
    yLayerRatio: 0.18,
    radiusRatio: 0.075,
    color: 0xffcc00,
  },
  torpedo: {
    collisionDelaySeconds: 2,
    radiusRatio: 0.5,
    color: 0xff3333,
  },
}

export class HitDetectSystem implements Updatable {
  onCollision?: (event: CollisionEvent) => void

  private readonly scene: THREE.Scene | undefined
  private readonly options: Required<Omit<HitDetectSystemOptions, 'scene'>>
  private readonly entities = new Map<string, RegisteredCollisionEntity>()
  private readonly activePairs = new Set<string>()
  private readonly tempPositionA = new THREE.Vector3()
  private readonly tempPositionB = new THREE.Vector3()

  constructor(options: HitDetectSystemOptions = {}) {
    this.scene = options.scene
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  register(entity: CollisionEntity): void {
    if (this.entities.has(entity.id)) {
      this.unregister(entity.id)
    }

    const registered: RegisteredCollisionEntity = {
      ...entity,
      roughRadius: this.computeRoughRadius(entity.spheres),
      debugMeshes: [],
    }

    if (this.options.debugVisible) {
      registered.debugMeshes = this.createDebugMeshes(registered)
    }

    this.entities.set(entity.id, registered)
  }

  registerSubmarine(submarine: SubmarineController): void {
    this.register({
      id: submarine.id,
      type: 'submarine',
      root: submarine.root,
      controller: submarine,
      spheres: createLayeredCollisionSpheres({
        length: submarine.modelLength,
        height: submarine.modelHeight,
        spheresPerLayer: COLLISION_CONFIG.submarine.spheresPerLayer,
        yLayerRatio: COLLISION_CONFIG.submarine.yLayerRatio,
        radius: submarine.modelLength * COLLISION_CONFIG.submarine.radiusRatio,
      }),
    })
  }

  registerCargoShip(ship: CargoShipController): void {
    this.register({
      id: ship.id,
      type: 'cargoShip',
      root: ship.root,
      controller: ship,
      spheres: createLayeredCollisionSpheres({
        length: ship.modelLength,
        height: ship.modelHeight,
        spheresPerLayer: COLLISION_CONFIG.cargoShip.spheresPerLayer,
        yLayerRatio: COLLISION_CONFIG.cargoShip.yLayerRatio,
        radius: ship.modelLength * COLLISION_CONFIG.cargoShip.radiusRatio,
      }),
      isEnabled: () => !ship.isDestroyed,
    })
  }

  registerCargoShips(ships: CargoShipController[]): void {
    for (const ship of ships) {
      this.registerCargoShip(ship)
    }
  }

  registerTorpedo(torpedo: TorpedorController, createdAtSeconds = 0): void {
    this.register({
      id: torpedo.id,
      type: 'torpedo',
      root: torpedo.root,
      controller: torpedo,
      spheres: [
        {
          id: 'body',
          offset: new THREE.Vector3(0, 0, 0),
          radius: torpedo.modelLength * COLLISION_CONFIG.torpedo.radiusRatio,
        },
      ],
      createdAtSeconds,
      collisionDelaySeconds: COLLISION_CONFIG.torpedo.collisionDelaySeconds,
      isEnabled: () => !torpedo.isExpired,
    })
  }

  unregister(id: string): void {
    const entity = this.entities.get(id)
    if (entity) {
      this.disposeDebugMeshes(entity)
      this.entities.delete(id)
    }
    this.clearPairsForEntity(id)
  }

  clear(): void {
    for (const entity of this.entities.values()) {
      this.disposeDebugMeshes(entity)
    }
    this.entities.clear()
    this.activePairs.clear()
  }

  update(_delta: number, timeMs: number): void {
    const timeSeconds = timeMs / 1000
    const entities = Array.from(this.entities.values()).filter((entity) =>
      this.isEntityActive(entity, timeSeconds),
    )
    const currentPairs = new Set<string>()

    this.updateDebugMeshes()

    for (let i = 0; i < entities.length; i += 1) {
      for (let j = i + 1; j < entities.length; j += 1) {
        const entityA = entities[i]
        const entityB = entities[j]
        if (!entityA || !entityB) continue
        const pairKey = createPairKey(entityA.id, entityB.id)

        if (!this.passesRoughCheck(entityA, entityB)) continue

        const hit = this.findBestSphereHit(entityA, entityB)
        if (!hit) continue

        currentPairs.add(pairKey)
        if (this.activePairs.has(pairKey)) continue

        const event = this.createCollisionEvent(entityA, entityB, hit, pairKey, timeMs, timeSeconds)
        this.emitCollision(event)
      }
    }

    this.activePairs.clear()
    for (const pairKey of currentPairs) {
      this.activePairs.add(pairKey)
    }
  }

  private isEntityActive(entity: RegisteredCollisionEntity, timeSeconds: number): boolean {
    if (entity.enabled === false) return false
    if (entity.isEnabled && !entity.isEnabled()) return false
    if (
      entity.createdAtSeconds !== undefined &&
      entity.collisionDelaySeconds !== undefined &&
      timeSeconds < entity.createdAtSeconds + entity.collisionDelaySeconds
    ) {
      return false
    }
    return true
  }

  private passesRoughCheck(
    entityA: RegisteredCollisionEntity,
    entityB: RegisteredCollisionEntity,
  ): boolean {
    entityA.root.getWorldPosition(this.tempPositionA)
    entityB.root.getWorldPosition(this.tempPositionB)
    const roughRadiusSum = entityA.roughRadius + entityB.roughRadius
    return this.tempPositionA.distanceToSquared(this.tempPositionB) <= roughRadiusSum * roughRadiusSum
  }

  private findBestSphereHit(
    entityA: RegisteredCollisionEntity,
    entityB: RegisteredCollisionEntity,
  ): SphereHit | undefined {
    let bestHit: SphereHit | undefined

    for (const sphereA of entityA.spheres) {
      const centerA = this.getSphereWorldCenter(entityA, sphereA)
      for (const sphereB of entityB.spheres) {
        const centerB = this.getSphereWorldCenter(entityB, sphereB)
        const radiusSum = sphereA.radius + sphereB.radius
        const distanceSq = centerA.distanceToSquared(centerB)
        if (distanceSq > radiusSum * radiusSum) continue

        const distance = Math.sqrt(distanceSq)
        const penetrationDepth = radiusSum - distance
        if (!bestHit || penetrationDepth > bestHit.penetrationDepth) {
          bestHit = {
            sphereAId: sphereA.id,
            sphereBId: sphereB.id,
            centerA: centerA.clone(),
            centerB: centerB.clone(),
            distance,
            penetrationDepth,
          }
        }
      }
    }

    return bestHit
  }

  private createCollisionEvent(
    entityA: RegisteredCollisionEntity,
    entityB: RegisteredCollisionEntity,
    hit: SphereHit,
    pairKey: string,
    timeMs: number,
    timeSeconds: number,
  ): CollisionEvent {
    return {
      id: `${pairKey}:${timeMs.toFixed(2)}`,
      pairKey,
      timeMs,
      timeSeconds,
      a: this.createSnapshot(entityA),
      b: this.createSnapshot(entityB),
      sphereAId: hit.sphereAId,
      sphereBId: hit.sphereBId,
      distance: hit.distance,
      penetrationDepth: hit.penetrationDepth,
      contactPoint: hit.centerA.clone().add(hit.centerB).multiplyScalar(0.5),
    }
  }

  private createSnapshot(entity: RegisteredCollisionEntity): CollisionEntitySnapshot {
    return {
      id: entity.id,
      type: entity.type,
      root: entity.root,
      controller: entity.controller,
      radius: entity.roughRadius,
      position: entity.root.getWorldPosition(new THREE.Vector3()),
    }
  }

  private emitCollision(event: CollisionEvent): void {
    if (this.options.logCollisions) {
      console.log('[collision]', {
        pairKey: event.pairKey,
        a: { id: event.a.id, type: event.a.type },
        b: { id: event.b.id, type: event.b.type },
        sphereAId: event.sphereAId,
        sphereBId: event.sphereBId,
        contactPoint: event.contactPoint,
        penetrationDepth: event.penetrationDepth,
      })
    }

    this.onCollision?.(event)
    event.a.controller.handleCollision(event, event.a)
    event.b.controller.handleCollision(event, event.b)
  }

  private computeRoughRadius(spheres: CollisionSphere[]): number {
    let roughRadius = 0
    for (const sphere of spheres) {
      roughRadius = Math.max(roughRadius, sphere.offset.length() + sphere.radius)
    }
    return roughRadius
  }

  private getSphereWorldCenter(
    entity: RegisteredCollisionEntity,
    sphere: CollisionSphere,
  ): THREE.Vector3 {
    return entity.root.localToWorld(sphere.offset.clone())
  }

  private createDebugMeshes(entity: RegisteredCollisionEntity): THREE.Mesh[] {
    if (!this.scene) return []

    const color = getDebugColor(entity.type)
    return entity.spheres.map((sphere) => {
      const geometry = new THREE.SphereGeometry(sphere.radius, 12, 8)
      const material = new THREE.MeshBasicMaterial({
        color,
        wireframe: true,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.name = `collision-debug-${entity.id}-${sphere.id}`
      this.scene?.add(mesh)
      return mesh
    })
  }

  private updateDebugMeshes(): void {
    if (!this.options.debugVisible) return
    for (const entity of this.entities.values()) {
      for (let i = 0; i < entity.spheres.length; i += 1) {
        const mesh = entity.debugMeshes[i]
        const sphere = entity.spheres[i]
        if (!mesh || !sphere) continue
        mesh.position.copy(this.getSphereWorldCenter(entity, sphere))
      }
    }
  }

  private disposeDebugMeshes(entity: RegisteredCollisionEntity): void {
    for (const mesh of entity.debugMeshes) {
      mesh.removeFromParent()
      mesh.geometry.dispose()
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of materials) {
        material.dispose()
      }
    }
    entity.debugMeshes = []
  }

  private clearPairsForEntity(id: string): void {
    for (const pairKey of Array.from(this.activePairs)) {
      const [idA, idB] = pairKey.split('|')
      if (idA === id || idB === id) {
        this.activePairs.delete(pairKey)
      }
    }
  }
}

function createLayeredCollisionSpheres(options: {
  length: number
  height: number
  spheresPerLayer: number
  yLayerRatio: number
  radius: number
}): CollisionSphere[] {
  const spheres: CollisionSphere[] = []
  const xStart = -options.length * 0.5
  const xStep = options.length / options.spheresPerLayer
  const yOffsets = [
    options.height * options.yLayerRatio,
    -options.height * options.yLayerRatio,
  ]

  for (let layerIndex = 0; layerIndex < yOffsets.length; layerIndex += 1) {
    for (let i = 0; i < options.spheresPerLayer; i += 1) {
      spheres.push({
        id: `layer-${layerIndex}-sphere-${i}`,
        offset: new THREE.Vector3(xStart + xStep * (i + 0.5), yOffsets[layerIndex], 0),
        radius: options.radius,
      })
    }
  }

  return spheres
}

function createPairKey(idA: string, idB: string): string {
  return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`
}

function getDebugColor(type: CollisionEntityType): number {
  if (type === 'submarine') return COLLISION_CONFIG.submarine.color
  if (type === 'cargoShip') return COLLISION_CONFIG.cargoShip.color
  return COLLISION_CONFIG.torpedo.color
}


//碰撞情景，根据碰撞情景决定下一步的反义
export enum CollisionSituationType{
  Submarine_Hits_Submarine, //潜艇撞潜艇
  Submarine_Hits_Cargoship, //潜艇撞商船
  Cargoship_Hits_Cargoship, //商船撞商船
  // Cargoship_Hits_Submarine, //商船撞潜艇
  Torpedor_Hits_Submarine,  //鱼雷撞潜艇
  Torpedor_Hits_Cargoship,   //鱼雷撞商船
  DEFAULT_ERROR
}

//判定碰撞情景
export function CollisionDecision(event: CollisionEvent){
  let a: string = event.a.type
  let b: string = event.b.type

  let submarine='submarine'
  let cargoship='cargoShip'
  let torpedor='torpedo'

  let res: CollisionSituationType = CollisionSituationType.DEFAULT_ERROR

  if(a === submarine && b === submarine){
    res=CollisionSituationType.Submarine_Hits_Submarine
  }else if((a === submarine && b === cargoship)|| (a === cargoship && b === submarine)){
    res=CollisionSituationType.Submarine_Hits_Cargoship
  }else if(a === cargoship && b === cargoship){
    res=CollisionSituationType.Cargoship_Hits_Cargoship
  }else if((a === torpedor && b === submarine) || (a === submarine && b === torpedor)){
    res=CollisionSituationType.Torpedor_Hits_Submarine
  }else if((a === torpedor && b === cargoship) || (a === cargoship && b === torpedor)){
    res=CollisionSituationType.Torpedor_Hits_Cargoship
  }else{
    res=CollisionSituationType.DEFAULT_ERROR
  }
  return res;
}
