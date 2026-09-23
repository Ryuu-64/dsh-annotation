// 把测试指向另一份 client.js 跑一遍：EXTRACT_FROM=<path> node --test test/hover-tip.test.mjs
//
// 用途：拿上游 1.4.10 的 client.js 跑同一套用例，验证这些测试确实能抓到 bug
// （否则它们只是自我安慰）。默认指向上游 tarball 解出的副本。
//
//   node scripts/check-against-upstream.mjs
//
// 预期结果：以 [A]/[C]/[D] 开头的用例在旧代码上失败，[B] 的部分失败。

import { mkdtempSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const upstream =
  process.argv[2] ?? 'C:\\Users\\Ryuu\\.dsh\\profiles\\desktop\\node_modules\\@changfenhuang\\dsh-annotation\\client.js'

let source
try {
  source = readFileSync(upstream, 'utf8')
} catch {
  console.error(`[check-upstream] 读不到上游 client.js：${upstream}`)
  console.error('[check-upstream] 用法：node scripts/check-against-upstream.mjs <上游 client.js 路径>')
  console.error('[check-upstream] 获取方式：npm pack @changfenhuang/dsh-annotation@1.4.10 && tar -xzf …')
  process.exit(2)
}

// 上游包名与 fork 不同，把 id/name 归一到 fork 的包名，只让行为差异决定成败
const normalized = source
  .replace(/@changfenhuang\/dsh-annotation/g, '@ryuu-64/dsh-annotation')

const staging = mkdtempSync(join(tmpdir(), 'ann-upstream-'))
writeFileSync(join(staging, 'client.js'), normalized, 'utf8')
copyFileSync(join(repoRoot, 'package.json'), join(staging, 'package.json'))
const testDir = join(staging, 'test')
execFileSync(process.execPath, ['-e', `require('node:fs').mkdirSync(${JSON.stringify(testDir)},{recursive:true})`])
copyFileSync(join(repoRoot, 'test', 'hover-tip.test.mjs'), join(testDir, 'hover-tip.test.mjs'))

console.log(`[check-upstream] 用上游 client.js 跑同一套用例：${upstream}`)
console.log(`[check-upstream] （归一化包名后暂存于 ${staging}）\n`)

let out = ''
let code = 0
try {
  out = execFileSync(process.execPath, ['--test', 'test/hover-tip.test.mjs'],
    { cwd: staging, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
} catch (err) {
  out = `${err.stdout ?? ''}${err.stderr ?? ''}`
  code = err.status ?? 1
}

for (const line of out.split(/\r?\n/)) {
  if (/^(✔|✖|ℹ (tests|pass|fail))/.test(line.trim())) console.log(line.trim())
}

console.log('')
if (code === 0) {
  console.log('[check-upstream] ⚠ 全套用例在上游代码上也通过了 —— 说明这些用例抓不到这个 bug，测试没有价值，需要重写。')
  process.exit(1)
}
console.log('[check-upstream] ✔ 上游代码上存在失败用例，说明测试确实能抓到该 bug。')
