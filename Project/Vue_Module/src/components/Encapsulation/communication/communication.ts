export interface OnlineRoomPlayer {
  KommandantUUID: string
  KommandantName: string
  UBoatID: string
  online: boolean
}

export interface OnlineTextMessage {
  messageID: string
  RoomID: string
  senderUUID: string
  senderName: string
  receiverUUIDs: string[]
  content: string
  createdAt: string
}

export interface ServerNotice {
  noticeID: string
  RoomID: string
  level: 'info' | 'warning' | 'error'
  content: string
  createdAt: string
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

export function latestCursor<T extends Record<string, any>>(
  rows: T[],
  idKeys: string[],
): string {
  const last = rows.at(-1)
  if (!last) return ''
  for (const key of idKeys) {
    if (last[key]) return String(last[key])
  }
  return ''
}
