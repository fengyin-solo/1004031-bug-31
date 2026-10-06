<template>
  <section class="page" data-module="water_quality">
    <header class="page-head">
      <div>
        <h2>水质监测管理</h2>
        <p class="page-desc">维护水质监测记录，围绕监测编号、取样点位、取样日期、PH值做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button
          class="btn primary"
          type="button"
          :disabled="!selectedIds.length"
          @click="openBatchDialog"
        >
          批量录入结果（{{ selectedIds.length }}）
        </button>
        <button class="btn" type="button" @click="openCreate">登记水质监测记录</button>
        <button class="btn" type="button" @click="exportRows">导出水质监测清单</button>
      </div>
    </header>

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

    <section v-if="retryBatches.length" class="retry-panel">
      <header class="retry-head">
        <h3>待重试项（{{ retryItemCount }} 条）</h3>
        <span class="retry-tip">失败样本已保留原状态，修正数值后从失败条目继续；已成功的条目不会重复落库</span>
      </header>
      <article v-for="batch in retryBatches" :key="batch.id" class="retry-batch">
        <div class="retry-batch-head">
          <span>批次 {{ shortId(batch.id) }} · {{ batch.operator }} · {{ formatTime(batch.updatedAt) }}</span>
          <span class="retry-counts">
            共 {{ batch.items.length }} 条 · 成功 {{ countStatus(batch, 'success') }} · 失败 {{ countStatus(batch, 'failed') }}
          </span>
          <button class="btn" type="button" @click="resumeBatch(batch)">从失败条目继续</button>
        </div>
        <ul class="retry-items">
          <li v-for="item in failedItemsOf(batch)" :key="item.rowId">
            <strong>{{ item.sampleNo }}</strong>
            <span>{{ item.message || '等待录入' }}</span>
            <span class="retry-attempts">已试 {{ item.attempts }} 次</span>
          </li>
        </ul>
      </article>
    </section>

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
          <th class="check-col">
            <input
              type="checkbox"
              :checked="allChecked"
              :disabled="!selectableRows.length"
              title="全选可取样的样本"
              @change="toggleAll"
            />
          </th>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td class="check-col">
            <input
              type="checkbox"
              :checked="selectedIds.includes(Number(row.id))"
              :disabled="!selectable(row)"
              :title="selectable(row) ? '选择该样本' : `「${row.status}」状态不能录入结果`"
              @change="toggleOne(Number(row.id))"
            />
          </td>
          <td v-for="column in columns" :key="column">{{ displayCell(row[column]) }}</td>
          <td>
            {{ row.status }}
            <span v-if="row.pending" class="pending-tag">待处理</span>
          </td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">详情</button>
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
      <span>共 {{ total }} 条水质监测记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="dialogOpen" class="modal-mask" @click.self="closeBatchDialog">
      <div class="modal">
        <h3>批量录入检测结果</h3>
        <p class="modal-desc">
          已选 {{ draftItems.length }} 个样本，逐条校验落库：单条超出范围只记该条失败，整批继续；
          同一次提交重复操作不会重复计数。
        </p>
        <table class="data-table modal-table">
          <thead>
            <tr>
              <th>监测编号</th>
              <th>取样点位</th>
              <th v-for="field in entryFields" :key="field.field">
                {{ field.label }}<template v-if="field.unit">（{{ field.unit }}）</template>
              </th>
              <th v-if="hasResult">结果</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in draftItems" :key="item.rowId">
              <td>{{ item.sampleNo }}</td>
              <td>{{ item.point }}</td>
              <td v-for="field in entryFields" :key="field.field">
                <input
                  v-model="item.values[field.field]"
                  class="value-input"
                  :placeholder="`有效范围 ${field.min}~${field.max}`"
                  :disabled="submitting || item.status === 'success' || item.status === 'skipped'"
                />
              </td>
              <td v-if="hasResult">
                <span
                  v-if="item.status"
                  class="batch-tag"
                  :class="item.status"
                  :title="item.message"
                >
                  {{ itemStatusText(item.status) }}
                </span>
                <span v-else>—</span>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="dialogSummary" class="batch-summary">{{ dialogSummary }}</p>
        <footer class="modal-foot">
          <button class="btn ghost" type="button" @click="closeBatchDialog">
            {{ hasResult ? '关闭' : '取消' }}
          </button>
          <button class="btn primary" type="button" :disabled="!canSubmit" @click="submitBatch">
            {{ submitText }}
          </button>
        </footer>
      </div>
    </div>

    <div v-if="detailRow" class="drawer-mask" @click.self="closeDetail">
      <aside class="drawer">
        <header class="drawer-head">
          <h3>监测详情 · {{ detailRow['监测编号'] }}</h3>
          <button class="link" type="button" @click="closeDetail">关闭</button>
        </header>
        <dl class="detail-grid">
          <template v-for="column in columns" :key="column">
            <dt>{{ column }}</dt>
            <dd>{{ displayCell(detailRow[column]) }}</dd>
          </template>
          <dt>当前状态</dt>
          <dd>{{ detailRow.status }}</dd>
        </dl>
        <h4 class="history-title">录入历史（{{ detailHistory.length }}）</h4>
        <ul class="history-list">
          <li v-for="record in detailHistory" :key="record.seq" class="history-item">
            <div class="history-head">
              <span class="batch-tag" :class="record.result">
                {{ record.result === 'success' ? '成功' : '失败' }}
              </span>
              <span>{{ formatTime(record.time) }}</span>
              <span>{{ record.operator }}</span>
              <span>批次 {{ shortId(record.batchId) }}</span>
            </div>
            <p class="history-message">{{ record.message }}</p>
            <p class="history-values">{{ formatValues(record.values) }}</p>
          </li>
          <li v-if="!detailHistory.length" class="empty-history">暂无录入历史</li>
        </ul>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  batchEntryRules,
  createBatchEntry,
  downloadEntries,
  getEntryDetail,
  listBatchEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  runBatchEntry,
  updateBatchEntryItems,
} from '@/api/local-service'
import type { BatchItemStatus, BatchRecord, EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('water_quality')
const columns = ["监测编号", "取样点位", "取样日期", "PH值", "氨氮浓度", "COD值", "浊度", "监测结论"]
const actions = ["安排取样", "录入结果", "标记超标"]
const statuses = ["待取样", "已取样", "已出结果", "已超标"]
const rules = batchEntryRules(meta.key)
const entryFields = rules.ranges

const session = useSessionStore()

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const stats = computed(() => [
  { label: '取样计划数', value: rows.value.length },
  { label: '已出结果数', value: rows.value.filter((row) => String(row.status) === '已出结果').length },
  { label: '超标样本数', value: rows.value.filter((row) => String(row.status) === '已超标').length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// ---- 多选：只有「已取样」的样本能进入批量录入 ----
const selectedIds = ref<number[]>([])

function selectable(row: EntryRow): boolean {
  return String(row.status) === rules.sourceStatus
}

const selectableRows = computed(() => rows.value.filter(selectable))

const allChecked = computed(
  () =>
    selectableRows.value.length > 0 &&
    selectableRows.value.every((row) => selectedIds.value.includes(Number(row.id))),
)

function toggleAll() {
  selectedIds.value = allChecked.value ? [] : selectableRows.value.map((row) => Number(row.id))
}

function toggleOne(id: number) {
  selectedIds.value = selectedIds.value.includes(id)
    ? selectedIds.value.filter((item) => item !== id)
    : [...selectedIds.value, id]
}

// ---- 批量录入对话框 ----
type DraftItem = {
  rowId: number
  sampleNo: string
  point: string
  values: Record<string, string>
  status: BatchItemStatus | ''
  message: string
}

const dialogOpen = ref(false)
const submitting = ref(false)
const draftItems = ref<DraftItem[]>([])
const activeBatchId = ref<string | null>(null)
const resumedBatch = ref(false)
const submitId = ref('')

const hasResult = computed(() => draftItems.value.some((item) => item.status !== ''))

const canSubmit = computed(
  () =>
    !submitting.value &&
    draftItems.value.some((item) => item.status !== 'success' && item.status !== 'skipped'),
)

const submitText = computed(() => {
  if (submitting.value) {
    return '正在逐条录入…'
  }
  if (hasResult.value) {
    return '重试失败条目'
  }
  return resumedBatch.value ? '继续录入' : '提交录入'
})

const dialogSummary = computed(() => {
  if (!hasResult.value) {
    return ''
  }
  const count = (status: BatchItemStatus) =>
    draftItems.value.filter((item) => item.status === status).length
  const parts = [`成功 ${count('success')} 条`]
  if (count('failed')) {
    parts.push(`失败 ${count('failed')} 条（已保留原状态，可修正后重试）`)
  }
  if (count('skipped')) {
    parts.push(`跳过 ${count('skipped')} 条（已有录入结果）`)
  }
  return `本批结果：${parts.join('，')}`
})

function newSubmitId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `SUB-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function emptyValues(): Record<string, string> {
  return Object.fromEntries(entryFields.map((field) => [field.field, '']))
}

function openBatchDialog() {
  const picked = rows.value.filter((row) => selectedIds.value.includes(Number(row.id)))
  if (!picked.length) {
    errorMessage.value = '请先勾选状态为「已取样」的样本'
    return
  }
  draftItems.value = picked.map((row) => ({
    rowId: Number(row.id),
    sampleNo: String(row['监测编号'] ?? `#${row.id}`),
    point: String(row['取样点位'] ?? '—'),
    values: emptyValues(),
    status: '',
    message: '',
  }))
  activeBatchId.value = null
  resumedBatch.value = false
  submitId.value = newSubmitId()
  dialogOpen.value = true
}

/** 中断/失败后继续：只带失败和未处理的条目，已成功的留在原批次里不动。 */
function resumeBatch(batch: BatchRecord) {
  const items = batch.items.filter((item) => item.status === 'failed' || item.status === 'pending')
  if (!items.length) {
    return
  }
  draftItems.value = items.map((item) => {
    const row = getEntryDetail(meta.key, item.rowId)
    return {
      rowId: item.rowId,
      sampleNo: item.sampleNo,
      point: String(row?.['取样点位'] ?? '—'),
      values: { ...item.values },
      status: '' as const,
      message: '',
    }
  })
  activeBatchId.value = batch.id
  resumedBatch.value = true
  submitId.value = batch.submitId
  dialogOpen.value = true
}

function submitBatch() {
  if (!canSubmit.value) {
    return
  }
  submitting.value = true
  errorMessage.value = ''
  try {
    const payload = draftItems.value
      .filter((item) => item.status !== 'success' && item.status !== 'skipped')
      .map((item) => ({ rowId: item.rowId, values: { ...item.values } }))
    let batchId = activeBatchId.value
    if (batchId) {
      // 同一批次继续：只更新还没成功的条目，已成功的不动
      updateBatchEntryItems(meta.key, batchId, payload)
    } else {
      // 幂等：submitId 在一次表单会话内不变，重复提交只认第一个批次
      const batch = createBatchEntry(meta.key, payload, session.operator, submitId.value)
      batchId = batch.id
      activeBatchId.value = batch.id
    }
    const result = runBatchEntry(meta.key, batchId)
    for (const item of result.items) {
      const draft = draftItems.value.find((entry) => entry.rowId === item.rowId)
      if (draft) {
        draft.status = item.status
        draft.message = item.message
      }
    }
    const failed = result.items.filter((item) => item.status === 'failed').length
    noticeMessage.value =
      failed === 0
        ? `批次 ${shortId(result.id)} 录入完成，${result.items.length} 个样本全部落库`
        : `批次 ${shortId(result.id)} 录入完成：${failed} 条失败已保留原状态，可在待重试列表继续`
    reload()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '批量录入失败'
  } finally {
    submitting.value = false
  }
}

function closeBatchDialog() {
  dialogOpen.value = false
  draftItems.value = []
  activeBatchId.value = null
  resumedBatch.value = false
  reload()
}

// ---- 待重试项集中展示 ----
const batches = ref<BatchRecord[]>([])

const retryBatches = computed(() =>
  batches.value.filter((batch) =>
    batch.items.some((item) => item.status === 'failed' || item.status === 'pending'),
  ),
)

const retryItemCount = computed(() =>
  retryBatches.value.reduce(
    (sum, batch) =>
      sum + batch.items.filter((item) => item.status === 'failed' || item.status === 'pending').length,
    0,
  ),
)

function failedItemsOf(batch: BatchRecord) {
  return batch.items.filter((item) => item.status === 'failed' || item.status === 'pending')
}

function countStatus(batch: BatchRecord, status: BatchItemStatus): number {
  return batch.items.filter((item) => item.status === status).length
}

// ---- 详情抽屉：读最新快照，历史记录只增不减 ----
const detailRow = ref<EntryRow | null>(null)

const detailHistory = computed(() =>
  [...(detailRow.value?.history ?? [])].sort((a, b) => b.seq - a.seq),
)

function openDetail(row: EntryRow) {
  detailRow.value = getEntryDetail(meta.key, Number(row.id)) ?? null
}

function closeDetail() {
  detailRow.value = null
}

// ---- 展示辅助 ----
function displayCell(value: unknown): string {
  const text = String(value ?? '')
  return text === '' ? '—' : text
}

function shortId(id: string): string {
  const parts = id.split('-')
  return parts[parts.length - 1] || id
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('zh-CN', { hour12: false })
}

function formatValues(values: Record<string, string>): string {
  return entryFields.map((field) => `${field.label} ${values[field.field] || '—'}`).join('　')
}

function itemStatusText(status: BatchItemStatus): string {
  const text: Record<BatchItemStatus, string> = {
    pending: '待处理',
    success: '成功',
    failed: '失败',
    skipped: '已跳过',
  }
  return text[status]
}

// ---- 列表与单行动作 ----
function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '水质监测记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
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
    // 状态流转后可能不再可选，顺手清掉失效的勾选
    selectedIds.value = selectedIds.value.filter((id) => {
      const row = payload.items.find((entry) => Number(entry.id) === id)
      return row ? selectable(row) : false
    })
    batches.value = listBatchEntries(meta.key)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '水质监测列表读取失败'
  }
}

onMounted(reload)
</script>
