// 给每个 issue 补一条「对应 PR / 谁在修」的状态说明，消除 issue 与 PR 对不上的问题。
//
// 映射（本 fork 的四个修复）：
//   #2 [A] 归属模型        → 上游 PR #65（他人提交，同根因同思路）已覆盖
//   #3 [B] 跨间隙 250ms    → 本仓库提交的上游 PR #66
//   #4 [C] 定时器跨面板误杀 → 上游 PR #65 亦覆盖（含 bubbleGrace/grace 的 owner 校验）
//   #5 [D] 监听器无界累积   → 本仓库提交的上游 PR #67
//   #10 内核兼容           → 暂无 PR（等内核侧/上游决策）

const token = process.env.GITHUB_TOKEN
if (token === undefined) { console.error('缺少 GITHUB_TOKEN'); process.exit(2) }

const h = {
  authorization: `token ${token}`,
  accept: 'application/vnd.github+json',
  'content-type': 'application/json; charset=utf-8',
  'user-agent': 'dsh-agent',
}

const COMMON = [
  '---',
  '',
  '### 对应 PR',
  '',
  '| 本仓库 issue | 对应修复 | 上游 PR |',
  '| --- | --- | --- |',
  '| #2 悬停面板只闪一下就消失 | `[A]` 归属模型 | [#65](https://github.com/omdsh-dev/dsh-annotation/pull/65)（他人提交，已覆盖同根因） |',
  '| #3 跨 6px 间隙靠 250ms 赌运气 | `[B]` 实时指针位置 | [#66](https://github.com/omdsh-dev/dsh-annotation/pull/66)（本仓库提交） |',
  '| #4 定时器跨面板误杀 | `[C]` 定时器归属收敛 | [#65](https://github.com/omdsh-dev/dsh-annotation/pull/65)（同一 PR 亦覆盖） |',
  '| #5 监听器无界累积 | `[D]` 共享监听器收敛 | [#67](https://github.com/omdsh-dev/dsh-annotation/pull/67)（本仓库提交） |',
].join('\n')

const notes = {
  2: [
    COMMON,
    '',
    '**本 issue 的修复由上游 #65 承担**：该 PR 引入的 `tipOwner` / `clearTip(owner)` /',
    '`presentTip(owner, el)` 与本 issue 描述的根因、修法一致（`updateChip()` 在「无待发送批注」',
    '分支无条件清空共享容器 → 改为清空必须指名归属）。因此没有重复提 PR，避免与 #65 冲突。',
    '本机独立复现与验证结论见 [#65 的评论](https://github.com/omdsh-dev/dsh-annotation/pull/65#issuecomment-5806647193)。',
    '',
    '本 fork 已在真实页面确认修复有效（宿主重启加载后 hover 稳定显示）。',
  ].join('\n'),
  3: [
    COMMON,
    '',
    '**本 issue 的修复见上游 #66**：宽限到点时不再无条件清空，而是复查**实时**指针位置',
    '（`pointermove` 跟踪，而非 `mouseleave` 的过期坐标），指针仍在「面板 ∪ 触发元素」',
    '并集内（容差 10px）就保持展开。',
    '',
    '回归用例 `test/pointer-gap.test.mjs`（7 条）：上游原版代码上 7/7 失败，修复后全通过。',
  ].join('\n'),
  4: [
    COMMON,
    '',
    '**本 issue 的修复同样由上游 #65 承担**：该 PR 除了引入归属模型，还把三类面板各自的',
    '`hoverGrace` / `bubbleGrace` / `grace` 定时器的关闭动作改为只作用于自己的面板，',
    '因此「A 遗留的定时器误杀 B 刚显示的面板」这条被一并解决。故没有重复提 PR。',
    '',
    '本 fork 另以回归用例固定该行为：`[C] A 面板遗留的 hide 不会误杀 B 面板刚显示的内容`。',
  ].join('\n'),
  5: [
    COMMON,
    '',
    '**本 issue 的修复见上游 #67**：共享容器 `tipLayer` 只保留两处固定监听器',
    '（`sharedTipMouseEnter` / `sharedTipMouseLeave`），通过 `tipActiveHide` 指针按当前面板派发，',
    '面板关闭时用 `releaseActiveTip()` 解除登记。',
    '',
    '回归用例 `test/shared-listeners.test.mjs`（8 条）：上游原版代码上 8/8 失败，修复后全通过。',
  ].join('\n'),
  10: [
    COMMON,
    '',
    '**本 issue 暂无对应 PR**：它是**尚未触发**的内核兼容风险（当前验证宿主为 0.1.5-rc.2，',
    '`sessions.list.current` 仍存在），需要等内核 0.1.6-alpha.2+ 的适配决策，',
    '或由内核侧提供「当前会话」的公开只读读面。相关上游报告见',
    '[omdsh-dev/dsh-annotation#64](https://github.com/omdsh-dev/dsh-annotation/issues/64)。',
    '',
    '本 fork 的待办：加带降级的 `currentSessionId()`，并把 `attachAndSend()` / `submitAttached()`',
    '的提前返回改为**显式可观测**（打日志 + toast），避免升级后再次静默失效。',
  ].join('\n'),
}

for (const [num, body] of Object.entries(notes)) {
  const r = await fetch(`https://api.github.com/repos/Ryuu-64/dsh-annotation/issues/${num}/comments`, {
    method: 'POST', headers: h, body: JSON.stringify({ body }),
  })
  if (r.status < 300) {
    const j = await r.json()
    console.log(`✔ #${num} 已补状态说明 → ${j.html_url}`)
  } else {
    console.log(`✖ #${num} 失败 ${r.status} ${(await r.text()).slice(0, 200)}`)
  }
}
