/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

/** 详情里展示的录入历史：只增不改，重试、并发冲突都不能把它弄丢。 */
export type HistoryRecord = {
  seq: number
  time: string
  operator: string
  action: string
  batchId: string
  result: 'success' | 'failed'
  message: string
  values: Record<string, string>
}

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  history?: HistoryRecord[]
  [field: string]: string | number | boolean | HistoryRecord[] | undefined
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 批量录入：批次里单条样本的状态。skipped 表示并发冲突时保留了先到的结果。 */
export type BatchItemStatus = 'pending' | 'success' | 'failed' | 'skipped'

export type BatchItem = {
  rowId: number
  sampleNo: string
  values: Record<string, string>
  status: BatchItemStatus
  message: string
  attempts: number
}

/** 一次批量录入提交对应一个批次；submitId 是幂等键，同一次提交重复调用只认第一个批次。 */
export type BatchRecord = {
  id: string
  submitId: string
  module: string
  operator: string
  createdAt: string
  updatedAt: string
  done: boolean
  items: BatchItem[]
}

export type BatchItemInput = {
  rowId: number
  values: Record<string, string>
}
