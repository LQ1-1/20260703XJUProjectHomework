<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { createRoom, enterRoom, getRoomInfos } from '../api/ContactTool'
import type { RoomDTO } from '../api/ContactTool'
import '../../../css/room.css'

type RoomRow = Required<Pick<RoomDTO, 'RoomID' | 'PlayerAmount' | 'maxPlayers' | 'status'>>

const MAX_PLAYERS = 8

const router = useRouter()
const rooms = ref<RoomRow[]>([])
const isLoading = ref(false)
const isCreating = ref(false)
const isDemoData = ref(false)
const joiningRoomID = ref('')

const commanderUUID = computed(() => localStorage.getItem('KommandantUUID') ?? '')
const commanderName = computed(() => localStorage.getItem('KommandantName') ?? 'Kommandant')

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
      name: 'UboatGame_Online',
      query: { RoomID: room.RoomID },
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
        <el-table-column label="操作" width="130" align="right">
          <template #default="{ row }">
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
  </main>
</template>
