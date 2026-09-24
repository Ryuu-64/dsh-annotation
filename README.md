# @ryuu-64/dsh-annotation

DSH Web 选中批注插件的 **fork**，修复了「鼠标悬停到批注上只显示一下，然后马上消失」。

基线上游：[`@changfenhuang/dsh-annotation`](https://github.com/omdsh-dev/dsh-annotation) **1.4.10**（MIT）。
本 fork 只改浏览器端 `client.js` 的**悬浮面板（hover tip）子系统**，其余行为与上游一致，
以便上游修复后低成本对齐。

- 问题跟踪：https://github.com/Ryuu-64/dsh-annotation/issues
- 上游仓库与本 fork 无关，**请勿向上游反馈本 fork 的改动**
- 改动清单与上游关系：见 [`NOTICE.md`](./NOTICE.md) 与 [`CHANGELOG.md`](./CHANGELOG.md)
- 上游原始文档：[`README.fork-upstream.md`](./README.fork-upstream.md) / [`README.fork-upstream.zh-CN.md`](./README.fork-upstream.zh-CN.md)

## 修了什么

三类悬浮面板（输入框旁胶囊 / 用户气泡上的「批注 ×N」标签 / 回复里的 `Annotation N` 芯片）
共享同一个单例容器 `tipLayer`，而上游的清理逻辑没有「归属」概念，加上固定的 250ms
宽限，导致面板刚显示就被抹掉。四个修复：

| 标记 | 缺陷 | 修法 |
| --- | --- | --- |
| **A** | `updateChip()` 在「无待发送批注」时**无条件**清空共享容器；而它由 `scroll`(capture) / `resize` / body 级 `MutationObserver` 经 `onLayoutChange`(rAF) **高频**调用 | 引入归属模型 `tipOwner` / `clearTip(owner)` / `presentTip(owner, el)`，清空必须指名归属 |
| **B** | 面板与触发元素间有 6px 间隙，跨间隙全靠固定 250ms 赌手速 | 宽限到点复查**实时**指针位置（`pointermove` 跟踪，而非 `mouseleave` 的过期坐标），指针仍在「触发元素 + 面板 + 容差」并集内就不关闭 |
| **C** | 每个面板各持一个 `hide` 定时器却清同一个容器，A 的定时器会误杀 B 刚显示的面板 | 共用一个计时器句柄，关闭前校验「自己仍是当前归属」 |
| **D** | 每次渲染气泡标签/回复芯片都往同一个 `tipLayer` 追加监听器，重渲染导致无界累积 | 共享容器只保留两处固定监听器，按 `tipOwner` 分派 |

其中 **[A] 与上游 [PR #65](https://github.com/omdsh-dev/dsh-annotation/pull/65) 同思路**
（该 PR 截至本 fork 建立时仍为 open / 未合并，且 `1.4.11-preview.1` 未包含）。

各缺陷的完整分析（复现、根因带行号、修法、验证）见
[issues/](./issues/) —— 它们已提交为本仓库的 #2 / #3 / #4 / #5，内核兼容风险见 #10。
向上游提交的 PR 见 [#66](https://github.com/omdsh-dev/dsh-annotation/pull/66)（对应 `[B]`）与
[#67](https://github.com/omdsh-dev/dsh-annotation/pull/67)（对应 `[D]`）；`[A]`/`[C]` 与上游
[#65](https://github.com/omdsh-dev/dsh-annotation/pull/65) 同思路，故未重复提 PR。

## 安装（本地 link，推荐）

浏览器端是手写 CJS bundle，**零构建步骤**，所以改源码即时生效：

```powershell
git clone https://github.com/Ryuu-64/dsh-annotation.git
cd dsh-annotation
node scripts/deploy-profile.mjs      # 接进 desktop profile（幂等）
node scripts/verify-deployment.mjs   # 核对 13 项接线
```

`deploy-profile` 做三件事：把 profile 依赖换成 `link:<本仓库>`、从
`dsh.profile.bundles` 里用本 fork 的包名替换上游包名、跑 `pnpm install`。

> ⚠ **改依赖 / bundles 名单必须完全重启 DSH Desktop** —— bundle 列表只在宿主启动时
> 解析一次，只刷新页面不会让新插件上线。改 `client.js` 则只需刷新页面。

退回到上游：`node scripts/deploy-profile.mjs --remove`

## 验证

```powershell
npm install          # 只有 jsdom 一个 devDependency
npm run verify       # 语法 + 行为 + 反向验证 + 漂移审计 + 部署接线
```

| 命令 | 作用 |
| --- | --- |
| `npm test` | 单测：把 `clearTip`/`scheduleHide`/`pointerWithinTip` 等真实函数抽到 Node vm 沙箱里按行为跑 |
| `npm run test:dom` | e2e：在 jsdom 里经 `ModuleLoader.load → factory → apply(ctx)` **装载真实 bundle**，用真实 DOM 事件与 `MutationObserver` 驱动；三类面板各一条（气泡标签 / 回复芯片 / 输入框胶囊） |
| `npm run check:upstream` | 把同一套用例指向上游 1.4.10 跑一遍，确认测试**确实能抓到**这个 bug（否则只是自我安慰） |
| `npm run audit:drift` | 审计与上游 1.4.10 的每一处差异是否都能归因到预期修复 |
| `npm run verify:deployment` | 核对 profile 接线：依赖指向、bundles 名单、软链、包名与 ModuleLoader id 一致等 |

当前结果：

| | 单测 | e2e | 合计 |
| --- | --- | --- | --- |
| **本 fork** | 15/15 | 5/5 | **20/20** |
| **上游 1.4.10** | 1/15 | 0/5 | **1/20** |

上游失败中最关键的一条正是本 fork 修的现象：

```
✖ [e2e] 真实 hover：面板显示后，宿主 DOM 高频变化不会抹掉它
  AssertionError: 宿主高频变化后面板必须还在
  0 !== 1        ← 面板先显示出来（前一条断言通过），随后被宿主变化抹掉
```

## 已知风险

- **内核 0.1.6-alpha.2+ 会让「发送批注」整体静默失效**：内核移除了
  `sessions.list.current`，本 fork（与上游 1.4.10 / 1.4.11-preview.1）有 7 处依赖它，
  其中 `attachAndSend()` / `submitAttached()` 会**静默 return**。当前验证宿主为
  0.1.5-rc.2，未受影响。详见 [#10](https://github.com/Ryuu-64/dsh-annotation/issues/10)。
- 本 fork 未发布到 npm；请用 `link:` 或自建 tarball 安装。

## 许可

MIT。上游版权归 omdsh-dev，fork 改动归 Ryuu-64。见 [`LICENSE`](./LICENSE) 与 [`NOTICE.md`](./NOTICE.md)。
