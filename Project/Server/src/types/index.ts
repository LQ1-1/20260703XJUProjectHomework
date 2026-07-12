export interface Position {
  x: number
  z: number
}

export interface ShipInfo {
  id: string
  headingDegrees: number
  speed: number
  location: Position
  depth: number
}

export interface CargoshipInfo extends ShipInfo {
  isDestroyed: boolean
}

export interface UBoatInfo extends ShipInfo {
  torpedoCount: number
  username: string
}

export interface HitRecordShip {
  senderUUID: string
  targetUUID: string
  time: string
}

export interface HitRecordTonnage {
  senderUUID: string
  totalTonnages: number
}

export interface HitRecordsShips {
  tf: boolean
  records: HitRecordShip[]
}

export interface HitRecordsTonnages {
  tf: boolean
  records: HitRecordTonnage[]
}

export interface Communication {
  sender: string
  senderUUID: string
  receiver: string
  receiverUUID: string
  content: CargoshipInfo
  tf?: boolean
}

export interface ConvoyDetailInfo {
  tf: boolean
  convoy: CargoshipInfo[]
}

export interface WolfpackDetailInfo {
  tf: boolean
  wolfpack: UBoatInfo[]
}

export interface LoginRequest {
  username: string
}

export interface LoginResponse {
  uuid: string
  username: string
  initialPosition: Position
  initialHeadingDegrees: number
  convoy: CargoshipInfo[]
}

export interface UploadUBoatRequest extends UBoatInfo {
  uuid: string
}