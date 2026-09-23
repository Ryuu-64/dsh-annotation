// 把本 fork 接入 DSH desktop profile：改 profile 的依赖与 bundle 列表，然后跑 pnpm。
//
// 用法：
//   node scripts/deploy-profile.mjs             # 接入（幂等，可反复运行）
//   node scripts/deploy-profile.mjs --remove     # 退回到纯上游
//   node scripts/deploy-profile.mjs --profile web
//   node scripts/deploy-profile.mjs --no-install # 只改清单，不跑 pnpm
//
// 做三件事：
//   1. dependencies: 删掉上游包，写入 "link:<本仓库绝对路径>"
//   2. dsh.profile.bundles: 用本 fork 的包名替换上游包名（数组是「包名字符串」，
//      由 desktop-plugins 的 safePackageName 校验，改包名是被支持的路径）
//   3. 在 profile 目录跑 pnpm install，让 node_modules 出现指向本仓库的链接
//
// 注意：包名必须与 client.js 里 ModuleLoader 的 id 严格一致，否则浏览器端
// client-modules 会拒绝注册（bundle loaded without registering "..."）。

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const UPSTREAM = '@changfenhuang/dsh-annotation'
const FORK = '@ryuu-64/dsh-annotation'
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function argOf(flag, fallback) {
  const i = process.argv.indexOf(flag)
  return i === -1 ? fallback : process.argv[i + 1]
}

const profileName = argOf('--profile', 'desktop')
const remove = process.argv.includes('--remove')
const noInstall = process.argv.includes('--no-install')
const dryRun = process.argv.includes('--dry-run')

const dshHome = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh')
const profileDir = join(dshHome, 'profiles', profileName)
const manifestPath = join(profileDir, 'package.json')

if (!existsSync(manifestPath)) {
  console.error(`[deploy-profile] 找不到 profile 清单：${manifestPath}`)
  console.error('[deploy-profile] 用 --profile <名字> 指定其它 profile。')
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.dependencies ??= {}
manifest.dsh ??= {}
manifest.dsh.profile ??= {}
manifest.dsh.profile.bundles ??= []

const before = JSON.stringify(manifest)

if (remove) {
  delete manifest.dependencies[FORK]
  manifest.dependencies[UPSTREAM] = manifest.dependencies[UPSTREAM] ?? '^1.4.10'
  manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.map((b) => (b === FORK ? UPSTREAM : b))
} else {
  // link: 用正斜杠路径，Windows 上 pnpm 也能识别
  const linkTarget = repoRoot.replace(/\\/g, '/')
  delete manifest.dependencies[UPSTREAM]
  manifest.dependencies[FORK] = `link:${linkTarget}`

  const bundles = manifest.dsh.profile.bundles
  const at = bundles.indexOf(UPSTREAM)
  const forkAt = bundles.indexOf(FORK)
  if (forkAt !== -1) {
    // 已接入
  } else if (at !== -1) {
    bundles[at] = FORK
  } else {
    bundles.push(FORK)
  }
}

if (JSON.stringify(manifest) === before) {
  console.log('[deploy-profile] 清单已是目标状态，无需改动。')
} else if (dryRun) {
  console.log('[deploy-profile] --dry-run：清单需要改动，但不写入。将改为：')
  console.log(JSON.stringify({ dependencies: manifest.dependencies, bundles: manifest.dsh.profile.bundles }, null, 2))
  console.log('[deploy-profile] 去掉 --dry-run 即真正写入。')
  process.exit(0)
} else {
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(`[deploy-profile] 已更新 ${manifestPath}`)
  console.log(remove ? `  依赖 → ${UPSTREAM}` : `  依赖 → ${FORK} (link:${repoRoot})`)
}

if (noInstall) {
  console.log('[deploy-profile] --no-install：请自行在 profile 目录运行 pnpm install。')
  process.exit(0)
}

console.log(`[deploy-profile] 在 ${profileDir} 运行 pnpm install …`)
try {
  execFileSync('pnpm', ['install', '--config.confirmModulesPurge=false'], {
    cwd: profileDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
} catch (err) {
  console.error('[deploy-profile] pnpm install 失败：', err.message)
  process.exit(1)
}

console.log('[deploy-profile] 完成。刷新 DSH Web 页面（或重启 DSH Desktop）后生效。')
console.log('')
console.log('[deploy-profile] ⚠ 重要：bundle 列表只在宿主启动时解析一次，因此「改依赖/bundles 名单」')
console.log('  这类改动必须重启 DSH Desktop 才生效 —— 仅仅刷新页面不会让新插件上线。')
console.log('  自检方法（确认宿主是否已经加载本 fork）：')
console.log('    1) 页面控制台：')
console.log(`       window.__DSH_BOOT__.entries.find(({ id }) => id === '${remove ? UPSTREAM : FORK}')`)
console.log('       返回带 url 的登记 = 已加载；undefined = 宿主还是旧配置，需要重启。')
console.log('    2) 源码改动（client.js 等）不需要重启：宿主按请求组装 bundle，刷新页面即可。')
console.log('')
console.log('[deploy-profile] Node half 是空实现，真正的功能全在 client.js。')
