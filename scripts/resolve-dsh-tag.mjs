#!/usr/bin/env node
// 从 deepseek-ai/deepseek-harness 的 dsh-v* 标签里选出最高语义化版本。
// CI 冒烟和发布验收都走这里，避免把宿主钉死在过期 tag 上。

import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const TAG = /^dsh-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/
const REMOTE = 'https://github.com/deepseek-ai/deepseek-harness.git'

export function parseDshTag(name) {
  const match = TAG.exec(name)
  if (match === null) return null
  return {
    name,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] === undefined ? null : match[4].split('.'),
  }
}

function compareIdentifiers(left, right) {
  const leftNum = /^[0-9]+$/.test(left)
  const rightNum = /^[0-9]+$/.test(right)
  if (leftNum && rightNum) return Number(left) - Number(right)
  if (leftNum) return -1
  if (rightNum) return 1
  return left < right ? -1 : left > right ? 1 : 0
}

export function compareDshTags(leftName, rightName) {
  const left = parseDshTag(leftName)
  const right = parseDshTag(rightName)
  if (left === null || right === null) {
    throw new Error(`not a dsh tag: ${left === null ? leftName : rightName}`)
  }
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] - right[key]
  }
  if (left.pre === null && right.pre === null) return 0
  if (left.pre === null) return 1
  if (right.pre === null) return -1
  const length = Math.max(left.pre.length, right.pre.length)
  for (let index = 0; index < length; index++) {
    if (index >= left.pre.length) return -1
    if (index >= right.pre.length) return 1
    const order = compareIdentifiers(left.pre[index], right.pre[index])
    if (order !== 0) return order
  }
  return 0
}

export function latestDshTag(names) {
  const tags = names.filter(name => parseDshTag(name) !== null)
  if (tags.length === 0) return null
  return tags.reduce((best, name) => compareDshTags(name, best) > 0 ? name : best)
}

export function tagNamesFromLsRemote(output) {
  const names = []
  for (const line of output.split('\n')) {
    const ref = line.split('\t')[1]
    if (ref === undefined || !ref.startsWith('refs/tags/') || ref.endsWith('^{}')) continue
    names.push(ref.slice('refs/tags/'.length))
  }
  return names
}

function invokedAsCli() {
  const entry = process.argv[1]
  if (entry === undefined) return false
  return import.meta.url === pathToFileURL(resolve(entry)).href
}

if (invokedAsCli()) {
  const output = execFileSync('git', ['ls-remote', '--tags', REMOTE], { encoding: 'utf8' })
  const latest = latestDshTag(tagNamesFromLsRemote(output))
  if (latest === null) {
    console.error('deepseek-harness 上没有 dsh-v* 标签')
    process.exit(1)
  }
  console.log(latest)
}
