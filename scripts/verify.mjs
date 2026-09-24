// 一条命令跑完所有能自动验证的检查，并明确列出「还差什么」。
//
//   npm run verify
//
// 覆盖：
//   0. 语法：client.js / lib/index.js
//   1. 行为：单测（抽函数）+ e2e（jsdom 装载真实 bundle）+ 上游基线反向验证
//   2. 漂移：与上游 1.4.10 的差异是否全部可归因
//   3. 部署：profile 接线 13 项
//
// 明确不做的事：真实页面确认。GUI 只对 Electron 渲染进程开放（普通浏览器请求一律
// 403），自动化拿不到浏览器会话，所以那一步必须人工完成 —— 见 docs/verify-hover-fix.md。

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function run(label, file, args = []) {
  process.stdout.write(`\n=== ${label} ===\n`)
  try {
    const out = execFileSync(process.execPath, [file, ...args], { cwd: repoRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    process.stdout.write(out)
    return true
  } catch (err) {
    process.stdout.write(`${err.stdout ?? ''}${err.stderr ?? ''}`)
    return false
  }
}

function runNode(label, args) {
  process.stdout.write(`\n=== ${label} ===\n`)
  try {
    process.stdout.write(execFileSync(process.execPath, args, { cwd: repoRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }))
    return true
  } catch (err) {
    process.stdout.write(`${err.stdout ?? ''}${err.stderr ?? ''}`)
    return false
  }
}

const results = []
results.push(['语法 client.js', runNode('node --check client.js', ['--check', join(repoRoot, 'client.js')])])
results.push(['语法 lib/index.js', runNode('node --check lib/index.js', ['--check', join(repoRoot, 'lib', 'index.js')])])
// 交给 node --test 自动发现，不写死文件列表：手写列表在新增测试文件时会静默漏跑
// （这个坑真踩过 —— test/session-id-fallback.test.mjs 加进来后，写死的两文件列表
//  仍然只跑 20 个用例，而自动发现是 29 个）。
results.push(['行为：node --test 自动发现全部测试', runNode('node --test', ['--test'])])
results.push(['反向验证：同一套用例跑上游 1.4.10', runNode('check-against-upstream', ['scripts/check-against-upstream.mjs'])])
results.push(['漂移审计：与上游 1.4.10 的差异是否全部可归因', runNode('audit-drift', ['scripts/audit-drift.mjs'])])
results.push(['部署接线自检', runNode('verify-deployment', ['scripts/verify-deployment.mjs'])])

console.log('\n================ 汇总 ================')
for (const [label, ok] of results) console.log(`${ok ? '✔' : '✖'}  ${label}`)

const failed = results.filter(([, ok]) => !ok)
console.log('')
if (failed.length === 0) {
  console.log('自动可验证项全部通过。')
  console.log('')
  console.log('仍需人工完成（自动化拿不到浏览器会话）：')
  console.log('  1) 完全重启 DSH Desktop（bundles 名单只在宿主启动时解析一次）')
  console.log('  2) 页面控制台确认登记：')
  console.log("     window.__DSH_BOOT__.entries.find(({ id }) => id === '@ryuu-64/dsh-annotation')")
  console.log('  3) hover 一条已有批注，面板应稳定不消失')
  console.log('  详见 docs/verify-hover-fix.md')
} else {
  console.log(`${failed.length} 项失败：${failed.map(([l]) => l).join('、')}`)
  process.exit(1)
}
