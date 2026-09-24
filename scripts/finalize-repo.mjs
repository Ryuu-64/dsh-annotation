// 合并本仓库的 PR #16，并关闭已修复的 issue（#2-#5），保留 #10。
//
// 保留 #10 的理由：它是**尚未触发**的内核兼容风险（当前内核 0.1.5-rc.2 仍有
// sessions.list.current），本 fork 还没做适配，属于真实待办 —— 关掉会丢线索。

const token = process.env.GITHUB_TOKEN
if (token === undefined) { console.error('缺少 GITHUB_TOKEN'); process.exit(2) }

const OWNER = 'Ryuu-64'
const REPO = 'dsh-annotation'
const h = {
  authorization: `token ${token}`,
  accept: 'application/vnd.github+json',
  'content-type': 'application/json; charset=utf-8',
  'user-agent': 'dsh-agent',
}

async function api(path, init) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}${path}`, { headers: h, ...init })
  const text = await res.text()
  return { status: res.status, json: text === '' ? null : JSON.parse(text) }
}

// ---- 1) 合并 PR #16 ----
const pr = await api('/pulls/16')
if (pr.status !== 200) { console.error('读 PR 失败', pr.status); process.exit(1) }
console.log(`PR #16: ${pr.json.state} | mergeable=${pr.json.mergeable} | ${pr.json.changed_files} 文件 +${pr.json.additions} -${pr.json.deletions}`)

if (pr.json.state === 'open') {
  const merge = await api('/pulls/16/merge', {
    method: 'PUT',
    body: JSON.stringify({
      commit_title: 'feat(verify): 一条命令验证四个悬浮面板修复都真实生效 (#16)',
      commit_message: '合并后 scripts/demo-fix.mjs 可用；本机实测本仓库 20/20、上游原版 1/20。',
      merge_method: 'squash',
    }),
  })
  if (merge.status < 300) console.log(`✔ 已合并 PR #16 → ${merge.json.sha.slice(0, 8)}`)
  else { console.error(`✖ 合并失败 ${merge.status} ${JSON.stringify(merge.json).slice(0, 300)}`); process.exit(1) }
} else {
  console.log('PR #16 已不是 open 状态，跳过合并')
}

// ---- 2) 关闭已修复的 issue ----
const CLOSE = {
  2: [
    '已在 1.4.10-ryuu.1 中修复并经真实页面确认：宿主重启加载后，hover 已发送消息上的',
    '「批注 ×N」标签与回复里的 `Annotation N` 芯片均稳定显示，不再闪退。',
    '',
    '根因：`updateChip()` 在「无待发送批注」分支无条件清空共享容器 `tipLayer`，而它由',
    '`scroll`(capture) / `resize` / body 级 `MutationObserver` 经 `onLayoutChange`(rAF) 高频调用。',
    '修法：引入归属模型 `tipOwner` / `clearTip(owner)` / `presentTip(owner, el)`。',
    '',
    '同一根因的修复思路已由上游 PR #65 独立提出（他人提交，截至关闭时仍 open）；',
    '本机独立复现与验证结论见该 PR 的评论。',
    '',
    '验证：`node scripts/demo-fix.mjs` —— 本仓库 20/20 通过，同一套测试跑上游原版 1/20。',
  ].join('\n'),
  3: [
    '已修复并经真实页面确认。',
    '',
    '根因：面板与触发元素之间必然留 6px 间隙，跨间隙完全依赖固定 250ms 宽限 ——',
    '指针停在间隙里把宽限走满，面板就消失；想点面板里的「删除」按钮常常点不中。',
    '修法：宽限到点时复查**实时**指针位置（`pointermove` 跟踪，而非 `mouseleave` 的过期',
    '坐标），指针仍在「面板 ∪ 触发元素」并集内（容差 10px）就保持展开。',
    '',
    '已提交上游：https://github.com/omdsh-dev/dsh-annotation/pull/66（open、mergeable）。',
    '回归用例 `test/pointer-gap.test.mjs`（7 条）：上游原版 7/7 失败，本仓库全通过。',
  ].join('\n'),
  4: [
    '已修复并经真实页面确认。',
    '',
    '根因：三类面板各持一个私有宽限定时器（`hoverGrace` / `bubbleGrace` / `grace`）却清',
    '同一个共享容器 —— 快速从 A 滑到 B 时，A 遗留的定时器到点会把 B 刚显示的面板清掉。',
    '修法：共用一个计时器句柄，并在关闭前校验「自己仍是当前归属」。',
    '',
    '该修复与上游 PR #65 同思路（该 PR 亦把三类定时器的关闭动作收敛到自己面板），',
    '故未重复提 PR。',
    '',
    '回归用例：`[C] A 面板遗留的 hide 不会误杀 B 面板刚显示的内容` 等 3 条。',
  ].join('\n'),
  5: [
    '已修复并经真实页面确认。',
    '',
    '根因：`tipLayer` 是长期存活的 body 级单例，而气泡标签与回复芯片会随消息重渲染反复',
    '重建；每次重建都往共享容器追加一对监听器却从不移除，于是监听器与闭包无界累积，',
    '关闭决策不再由「当前面板」决定。',
    '修法：共享容器只保留两处固定监听器，通过 `tipActiveHide` 按当前面板派发，面板关闭时',
    '用 `releaseActiveTip()` 解除登记。',
    '',
    '已提交上游：https://github.com/omdsh-dev/dsh-annotation/pull/67（open、mergeable）。',
    '回归用例 `test/shared-listeners.test.mjs`（8 条）：上游原版 8/8 失败，本仓库全通过。',
  ].join('\n'),
}

for (const [num, comment] of Object.entries(CLOSE)) {
  const c = await api(`/issues/${num}/comments`, { method: 'POST', body: JSON.stringify({ body: comment }) })
  if (c.status >= 300) { console.log(`✖ #${num} 评论失败 ${c.status}`); continue }
  const r = await api(`/issues/${num}`, {
    method: 'PATCH',
    body: JSON.stringify({ state: 'closed', state_reason: 'completed' }),
  })
  console.log(r.status < 300 ? `✔ #${num} 已关闭（completed）` : `✖ #${num} 关闭失败 ${r.status}`)
}

console.log('')
const all = await api('/issues?state=all&per_page=100')
console.log('=== issue 最终状态 ===')
for (const i of all.json.sort((a, b) => a.number - b.number)) {
  console.log(`  #${i.number} [${i.state}] ${i.title.slice(0, 52)}`)
}
