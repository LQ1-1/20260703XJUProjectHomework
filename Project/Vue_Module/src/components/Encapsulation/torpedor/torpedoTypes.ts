import type { TorpedoType } from './TorpedorController'

export interface TorpedoLaunchPlan {
  tubeId: number
  torpedoType: TorpedoType
  headingDegrees: number
  finalDepthMeters: number
  isOutOfRange: boolean
}

export interface TorpedoTubeState {
  id: number
  selected: boolean
  isLoaded: boolean
  isReloading: boolean
  reloadRemainingSeconds: number
  hasBinding: boolean
  isOutOfRange: boolean
}
