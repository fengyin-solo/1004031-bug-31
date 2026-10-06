<template>
  <section class="page" data-module="water_quality-detail">
    <header class="page-head">
      <div>
        <h2>水质监测详情</h2>
        <p class="page-desc">监测编号 {{ row?.['监测编号'] ?? '—' }}，列表与详情共用同一份数据，批量录入后的结果在这里实时可见。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn ghost" :to="{ name: 'water_quality' }">返回列表</RouterLink>
        <button class="btn" type="button" @click="reload">刷新详情</button>
      </div>
    </header>

    <div v-if="!row" class="detail-missing">
      <p class="error-text">没有找到编号为 {{ entryId }} 的水质监测记录，可能已被重置。</p>
    </div>

    <template v-else>
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">当前状态</span>
          <strong class="stat-value">{{ row.status }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">是否待处理</span>
          <strong class="stat-value">{{ row.pending ? '待处理' : '无需处理' }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">历史记录条数</span>
          <strong class="stat-value">{{ history.length }}</strong>
        </article>
      </div>

      <table class="data-table detail-table">
        <tbody>
          <tr v-for="field in meta.fields" :key="field">
            <th>{{ field }}</th>
            <td>{{ row[field] ?? '—' }}</td>
          </tr>
        </tbody>
      </table>

      <h3 class="detail-subhead">可执行动作</h3>
      <div class="detail-actions">
        <button
          v-for="action in meta.actions"
          :key="action"
          class="btn"
          type="button"
          @click="runAction(action)"
        >
          {{ action }}
        </button>
        <span v-if="actionMessage" :class="actionOk ? 'ok-text' : 'error-text'">{{ actionMessage }}</span>
      </div>

      <h3 class="detail-subhead">历史记录</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>动作</th>
            <th>结果</th>
            <th>说明</th>
            <th>批次</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(record, index) in history" :key="index">
            <td>{{ formatTime(record.time) }}</td>
            <td>{{ record.action }}</td>
            <td :class="record.result === 'success' ? 'ok-text' : 'error-text'">
              {{ record.result === 'success' ? '成功' : '失败' }}
            </td>
            <td>{{ record.detail ?? '—' }}</td>
            <td>{{ record.batchId ?? '—' }}</td>
          </tr>
          <tr v-if="!history.length">
            <td colspan="5" class="empty-state">暂无历史记录，批量录入或状态流转后会追加到这里</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'

import { listEntries, moduleMeta, runAction as applyAction } from '@/api/local-service'
import type { EntryHistory, EntryRow } from '@/data/types'

const meta = moduleMeta('water_quality')
const route = useRoute()
const entryId = Number(route.params.id)

const version = ref(0)
const row = computed<EntryRow | undefined>(() => {
  void version.value
  return listEntries(meta.key).items.find((candidate) => Number(candidate.id) === entryId)
})
const history = computed<EntryHistory[]>(() => row.value?.history ?? [])

const actionMessage = ref('')
const actionOk = ref(false)

function reload() {
  version.value += 1
}

function runAction(action: string) {
  const result = applyAction(meta.key, entryId, action)
  actionOk.value = result.ok
  actionMessage.value = result.message
  reload()
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString('zh-CN', { hour12: false })
}
</script>

<style scoped>
.detail-table th { width: 160px; background: #f8fafc; }
.detail-subhead { font-size: 15px; margin: 18px 0 8px; }
.detail-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.detail-missing { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
.ok-text { color: #067647; }
</style>
