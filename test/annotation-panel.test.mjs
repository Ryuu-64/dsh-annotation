// 功能：悬停批注时面板的显示行为。
// 对应上游能力表中的「「批注 ×N」标签」与「回复批注芯片」两项——两者共用同一个面板。
//
// 这里只描述**用户能看到的行为**：面板什么时候显示、什么时候保持、什么时候关闭。
// 不涉及内部实现（归属、定时器、监听器这些是手段，不是功能）。

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

function fn(name) {
  const match = new RegExp(`^(\\s*)function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\1\\}`, 'm').exec(source)
  assert.ok(match, `client.js 中应当存在 ${name}()`)
  return match[0]
}

/** 触发元素与面板之间的真实间隙：面板定位用 r.bottom + 6。 */
const TRIGGER = { left: 100, right: 200, top: 300, bottom: 318 }
const PANEL = { left: 100, right: 420, top: 324, bottom: 400 }

/**
 * 只搭出「面板何时显示」所需的最小环境：一个面板层、可控时钟、可控指针位置。
 * 指针位置与几何都由测试给出，因为 jsdom 没有布局引擎。
 */
function harness() {
  const timers = new Map()
  let seq = 0
  const layer = {
    childNodes: [],
    set textContent(v) { if (v === '') this.childNodes.length = 0 },
    get textContent() { return this.childNodes.map((n) => n.textContent ?? '').join('') },
    appendChild(node) { this.childNodes.push(node); return node },
  }
  const sandbox = {
    layer,
    console: { warn() {} },
    setTimeout(callback, ms) { const id = ++seq; timers.set(id, { callback, ms }); return id },
    clearTimeout(id) { timers.delete(id) },
  }
  vm.createContext(sandbox)
  vm.runInContext([
    'var TIP_GAP_TOLERANCE = 10',
    'var livePointerX = null',
    'var livePointerY = null',
    'var tipOwner = null',
    'var hoverGrace = null',
    fn('clearTip'),
    fn('presentTip'),
    fn('pointerWithinTip'),
    fn('scheduleHide'),
    fn('cancelHide'),
    fn('ownedHide'),
    'globalThis.panel = { clearTip, presentTip, scheduleHide, cancelHide, pointerWithinTip,'
      + ' show(owner, el) { presentTip(owner, el) },'
      + ' movePointerTo(x, y) { livePointerX = x; livePointerY = y } }',
  ].join('\n').replace(/\btipLayer\b/g, 'layer'), sandbox)
  return {
    panel: sandbox.panel,
    layer,
    /** 让所有到期的定时器运行（模拟时间流逝）。 */
    advance(ms) { for (const [id, t] of [...timers]) { timers.delete(id); t.callback() } },
    get visible() { return layer.childNodes.length > 0 },
  }
}

const rect = (r) => ({ getBoundingClientRect: () => r })

test('悬停批注后，面板显示该批注的内容', () => {
  const h = harness()
  h.panel.show(rect(TRIGGER), { nodeType: 1, textContent: '批注 1 的原文' })
  assert.equal(h.visible, true)
  assert.match(h.layer.textContent, /批注 1 的原文/)
})

test('指针停在触发元素上时，面板保持显示', () => {
  const h = harness()
  h.panel.show(rect(TRIGGER), { nodeType: 1, textContent: '内容' })
  h.panel.movePointerTo(150, 310)
  h.panel.scheduleHide(rect(TRIGGER))
  h.advance(250)
  assert.equal(h.visible, true, '指针仍在批注上，面板不应当关闭')
})

test('指针穿过批注与面板之间的间隙时，面板不关闭', () => {
  const h = harness()
  const trigger = rect(TRIGGER)
  h.panel.show(trigger, { nodeType: 1, getBoundingClientRect: () => PANEL })
  h.panel.movePointerTo(150, 321)          // 落在 318 与 324 之间
  h.panel.scheduleHide(trigger)
  h.advance(250)
  assert.equal(h.visible, true, '指针仍在间隙里，面板不应当关闭')
})

test('指针移到面板上时，面板保持显示', () => {
  const h = harness()
  const trigger = rect(TRIGGER)
  h.panel.show(trigger, { nodeType: 1, getBoundingClientRect: () => PANEL })
  h.panel.movePointerTo(260, 360)
  h.panel.scheduleHide(trigger)
  h.advance(250)
  assert.equal(h.visible, true)
})

test('指针离开后，面板关闭', () => {
  const h = harness()
  const trigger = rect(TRIGGER)
  h.panel.show(trigger, { nodeType: 1, getBoundingClientRect: () => PANEL })
  h.panel.movePointerTo(900, 900)
  h.panel.scheduleHide(trigger)
  h.advance(250)
  assert.equal(h.visible, false, '指针远离后应当关闭，而不是一直留着')
})

test('指针在宽限期内移回面板，面板仍然显示', () => {
  const h = harness()
  const trigger = rect(TRIGGER)
  h.panel.show(trigger, { nodeType: 1, getBoundingClientRect: () => PANEL })
  h.panel.movePointerTo(900, 900)
  h.panel.scheduleHide(trigger)
  h.panel.movePointerTo(260, 360)          // 250ms 内移回面板
  h.advance(250)
  assert.equal(h.visible, true, '判定应当依据当前指针位置，而不是离开时的位置')
})

test('一个面板的关闭不会影响另一个正在显示的面板', () => {
  const h = harness()
  const first = rect({ left: 100, right: 200, top: 600, bottom: 618 })
  const second = rect({ left: 100, right: 200, top: 700, bottom: 718 })
  h.panel.show(first, { nodeType: 1, getBoundingClientRect: () => PANEL })
  h.panel.scheduleHide(first)              // 第一个排了关闭
  h.panel.show(second, { nodeType: 1, getBoundingClientRect: () => PANEL })   // 第二个随即显示
  h.advance(250)
  assert.equal(h.visible, true, '第二个面板不应当被第一个的关闭带走')
})

test('当前面板自己的人为关闭请求仍然生效', () => {
  const h = harness()
  const trigger = rect(TRIGGER)
  h.panel.show(trigger, { nodeType: 1, getBoundingClientRect: () => PANEL })
  h.panel.clearTip(trigger)
  assert.equal(h.visible, false)
})

test('宿主清空面板时，正在被查看的面板不受影响', () => {
  const h = harness()
  const tag = rect(TRIGGER)
  const other = rect({ left: 0, right: 0, top: 0, bottom: 0 })
  h.panel.show(tag, { nodeType: 1, getBoundingClientRect: () => PANEL })
  h.panel.clearTip(other)                  // 别的元素发起的清空
  assert.equal(h.visible, true, '不是自己的面板就不该被清掉')
})
