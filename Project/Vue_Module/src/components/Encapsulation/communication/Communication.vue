<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  receiveServerNotice,
  receiveTelegram,
  sendTextMessage,
} from '../api/ContactTool'
import {
  latestCursor,
  normalizeArrayPayload,
  type OnlineRoomPlayer,
  type OnlineTextMessage,
  type ServerNotice,
} from './communication'
import '../../../css/communication.css'

const props = defineProps<{
  roomId: string
  players: OnlineRoomPlayer[]
  selfUuid: string
}>()

const messages = ref<OnlineTextMessage[]>([])
const notices = ref<ServerNotice[]>([])
const selectedReceiverUUIDs = ref<string[]>([])
const draft = ref('')
const isSending = ref(false)
const isOpen = ref(false)
const messageCursor = ref('')
const noticeCursor = ref('')

let messageTimer: ReturnType<typeof setInterval> | undefined
let noticeTimer: ReturnType<typeof setInterval> | undefined

const receiverOptions = computed(() =>
  props.players.filter((player) => player.KommandantUUID !== props.selfUuid && player.online),
)

function normalizeMessages(payload: any): OnlineTextMessage[] {
  return normalizeArrayPayload<OnlineTextMessage>(payload, ['messages', 'telegrams'])
}

function normalizeNotices(payload: any): ServerNotice[] {
  return normalizeArrayPayload<ServerNotice>(payload, ['notices'])
}

function appendUniqueMessages(nextMessages: OnlineTextMessage[]) {
  const known = new Set(messages.value.map((item) => item.messageID))
  for (const message of nextMessages) {
    const id = message.messageID ?? `${message.senderUUID}-${message.createdAt}-${message.content}`
    if (known.has(id)) continue
    messages.value.push({ ...message, messageID: id })
    known.add(id)
  }
  messageCursor.value = latestCursor(messages.value, ['messageID', 'createdAt'])
}

function appendUniqueNotices(nextNotices: ServerNotice[]) {
  const known = new Set(notices.value.map((item) => item.noticeID))
  for (const notice of nextNotices) {
    const id = notice.noticeID ?? `${notice.createdAt}-${notice.content}`
    if (known.has(id)) continue
    notices.value.push({ ...notice, noticeID: id })
    known.add(id)
  }
  noticeCursor.value = latestCursor(notices.value, ['noticeID', 'createdAt'])
}

async function pollMessages() {
  if (!props.roomId) return
  try {
    appendUniqueMessages(normalizeMessages(await receiveTelegram(props.roomId, messageCursor.value)))
  } catch (error) {
    console.warn('通信消息轮询失败。', error)
  }
}

async function pollNotices() {
  if (!props.roomId) return
  try {
    appendUniqueNotices(normalizeNotices(await receiveServerNotice(props.roomId, noticeCursor.value)))
  } catch (error) {
    console.warn('服务器提示轮询失败。', error)
  }
}

function startPolling() {
  stopPolling()
  void pollMessages()
  void pollNotices()
  messageTimer = setInterval(pollMessages, 2000)
  noticeTimer = setInterval(pollNotices, 2000)
}

function stopPolling() {
  if (messageTimer) clearInterval(messageTimer)
  if (noticeTimer) clearInterval(noticeTimer)
  messageTimer = undefined
  noticeTimer = undefined
}

async function handleSend() {
  const content = draft.value.trim()
  if (!content) return
  if (selectedReceiverUUIDs.value.length === 0) {
    ElMessage.warning('请选择至少一名接收人。')
    return
  }

  isSending.value = true
  try {
    await sendTextMessage({
      RoomID: props.roomId,
      receiverUUIDs: selectedReceiverUUIDs.value,
      content,
    })
    appendUniqueMessages([
      {
        messageID: `local-${Date.now()}`,
        RoomID: props.roomId,
        senderUUID: props.selfUuid,
        senderName: localStorage.getItem('KommandantName') ?? '我',
        receiverUUIDs: [...selectedReceiverUUIDs.value],
        content,
        createdAt: new Date().toISOString(),
      },
    ])
    draft.value = ''
  } catch (error) {
    console.warn('发送通信失败。', error)
    ElMessage.error('通信发送失败，请稍后重试。')
  } finally {
    isSending.value = false
  }
}

watch(
  () => props.players,
  () => {
    const available = new Set(receiverOptions.value.map((player) => player.KommandantUUID))
    selectedReceiverUUIDs.value = selectedReceiverUUIDs.value.filter((uuid) => available.has(uuid))
  },
)

onMounted(startPolling)
onBeforeUnmount(stopPolling)

defineExpose({ stopPolling, open: () => { isOpen.value = true } })
</script>

<template>
  <div class="communication-drawer" :class="{ 'communication-drawer--open': isOpen }">
    <button
      type="button"
      class="communication-toggle"
      :aria-expanded="isOpen"
      aria-controls="communication-panel"
      @click="isOpen = !isOpen"
    >
      <span>通信</span>
      <strong v-if="messages.length > 0">{{ messages.length }}</strong>
    </button>

    <Transition name="communication-backdrop">
      <button
        v-if="isOpen"
        type="button"
        class="communication-backdrop"
        aria-label="关闭通信"
        @click="isOpen = false"
      ></button>
    </Transition>

    <aside id="communication-panel" class="communication-panel" aria-label="在线通信">
      <header class="communication-header">
        <div>
          <span>通信</span>
          <strong>{{ roomId }}</strong>
        </div>
        <el-button text class="communication-close" @click="isOpen = false">
          关闭
        </el-button>
      </header>

      <section class="communication-section">
        <label class="communication-label">接收人</label>
        <el-select
          v-model="selectedReceiverUUIDs"
          multiple
          collapse-tags
          collapse-tags-tooltip
          placeholder="选择接收人"
          class="communication-select"
        >
          <el-option
            v-for="player in receiverOptions"
            :key="player.KommandantUUID"
            :label="`${player.KommandantName} / ${player.UBoatID}`"
            :value="player.KommandantUUID"
          />
        </el-select>
      </section>

      <section class="communication-log" aria-label="通信记录">
        <p v-if="messages.length === 0" class="communication-empty">暂无通信</p>
        <article
          v-for="message in messages"
          :key="message.messageID"
          class="communication-message"
          :class="{ 'communication-message--self': message.senderUUID === selfUuid }"
        >
          <span>{{ message.senderName }}</span>
          <p>{{ message.content }}</p>
        </article>
      </section>

      <section class="communication-section">
        <el-input
          v-model="draft"
          type="textarea"
          :rows="3"
          resize="none"
          maxlength="300"
          show-word-limit
          placeholder="输入通信内容"
          @keydown.enter.exact.prevent="handleSend"
        />
        <el-button type="primary" class="communication-send" :loading="isSending" @click="handleSend">
          发送
        </el-button>
      </section>

      <section class="server-notices" aria-label="服务器提示">
        <header>服务器提示</header>
        <p v-if="notices.length === 0" class="communication-empty">暂无提示</p>
        <p
          v-for="notice in notices.slice(-4)"
          :key="notice.noticeID"
          class="server-notice"
          :class="`server-notice--${notice.level ?? 'info'}`"
        >
          {{ notice.content }}
        </p>
      </section>
    </aside>
  </div>
</template>
