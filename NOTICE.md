# NOTICE

## 上游

本仓库是 **fork**，上游为：

- 项目：`dsh-annotation`（annotation-for-dsh）
- 仓库：https://github.com/omdsh-dev/dsh-annotation
- npm：`@changfenhuang/dsh-annotation`
- 版本基线：**1.4.10**
- 作者：changfenhuang / omdsh-dev
- 许可证：MIT（见 `LICENSE`，版权归 omdsh-dev）

## 本 fork

- 包名：`@ryuu-64/dsh-annotation`
- 仓库：https://github.com/Ryuu-64/dsh-annotation
- 维护：Ryuu-64

## 改动范围

本 fork 只改**浏览器端 `client.js` 的悬浮面板（hover tip）子系统**，其余行为与上游
1.4.10 保持一致，以便上游修复后能低成本对齐（diff 见仓库 Issue）。

| 标记 | 改动 | 说明 |
| --- | --- | --- |
| A | 悬浮面板归属模型 `tipOwner` / `clearTip(owner)` / `presentTip(owner, el)` | 对齐上游 PR #65：共享容器 `tipLayer` 的清空必须指名归属，否则宿主 layout mutation 触发的 `updateChip()` 会把正在观看的面板抹掉 |
| B | 宽限到点后复查**实时**指针位置 | 面板与触发元素间有 6px 间隙，上游只靠固定 250ms 宽限，慢一点面板就消失 |
| C | 宽限定时器按归属收敛 | 上游每个面板各持一个定时器却清同一个容器，A 的定时器会误杀 B 刚显示的面板 |
| D | 面板监听器不再挂到共享容器上 | 上游每次渲染面板都往同一 `tipLayer` 追加监听器，反复重渲染会无界累积 |

上游 PR #65（https://github.com/omdsh-dev/dsh-annotation/pull/65）截至本 fork 建立时
仍为 open / 未合并；本 fork 先落地其思路，并补上 B / C / D 三项。

## 商标与归属

`dsh-annotation`、`annotation-for-dsh` 等名称与上游产品站内容归原作者所有。本 fork 的
问题跟踪、发布与支持均由 Ryuu-64 提供，**请勿向上游仓库反馈本 fork 的改动**。
