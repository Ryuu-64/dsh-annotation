// 共享悬浮容器的监听器泄漏回归测试。
//
// 背景：`tipLayer` 是长期存活的 body 级单例（只在插件销毁时 remove），而气泡标签
// （attachBubbleTag）与回复芯片（makeReplyChip）会被反复重建 —— 消息重渲染、语言
// 切换、切会话回来都会让它们换一代。改动前每个面板都在自己的 mouseenter 里往
// `tipLayer` 追加一对监听器，却从不移除：
//
//     tag.addEventListener('mouseleave', bubbleHide)
//     tipLayer.addEventListener('mouseenter', bubbleKeep)   // ← 每代 +1
//     tipLayer.addEventListener('mouseleave', bubbleHide)   // ← 每代 +1
//
// 于是监听器无界累积，每个闭包还持有已废弃的 grace 定时器与被移出 DOM 的触发元素；
// 关闭决策不再由「当前面板」决定，而是由历史上任意一代的定时器决定。
//
// 修复后共享容器上只保留两处固定监听器，通过 tipActiveHide 指针派发到当前面板。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

/** 取出一个顶层 function 的完整源码（花括号配平）。 */
function extractFunction(name) {
  const m = new RegExp(`function ${name}\\s*\\(`).exec(source)
  if (m === null) throw new Error(`client.js 里找不到 function ${name}`)
  const open = source.indexOf('{', m.index)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(m.index, i + 1)
    }
  }
  throw new Error(`function ${name} 花括号不配平`)
}

test('共享容器只注册两处监听器（气泡标签/回复芯片各自 +2 的写法已移除）', () => {
  const raw = source.match(/tipLayer\.addEventListener\(/g) ?? []
  assert.equal(raw.length, 2, 'tipLayer 应只保留 mouseenter / mouseleave 两处固定监听器')
  assert.match(source, /tipLayer\.addEventListener\('mouseenter', sharedTipMouseEnter\)/)
  assert.match(source, /tipLayer\.addEventListener\('mouseleave', sharedTipMouseLeave\)/)
})

test('三类面板都不再往共享容器追加监听器', () => {
  // 面板只挂自己的触发元素监听，并且只做登记
  assert.match(source, /tag\.addEventListener\('mouseleave', bubbleHide\)/)
  assert.match(source, /chip\.addEventListener\('mouseleave', hide\)/)
  // 胶囊的 scheduleHide 以 chipLayer 为触发元素传入（实时指针判定需要）
  assert.match(source, /chipLayer\.addEventListener\('mouseleave', function \(\) \{ scheduleHide\(chipLayer\) \}\)/)
  // 旧写法（每代面板各挂一对到 tipLayer）应彻底消失
  assert.doesNotMatch(source, /tipLayer\.addEventListener\('mouseenter', (bubbleKeep|keep|cancelHide)\)/)
  assert.doesNotMatch(source, /tipLayer\.addEventListener\('mouseleave', (bubbleHide|hide|scheduleHide)\)/)
})

test('每类面板都在 mouseenter 时登记关闭钩子', () => {
  const registrations = source.match(/tipActiveHide = \{ keep: [^}]+ \}/g) ?? []
  assert.equal(registrations.length, 3, '三类面板各应登记一次（胶囊 / 气泡标签 / 回复芯片）')
  assert.match(source, /tipActiveHide = \{ keep: cancelHide, hide: function \(\) \{ scheduleHide\(chipLayer\) \} \}/)
  assert.match(source, /tipActiveHide = \{ keep: bubbleKeep, hide: bubbleHide \}/)
  assert.match(source, /tipActiveHide = \{ keep: keep, hide: hide \}/)
})

test('面板关闭后解除登记，避免残留钩子被继续派发', () => {
  assert.match(source, /function releaseActiveTip\(\) \{\s*tipActiveHide = null\s*\}/)
  // 三处宽限到点的关闭都要解除登记
  const releases = source.match(/releaseActiveTip\(\)/g) ?? []
  assert.ok(releases.length >= 4, `应有 1 处定义 + 至少 3 处调用，实际 ${releases.length}`)
})

// ---- 行为：共享监听器确实按「当前登记的面板」派发 ----

function makeDispatcher() {
  const sandbox = { console }
  vm.createContext(sandbox)
  vm.runInContext([
    'var tipActiveHide = null',
    extractFunction('sharedTipMouseEnter'),
    extractFunction('sharedTipMouseLeave'),
    extractFunction('releaseActiveTip'),
    'globalThis.__env = { sharedTipMouseEnter, sharedTipMouseLeave, releaseActiveTip,'
      + ' register(h) { tipActiveHide = h }, get registered() { return tipActiveHide } }',
  ].join('\n'), sandbox)
  return sandbox.__env
}

test('mouseenter / mouseleave 派发到当前登记的面板', () => {
  const env = makeDispatcher()
  const calls = []
  env.register({ keep: () => calls.push('keep'), hide: () => calls.push('hide') })
  env.sharedTipMouseEnter()
  env.sharedTipMouseLeave()
  assert.deepEqual(calls, ['keep', 'hide'])
})

test('面板换代后派发到新面板，不会误触上一代', () => {
  const env = makeDispatcher()
  const calls = []
  env.register({ keep: () => calls.push('A-keep'), hide: () => calls.push('A-hide') })
  env.register({ keep: () => calls.push('B-keep'), hide: () => calls.push('B-hide') })
  env.sharedTipMouseEnter()
  env.sharedTipMouseLeave()
  assert.deepEqual(calls, ['B-keep', 'B-hide'], '只应派发到最近登记的面板')
})

test('没有登记时共享监听器是空操作（不会抛错）', () => {
  const env = makeDispatcher()
  env.releaseActiveTip()
  assert.equal(env.registered, null)
  env.sharedTipMouseEnter()
  env.sharedTipMouseLeave()
  assert.equal(env.registered, null)
})

test('releaseActiveTip 之后不再派发', () => {
  const env = makeDispatcher()
  const calls = []
  env.register({ keep: () => calls.push('keep'), hide: () => calls.push('hide') })
  env.releaseActiveTip()
  env.sharedTipMouseEnter()
  env.sharedTipMouseLeave()
  assert.deepEqual(calls, [], '解除登记后不应再派发')
})
