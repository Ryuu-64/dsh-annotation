# 悬停面板验证步骤（重启后照做）

本 fork 修的是「鼠标悬停到批注上只显示一下，然后马上消失」。离线 e2e 已在真实
bundle 上复现并修复（`npm run test:all` → 19/19），但**真实页面**这一步需要你确认，
因为 GUI 只对 Electron 渲染进程开放（普通浏览器请求一律 403），我没有浏览器会话。

## 第 0 步：必须完全重启 DSH Desktop

`dsh.profile.bundles` **只在宿主启动时解析一次**，没有运行时重载。

- 只刷新页面 → 拿到的还是旧配置，**看不到本 fork**；
- 必须退出应用再打开。

判断依据：宿主进程启动时间必须晚于 profile 接线时间。接线时间是
`~/.dsh/profiles/desktop/node_modules/@ryuu-64/dsh-annotation` 这个 junction 的创建时间。

## 第 1 步：确认 fork 已上线

页面控制台执行：

```js
window.__DSH_BOOT__.entries.find(({ id }) => id === '@ryuu-64/dsh-annotation')
```

| 结果 | 含义 | 下一步 |
| --- | --- | --- |
| 返回带 `url` 的登记 | fork 已加载 | 进入第 2 步 |
| `undefined` | 宿主仍是旧配置 | 没重启成功，或 profile 接线被改回去了 |

同时确认上游包**没有**被一起加载（两者都装会让同一个 UI 出现两份）：

```js
window.__DSH_BOOT__.entries.filter(({ id }) => id.includes('annotation')).map(({ id }) => id)
// 期望：只有 '@ryuu-64/dsh-annotation'
```

## 第 2 步：悬停测试（三种面板都试）

| # | 触发元素 | 怎么造出来 | 期望 |
| --- | --- | --- | --- |
| 1 | 用户气泡上的「批注 ×N」标签 | 选助手文字 → 批注 → 回车发送 | 面板稳定显示，能看清原文与批注内容 |
| 2 | 助手回复里的 `Annotation N` 芯片 | 上一步发送后，模型按编号回应 | 同上；面板带出被批注的原文 |
| 3 | 输入框旁的「N 条批注」胶囊 | 加批注但**不发送** | 面板列出全部条目，且「删除」按钮可点中 |

每种都额外试这三个动作（它们曾经都会让面板消失）：

- **滚动鼠标滚轮**（哪怕几像素）——这是最容易命中的，宿主任何滚动都会触发清理；
- **让回复继续流式输出**时悬停；
- **从一个触发元素快速滑到另一个**（如标签 → 芯片）——第二个面板不该被第一个的
  定时器误杀。

## 第 3 步：如果仍然闪退，把这些发我

1. 实时断言（悬停时在控制台执行，看数字会不会回 0）：

   ```js
   const l = document.querySelector('[data-annotation-tip-layer]')
   setInterval(() => console.log('tipLayer 子节点数 =', l.childNodes.length), 200)
   ```

   期望：hover 期间稳定为 1，移开后变 0。若 hover 期间回落到 0，说明还有别的东西在清它。

2. **点击时立刻抓清空来源**（定位是谁清的）：

   ```js
   const l = document.querySelector('[data-annotation-tip-layer]')
   let n = l.childNodes.length
   new MutationObserver(() => {
     if (l.childNodes.length < n) console.log('被清空，调用栈：', new Error().stack)
     n = l.childNodes.length
   }).observe(l, { childList: true })
   ```

3. Console 里 `[annotation]` 开头的全部日志（`气泡已贴批注标签`、`回复批注芯片` 等）。

4. 如果第 1 步就是 `undefined`：把
   `C:\Users\Ryuu\AppData\Roaming\DSH Desktop\logs\host\` 下当天的 `.log` 发我。

## 附：为什么离线 e2e 能算证据

`test/hover-tip.dom.test.mjs` 不抽函数、不做文本断言：它把**真实的 client.js**
经 `ModuleLoader.load` → `factory` → `apply(ctx)` 完整装载进 jsdom，用真实
`mouseenter`/`mouseleave`/`pointermove` 事件与真实 `MutationObserver` 驱动，
并用可控时钟推进插件的 1s 兜底轮询。

把同一套用例指向上游 1.4.10：

```
✖ [e2e] 真实 hover：面板显示后，宿主 DOM 高频变化不会抹掉它
  AssertionError: 宿主高频变化后面板必须还在
  0 !== 1        ← 面板先显示（前一条断言通过），随后被宿主变化抹掉
```

即：在无浏览器环境下复现了你报的现象；fork 上同一条用例通过。
