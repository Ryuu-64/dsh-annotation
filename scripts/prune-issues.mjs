// 删除本仓库里的垃圾 issue（重复项 + ASCII 探针）。
//
// 背景：第一版 file-issues.mjs 没有台账去重，把 issues/ 下 5 个文件重复提交了两轮，
// 于是同一个缺陷在列表里出现 3 次（1 次规范 + 2 次重复），外加一个编码排查用的
// ASCII 探针。这些已用 state_reason=duplicate 关闭，但留在列表里会让人误以为
// 报告了很多不同的问题 —— 这里直接用 GraphQL deleteIssue 删掉。
//
// 用法：GITHUB_TOKEN=… node .tools/prune-issues.mjs [--dry-run]

const token = process.env.GITHUB_TOKEN
if (token === undefined) { console.error('缺少 GITHUB_TOKEN'); process.exit(2) }
const dryRun = process.argv.includes('--dry-run')

const OWNER = 'Ryuu-64'
const REPO = 'dsh-annotation'

async function gql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      authorization: `bearer ${token}`,
      'content-type': 'application/json; charset=utf-8',
      'user-agent': 'dsh-agent',
    },
    body: JSON.stringify({ query, variables }),
  })
  const json = await res.json()
  if (json.errors) throw new Error(JSON.stringify(json.errors).slice(0, 400))
  return json.data
}

// 1) 列出所有 issue，挑出「已关闭」的垃圾
const list = await gql(`
  query($owner: String!, $name: String!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      issues(first: 100, after: $cursor, states: [CLOSED]) {
        pageInfo { hasNextPage endCursor }
        nodes { number title stateReason id }
      }
    }
  }`, { owner: OWNER, name: REPO })

const nodes = list.repository.issues.nodes
console.log(`已关闭的 issue：${nodes.length} 个`)
for (const n of nodes) console.log(`  #${n.number} [${n.stateReason}] ${n.title.slice(0, 58)}`)

if (dryRun) { console.log('\n--dry-run：不删除。'); process.exit(0) }

console.log('')
let ok = 0
for (const n of nodes) {
  try {
    await gql(`mutation($id: ID!) { deleteIssue(input: { issueId: $id }) { clientMutationId } }`, { id: n.id })
    console.log(`  ✔ 已删除 #${n.number}`)
    ok++
  } catch (err) {
    console.error(`  ✖ 删除 #${n.number} 失败：${err.message}`)
  }
}
console.log(`\n完成：删除 ${ok} / ${nodes.length}`)
