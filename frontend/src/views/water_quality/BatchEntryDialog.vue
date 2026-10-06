<template>
  <div class="modal-mask" @click.self="$emit('close')">
    <div class="modal">
      <header class="modal-head">
        <h3>批量录入水质结果</h3>
        <p class="modal-hint">逐条校验、逐条落库；超出范围的单条标记失败并保留原状态，其余样本不受影响。{{ rangeHint() }}</p>
      </header>

      <div v-if="!submittedJob" class="modal-body">
        <p v-if="!candidates.length" class="error-text">当前没有「已取样」状态的样本可录入结果。</p>
        <table v-else class="data-table batch-table">
          <thead>
            <tr>
              <th class="col-check">
                <input
                  type="checkbox"
                  :checked="allSelected"
                  @change="toggleAll"
                  aria-label="全选"
                />
              </th>
              <th>监测编号</th>
              <th>取样点位</th>
              <th>PH值</th>
              <th>氨氮浓度(mg/L)</th>
              <th>COD值(mg/L)</th>
              <th>浊度(NTU)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in candidates" :key="String(row.id)">
              <td>
                <input v-model="selectedIds" type="checkbox" :value="Number(row.id)" />
              </td>
              <td>{{ row['监测编号'] }}</td>
              <td>{{ row['取样点位'] }}</td>
              <td v-for="field in inputFields" :key="field">
                <input v-model="drafts[Number(row.id)][field]" class="cell-input" type="number" step="0.01" />
              </td>
            </tr>
          </tbody>
        </table>
        <p class="modal-tip">已选 {{ selectedIds.length }} 条；一次提交只产生一个批次，失败后可从失败条目继续。</p>
      </div>

      <div v-else class="modal-body">
        <BatchProgress v-if="jobExists" :job-id="submittedJob.id" @archived="submittedJob = null" />
        <p v-else class="modal-tip">该批次已归档，可继续录入其他样本或关闭。</p>
      </div>

      <footer class="modal-foot">
        <template v-if="!submittedJob">
          <button class="btn ghost" type="button" @click="$emit('close')">取消</button>
          <button class="btn primary" type="button" :disabled="!selectedIds.length || submitting" @click="submit">
            {{ submitting ? '提交中…' : `提交录入（${selectedIds.length} 条）` }}
          </button>
        </template>
        <template v-else>
          <button class="btn" type="button" @click="submitAnother">继续录入其他样本</button>
          <button class="btn primary" type="button" @click="finish">完成并刷新列表</button>
        </template>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'

import {
  FIELD_RANGES,
  getJob,
  rangeHint,
  startBatch,
  subscribeJobs,
  type BatchEntryValues,
  type BatchJob,
} from '@/api/water-quality-batch'
import { listEntries } from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import BatchProgress from './BatchProgress.vue'

const emit = defineEmits<{ (e: 'close'): void; (e: 'submitted'): void }>()

const inputFields = FIELD_RANGES.map((rule) => rule.label) as (keyof BatchEntryValues)[]

const candidates = computed<EntryRow[]>(() => {
  // 依赖批次订阅的 tick：提交后继续录入时，已落库的样本会从候选里消失。
  void batchTick.value
  return listEntries('water_quality').items.filter((row) => String(row.status) === '已取样')
})

const selectedIds = ref<number[]>([])
const drafts = reactive<Record<number, BatchEntryValues>>({})

function emptyDraft(): BatchEntryValues {
  return { PH值: '', 氨氮浓度: '', COD值: '', 浊度: '' }
}

watch(
  candidates,
  (list) => {
    for (const row of list) {
      if (!drafts[Number(row.id)]) {
        drafts[Number(row.id)] = emptyDraft()
      }
    }
  },
  { immediate: true },
)

function ensureDraft(id: number): BatchEntryValues {
  if (!drafts[id]) {
    drafts[id] = { PH值: '', 氨氮浓度: '', COD值: '', 浊度: '' }
  }
  return drafts[id]
}

const allSelected = computed(
  () => candidates.value.length > 0 && selectedIds.value.length === candidates.value.length,
)

function toggleAll(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  selectedIds.value = checked ? candidates.value.map((row) => Number(row.id)) : []
  for (const row of candidates.value) {
    ensureDraft(Number(row.id))
  }
}

const submitting = ref(false)
const submittedJob = ref<BatchJob | null>(null)

const batchTick = ref(0)
let unsubscribeJobs: (() => void) | undefined
onMounted(() => {
  unsubscribeJobs = subscribeJobs(() => (batchTick.value += 1))
})
onUnmounted(() => unsubscribeJobs?.())

const jobExists = computed(() => {
  void batchTick.value
  return submittedJob.value ? Boolean(getJob(submittedJob.value.id)) : false
})

function submit() {
  submitting.value = true
  const entries = selectedIds.value.map((id) => ({ entryId: id, values: { ...ensureDraft(id) } }))
  const result = startBatch(entries)
  submitting.value = false
  if (!result.ok || !result.job) {
    window.alert(result.message)
    return
  }
  submittedJob.value = result.job
  emit('submitted')
}

function submitAnother() {
  submittedJob.value = null
}

function finish() {
  emit('close')
}
</script>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal {
  width: min(960px, 92vw);
  max-height: 86vh;
  overflow: auto;
  background: #fff;
  border-radius: 10px;
  padding: 16px 18px;
}
.modal-head h3 { margin: 0 0 4px; }
.modal-hint { margin: 0 0 12px; color: var(--muted); font-size: 12px; }
.batch-table th, .batch-table td { white-space: nowrap; }
.col-check { width: 36px; }
.cell-input { width: 100px; padding: 4px 6px; border: 1px solid var(--border); border-radius: 4px; }
.modal-tip { margin: 10px 0 0; font-size: 12px; color: var(--muted); }
.modal-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
</style>
