import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'

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

test('清单里声明的面板 id 与注册的一致，data 会推一份带 form 的快照', () => {
  const dir = mkdtempSync(join(tmpdir(), 'magpie-panel-'))
  try {
    const { ctx, panels, cleanups } = stubContext()
    apply(ctx, { settingsPath: join(dir, 'settings.json') })
    assert.equal(panels.length, 1)
    assert.equal(panels[0].id, 'magpie')

    const emitted = []
    const off = panels[0].definition.data({}, data => emitted.push(data))
    assert.equal(emitted.length >= 1, true)
    assert.deepEqual(Object.keys(emitted[0].form).sort(), ['autoStart', 'proxy', 'proxyMode', 'startMode'])
    off()
    for (const cleanup of cleanups) cleanup()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('保存动作校验并落盘，返回 patch + toast', () => {
  const dir = mkdtempSync(join(tmpdir(), 'magpie-save-'))
  try {
    const settingsPath = join(dir, 'settings.json')
    const { ctx, panels, cleanups } = stubContext()
    apply(ctx, { settingsPath })
    const save = panels[0].definition.actions.save

    const ok = save({}, { value: { values: {
      'data.form.startMode': 'web',
      'data.form.proxyMode': 'always',
      'data.form.proxy': 'http://127.0.0.1:7890',
      'data.form.autoStart': false,
    } } })
    assert.deepEqual(ok.map(effect => effect.type), ['patch', 'toast'])
    assert.deepEqual(JSON.parse(readFileSync(settingsPath, 'utf8')), {
      startMode: 'web', proxyMode: 'always', proxy: 'http://127.0.0.1:7890', autoStart: false,
    })
    assert.equal(ok[0].data.form.startMode, 'web')

    const bad = save({}, { value: { values: {
      'data.form.startMode': 'serve',
      'data.form.proxyMode': 'fallback',
      'data.form.proxy': '127.0.0.1:10808',
      'data.form.autoStart': true,
    } } })
    assert.deepEqual(bad.type, undefined)
    assert.match(bad.toast, /代理/)
    // 坏输入不改动已保存的值
    assert.equal(JSON.parse(readFileSync(settingsPath, 'utf8')).startMode, 'web')
    for (const cleanup of cleanups) cleanup()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('复制动作给出地址与提示', () => {
  const dir = mkdtempSync(join(tmpdir(), 'magpie-copy-'))
  try {
    const { ctx, panels, cleanups } = stubContext()
    apply(ctx, { settingsPath: join(dir, 'settings.json') })
    const { actions } = panels[0].definition
    assert.equal(actions.copyGateway().copy, 'http://127.0.0.1:3425')
    assert.equal(actions.copyWeb().copy, 'http://127.0.0.1:3430')
    assert.equal(typeof actions.start().toast, 'string')
    assert.equal(typeof actions.stop().toast, 'string')
    for (const cleanup of cleanups) cleanup()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
