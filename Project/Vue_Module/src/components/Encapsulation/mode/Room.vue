<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { createRoom, enterRoom, getPlayerRecord, getRoomDetail, getRoomInfos } from '../api/ContactTool'
import type { PlayerGameRecordDTO, PlayerRecordSummaryDTO, RoomDTO, RoomPlayerDTO } from '../api/ContactTool'
import '../../../css/room.css'

type RoomRow = Required<Pick<RoomDTO, 'RoomID' | 'PlayerAmount' | 'maxPlayers' | 'status'>>
type RoomDetailState = RoomRow & { players: RoomPlayerDTO[] }

const MAX_PLAYERS = 8
const emptyRecordSummary: PlayerRecordSummaryDTO = {
  cargoShipsSunk: 0,
  uBoatsSunk: 0,
  totalTonnage: 0,
  gamesPlayed: 0,
}

const router = useRouter()
const route = useRoute()
const rooms = ref<RoomRow[]>([])
const isLoading = ref(false)
const isCreating = ref(false)
const isDemoData = ref(false)
const joiningRoomID = ref('')
const recordDialogVisible = ref(false)
const recordLoading = ref(false)
const recordSummary = ref<PlayerRecordSummaryDTO>({ ...emptyRecordSummary })
const recordGames = ref<PlayerGameRecordDTO[]>([])
const detailDialogVisible = ref(false)
const detailLoading = ref(false)
const selectedRoomDetail = ref<RoomDetailState | null>(null)

const commanderUUID = computed(() => localStorage.getItem('KommandantUUID') ?? '')
const commanderName = computed(() => localStorage.getItem('KommandantName') ?? 'Kommandant')
const isLoggedIn = computed(() => Boolean(localStorage.getItem('token') && commanderUUID.value))
const isOnlineDemoMode = computed(() => route.query.mode === 'online-demo')

const demoRooms: RoomRow[] = [
  { RoomID: 'DEMO-ATLANTIK-01', PlayerAmount: 3, maxPlayers: MAX_PLAYERS, status: 'joinable' },
  { RoomID: 'DEMO-NORDSEE-02', PlayerAmount: 8, maxPlayers: MAX_PLAYERS, status: 'full' },
  { RoomID: 'DEMO-KONVOI-03', PlayerAmount: 5, maxPlayers: MAX_PLAYERS, status: 'joinable' },
]

function normalizeRoom(raw: Partial<RoomDTO>): RoomRow | null {
  if (!raw.RoomID) return null
  const playerAmount = Number(raw.PlayerAmount ?? 0)
  const maxPlayers = Number(raw.maxPlayers ?? MAX_PLAYERS)
  const isFull = playerAmount >= maxPlayers || raw.status === 'full'

  return {
    RoomID: raw.RoomID,
    PlayerAmount: playerAmount,
    maxPlayers,
    status: isFull ? 'full' : 'joinable',
  }
}

function normalizeRooms(payload: any): RoomRow[] {
  const list = payload?.rooms ?? payload?.data?.rooms ?? payload?.data ?? payload
  if (!Array.isArray(list)) return []
  return list.map(normalizeRoom).filter((room): room is RoomRow => Boolean(room))
}

function normalizeRoomPlayers(rawPlayers: any): RoomPlayerDTO[] {
  if (!Array.isArray(rawPlayers)) return []
  return rawPlayers.map((player) => ({
    KommandantUUID: String(player.KommandantUUID ?? player.kommandantUUID ?? ''),
    KommandantName: String(player.KommandantName ?? player.kommandantName ?? '-'),
    UBoatID: String(player.UBoatID ?? player.uboatID ?? player.uBoatID ?? '-'),
    online: Boolean(player.online),
  }))
}

function normalizeRoomDetailPayload(payload: any, fallbackRoom: RoomRow): RoomDetailState {
  const room = payload?.room ?? payload?.data?.room ?? payload?.data ?? payload
  return {
    RoomID: String(room?.RoomID ?? fallbackRoom.RoomID),
    PlayerAmount: Number(room?.PlayerAmount ?? fallbackRoom.PlayerAmount),
    maxPlayers: Number(room?.maxPlayers ?? fallbackRoom.maxPlayers),
    status: room?.status === 'full' ? 'full' : 'joinable',
    players: normalizeRoomPlayers(room?.players),
  }
}

function normalizeRecordPayload(payload: any): { summary: PlayerRecordSummaryDTO, games: PlayerGameRecordDTO[] } {
  const source = payload?.data ?? payload
  const summary = source?.summary ?? {}
  const games = Array.isArray(source?.games) ? source.games : []

  return {
    summary: {
      cargoShipsSunk: Number(summary.cargoShipsSunk ?? 0),
      uBoatsSunk: Number(summary.uBoatsSunk ?? 0),
      totalTonnage: Number(summary.totalTonnage ?? 0),
      gamesPlayed: Number(summary.gamesPlayed ?? 0),
    },
    games: games.map((game: Partial<PlayerGameRecordDTO>) => ({
      RoomID: String(game.RoomID ?? ''),
      state: game.state,
      reason: game.reason,
      cargoShipsSunk: Number(game.cargoShipsSunk ?? 0),
      uBoatsSunk: Number(game.uBoatsSunk ?? 0),
      totalTonnage: Number(game.totalTonnage ?? 0),
      roomCargoShipsSunk: Number(game.roomCargoShipsSunk ?? 0),
      totalCargoShips: Number(game.totalCargoShips ?? 0),
      updatedAt: game.updatedAt,
    })).filter((game: PlayerGameRecordDTO) => Boolean(game.RoomID)),
  }
}

function formatResult(value?: string) {
  if (value === 'victory') return '胜利'
  if (value === 'defeat') return '失败'
  if (value === 'playing') return '进行中'
  return '未结算'
}

function formatReason(value?: string) {
  const reasonMap: Record<string, string> = {
    cargo_sunk_threshold: '击沉目标达成',
    cargo_arrived: '商船抵达',
    torpedoes_depleted: '鱼雷耗尽',
    all_uboats_sunk: '潜艇全灭',
  }
  return value ? (reasonMap[value] ?? value) : '-'
}

function formatDateTime(value?: string) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function logDetailedFrontendError(scope: string, error: unknown, extra?: Record<string, unknown>) {
  const anyError = error as any
  console.error(`[${scope}] 请求失败`, {
    ...extra,
    message: anyError?.message,
    code: anyError?.code,
    status: anyError?.response?.status,
    statusText: anyError?.response?.statusText,
    url: anyError?.config?.url,
    method: anyError?.config?.method,
    params: anyError?.config?.params,
    responseData: anyError?.response?.data,
    stack: anyError?.stack,
    raw: error,
  })
}

function useDemoRooms() {
  rooms.value = demoRooms.map((room) => ({ ...room }))
  isDemoData.value = true
}

async function loadRooms() {
  isLoading.value = true
  try {
    const result = await getRoomInfos()
    const normalized = normalizeRooms(result)
    rooms.value = normalized
    isDemoData.value = false
  } catch (error) {
    console.warn('房间列表接口不可用，使用本地演示数据。', error)
    useDemoRooms()
  } finally {
    isLoading.value = false
  }
}

function storeCurrentRoom(room: RoomRow) {
  localStorage.setItem('RoomID', room.RoomID)
  localStorage.setItem('RoomMaxPlayers', String(room.maxPlayers))
}

async function joinRoom(room: RoomRow) {
  if (room.status === 'full' || room.PlayerAmount >= room.maxPlayers) return

  joiningRoomID.value = room.RoomID
  try {
    await enterRoom({ RoomID: room.RoomID })
  } catch (error) {
    console.warn('进入房间接口不可用，继续使用本地演示流转。', error)
    isDemoData.value = true
  } finally {
    storeCurrentRoom(room)
    joiningRoomID.value = ''
    await router.push({
      name: isOnlineDemoMode.value ? 'UboatGame_Online_Demo' : 'UboatGame_Online',
      query: isOnlineDemoMode.value
        ? { RoomID: room.RoomID, mode: 'online-demo' }
        : { RoomID: room.RoomID },
    })
  }
}

async function handleCreateRoom() {
  isCreating.value = true
  try {
    const result: any = await createRoom({ maxPlayers: MAX_PLAYERS })
    const room = normalizeRoom(result?.room ?? result?.data?.room ?? result?.data ?? result)
    if (room) {
      rooms.value = [room, ...rooms.value.filter((item) => item.RoomID !== room.RoomID)]
      isDemoData.value = false
      await joinRoom(room)
      return
    }
    throw new Error('创建房间响应缺少 room')
  } catch (error) {
    console.warn('创建房间接口不可用，创建本地演示房间。', error)
    const localRoom: RoomRow = {
      RoomID: `LOCAL-${Date.now().toString().slice(-6)}`,
      PlayerAmount: 1,
      maxPlayers: MAX_PLAYERS,
      status: 'joinable',
    }
    rooms.value = [localRoom, ...rooms.value]
    isDemoData.value = true
    ElMessage.info('后端房间接口暂不可用，已创建本地演示房间。')
    await joinRoom(localRoom)
  } finally {
    isCreating.value = false
  }
}

async function openPlayerRecord() {
  if (!isLoggedIn.value) {
    ElMessage.warning('请登录，再查询战绩')
    return
  }

  recordDialogVisible.value = true
  recordLoading.value = true
  recordSummary.value = { ...emptyRecordSummary }
  recordGames.value = []
  try {
    const result = await getPlayerRecord()
    const source: any = (result as any)?.data ?? result
    if (source?.sf === false) {
      recordDialogVisible.value = false
      console.error('[我的战绩] 后端返回失败', source)
      const message = String(source.message ?? '')
      if (message.includes('登录')) {
        ElMessage.warning('请登录，再查询战绩')
      } else {
        ElMessage.error('战绩查询失败，请稍后重试')
      }
      return
    }
    const normalized = normalizeRecordPayload(result)
    recordSummary.value = normalized.summary
    recordGames.value = normalized.games
  } catch (error) {
    logDetailedFrontendError('我的战绩', error)
    ElMessage.error('战绩查询失败，请稍后重试')
  } finally {
    recordLoading.value = false
  }
}

async function openRoomDetail(room: RoomRow) {
  detailDialogVisible.value = true
  detailLoading.value = true
  selectedRoomDetail.value = { ...room, players: [] }
  try {
    const result = await getRoomDetail(room.RoomID)
    const source: any = (result as any)?.data ?? result
    if (source?.sf === false) {
      console.error('[房间详情] 后端返回失败', { roomID: room.RoomID, response: source })
      ElMessage.error(source.message ? `房间详情查询失败：${source.message}` : '房间详情查询失败，请稍后重试')
      return
    }
    selectedRoomDetail.value = normalizeRoomDetailPayload(result, room)
  } catch (error) {
    logDetailedFrontendError('房间详情', error, { roomID: room.RoomID })
    ElMessage.error('房间详情查询失败，请稍后重试')
  } finally {
    detailLoading.value = false
  }
}

onMounted(() => {
  if (!commanderUUID.value) {
    void router.replace({ name: 'Login' })
    return
  }
  void loadRooms()
})
</script>

<template>
  <main class="room-container">
    <el-button class="room-record-button" type="primary" @click="openPlayerRecord">
      我的战绩
    </el-button>

    <section class="room-card" aria-label="房间选择">
      <header class="room-header">
        <div>
          <p>ONLINE WOLFPACK</p>
          <h1>选择房间</h1>
        </div>
        <div class="room-commander">
          <span>艇长</span>
          <strong>{{ commanderName }}</strong>
        </div>
      </header>

      <div class="room-toolbar">
        <el-button type="primary" :loading="isCreating" @click="handleCreateRoom">
          创建房间
        </el-button>
        <el-button :loading="isLoading" @click="loadRooms">
          刷新列表
        </el-button>
      </div>

      <p v-if="isDemoData" class="room-demo-notice">
        当前为本地演示数据，后端接口接入后将自动显示真实房间。
      </p>

      <el-table
        v-loading="isLoading"
        :data="rooms"
        class="room-table"
        empty-text="暂无可用房间"
      >
        <el-table-column prop="RoomID" label="房间 ID" min-width="180" />
        <el-table-column label="房间内玩家人数" width="160">
          <template #default="{ row }">
            {{ row.PlayerAmount }} / {{ row.maxPlayers }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="row.status === 'joinable' ? 'success' : 'info'">
              {{ row.status === 'joinable' ? '可以加入' : '满员' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" align="right">
          <template #default="{ row }">
            <el-button
              size="small"
              @click="openRoomDetail(row)"
            >
              详情
            </el-button>
            <el-button
              type="primary"
              size="small"
              :disabled="row.status === 'full' || row.PlayerAmount >= row.maxPlayers"
              :loading="joiningRoomID === row.RoomID"
              @click="joinRoom(row)"
            >
              加入
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <el-dialog v-model="recordDialogVisible" title="我的战绩" width="760px" class="player-record-dialog">
      <div v-loading="recordLoading" class="player-record">
        <div class="player-record-summary" aria-label="战绩汇总">
          <div>
            <span>总击沉商船</span>
            <strong>{{ recordSummary.cargoShipsSunk }}</strong>
          </div>
          <div>
            <span>总击沉潜艇</span>
            <strong>{{ recordSummary.uBoatsSunk }}</strong>
          </div>
          <div>
            <span>总吨位</span>
            <strong>{{ recordSummary.totalTonnage }}</strong>
          </div>
          <div>
            <span>参与局数</span>
            <strong>{{ recordSummary.gamesPlayed }}</strong>
          </div>
        </div>

        <el-table :data="recordGames" class="player-record-table" empty-text="暂无战绩记录">
          <el-table-column prop="RoomID" label="房间 ID" min-width="170" />
          <el-table-column label="战局结果" width="90">
            <template #default="{ row }">
              {{ formatResult(row.state) }}
            </template>
          </el-table-column>
          <el-table-column label="结束原因" width="120">
            <template #default="{ row }">
              {{ formatReason(row.reason) }}
            </template>
          </el-table-column>
          <el-table-column prop="cargoShipsSunk" label="本局击沉商船" width="96" />
          <el-table-column prop="uBoatsSunk" label="本局击沉潜艇" width="96" />
          <el-table-column prop="totalTonnage" label="本局吨位" width="100" />
          <el-table-column prop="roomCargoShipsSunk" label="房间击沉商船" width="120" />
          <el-table-column prop="totalCargoShips" label="总商船数" width="96" />
          <el-table-column label="更新时间" width="170">
            <template #default="{ row }">
              {{ formatDateTime(row.updatedAt) }}
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-dialog>

    <el-dialog v-model="detailDialogVisible" title="房间详情" width="520px" class="room-detail-dialog">
      <div v-loading="detailLoading" class="room-detail">
        <div class="room-detail-count">
          <span>房间内玩家人数</span>
          <strong>{{ selectedRoomDetail?.PlayerAmount ?? 0 }} / {{ selectedRoomDetail?.maxPlayers ?? MAX_PLAYERS }}</strong>
        </div>

        <el-table :data="selectedRoomDetail?.players ?? []" class="room-detail-table" empty-text="暂无玩家">
          <el-table-column prop="KommandantName" label="指挥官名称" min-width="140" />
          <el-table-column prop="UBoatID" label="潜艇编号" width="110" />
          <el-table-column label="在线状态" width="100">
            <template #default="{ row }">
              <el-tag :type="row.online ? 'success' : 'info'">
                {{ row.online ? '在线' : '离线' }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-dialog>
  </main>
</template>
