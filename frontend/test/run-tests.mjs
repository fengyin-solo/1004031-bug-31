// 冒烟测试运行器：用 vite 自带的 esbuild 把 TS 测试打包成 ESM 后直接跑，不新增依赖。
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const outfile = resolve(here, '../node_modules/.cache/batch-entry.test.mjs')

buildSync({
  entryPoints: [resolve(here, './batch-entry.test.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile,
  alias: { '@': resolve(here, '../src') },
  logLevel: 'warning',
})

await import(outfile)
