# [Bug] 面板监听器无界泄漏：每次渲染都往共享 tipLayer 追加监听器

## 环境

- 插件：`@changfenhuang/dsh-annotation` **1.4.10**（`1.4.11-preview.1` 同样受影响）
- 宿主：DSH Desktop（兼容模式窗口）/ 内核 0.1.5-rc.2 / Windows 11
- 本 fork `@ryuu-64/dsh-annotation` 已修复

## 现象

长会话、消息反复重渲染（流式输出结束后重新装饰、语言切换、切会话回来）之后，悬浮
面板的关闭行为变得不可预测：有时面板一出现就被关掉，有时关不掉——因为共享容器上
挂着**多份**来自历代已销毁面板的监听器，任何一份都能触发关闭。

## 根因

面板不是「挂载一次」的对象：气泡标签由 `attachBubbleTag()` 创建、回复芯片由
`makeReplyChip()` 每次渲染时重新创建（`decorateAssistantAnnotations()` 会在芯片
被 React 重渲染抹掉后重建）。而每一代面板都在**共享容器**上追加自己的监听器，
却从不移除：

```js
// 气泡标签（1.4.10 第 1963-1965 行）
tag.addEventListener('mouseleave', bubbleHide)
tipLayer.addEventListener('mouseenter', bubbleKeep)   // ← 每代标签追加一份
tipLayer.addEventListener('mouseleave', bubbleHide)    // ← 同上

// 回复芯片（1.4.10 第 2130-2132 行）
chip.addEventListener('mouseleave', hide)
tipLayer.addEventListener('mouseenter', keep)          // ← 每代芯片追加一份
tipLayer.addEventListener('mouseleave', hide)          // ← 同上
```

`tipLayer` 是**长期存活**的 body 级单例（只在插件销毁时 `remove()`），所以这些
监听器不会随触发元素一起被垃圾回收：它们闭包持有已废弃的 `bubbleGrace` / `grace`
与被移出 DOM 的 `tag` / `chip`，**无界累积**（每次重渲染 +2 个）。

累积的后果是关闭决策不再由「当前面板」决定，而是由历史上任意一代面板的定时器决定
——这也是 #3 跨面板误杀的放大器。

## 修复

共享容器上只保留**两处固定监听器**，按当前归属分派；关闭钩子挂在触发元素自己身上
（随元素一起销毁）：

```js
// 固定两处，只认当前归属，面板换代不再新增
chipLayer.addEventListener('mouseenter', function () { cancelHide(); showChipTip() })
chipLayer.addEventListener('mouseleave', ownedHide(chipLayer))
tipLayer.addEventListener('mouseenter', cancelHide)
tipLayer.addEventListener('mouseleave', function () {
  if (tipOwner === null) return
  scheduleHide(tipOwner)
})
```

三类面板统一用 `ownedHide(自己)` 作为 `mouseleave` 钩子（见 #3）。

## 验证

`test/hover-tip.test.mjs`：

- `[D] 三类面板不再往共享 tipLayer 上追加监听器`——断言
  `tipLayer.addEventListener(` 在源码中**恰好出现 2 次**
- `[D] 气泡标签与回复芯片各有且仅有自己的 mouseleave 关闭钩子`——断言
  `ownedHide(tag)` / `ownedHide(chip)` 存在，且 `bubbleGrace` / `var grace = null`
  这两套私有定时器写法已消失
