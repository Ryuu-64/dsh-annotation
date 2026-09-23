// 离线端到端：在 jsdom 里装载**真实的 client.js**，用真实 DOM 事件跑悬停链路。
//
// 与 hover-tip.test.mjs 的区别：那边把 tipOwner/clearTip/scheduleHide 等函数抽出来
// 单测；这边不抽任何东西，走 ModuleLoader → factory → apply(ctx) 的完整装载路径，
// 用真实的 mouseenter/mouseleave/pointermove 事件与真实的 MutationObserver。
// 因此它能覆盖单测覆盖不到的部分：监听器是否真的挂在正确的节点上、宿主 DOM 变化
// 是否真的会触发 updateChip、面板最终是否真的留在 DOM 里。
//
// 运行：npm run test:dom

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'
import { JSDOM } from 'jsdom'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

/** 造一个够插件启动的假宿主 + 真实 DOM。返回 fake clock 以便推进 1s 轮询。 */
async function boot() {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'http://127.0.0.1/',
    pretendToBeVisual: true,   // 提供 requestAnimationFrame
  })
  const { window } = dom

  // ---- 可控时钟 ----
  // 插件有 1s 兜底轮询（kickDecorate）、500ms 限流，以及最关键的 onLayoutChange：
  // 它把 updateChip() 放进 requestAnimationFrame 里。三者都必须并入同一个假时钟，
  // 否则「宿主变化 → updateChip → 面板被清」这条链路永远不会执行，用例会假绿
  // （踩过：只接管 setTimeout/setInterval 时，上游代码也能"通过"这条复现用例）。
  let now = 0
  let seq = 0
  const timers = new Map()
  const rafs = new Map()
  window.setTimeout = (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: now + (ms || 0) }); return id }
  window.clearTimeout = (id) => { timers.delete(id) }
  window.setInterval = (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: now + (ms || 0), every: ms || 1 }); return id }
  window.clearInterval = (id) => { timers.delete(id) }
  window.requestAnimationFrame = (fn) => { const id = ++seq; rafs.set(id, { fn, at: now + 16 }); return id }
  window.cancelAnimationFrame = (id) => { rafs.delete(id) }
  window.performance.now = () => now
  // 宿主的 ResizeObserver：jsdom 没有，装个空的（插件会构造它观察 composer 卡片）
  if (window.ResizeObserver === undefined) {
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  }

  function tick(ms) {
    now += ms
    for (const [id, t] of [...rafs]) {
      if (t.at > now) continue
      rafs.delete(id)
      try { t.fn(now) } catch (err) { console.warn('[test] rAF 回调抛错：', err.message) }
    }
    for (const [id, t] of [...timers]) {
      if (t.at > now) continue
      if (t.every === undefined) timers.delete(id)
      else t.at = now + t.every
      try { t.fn() } catch (err) { console.warn('[test] 定时器回调抛错：', err.message) }
    }
  }
  const settle = () => new Promise((r) => queueMicrotask(r))

  // jsdom 不做布局：所有 rect 都是 0，pointerWithinTip 的判定会失真（面板读作
  // (0,0,0,0) 时指针只可能落在触发元素盒子里）。所以按元素类型喂几何：
  // 触发元素与面板各有真实矩形，且两者之间留出真实间隙，才能测出「跨间隙保活」。
  const RECTS = {
    row: { left: 100, right: 400, top: 300, bottom: 320, width: 300, height: 20, x: 100, y: 300 },
    tag: { left: 100, right: 200, top: 322, bottom: 340, width: 100, height: 18, x: 100, y: 322 },
    chip: { left: 120, right: 240, top: 322, bottom: 340, width: 120, height: 18, x: 120, y: 322 },
  }
  const zero = { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }
  window.Element.prototype.getBoundingClientRect = function () {
    const key = this.getAttribute?.('data-testrect')
    return key !== undefined && key !== null && RECTS[key] !== undefined ? RECTS[key] : zero
  }
  // jsdom 里 offsetHeight 是只读 getter，用 defineProperty 覆盖
  Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', {
    configurable: true, get() { return 40 },
  })

  // ---- 假 cordis 服务 ----
  const subscribers = []
  const inputState = { draft: '' }
  const scoped = {
    state: {
      getSnapshot: () => inputState,
      subscribe: () => () => {},
    },
  }
  const ctx = {
    sessions: {
      list: {
        getSnapshot: () => ({ current: 'session-a', ids: ['session-a'], byId: {}, phase: 'ready' }),
        subscribe: (fn) => { subscribers.push(fn); return () => {} },
      },
      scope: () => scoped,
    },
    conversation: { input: { for: () => scoped } },
    locale: { getSnapshot: () => ({ active: 'zh' }), subscribe: () => () => {} },
  }

  // ---- ModuleLoader 垫片：走真实装载路径 ----
  // 注意不能用 window.eval()：jsdom 的 window.eval 不在 jsdom realm 里执行，
  // 里面拿不到 window（实测 typeof window === 'undefined'）。改用 vm + jsdom window 作上下文。
  let factory = null
  window.__ModuleLoader__ = {
    load({ id, factory: f }) { factory = f; return { id } },
    create() { throw new Error('not used') },
  }
  vm.createContext(window)
  vm.runInContext(source, window, { filename: 'client.js' })
  assert.ok(factory !== null, 'client.js 应通过 __ModuleLoader__.load 注册 factory')

  const mod = factory((name) => { throw new Error(`未预期的 require(${name})`) })
  assert.equal(mod.name, '@ryuu-64/dsh-annotation')
  // 跨 realm 的数组原型不同，deepEqual 会误判；转成本 realm 的普通数组再比
  assert.deepEqual([...mod.inject], ['sessions', 'conversation', 'locale'])

  const dispose = mod.apply(ctx)
  await settle()

  // 把指针放到标签矩形中心（150, 331）：后续断言若被 250ms 宽限关掉面板，
  // 就分不清「宿主清掉的」还是「宽限关掉的」——所以悬停期间必须让指针留在触发元素上。
  const pointerAtTag = () => {
    window.document.dispatchEvent(new window.MouseEvent('pointermove', {
      bubbles: true, clientX: (RECTS.tag.left + RECTS.tag.right) / 2, clientY: (RECTS.tag.top + RECTS.tag.bottom) / 2,
    }))
  }

  const tipLayer = window.document.querySelector('[data-annotation-tip-layer]')
  const chipLayer = window.document.querySelector('[data-annotation-chip]')
  return { window, dom, tipLayer, chipLayer, dispose, inputState, subscribers, tick, settle, pointerAtTag }
}

/** 造一条「已发送且带批注」的用户消息行，然后让装饰轮询给它贴标签。 */
async function seedAnnotatedUserRow(window, settle) {
  const flow = window.document.createElement('div')
  flow.setAttribute('data-chat-flow-kind', 'user-step')
  const row = window.document.createElement('div')
  row.setAttribute('data-time-hover-root', '')
  row.setAttribute('data-testrect', 'row')
  const bubble = window.document.createElement('div')
  bubble.className = 'bubble'
  bubble.setAttribute('data-message-text', '')
  bubble.appendChild(window.document.createTextNode(
    '我批注了以下 1 处内容\n\n1. 原文片段\n   批注：这是批注内容\n\n请用「Annotation 1：…」逐条回应\n\n提问：'))
  row.appendChild(bubble)
  flow.appendChild(row)
  window.document.body.appendChild(flow)

  // 装饰走 MutationObserver（微任务阶段）+ 1s 兜底轮询
  await settle()
  // 给贴出来的标签喂真实几何，供 pointerWithinTip 判定
  const tag = bubble.querySelector('[data-annotation-bubble-tag]')
  if (tag !== null) tag.setAttribute('data-testrect', 'tag')
  return { flow, row, bubble, tag }
}

/**
 * 造一条助手回复行，内含「Annotation 1：」→ 装饰后应变成可悬浮芯片。
 * 芯片内容取自最近一条带批注标签的用户消息（findPrevAnnotationItems）。
 */
async function seedAssistantChipRow(window, settle) {
  const flow = window.document.createElement('div')
  flow.setAttribute('data-chat-flow-kind', 'assistant-step')
  const row = window.document.createElement('div')
  row.className = 'somehash_assistant'
  row.appendChild(window.document.createTextNode('Annotation 1：这里是对该批注的回应。'))
  flow.appendChild(row)
  window.document.body.appendChild(flow)

  await settle()
  const chip = row.querySelector('[data-annotation-reply-chip]')
  if (chip !== null) chip.setAttribute('data-testrect', 'chip')
  return { flow, row, chip }
}

function panelCount(tipLayer) {
  return tipLayer.childNodes.length
}

test('[e2e] 真实 bundle 能装载，并挂出面板容器', async (t) => {
  const { tipLayer, chipLayer, dispose } = await boot()
  t.after(() => { if (typeof dispose === 'function') dispose() })
  assert.ok(tipLayer !== null, 'tipLayer 应挂载')
  assert.ok(chipLayer !== null, 'chipLayer 应挂载')
  // 容器必须零命中面积，否则会吃掉整页点击
  assert.match(tipLayer.style.cssText, /pointer-events:\s*none/)
  assert.equal(tipLayer.style.inset, '', 'tipLayer 不得被撑成整屏命中层')
})

test('[e2e] 真实 hover：面板显示后，宿主 DOM 高频变化不会抹掉它', async (t) => {
  const { window, tipLayer, dispose, settle, tick, pointerAtTag } = await boot()
  t.after(() => { if (typeof dispose === 'function') dispose() })
  const { bubble } = await seedAnnotatedUserRow(window, settle)

  const tag = bubble.querySelector('[data-annotation-bubble-tag]')
  assert.ok(tag !== null, '气泡上应贴出「批注 ×N」标签')

  // —— 真实悬停（指针停在标签上，避免 250ms 宽限把它关掉而掩盖结论）——
  pointerAtTag()
  tag.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: false }))
  assert.equal(panelCount(tipLayer), 1, 'hover 后应显示 1 个面板')

  // 宿主侧高频 DOM 变化（线上就是它把面板清掉的）：改一个与插件无关的节点的
  // 属性/文本 → 经 body 级 MutationObserver → onLayoutChange → updateChip。
  //
  // 注意：每轮都要真实推进时钟并让出微任务。若像早期版本那样只 await 微任务、
  // 完全不推进时钟，插件的 1s 轮询永不执行，上游代码也会「通过」这条用例 ——
  // 那是假绿，会让整条证据链失效（这个坑真踩过）。
  const noise = window.document.createElement('div')
  window.document.body.appendChild(noise)
  for (let i = 0; i < 20; i++) {
    noise.setAttribute('data-noise', String(i))
    noise.textContent = `noise ${i}`
    await settle()
    tick(40)              // 累计 800ms，跨过插件的多轮内部节流/轮询
    await settle()
  }
  assert.equal(panelCount(tipLayer), 1, '宿主高频变化后面板必须还在')

  // 面板内容应包含批注正文
  assert.match(tipLayer.textContent, /批注内容|原文片段/, '面板应展示批注内容')
})

test('[e2e] 真实 mouseleave + 指针在触发元素/间隙上：走满宽限也不关闭', async (t) => {
  const { window, tipLayer, dispose, settle, tick } = await boot()
  t.after(() => { if (typeof dispose === 'function') dispose() })
  const { tag } = await seedAnnotatedUserRow(window, settle)
  assert.ok(tag !== null, '气泡上应贴出「批注 ×N」标签')

  tag.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: false }))
  assert.equal(panelCount(tipLayer), 1, 'hover 后应显示 1 个面板')

  // ① 指针停在标签矩形内（100..200 × 322..340）→ mouseleave 后不该关闭
  window.document.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 150, clientY: 330 }))
  tag.dispatchEvent(new window.MouseEvent('mouseleave', { bubbles: false }))
  tick(350)   // 走满 250ms 宽限
  assert.equal(panelCount(tipLayer), 1, '指针还在标签上，面板不该消失')

  // ② 指针落到标签与面板之间的间隙（y=341，容差 10 内）→ 仍不该关闭
  window.document.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 150, clientY: 341 }))
  tag.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: false }))
  tag.dispatchEvent(new window.MouseEvent('mouseleave', { bubbles: false }))
  tick(350)
  assert.equal(panelCount(tipLayer), 1, '指针还在间隙容差内，面板不该消失')

  // ③ 指针真正远离 → 应正常关闭（不能修成永不关闭）
  window.document.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 2000, clientY: 2000 }))
  tag.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: false }))
  tag.dispatchEvent(new window.MouseEvent('mouseleave', { bubbles: false }))
  tick(350)
  assert.equal(panelCount(tipLayer), 0, '指针远离后应正常关闭（不能修成永不关闭）')
})

test('[e2e] 回复里的 Annotation 芯片：hover 显示内容，宿主变化不抹掉', async (t) => {
  const { window, tipLayer, dispose, settle, tick } = await boot()
  t.after(() => { if (typeof dispose === 'function') dispose() })

  // 芯片内容取自「最近一条带批注标签的用户消息」，所以先造那条用户消息
  const { tag } = await seedAnnotatedUserRow(window, settle)
  assert.ok(tag !== null, '前置条件：用户气泡上应有批注标签')

  // 再造助手回复行；「Annotation 1：」应在装饰后变成芯片
  const { chip } = await seedAssistantChipRow(window, settle)
  assert.ok(chip !== null, '回复里的「Annotation 1：」应被替换成可悬浮芯片')

  // —— 真实悬停（这正是截图上那条路径）——
  chip.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: false }))
  assert.equal(panelCount(tipLayer), 1, 'chip hover 后应显示面板')
  assert.match(tipLayer.textContent, /原文片段|批注内容/, 'chip 面板应带出被批注的原文/批注')

  // 宿主高频变化 + 走满宽限（指针停在 chip 矩形内 120..240 × 322..340）
  window.document.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 180, clientY: 330 }))
  chip.dispatchEvent(new window.MouseEvent('mouseleave', { bubbles: false }))
  tick(350)
  assert.equal(panelCount(tipLayer), 1, 'chip 面板不该被宿主变化或宽限抹掉')

  const noise = window.document.createElement('div')
  window.document.body.appendChild(noise)
  for (let i = 0; i < 10; i++) {
    noise.setAttribute('data-noise', String(i))
    noise.textContent = `noise ${i}`
    await settle()
  }
  assert.equal(panelCount(tipLayer), 1, '宿主高频变化后 chip 面板必须还在')
})
