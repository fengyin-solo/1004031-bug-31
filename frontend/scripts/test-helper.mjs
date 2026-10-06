// 核心逻辑验证：用 esbuild 把 TS 模块打成单文件，在 Node 里用 localStorage 桩跑真实代码。
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function memStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  }
}

export function installWindow(storage) {
  globalThis.window = { localStorage: storage }
  globalThis.localStorage = storage
}

export async function loadApi() {
  const dir = mkdtempSync(join(tmpdir(), 'wq-test-'))
  const entry = join(dir, 'entry.ts')
  writeFileSync(
    entry,
    `export * from '@/api/water-quality-batch'
     export { listEntries, loadOverview, runAction, resetModule } from '@/api/local-service'
     export { listRows } from '@/data/local-store'`,
  )
  const outfile = join(dir, 'bundle.mjs')
  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    alias: { '@': '/workspace/frontend/src' },
  })
  return import(pathToFileURL(outfile).href)
}
