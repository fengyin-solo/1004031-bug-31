// 验证刷新恢复：localStorage 里残留 running 批次时，重新加载后应标为中断，
// processing 条目回到 failed，随后可从失败条目继续。
import { installWindow, loadApi, memStorage } from './test-helper.mjs'

const storage = memStorage()
installWindow(storage)

let api = await loadApi()
api.resetModule('water_quality')
api.runAction('water_quality', 1, '安排取样')
api.runAction('water_quality', 2, '安排取样')

// 模拟浏览器刷新前一个批次跑到一半的状态
const valid = { PH值: '7.2', 氨氮浓度: '1.1', COD值: '20', 浊度: '3' }
const frozen = {
  id: 'BAT-frozen',
  createdAt: new Date().toISOString(),
  status: 'running',
  items: [
    { entryId: 1, code: 'WATE-0001', point: 'p', values: valid, status: 'success', message: '录入成功', attempts: 1 },
    { entryId: 2, code: 'WATE-0002', point: 'p', values: valid, status: 'processing', message: '', attempts: 1 },
  ],
}
storage.setItem('underground-pipeline-inspection:water-quality-batches', JSON.stringify([frozen]))

// 全新进程加载（重新构建一次得到全新模块缓存）
api = await loadApi()
const job = api.getJob('BAT-frozen')
let failed = 0
function check(name, cond) {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name}`)
  }
}

console.log('用例：刷新后中断恢复')
check('残留 running 批次恢复为 interrupted', job?.status === 'interrupted', job?.status)
const processing = job.items.find((i) => i.entryId === 2)
check('processing 条目回到 failed', processing.status === 'failed' && processing.message.includes('中断'))
check('待重试列表能看到该条目', api.listPendingRetries().some((p) => p.item.entryId === 2))
check('成功条目仍是成功', job.items.find((i) => i.entryId === 1).status === 'success')
check('中断批次不会自动执行（无运行中批次）', api.listJobs().every((j) => j.status !== 'running'))

// 续跑后成功
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
api.retryJob('BAT-frozen')
await sleep(300)
const rows = api.listRows('water_quality')
check('续跑后样本2已出结果', rows.find((r) => r.id === 2).status === '已出结果')
check('批次完成且只有一个批次', api.batchCommitCount() === 1)
check('无待重试', api.listPendingRetries().length === 0)

process.exit(failed ? 1 : 0)
