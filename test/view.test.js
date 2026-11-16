import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildView, modeText, panelData, proxyModeText, statusText, supportsV2 } from '../lib/view.js'

const caps = {
  locale: 'zh-CN',
  components: ['tabs', 'form', 'number', 'select', 'segmented', 'textField', 'toggle', 'actions', 'list', 'keyValue', 'callout', 'text', 'codeBlock'],
}

const baseSettings = {
  startMode: 'serve', proxyMode: 'off', proxy: '', autoStart: true,
  gatewayPort: 3425, webPort: 3430, webKey: '',
}

function state(patch = {}) {
  return {
    platformOk: true, installed: true, version: 'magpie 0.9.2', running: true, owned: true,
    installing: false, mode: 'serve', gatewayPort: 3425, webPort: 3430, webKeySet: false,
    gatewayUrl: 'http://127.0.0.1:3425', webUrl: '', needsRestart: false,
    lastError: '', logTail: 'line one', settings: { ...baseSettings }, ...patch,
  }
}

const flat = view => JSON.stringify(view)

test('有 v2 能力时给两个页签：网关 / 设置', () => {
  assert.equal(supportsV2(caps), true)
  const view = buildView(state(), caps, baseSettings)
  assert.equal(view.v, 2)
  const tabs = view.children[0]
  assert.equal(tabs.type, 'tabs')
  assert.deepEqual(tabs.items.map(item => item.label), ['网关', '设置'])
  assert.ok(flat(view).includes('"submit":"save"'))
})

test('仅网关模式不出现网页版地址和网页版设置项', () => {
  const view = flat(buildView(state(), caps, baseSettings))
  assert.equal(view.includes('网页版（web）') && state().settings.startMode === 'web', false)
  assert.equal(view.includes('data.form.webPort'), false)
  assert.equal(view.includes('data.form.webKey'), false)
  assert.equal(view.includes('copyWeb'), false)
  assert.equal(view.includes('127.0.0.1:3430'), false)
})

test('网页版模式出现 web 端口、key 与复制项；地址由数据绑定给出', () => {
  const settings = { ...baseSettings, startMode: 'web', webPort: 3430, webKey: 'k'.repeat(20) }
  const webUrl = `http://127.0.0.1:3430/?k=${'k'.repeat(20)}`
  const view = flat(buildView(state({ settings, webUrl, mode: 'web' }), caps, settings))
  assert.ok(view.includes('data.form.webPort'))
  assert.ok(view.includes('data.form.webKey'))
  assert.ok(view.includes('copyWeb'))
  assert.ok(view.includes('data.webUrlText'))
  assert.equal(panelData(state({ settings, webUrl, mode: 'web' }), settings).webUrlText, webUrl)
})

test('不用代理时不显示代理地址输入框；选了代理才显示', () => {
  assert.equal(flat(buildView(state(), caps, baseSettings)).includes('"bind":"data.form.proxy"'), false)
  const withProxy = { ...baseSettings, proxyMode: 'fallback', proxy: 'http://127.0.0.1:10808' }
  assert.ok(flat(buildView(state({ settings: withProxy }), caps, withProxy)).includes('"bind":"data.form.proxy"'))
})

test('缺 v2 组件时退回只读 v1 摘要，且不含表单绑定', () => {
  for (const bad of [{ locale: 'en-US' }, { locale: 'en-US', components: ['stack', 'text'] }, undefined]) {
    const view = buildView(state(), bad, baseSettings)
    assert.equal(view.v, undefined)
    assert.equal(view.type, 'stack')
    assert.equal(JSON.stringify(view).includes('"bind"'), false)
  }
})

test('状态与模式文案', () => {
  assert.equal(statusText({ ...state(), installed: false }, caps), '未安装')
  assert.equal(statusText({ ...state(), owned: false }, caps), '运行中（已在别处启动）')
  assert.equal(statusText({ ...state(), running: false }, caps), '已安装，未运行')
  assert.equal(statusText({ ...state(), platformOk: false }, { locale: 'en-US' }), 'Linux hosts only')
  assert.equal(modeText(state({ mode: 'web' }), caps), '网关 + 网页（magpie web）')
  assert.equal(proxyModeText('off', caps), '不用代理')
})

test('面板数据带完整表单草稿', () => {
  const data = panelData(state(), baseSettings)
  assert.deepEqual(Object.keys(data.form).sort(), ['autoStart', 'gatewayPort', 'proxy', 'proxyMode', 'startMode', 'webKey', 'webPort'])
})

test('日志用 codeBlock（固定高度可滚动），缺这个组件时退回纯文本', () => {
  const withBlock = buildView(state({ logTail: 'a\nb\nc' }), caps, baseSettings)
  const gateway = withBlock.children[0].items[0].children
  const block = gateway.find(node => node.type === 'codeBlock')
  assert.ok(block)
  assert.equal(block.code, 'a\nb\nc')
  const noBlockCaps = { ...caps, components: caps.components.filter(name => name !== 'codeBlock') }
  const noBlock = buildView(state({ logTail: 'a\nb\nc' }), noBlockCaps, baseSettings)
  const textLike = noBlock.children[0].items[0].children.some(node => node.type === 'text' && node.text === 'a\nb\nc')
  assert.equal(textLike, true)
  assert.equal(JSON.stringify(noBlock).includes('"type":"codeBlock"'), false)
})

test('视图在预算内：面板 ≤ 120 节点 / 8 层 / 32 KiB', () => {
  const settings = { ...baseSettings, startMode: 'web', proxyMode: 'fallback', proxy: 'http://127.0.0.1:10808', webKey: 'k'.repeat(20) }
  const view = buildView(state({ settings, webUrl: 'http://127.0.0.1:3430/?k=' + 'k'.repeat(20) }), caps, settings)
  let nodes = 0
  let depth = 0
  const walk = (node, level) => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) { for (const item of node) walk(item, level); return }
    if (typeof node.type === 'string') { nodes += 1; depth = Math.max(depth, level) }
    for (const [key, value] of Object.entries(node)) if (key !== 'text') walk(value, level + 1)
  }
  walk(view, 0)
  assert.ok(nodes <= 120, `nodes=${nodes}`)
  assert.ok(depth <= 8, `depth=${depth}`)
  assert.ok(Buffer.byteLength(JSON.stringify(view), 'utf8') <= 32 * 1024)
})




test('网关页结构：一份链接、两行按钮、按状态高亮', () => {
  const stopped = buildView(state({ canStart: true, canStop: false, running: false }), caps, baseSettings)
  const kids = stopped.children[0].items[0].children
  assert.deepEqual(kids.map(node => node.type), ['keyValue', 'list', 'text', 'actions', 'actions', 'codeBlock'])
  // 地址只出现在列表里，keyValue 不再重复
  const keyValueText = JSON.stringify(kids[0])
  assert.equal(keyValueText.includes('data.gatewayUrl'), false)
  assert.ok(JSON.stringify(kids[1]).includes('data.gatewayUrl'))
  // 第一行：启动 · 停止；停止不可用时启动是 primary
  assert.deepEqual(kids[3].items.map(item => item.action), ['start', 'stop'])
  assert.equal(kids[3].items[0].style, 'primary')
  assert.equal(kids[3].items[1].style, undefined)
  // 第二行：查看状态 · 安装
  assert.deepEqual(kids[4].items.map(item => item.action), ['status', 'install'])

  const running = buildView(state({ canStart: false, canStop: true, running: true, owned: true }), caps, baseSettings)
  const runningActions = running.children[0].items[0].children[3]
  assert.equal(runningActions.items[0].style, undefined)
  assert.equal(runningActions.items[1].style, 'primary')
})

test('网页版没设固定 key 时提示重启后重新复制', () => {
  const settings = { ...baseSettings, startMode: 'web', webKey: '' }
  const data = panelData(state({ settings, webKeyEphemeral: true }), settings)
  assert.match(data.noticeZh, /重新复制/)
  assert.match(data.noticeEn, /copy the web address again/)
  // 设了固定 key 就没有这条提示
  const fixed = { ...baseSettings, startMode: 'web', webKey: 'k'.repeat(20) }
  assert.equal(panelData(state({ settings: fixed, webKeyEphemeral: false }), fixed).noticeZh.includes('重新复制'), false)
})
