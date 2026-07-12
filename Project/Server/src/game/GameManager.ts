import { v4 as uuidv4 } from 'uuid'
import type { UBoatInfo, CargoshipInfo, Position, HitRecordShip, HitRecordTonnage, Communication } from '../types'

const GAME_AREA_SIZE = 12150
const MIN_PLAYER_DISTANCE = 4050
const CARGO_SHIP_COUNT = 22
const CARGO_ROWS = 4
const CARGO_COLS = 5
const CARGO_HORIZONTAL_SPACING = 261
const CARGO_VERTICAL_SPACING = 160
const CARGO_DEVIATION = 50
const CARGO_SPEED = 7

export class GameManager {
  private players: Map<string, UBoatInfo> = new Map()
  private cargoShips: Map<string, CargoshipInfo> = new Map()
  private hitRecords: HitRecordShip[] = []
  private tonnageRecords: Map<string, number> = new Map()
  private communications: Communication[] = []
  private cargoHeading: number = 0
  private cargoDirection: { x: number; z: number } = { x: 0, z: 0 }

  constructor() {
    this.generateCargoShips()
    this.startGameLoop()
  }

  private randomRange(min: number, max: number): number {
    return Math.random() * (max - min) + min
  }

  private randomPosition(): Position {
    return {
      x: this.randomRange(1000, GAME_AREA_SIZE - 1000),
      z: this.randomRange(1000, GAME_AREA_SIZE - 1000),
    }
  }

  private distance(pos1: Position, pos2: Position): number {
    const dx = pos1.x - pos2.x
    const dz = pos1.z - pos2.z
    return Math.sqrt(dx * dx + dz * dz)
  }

  private generateCargoShips(): void {
    this.cargoHeading = this.randomRange(0, 360)
    const angle = (this.cargoHeading * Math.PI) / 180
    this.cargoDirection = {
      x: Math.sin(angle),
      z: -Math.cos(angle),
    }

    const convoyCenterX = GAME_AREA_SIZE / 2
    const convoyCenterZ = GAME_AREA_SIZE / 2

    let shipIndex = 0
    for (let row = 0; row < CARGO_ROWS; row++) {
      for (let col = 0; col < CARGO_COLS; col++) {
        if (shipIndex >= CARGO_SHIP_COUNT) break

        const baseX = convoyCenterX + (col - CARGO_COLS / 2 + 0.5) * CARGO_HORIZONTAL_SPACING
        const baseZ = convoyCenterZ + (row - CARGO_ROWS / 2 + 0.5) * CARGO_VERTICAL_SPACING

        const deviationX = this.randomRange(-CARGO_DEVIATION, CARGO_DEVIATION)
        const deviationZ = this.randomRange(-CARGO_DEVIATION, CARGO_DEVIATION)

        const ship: CargoshipInfo = {
          id: uuidv4(),
          headingDegrees: this.cargoHeading,
          speed: CARGO_SPEED,
          location: {
            x: baseX + deviationX,
            z: baseZ + deviationZ,
          },
          depth: 0,
          isDestroyed: false,
        }

        this.cargoShips.set(ship.id, ship)
        shipIndex++
      }
    }

    while (shipIndex < CARGO_SHIP_COUNT) {
      const deviationX = this.randomRange(-CARGO_DEVIATION * 2, CARGO_DEVIATION * 2)
      const deviationZ = this.randomRange(-CARGO_DEVIATION * 2, CARGO_DEVIATION * 2)

      const ship: CargoshipInfo = {
        id: uuidv4(),
        headingDegrees: this.cargoHeading,
        speed: CARGO_SPEED,
        location: {
          x: convoyCenterX + deviationX,
          z: convoyCenterZ + deviationZ,
        },
        depth: 0,
        isDestroyed: false,
      }

      this.cargoShips.set(ship.id, ship)
      shipIndex++
    }
  }

  private updateCargoShips(): void {
    const speedPerUpdate = CARGO_SPEED * 0.15

    for (const [id, ship] of this.cargoShips) {
      if (ship.isDestroyed) continue

      ship.location.x += this.cargoDirection.x * speedPerUpdate
      ship.location.z += this.cargoDirection.z * speedPerUpdate

      if (ship.location.x < 0 || ship.location.x > GAME_AREA_SIZE ||
          ship.location.z < 0 || ship.location.z > GAME_AREA_SIZE) {
        this.respawnCargoShip(ship)
      }
    }
  }

  private respawnCargoShip(ship: CargoshipInfo): void {
    const side = Math.floor(this.randomRange(0, 4))
    let x: number, z: number

    switch (side) {
      case 0:
        x = this.randomRange(0, GAME_AREA_SIZE)
        z = -1000
        break
      case 1:
        x = GAME_AREA_SIZE + 1000
        z = this.randomRange(0, GAME_AREA_SIZE)
        break
      case 2:
        x = this.randomRange(0, GAME_AREA_SIZE)
        z = GAME_AREA_SIZE + 1000
        break
      default:
        x = -1000
        z = this.randomRange(0, GAME_AREA_SIZE)
    }

    ship.location = { x, z }
    ship.isDestroyed = false
  }

  private startGameLoop(): void {
    setInterval(() => {
      this.updateCargoShips()
    }, 150)
  }

  login(username: string): { uuid: string; initialPosition: Position; initialHeadingDegrees: number } {
    const uuid = uuidv4()
    let position = this.randomPosition()

    while (true) {
      let tooClose = false
      for (const player of this.players.values()) {
        if (this.distance(position, player.location) < MIN_PLAYER_DISTANCE) {
          tooClose = true
          break
        }
      }
      if (!tooClose) break
      position = this.randomPosition()
    }

    const player: UBoatInfo = {
      id: uuid,
      username,
      headingDegrees: this.randomRange(0, 360),
      speed: 0,
      location: position,
      depth: 0,
      torpedoCount: 14,
    }

    this.players.set(uuid, player)
    return { uuid, initialPosition: position, initialHeadingDegrees: player.headingDegrees }
  }

  logout(uuid: string): void {
    this.players.delete(uuid)
  }

  getConvoy(): CargoshipInfo[] {
    return Array.from(this.cargoShips.values())
  }

  getWolfpack(): UBoatInfo[] {
    return Array.from(this.players.values())
  }

  updateUBoatInfo(uuid: string, info: Partial<UBoatInfo>): void {
    const player = this.players.get(uuid)
    if (player) {
      if (info.headingDegrees !== undefined) player.headingDegrees = info.headingDegrees
      if (info.speed !== undefined) player.speed = info.speed
      if (info.location !== undefined) player.location = info.location
      if (info.depth !== undefined) player.depth = info.depth
      if (info.torpedoCount !== undefined) player.torpedoCount = info.torpedoCount
    }
  }

  addHitRecord(senderUUID: string, targetUUID: string): void {
    const record: HitRecordShip = {
      senderUUID,
      targetUUID,
      time: new Date().toISOString(),
    }
    this.hitRecords.push(record)

    const cargo = this.cargoShips.get(targetUUID)
    if (cargo) {
      cargo.isDestroyed = true
    }

    const currentTonnage = this.tonnageRecords.get(senderUUID) || 0
    this.tonnageRecords.set(senderUUID, currentTonnage + 7000)
  }

  getHitRecordsShips(): HitRecordShip[] {
    return this.hitRecords
  }

  getHitRecordsTonnages(): HitRecordTonnage[] {
    return Array.from(this.tonnageRecords.entries()).map(([senderUUID, totalTonnages]) => ({
      senderUUID,
      totalTonnages,
    }))
  }

  sendCommunication(comm: Communication): void {
    this.communications.push(comm)
  }

  getCommunications(receiverUUID: string): Communication[] {
    return this.communications.filter(c => c.receiverUUID === receiverUUID)
  }

  getPlayerByUUID(uuid: string): UBoatInfo | undefined {
    return this.players.get(uuid)
  }

  getPlayerByUsername(username: string): UBoatInfo | undefined {
    return Array.from(this.players.values()).find(p => p.username === username)
  }
}