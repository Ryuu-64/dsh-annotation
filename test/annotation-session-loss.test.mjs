// 功能：当 DSH 无法告知「当前是哪个会话」时，插件应当明确提示，而不是静默失效。
//
// 为什么需要这条功能：批注要挂到具体会话上。DSH 0.1.6-alpha.2+ 移除了插件原本依赖的
// 一个字段（上游报告 omdsh-dev/dsh-annotation#64），插件拿不到会话信息时，原先会
// **悄悄跳过**——消息照常发出、批注凭空消失、没有任何报错。用户完全看不出哪里不对。
//
// 这里验证两件事：一是插件能从多个来源尽力取到会话信息；二是实在取不到时会**明确告知**。

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

test('DSH 能告知当前会话时（快照带 current）→ 批注挂到该会话', () => {
  const env = makeEnv({ snapshot: { current: 'session-a', ids: ['session-a'] } })
  assert.equal(env.currentSessionId(), 'session-a')
})

test('DSH 只在快照里给出会话列表时 → 仍能确定当前会话', () => {
  const env = makeEnv({
    snapshot: { ids: ['session-a'], byId: {}, phase: 'ready' },   // 0.1.6-alpha.2+ 的形状
    storage: { 'dsh.sessions.current': JSON.stringify({ sessionId: 'session-b' }) },
  })
  assert.equal(env.currentSessionId(), 'session-b')
})

test('DSH 改用另一种写法告知当前会话 → 插件照样认出来', () => {
  const env = makeEnv({ snapshot: { currentId: 'session-c' } })
  assert.equal(env.currentSessionId(), 'session-c')
})

test('DSH 无从告知当前会话时 → 插件明确表示「取不到」，而不是蒙一个', () => {
  assert.equal(makeEnv({ snapshot: { ids: [], byId: {} } }).currentSessionId(), undefined)
  assert.equal(makeEnv({ snapshot: undefined }).currentSessionId(), undefined)
  assert.equal(makeEnv({ snapshot: { current: '' } }).currentSessionId(), undefined)
})

test('DSH 留下的会话记录损坏时 → 不因此报错崩溃，按「取不到」处理', () => {
  const env = makeEnv({ snapshot: {}, storage: { 'dsh.sessions.current': '{不是 JSON' } })
  assert.equal(env.currentSessionId(), undefined)
  const env2 = makeEnv({ snapshot: {}, storage: { 'dsh.sessions.current': JSON.stringify({ sessionId: 42 }) } })
  assert.equal(env2.currentSessionId(), undefined, 'sessionId 不是字符串时应忽略')
})

test('DSH 的接口本身出错时 → 插件仍能退到其他途径，不把错误抛给用户', () => {
  const env = makeEnv({
    snapshotThrows: true,
    storage: { 'dsh.sessions.current': JSON.stringify({ sessionId: 'session-d' }) },
  })
  assert.equal(env.currentSessionId(), 'session-d')
})

// ---- 反例守卫：不允许悄悄失效 ----

test('插件不再依赖单一来源判断当前会话', () => {
  const raw = source.match(/sessions\.list\.getSnapshot\(\)\.current/g) ?? []
  assert.equal(raw.length, 0, '所有读取都应走 currentSessionId()')
})

test('发送批注时若确定不了会话 → 用户当场收到提示，而不是消息发出、批注消失', () => {
  assert.match(source, /var current = currentSessionId\(\)\s*\n\s*if \(current === undefined\) \{ announceSessionLost\(\); return false \}/,
    'attachAndSend 应先提示再返回 false')
  assert.match(source, /var current = currentSessionId\(\)\s*\n\s*if \(current === undefined\) \{ announceSessionLost\(\); return \}/,
    'submitAttached 应先提示再返回')
})

test('确定不了会话时的提示 → 只提示一次，且同时有界面提示和控制台记录', () => {
  const fn = extractFunction('announceSessionLost')
  assert.match(fn, /if \(sessionLostAnnounced\) return/, '应做一次性去重，避免刷屏')
  assert.match(fn, /console\.warn/, '必须有控制台日志（便于事后排查）')
  assert.match(fn, /showToast/, '必须有界面提示（用户当场能看见）')
})
