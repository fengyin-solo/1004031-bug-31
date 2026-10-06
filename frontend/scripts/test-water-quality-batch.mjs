// 核心逻辑验证：部分失败不阻断、失败保留原状态待处理、列表详情一致、计数唯一、历史不丢、并发去重、中断续跑。
import { installWindow, loadApi, memStorage } from './test-helper.mjs'

installWindow(memStorage())
const api = await loadApi()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name} ${detail}`)
  }
}

// 重置为种子数据，并把 id=1 安排取样（种子里 id=2 已取样、id=3 待取样）
api.resetModule('water_quality')
api.runAction('water_quality', 1, '安排取样')
let rows = api.listRows('water_quality')
check('前置：样本1/2均已取样',
  rows.find((r) => r.id === 1).status === '已取样' && rows.find((r) => r.id === 2).status === '已取样')

const valid = { PH值: '7.2', 氨氮浓度: '1.1', COD值: '20', 浊度: '3' }
const bad = { PH值: '99', 氨氮浓度: '1.1', COD值: '20', 浊度: '3' } // PH 超 0~14

console.log('用例1：一条超范围不阻断整批，失败项保留原状态并显示待处理')
const res1 = api.startBatch([
  { entryId: 1, values: valid },
  { entryId: 2, values: bad },
])
check('提交成功并返回批次', res1.ok && res1.job?.items.length === 2, res1.message)
await sleep(300)
rows = api.listRows('water_quality')
const r1 = rows.find((r) => r.id === 1)
const r2 = rows.find((r) => r.id === 2)
check('样本1正常落库为已出结果', r1.status === '已出结果', r1.status)
check('样本1不再待处理', r1.pending === false)
check('样本1写入监测结论与指标', r1['监测结论'] === '合格' && String(r1['PH值']) === '7.2')
check('样本2保留原状态已取样', r2.status === '已取样', r2.status)
check('样本2标记为待处理', r2.pending === true)
check('待重试项集中展示有1条', api.listPendingRetries().length === 1, `实际 ${api.listPendingRetries().length}`)
check('失败原因提示超出范围', api.listPendingRetries()[0].item.message.includes('超出允许范围'))

console.log('用例2：列表与详情读同一份数据')
const listed = api.listEntries('water_quality').items.find((r) => r.id === 1)
check('列表行与存储行状态/数值一致', listed.status === r1.status && listed['PH值'] === r1['PH值'] && listed.history === r1.history)

console.log('用例3：批量完成后工作台没有多出重复计数，一次提交算一次')
const overview = api.loadOverview()
const wq = overview.modules.find((m) => m.name === '水质监测')
check('登记总量仍为3（批量不新增行）', wq.created === 3, `实际 ${wq.created}`)
check('批次计数为1', api.batchCommitCount() === 1, `实际 ${api.batchCommitCount()}`)

console.log('用例4：详情历史记录不丢失（成功、失败都追加且只追加）')
check('样本1历史含批量成功', r1.history.some((h) => h.action === '批量录入结果' && h.result === 'success'))
check('样本1历史保留此前安排取样', r1.history.some((h) => h.action === '安排取样'))
check('样本2历史含失败记录', r2.history.some((h) => h.action === '批量录入结果' && h.result === 'failed'))

console.log('用例5：从失败条目继续，已成功条目不被重复处理')
const jobId = api.listPendingRetries()[0].jobId
api.updateRetryValue(jobId, 2, 'PH值', '7.0')
const retryRes = api.retryJob(jobId)
check('重试被接受', retryRes.ok, retryRes.message)
await sleep(300)
rows = api.listRows('water_quality')
check('样本2修正后续跑成功', rows.find((r) => r.id === 2).status === '已出结果')
check('待重试列表清空', api.listPendingRetries().length === 0)
check('批次计数仍为1（重试不另计）', api.batchCommitCount() === 1, `实际 ${api.batchCommitCount()}`)
check('样本1未被重复处理（仅1次成功历史）',
  rows.find((r) => r.id === 1).history.filter((h) => h.action === '批量录入结果' && h.result === 'success').length === 1)
check('样本2历史先失败后成功均保留（2条批量历史）',
  rows.find((r) => r.id === 2).history.filter((h) => h.action === '批量录入结果').length === 2)
check('运行中的批次拒绝再次重试', api.retryJob(jobId).ok === false)

console.log('用例6：并发录入同一样本只保留一个结果')
api.resetModule('water_quality')
api.runAction('water_quality', 3, '安排取样') // 种子 id=3 待取样 -> 已取样
const a = api.startBatch([{ entryId: 3, values: valid }])
const b = api.startBatch([{
  entryId: 3,
  values: { PH值: '8.8', 氨氮浓度: '9.9', COD值: '99', 浊度: '9' },
}])
check('两个并发批次均建立', a.ok && b.ok)
await sleep(400)
rows = api.listRows('water_quality')
const r3 = rows.find((r) => r.id === 3)
const itemStatuses = api.listJobs()
  .flatMap((j) => j.items)
  .filter((i) => i.entryId === 3)
  .map((i) => i.status)
check('同一样本只有一个成功', itemStatuses.filter((s) => s === 'success').length === 1, itemStatuses.join(','))
check('另一个被记为重复未覆盖', itemStatuses.includes('duplicate'), itemStatuses.join(','))
check('保留先提交批次的值（PH 7.2）', String(r3['PH值']) === '7.2', String(r3['PH值']))
check('并发两批次 + 用例1批次 = 批次计数3', api.batchCommitCount() === 3, `实际 ${api.batchCommitCount()}`)

console.log('用例7：中断后从失败条目继续')
api.resetModule('water_quality')
api.runAction('water_quality', 1, '安排取样')
api.runAction('water_quality', 2, '安排取样')
api.runAction('water_quality', 3, '安排取样')
const countBeforeInterrupt = api.batchCommitCount()
const job = api.startBatch([
  { entryId: 1, values: bad },
  { entryId: 2, values: bad },
  { entryId: 3, values: bad },
])
await sleep(70) // 至少处理完第1条（失败），在第2条前后发出中断
const aborted = api.abortJob(job.job.id)
check('运行中批次可请求中断', aborted.ok, aborted.message)
await sleep(300)
const interrupted = api.getJob(job.job.id)
check('批次状态为中断', interrupted.status === 'interrupted', interrupted.status)
rows = api.listRows('water_quality')
check('第1条失败保留原状态', rows.find((r) => r.id === 1).status === '已取样')
check('中断后存在待重试条目', api.listPendingRetries().length >= 1)
// 修正全部值（失败条目和未处理到的排队条目）后续跑
for (const id of [1, 2, 3]) {
  for (const field of Object.keys(valid)) {
    api.updateRetryValue(job.job.id, id, field, valid[field])
  }
}
api.retryJob(job.job.id)
await sleep(500)
rows = api.listRows('water_quality')
check('续跑后三条全部已出结果', [1, 2, 3].every((id) => rows.find((r) => r.id === id).status === '已出结果'),
  rows.map((r) => `${r.id}:${r.status}`).join(','))
check('续跑后无待重试', api.listPendingRetries().length === 0)
check('整个中断+续跑只产生一个批次（增量为1）',
  api.batchCommitCount() - countBeforeInterrupt === 1, `实际增量 ${api.batchCommitCount() - countBeforeInterrupt}`)

console.log('用例8：归档运行中批次被拒；已结束批次可归档')
const countBeforeArchive = api.batchCommitCount()
check('用例7批次已结束可归档', api.removeJob(job.job.id).ok)
check('归档后批次计数减1', api.batchCommitCount() === countBeforeArchive - 1)
api.resetModule('water_quality')
api.runAction('water_quality', 1, '安排取样')
const running = api.startBatch([{ entryId: 1, values: valid }])
check('批次成功建立', Boolean(running.job), running.message)
check('运行中批次不能归档', api.removeJob(running.job.id).ok === false)
await sleep(200)
check('已结束批次可归档', api.removeJob(running.job.id).ok)

console.log(`\n结果：${passed} 通过，${failed} 失败`)
process.exit(failed ? 1 : 0)
