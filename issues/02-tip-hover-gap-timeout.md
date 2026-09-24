# [Bug] 悬停面板跨「触发元素 → 面板」的 6px 间隙全靠 250ms 赌运气，慢一点就消失

## 环境

- 插件：`@changfenhuang/dsh-annotation` **1.4.10**（`1.4.11-preview.1` 同样受影响）
- 宿主：DSH Desktop（兼容模式窗口）/ 内核 0.1.5-rc.2 / Windows 11
- 本 fork `@ryuu-64/dsh-annotation` 已修复

## 现象

面板能正常弹出（在 #1 修好之后），但要把鼠标移进面板里去点「删除」按钮（输入框旁
胶囊面板带逐条删除）时，**手指稍慢面板就没了**，很难点中。静止 hover 不动没事，
一旦开始朝面板移动就容易被判为「已离开」。

## 根因

面板与触发元素之间留了 **6px 间隙**，而关闭只由一个**固定 250ms 宽限**兜着：

```js
// client.js 1.4.10 第 1683-1700 行
var hoverGrace = null
function scheduleHide() {
  if (hoverGrace !== null) clearTimeout(hoverGrace)
  hoverGrace = setTimeout(function () {
    hoverGrace = null
    tipLayer.textContent = ''
  }, 250)
}
```

三类面板的定位都从触发元素下方 6px 开始（第 1946 / 1748 / 2124 行附近）：

```js
var top = r2.bottom + 6
if (top + h2 > window.innerHeight - 8) top = r2.top - h2 - 6
```

于是鼠标从触发元素移向面板时，必然先触发触发元素的 `mouseleave`，进入「谁都不在」
的空档。**唯一**阻止关闭的就是那 250ms：

- 手慢 / 系统卡顿 / 用触摸板细调 → 超时，面板消失；
- 面板被放到上方时（`top < 8` 的分支），两者之间还隔着触发元素自身的高度，间隙更大。

此外容器 `tipLayer` 是**裸 div，没有任何 CSS**：没有尺寸、没有 `pointer-events`，
所以「把容器做大一点」这条常规修法并不成立——它的命中区只剩下 `position:fixed`
的子元素本身，把容器撑大又会让它吃掉整页点击。

## 修复

不再赌时间，改成**确定性判定**：宽限到点时复查**实时**指针位置，只要指针还在
「触发元素 + 面板 + 间隙容差（10px）」的并集内就不关闭。

```js
var TIP_GAP_TOLERANCE = 10
var livePointerX = null
var livePointerY = null
function onTipPointerMove(e) { livePointerX = e.clientX; livePointerY = e.clientY }
document.addEventListener('pointermove', onTipPointerMove, true)

function pointerWithinTip() {
  if (livePointerX === null || livePointerY === null) return false
  var boxes = []
  if (tipOwner !== null) boxes.push(tipOwner.getBoundingClientRect())
  for (var i = 0; i < tipLayer.childNodes.length; i++) { /* 面板自身 */ }
  // 任一盒子（含容差）包含指针 → true
}
```

### 关键细节：必须用实时坐标

`mouseleave` 事件的 `clientX/clientY` 是**离开那一刻**的位置；250ms 后再拿它判断，
读到的是过期坐标，等于没判。所以用 `pointermove`（capture 阶段）持续跟踪实时位置。

## 验证

`test/hover-tip.test.mjs`：

- `[B] 指针仍在触发元素/面板/间隙容差内时不关闭（而非只赌 250ms）`
- `[B] pointerWithinTip 用实时指针坐标，且覆盖触发元素、面板与容差`——对真实的
  `pointerWithinTip` 喂 6px 间隙 / 面板内 / 触发元素上 / 远离 / 横向离开 五组坐标
- `[B] 指针坐标来自 pointermove 实时跟踪，而不是 mouseleave 的过期坐标`
