/**
 * 批量录入引擎冒烟测试（node 环境，无 localStorage，走内存替身）。
 * 跑法：npm test
 * 覆盖：逐条容错、失败保留原状态、幂等不重复计数、并发只留一个结果、
 *       历史不丢、中断后从失败条目继续、列表与详情一致。
 */
import assert from 'node:assert/strict'

import {
  createBatchEntry,
  getEntryDetail,
  listBatchEntries,
  listEntries,
  loadOverview,
  runAction,
  runBatchEntry,
  updateBatchEntryItems,
} from '@/api/local-service'

const KEY = 'water_quality'
const OK = { PH值: '7.2', 氨氮浓度: '0.4', COD值: '12', 浊度: '1.5' }
const OK_2 = { PH值: '7.0', 氨氮浓度: '0.3', COD值: '10', 浊度: '1.0' }
const OUT_OF_RANGE = { PH值: '15.2', 氨氮浓度: '0.4', COD值: '12', 浊度: '1.5' }
const OVER_STANDARD = { PH值: '9.2', 氨氮浓度: '0.4', COD值: '12', 浊度: '1.5' }

function overviewOf(moduleName: string) {
  const found = loadOverview().modules.find((item) => item.name === moduleName)
  assert.ok(found, '运营概览里应该能找到水质监测模块')
  return found
}

function batchOf(id: string) {
  const found = listBatchEntries(KEY).find((batch) => batch.id === id)
  assert.ok(found, `批次 ${id} 应该存在`)
  return found
}

function itemOf(batchId: string, rowId: number) {
  const found = batchOf(batchId).items.find((item) => item.rowId === rowId)
  assert.ok(found, `批次 ${batchId} 里应该有样本 ${rowId}`)
  return found
}

// ---- 1. 逐条容错：一条超范围不中断整批，失败保留原状态并标待处理 ----
const before = overviewOf('水质监测')

const batch = createBatchEntry(
  KEY,
  [
    { rowId: 2, values: OK },
    { rowId: 4, values: OUT_OF_RANGE },
    { rowId: 5, values: OVER_STANDARD },
    { rowId: 1, values: OK },
  ],
  '测试员甲',
  'submit-1',
)
const finished = runBatchEntry(KEY, batch.id)

assert.equal(itemOf(batch.id, 2).status, 'success')
assert.equal(itemOf(batch.id, 4).status, 'failed', '超范围的样本应判失败')
assert.equal(itemOf(batch.id, 5).status, 'success', '超标但在有效范围内应正常落库')
assert.equal(itemOf(batch.id, 1).status, 'failed', '未取样的样本不能录入')
assert.match(itemOf(batch.id, 4).message, /超出有效范围/)
assert.equal(finished.done, false, '还有失败条目，批次不算完成')

const row2 = getEntryDetail(KEY, 2)
assert.equal(row2?.status, '已出结果')
assert.equal(row2?.['监测结论'], '合格')
assert.equal(row2?.pending, false)
assert.equal(row2?.history?.length, 1)
assert.equal(row2?.history?.[0].result, 'success')

const row4 = getEntryDetail(KEY, 4)
assert.equal(row4?.status, '已取样', '失败样本保留原状态')
assert.equal(row4?.pending, true, '失败样本显示成待处理')
assert.equal(row4?.history?.length, 1)
assert.equal(row4?.history?.[0].result, 'failed')

const row5 = getEntryDetail(KEY, 5)
assert.equal(row5?.status, '已超标')
assert.equal(row5?.abnormal, true)

const row1 = getEntryDetail(KEY, 1)
assert.equal(row1?.status, '待取样', '状态不允许的样本保持原状态')
assert.equal(row1?.pending, true)

const afterFirst = overviewOf('水质监测')
assert.equal(afterFirst.created, before.created, '批量录入不能新增记录行')
assert.equal(afterFirst.pending, before.pending - 2, '只有落库成功的两条退出待处理')
console.log('✓ 1. 逐条容错：超范围只失败一条，整批继续，失败样本保留原状态并待处理')

// ---- 2. 幂等：同一次提交重复执行不重复计数 ----
const idem = createBatchEntry(KEY, [{ rowId: 6, values: OK }], '测试员甲', 'submit-idem')
const idemAgain = createBatchEntry(KEY, [{ rowId: 6, values: OK }], '测试员甲', 'submit-idem')
assert.equal(idemAgain.id, idem.id, '相同 submitId 必须复用同一个批次')
runBatchEntry(KEY, idem.id)
const afterIdem = overviewOf('水质监测')
runBatchEntry(KEY, idem.id)
runBatchEntry(KEY, idem.id)
const afterRerun = overviewOf('水质监测')
assert.deepEqual(afterRerun, afterIdem, '重复执行批次，运营概览计数不能变')
assert.equal(getEntryDetail(KEY, 6)?.history?.length, 1, '成功条目不能重复写历史')
assert.equal(itemOf(idem.id, 6).attempts, 1, '成功条目不能重复执行')
console.log('✓ 2. 幂等：一次提交只算一次，重复提交/重跑不多计数')

// ---- 3. 并发：同一样本只保留一个结果 ----
const concurrent = createBatchEntry(
  KEY,
  [{ rowId: 2, values: { PH值: '8.8', 氨氮浓度: '9.9', COD值: '99', 浊度: '9' } }],
  '测试员乙',
  'submit-2',
)
runBatchEntry(KEY, concurrent.id)
assert.equal(itemOf(concurrent.id, 2).status, 'skipped', '并发录入同一样本应跳过后来者')
const row2After = getEntryDetail(KEY, 2)
assert.equal(row2After?.['PH值'], '7.2', '保留首次录入的结果')
assert.equal(row2After?.history?.length, 1, '并发冲突不能追加历史')
console.log('✓ 3. 并发：同一样本只保留一个结果，历史不丢')

// ---- 4. 中断后继续：修正失败条目，从断点接着跑 ----
runAction(KEY, 1, '安排取样')
updateBatchEntryItems(KEY, batch.id, [{ rowId: 4, values: OK_2 }])
assert.equal(itemOf(batch.id, 4).status, 'pending', '修正数值后条目回到待处理')
assert.equal(itemOf(batch.id, 2).status, 'success', '更新不能动已成功的条目')

const resumed = runBatchEntry(KEY, batch.id)
assert.equal(resumed.done, true, '失败条目补齐后批次完成')
assert.equal(itemOf(batch.id, 4).status, 'success')
assert.equal(itemOf(batch.id, 1).status, 'success')
const row4After = getEntryDetail(KEY, 4)
assert.equal(row4After?.status, '已出结果')
assert.equal(row4After?.history?.length, 2, '失败+成功两条历史都要在')
assert.equal(row4After?.history?.[0].result, 'failed')
assert.equal(row4After?.history?.[1].result, 'success')
assert.equal(
  listBatchEntries(KEY).filter((item) =>
    item.items.some((entry) => entry.status === 'failed' || entry.status === 'pending'),
  ).length,
  0,
  '全部完成后不应再有待重试项',
)
console.log('✓ 4. 断点续传：从失败条目继续，历史完整保留')

// ---- 5. 列表与详情同源：批量录入后两边一致 ----
const listed = listEntries(KEY).items.find((row) => Number(row.id) === 4)
const detail = getEntryDetail(KEY, 4)
assert.equal(listed?.status, detail?.status, '列表和详情的状态必须一致')
assert.equal(listed?.['监测结论'], detail?.['监测结论'], '列表和详情的结论必须一致')

const finalOverview = overviewOf('水质监测')
assert.equal(finalOverview.created, before.created, '全流程结束后总量不能多一行')
console.log('✓ 5. 列表与详情一致，运营概览无重复计数')

// ---- 6. 未配置批量规则的模块直接拒绝 ----
assert.throws(() => createBatchEntry('pipeline', [], '测试员', 'submit-x'), /没有配置批量录入规则/)
console.log('✓ 6. 未配置规则的模块拒绝批量录入')

console.log('\n全部冒烟测试通过')
