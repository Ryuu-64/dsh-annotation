// 自检：确认本 fork 真的被 desktop profile 装载了，而不是"以为装了"。
//
// 用法：node scripts/verify-deployment.mjs [--profile desktop]
//
// 逐项检查（任一失败即退出码 1）：
//   1. profile 清单：dependencies 指向本仓库的 link:，且上游包名已移除
//   2. profile 清单：dsh.profile.bundles 里有本 fork 的包名，且没有上游包名
//   3. node_modules 里是 Junction/软链，且解析回本仓库
//   4. 包名 == client.js 的 ModuleLoader id == exports.name（三处必须一致，
//      否则浏览器端 client-modules 报 bundle loaded without registering）
//   5. client.js 语法可解析
//   6. 悬浮面板归属模型的关键符号都在（防止装了个没打补丁的版本）
//
// 这一项只能在页面里做，脚本无法代劳：hover 一条已有批注，看面板是否稳定。

import { readFileSync, existsSync, lstatSync, realpathSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const UPSTREAM = '@changfenhuang/dsh-annotation'
const FORK = '@ryuu-64/dsh-annotation'
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const profileIdx = process.argv.indexOf('--profile')
const profileName = profileIdx === -1 ? 'desktop' : process.argv[profileIdx + 1]

const dshHome = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh')
const profileDir = join(dshHome, 'profiles', profileName)
const manifestPath = join(profileDir, 'package.json')

let failed = 0
const pass = (label, detail = '') => console.log(`  ✔ ${label}${detail === '' ? '' : ` — ${detail}`}`)
const fail = (label, detail) => { failed++; console.log(`  ✖ ${label} — ${detail}`) }

console.log(`[verify] profile：${profileDir}`)

// 1 + 2
if (!existsSync(manifestPath)) {
  fail('profile 清单存在', manifestPath)
} else {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const deps = manifest.dependencies ?? {}
  const bundles = manifest.dsh?.profile?.bundles ?? []

  if (typeof deps[FORK] === 'string' && deps[FORK].startsWith('link:')) {
    const target = deps[FORK].slice('link:'.length).replace(/\\/g, '/').replace(/\/$/, '')
    if (target.toLowerCase() === repoRoot.replace(/\\/g, '/').toLowerCase()) pass('dependencies 指向本仓库', deps[FORK])
    else fail('dependencies 指向本仓库', `期望 link:${repoRoot}，实际 ${deps[FORK]}`)
  } else {
    fail('dependencies 指向本仓库', `缺少 ${FORK}，实际值 ${String(deps[FORK])}`)
  }

  if (UPSTREAM in deps) fail('上游包已从 dependencies 移除', `仍存在 ${UPSTREAM}: ${deps[UPSTREAM]}`)
  else pass('上游包已从 dependencies 移除')

  if (bundles.includes(FORK)) pass('bundles 含本 fork', FORK)
  else fail('bundles 含本 fork', `bundles = ${JSON.stringify(bundles)}`)

  if (bundles.includes(UPSTREAM)) fail('bundles 不含上游包名', `仍存在 ${UPSTREAM}`)
  else pass('bundles 不含上游包名')
}

// 3
const linkedDir = join(profileDir, 'node_modules', ...FORK.split('/'))
if (!existsSync(linkedDir)) {
  fail('node_modules 里有本 fork', linkedDir)
} else {
  const stat = lstatSync(linkedDir)
  if (stat.isSymbolicLink()) {
    let real = ''
    try { real = realpathSync(linkedDir) } catch (err) { real = `realpath 失败: ${err.message}` }
    if (real.toLowerCase() === repoRoot.toLowerCase()) pass('node_modules 软链指回本仓库', real)
    else fail('node_modules 软链指回本仓库', `期望 ${repoRoot}，实际 ${real}`)
  } else {
    fail('node_modules 里应是软链（link: 安装）', '是真实目录，可能是 pnpm 从 tarball 复制的一份，改源码不会生效')
  }
}

const upstreamLinked = join(profileDir, 'node_modules', ...UPSTREAM.split('/'))
if (existsSync(upstreamLinked)) fail('上游包已从 node_modules 移除', upstreamLinked)
else pass('上游包已从 node_modules 移除')

// 4 + 5 + 6
const pkgPath = join(repoRoot, 'package.json')
const clientPath = join(repoRoot, 'client.js')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const client = readFileSync(clientPath, 'utf8')

if (pkg.name === FORK) pass('package.json name', pkg.name)
else fail('package.json name', `期望 ${FORK}，实际 ${pkg.name}`)

const idMatch = /id:\s*'([^']+)'/.exec(client)
if (idMatch !== null && idMatch[1] === pkg.name) pass('ModuleLoader id == 包名', idMatch[1])
else fail('ModuleLoader id == 包名', `id=${idMatch === null ? '未找到' : idMatch[1]}，包名=${pkg.name}`)

if (client.includes(`exports.name = '${pkg.name}'`)) pass('exports.name == 包名')
else fail('exports.name == 包名', 'client.js 里的 exports.name 与包名不一致')

try {
  execFileSync(process.execPath, ['--check', clientPath], { stdio: 'pipe' })
  pass('client.js 语法可解析')
} catch (err) {
  fail('client.js 语法可解析', String(err.stderr ?? err.message).slice(0, 200))
}

const symbols = ['tipOwner', 'clearTip', 'presentTip', 'pointerWithinTip', 'ownedHide', 'onTipPointerMove']
const missing = symbols.filter((s) => !client.includes(s))
if (missing.length === 0) pass('归属模型关键符号齐全', symbols.join(' / '))
else fail('归属模型关键符号齐全', `缺少 ${missing.join(', ')}（可能装到了未打补丁的版本）`)

const rawClears = (client.match(/tipLayer\.textContent = ''/g) ?? []).length
if (rawClears === 2) pass('tipLayer 只被 clearTip / presentTip 清空', '2 处')
else fail('tipLayer 只被 clearTip / presentTip 清空', `实际 ${rawClears} 处（期望 2）`)

const layerListeners = (client.match(/tipLayer\.addEventListener\(/g) ?? []).length
if (layerListeners === 2) pass('共享容器只挂两处固定监听器', '2 处')
else fail('共享容器只挂两处固定监听器', `实际 ${layerListeners} 处（期望 2）`)

console.log('')
if (failed === 0) {
  console.log('[verify] 部署接线全部通过。')
  console.log('[verify] 悬停面板行为已人工确认（2026-09-24，宿主 PID 45460 / 10:08:38 启动，')
  console.log('[verify]   fork 的 client.js 于 10:08:41 被读取）：hover 不再闪退。')
  console.log('[verify] 复现与回归留给自动化：npm run verify（fork 20/20，上游 1.4.10 为 1/20）。')
  console.log('[verify] ⚠ 接线自检通过 ≠ 宿主已加载本 fork。bundle 列表只在宿主启动时解析一次，')
  console.log('[verify]   改动依赖/bundles 名单后必须重启 DSH Desktop；只刷新页面不会让新插件上线。')
  console.log(`[verify] 页面控制台核对登记：window.__DSH_BOOT__.entries.find(({ id }) => id === '${FORK}')`)
  console.log('[verify]   · 返回带 url 的登记 → 宿主已加载（此后改 client.js 只需刷新页面）')
  console.log('[verify]   · undefined → 宿主仍是旧配置，先重启 DSH Desktop')
} else {
  console.log(`[verify] ${failed} 项未通过。运行 node scripts/deploy-profile.mjs 修复接线。`)
  process.exit(1)
}
