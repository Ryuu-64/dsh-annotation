import assert from 'node:assert/strict'
import test from 'node:test'
import { pluginClientUrl } from '../scripts/plugin-client-url.mjs'

const page = 'http://127.0.0.1:3190/?token=abc'

test('文档相对的 combo 路由解析到 /plugins/，不把路径粘进端口', () => {
  assert.equal(
    pluginClientUrl(page, 'plugins/??@ryuu-64/dsh-annotation/client.js&rev=99'),
    'http://127.0.0.1:3190/plugins/??@ryuu-64/dsh-annotation/client.js&rev=99',
  )
})

test('旧宿主的绝对路径和已经绝对的 URL 保持原样', () => {
  assert.equal(
    pluginClientUrl(page, '/plugins/@ryuu-64/dsh-annotation/client.js'),
    'http://127.0.0.1:3190/plugins/@ryuu-64/dsh-annotation/client.js',
  )
  assert.equal(
    pluginClientUrl(page, 'http://127.0.0.1:3190/plugins/@ryuu-64/dsh-annotation/client.js'),
    'http://127.0.0.1:3190/plugins/@ryuu-64/dsh-annotation/client.js',
  )
})
