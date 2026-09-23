// 在 GitHub 仓库上按 issues/*.md 建 issue。
//
// 两种模式：
//   A) 有 gh CLI：gh issue create --body-file
//   B) 没有 gh：直接用 REST API（令牌从 git credential helper 取，不落盘）
//
// 用法：
//   node scripts/file-issues.mjs --dry-run                 # 只打印将提交的标题
//   node scripts/file-issues.mjs --api                     # 强制 API 模式
//   node scripts/file-issues.mjs --repo Ryuu-64/dsh-annotation
//   node scripts/file-issues.mjs --token <PAT>             # 显式给令牌
//
// issue 正文取 issues/*.md，标题取文件里的第一个 `# ` 一级标题。
//
// 注：Windows PowerShell 5.1 的 Invoke-RestMethod/ConvertTo-Json 会按
// Content-Type 猜编码，中文正文容易在 POST 时变成 422；这里统一走 Node 的
// fetch + UTF-8 字节，避免那条坑。

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const issuesDir = join(repoRoot, 'issues')
const argv = process.argv
const dryRun = argv.includes('--dry-run')
const forceApi = argv.includes('--api')
const repo = argv.includes('--repo') ? argv[argv.indexOf('--repo') + 1] : 'Ryuu-64/dsh-annotation'
const tokenArg = argv.includes('--token') ? argv[argv.indexOf('--token') + 1] : undefined

function hasGh() {
  try {
    execFileSync('gh', ['--version'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/** 从 git credential helper 取 github.com 的令牌（不打印、不落盘）。 */
function tokenFromCredentialHelper() {
  const query = 'protocol=https\nhost=github.com\n\n'
  const out = execFileSync('git', ['credential', 'fill'], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  const line = out.split(/\r?\n/).find((l) => l.startsWith('password='))
  return line === undefined ? undefined : line.slice('password='.length)
}

const files = existsSync(issuesDir)
  ? readdirSync(issuesDir).filter((f) => f.endsWith('.md')).sort()
  : []
if (files.length === 0) {
  console.error(`[file-issues] ${issuesDir} 下没有 .md`)
  process.exit(1)
}

const useGh = !forceApi && hasGh()
console.log(`[file-issues] 仓库 ${repo} · 模式 ${useGh ? 'gh CLI' : 'REST API'}${dryRun ? ' · dry-run' : ''}`)

let token
if (!useGh && !dryRun) {
  token = tokenArg ?? tokenFromCredentialHelper()
  if (token === undefined) {
    console.error('[file-issues] 拿不到 GitHub 令牌：用 --token <PAT>，或先 gh auth login。')
    process.exit(1)
  }
}

let created = 0
for (const file of files) {
  const body = readFileSync(join(issuesDir, file), 'utf8')
  const title = /^#\s+(.+)$/m.exec(body)?.[1]?.trim()
  if (title === undefined) {
    console.error(`[file-issues] ${file} 缺少一级标题，跳过`)
    continue
  }
  if (dryRun) {
    console.log(`  · ${file}\n    ${title}`)
    continue
  }
  try {
    if (useGh) {
      const url = execFileSync('gh', ['issue', 'create', '--repo', repo, '--title', title, '--body-file', '-'],
        { input: body, encoding: 'utf8' }).trim()
      console.log(`  ✔ ${url}`)
    } else {
      const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
        method: 'POST',
        headers: {
          authorization: `token ${token}`,
          accept: 'application/vnd.github+json',
          'content-type': 'application/json; charset=utf-8',
          'user-agent': 'dsh-annotation-fork-issue-filer',
        },
        body: JSON.stringify({ title, body }),
      })
      const text = await res.text()
      if (!res.ok) {
        console.error(`  ✖ ${file} → HTTP ${res.status}\n    ${text.slice(0, 400)}`)
        continue
      }
      const json = JSON.parse(text)
      console.log(`  ✔ #${json.number}  ${json.html_url}`)
    }
    created++
  } catch (err) {
    console.error(`  ✖ ${file} → ${err.message}`)
  }
}
console.log(`\n[file-issues] 完成：新建 ${created} / ${files.length}。`)
