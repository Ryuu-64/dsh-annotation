// 本地安装自检 + 接线指引。
//
// 本 fork 不发布到 npm 也能用：profile 用 `link:` 指向本仓库，源码改动即时生效
// （浏览器端是手写 CJS bundle，零构建步骤）。这个脚本做三件事：
//
//   1. 校验仓库自身可被 DSH 装载（包名/id/exports.name 三处一致 + 语法 + 测试）
//   2. 打印把本 fork 接进 profile 的确切步骤
//   3. 若已接入，直接跑一遍部署自检
//
// 实际接入用：node scripts/deploy-profile.mjs
// 接入后自检：node scripts/verify-deployment.mjs

import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
const clientPath = join(repoRoot, 'client.js')
const client = readFileSync(clientPath, 'utf8')

let failed = 0
const ok = (m) => console.log(`  ✔ ${m}`)
const bad = (m) => { failed++; console.log(`  ✖ ${m}`) }

console.log('[install-local] 校验仓库自身：')
if (pkg.name === '@ryuu-64/dsh-annotation') ok(`包名 ${pkg.name}`)
else bad(`包名异常：${pkg.name}`)

const id = /id:\s*'([^']+)'/.exec(client)?.[1]
if (id === pkg.name) ok(`ModuleLoader id 与包名一致（${id}）`)
else bad(`ModuleLoader id=${id} 与包名 ${pkg.name} 不一致 → 浏览器端会被 client-modules 拒绝注册`)

if (client.includes(`exports.name = '${pkg.name}'`)) ok('exports.name 与包名一致')
else bad('exports.name 与包名不一致')

try {
  execFileSync(process.execPath, ['--check', clientPath], { stdio: 'pipe' })
  ok('client.js 语法可解析')
} catch (err) {
  bad(`client.js 语法错误：${String(err.stderr ?? err.message).slice(0, 160)}`)
}

if (existsSync(join(repoRoot, 'cordis.patch.yml'))) ok('cordis.patch.yml 存在（bundle patch）')
else bad('缺少 cordis.patch.yml')

console.log('')
if (failed > 0) {
  console.log(`[install-local] ${failed} 项未通过，先修好再接 profile。`)
  process.exit(1)
}

console.log('[install-local] 仓库自检通过。接入 profile：')
console.log('')
console.log('    node scripts/deploy-profile.mjs            # 接进 desktop profile（幂等）')
console.log('    node scripts/verify-deployment.mjs         # 核对接线')
console.log('    node scripts/deploy-profile.mjs --remove   # 退回上游包')
console.log('')
console.log('[install-local] 也可以手工改 profile 的 package.json：')
console.log('')
console.log(`    "dependencies": { "${pkg.name}": "link:${repoRoot.replace(/\\/g, '/')}" }`)
console.log(`    "dsh": { "profile": { "bundles": [ ..., "${pkg.name}" ] } }`)
console.log('')
console.log('  然后在该 profile 目录跑 pnpm install。注意 bundles 里要移除上游包名')
console.log('  @changfenhuang/dsh-annotation，避免同一个 UI 被装载两次。')

if (existsSync(join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh', 'profiles', 'desktop', 'package.json'))) {
  console.log('')
  console.log('[install-local] 检测到 desktop profile，顺带跑一遍接线自检：')
  try {
    execFileSync(process.execPath, [join(repoRoot, 'scripts', 'verify-deployment.mjs')], { stdio: 'inherit' })
  } catch {
    console.log('[install-local] 接线尚未完成（见上方未通过项）。')
  }
}
