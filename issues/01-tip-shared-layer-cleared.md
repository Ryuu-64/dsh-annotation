# [Bug] 悬停已发送消息上的「批注 ×N」/`Annotation N` 面板，只闪一下就消失

## 环境

- 插件：`@changfenhuang/dsh-annotation` **1.4.10**（npm `latest`；`1.4.11-preview.1` 同样受影响）
- 宿主：DSH Desktop（兼容模式窗口）/ 内核 0.1.5-rc.2 / Windows 11
- 本 fork `@ryuu-64/dsh-annotation` 已修复（见「修复」一节）

## 现象

把鼠标移到**已经发送出去的**用户消息上的「批注 ×1」标签（或助手回复里的
`Annotation N` 芯片）上：

- 面板出现 → **立刻消失**，来不及看清内容；
- 内容越多、宿主 DOM 越活跃（回复还在流式输出、鼠标任何滚动/窗口尺寸变化），
  越容易被抹掉；
- 输入框旁那颗「N 条批注」胶囊**不受影响**——因为它展示的是「待发送批注」，
  走的是另一条分支。

## 复现（100%）

1. 在会话里对助手回复加一条批注，回车发送（此时「批注 ×1」标签贴到用户气泡上）；
2. 把鼠标移到该标签上；
3. 面板闪一下就没了。

最容易命中的变体：发送后**不要动**，直接 hover；或让会话处于仍在输出/滚动的状态。

## 根因

三类悬浮面板（输入框旁胶囊 / 气泡标签 / 回复芯片）**共享同一个单例容器**
`tipLayer`，而插件自己有一条高频的**无归属清空**路径。

`client.js`（1.4.10）第 1644–1646 行，容器只是一个裸 div：

```js
var tipLayer = document.createElement('div')
tipLayer.setAttribute('data-annotation-tip-layer', '')
document.body.appendChild(tipLayer)
```

第 1652–1657 行，`updateChip()` 在「无待发送批注」分支里**无条件**清空它：

```js
function updateChip() {
  if (ui.quotes.length === 0) {
    chipLayer.style.display = 'none'
    tipLayer.textContent = ''   // ← 与 hover 无关，照清不误
    return
  }
```

而 `ui.quotes` 是**待发送**批注集：hover 的是**已发送**消息上的标签，它必然是空的。

`updateChip()` 又被 `onLayoutChange()`（第 1029–1035 行）无条件调用，而
`onLayoutChange` 有三个**不需要用户操作**的触发源：

| 触发源 | 位置 | 说明 |
| --- | --- | --- |
| `window.addEventListener('scroll', onLayoutChange, true)` | 第 1069 行 | capture 阶段，任何容器滚动都触发 |
| `window.addEventListener('resize', onLayoutChange)` | 第 1070 行 | 窗口尺寸变化 |
| `MutationObserver(document.body, {childList, subtree, characterData, attributes})` | 第 1109 行 → 第 1088 行 | `mutationRelevant()`（第 1072–1085 行）只排除插件自己的节点，**其它任何 DOM 变化都算相关** |

也就是说：回复在流式输出、或宿主任何一次 class/style 重绘，都会走到
`updateChip()` → 把用户正在看的面板清空。

同一族问题还有两处无条件清空：语言切换（第 2191 行）与会话切换（第 2219 行）。

## 修复

给共享容器加**归属**：任何清空都必须指名归属元素。

```js
var tipOwner = null
function clearTip(owner) {
  if (owner !== undefined && tipOwner !== owner) return   // 不是自己的面板，不动
  tipLayer.textContent = ''
  tipOwner = null
}
function presentTip(owner, el) {
  tipLayer.textContent = ''
  tipLayer.appendChild(el)
  tipOwner = owner
}
```

调用点相应改为：

- `updateChip()` 的清空分支 → `clearTip(chipLayer)`（只能清胶囊自己的面板）
- 悬停宽限到点 → `clearTip(owner)`
- 三类面板挂载 → `presentTip(chipLayer|tag|chip, el)`
- 语言/会话切换 → `clearTip()`（显式场景，允许无归属清空）

## 上游状态

同一根因已由上游 PR 独立报告：[omdsh-dev/dsh-annotation#65](https://github.com/omdsh-dev/dsh-annotation/pull/65)
「修复芯片内容显示时会直接消失的问题」（**截至本 issue 仍 open / 未合并**，且
`1.4.11-preview.1` 的 tarball 中该写法依旧存在，无修复版本可升）。

本 fork 采用同一思路落地，并额外修掉同族的三个缺陷（见 #2 / #3 / #4）。

## 验证

`test/hover-tip.test.mjs`：

- `[A] 正在观看的面板上，宿主 layout mutation 触发的 updateChip 不会抹掉它`
- `[A] 归属方可清掉自己的面板；无归属调用清掉任何面板`
- `tipLayer 只能被 clearTip / presentTip 清空`

用例把 `client.js` 里真实的 `tipOwner` / `clearTip` / `presentTip` 抽到 Node vm
沙箱里按行为跑，不是纯文本断言。
