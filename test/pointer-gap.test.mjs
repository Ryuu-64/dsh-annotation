// 悬停面板的「跨间隙保活」回归测试。
//
// 背景：面板与触发元素之间留有 6px 间隙（定位是 r.bottom + 6 / r.top - h - 6），
// 鼠标跨越间隙的瞬间不在任何元素上。仅靠固定 250ms 宽限（官方 HoverCard 的
// pointer-grace 思路）等于赌用户手快——指针停在间隙里把宽限走满，面板就消失。
//
// 这里把 client.js 里真实的 pointerInsideRect / pointerWithinTipLayer /
// shouldKeepTipOpen / scheduleHide 抽到 vm 沙箱里，用桩定时器与桩几何按行为验证，
// 不是文本断言。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

/** 取出 client.js 里一个顶层 function 的完整源码（花括号配平）。 */
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

/** 取出 `var NAME = <字面量>` 形式的声明源码。 */
function extractVar(name) {
  const m = new RegExp(`var ${name} = ([^\\n]+)`).exec(source)
  if (m === null) throw new Error(`client.js 里找不到 var ${name}`)
  return `var ${name} = ${m[1]}`
}

// 触发元素与面板之间留 6px 间隙（与真实定位一致）
const TRIGGER = { left: 100, right: 200, top: 300, bottom: 318 }
const PANEL = { left: 100, right: 420, top: 324, bottom: 400 }

function makeEnv() {
  const timers = new Map()
  let seq = 0
  // tipLayer 必须模拟真实 DOM：插件的清空方式是 `tipLayer.textContent = ''`，
  // 浏览器里这会移除全部子节点。若用朴素对象（赋值不生效），"面板已关闭"就观测不到，
  // 用例会假绿/假红。
  const tipLayer = {
    childNodes: [],
    set textContent(v) { if (v === '') this.childNodes.length = 0 },
    get textContent() { return this.childNodes.map((n) => n.textContent || '').join('') },
  }
  const sandbox = {
    tipLayer,
    console,
    // 合并 #67/#65 后，scheduleHide 的关闭路径还会解除关闭钩子登记并做归属清空；
    // 这两个机制的行为由 shared-listeners 套件覆盖，这里只需让"真正关闭"可观测。
    releaseActiveTip() {},
    clearTip() { tipLayer.textContent = '' },
    chipLayer: {},
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { fn, ms }); return id },
    clearTimeout(id) { timers.delete(id) },
  }
  vm.createContext(sandbox)
  vm.runInContext([
    extractVar('TIP_GAP_TOLERANCE'),
    'var livePointerX = null',
    'var livePointerY = null',
    extractFunction('pointerInsideRect'),
    extractFunction('pointerWithinTipLayer'),
    extractFunction('shouldKeepTipOpen'),
    'var hoverGrace = null',
    extractFunction('scheduleHide'),
    extractFunction('cancelHide'),
    'globalThis.__env = { scheduleHide, cancelHide, shouldKeepTipOpen,'
      + ' moveTo(x, y) { livePointerX = x; livePointerY = y },'
      + ' get hoverGrace() { return hoverGrace } }',
  ].join('\n'), sandbox)

  const rect = (r) => ({ getBoundingClientRect: () => r })
  return {
    env: sandbox.__env,
    tipLayer,
    /** 展开一个面板（模拟 presentTip 之后的状态）。 */
    showPanel() { const p = rect(PANEL); tipLayer.childNodes.push({ nodeType: 1, ...p }); return p },
    trigger: rect(TRIGGER),
    /** 触发所有到期定时器。 */
    flush() { for (const [id, t] of [...timers]) { timers.delete(id); t.fn() } },
    pending: () => timers.size,
  }
}

test('指针停在触发元素上：走满宽限不关闭', () => {
  const e = makeEnv()
  e.showPanel()
  e.env.moveTo(150, 310)            // 触发元素矩形内
  e.env.scheduleHide(e.trigger)
  e.flush()
  assert.equal(e.tipLayer.childNodes.length, 1, '指针还在触发元素上，面板应保持')
})

test('指针停在 6px 间隙里：走满宽限也不关闭（上游在这里会消失）', () => {
  const e = makeEnv()
  e.showPanel()
  e.env.moveTo(150, 321)            // 318 与 324 之间
  e.env.scheduleHide(e.trigger)
  e.flush()
  assert.equal(e.tipLayer.childNodes.length, 1, '指针仍在间隙容差内，面板应保持')
})

test('指针移进面板本体：走满宽限不关闭', () => {
  const e = makeEnv()
  e.showPanel()
  e.env.moveTo(260, 360)
  e.env.scheduleHide(e.trigger)
  e.flush()
  assert.equal(e.tipLayer.childNodes.length, 1, '指针在面板上，面板应保持')
})

test('指针真正离开：正常关闭（不能修成永不关闭）', () => {
  const e = makeEnv()
  e.showPanel()
  e.env.moveTo(900, 900)
  e.env.scheduleHide(e.trigger)
  e.flush()
  assert.equal(e.tipLayer.childNodes.length, 0, '指针远离后应关闭')
})

test('判定基于实时指针位置，而不是 mouseleave 的过期坐标', () => {
  const e = makeEnv()
  e.showPanel()
  // 离开触发元素那一刻指针在远处（若用事件坐标会判"该关"）
  e.env.moveTo(900, 900)
  e.env.scheduleHide(e.trigger)
  e.flush()
  assert.equal(e.tipLayer.childNodes.length, 0, '先确认此刻确实会关闭')

  // 重新展开后，指针在宽限期内移回面板 → 到点时不应关闭
  e.showPanel()
  e.env.moveTo(900, 900)
  e.env.scheduleHide(e.trigger)
  e.env.moveTo(260, 360)            // 250ms 内移回面板
  e.flush()
  assert.equal(e.tipLayer.childNodes.length, 1, '宽限到点应复查实时位置，而不是事件发生时的坐标')
})

test('cancelHide 能取消待关闭', () => {
  const e = makeEnv()
  e.showPanel()
  e.env.moveTo(900, 900)
  e.env.scheduleHide(e.trigger)
  assert.equal(e.pending(), 1)
  e.env.cancelHide()
  assert.equal(e.pending(), 0)
  assert.equal(e.env.hoverGrace, null)
})

test('setup 里注册 pointermove、teardown 里移除', () => {
  assert.match(source, /document\.addEventListener\('pointermove', onTipPointerMove, true\)/)
  assert.match(source, /document\.removeEventListener\('pointermove', onTipPointerMove, true\)/)
})
