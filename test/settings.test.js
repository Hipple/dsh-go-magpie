import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, normalizeProxy, normalizeSettings, loadSettings, saveSettings } from '../lib/settings.js'

test('代理地址只接受完整 URL，空串表示不填', () => {
  assert.equal(normalizeProxy('   '), '')
  assert.equal(normalizeProxy('http://127.0.0.1:10808'), 'http://127.0.0.1:10808')
  assert.equal(normalizeProxy(' https://proxy.example.com:8443 '), 'https://proxy.example.com:8443')
  assert.equal(normalizeProxy('socks5h://127.0.0.1:1080'), 'socks5h://127.0.0.1:1080')
  assert.throws(() => normalizeProxy('127.0.0.1:10808'), TypeError)
  assert.throws(() => normalizeProxy('ftp://127.0.0.1'), TypeError)
  assert.throws(() => normalizeProxy(`http://${'a'.repeat(300)}`), TypeError)
  assert.throws(() => normalizeProxy('http://a b'), TypeError)
})

test('不认识的值退回默认，坏代理不拖垮整份设置', () => {
  assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS)
  assert.deepEqual(normalizeSettings({ startMode: 'nope', proxyMode: 'nope', autoStart: 'yes' }), DEFAULT_SETTINGS)
  const kept = normalizeSettings({ startMode: 'web', proxyMode: 'always', proxy: 'http://127.0.0.1:7890', autoStart: false })
  assert.deepEqual(kept, { startMode: 'web', proxyMode: 'always', proxy: 'http://127.0.0.1:7890', autoStart: false })
  const badProxy = normalizeSettings({ proxy: 'not-a-url' })
  assert.equal(badProxy.proxy, DEFAULT_SETTINGS.proxy)
})

test('设置能落盘并读回；文件缺失时用默认值', () => {
  const dir = mkdtempSync(join(tmpdir(), 'magpie-settings-'))
  try {
    const path = join(dir, 'nested', 'settings.json')
    assert.deepEqual(loadSettings(path), DEFAULT_SETTINGS)
    const saved = saveSettings(path, { startMode: 'web', proxyMode: 'off', proxy: '', autoStart: false })
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), saved)
    assert.deepEqual(loadSettings(path), saved)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
