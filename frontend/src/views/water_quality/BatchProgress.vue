<template>
  <div v-if="job" class="batch-progress">
    <div class="progress-head">
      <div>
        <strong>批次 {{ job.id }}</strong>
        <p class="progress-meta">
          {{ statusLabel }} ·
          成功 {{ count.success }} 条 ·
          失败 {{ count.failed }} 条 ·
          重复 {{ count.duplicate }} 条 ·
          待处理 {{ count.waiting + count.processing }} 条
        </p>
      </div>
      <div class="progress-actions">
        <button v-if="job.status === 'running'" class="btn" type="button" @click="abort">中断</button>
        <button
          v-if="job.status === 'interrupted'"
          class="btn primary"
          type="button"
          @click="retry"
        >
          从失败条目继续（{{ count.failed + count.waiting }}）
        </button>
        <button
          v-if="job.status === 'finished'"
          class="btn ghost"
          type="button"
          @click="archive"
        >
          归档批次
        </button>
      </div>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>监测编号</th>
          <th>取样点位</th>
          <th>处理状态</th>
          <th>说明</th>
          <th>尝试次数</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in job.items" :key="item.entryId">
          <td>{{ item.code }}</td>
          <td>{{ item.point }}</td>
          <td :class="itemClass(item.status)">{{ itemLabel(item.status) }}</td>
          <td>{{ item.message || '—' }}</td>
          <td>{{ item.attempts }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import {
  abortJob,
  getJob,
  removeJob,
  retryJob,
  subscribeJobs,
  type BatchItemStatus,
  type BatchJob,
} from '@/api/water-quality-batch'

const props = defineProps<{ jobId: string }>()
const emit = defineEmits<{ (e: 'archived'): void }>()

const tick = ref(0)
let timer: ReturnType<typeof setInterval> | undefined
let unsubscribe: (() => void) | undefined

onMounted(() => {
  unsubscribe = subscribeJobs(() => (tick.value += 1))
  // 兜底轮询：批量处理是逐条异步落库的，即使错过订阅也能刷新进度。
  timer = setInterval(() => (tick.value += 1), 200)
})
onUnmounted(() => {
  unsubscribe?.()
  if (timer) {
    clearInterval(timer)
  }
})

const job = computed<BatchJob | undefined>(() => {
  void tick.value
  return getJob(props.jobId)
})

const count = computed(() => {
  const items = job.value?.items ?? []
  return {
    success: items.filter((item) => item.status === 'success').length,
    failed: items.filter((item) => item.status === 'failed').length,
    duplicate: items.filter((item) => item.status === 'duplicate').length,
    waiting: items.filter((item) => item.status === 'waiting').length,
    processing: items.filter((item) => item.status === 'processing').length,
  }
})

const statusLabel = computed(() => {
  switch (job.value?.status) {
    case 'running':
      return '处理中'
    case 'interrupted':
      return '已中断（可续跑）'
    case 'finished':
      return '已完成'
    default:
      return '—'
  }
})

function itemLabel(status: BatchItemStatus): string {
  return { waiting: '待处理', processing: '处理中', success: '成功', failed: '失败待重试', duplicate: '重复未覆盖' }[status]
}

function itemClass(status: BatchItemStatus): string {
  if (status === 'success') {
    return 'ok-text'
  }
  if (status === 'failed') {
    return 'error-text'
  }
  if (status === 'duplicate') {
    return 'warn-text'
  }
  return 'muted-text'
}

function abort() {
  abortJob(props.jobId)
}

function retry() {
  const result = retryJob(props.jobId)
  if (!result.ok) {
    window.alert(result.message)
  }
}

function archive() {
  const result = removeJob(props.jobId)
  if (result.ok) {
    emit('archived')
  }
}
</script>

<style scoped>
.progress-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; gap: 12px; }
.progress-meta { margin: 4px 0 0; color: var(--muted); font-size: 12px; }
.progress-actions { display: flex; gap: 8px; flex-shrink: 0; }
.ok-text { color: #067647; }
.error-text { color: #b42318; }
.warn-text { color: #b54708; }
.muted-text { color: var(--muted); }
</style>
