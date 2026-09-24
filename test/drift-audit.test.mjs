// 漂移审计：本 fork 相对上游 1.4.10 的**每一处**改动，都必须能归因到已知的修复。
//
// 为什么是测试而不是脚本：它每次都要得到同一个结论（「没有意外的改动」），
// 判定逻辑本身就是断言。写成脚本时结论只体现在打印文字里，谁跑都不知道到底过没过。
//
// 判定方式：
//   1. 逐行归因 —— 每个新增/删除行必须落到已知修复的语义范围，或属于结构性代码行
//   2. 结构性删除块清单 —— 便于人眼确认「删掉的都是被替换掉的旧实现」
//   3. 任何未归因行 → 断言失败，需要人工确认

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const UPSTREAM_VERSION = '1.4.10'
// tarball 内部已有 `package/` 前缀，所以解压目标是版本目录本身。
const versionDir = join(repoRoot, '.baseline', UPSTREAM_VERSION)
const baselineClient = join(versionDir, 'package', 'client.js')
const forkClient = join(repoRoot, 'client.js')

// 归因词表：出现在这些语义范围内的改动都算预期
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
  // [E] 当前会话 id 降级读取 + 发送失败不再静默（issue #10）
  'currentSessionId', 'SESSION_ID_STORAGE_KEY', 'sessionId', 'sessionLostAnnounced',
  'announceSessionLost', 'localStorage', 'showToast', 'toast.attachFail',
  // 改名与归属声明
  '@ryuu-64', 'changfenhuang', 'fork', '\\[A\\]', '\\[B\\]', '\\[C\\]', '\\[D\\]', '\\[E\\]',
  // 中文注释（覆盖各条修复里用到的措辞）
  '悬停', '归属', '间隙', '指针', '监听器', '宽限', '宿主', '面板', '定时器', '渲染',
  '会话', '来源', '告知', '静默', '无法识别', '绝不', '升级', '反馈', 'writePendingQuotes',
].join('|'))

// 结构性行：花括号、控制流、注释续行等，本身不承载语义
const STRUCTURAL = /^[{}()\[\];]*$|^\s*(var |if |for |return |try |catch |function |}\s*$|\)|\}|\/\/)/

async function ensureBaseline() {
  if (existsSync(baselineClient)) return true
  try {
    mkdirSync(versionDir, { recursive: true })
    const url = `https://registry.npmjs.org/@changfenhuang/dsh-annotation/-/dsh-annotation-${UPSTREAM_VERSION}.tgz`
    const res = await fetch(url)
    if (!res.ok) return false
    const tgz = join(versionDir, 'pkg.tgz')
    writeFileSync(tgz, Buffer.from(await res.arrayBuffer()))
    execFileSync('tar', ['-xzf', tgz, '-C', versionDir], { stdio: 'ignore' })
    rmSync(tgz, { force: true })
    return existsSync(baselineClient)
  } catch {
    return false
  }
}

/** 产出 { added, removed, diff } —— 忽略行尾差异，避免 CRLF/LF 噪声。 */
function diffAgainstBaseline() {
  let diff = ''
  try {
    diff = execFileSync('git', ['diff', '--no-index', '--ignore-cr-at-eol', '-U0', baselineClient, forkClient],
      { encoding: 'utf8' })
  } catch (err) {
    diff = err.stdout ?? ''   // 有差异时退出码为 1，输出仍在 stdout
  }
  const lines = diff.split(/\r?\n/)
  return {
    diff,
    added: lines.filter((l) => l.startsWith('+') && !l.startsWith('+++')),
    removed: lines.filter((l) => l.startsWith('-') && !l.startsWith('---')),
  }
}

function unattributed(list) {
  const out = []
  for (const l of list) {
    const body = l.slice(1).trim()
    if (body === '') continue
    if (ATTRIBUTABLE.test(body)) continue
    if (STRUCTURAL.test(body)) continue
    out.push(body)
  }
  return out
}

const available = await ensureBaseline()
const skipped = available ? null : `取不到上游 ${UPSTREAM_VERSION}（离线？），漂移审计无法进行`

test('新增行全部可归因到已知修复', (t) => {
  if (!available) return t.skip(skipped)
  const { added } = diffAgainstBaseline()
  const bad = unattributed(added)
  assert.deepEqual(bad, [], `存在无法归因的新增行（${bad.length} 行），需人工确认：\n  ${bad.join('\n  ')}`)
})

test('删除行全部可归因（都是被替换掉的旧实现）', (t) => {
  if (!available) return t.skip(skipped)
  const { removed } = diffAgainstBaseline()
  const bad = unattributed(removed)
  assert.deepEqual(bad, [], `存在无法归因的删除行（${bad.length} 行），需人工确认：\n  ${bad.join('\n  ')}`)
})

test('成块删除的都是预期内的旧实现', (t) => {
  if (!available) return t.skip(skipped)
  const { diff } = diffAgainstBaseline()
  const hunks = diff.split(/^@@/m).slice(1)
  const delHeavy = hunks.filter((h) =>
    h.split(/\r?\n/).filter((l) => l.startsWith('-') && !l.startsWith('---')).length >= 4)
  // 三条旧实现的替换：宽限注释、气泡标签私有定时器、回复芯片私有定时器。
  // 若数量增加，说明有新的大段删除需要复核。
  assert.ok(delHeavy.length <= 3,
    `出现了 ${delHeavy.length} 个成块删除（预期 ≤3），需复核：\n` +
    delHeavy.map((h) => '  · ' + h.split(/\r?\n/).find((l) => l.startsWith('-')).slice(1).trim()).join('\n'))
})

test('改动规模在预期量级（防止误改整个文件）', (t) => {
  if (!available) return t.skip(skipped)
  const { added, removed } = diffAgainstBaseline()
  assert.ok(added.length < 250, `新增 ${added.length} 行，远超预期 —— 可能误改了整份文件`)
  assert.ok(removed.length < 150, `删除 ${removed.length} 行，远超预期 —— 可能误改了整份文件`)
  assert.ok(added.length > 0, '应存在改动（若为 0，说明 fork 与上游无差异，审计失去意义）')
})
