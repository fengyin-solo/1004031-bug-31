import { listRows, saveRows } from '@/data/local-store'
import type { EntryHistory, EntryRow } from '@/data/types'

// 水质监测批量录入：多选样本逐条提交，单条失败不影响整批，失败项集中待重试。
// 数据直接落主存储（listRows/saveRows），列表页和详情页读的是同一份，不会出现对不上的情况。

const MODULE_KEY = 'water_quality'
const RESULT_STATUS = '已出结果'
const OVER_STATUS = '已超标'
const SAMPLE_STATUS = '已取样'
const BATCH_STORAGE_KEY = 'underground-pipeline-inspection:water-quality-batches'

export type BatchEntryValues = {
  PH值: string
  氨氮浓度: string
  COD值: string
  浊度: string
}

export type BatchItemStatus = 'waiting' | 'processing' | 'success' | 'failed' | 'duplicate'

export type BatchItem = {
  entryId: number
  code: string
  point: string
  values: BatchEntryValues
  status: BatchItemStatus
  message: string
  attempts: number
}

export type BatchJobStatus = 'running' | 'interrupted' | 'finished'

export type BatchJob = {
  id: string
  createdAt: string
  finishedAt?: string
  status: BatchJobStatus
  items: BatchItem[]
}

export type PendingRetry = {
  jobId: string
  item: BatchItem
}

type FieldRule = { label: string; min: number; max: number; unit: string }

// 仪器可录入的合理范围：超出范围视为本次录入失败（不是业务超标，超标走「标记超标」流程）。
export const FIELD_RANGES: FieldRule[] = [
  { label: 'PH值', min: 0, max: 14, unit: '' },
  { label: '氨氮浓度', min: 0, max: 50, unit: 'mg/L' },
  { label: 'COD值', min: 0, max: 500, unit: 'mg/L' },
  { label: '浊度', min: 0, max: 1000, unit: 'NTU' },
]

export function rangeHint(): string {
  return FIELD_RANGES.map((rule) =>
    rule.unit ? `${rule.label} ${rule.min}~${rule.max}${rule.unit}` : `${rule.label} ${rule.min}~${rule.max}`,
  ).join('；')
}

export function validateValues(values: BatchEntryValues): string {
  for (const rule of FIELD_RANGES) {
    const raw = String(values[rule.label as keyof BatchEntryValues] ?? '').trim()
    if (raw === '') {
      return `${rule.label}未填写`
    }
    const num = Number(raw)
    if (!Number.isFinite(num)) {
      return `${rule.label}「${raw}」不是有效数值`
    }
    if (num < rule.min || num > rule.max) {
      const scope = rule.unit ? `${rule.min}~${rule.max}${rule.unit}` : `${rule.min}~${rule.max}`
      return `${rule.label} ${raw} 超出允许范围（${scope}）`
    }
  }
  return ''
}

// 成功录入后给出监测结论；结论疑似超标不改变本次「已出结果」状态，由人工再标记超标。
function buildConclusion(values: BatchEntryValues): string {
  const ph = Number(values.PH值)
  const ammonia = Number(values.氨氮浓度)
  const cod = Number(values.COD值)
  const turbidity = Number(values.浊度)
  const normal = ph >= 6 && ph <= 9 && ammonia <= 5 && cod <= 40 && turbidity <= 10
  return normal ? '合格' : '疑似超标（待复核）'
}

// ---- 批次持久化 -------------------------------------------------------------

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readJobs(): Map<string, BatchJob> {
  const fallback = new Map<string, BatchJob>()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(BATCH_STORAGE_KEY)
  if (!raw) {
    return fallback
  }
  try {
    const list = JSON.parse(raw) as BatchJob[]
    const map = new Map<string, BatchJob>()
    for (const job of list) {
      // 刷新/关页面时跑到一半的批次不可能继续执行，恢复时直接标为中断，等待人工续跑。
      if (job.status === 'running') {
        job.status = 'interrupted'
        for (const item of job.items) {
          if (item.status === 'processing') {
            item.status = 'failed'
            item.message = '批次中断，该条目未完成'
          }
        }
      }
      map.set(job.id, job)
    }
    return map
  } catch {
    return fallback
  }
}

let jobsCache: Map<string, BatchJob> | null = null

function jobs(): Map<string, BatchJob> {
  if (jobsCache === null) {
    jobsCache = readJobs()
  }
  return jobsCache
}

function persistJobs(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(BATCH_STORAGE_KEY, JSON.stringify([...jobs().values()]))
  }
  listeners.forEach((cb) => cb())
}

const listeners = new Set<() => void>()

export function subscribeJobs(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

// ---- 并发控制：同一样本同时只允许一个批次写入，先到先得，后者只记录不覆盖 ----

const entryLocks = new Set<string>()

function lockKey(entryId: number): string {
  return `${MODULE_KEY}:${entryId}`
}

function appendHistory(row: EntryRow, record: EntryHistory): EntryHistory[] {
  // 只追加不改写，保证详情页历史时间线完整。
  return [...(row.history ?? []), record]
}

// 单条落库：整段同步执行，读-改-写之间不会被其他批次插队。
function commitItem(jobId: string, item: BatchItem): void {
  const reason = validateValues(item.values)
  const rows = [...listRows(MODULE_KEY)]
  const index = rows.findIndex((row) => Number(row.id) === item.entryId)
  const now = new Date().toISOString()

  if (index < 0) {
    item.status = 'failed'
    item.message = `样本已不存在，编号 ${item.entryId}`
    return
  }
  const row = rows[index]

  // 样本被删除等异常情况下兜底；正常入口只允许选择「已取样」样本。
  if (reason !== '') {
    // 失败样本：保留原状态，但置为待处理并记录失败原因，等修正后重试。
    rows[index] = {
      ...row,
      pending: true,
      history: appendHistory(row, {
        time: now,
        action: '批量录入结果',
        result: 'failed',
        detail: reason,
        batchId: jobId,
      }),
    }
    saveRows(MODULE_KEY, rows)
    item.status = 'failed'
    item.message = reason
    return
  }

  // 并发去重：该样本已经被其他批次（或早先流程）录入过结果，只保留第一个结果。
  if (String(row.status) === RESULT_STATUS || String(row.status) === OVER_STATUS) {
    rows[index] = {
      ...row,
      history: appendHistory(row, {
        time: now,
        action: '批量录入结果',
        result: 'failed',
        detail: '该样本已有录入结果，本次并发提交不覆盖',
        batchId: jobId,
      }),
    }
    saveRows(MODULE_KEY, rows)
    item.status = 'duplicate'
    item.message = '样本已被其他批次录入，保留先提交的结果'
    return
  }

  const conclusion = buildConclusion(item.values)
  rows[index] = {
    ...row,
    status: RESULT_STATUS,
    pending: false,
    abnormal: false,
    PH值: item.values.PH值.trim(),
    氨氮浓度: `${item.values.氨氮浓度.trim()}mg/L`,
    COD值: `${item.values.COD值.trim()}mg/L`,
    浊度: `${item.values.浊度.trim()}NTU`,
    监测结论: conclusion,
    history: appendHistory(row, {
      time: now,
      action: '批量录入结果',
      result: 'success',
      detail: `结论：${conclusion}`,
      batchId: jobId,
    }),
  }
  saveRows(MODULE_KEY, rows)
  item.status = 'success'
  item.message = '录入成功'
}

// 中断信号只存在于内存：刷新后通过持久化状态恢复为 interrupted。
const abortSignals = new Set<string>()

// 模拟逐条提交的处理耗时，让中断与并发行为可观察；替换为真实接口时删掉即可。
function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 40))
}

async function processQueue(job: BatchJob): Promise<void> {
  // 续跑顺序：先补失败条目，再继续中断时还在排队的条目；成功/去重的条目跳过。
  const failed = job.items.filter((item) => item.status === 'failed')
  const waiting = job.items.filter((item) => item.status === 'waiting')
  const queue = [...failed, ...waiting]

  for (const item of queue) {
    if (abortSignals.has(job.id)) {
      break
    }
    const key = lockKey(item.entryId)
    if (entryLocks.has(key)) {
      // 另一个批次正在写同一样本：不等待、不覆盖，本批次记为重复后继续处理下一条。
      item.status = 'duplicate'
      item.message = '样本正被其他批次录入，保留先提交的结果'
      persistJobs()
      continue
    }
    entryLocks.add(key)
    item.status = 'processing'
    persistJobs()
    try {
      await nextTick()
      if (abortSignals.has(job.id)) {
        // 中断发生在本条处理期间：本条尚未落库，回到 failed，下次从它开始。
        item.status = 'failed'
        item.message = '批次中断，该条目未完成'
        break
      }
      item.attempts += 1
      commitItem(job.id, item)
    } catch (error) {
      item.status = 'failed'
      item.message = error instanceof Error ? error.message : '录入异常'
    } finally {
      entryLocks.delete(key)
    }
    persistJobs()
  }

  abortSignals.delete(job.id)
  const hasUnfinished = job.items.some((item) => item.status === 'waiting' || item.status === 'failed' || item.status === 'processing')
  job.status = hasUnfinished ? 'interrupted' : 'finished'
  job.finishedAt = new Date().toISOString()
  persistJobs()
}

// ---- 对外接口 ---------------------------------------------------------------

export function listJobs(): BatchJob[] {
  return [...jobs().values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

export function getJob(jobId: string): BatchJob | undefined {
  return jobs().get(jobId)
}

export function listPendingRetries(): PendingRetry[] {
  // 待重试项集中展示：未结束批次里的失败条目，以及中断时还没处理到的排队条目
  // （重复条目无需重试）。
  const result: PendingRetry[] = []
  for (const job of listJobs()) {
    if (job.status === 'finished') {
      continue
    }
    for (const item of job.items) {
      if (item.status === 'failed' || item.status === 'waiting') {
        result.push({ jobId: job.id, item })
      }
    }
  }
  return result
}

export function batchCommitCount(): number {
  // 一次提交只产生一个批次，重试复用原批次，不计新次数。
  return jobs().size
}

export function startBatch(
  entries: Array<{ entryId: number; values: BatchEntryValues }>,
): { ok: boolean; message: string; job?: BatchJob } {
  const rows = listRows(MODULE_KEY)
  const picked = new Map<number, BatchItem>()
  for (const entry of entries) {
    if (picked.has(entry.entryId)) {
      continue // 同一次提交里勾选重复样本时只保留一条
    }
    const row = rows.find((candidate) => Number(candidate.id) === entry.entryId)
    if (!row) {
      continue
    }
    if (String(row.status) !== SAMPLE_STATUS) {
      continue // 只有「已取样」样本可录入结果
    }
    picked.set(entry.entryId, {
      entryId: entry.entryId,
      code: String(row['监测编号'] ?? ''),
      point: String(row['取样点位'] ?? ''),
      values: clone(entry.values),
      status: 'waiting',
      message: '',
      attempts: 0,
    })
  }
  if (picked.size === 0) {
    return { ok: false, message: '没有可批量录入的「已取样」样本' }
  }
  const job: BatchJob = {
    id: `BAT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    status: 'running',
    items: [...picked.values()],
  }
  jobs().set(job.id, job)
  abortSignals.delete(job.id)
  persistJobs()
  void processQueue(job)
  return { ok: true, message: `批次 ${job.id} 已提交，共 ${job.items.length} 条`, job }
}

export function retryJob(jobId: string): { ok: boolean; message: string } {
  const job = jobs().get(jobId)
  if (!job) {
    return { ok: false, message: '批次不存在，可能已被归档' }
  }
  if (job.status === 'running') {
    return { ok: false, message: '该批次正在处理中，无需重复提交' }
  }
  if (!job.items.some((item) => item.status === 'failed' || item.status === 'waiting')) {
    return { ok: false, message: '该批次没有待重试条目' }
  }
  job.status = 'running'
  abortSignals.delete(jobId)
  persistJobs()
  void processQueue(job)
  return { ok: true, message: `批次 ${jobId} 已从失败条目继续` }
}

export function abortJob(jobId: string): { ok: boolean; message: string } {
  const job = jobs().get(jobId)
  if (!job) {
    return { ok: false, message: '批次不存在' }
  }
  if (job.status !== 'running') {
    return { ok: false, message: '批次不在进行中' }
  }
  abortSignals.add(jobId)
  return { ok: true, message: '已请求中断，当前条目处理完后停止' }
}

export function updateRetryValue(jobId: string, entryId: number, field: keyof BatchEntryValues, value: string): void {
  const job = jobs().get(jobId)
  const item = job?.items.find((candidate) => candidate.entryId === entryId)
  // 中断时未处理到的 waiting 条目同样可以修正后随批次继续。
  if (item && (item.status === 'failed' || item.status === 'waiting')) {
    item.values[field] = value
    persistJobs()
  }
}

export function removeJob(jobId: string): { ok: boolean; message: string } {
  const job = jobs().get(jobId)
  if (!job) {
    return { ok: false, message: '批次不存在' }
  }
  if (job.status === 'running') {
    return { ok: false, message: '批次处理中，请先中断再归档' }
  }
  jobs().delete(jobId)
  persistJobs()
  return { ok: true, message: '批次已归档' }
}
