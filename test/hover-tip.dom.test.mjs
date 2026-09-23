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

/** 造一个够插件启动的假宿主 + 真实 DOM。 */
async function boot() {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'http://127.0.0.1/',
    pretendToBeVisual: true,   // 提供 requestAnimationFrame
  })
  const { window } = dom

  // jsdom 不做布局：所有 rect 都是 0，pointerWithinTip 的判定会失真（面板读作
  // (0,0,0,0) 时指针只可能落在触发元素盒子里）。所以按元素类型喂几何：
  // 触发元素与面板各有真实矩形，且两者之间留出真实间隙，才能测出「跨间隙保活」。
  const RECTS = {
    row: { left: 100, right: 400, top: 300, bottom: 320, width: 300, height: 20, x: 100, y: 300 },
    tag: { left: 100, right: 200, top: 322, bottom: 340, width: 100, height: 18, x: 100, y: 322 },
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
  await new Promise((r) => window.setTimeout(r, 0))

  const tipLayer = window.document.querySelector('[data-annotation-tip-layer]')
  const chipLayer = window.document.querySelector('[data-annotation-chip]')
  return { window, dom, tipLayer, chipLayer, dispose, inputState, subscribers }
}

/** 造一条「已发送且带批注」的用户消息行，然后让装饰轮询给它贴标签。 */
async function seedAnnotatedUserRow(window) {
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

  // 装饰走 MutationObserver（微任务阶段）+ 1s 兜底轮询，这里等两拍
  await new Promise((r) => window.setTimeout(r, 30))
  // 给贴出来的标签喂真实几何，供 pointerWithinTip 判定
  const tag = bubble.querySelector('[data-annotation-bubble-tag]')
  if (tag !== null) tag.setAttribute('data-testrect', 'tag')
  return { flow, row, bubble, tag }
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
  const { window, tipLayer, dispose } = await boot()
  t.after(() => { if (typeof dispose === 'function') dispose() })
  const { bubble } = await seedAnnotatedUserRow(window)

  const tag = bubble.querySelector('[data-annotation-bubble-tag]')
  assert.ok(tag !== null, '气泡上应贴出「批注 ×N」标签')

  // —— 真实悬停 ——
  tag.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: false }))
  assert.equal(panelCount(tipLayer), 1, 'hover 后应显示 1 个面板')

  // 宿主侧高频 DOM 变化（线上就是它把面板清掉的）：
  // 每次都改一个与插件无关的节点的属性/文本 → 触发 body 级 MutationObserver
  const noise = window.document.createElement('div')
  window.document.body.appendChild(noise)
  for (let i = 0; i < 20; i++) {
    noise.setAttribute('data-noise', String(i))
    noise.textContent = `noise ${i}`
    await new Promise((r) => window.setTimeout(r, 0))
  }
  assert.equal(panelCount(tipLayer), 1, '宿主高频变化后面板必须还在')

  // 面板内容应包含批注正文
  assert.match(tipLayer.textContent, /批注内容|原文片段/, '面板应展示批注内容')
})

test('[e2e] 真实 mouseleave + 指针在触发元素/间隙上：走满宽限也不关闭', async (t) => {
  const { window, tipLayer, dispose } = await boot()
  t.after(() => { if (typeof dispose === 'function') dispose() })
  const { tag } = await seedAnnotatedUserRow(window)
  assert.ok(tag !== null, '气泡上应贴出「批注 ×N」标签')

  tag.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: false }))
  assert.equal(panelCount(tipLayer), 1, 'hover 后应显示 1 个面板')

  // ① 指针停在标签矩形内（100..200 × 322..340）→ mouseleave 后不该关闭
  window.document.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 150, clientY: 330 }))
  tag.dispatchEvent(new window.MouseEvent('mouseleave', { bubbles: false }))
  await new Promise((r) => window.setTimeout(r, 350))   // 走满 250ms 宽限
  assert.equal(panelCount(tipLayer), 1, '指针还在标签上，面板不该消失')

  // ② 指针落到标签与面板之间的间隙（y=341，容差 10 内）→ 仍不该关闭
  window.document.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 150, clientY: 341 }))
  tag.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: false }))
  tag.dispatchEvent(new window.MouseEvent('mouseleave', { bubbles: false }))
  await new Promise((r) => window.setTimeout(r, 350))
  assert.equal(panelCount(tipLayer), 1, '指针还在间隙容差内，面板不该消失')

  // ③ 指针真正远离 → 应正常关闭（不能修成永不关闭）
  window.document.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 2000, clientY: 2000 }))
  tag.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: false }))
  tag.dispatchEvent(new window.MouseEvent('mouseleave', { bubbles: false }))
  await new Promise((r) => window.setTimeout(r, 350))
  assert.equal(panelCount(tipLayer), 0, '指针远离后应正常关闭（不能修成永不关闭）')
})
