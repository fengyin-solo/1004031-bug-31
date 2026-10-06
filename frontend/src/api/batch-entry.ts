import {
  findBatchBySubmitId,
  getBatchRecord,
  listBatchRecords,
  saveBatchRecord,
} from '@/data/batch-store'
import { listRows, updateRow } from '@/data/local-store'
import type {
  BatchItem,
  BatchItemInput,
  BatchItemStatus,
  BatchRecord,
  HistoryRecord,
} from '@/data/types'

// 批量录入引擎：逐条校验、逐条落库。单条失败只影响自己，整批继续往前走；
// 每条处理完批次记录就落盘一次，中断后能从失败/未处理的条目继续。

type RangeRule = {
  field: string
  label: string
  min: number
  max: number
  unit: string
}

type ModuleBatchRule = {
  /** 只有处于这个状态的样本允许录入结果 */
  sourceStatus: string
  /** 已有结果的终态：命中说明别的提交已经录过，本条跳过、保留首次结果 */
  finalStatuses: string[]
  /** 录入结论写到这一列 */
  conclusionField: string
  /** 样本编号所在的列，批次条目展示用 */
  codeField: string
  ranges: RangeRule[]
  /** 数值在有效范围内后，再按达标限值给结论 */
  judge: (values: Record<string, string>) => { conclusion: string; status: string; abnormal: boolean }
}

const BATCH_RULES: Record<string, ModuleBatchRule> = {
  water_quality: {
    sourceStatus: '已取样',
    finalStatuses: ['已出结果', '已超标'],
    conclusionField: '监测结论',
    codeField: '监测编号',
    ranges: [
      { field: 'PH值', label: 'PH值', min: 0, max: 14, unit: '' },
      { field: '氨氮浓度', label: '氨氮浓度', min: 0, max: 50, unit: 'mg/L' },
      { field: 'COD值', label: 'COD值', min: 0, max: 500, unit: 'mg/L' },
      { field: '浊度', label: '浊度', min: 0, max: 4000, unit: 'NTU' },
    ],
    judge(values) {
      const ph = Number(values['PH值'])
      const overStandard =
        ph < 6.5 ||
        ph > 8.5 ||
        Number(values['氨氮浓度']) > 1.5 ||
        Number(values['COD值']) > 30 ||
        Number(values['浊度']) > 5
      return overStandard
        ? { conclusion: '超标', status: '已超标', abnormal: true }
        : { conclusion: '合格', status: '已出结果', abnormal: false }
    },
  },
}

function rulesFor(moduleKey: string): ModuleBatchRule {
  const rules = BATCH_RULES[moduleKey]
  if (!rules) {
    throw new Error(`模块 ${moduleKey} 没有配置批量录入规则`)
  }
  return rules
}

/** 页面渲染录入表单用：字段、有效范围、单位。 */
export function batchEntryRules(moduleKey: string): ModuleBatchRule {
  return rulesFor(moduleKey)
}

function nowText(): string {
  return new Date().toISOString()
}

function makeBatchId(): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `BATCH-${Date.now().toString(36)}-${random}`
}

/** 返回 null 表示校验通过；否则是这条样本的失败原因。 */
function validateValues(rules: ModuleBatchRule, values: Record<string, string>): string | null {
  for (const rule of rules.ranges) {
    const raw = (values[rule.field] ?? '').trim()
    if (raw === '') {
      return `${rule.label}未填写，本条未落库`
    }
    const num = Number(raw)
    if (!Number.isFinite(num)) {
      return `${rule.label}「${raw}」不是有效数字，本条未落库`
    }
    if (num < rule.min || num > rule.max) {
      const unit = rule.unit ? rule.unit : ''
      return `${rule.label}「${raw}」超出有效范围 ${rule.min}~${rule.max}${unit}，本条未落库`
    }
  }
  return null
}

function appendHistory(
  row: { history?: HistoryRecord[] },
  record: Omit<HistoryRecord, 'seq'>,
): HistoryRecord[] {
  const history = Array.isArray(row.history) ? row.history : []
  return [...history, { ...record, seq: history.length + 1 }]
}

type ItemOutcome = { status: BatchItemStatus; message: string }

/**
 * 单条样本的落库：在 updateRow 的读-改-写里做并发检查，
 * 别的批次/标签页已先录入的，本条跳过并保留首次结果。
 */
function applyItem(moduleKey: string, batch: BatchRecord, item: BatchItem): ItemOutcome {
  const rules = rulesFor(moduleKey)
  return updateRow(moduleKey, item.rowId, (row) => {
    if (!row) {
      return { result: { status: 'failed', message: '记录不存在或已被删除' } as ItemOutcome }
    }
    if (rules.finalStatuses.includes(String(row.status))) {
      // 并发保护：同一样本已有录入结果，只保留一个，本条不再覆盖
      return {
        result: { status: 'skipped', message: '该样本已有录入结果，保留首次结果' } as ItemOutcome,
      }
    }
    const base = {
      time: nowText(),
      operator: batch.operator,
      action: '批量录入结果',
      batchId: batch.id,
      values: { ...item.values },
    }
    if (String(row.status) !== rules.sourceStatus) {
      const message = `当前状态「${row.status}」不允许录入结果`
      const next = {
        ...row,
        pending: true,
        history: appendHistory(row, { ...base, result: 'failed' as const, message }),
      }
      return { next, result: { status: 'failed', message } as ItemOutcome }
    }
    const invalid = validateValues(rules, item.values)
    if (invalid !== null) {
      // 失败样本保留原状态，只标待处理并记下失败历史
      const next = {
        ...row,
        pending: true,
        history: appendHistory(row, { ...base, result: 'failed' as const, message: invalid }),
      }
      return { next, result: { status: 'failed', message: invalid } as ItemOutcome }
    }
    const verdict = rules.judge(item.values)
    const message = `录入成功，监测结论：${verdict.conclusion}`
    const next = {
      ...row,
      ...Object.fromEntries(rules.ranges.map((rule) => [rule.field, item.values[rule.field].trim()])),
      [rules.conclusionField]: verdict.conclusion,
      status: verdict.status,
      pending: false,
      abnormal: verdict.abnormal,
      history: appendHistory(row, { ...base, result: 'success' as const, message }),
    }
    return { next, result: { status: 'success', message } as ItemOutcome }
  })
}

/**
 * 创建批次。submitId 是幂等键：同一次提交重复调用（连点、重发）
 * 只返回已存在的批次，不会重复计数。
 */
export function createBatchEntry(
  moduleKey: string,
  inputs: BatchItemInput[],
  operator: string,
  submitId: string,
): BatchRecord {
  const rules = rulesFor(moduleKey)
  const existing = findBatchBySubmitId(moduleKey, submitId)
  if (existing) {
    return existing
  }
  const rows = listRows(moduleKey)
  const items: BatchItem[] = inputs.map((input) => {
    const row = rows.find((entry) => Number(entry.id) === input.rowId)
    return {
      rowId: input.rowId,
      sampleNo: String(row?.[rules.codeField] ?? `#${input.rowId}`),
      values: { ...input.values },
      status: 'pending',
      message: '',
      attempts: 0,
    }
  })
  const batch: BatchRecord = {
    id: makeBatchId(),
    submitId,
    module: moduleKey,
    operator,
    createdAt: nowText(),
    updatedAt: nowText(),
    done: false,
    items,
  }
  return saveBatchRecord(batch)
}

/** 重试前修正数值：只允许改还没成功的条目，改完回到待处理，等下一轮执行。 */
export function updateBatchEntryItems(
  moduleKey: string,
  batchId: string,
  inputs: BatchItemInput[],
): BatchRecord {
  const batch = getBatchRecord(batchId)
  if (!batch || batch.module !== moduleKey) {
    throw new Error(`没有找到批次 ${batchId}`)
  }
  const byRowId = new Map(inputs.map((input) => [input.rowId, input.values]))
  for (const item of batch.items) {
    if (item.status === 'success' || item.status === 'skipped') {
      continue
    }
    const values = byRowId.get(item.rowId)
    if (values) {
      item.values = { ...values }
      item.status = 'pending'
      item.message = ''
    }
  }
  batch.updatedAt = nowText()
  return saveBatchRecord(batch)
}

/**
 * 执行批次：逐条处理 pending/failed 的条目，每条独立 try，
 * 一条失败不会中断整批；每条落盘一次，中断后再次调用即可从断点继续。
 */
export function runBatchEntry(moduleKey: string, batchId: string): BatchRecord {
  const batch = getBatchRecord(batchId)
  if (!batch || batch.module !== moduleKey) {
    throw new Error(`没有找到批次 ${batchId}`)
  }
  for (const item of batch.items) {
    if (item.status === 'success' || item.status === 'skipped') {
      continue
    }
    // 别的标签页可能刚处理过同一条目，以最新批次状态为准
    const freshest = getBatchRecord(batchId)
    const freshItem = freshest?.items.find((entry) => entry.rowId === item.rowId)
    if (freshItem && (freshItem.status === 'success' || freshItem.status === 'skipped')) {
      item.status = freshItem.status
      item.message = freshItem.message
      item.attempts = freshItem.attempts
      continue
    }
    item.attempts += 1
    try {
      const outcome = applyItem(moduleKey, batch, item)
      item.status = outcome.status
      item.message = outcome.message
    } catch (error) {
      // 引擎级兜底：任何意外都只记到这一条上，整批继续
      item.status = 'failed'
      item.message = error instanceof Error ? error.message : '录入失败，原因未知'
    }
    batch.updatedAt = nowText()
    saveBatchRecord(batch)
  }
  batch.done = batch.items.every((item) => item.status === 'success' || item.status === 'skipped')
  batch.updatedAt = nowText()
  return saveBatchRecord(batch)
}

/** 待重试项集中展示：返回该模块所有批次，页面自行筛出失败/未完成的。 */
export function listBatchEntries(moduleKey: string): BatchRecord[] {
  return listBatchRecords(moduleKey)
}
