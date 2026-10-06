import type { BatchRecord } from './types'

// 批次记录单独存一份：和 entries 分开，批量录入的进度、断点都在这。
// 每条样本处理完就落一次盘，页面中途关掉也能从失败/未处理的条目继续。
const BATCH_STORAGE_KEY = 'underground-pipeline-inspection:batches'

let memoryBatches: BatchRecord[] | null = null

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readBatches(): BatchRecord[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    if (memoryBatches === null) {
      memoryBatches = []
    }
    return memoryBatches
  }
  const raw = window.localStorage.getItem(BATCH_STORAGE_KEY)
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as BatchRecord[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeBatches(batches: BatchRecord[]): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    memoryBatches = batches
    return
  }
  window.localStorage.setItem(BATCH_STORAGE_KEY, JSON.stringify(batches))
}

export function listBatchRecords(moduleKey?: string): BatchRecord[] {
  const all = readBatches()
  const matched = moduleKey ? all.filter((batch) => batch.module === moduleKey) : all
  // 最新的排前面，待重试列表直接按这个顺序展示
  return clone(matched).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function getBatchRecord(id: string): BatchRecord | undefined {
  const found = readBatches().find((batch) => batch.id === id)
  return found ? clone(found) : undefined
}

export function findBatchBySubmitId(moduleKey: string, submitId: string): BatchRecord | undefined {
  const found = readBatches().find(
    (batch) => batch.module === moduleKey && batch.submitId === submitId,
  )
  return found ? clone(found) : undefined
}

/** 按 id 覆盖或新增；每次都基于最新快照合并，避免并发放大。 */
export function saveBatchRecord(record: BatchRecord): BatchRecord {
  const all = readBatches()
  const index = all.findIndex((batch) => batch.id === record.id)
  const snapshot = clone(record)
  if (index >= 0) {
    all[index] = snapshot
  } else {
    all.push(snapshot)
  }
  writeBatches(all)
  return clone(snapshot)
}
