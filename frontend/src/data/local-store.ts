import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'underground-pipeline-inspection:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

/**
 * 绕过模块缓存读最新数据：别的标签页刚提交的改动也能看到。
 * 没有 localStorage 的环境（单测）退回内存缓存。
 */
export function snapshotRows(): Record<string, EntryRow[]> {
  if (typeof window !== 'undefined' && window.localStorage) {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      try {
        return { ...clone(SEED_ROWS), ...(JSON.parse(raw) as Record<string, EntryRow[]>) }
      } catch {
        // 存储内容损坏时退回缓存，缓存会在下一次写入时修复
      }
    }
  }
  return allRows()
}

export function getRow(key: string, id: number): EntryRow | undefined {
  const rows = snapshotRows()[key] ?? []
  const found = rows.find((row) => Number(row.id) === id)
  return found ? clone(found) : undefined
}

/**
 * 读-改-写一条记录：基于最新快照执行 mutator，再把结果整体写回。
 * 并发录入同一样本时，后到的 mutator 能看到先到的已提交状态，从而只保留一个结果。
 * mutator 返回 { next, result }：next 为 undefined 表示本行不变。
 */
export function updateRow<T>(
  key: string,
  id: number,
  mutator: (row: EntryRow | undefined) => { next?: EntryRow; result: T },
): T {
  const data = snapshotRows()
  const rows = [...(data[key] ?? [])]
  const index = rows.findIndex((row) => Number(row.id) === id)
  const current = index >= 0 ? clone(rows[index]) : undefined
  const { next, result } = mutator(current)
  if (next !== undefined) {
    if (index >= 0) {
      rows[index] = next
    } else {
      rows.push(next)
    }
    const all = { ...data, [key]: rows }
    cache = all
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
    }
  }
  return result
}
