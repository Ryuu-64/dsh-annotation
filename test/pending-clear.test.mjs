import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

function fnOf(name) {
  const match = source.match(new RegExp(`function ${name}\\(\\) \\{[\\s\\S]*?\\n      \\}`))
  assert.ok(match, `client.js should define ${name}`)
  return match[0]
}

test('装饰扫描绝不清空待发送批注（issue #28 复测：历史消息重装饰 ≠ 已发送）', () => {
  const deco = fnOf('decorateAll')
  assert.ok(!deco.includes('writeCurrentPendingQuotes'),
    'decorateAll must not write pending storage — DOM cannot distinguish a freshly sent message from history re-rendered after session switch / refresh')
  assert.ok(!deco.includes('ui.quotes = []'),
    'decorateAll must not clear ui.quotes — send-clearing authority is watchInputDraft alone')
})

test('watchInputDraft 订阅失败时每秒重试（初始化时序洞由重试补齐，不再依赖装饰兜底）', () => {
  const watch = fnOf('watchInputDraft')
  assert.match(watch, /setInterval/, 'watchInputDraft should retry the subscription')
  assert.match(watch, /tryWatchInputDraft/, 'retry should go through tryWatchInputDraft')
  assert.match(source, /clearInterval\(inputWatchTimer\)/, 'dispose/switch must stop the retry timer')
})

test('会话切换作废旧会话未消费的发送暂存数据', () => {
  // issue #64：0.1.6-alpha.2 起选择态移出 list store，list.subscribe 不再于切换时触发；
  // onSessionSwitch 统一经 readCurrentSessionId 解析（uiSession → localStorage →
  // list.current → retainedBy），触发层面三层并行（uiSession source / list.subscribe / 1s 轮询）。
  const sw = fnOf('onSessionSwitch')
  assert.match(sw, /readCurrentSessionId\(\)/,
    'session-switch handler must resolve the id via readCurrentSessionId (list.current is gone on new hosts)')
  assert.match(sw, /pendingDeco\.length = 0/,
    'stale send staging from the previous session must be dropped, not consumed by the new session history')
  assert.match(source, /sessions\.list\.subscribe\(onSessionSwitch\)/,
    'must keep the legacy list subscription for old hosts')
  assert.match(source, /unsubSession = uiSource\.subscribe\(onSessionSwitch\)/,
    'must subscribe the uiSession current source where it exists (0.1.7+ fires switches only there)')
  assert.match(source, /setInterval\(onSessionSwitch, 1000\)/,
    'must poll as fallback where no selection source can be subscribed')
  assert.match(source, /clearInterval\(switchTimer\)/,
    'dispose must stop the switch poller')
  assert.doesNotMatch(source, /sessions\.currentProvideInfo/,
    'sessions.currentProvideInfo exists on no published host (current contract lives in packages/api/session-controller and has no such member) — it must not be read or subscribed')
})

test('当前会话 id 兼容 DSH 0.1.7（list 快照不再暴露 current）', () => {
  assert.match(source, /function readCurrentSessionId\(\)/, 'client.js should route current-session reads through one helper')
  assert.match(source, /adapter\.current/, 'helper should prefer uiSession.adapter.current')
  assert.doesNotMatch(source, /sessions\.list\.getSnapshot\(\)\.current/,
    'the removed list.current field must not be read directly — it is always undefined on 0.1.7+, which breaks send')
})

test('发送暂存数据在隐藏手术成功后才消费（peek → shift，不提前丢失）', () => {
  assert.match(source, /pendingDeco\[0\]\.items/, 'peek pendingDeco instead of popping')
  assert.doesNotMatch(source, /pendingDeco\.pop\(\)/,
    'popping before hideAnnotationBlock succeeds loses the staged items when content is not rendered yet')
})

test('readCurrentSessionId 四级回退链覆盖 0.1.1 ~ 0.2.0（issue #64，#68 + #65 合并方案）', () => {
  const helper = fnOf('readCurrentSessionId')
  const uiSource = fnOf('currentSessionSource')
  assert.match(uiSource, /adapter\.current/,
    'must prefer uiSession.adapter.current — the public selection source on 0.1.7+ / 0.2.0 (binding.key = sessionId)')
  assert.match(helper, /currentSessionSource\(\)/,
    'the resolver must consult the uiSession source first')
  assert.match(helper, /dsh\.sessions\.current/,
    'must fall back to the kernel-persisted selection — on 0.1.6-alpha.2 ~ 0.1.6 it is the only path that works')
  assert.match(helper, /snap\.current/,
    'must keep the legacy list.current for hosts <= 0.1.6-alpha.1, where it is the exact selection')
  assert.match(helper, /retainedBy/,
    'must fall back to the public retainedBy.mainView>0 face (covers "no persisted key yet / storage cleared")')
  assert.ok(helper.indexOf('currentSessionSource()') < helper.indexOf('dsh.sessions.current')
    && helper.indexOf('dsh.sessions.current') < helper.indexOf('snap.current')
    && helper.indexOf('snap.current') < helper.indexOf('retainedBy'),
    'resolution order must be uiSession → localStorage → list.current → retainedBy (retainedBy is the main-view heuristic the kernel itself only uses as a repair path)')
  assert.doesNotMatch(source, /sessions\.currentProvideInfo/,
    'the stale-source read face must be gone: upstream contract has no currentProvideInfo')
  assert.doesNotMatch(source, /getSnapshot\(\)\.current/,
    'no direct sessions.list.getSnapshot().current reads may remain — all must go through readCurrentSessionId')
})
