import request from './request'
import { getWsBaseUrl } from './runtimeConfig'
import type {
  GameResultDTO,
  HitReportDTO,
  OnlineTorpedoStateDTO,
  OnlineUBoatStateDTO,
  RoomPlayerDTO,
  SettlementDTO,
  SunkConfirmDTO,
  TextMessageDTO,
  OnlineCargoShipStateDTO,
} from './ContactTool'

export const ROOM_TICK_INTERVAL_MS = 500

export type RoomClientEventType =
  | 'room.join'
  | 'uboat.input'
  | 'torpedo.fire'
  | 'chat.send'
  | 'model.hit'
  | 'model.sunk-confirm'
  | 'ping'

export type RoomServerEventType =
  | 'room.joined'
  | 'room.players.updated'
  | 'world.snapshot'
  | 'world.events'
  | 'uboat.corrected'
  | 'torpedo.rejected'
  | 'chat.message'
  | 'server.notice'
  | 'game.result'
  | 'pong'
  | 'error'

export type RoomEventType = RoomClientEventType | RoomServerEventType

export interface RoomEvent<TPayload = unknown> {
  type: RoomEventType | string
  seq: number
  roomId: string
  sentAt: number
  payload: TPayload
}

export interface UBoatInputDTO {
  pressedKeys: string[]
  speedCommand: number | null
  headingCommand: number | null
  clientFrame: number
}

export interface UBoatInputPayload {
  input: UBoatInputDTO
  predictedState: OnlineUBoatStateDTO
}

export interface WorldSnapshotPayload {
  revision: string
  serverTime: number
  tickIntervalMs: number
  uBoats: OnlineUBoatStateDTO[]
  cargoShips: OnlineCargoShipStateDTO[]
  torpedoes: OnlineTorpedoStateDTO[]
  players: RoomPlayerDTO[]
  settlement?: SettlementDTO
  gameResult?: GameResultDTO
}

export interface RoomWsTicketResponse {
  sf: boolean
  message?: string
  ticket?: string
  expiresAt?: string
}

export interface RoomSocketOptions {
  roomId: string
  url?: string
  protocols?: string | string[]
  onOpen?: () => void
  onClose?: (event: CloseEvent) => void
  onError?: (event: Event) => void
  onEvent?: (event: RoomEvent) => void
}

export interface RoomSocketClient {
  readonly socket: WebSocket
  sendRoomEvent<TPayload>(type: RoomClientEventType | string, payload: TPayload): void
  onRoomEvent<TPayload = unknown>(
    type: RoomServerEventType | string,
    handler: (event: RoomEvent<TPayload>) => void,
  ): () => void
  sendUBoatInput(input: UBoatInputDTO, predictedState: OnlineUBoatStateDTO): void
  sendTorpedoFire(torpedo: OnlineTorpedoStateDTO): void
  sendChatMessage(payload: TextMessageDTO): void
  sendHitReport(payload: HitReportDTO): void
  sendSunkConfirm(payload: SunkConfirmDTO): void
  closeRoomSocket(code?: number, reason?: string): void
}

type EventHandler = (event: RoomEvent) => void

let globalSeq = 0

export async function getRoomWsTicket(RoomID: string): Promise<RoomWsTicketResponse> {
  return await request.post('/room/ws-ticket', { RoomID })
}

export async function createRoomSocket(options: RoomSocketOptions): Promise<RoomSocketClient> {
  const ticketResult = await getRoomWsTicket(options.roomId)
  if (!ticketResult?.sf || !ticketResult.ticket) {
    throw new Error(ticketResult?.message || 'WebSocket ticket 获取失败')
  }

  const socket = new WebSocket(
    options.url ?? buildRoomSocketUrl(ticketResult.ticket),
    options.protocols,
  )
  const handlers = new Map<string, Set<EventHandler>>()

  socket.addEventListener('open', () => options.onOpen?.())
  socket.addEventListener('close', (event) => options.onClose?.(event))
  socket.addEventListener('error', (event) => options.onError?.(event))
  socket.addEventListener('message', (message) => {
    const event = parseRoomEvent(message.data)
    if (!event) return
    options.onEvent?.(event)
    handlers.get(event.type)?.forEach((handler) => handler(event))
  })

  function sendRoomEvent<TPayload>(type: RoomClientEventType | string, payload: TPayload): void {
    if (socket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket 尚未连接')
    }
    const event: RoomEvent<TPayload> = {
      type,
      seq: ++globalSeq,
      roomId: options.roomId,
      sentAt: Date.now(),
      payload,
    }
    socket.send(JSON.stringify(event))
  }

  function onRoomEvent<TPayload = unknown>(
    type: RoomServerEventType | string,
    handler: (event: RoomEvent<TPayload>) => void,
  ): () => void {
    const typedHandler = handler as EventHandler
    const bucket = handlers.get(type) ?? new Set<EventHandler>()
    bucket.add(typedHandler)
    handlers.set(type, bucket)
    return () => bucket.delete(typedHandler)
  }

  return {
    socket,
    sendRoomEvent,
    onRoomEvent,
    sendUBoatInput(input, predictedState) {
      sendRoomEvent<UBoatInputPayload>('uboat.input', { input, predictedState })
    },
    sendTorpedoFire(torpedo) {
      sendRoomEvent<OnlineTorpedoStateDTO>('torpedo.fire', torpedo)
    },
    sendChatMessage(payload) {
      sendRoomEvent<TextMessageDTO>('chat.send', payload)
    },
    sendHitReport(payload) {
      sendRoomEvent<HitReportDTO>('model.hit', payload)
    },
    sendSunkConfirm(payload) {
      sendRoomEvent<SunkConfirmDTO>('model.sunk-confirm', payload)
    },
    closeRoomSocket(code, reason) {
      socket.close(code, reason)
    },
  }
}

function buildRoomSocketUrl(ticket: string): string {
  const base = getWsBaseUrl()
  if (base) return `${base}/ws/room?ticket=${encodeURIComponent(ticket)}`

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws/room?ticket=${encodeURIComponent(ticket)}`
}

function parseRoomEvent(data: unknown): RoomEvent | undefined {
  if (typeof data !== 'string') return undefined
  try {
    const parsed = JSON.parse(data)
    if (!parsed || typeof parsed.type !== 'string') return undefined
    return parsed as RoomEvent
  } catch (error) {
    console.warn('WebSocket 事件解析失败。', error)
    return undefined
  }
}
