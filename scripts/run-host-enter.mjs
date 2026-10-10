#!/usr/bin/env node
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const arg = name => {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}
const host = resolve(arg('--host') ?? process.env.DSH_ROOT ?? '')
const plugin = resolve(arg('--plugin') ?? root)
const variant = arg('--variant')
if (!['historical', 'current'].includes(variant)) throw new Error('--variant must be historical or current')
const scenario = arg('--scenario') ?? 'enter'
if (!['enter', 'ime', 'ime-baseline'].includes(scenario)) throw new Error('--scenario must be enter, ime, or ime-baseline')
if (arg('--host') === undefined && process.env.DSH_ROOT === undefined) throw new Error('--host or DSH_ROOT is required')
const artifacts = resolve(arg('--artifacts') ?? join(root, '.artifacts/host-enter', variant))
const file = join(host, 'apps/web/tests/annotation-enter.e2e.ts')
const manifest = JSON.parse(await readFile(join(plugin, 'package.json'), 'utf8'))
if (manifest.name !== '@changfenhuang/dsh-annotation') throw new Error('Unexpected annotation package')
await readFile(join(plugin, 'lib/index.js'))
await readFile(join(plugin, 'client.js'))
await mkdir(artifacts, { recursive: true })
await copyFile(join(root, 'test/host-enter.e2e.ts'), file)
const env = { ...process.env, DSH_SNAPSHOT: 'replay', ANNOTATION_TEST_PLUGIN_DIR: plugin,
  ANNOTATION_TEST_HOST_VARIANT: variant, ANNOTATION_TEST_ARTIFACTS: artifacts, ANNOTATION_TEST_SCENARIO: scenario }
// The fixture is strictly keyless even on a developer machine with an
// ambient provider key. The host's web config may load .env; no record mode.
delete env.DEEPSEEK_API_KEY
try {
  const args = ['exec', 'vitest', process.argv.includes('--list') ? 'list' : 'run',
    '--config', 'vitest.web.config.ts', 'apps/web/tests/annotation-enter.e2e.ts']
  const status = await new Promise((resolveExit, reject) => {
    const child = spawn('pnpm', args, { cwd: host, env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', code => resolveExit(code ?? 1))
  })
  await writeFile(join(artifacts, 'run.json'), JSON.stringify({ host, plugin, variant, scenario,
    mode: process.argv.includes('--list') ? 'collection' : 'browser', status }, null, 2) + '\n')
  process.exitCode = status
} finally {
  await rm(file, { force: true })
}
