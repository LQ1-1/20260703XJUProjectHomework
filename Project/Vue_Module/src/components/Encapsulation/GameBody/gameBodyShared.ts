import { v4 as uuidv4 } from 'uuid'
import type {
  OnlineCargoShipStateDTO,
  OnlineUBoatStateDTO,
} from '../api/ContactTool.ts'
import type { OnlineRoomPlayer } from '../communication/communication.ts'

export interface XzLocation {
  x: number
  z: number
}

export interface UBoatSpawnFallback {
  location: XzLocation
  headingDegrees: number
  depthMeters: number
}

export interface SelfUBoatIdentifiers {
  selfUUID: string
  selfUBoatID: string
}

export interface InitialUBoatSpawn {
  id: string
  worldPosition: XzLocation
  initialHeadingDegrees: number
  initialDepthMeters: number
  torpedoesRemaining?: number
  isDemoPositionApplied?: boolean
}

export interface MapBounds {
  min: number
  max: number
}

export interface FileLoadingProgress {
  loaded: number
  total: number
}

export function normalizeArrayPayload<T>(payload: any, keys: string[]): T[] {
  for (const key of keys) {
    const value = payload?.[key] ?? payload?.data?.[key]
    if (Array.isArray(value)) return value
  }
  if (Array.isArray(payload?.data)) return payload.data
  if (Array.isArray(payload)) return payload
  return []
}

export function normalizeRoomPlayers(payload: any): OnlineRoomPlayer[] {
  const players = payload?.room?.players ?? payload?.data?.room?.players ?? payload?.players ?? payload?.data?.players
  if (Array.isArray(players)) return players
  return []
}

export function normalizeUBoatStates(payload: any): OnlineUBoatStateDTO[] {
  const states = normalizeArrayPayload<OnlineUBoatStateDTO>(payload, ['uBoats', 'wolfpack'])
  const selfUBoat = payload?.selfUBoat ?? payload?.data?.selfUBoat
  if (selfUBoat) {
    states.unshift(selfUBoat)
  }
  return states
}

export function isSelfUBoatState(
  state: Partial<OnlineUBoatStateDTO>,
  identifiers: SelfUBoatIdentifiers,
): boolean {
  const kommandantUUID = String(state.KommandantUUID ?? '')
  const uBoatID = String(state.UBoatID ?? '')

  if (identifiers.selfUUID && kommandantUUID && kommandantUUID === identifiers.selfUUID) return true
  if (identifiers.selfUBoatID && uBoatID && uBoatID === identifiers.selfUBoatID) return true
  return false
}

export function findSelfUBoatState(
  payload: any,
  identifiers: SelfUBoatIdentifiers,
): OnlineUBoatStateDTO | undefined {
  const selfUBoat = payload?.selfUBoat ?? payload?.data?.selfUBoat
  if (selfUBoat && (!selfUBoat.KommandantUUID || isSelfUBoatState(selfUBoat, identifiers))) {
    return selfUBoat
  }
  return normalizeUBoatStates(payload).find((state) => isSelfUBoatState(state, identifiers))
}

export function getUBoatStateLocation(state: Partial<OnlineUBoatStateDTO>): XzLocation | undefined {
  const x = Number(state.location?.x ?? (state as any).x)
  const z = Number(state.location?.z ?? (state as any).z)
  if (!Number.isFinite(x) || !Number.isFinite(z)) return undefined
  return { x, z }
}

export function getUBoatStateHeading(
  state: Partial<OnlineUBoatStateDTO>,
  fallbackHeadingDegrees: number,
): number {
  const heading = Number(state.headingDegrees)
  return Number.isFinite(heading) ? heading : fallbackHeadingDegrees
}

export function getUBoatStateDepth(
  state: Partial<OnlineUBoatStateDTO>,
  fallbackDepthMeters: number,
): number {
  const depth = Number(state.depthMeters ?? (state as any).depth)
  return Number.isFinite(depth) ? depth : fallbackDepthMeters
}

export function getInitialUBoatSpawn(
  payload: any,
  identifiers: SelfUBoatIdentifiers,
  fallback: UBoatSpawnFallback,
): InitialUBoatSpawn {
  const state = findSelfUBoatState(payload, identifiers)
  const location = state ? getUBoatStateLocation(state) : undefined
  const torpedoesRemaining = Number(state?.torpedoesRemaining)

  return {
    id: String(state?.modelID ?? '') || uuidv4(),
    worldPosition: location ?? fallback.location,
    initialHeadingDegrees: state ? getUBoatStateHeading(state, fallback.headingDegrees) : fallback.headingDegrees,
    initialDepthMeters: state ? getUBoatStateDepth(state, fallback.depthMeters) : fallback.depthMeters,
    torpedoesRemaining: Number.isFinite(torpedoesRemaining) ? Math.max(0, torpedoesRemaining) : undefined,
  }
}

export function getCargoStateModelID(cargoState: Partial<OnlineCargoShipStateDTO>): string {
  return String(cargoState.modelID ?? '')
}

export function getCargoStateHeading(cargoState: Partial<OnlineCargoShipStateDTO>): number {
  const heading = Number(cargoState.headingDegrees)
  return Number.isFinite(heading) ? heading : 0
}

export function getCargoStateSpeedKnots(cargoState: Partial<OnlineCargoShipStateDTO>): number {
  const speed = Number((cargoState as any).speedKnots ?? (cargoState as any).speed ?? 0)
  return Number.isFinite(speed) ? speed : 0
}

export function getCargoStateLocation(cargoState: Partial<OnlineCargoShipStateDTO>): XzLocation {
  const x = Number(cargoState.location?.x ?? (cargoState as any).x)
  const z = Number(cargoState.location?.z ?? (cargoState as any).z)
  return {
    x: Number.isFinite(x) ? x : 0,
    z: Number.isFinite(z) ? z : 0,
  }
}

export function getCargoStateLocationIfValid(
  cargoState: Partial<OnlineCargoShipStateDTO>,
): XzLocation | undefined {
  const x = Number(cargoState.location?.x ?? (cargoState as any).x)
  const z = Number(cargoState.location?.z ?? (cargoState as any).z)
  if (!Number.isFinite(x) || !Number.isFinite(z)) return undefined
  return { x, z }
}

export function getConvoyCenterFromPayload(payload: any): XzLocation | undefined {
  const cargoStates = normalizeArrayPayload<OnlineCargoShipStateDTO>(payload, ['cargoShips', 'convoy'])
  return getConvoyCenter(cargoStates)
}

export function getConvoyCenter(cargoStates: Partial<OnlineCargoShipStateDTO>[]): XzLocation | undefined {
  const locations = cargoStates
    .map(getCargoStateLocationIfValid)
    .filter((location): location is XzLocation => Boolean(location))

  if (locations.length === 0) return undefined

  const sum = locations.reduce(
    (acc, location) => ({
      x: acc.x + location.x,
      z: acc.z + location.z,
    }),
    { x: 0, z: 0 },
  )

  return {
    x: sum.x / locations.length,
    z: sum.z / locations.length,
  }
}

export function isInsideMap(location: XzLocation, bounds: MapBounds): boolean {
  return location.x >= bounds.min && location.x <= bounds.max && location.z >= bounds.min && location.z <= bounds.max
}

export function createMapBoundedRadialPosition(
  center: XzLocation,
  distance: number,
  bounds: MapBounds,
  attempts = 720,
): XzLocation | undefined {
  const randomStartAngle = Math.random() * Math.PI * 2
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const angle = randomStartAngle + goldenAngle * attempt
    const location = {
      x: center.x + Math.cos(angle) * distance,
      z: center.z + Math.sin(angle) * distance,
    }

    if (isInsideMap(location, bounds)) return location
  }

  return undefined
}

export function getDemoInitialUBoatSpawn(
  payload: any,
  identifiers: SelfUBoatIdentifiers,
  fallback: UBoatSpawnFallback,
  bounds: MapBounds,
  distance: number,
): InitialUBoatSpawn {
  const spawn = getInitialUBoatSpawn(payload, identifiers, fallback)
  const demoWorldPosition = getDemoUBoatWorldPosition(payload, bounds, distance)
  if (!demoWorldPosition) return spawn

  return {
    ...spawn,
    worldPosition: demoWorldPosition,
    isDemoPositionApplied: true,
  }
}

export function getDemoUBoatWorldPosition(
  payload: any,
  bounds: MapBounds,
  distance: number,
): XzLocation | undefined {
  const convoyCenter = getConvoyCenterFromPayload(payload)
  if (!convoyCenter) return undefined
  return createMapBoundedRadialPosition(convoyCenter, distance, bounds)
}

export function updateLoadingProgressValue(
  fileProgress: Map<string, FileLoadingProgress>,
  url: string,
  event: ProgressEvent<EventTarget>,
): number | undefined {
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

  return total > 0 ? Math.min(99, (loaded / total) * 100) : undefined
}

export function getTorpedoesRemainingFromPayload(payload: any): number | undefined {
  const value =
    payload?.torpedoesRemaining ??
    payload?.data?.torpedoesRemaining ??
    payload?.selfUBoat?.torpedoesRemaining ??
    payload?.data?.selfUBoat?.torpedoesRemaining
  if (!Number.isFinite(Number(value))) return undefined
  return Math.max(0, Number(value))
}

export function shouldRestoreRejectedTorpedo(payload: any): boolean {
  return payload?.restoreTorpedo === true || payload?.data?.restoreTorpedo === true
}
