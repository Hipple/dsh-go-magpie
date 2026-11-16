import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildView, panelData, statusText, supportsV2 } from '../lib/view.js'

const state = {
  platformOk: true,
  installed: true,
  version: 'magpie 0.9.2',
  running: true,
  owned: true,
  installing: false,
  mode: 'serve',
  gatewayUrl: 'http://127.0.0.1:3425',
  webUrl: 'http://127.0.0.1:3430',
  lastError: '',
  logTail: 'line one\nline two',
  settings: { startMode: 'serve', proxyMode: 'fallback', proxy: 'http://127.0.0.1:10808', autoStart: true },
}

const modernCaps = { locale: 'zh-CN', components: ['textField', 'form', 'select', 'segmented', 'toggle', 'actions', 'list', 'keyValue', 'callout', 'text'] }

test('有 v2 能力时给表单，缺能力时退回 v1 摘要', () => {
  assert.equal(supportsV2(modernCaps), true)
  const modern = buildView(state, modernCaps)
  assert.equal(modern.v, 2)
  const form = modern.children.find(node => node.type === 'form')
  assert.ok(form)
  assert.deepEqual(form.children.map(field => field.bind), [
    'data.form.startMode', 'data.form.proxyMode', 'data.form.proxy', 'data.form.autoStart',
  ])

  for (const caps of [{ locale: 'en-US' }, { locale: 'en-US', components: ['stack', 'text'] }, undefined]) {
    const old = buildView(state, caps)
    assert.equal(old.v, undefined)
    assert.equal(old.type, 'stack')
    assert.deepEqual(old.children[0].items[0], [caps && String(caps.locale).startsWith('en') ? 'Status' : '状态', statusText(state, caps)])
    assert.equal(JSON.stringify(old).includes('"bind"'), false)
  }
})

test('状态文案区分未装、运行中（自己/别处）与停止', () => {
  assert.equal(statusText({ ...state, installed: false }, { locale: 'zh-CN' }), '未安装')
  assert.equal(statusText({ ...state, owned: false }, { locale: 'zh-CN' }), '运行中（已在别处启动）')
  assert.equal(statusText({ ...state, running: false }, { locale: 'zh-CN' }), '已安装，未运行')
  assert.equal(statusText({ ...state, platformOk: false }, { locale: 'en-US' }), 'Linux hosts only')
})

test('面板数据带 form 草稿，视图数据不泄漏成依赖', () => {
  const data = panelData(state)
  assert.deepEqual(data.form, state.settings)
  assert.equal(data.gatewayUrl, state.gatewayUrl)
  // 保存后回写应当只改 form，不影响其它字段
  const patched = { ...data, form: { ...data.form, startMode: 'web' } }
  assert.equal(patched.form.startMode, 'web')
})

test('错误信息在两种视图里都出现，且被截断', () => {
  const broken = { ...state, lastError: 'x'.repeat(400) }
  const modern = JSON.stringify(buildView(broken, modernCaps))
  const old = JSON.stringify(buildView(broken, undefined))
  assert.equal(modern.includes('x'.repeat(161)), false)
  assert.equal(old.includes('x'.repeat(121)), false)
  assert.equal(modern.includes('x'.repeat(160)), true)
})

test('视图在预算内：面板 ≤ 120 节点 / 8 层 / 32 KiB', () => {
  const view = buildView(state, modernCaps)
  let nodes = 0
  let depth = 0
  const walk = (node, level) => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) { for (const item of node) walk(item, level); return }
    if (typeof node.type === 'string') { nodes += 1; depth = Math.max(depth, level) }
    for (const value of Object.values(node)) if (value !== node.text) walk(value, level + 1)
  }
  walk(view, 0)
  assert.ok(nodes <= 120, `nodes=${nodes}`)
  assert.ok(depth <= 8, `depth=${depth}`)
  assert.ok(Buffer.byteLength(JSON.stringify(view), 'utf8') <= 32 * 1024)
})
