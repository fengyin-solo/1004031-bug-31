<template>
  <section class="page" data-module="water_quality">
    <header class="page-head">
      <div>
        <h2>水质监测管理</h2>
        <p class="page-desc">维护水质监测记录，围绕监测编号、取样点位、取样日期、PH值做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openBatch">批量录入结果</button>
        <button class="btn" type="button" @click="exportRows">导出水质监测清单</button>
      </div>
    </header>

    <PendingRetryPanel />

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>待处理</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-pending': row.pending }">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td>
            <span v-if="row.pending" class="pending-tag">待处理</span>
            <span v-else>—</span>
          </td>
          <td class="row-actions">
            <RouterLink class="link" :to="{ name: 'water_quality_detail', params: { id: row.id } }">详情</RouterLink>
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无水质监测数据，可先登记水质监测记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条水质监测记录 · 本页累计批量提交 {{ batchCount }} 次（一次提交算一次，重试不另计）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <BatchEntryDialog
      v-if="batchVisible"
      @close="closeBatch"
      @submitted="reload"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  batchCommitCount,
  listPendingRetries,
  subscribeJobs,
} from '@/api/water-quality-batch'
import type { EntryRow } from '@/data/types'
import BatchEntryDialog from './BatchEntryDialog.vue'
import PendingRetryPanel from './PendingRetryPanel.vue'

const meta = moduleMeta('water_quality')
const columns = ["监测编号", "取样点位", "取样日期", "PH值", "氨氮浓度", "COD值", "浊度", "监测结论"]
const actions = ["安排取样", "录入结果", "标记超标"]
const statuses = ["待取样", "已取样", "已出结果", "已超标"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const batchVisible = ref(false)
const jobVersion = ref(0)

let unsubscribe: (() => void) | undefined
onMounted(() => {
  // 批次逐条落库时刷新列表，保证「录入后列表与详情一致」。
  unsubscribe = subscribeJobs(() => {
    jobVersion.value += 1
    reload()
  })
})
onUnmounted(() => unsubscribe?.())

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 统计直接数当前记录，批量提交/重试都不会新增样本行，工作台不会多出重复计数。
const stats = computed(() => {
  void jobVersion.value
  return [
    { label: "取样计划数", value: rows.value.length },
    { label: "已出结果数", value: rows.value.filter((row) => row.status === '已出结果' || row.status === '已超标').length },
    { label: "超标样本数", value: rows.value.filter((row) => row.status === '已超标').length },
    { label: "待重试条目", value: listPendingRetries().length },
  ]
})

const batchCount = computed(() => {
  void jobVersion.value
  return batchCommitCount()
})

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openBatch() {
  errorMessage.value = ''
  batchVisible.value = true
}

function closeBatch() {
  batchVisible.value = false
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '水质监测列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.row-pending { background: #fffbeb; }
.pending-tag { color: #b54708; font-size: 12px; background: #fef3c7; border-radius: 999px; padding: 1px 8px; }
</style>
