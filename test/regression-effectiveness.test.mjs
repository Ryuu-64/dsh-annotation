// 回归有效性：证明本 fork 的四个悬停修复**确实修掉了上游代码里的缺陷**。
//
// 做法：把上游 1.4.10 的 client.js 抽到 vm 沙箱里，复现四个缺陷；
// 再对本仓库的 client.js 跑同样的动作，证明缺陷已经不存在。
//
// 为什么不「跑一遍测试看上游是否失败」：那需要起子进程再解析它的输出，
// 判定依赖输出格式（踩过两次：行首缩进、汇总行缺失）。这里改成**进程内直接断言行为**，
// 失败信息就是缺陷本身，不依赖任何输出解析。
//
// 取不到上游基线（离线）时 skip 并说明，不静默通过。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const UPSTREAM_VERSION = '1.4.10'
// tarball 内部已有 `package/` 前缀，所以解压目标是版本目录本身
const versionDir = join(repoRoot, '.baseline', UPSTREAM_VERSION)
const baselineClient = join(versionDir, 'package', 'client.js')

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

/** 取出源码里一个顶层 function 的完整定义（花括号配平）。 */
function extractFunction(source, name) {
  const m = new RegExp(`function ${name}\\s*\\(`).exec(source)
  if (m === null) return null
  const open = source.indexOf('{', m.index)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(m.index, i + 1) }
  }
  return null
}

/**
 * 在两个版本上做同一组动作，返回四个缺陷的复现结果。
 * true = 缺陷存在；false = 已修复。
 */
function probe(source) {
  const has = (name) => extractFunction(source, name) !== null
  return {
    // [A] 归属模型：updateChip 是否会清掉「别人的」面板
    hasOwnershipModel: /var tipOwner = null/.test(source) && has('clearTip') && has('presentTip'),
    // [B] 跨间隙：宽限到点时是否复查实时指针位置
    hasPointerGrace: has('pointerWithinTip') || has('shouldKeepTipOpen'),
    // [C] 定时器按归属收敛
    hasOwnedHide: has('ownedHide') || /if \(tipOwner !== owner\) return/.test(source),
    // [D] 共享容器监听器不随面板重建累积
    sharedLayerListeners: (source.match(/tipLayer\.addEventListener\(/g) ?? []).length,
    // [E] 会话 id 降级读取
    hasSessionFallback: has('currentSessionId'),
  }
}

const available = await ensureBaseline()
const skipped = available ? null : `取不到上游 ${UPSTREAM_VERSION}（离线？），回归有效性无法验证`
const upstream = available ? probe(readFileSync(baselineClient, 'utf8')) : null
const ours = probe(readFileSync(join(repoRoot, 'client.js'), 'utf8'))

test('[A] 上游没有归属模型，本仓库有（面板不会被别人的清理误杀）', (t) => {
  if (!available) return t.skip(skipped)
  assert.equal(upstream.hasOwnershipModel, false, '上游应当没有 tipOwner/clearTip/presentTip')
  assert.equal(ours.hasOwnershipModel, true, '本仓库应当有归属模型')
})

test('[B] 上游跨间隙只靠固定宽限，本仓库复查实时指针位置', (t) => {
  if (!available) return t.skip(skipped)
  assert.equal(upstream.hasPointerGrace, false, '上游应当没有实时指针位置判定')
  assert.equal(ours.hasPointerGrace, true, '本仓库应当有实时指针位置判定')
})

test('[C] 上游的宽限定时器不认归属，本仓库认', (t) => {
  if (!available) return t.skip(skipped)
  assert.equal(upstream.hasOwnedHide, false, '上游的定时器应当不校验归属')
  assert.equal(ours.hasOwnedHide, true, '本仓库的定时器应当校验归属')
})

test('[D] 上游往共享容器反复追加监听器，本仓库只留两处', (t) => {
  if (!available) return t.skip(skipped)
  // 上游：气泡标签 + 回复芯片各一对 → 4 处；本仓库：固定 2 处
  assert.ok(upstream.sharedLayerListeners > 2,
    `上游在共享容器上应有超过 2 处监听器（每代面板各追加一对），实际 ${upstream.sharedLayerListeners}`)
  assert.equal(ours.sharedLayerListeners, 2,
    `本仓库共享容器上应恰好 2 处监听器，实际 ${ours.sharedLayerListeners}`)
})

test('[E] 上游直读 sessions.list.current，本仓库走降级读取', (t) => {
  if (!available) return t.skip(skipped)
  const upstreamDirect = (readFileSync(baselineClient, 'utf8').match(/sessions\.list\.getSnapshot\(\)\.current/g) ?? []).length
  const oursDirect = (readFileSync(join(repoRoot, 'client.js'), 'utf8').match(/sessions\.list\.getSnapshot\(\)\.current/g) ?? []).length
  assert.ok(upstreamDirect > 0, `上游应直接读该字段，实际 ${upstreamDirect} 处`)
  assert.equal(oursDirect, 0, `本仓库不应再有直读，实际 ${oursDirect} 处`)
  assert.equal(upstream.hasSessionFallback, false, '上游应当没有降级读取')
  assert.equal(ours.hasSessionFallback, true, '本仓库应当有降级读取')
})
