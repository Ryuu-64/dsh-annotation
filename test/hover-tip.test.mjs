// 悬浮面板（hover tip）子系统的回归测试。
//
// 这些用例不是「结构断言」——它们把 client.js 里真实的 tipOwner / clearTip /
// presentTip / scheduleHide / pointerWithinTip 抽出来，在 Node 的 vm 沙箱里用桩
// 定时器与桩几何重新组合后**按行为**验证。上游 1.4.10 的三个缺陷各自对应一条：
//
//   A 共享容器被无归属清空   → 宿主 layout mutation 抹掉正在观看的面板
//   C 各面板各持定时器       → A 遗留的 hide 误杀 B 刚显示的面板
//   D 每渲染一次追加监听器   → 共享容器上的监听器无界累积
//   B 宽限只靠固定 250ms     → 鼠标跨 6px 间隙慢一点面板就消失
//
// 运行：npm test（node --test "test/**/*.test.mjs"）

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const CLIENT = join(here, '..', 'client.js')
const source = readFileSync(CLIENT, 'utf8')

/** 取出 model 里一个顶层 function 的完整源码（花括号配平）。 */
function extractFunction(name) {
  const re = new RegExp(`function ${name}\\s*\\(`)
  const m = re.exec(source)
  if (m === null) throw new Error(`client.js 里找不到 function ${name}`)
  const start = m.index
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    const ch = source[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`function ${name} 花括号不配平`)
}

/** 取出 `var NAME = <字面量>` 形式的顶层声明源码。 */
function extractVar(name) {
  const re = new RegExp(`var ${name} = ([^\\n]+)`)
  const m = re.exec(source)
  if (m === null) throw new Error(`client.js 里找不到 var ${name}`)
  return `var ${name} = ${m[1]}`
}

function makeStubNode() {
  return {
    nodeType: 1,
    rect: { left: 0, right: 0, top: 0, bottom: 0 },
    getBoundingClientRect() { return this.rect },
  }
}

/**
 * 用真实源码片段搭一个可观测的悬浮面板环境。
 * @param {{ now?: number, pointerInside?: boolean }} opts
 */
function makeEnv(opts = {}) {
  const timers = new Map()
  let seq = 0
  let now = 0

  const tipLayer = {
    childNodes: [],
    set textContent(v) { this.childNodes = v === '' ? [] : [v] },
    get textContent() { return this.childNodes.length === 0 ? '' : this.childNodes[0] },
    appendChild(el) { this.childNodes.push(el); return el },
  }

  const appended = []
  const sandbox = {
    tipLayer,
    console: { log() {}, warn() {} },
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { fn, at: now + ms }); return id },
    clearTimeout(id) { timers.delete(id) },
    // 默认用可控的指针判定；useRealPointer 时改用下面抽出并注入的真实实现
    ...(opts.useRealPointer === true ? {} : { pointerWithinTip: () => opts.pointerInside === true }),
    // 供 [B] 用真实 pointerWithinTip 时喂几何：面板矩形存沙箱变量，由桩节点读取
    tipPanelRect: { left: 0, right: 0, top: 0, bottom: 0 },
  }
  vm.createContext(sandbox)

  const parts = [
    'var tipOwner = null',
    extractFunction('clearTip'),
    extractFunction('presentTip'),
    'var hoverGrace = null',
    extractFunction('scheduleHide'),
    extractFunction('cancelHide'),
    extractFunction('ownedHide'),
    'var TIP_GAP_TOLERANCE = 10',
    'var livePointerX = null',
    'var livePointerY = null',
    extractFunction('onTipPointerMove'),
    extractFunction('pointerWithinTip'),
    'globalThis.__env = { clearTip, presentTip, scheduleHide, cancelHide, ownedHide,'
      + ' pointerWithinTip, onTipPointerMove,'
      + ' get tipOwner() { return tipOwner }, get hoverGrace() { return hoverGrace } }',
  ]
  vm.runInContext(parts.join('\n'), sandbox)

  return {
    env: sandbox.__env,
    tipLayer,
    appended,
    /** 推进时间并触发到期定时器。 */
    tick(ms) {
      now += ms
      for (const [id, t] of [...timers]) {
        if (t.at <= now) { timers.delete(id); t.fn() }
      }
    },
    pendingTimers: () => timers.size,
  }
}

// ---------------------------------------------------------------- A

test('[A] 正在观看的面板上，宿主 layout mutation 触发的 updateChip 不会抹掉它', () => {
  const { env, tipLayer } = makeEnv()
  const chipLayer = makeStubNode()   // 输入框旁的胶囊：当前无待发送批注 → updateChip 走清空分支
  const tag = makeStubNode()         // 用户气泡上的「批注 ×N」标签：面板正由它展示

  env.presentTip(tag, { nodeType: 1, id: 'tag-panel' })
  assert.equal(tipLayer.childNodes.length, 1, '标签面板应已挂上')

  // 上游 updateChip() 的「无待发送批注」分支：clearTip(chipLayer)
  env.clearTip(chipLayer)

  assert.equal(tipLayer.childNodes.length, 1, 'chipLayer 无权清掉 tag 的面板')
  assert.equal(env.tipOwner, tag, '归属仍应是 tag')
})

test('[A] 归属方可清掉自己的面板；无归属调用清掉任何面板', () => {
  const { env, tipLayer } = makeEnv()
  const tag = makeStubNode()

  env.presentTip(tag, { nodeType: 1, id: 'tag-panel' })
  env.clearTip(tag)
  assert.equal(tipLayer.childNodes.length, 0, '归属方应能清掉自己的面板')
  assert.equal(env.tipOwner, null)

  env.presentTip(tag, { nodeType: 1, id: 'tag-panel-2' })
  env.clearTip()   // 语言切换 / 会话切换：显式场景，允许无归属清空
  assert.equal(tipLayer.childNodes.length, 0, '无归属清空应生效')
  assert.equal(env.tipOwner, null)
})

// ---------------------------------------------------------------- C

test('[C] A 面板遗留的 hide 不会误杀 B 面板刚显示的内容', () => {
  const { env, tipLayer, tick } = makeEnv({ pointerInside: false })
  const tag = makeStubNode()
  const chip = makeStubNode()

  // 快速从 A 滑到 B：A 排了一个 250ms 的 hide，然后 B 立即显示
  env.scheduleHide(tag)
  env.presentTip(chip, { nodeType: 1, id: 'chip-panel' })
  assert.equal(tipLayer.childNodes.length, 1)

  tick(300)   // A 的定时器到点

  assert.equal(tipLayer.childNodes.length, 1, 'B 的面板不该被 A 的定时器清掉')
  assert.equal(env.tipOwner, chip, '归属仍应是 chip')
})

test('[C] 归属方自己的 hide 到点仍然会关闭面板', () => {
  const { env, tipLayer, tick } = makeEnv({ pointerInside: false })
  const chip = makeStubNode()

  env.presentTip(chip, { nodeType: 1, id: 'chip-panel' })
  env.scheduleHide(chip)
  tick(300)

  assert.equal(tipLayer.childNodes.length, 0, '指针已离开，面板应关闭')
  assert.equal(env.tipOwner, null)
})

test('[C] 所有面板共用一个计时器句柄，不会各自堆积', () => {
  const { env, pendingTimers, tick } = makeEnv({ pointerInside: false })
  const a = makeStubNode()
  const b = makeStubNode()

  env.scheduleHide(a)
  env.scheduleHide(b)
  env.scheduleHide(a)
  assert.equal(pendingTimers(), 1, '同一时刻只应存在一个宽限定时器')

  env.cancelHide()
  assert.equal(pendingTimers(), 0, 'cancelHide 应能取消它')
  assert.equal(env.hoverGrace, null)
})

// ---------------------------------------------------------------- B

test('[B] 指针仍在触发元素/面板/间隙容差内时不关闭（而非只赌 250ms）', () => {
  // 用真实 pointerWithinTip：喂真实几何 + 真实指针坐标。
  // （注意：vm.runInContext 会把真实的 pointerWithinTip 赋值到沙箱，覆盖注入桩）
  const { env, tipLayer, tick } = makeEnv({ useRealPointer: true })

  const tag = {
    left: 100, right: 200, top: 300, bottom: 318,
    getBoundingClientRect() { return this },
  }
  const panel = {
    nodeType: 1,
    rect: { left: 100, right: 420, top: 324, bottom: 400 },   // 与触发元素相距 6px
    getBoundingClientRect() { return this.rect },
  }

  env.presentTip(tag, panel)
  // 指针停在 6px 间隙里（不在任何元素上），把 250ms 宽限走满
  env.onTipPointerMove({ clientX: 150, clientY: 321 })
  env.scheduleHide(tag)
  tick(300)

  assert.equal(tipLayer.childNodes.length, 1, '指针还在间隙/面板上，不该关闭')
})

test('[B] pointerWithinTip 用实时指针坐标，且覆盖触发元素、面板与容差', () => {
  // 直接跑真实实现：用桩 tipOwner / 桩面板几何 / 桩指针坐标验证判定
  const boxes = {
    trigger: { left: 100, right: 200, top: 300, bottom: 318 },
    panel: { left: 100, right: 420, top: 324, bottom: 400 },   // 与触发元素相距 6px
  }
  const sandbox = {
    tipOwner: { getBoundingClientRect: () => boxes.trigger },
    tipLayer: { childNodes: [{ nodeType: 1, getBoundingClientRect: () => boxes.panel }] },
    TIP_GAP_TOLERANCE: 10,
    livePointerX: null,
    livePointerY: null,
  }
  vm.createContext(sandbox)
  vm.runInContext(extractVar('TIP_GAP_TOLERANCE') + '\n' + extractFunction('pointerWithinTip'), sandbox)
  const inside = (x, y) => { sandbox.livePointerX = x; sandbox.livePointerY = y; return sandbox.pointerWithinTip() }

  assert.equal(inside(150, 310), true, '触发元素上 → 保持')
  assert.equal(inside(150, 330), true, '面板上 → 保持')
  assert.equal(inside(150, 321), true, '6px 间隙内（容差 10）→ 保持')
  assert.equal(inside(150, 500), false, '远离两者 → 关闭')
  assert.equal(inside(900, 330), false, '横向离开 → 关闭')

  sandbox.livePointerX = null
  sandbox.livePointerY = null
  assert.equal(sandbox.pointerWithinTip(), false, '还没有指针位置时不误保活')
})

test('[B] 指针坐标来自 pointermove 实时跟踪，而不是 mouseleave 的过期坐标', () => {
  assert.match(source, /document\.addEventListener\('pointermove', onTipPointerMove, true\)/,
    '应注册 pointermove 跟踪')
  assert.match(source, /document\.removeEventListener\('pointermove', onTipPointerMove, true\)/,
    '清理函数里应移除该监听器')
  assert.match(extractFunction('onTipPointerMove'), /livePointerX = e\.clientX/)
  assert.doesNotMatch(extractFunction('scheduleHide'), /event\.clientX/,
    'scheduleHide 不得再从事件对象读坐标（250ms 后已过期）')
})

// ---------------------------------------------------------------- D

test('[D] 三类面板不再往共享 tipLayer 上追加监听器', () => {
  const raw = source.match(/tipLayer\.addEventListener\(/g) ?? []
  assert.equal(raw.length, 2,
    'tipLayer 只允许两处固定监听器（mouseenter / mouseleave），面板换代不得新增')
})

test('[D] 气泡标签与回复芯片各有且仅有自己的 mouseleave 关闭钩子', () => {
  assert.match(source, /tag\.addEventListener\('mouseleave', ownedHide\(tag\)\)/)
  assert.match(source, /chip\.addEventListener\('mouseleave', ownedHide\(chip\)\)/)
  assert.doesNotMatch(source, /bubbleGrace|var grace = null/,
    '每个面板各持定时器的旧写法应已移除')
})

// ---------------------------------------------------------------- 结构守卫

test('tipLayer 只能被 clearTip / presentTip 清空，且容器永不参与命中', () => {
  const raw = source.match(/tipLayer\.textContent = ''/g) ?? []
  assert.equal(raw.length, 2, 'tipLayer 只允许被 clearTip / presentTip 独占清空')

  const inClear = extractFunction('clearTip')
  const inPresent = extractFunction('presentTip')
  assert.match(inClear, /tipLayer\.textContent = ''/)
  assert.match(inPresent, /tipLayer\.textContent = ''/)

  // 容器是 body 级单例：给了面积就会吃掉整页点击
  assert.match(source, /tipLayer\.style\.cssText = 'pointer-events:none;'/,
    'tipLayer 必须保持零命中面积')
})

test('三类面板都用 presentTip 挂载，归属各不相同', () => {
  assert.match(source, /presentTip\(chipLayer, el\)/, '输入框旁胶囊面板')
  assert.match(source, /presentTip\(tag, el\)/, '气泡标签面板')
  assert.match(source, /presentTip\(chip, el\)/, '回复芯片面板')
})

test('删除待发送批注时只重建胶囊自己的面板', () => {
  assert.match(source, /if \(tipOwner === chipLayer\) showChipTip\(\)/)
})

test('模块标识与包名一致（否则 client-modules 拒绝注册）', () => {
  const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))
  assert.equal(pkg.name, '@ryuu-64/dsh-annotation')
  assert.match(source, new RegExp(`id: '${pkg.name.replace(/[/@]/g, (c) => '\\' + c)}'`),
    'ModuleLoader id 必须等于 package.json 的 name')
  assert.match(source, new RegExp(`exports\\.name = '${pkg.name.replace(/[/@]/g, (c) => '\\' + c)}'`))
})

// ------------------------------------------------- 组合：真实事件时序

test('组合：hover 标签 → 宿主高频 updateChip → 鼠标移向面板 → 共存的 A/B 面板', () => {
  // 用真实的 pointerWithinTip（useRealPointer），几何与指针坐标都自己喂
  const { env, tipLayer, tick, pendingTimers } = makeEnv({ useRealPointer: true })

  const trigger = {
    left: 100, right: 200, top: 300, bottom: 318,
    getBoundingClientRect() { return this },
  }
  const chipLayer = makeStubNode()   // 输入框旁的胶囊（无待发送批注）

  // 面板几何：与触发元素相距 6px（真实定位就是 r.bottom + 6）
  const panelGeom = { nodeType: 1, rect: { left: 100, right: 420, top: 324, bottom: 400 },
    getBoundingClientRect() { return this.rect } }
  const panelGeom2 = { nodeType: 1, rect: { left: 100, right: 420, top: 500, bottom: 560 },
    getBoundingClientRect() { return this.rect } }

  // ① 指针在触发元素上 → hover 弹出标签面板
  env.onTipPointerMove({ clientX: 150, clientY: 310 })
  env.presentTip(trigger, panelGeom)
  assert.equal(tipLayer.childNodes.length, 1, '① 面板应已显示')
  assert.equal(env.tipOwner, trigger)

  // ② 宿主 layout mutation（scroll / resize / MutationObserver）连打好几次
  //    —— 这正是线上「刚 hover 就没」的现场
  for (let i = 0; i < 5; i++) env.clearTip(chipLayer)
  assert.equal(tipLayer.childNodes.length, 1, '② 宿主高频清理后，标签面板必须还在')

  // ③ 鼠标离开触发元素、落进 6px 间隙 → 排一个 250ms 关闭
  env.onTipPointerMove({ clientX: 150, clientY: 321 })
  env.scheduleHide(trigger)
  assert.equal(pendingTimers(), 1)

  // ④ 停在间隙里把 250ms 走满 —— 上游在这里就没了
  tick(300)
  assert.equal(tipLayer.childNodes.length, 1, '④ 指针仍在间隙内，面板不该消失')

  // ⑤ 指针进入面板本体，再走满一次宽限
  env.onTipPointerMove({ clientX: 260, clientY: 360 })
  env.scheduleHide(trigger)
  tick(300)
  assert.equal(tipLayer.childNodes.length, 1, '⑤ 指针在面板上，面板必须保持')

  // ⑥ 快速从 A 触发元素滑到 B：B 显示后，A 遗留的宽限到点不得误杀 B
  env.onTipPointerMove({ clientX: 500, clientY: 600 })
  env.scheduleHide(trigger)                 // A 排下关闭
  const otherChip = makeStubNode()
  env.presentTip(otherChip, panelGeom2)     // B 立即显示
  assert.equal(env.tipOwner, otherChip)
  tick(300)                                  // A 的定时器到点
  assert.equal(tipLayer.childNodes.length, 1, '⑥ B 的面板不该被 A 的定时器清掉')
  assert.equal(env.tipOwner, otherChip, '⑥ 归属必须仍是 B')

  // ⑦ 指针真正离开两者 → 面板最终仍会关闭（别修成永不关闭）
  env.onTipPointerMove({ clientX: 900, clientY: 900 })
  env.scheduleHide(otherChip)
  tick(300)
  assert.equal(tipLayer.childNodes.length, 0, '⑦ 指针远离后应正常关闭')
  assert.equal(env.tipOwner, null)
})
