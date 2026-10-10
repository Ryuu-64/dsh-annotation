import assert from 'node:assert/strict'
import test from 'node:test'
import { compareDshTags, latestDshTag, tagNamesFromLsRemote } from '../scripts/resolve-dsh-tag.mjs'

test('语义化比较：数字补丁、预发布顺序、正式版高于预发布', () => {
  assert.ok(compareDshTags('dsh-v0.1.10', 'dsh-v0.1.9') > 0)
  assert.ok(compareDshTags('dsh-v0.1.2-rc.1', 'dsh-v0.1.2-alpha.5') > 0)
  assert.ok(compareDshTags('dsh-v0.1.0-rc.10', 'dsh-v0.1.0-rc.2') > 0)
  assert.ok(compareDshTags('dsh-v0.2.0', 'dsh-v0.2.0-rc.2') > 0)
  assert.ok(compareDshTags('dsh-v0.2.0-rc.2', 'dsh-v0.1.7-rc.2') > 0)
  assert.equal(compareDshTags('dsh-v0.1.6-alpha.1', 'dsh-v0.1.6-alpha.1'), 0)
})

test('最高标签忽略非 dsh-v 引用和注解标签剥除行', () => {
  const names = tagNamesFromLsRemote([
    'abc\trefs/tags/dsh-v0.1.2-rc.1',
    'def\trefs/tags/dsh-v0.2.0-rc.2',
    'def\trefs/tags/dsh-v0.2.0-rc.2^{}',
    'ghi\trefs/tags/dsh-v0.1.7-rc.2',
    'jkl\trefs/tags/not-a-release',
  ].join('\n'))
  assert.deepEqual(names, [
    'dsh-v0.1.2-rc.1',
    'dsh-v0.2.0-rc.2',
    'dsh-v0.1.7-rc.2',
    'not-a-release',
  ])
  assert.equal(latestDshTag(names), 'dsh-v0.2.0-rc.2')
  assert.equal(latestDshTag(['nightly', 'v1.0.0']), null)
})
