// 当前会话 id 的降级读取（对应 issue #10）。
//
// 背景：DSH 0.1.6-alpha.2+ 移除了 `sessions.list` 快照里的 `current` 字段
// （上游报告 omdsh-dev/dsh-annotation#64）。本插件原有 7 处直接读它，拿不到时
// `attachAndSend()` 会**静默 return false** —— 消息照常发出、批注内容凭空消失、
// 没有任何报错或提示。
//
// 这里把 client.js 里真实的 currentSessionId() 抽到 vm 沙箱里，用不同的「内核形状」
// 验证降级链，并确认调用方在拿不到时走 announceSessionLost() 而不是静默跳过。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

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

/**
 * @param {{ snapshot?: any, snapshotThrows?: boolean, storage?: Record<string,string> }} kernel
 */
function makeEnv(kernel = {}) {
  const store = kernel.storage ?? {}
  const sandbox = {
    console: { warn() {} },
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null },
    },
    sessions: {
      list: {
        getSnapshot() {
          if (kernel.snapshotThrows === true) throw new Error('kernel boom')
          return kernel.snapshot
        },
      },
    },
  }
  vm.createContext(sandbox)
  vm.runInContext([
    "var SESSION_ID_STORAGE_KEY = 'dsh.sessions.current'",
    extractFunction('currentSessionId'),
    'globalThis.__env = { currentSessionId }',
  ].join('\n'), sandbox)
  return sandbox.__env
}

test('现行内核（快照自带 current）→ 直接用它', () => {
  const env = makeEnv({ snapshot: { current: 'session-a', ids: ['session-a'] } })
  assert.equal(env.currentSessionId(), 'session-a')
})

test('新版内核（快照没有 current）→ 降级读持久化键', () => {
  const env = makeEnv({
    snapshot: { ids: ['session-a'], byId: {}, phase: 'ready' },   // 0.1.6-alpha.2+ 的形状
    storage: { 'dsh.sessions.current': JSON.stringify({ sessionId: 'session-b' }) },
  })
  assert.equal(env.currentSessionId(), 'session-b')
})

test('未来内核若换名成 currentId → 也能兼容', () => {
  const env = makeEnv({ snapshot: { currentId: 'session-c' } })
  assert.equal(env.currentSessionId(), 'session-c')
})

test('三种来源都拿不到 → 返回 undefined（调用方据此提示用户）', () => {
  assert.equal(makeEnv({ snapshot: { ids: [], byId: {} } }).currentSessionId(), undefined)
  assert.equal(makeEnv({ snapshot: undefined }).currentSessionId(), undefined)
  assert.equal(makeEnv({ snapshot: { current: '' } }).currentSessionId(), undefined)
})

test('持久化键内容损坏 → 不抛错，按拿不到处理', () => {
  const env = makeEnv({ snapshot: {}, storage: { 'dsh.sessions.current': '{不是 JSON' } })
  assert.equal(env.currentSessionId(), undefined)
  const env2 = makeEnv({ snapshot: {}, storage: { 'dsh.sessions.current': JSON.stringify({ sessionId: 42 }) } })
  assert.equal(env2.currentSessionId(), undefined, 'sessionId 不是字符串时应忽略')
})

test('内核接口本身抛错 → 仍能降级，不把异常抛给调用方', () => {
  const env = makeEnv({
    snapshotThrows: true,
    storage: { 'dsh.sessions.current': JSON.stringify({ sessionId: 'session-d' }) },
  })
  assert.equal(env.currentSessionId(), 'session-d')
})

// ---- 结构守卫：不能退回「静默失败」 ----

test('不再有任何地方直接读 sessions.list.getSnapshot().current', () => {
  const raw = source.match(/sessions\.list\.getSnapshot\(\)\.current/g) ?? []
  assert.equal(raw.length, 0, '所有读取都应走 currentSessionId()')
})

test('两处发送路径在拿不到会话时都会明确提示（不再静默 return）', () => {
  assert.match(source, /var current = currentSessionId\(\)\s*\n\s*if \(current === undefined\) \{ announceSessionLost\(\); return false \}/,
    'attachAndSend 应先提示再返回 false')
  assert.match(source, /var current = currentSessionId\(\)\s*\n\s*if \(current === undefined\) \{ announceSessionLost\(\); return \}/,
    'submitAttached 应先提示再返回')
})

test('announceSessionLost 只提示一次，且带可反馈的日志', () => {
  const fn = extractFunction('announceSessionLost')
  assert.match(fn, /if \(sessionLostAnnounced\) return/, '应做一次性去重，避免刷屏')
  assert.match(fn, /console\.warn/, '必须有控制台日志（便于事后排查）')
  assert.match(fn, /showToast/, '必须有界面提示（用户当场能看见）')
})
