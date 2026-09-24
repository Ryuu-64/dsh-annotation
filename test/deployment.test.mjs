// 部署接线自检（本机）：确认 DSH profile 真的指向本仓库，而不是「以为装了」。
//
// 本文件依赖**本机**的 DSH profile（默认 desktop），因此：
//   - profile 不存在（比如换台机器、或没接入过）→ 显式 skip，不假装通过
//   - profile 存在 → 逐项断言；判定写成断言而非打印，失败会红
//
// 环境变量 DSH_HOME 可覆盖 ~/.dsh；用 DSH_PROFILE 指定其它 profile 名。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, lstatSync, realpathSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'

const UPSTREAM = '@changfenhuang/dsh-annotation'
const FORK = '@ryuu-64/dsh-annotation'
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const profileName = process.env.DSH_PROFILE ?? 'desktop'
const dshHome = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh')
const profileDir = join(dshHome, 'profiles', profileName)
const manifestPath = join(profileDir, 'package.json')

const hasProfile = existsSync(manifestPath)
const skipped = hasProfile ? null : `本机没有 ${profileName} profile（${manifestPath}），部署接线无从检查`

/** 只在 profile 存在时读取清单。 */
function manifest() {
  return JSON.parse(readFileSync(manifestPath, 'utf8'))
}

test('profile 依赖用 link: 指向本仓库', (t) => {
  if (!hasProfile) return t.skip(skipped)
  const dep = (manifest().dependencies ?? {})[FORK]
  assert.equal(typeof dep, 'string', `dependencies 里缺少 ${FORK}`)
  assert.ok(dep.startsWith('link:'), `${FORK} 应为 link: 依赖，实际 ${dep}`)
  const target = dep.slice('link:'.length).replace(/\\/g, '/').replace(/\/$/, '')
  assert.equal(target.toLowerCase(), repoRoot.replace(/\\/g, '/').toLowerCase(),
    'link: 目标应指向本仓库根目录')
})

test('上游包已从依赖与 bundles 中移除（否则同一份 UI 会加载两次）', (t) => {
  if (!hasProfile) return t.skip(skipped)
  const m = manifest()
  assert.equal(UPSTREAM in (m.dependencies ?? {}), false, `dependencies 里仍有 ${UPSTREAM}`)
  const bundles = m.dsh?.profile?.bundles ?? []
  assert.equal(bundles.includes(FORK), true, `bundles 里缺少 ${FORK}`)
  assert.equal(bundles.includes(UPSTREAM), false, `bundles 里仍有 ${UPSTREAM}`)
})

test('node_modules 里是指回本仓库的软链（改源码才会即时生效）', (t) => {
  if (!hasProfile) return t.skip(skipped)
  const linkedDir = join(profileDir, 'node_modules', ...FORK.split('/'))
  assert.ok(existsSync(linkedDir), `node_modules 里没有 ${FORK}`)
  assert.ok(lstatSync(linkedDir).isSymbolicLink(),
    '应是软链；若是真实目录，说明是 pnpm 从 tarball 复制的一份，改源码不会生效')
  assert.equal(realpathSync(linkedDir).toLowerCase(), repoRoot.toLowerCase(),
    '软链应指回本仓库根目录')
  assert.equal(existsSync(join(profileDir, 'node_modules', ...UPSTREAM.split('/'))), false,
    `node_modules 里仍有上游包 ${UPSTREAM}`)
})

test('包名与 ModuleLoader id / exports.name 三处一致', () => {
  // 这一条不依赖 profile，任何机器都该成立
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
  assert.equal(pkg.name, FORK)
  const client = readFileSync(join(repoRoot, 'client.js'), 'utf8')
  const id = /id:\s*'([^']+)'/.exec(client)?.[1]
  assert.equal(id, pkg.name, 'ModuleLoader id 必须等于包名，否则浏览器端拒绝注册')
  assert.ok(client.includes(`exports.name = '${pkg.name}'`), 'exports.name 必须等于包名')
})

test('client.js 语法可解析', () => {
  const clientPath = join(repoRoot, 'client.js')
  execFileSync(process.execPath, ['--check', clientPath], { stdio: 'pipe' })
})

test('客户端仍具备全部修复的关键符号（防止装到未打补丁的版本）', () => {
  const client = readFileSync(join(repoRoot, 'client.js'), 'utf8')
  for (const sym of ['tipOwner', 'clearTip', 'presentTip', 'pointerWithinTip', 'ownedHide',
    'onTipPointerMove', 'currentSessionId', 'announceSessionLost']) {
    assert.ok(client.includes(sym), `缺少 ${sym}`)
  }
  // 共享容器只允许被 clearTip / presentTip 清空
  const rawClears = (client.match(/tipLayer\.textContent = ''/g) ?? []).length
  assert.equal(rawClears, 2, `tipLayer 裸清空应为 2 处（clearTip / presentTip 内部），实际 ${rawClears}`)
  // 共享容器只挂两处固定监听器
  const layerListeners = (client.match(/tipLayer\.addEventListener\(/g) ?? []).length
  assert.equal(layerListeners, 2, `tipLayer 监听器应为 2 处，实际 ${layerListeners}`)
})
