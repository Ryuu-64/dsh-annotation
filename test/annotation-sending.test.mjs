// 功能：批注随消息发送，以及已发送气泡里的批注块处理。
// 对应上游能力表中的「回车随消息发送」与「气泡隐藏批注块」两项。
//
// 命名沿用上游测试的风格：用一句话说明这个功能应当表现出什么，不出现内部函数名。

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

// 协议文案表（STR）与处理草稿、气泡所需的函数：直接取真实源码片段，
// 与上游 message-block 测试同一套做法，避免把逻辑抄进测试里。
const protocol = source.slice(source.indexOf('    var STR = {'), source.indexOf('    // ============================== 工具'))

function fn(name) {
  // 按函数自身的缩进推导收尾行：有的函数在模块级（4 空格），有的在 apply() 内（6 空格）。
  const match = new RegExp(`^(\\s*)function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\1\\}`, 'm').exec(source)
  assert.ok(match, `client.js 中应当存在 ${name}()`)
  return match[0]
}

/** 造一个最小宿主：可读写的草稿、可渲染的气泡、以及一条待发送批注。 */
function harness(lang, draft, note = '解释一下') {
  const nodes = []
  const bubble = {
    querySelectorAll: () => [],
    get textContent() { return nodes.map((n) => n.nodeValue).join('') },
  }
  const row = { querySelector: () => bubble }
  const shell = {
    state: { getSnapshot: () => ({ draft }) },
    setDraft(value) { draft = value },
  }
  const document = {
    createTreeWalker: () => { let i = 0; return { nextNode: () => nodes[i++] ?? null } },
  }
  const api = Function('shell', 'document', 'NodeFilter', `
    ${protocol}
    // quoteWithSource 是 var 函数表达式，不在下面按名字抽取的 function 声明里，单独注入。
    ${source.slice(source.indexOf('    function quoteWithSource('), source.indexOf('    function assistantRows('))}
    var ui = { quotes: [{ text: '原文包含提问：这个词', note: ${JSON.stringify(note)} }] }
    var annotationAttached = false
    var sessions = { list: { getSnapshot: () => ({ current: 'session' }) }, scope: () => ({}) }
    var ctx = { conversation: { input: { for: () => shell } } }
    function showToast() {}
    function currentSessionId() { return 'session' }
    ${['buildBlock', 'shouldAttachForEnter', 'isCommandDraft', 'attachAndSend', 'hideAnnotationBlock', 'parseItemsFromBubble', 'hasAnnotationBlock'].map(fn).join('\n')}
    return { setLang, attachAndSend, hideAnnotationBlock, parseItemsFromBubble, hasAnnotationBlock }
  `)(shell, document, { SHOW_TEXT: 4 })
  api.setLang(lang)
  return {
    api, row, bubble, shell,
    /** 模拟宿主把消息渲染进气泡（宿主可能把正文拆成多个文本节点）。 */
    render(value) {
      nodes.length = 0
      for (const text of [value.slice(0, 10), value.slice(10)]) {
        nodes.push({ nodeValue: text, parentNode: { removeChild(node) { node.nodeValue = '' } } })
      }
    },
  }
}

for (const lang of ['zh', 'en']) {
  test(`${lang}：回车发送时，批注内容一并写进待发送的草稿`, () => {
    const h = harness(lang, '')
    assert.equal(h.api.attachAndSend({}), true, '应当成功拼入批注')
    const sent = h.shell.state.getSnapshot().draft
    assert.match(sent, /Annotation/, '草稿中应当出现批注编号标记')
    assert.match(sent, /原文包含提问：这个词/, '草稿中应当带上被批注的原文')
  })

  test(`${lang}：草稿里已有文字时，批注写在前面且不覆盖原文字`, () => {
    const h = harness(lang, '我的问题\n第二行')
    h.api.attachAndSend({})
    const sent = h.shell.state.getSnapshot().draft
    assert.ok(sent.includes('我的问题\n第二行'), '用户已输入的文字必须保留')
    const marker = lang === 'zh' ? '提问：' : 'Ask:'
    assert.ok(sent.endsWith(`${marker}\n我的问题\n第二行`), '批注块应拼在正文之前，并保留分隔标记')
  })

  test(`${lang}：重复触发发送不会把批注重复拼进草稿`, () => {
    const h = harness(lang, '问题')
    assert.equal(h.api.attachAndSend({}), true)
    const once = h.shell.state.getSnapshot().draft
    assert.equal(h.api.attachAndSend({}), true)
    assert.equal(h.shell.state.getSnapshot().draft, once, '第二次应当是空操作')
  })

  test(`${lang}：已发送的气泡里隐藏批注块，只留下用户自己写的内容`, () => {
    const h = harness(lang, '我的问题')
    h.api.attachAndSend({})
    h.render(h.shell.state.getSnapshot().draft)
    assert.equal(h.api.hideAnnotationBlock(h.row), true, '应当识别并隐藏批注块')
    assert.equal(h.bubble.textContent, '我的问题')
  })

  test(`${lang}：刷新后重新渲染的历史消息，仍能识别出批注条目`, () => {
    const h = harness(lang, '')
    h.api.attachAndSend({})
    h.render(h.shell.state.getSnapshot().draft)
    assert.deepEqual(h.api.parseItemsFromBubble(h.row),
      [{ text: '原文包含提问：这个词', note: '解释一下' }])
  })

  test(`${lang}：消息还没渲染完整时，不误判为「没有批注块」而清空气泡`, () => {
    const h = harness(lang, '我的问题')
    h.api.attachAndSend({})
    h.render(lang === 'zh' ? '我批注了以下 1 处内容' : 'I annotated the following 1 passage')
    assert.equal(h.api.hideAnnotationBlock(h.row), false, '内容不完整时应当返回未处理')
    assert.notEqual(h.bubble.textContent, '', '不得清空气泡内容')
  })
}

test('批注内容留空时，仍然随消息发送（仅标记原文）', () => {
  const h = harness('zh', '', '')
  assert.equal(h.api.attachAndSend({}), true)
  const sent = h.shell.state.getSnapshot().draft
  assert.match(sent, /原文包含提问：这个词/)
  assert.doesNotMatch(sent, /批注：\s*\n\s*\n/, '留空时不应输出空的批注行')
})
