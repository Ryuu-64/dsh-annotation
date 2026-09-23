// 漂移审计：确认本 fork 相对上游 1.4.10 只差「预期的那些改动」，没有意外改动。
//
// 用法：
//   node scripts/audit-drift.mjs                     # 自动取上游 1.4.10 tarball 做基线
//   node scripts/audit-drift.mjs <上游 client.js>     # 指定基线文件
//
// 背景（这次真的踩到了）：第一轮我把 1.4.11-preview.1 的 tarball 解到
// _diag_annotation，后来一直拿它当"上游基线"做对比 —— 结果 diff 里冒出 200 多行
// 我从未写过的改动（preview 独有的侧边栏文档批注功能）。基线错了，结论就会错。
// 所以这个脚本默认自己下载 1.4.10，并把版本号打进报告。
//
// 判定规则：
//   1. 逐行归因：每个新增/删除行必须能落到已知修复的语义范围（或注释/结构行）
//   2. 结构性删除白名单：删除的代码块必须是「被替换掉的旧实现」，逐块列出
//   3. 任何未归因行 → 失败，需人工确认

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const UPSTREAM_VERSION = '1.4.10'
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const forkPath = join(repoRoot, 'client.js')

async function ensureBaseline() {
  if (process.argv[2] !== undefined) return resolve(process.argv[2])
  const dir = join(repoRoot, '.baseline', UPSTREAM_VERSION)
  const file = join(dir, 'client.js')
  if (existsSync(file)) return file
  mkdirSync(dir, { recursive: true })
  const url = `https://registry.npmjs.org/@changfenhuang/dsh-annotation/-/dsh-annotation-${UPSTREAM_VERSION}.tgz`
  const tgz = join(dir, 'pkg.tgz')
  console.log(`[audit] 下载上游基线 ${UPSTREAM_VERSION} …`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`下载上游 tarball 失败：HTTP ${res.status}`)
  writeFileSync(tgz, Buffer.from(await res.arrayBuffer()))
  execFileSync('tar', ['-xzf', tgz, '-C', dir], { stdio: 'inherit' })
  rmSync(tgz, { force: true })
  const extracted = join(dir, 'package', 'client.js')
  if (!existsSync(extracted)) throw new Error(`tarball 里没有 package/client.js`)
  return extracted
}

const baseline = await ensureBaseline()
const baseLabel = process.argv[2] !== undefined ? baseline : `上游 ${UPSTREAM_VERSION}（tarball）`
console.log(`[audit] 基线：${baseLabel}`)
console.log(`[audit] 基线行数 ${readFileSync(baseline, 'utf8').split('\n').length}，fork 行数 ${readFileSync(forkPath, 'utf8').split('\n').length}\n`)

let diff = ''
try {
  diff = execFileSync('git', ['diff', '--no-index', '--ignore-cr-at-eol', '-U1', baseline, forkPath],
    { encoding: 'utf8' })
} catch (err) {
  diff = err.stdout ?? ''    // git diff 有差异时退出码为 1，输出仍在 stdout
}

const lines = diff.split(/\r?\n/)
const added = lines.filter((l) => l.startsWith('+') && !l.startsWith('+++'))
const removed = lines.filter((l) => l.startsWith('-') && !l.startsWith('---'))
console.log(`[audit] 新增 ${added.length} 行，删除 ${removed.length} 行`)

// 归因关键词：这些语义范围内的改动都是预期的
const ATTRIBUTABLE = new RegExp([
  // [A] 归属模型
  'tipOwner', 'clearTip', 'presentTip',
  // [B] 实时指针位置判定
  'pointerWithinTip', 'onTipPointerMove', 'livePointerX', 'livePointerY',
  'TIP_GAP_TOLERANCE', 'boxes', 'getBoundingClientRect', 'nodeType',
  // [C] 宽限定时器按归属收敛
  'ownedHide', 'scheduleHide', 'cancelHide', 'hoverGrace',
  'bubbleGrace', 'bubbleHide', 'bubbleKeep', 'grace', 'hide()', 'keep()', 'clearTimeout',
  // [D] 监听器不再挂到共享容器
  'tipLayer', 'addEventListener', 'removeEventListener',
  // 改名与归属声明
  '@ryuu-64', 'changfenhuang', 'fork', '\\[A\\]', '\\[B\\]', '\\[C\\]', '\\[D\\]',
  // 中文注释
  '悬停', '归属', '间隙', '指针', '监听器', '宽限', '宿主', '面板', '定时器', '渲染',
].join('|'))

// 结构性行：花括号、循环体、注释续行等，本身不承载语义
const STRUCTURAL = /^[{}()\[\];]*$|^\s*(var |if |for |return |function |}\s*$|\)|\}|\/\/)/

function classify(list) {
  const unattributed = []
  for (const l of list) {
    const body = l.slice(1).trim()
    if (body === '') continue
    if (ATTRIBUTABLE.test(body)) continue
    if (STRUCTURAL.test(body)) continue
    unattributed.push(body)
  }
  return unattributed
}

const badAdded = classify(added)
const badRemoved = classify(removed)

console.log(`[audit] 新增行未归因：${badAdded.length}`)
if (badAdded.length > 0) for (const b of badAdded) console.log(`   + ${b}`)
console.log(`[audit] 删除行未归因：${badRemoved.length}`)
if (badRemoved.length > 0) for (const b of badRemoved) console.log(`   - ${b}`)

// 结构性删除的块级清单：便于人眼确认「删掉的都是被替换的旧实现」
const hunks = diff.split(/^@@/m).slice(1)
const delHeavy = hunks.filter((h) => (h.split(/\r?\n/).filter((l) => l.startsWith('-') && !l.startsWith('---'))).length >= 4)
console.log(`\n[audit] 删除行 ≥4 的块：${delHeavy.length} 个（应全部是被替换的旧实现）`)
for (const h of delHeavy) {
  const body = h.split(/\r?\n/).filter((l) => l.startsWith('-') && !l.startsWith('---'))
  console.log(`   · 删除 ${body.length} 行，首行：${body[0].slice(1).trim().slice(0, 78)}`)
}

console.log('')
if (badAdded.length === 0 && badRemoved.length === 0) {
  console.log('[audit] ✔ 所有改动均可归因到预期修复，未发现意外漂移。')
} else {
  console.log('[audit] ✖ 存在无法归因的改动，请人工确认后再继续。')
  process.exit(1)
}
