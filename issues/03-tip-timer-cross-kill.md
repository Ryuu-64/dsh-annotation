# [Bug] 每个面板各持一个宽限定时器却清同一个共享容器：A 的定时器会误杀 B 刚显示的面板

## 环境

- 插件：`@changfenhuang/dsh-annotation` **1.4.10**（`1.4.11-preview.1` 同样受影响）
- 宿主：DSH Desktop（兼容模式窗口）/ 内核 0.1.5-rc.2 / Windows 11
- 本 fork `@ryuu-64/dsh-annotation` 已修复

## 现象

鼠标从一个悬浮触发元素**快速滑到另一个**（例如从用户气泡上的「批注 ×1」标签滑到
助手回复里的 `Annotation 1` 芯片），第二个面板刚弹出来就消失——消失的时机正好是
第一个面板遗留的 250ms 到点。

上游 PR #65 也独立提到了这一条（「250ms 延迟 hide 会误杀另一个芯片刚显示的面板」）。

## 根因

三类面板各自持有**独立的**定时器变量，但清空的都是**同一个** `tipLayer`：

| 面板 | 位置（1.4.10） | 定时器 |
| --- | --- | --- |
| 输入框旁胶囊 | 第 1686–1693 行 | `var hoverGrace = null` |
| 气泡标签 | 第 1952–1959 行 | `var bubbleGrace = null` |
| 回复芯片 | 第 2085–2089 行 | `var grace = null` |

```js
// 气泡标签（第 1952-1959 行）
var bubbleGrace = null
function bubbleHide() {
  if (bubbleGrace !== null) clearTimeout(bubbleGrace)
  bubbleGrace = setTimeout(function () {
    bubbleGrace = null
    tipLayer.textContent = ''     // ← 无条件清共享容器：此刻显示的可能是别人的面板
  }, 250)
}
```

于是：

1. 指针离开 A → A 排一个 250ms 的关闭；
2. 指针在 250ms 内进入 B → B 挂上自己的面板（`tipLayer.textContent = ''` 后 append）；
3. A 的定时器到点 → **无条件清空** → 把 B 刚显示的面板抹掉。

三层面板各有各的定时器，谁都无法取消别人的，也没有「现在显示的是谁的面板」这一
概念——归属缺失（同 #1）在这里表现为跨面板误杀。

## 修复

两件事：

1. **共用一个计时器句柄**，并在到点时校验「自己仍是当前归属」：

```js
var hoverGrace = null
function scheduleHide(owner) {
  if (hoverGrace !== null) clearTimeout(hoverGrace)
  hoverGrace = setTimeout(function () {
    hoverGrace = null
    if (tipOwner !== owner) return        // 面板已经换代 → 静默退出，不动别人的
    if (pointerWithinTip()) return        // 见 #2
    clearTip(owner)
  }, 250)
}
function ownedHide(owner) {
  return function () { scheduleHide(owner) }
}
```

2. 三类面板统一改用 `ownedHide(自己的元素)`，删掉 `bubbleGrace` / `grace` 两套私有
   定时器：

```js
tag.addEventListener('mouseleave', ownedHide(tag))
chip.addEventListener('mouseleave', ownedHide(chip))
chipLayer.addEventListener('mouseleave', ownedHide(chipLayer))
```

## 验证

`test/hover-tip.test.mjs`：

- `[C] A 面板遗留的 hide 不会误杀 B 面板刚显示的内容`——按真实时序：A 排 hide →
  B 挂载 → 推进 300ms → 断言 B 的面板与归属都还在
- `[C] 归属方自己的 hide 到点仍然会关闭面板`——防止修成「永不关闭」
- `[C] 所有面板共用一个计时器句柄，不会各自堆积`
