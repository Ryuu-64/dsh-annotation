# @ryuu-64/dsh-annotation

DSH Web 选中批注插件的 **fork**，修复了「鼠标悬停到批注上只显示一下，然后马上消失」。

基线上游：[`@changfenhuang/dsh-annotation`](https://github.com/omdsh-dev/dsh-annotation) **1.4.10**（MIT）。
本 fork 只改浏览器端 `client.js` 的**悬浮面板（hover tip）子系统**，其余行为与上游一致，
以便上游修复后低成本对齐。

- 问题跟踪：https://github.com/Ryuu-64/dsh-annotation/issues
- 上游仓库与本 fork 无关，**请勿向上游反馈本 fork 的改动**
- 改动清单与上游关系：见 [`NOTICE.md`](./NOTICE.md) 与 [`CHANGELOG.md`](./CHANGELOG.md)
- 上游原始文档：[`README.fork-upstream.md`](./README.fork-upstream.md) / [`README.fork-upstream.zh-CN.md`](./README.fork-upstream.zh-CN.md)

## 安装（本地 link，推荐）

浏览器端是手写 CJS bundle，**零构建步骤**，所以改源码即时生效：

```powershell
git clone https://github.com/Ryuu-64/dsh-annotation.git
cd dsh-annotation
node scripts/deploy-profile.mjs      # 接进 desktop profile（幂等）
npm test                             # 核对接线（test/deployment.test.mjs）
```

`deploy-profile` 做三件事：把 profile 依赖换成 `link:<本仓库>`、从
`dsh.profile.bundles` 里用本 fork 的包名替换上游包名、跑 `pnpm install`。

> ⚠ **改依赖 / bundles 名单必须完全重启 DSH Desktop** —— bundle 列表只在宿主启动时
> 解析一次，只刷新页面不会让新插件上线。改 `client.js` 则只需刷新页面。

退回到上游：`node scripts/deploy-profile.mjs --remove`

## 验证

```powershell
npm install     # 只有 jsdom 一个 devDependency
npm test        # 一条命令跑完全部用例（当前 44 个）
```

约定：**做事的在 `scripts/`，检查的在 `test/`**。`scripts/` 只放会改动系统的动作脚本
（`deploy-profile` 改 profile、`install-local` 装依赖）；一切核对与审计都是 `test/` 下的
测试，有断言、失败会红。其中：

- 需要本机 DSH profile 的检查（接线是否正确）在本机没有该 profile 时**自动 skip**，不假装通过；
- 需要上游基线代码的检查会自行从 npm 取（取不到则 skip），用来确认这些用例**确实针对缺陷**，
  而不是自我安慰。

## 已知风险

- **内核 0.1.6-alpha.2+ 会让「发送批注」整体静默失效**：内核移除了
  `sessions.list.current`，本 fork（与上游 1.4.10 / 1.4.11-preview.1）有 7 处依赖它，
  其中 `attachAndSend()` / `submitAttached()` 会**静默 return**。当前验证宿主为
  0.1.5-rc.2，未受影响。详见 [#10](https://github.com/Ryuu-64/dsh-annotation/issues/10)。
- 本 fork 未发布到 npm；请用 `link:` 或自建 tarball 安装。

## 许可

MIT。上游版权归 omdsh-dev，fork 改动归 Ryuu-64。见 [`LICENSE`](./LICENSE) 与 [`NOTICE.md`](./NOTICE.md)。
