// 把 issue #10 的标题与开头换成通俗版本（用户选定方案 B），保留全部技术细节。
//
// 做法：
//   - 标题换成「新版 DSH 会让批注发不出去（当前版本不受影响，升级后才会遇到）」
//   - 正文最前面插入一段「一句话说明」，让不熟悉插件内部的人也能立刻看懂
//   - 原有的技术分析（版本号、字段名、7 处调用点、行号、上游链接、修法）一字不改
//   - 原技术性标题以一行「原标题」保留，便于按旧名检索

const token = process.env.GITHUB_TOKEN
if (token === undefined) { console.error('缺少 GITHUB_TOKEN'); process.exit(2) }

const OWNER = 'Ryuu-64'
const REPO = 'dsh-annotation'
const NUMBER = 10
const h = {
  authorization: `token ${token}`,
  accept: 'application/vnd.github+json',
  'content-type': 'application/json; charset=utf-8',
  'user-agent': 'dsh-agent',
}

const NEW_TITLE = '[兼容性] 新版 DSH 会让批注发不出去（当前版本不受影响，升级后才会遇到）'
const OLD_TITLE = '[兼容性] 内核 0.1.6-alpha.2+ 移除 `sessions.list.current`：批注块将静默不随消息发送（当前 0.1.5-rc.2 未受影响）'

const PREAMBLE = [
  '## 一句话说明',
  '',
  '等你哪天更新 DSH Desktop，批注会**发不出去**——消息照常发出，但里面只有你打的字，',
  '批注内容莫名其妙没了，而且**不会有任何报错或提示**。当前版本（0.1.5-rc.2）还没这个问题，',
  '是升级之后才会遇到。',
  '',
  '**为什么会这样**：这个插件需要知道「你现在在哪个会话里」，才知道批注该挂到哪条消息上。',
  '它当前是向 DSH 本体要这个信息的，而 DSH 新版把接口里的这个字段去掉了。插件拿不到，',
  '就干脆什么都不做——它设计成拿不到就悄悄跳过，而不是报错，所以你看不出哪里不对。',
  '',
  '**要修的话**：让插件换个地方读这个信息；并且无论如何都要改成**出错时明确告诉你**，',
  '而不是悄悄跳过。',
  '',
  `> 原标题（便于按旧名检索）：\`${OLD_TITLE}\``,
  '',
  '---',
  '',
  '## 技术细节',
  '',
].join('\n')

const get = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/issues/${NUMBER}`, { headers: h })
if (!get.ok) { console.error('读 issue 失败', get.status); process.exit(1) }
const issue = await get.json()

// 幂等：已经加过前言就不再重复插入
if (issue.body.includes('## 一句话说明')) {
  console.log('正文里已有一句话说明，跳过正文改写（仅更新标题）')
} else {
  const body = `${PREAMBLE}${issue.body}`
  const patch = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/issues/${NUMBER}`, {
    method: 'PATCH', headers: h, body: JSON.stringify({ title: NEW_TITLE, body }),
  })
  if (!patch.ok) { console.error('更新失败', patch.status, (await patch.text()).slice(0, 300)); process.exit(1) }
  console.log('✔ 正文已加入「一句话说明」，原标题以引用形式保留')
}

const patchTitle = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/issues/${NUMBER}`, {
  method: 'PATCH', headers: h, body: JSON.stringify({ title: NEW_TITLE }),
})
const final = await patchTitle.json()
console.log('✔ 标题 →', final.title)
console.log('  issue:', final.html_url)
console.log('  正文长度:', final.body.length)
