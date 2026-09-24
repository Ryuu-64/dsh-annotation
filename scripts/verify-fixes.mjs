#!/usr/bin/env node
// 一条命令验证本 fork 的四个悬浮面板修复都真实生效。
//
//   npm run verify          # 全量（语法 + 单测 + e2e + 反向验证 + 漂移审计 + 部署接线）
//   npm run verify:fixes    # 只想快速看结论时跑这个
//
// 它做两件事：
//   1. 对本仓库的 client.js 跑行为测试（应当全绿）
//   2. 把同一套测试指向「上游原版」的 client.js 再跑一遍（应当大量失败）
//
// 第 2 步是关键：只在本仓库跑通不算证据，必须证明同一套测试能抓到上游的缺陷，
// 否则测试可能什么都没测。

import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const UPSTREAM_VERSION = '1.4.10'

function run(args, opts = {}) {
  try {
    return { ok: true, out: execFileSync(process.execPath, args, { cwd: repoRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts }) }
  } catch (err) {
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

function summarize(out) {
  const grab = (re) => { const m = re.exec(out); return m === null ? '?' : m[1] }
  return {
    tests: grab(/^# tests (\d+)/m),
    pass: grab(/^# pass (\d+)/m),
    fail: grab(/^# fail (\d+)/m),
  }
}

console.log('=== 1) 本仓库 client.js 的行为测试 ===')
const mine = run(['--test', '--test-reporter=tap', 'test/hover-tip.test.mjs', 'test/hover-tip.dom.test.mjs'])
const m = summarize(mine.out)
console.log(`    tests ${m.tests} | pass ${m.pass} | fail ${m.fail}   ${mine.ok ? '✔ 全绿' : '✖ 有失败'}`)

console.log('')
console.log('=== 2) 同一套测试跑上游原版 client.js（证明能抓到缺陷）===')
const upstreamDir = join(repoRoot, '.baseline', UPSTREAM_VERSION, 'package')
const upstreamClient = join(upstreamDir, 'client.js')
if (!existsSync(upstreamClient)) {
  console.log(`    需要上游基线，正在下载 ${UPSTREAM_VERSION} …`)
  mkdirSync(upstreamDir, { recursive: true })
  const tgz = join(upstreamDir, 'pkg.tgz')
  const res = await fetch(`https://registry.npmjs.org/@changfenhuang/dsh-annotation/-/dsh-annotation-${UPSTREAM_VERSION}.tgz`)
  if (!res.ok) { console.log(`    ✖ 下载失败 HTTP ${res.status}`); process.exit(1) }
  writeFileSync(tgz, Buffer.from(await res.arrayBuffer()))
  execFileSync('tar', ['-xzf', tgz, '-C', upstreamDir], { stdio: 'inherit' })
  rmSync(tgz, { force: true })
}

const staging = join(repoRoot, '.upstream-staging')
rmSync(staging, { recursive: true, force: true })
mkdirSync(join(staging, 'test'), { recursive: true })
// 把上游代码的包名归一到本 fork 的包名，只让「行为差异」决定成败
const normalized = readFileSync(upstreamClient, 'utf8').replace(/@changfenhuang\/dsh-annotation/g, '@ryuu-64/dsh-annotation')
writeFileSync(join(staging, 'client.js'), normalized, 'utf8')
writeFileSync(join(staging, 'package.json'), readFileSync(join(repoRoot, 'package.json')))
for (const f of ['hover-tip.test.mjs', 'hover-tip.dom.test.mjs']) {
  writeFileSync(join(staging, 'test', f), readFileSync(join(repoRoot, 'test', f)))
}
let up
try {
  up = { ok: true, out: execFileSync(process.execPath, ['--test', '--test-reporter=tap', 'test/hover-tip.test.mjs', 'test/hover-tip.dom.test.mjs'], { cwd: staging, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }) }
} catch (err) {
  up = { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
}
rmSync(staging, { recursive: true, force: true })
const u = summarize(up.out)
console.log(`    tests ${u.tests} | pass ${u.pass} | fail ${u.fail}   ${up.ok ? '⚠ 竟然全绿 —— 测试抓不到缺陷' : '✔ 有失败，说明测试有效'}`)

console.log('')
const good = mine.ok && !up.ok
if (good) {
  console.log('结论：本仓库的四个修复生效，且测试确实能抓到上游的缺陷。')
  console.log('')
  console.log('四个修复对应关系：')
  console.log('  [A] 归属模型 tipOwner/clearTip/presentTip  → 上游 PR #65 同思路')
  console.log('  [B] 跨间隙改用实时指针位置判定            → 上游 PR #66')
  console.log('  [C] 宽限定时器按归属收敛                  → 上游 PR #65 同思路')
  console.log('  [D] 共享容器监听器收敛                    → 上游 PR #67')
} else {
  console.log('结论：结论不成立，需要排查（本仓库未全绿，或上游代码竟然也全绿）。')
  process.exit(1)
}
