import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_SETTINGS, normalizeProxy, normalizePort, normalizeWebKey,
  normalizeSettings, validateSettings, loadSettings, saveSettings,
} from '../lib/settings.js'

test('默认不启用代理，代理地址为空', () => {
  assert.equal(DEFAULT_SETTINGS.proxyMode, 'off')
  assert.equal(DEFAULT_SETTINGS.proxy, '')
  assert.equal(DEFAULT_SETTINGS.gatewayPort, 3425)
  assert.equal(DEFAULT_SETTINGS.webPort, 3430)
  assert.equal(DEFAULT_SETTINGS.webKey, '')
})

test('代理地址只接受完整 URL，空串表示不填', () => {
  assert.equal(normalizeProxy('   '), '')
  assert.equal(normalizeProxy('http://127.0.0.1:10808'), 'http://127.0.0.1:10808')
  assert.equal(normalizeProxy(' https://proxy.example.com:8443 '), 'https://proxy.example.com:8443')
  assert.equal(normalizeProxy('socks5h://127.0.0.1:1080'), 'socks5h://127.0.0.1:1080')
  assert.throws(() => normalizeProxy('127.0.0.1:10808'), TypeError)
  assert.throws(() => normalizeProxy('ftp://127.0.0.1'), TypeError)
  assert.throws(() => normalizeProxy(`http://${'a'.repeat(300)}`), TypeError)
})

test('端口与网页版 key 的边界', () => {
  assert.equal(normalizePort('8080', 1), 8080)
  assert.equal(normalizePort(0, 3425), 3425)
  assert.equal(normalizePort(70000, 3425), 3425)
  assert.equal(normalizePort('abc', 3425), 3425)
  assert.equal(normalizeWebKey(''), '')
  assert.equal(normalizeWebKey('k'.repeat(16)), 'k'.repeat(16))
  assert.equal(normalizeWebKey('short'), '')
  assert.equal(normalizeWebKey('bad key with spaces 1234'), '')
})

test('不认识的值退回默认；端口相同会被拉开', () => {
  assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS)
  assert.deepEqual(normalizeSettings({ startMode: 'nope', proxyMode: 'nope', autoStart: 'yes' }), DEFAULT_SETTINGS)
  const kept = normalizeSettings({ startMode: 'web', proxyMode: 'always', proxy: 'http://127.0.0.1:7890', autoStart: false })
  assert.equal(kept.startMode, 'web')
  assert.equal(kept.proxyMode, 'always')
  const collision = normalizeSettings({ gatewayPort: 3430, webPort: 3430 })
  assert.notEqual(collision.gatewayPort, collision.webPort)
})

test('保存前的严格校验会拒绝明显错误', () => {
  assert.throws(() => validateSettings({ gatewayPort: 0, webPort: 3430, proxyMode: 'off', proxy: '', webKey: '' }), /网关端口/)
  assert.throws(() => validateSettings({ gatewayPort: 3425, webPort: 3425, proxyMode: 'off', proxy: '', webKey: '' }), /不能相同/)
  assert.throws(() => validateSettings({ gatewayPort: 3425, webPort: 3430, proxyMode: 'fallback', proxy: '', webKey: '' }), /没填代理地址/)
  assert.throws(() => validateSettings({ gatewayPort: 3425, webPort: 3430, proxyMode: 'off', proxy: '', webKey: 'short' }), /至少 16/)
  const ok = validateSettings({ gatewayPort: '3425', webPort: '3430', proxyMode: 'off', proxy: '  ', autoStart: true, webKey: 'k'.repeat(16) })
  assert.equal(ok.gatewayPort, 3425)
  assert.equal(ok.proxy, '')
})

test('设置能落盘并读回；文件缺失时用默认值', () => {
  const dir = mkdtempSync(join(tmpdir(), 'magpie-settings-'))
  try {
    const path = join(dir, 'nested', 'settings.json')
    assert.deepEqual(loadSettings(path), DEFAULT_SETTINGS)
    const saved = saveSettings(path, { startMode: 'web', proxyMode: 'always', proxy: 'http://127.0.0.1:7890', autoStart: false, gatewayPort: 4000, webPort: 4001, webKey: 'z'.repeat(20) })
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), saved)
    assert.deepEqual(loadSettings(path), saved)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
