// 把测试指向另一份 client.js 跑一遍：EXTRACT_FROM=<path> node --test test/hover-tip.test.mjs
//
// 用途：拿上游 1.4.10 的 client.js 跑同一套用例，验证这些测试确实能抓到 bug
// （否则它们只是自我安慰）。默认指向上游 tarball 解出的副本。
//
//   node scripts/check-against-upstream.mjs
//
// 预期结果：以 [A]/[C]/[D] 开头的用例在旧代码上失败，[B] 的部分失败。

import { mkdirSync, rmSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
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

// 暂存目录必须放在仓库内：dom 用例要 import jsdom，而 jsdom 装在仓库的
// node_modules 里。放进系统临时目录会让 Node 解析不到 jsdom，dom 用例会以
// ERR_MODULE_NOT_FOUND 直接崩掉——那是环境错误，不是行为差异，会污染结论。
const staging = join(repoRoot, '.upstream-staging')
rmSync(staging, { recursive: true, force: true })
mkdirSync(join(staging, 'test'), { recursive: true })
writeFileSync(join(staging, 'client.js'), normalized, 'utf8')
copyFileSync(join(repoRoot, 'package.json'), join(staging, 'package.json'))
const testFiles = ['hover-tip.test.mjs', 'hover-tip.dom.test.mjs']
for (const f of testFiles) copyFileSync(join(repoRoot, 'test', f), join(staging, 'test', f))

console.log(`[check-upstream] 用上游 client.js 跑同一套用例：${upstream}`)
console.log(`[check-upstream] （归一化包名后暂存于 ${staging}）\n`)

let out = ''
let code = 0
try {
  out = execFileSync(process.execPath, ['--test', ...testFiles.map((f) => `test/${f}`)],
    { cwd: staging, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
} catch (err) {
  out = `${err.stdout ?? ''}${err.stderr ?? ''}`
  code = err.status ?? 1
}

for (const line of out.split(/\r?\n/)) {
  if (/^(✔|✖|ℹ (tests|pass|fail))/.test(line.trim())) console.log(line.trim())
}

// 区分「行为失败」与「环境失败」：后者不算证据，必须显式指出
const envFailure = /ERR_MODULE_NOT_FOUND|Cannot find (package|module)/.test(out)
rmSync(staging, { recursive: true, force: true })

console.log('')
if (envFailure) {
  console.log('[check-upstream] ⚠ 出现模块解析错误（环境问题），本次结果不能作为行为证据，请先修好依赖解析。')
  process.exit(2)
}
if (code === 0) {
  console.log('[check-upstream] ⚠ 全套用例在上游代码上也通过了 —— 说明这些用例抓不到这个 bug，测试没有价值，需要重写。')
  process.exit(1)
}
console.log('[check-upstream] ✔ 上游代码上存在失败用例，说明测试确实能抓到该 bug。')
