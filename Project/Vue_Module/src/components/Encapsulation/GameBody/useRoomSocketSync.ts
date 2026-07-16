import { computed, onBeforeUnmount, ref } from 'vue'
import {
  ROOM_TICK_INTERVAL_MS,
  createRoomSocket,
  type RoomEvent,
  type RoomSocketClient,
  type UBoatInputDTO,
  type WorldSnapshotPayload,
} from '../api/ContactTool2'
import type { OnlineUBoatStateDTO } from '../api/ContactTool'

export type RoomSocketStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'closed'

export interface UseRoomSocketSyncOptions {
  roomId: string
  getUBoatInput?: () => UBoatInputDTO | undefined
  getPredictedUBoatState?: () => OnlineUBoatStateDTO | undefined
  onSnapshot?: (payload: WorldSnapshotPayload, event: RoomEvent<WorldSnapshotPayload>) => void | Promise<void>
  onEvents?: (payload: unknown, event: RoomEvent) => void | Promise<void>
  onErrorEvent?: (event: RoomEvent) => void
}

const RECONNECT_DELAYS_MS = [0, 500, 1000, 2000, 5000]

export function useRoomSocketSync(options: UseRoomSocketSyncOptions) {
  const status = ref<RoomSocketStatus>('idle')
  const lastSnapshotAt = ref<number | null>(null)
  const lastError = ref('')
  const isAuthoritativeActionAllowed = computed(() => status.value === 'connected' && lastSnapshotAt.value !== null)

  let client: RoomSocketClient | undefined
  let closedByUser = false
  let reconnectAttempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let inputTimer: ReturnType<typeof setInterval> | undefined
  let clientFrame = 0

  async function connect(): Promise<void> {
    if (!options.roomId || status.value === 'connecting' || status.value === 'connected') return

    closedByUser = false
    status.value = reconnectAttempt > 0 ? 'reconnecting' : 'connecting'
    clearReconnectTimer()

    try {
      client = await createRoomSocket({
        roomId: options.roomId,
        onOpen: handleOpen,
        onClose: handleClose,
        onError: handleSocketError,
      })
      bindRoomEvents(client)
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      scheduleReconnect()
    }
  }

  function close(): void {
    closedByUser = true
    clearReconnectTimer()
    stopInputTimer()
    client?.closeRoomSocket(1000, 'client closed')
    client = undefined
    status.value = 'closed'
  }

  function sendAuthoritativeEvent<TPayload>(type: string, payload: TPayload): boolean {
    if (!isAuthoritativeActionAllowed.value || !client) return false
    try {
      client.sendRoomEvent(type, payload)
      return true
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      return false
    }
  }

  function handleOpen(): void {
    status.value = 'connected'
    reconnectAttempt = 0
    lastError.value = ''
    startInputTimer()
  }

  function handleClose(): void {
    stopInputTimer()
    client = undefined
    if (closedByUser) {
      status.value = 'closed'
      return
    }
    lastSnapshotAt.value = null
    scheduleReconnect()
  }

  function handleSocketError(): void {
    lastError.value = 'WebSocket 连接异常'
  }

  function bindRoomEvents(socketClient: RoomSocketClient): void {
    socketClient.onRoomEvent<WorldSnapshotPayload>('world.snapshot', async (event) => {
      lastSnapshotAt.value = Date.now()
      await options.onSnapshot?.(event.payload, event)
    })
    socketClient.onRoomEvent('world.events', async (event) => {
      await options.onEvents?.(event.payload, event)
    })
    socketClient.onRoomEvent('error', (event) => {
      lastError.value = extractErrorMessage(event)
      options.onErrorEvent?.(event)
    })
  }

  function startInputTimer(): void {
    stopInputTimer()
    inputTimer = setInterval(sendCurrentInput, ROOM_TICK_INTERVAL_MS)
    sendCurrentInput()
  }

  function stopInputTimer(): void {
    if (inputTimer) clearInterval(inputTimer)
    inputTimer = undefined
  }

  function sendCurrentInput(): void {
    if (!client || status.value !== 'connected') return
    const input = options.getUBoatInput?.()
    const predictedState = options.getPredictedUBoatState?.()
    if (!input || !predictedState) return

    client.sendUBoatInput(
      {
        ...input,
        clientFrame: input.clientFrame || ++clientFrame,
      },
      predictedState,
    )
  }

  function scheduleReconnect(): void {
    status.value = 'reconnecting'
    const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)] ?? 5000
    reconnectAttempt += 1
    clearReconnectTimer()
    reconnectTimer = setTimeout(() => {
      void connect()
    }, delay)
  }

  function clearReconnectTimer(): void {
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = undefined
  }

  onBeforeUnmount(close)

  return {
    status,
    lastSnapshotAt,
    lastError,
    isAuthoritativeActionAllowed,
    connect,
    close,
    sendAuthoritativeEvent,
  }
}

function extractErrorMessage(event: RoomEvent): string {
  const payload = event.payload as { message?: unknown } | undefined
  return typeof payload?.message === 'string' ? payload.message : 'WebSocket 服务端错误'
}
