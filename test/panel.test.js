import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'

const caps = {
  locale: 'zh-CN',
  components: ['tabs', 'form', 'number', 'select', 'segmented', 'textField', 'toggle', 'actions', 'list', 'keyValue', 'callout', 'text', 'codeBlock'],
}

function stubContext() {
  const panels = []
  const cleanups = []
  const ctx = {
    effect(fn) {
      const cleanup = fn()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
      return cleanup
    },
    inject(deps, fn) {
      assert.deepEqual(deps, ['dshGo'])
      fn({ dshGo: { panel(id, definition) { panels.push({ id, definition }) } } })
    },
  }
  return { ctx, panels, cleanups }
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'magpie-panel-'))
  const settingsPath = join(dir, 'settings.json')
  const { ctx, panels, cleanups } = stubContext()
  apply(ctx, { settingsPath })
  const panel = panels[0]
  const dispose = () => {
    for (const cleanup of cleanups) cleanup()
    rmSync(dir, { recursive: true, force: true })
  }
  return { panel, settingsPath, dispose }
}

const values = {
  'data.form.startMode': 'web',
  'data.form.proxyMode': 'always',
  'data.form.proxy': 'http://127.0.0.1:7890',
  'data.form.autoStart': false,
  'data.form.gatewayPort': 4000,
  'data.form.webPort': 4001,
  'data.form.webKey': 'k'.repeat(20),
}

test('清单里声明的面板 id 与注册的一致，data 推一份带完整 form 的快照', () => {
  const { panel, dispose } = setup()
  try {
    assert.equal(panel.id, 'magpie')
    const emitted = []
    const off = panel.definition.data({}, data => emitted.push(data))
    assert.deepEqual(Object.keys(emitted[0].form).sort(), ['autoStart', 'gatewayPort', 'proxy', 'proxyMode', 'startMode', 'webKey', 'webPort'])
    assert.equal(emitted[0].form.proxyMode, 'off')
    assert.equal(emitted[0].form.proxy, '')
    off()
  } finally {
    dispose()
  }
})

test('保存：校验、落盘，并回 patch + refresh + toast（内容随设置同步）', () => {
  const { panel, settingsPath, dispose } = setup()
  try {
    const effects = panel.definition.actions.save({}, { value: { values } })
    assert.deepEqual(effects.map(effect => effect.type), ['patch', 'refresh', 'toast'])
    assert.deepEqual(JSON.parse(readFileSync(settingsPath, 'utf8')), {
      startMode: 'web', proxyMode: 'always', proxy: 'http://127.0.0.1:7890', autoStart: false,
      gatewayPort: 4000, webPort: 4001, webKey: 'k'.repeat(20),
    })
    assert.equal(effects[0].data.form.gatewayPort, 4000)
    // 保存后视图应立刻按新设置渲染：出现 web 端口与 key 字段
    const view = JSON.stringify(panel.definition.view({}, caps))
    assert.ok(view.includes('data.form.webPort'))
    assert.ok(view.includes('data.form.webKey'))
    assert.ok(view.includes('data.form.proxy'))
  } finally {
    dispose()
  }
})

test('保存坏值只回提示，不写盘', () => {
  const { panel, settingsPath, dispose } = setup()
  try {
    const samePort = panel.definition.actions.save({}, { value: { values: { ...values, 'data.form.webPort': 4000 } } })
    assert.equal(samePort.type, undefined)
    assert.match(samePort.toast, /不能相同/)
    const noProxy = panel.definition.actions.save({}, { value: { values: { ...values, 'data.form.proxy': '' } } })
    assert.match(noProxy.toast, /没填代理地址/)
    assert.equal(existsSync(settingsPath), false)
  } finally {
    dispose()
  }
})

test('onChange 只回 patch + refresh，并让字段显隐立刻变化', () => {
  const { panel, dispose } = setup()
  try {
    const effects = panel.definition.actions.change({}, { value: { bind: 'data.form.startMode', value: 'web' } })
    assert.deepEqual(effects.map(effect => effect.type), ['patch', 'refresh'])
    assert.ok(JSON.stringify(panel.definition.view({}, caps)).includes('data.form.webPort'))
    const proxy = panel.definition.actions.change({}, { value: { bind: 'data.form.proxyMode', value: 'always' } })
    assert.deepEqual(proxy.map(effect => effect.type), ['patch', 'refresh'])
    assert.ok(JSON.stringify(panel.definition.view({}, caps)).includes('data.form.proxy'))
  } finally {
    dispose()
  }
})

test('复制网页地址只在网页版模式给，并带 key', () => {
  const { panel, dispose } = setup()
  try {
    assert.match(panel.definition.actions.copyWeb().toast, /不是网页版/)
    panel.definition.actions.save({}, { value: { values } })
    const copied = panel.definition.actions.copyWeb()
    assert.match(copied.copy, /^http:\/\/127\.0\.0\.1:4001\/\?k=k{20}$/)
    assert.equal(panel.definition.actions.copyGateway().copy, 'http://127.0.0.1:4000')
  } finally {
    dispose()
  }
})

