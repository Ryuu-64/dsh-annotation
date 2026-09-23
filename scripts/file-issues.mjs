// 在 GitHub 仓库存在后，用 gh CLI 建好本 fork 的三个 issue。
//
// 用法（需要先安装 gh 并 gh auth login）：
//   node scripts/file-issues.mjs                 # 建 issue
//   node scripts/file-issues.mjs --dry-run       # 只打印将要提交的内容
//   node scripts/file-issues.mjs --repo Ryuu-64/dsh-annotation
//
// issue 正文存放在 issues/*.md，标题取文件里的第一个 `# ` 一级标题行。

import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const issuesDir = join(repoRoot, 'issues')
const dryRun = process.argv.includes('--dry-run')
const repoIdx = process.argv.indexOf('--repo')
const repo = repoIdx === -1 ? 'Ryuu-64/dsh-annotation' : process.argv[repoIdx + 1]

const files = readdirSync(issuesDir).filter((f) => f.endsWith('.md')).sort()
if (files.length === 0) {
  console.error(`[file-issues] ${issuesDir} 下没有 .md`)
  process.exit(1)
}

function gh(args, input) {
  return execFileSync('gh', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] })
}

for (const file of files) {
  const body = readFileSync(join(issuesDir, file), 'utf8')
  const titleMatch = /^#\s+(.+)$/m.exec(body)
  if (titleMatch === null) {
    console.error(`[file-issues] ${file} 缺少一级标题（用作 issue 标题），跳过`)
    continue
  }
  const title = titleMatch[1].trim()
  console.log(`\n=== ${file}\n标题：${title}\n仓库：${repo}`)
  if (dryRun) {
    console.log('--dry-run：不提交。')
    continue
  }
  try {
    const url = gh(['issue', 'create', '--repo', repo, '--title', title, '--body-file', '-'], body)
    console.log(`已创建：${url.trim()}`)
  } catch (err) {
    console.error(`[file-issues] 创建失败：${err.message}`)
  }
}
