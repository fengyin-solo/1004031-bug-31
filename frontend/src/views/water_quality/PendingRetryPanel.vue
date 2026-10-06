<template>
  <section class="retry-panel">
    <header class="retry-head">
      <h3>待重试条目（{{ pending.length }}）</h3>
      <p class="retry-hint">
        这些样本在批量录入中失败，原状态保留且标记为待处理；修正数值后从这里继续，成功的条目不会被重复处理。
      </p>
    </header>

    <p v-if="!pending.length" class="retry-empty">当前没有待重试条目。</p>

    <template v-else>
      <div v-for="group in groups" :key="group.job.id" class="retry-group">
        <div class="retry-group-head">
          <strong>批次 {{ group.job.id }}</strong>
          <span class="retry-group-meta">
            提交于 {{ formatTime(group.job.createdAt) }} · 待处理 {{ group.items.length }} 条
          </span>
          <span class="retry-group-actions">
            <button class="btn primary" type="button" @click="resume(group.job.id)">从失败条目继续</button>
            <button
              v-if="group.job.status === 'running'"
              class="btn"
              type="button"
              @click="abort(group.job.id)"
            >
              中断
            </button>
          </span>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th>监测编号</th>
              <th>取样点位</th>
              <th>PH值</th>
              <th>氨氮浓度(mg/L)</th>
              <th>COD值(mg/L)</th>
              <th>浊度(NTU)</th>
              <th>失败原因</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in group.items" :key="entry.item.entryId">
              <td>{{ entry.item.code }}</td>
              <td>{{ entry.item.point }}</td>
              <td v-for="field in fields" :key="field">
                <input
                  :value="entry.item.values[field]"
                  class="retry-input"
                  type="number"
                  step="0.01"
                  :disabled="group.job.status === 'running'"
                  @input="updateValue(group.job.id, entry.item.entryId, field, ($event.target as HTMLInputElement).value)"
                />
              </td>
              <td class="error-text">{{ entry.item.message }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import {
  abortJob,
  listJobs,
  listPendingRetries,
  retryJob,
  subscribeJobs,
  updateRetryValue,
  type BatchEntryValues,
  type BatchJob,
  type PendingRetry,
} from '@/api/water-quality-batch'

const fields = ['PH值', '氨氮浓度', 'COD值', '浊度'] as (keyof BatchEntryValues)[]

const tick = ref(0)
let unsubscribe: (() => void) | undefined
onMounted(() => {
  unsubscribe = subscribeJobs(() => (tick.value += 1))
})
onUnmounted(() => unsubscribe?.())

const pending = computed<PendingRetry[]>(() => {
  void tick.value
  return listPendingRetries()
})

const groups = computed(() => {
  const map = new Map<string, { job: BatchJob; items: PendingRetry[] }>()
  for (const entry of pending.value) {
    const job = listJobs().find((candidate) => candidate.id === entry.jobId)
    if (!job) {
      continue
    }
    if (!map.has(job.id)) {
      map.set(job.id, { job, items: [] })
    }
    map.get(job.id)?.items.push(entry)
  }
  return [...map.values()]
})

function updateValue(jobId: string, entryId: number, field: keyof BatchEntryValues, value: string) {
  updateRetryValue(jobId, entryId, field, value)
}

function resume(jobId: string) {
  const result = retryJob(jobId)
  if (!result.ok) {
    window.alert(result.message)
  }
}

function abort(jobId: string) {
  abortJob(jobId)
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}
</script>

<style scoped>
.retry-panel {
  background: #fff;
  border: 1px solid #f0b429;
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 14px;
}
.retry-head h3 { margin: 0; font-size: 15px; }
.retry-hint { margin: 4px 0 10px; color: var(--muted); font-size: 12px; }
.retry-empty { color: var(--muted); font-size: 13px; margin: 0; }
.retry-group { margin-bottom: 12px; }
.retry-group-head { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; font-size: 13px; flex-wrap: wrap; }
.retry-group-meta { color: var(--muted); font-size: 12px; }
.retry-group-actions { margin-left: auto; display: flex; gap: 8px; }
.retry-input { width: 110px; padding: 4px 6px; border: 1px solid var(--border); border-radius: 4px; }
</style>
