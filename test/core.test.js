import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { STALE_LOCK_MS, createController, isLockStale, keyFromText, parseAddr, proxyEndpoint, splitLogChunk } from '../lib/core.js'

function makeDeps(logText = '') {
  const spawned = []
  return {
    spawned,
    run: () => ({ ok: true, status: 0, error: '', output: 'magpie 1.2.3' }),
    runAsync: async () => ({ ok: true, status: 0, error: '', output: '' }),
    spawn: (bin, args, opts) => {
      const child = { pid: 4242, killed: false, kill() { this.killed = true }, on() {}, once() {} }
      spawned.push({ bin, args, opts, child })
      return child
    },
    probe: async () => false,
    exit: (child, cb) => { child.emitExit = cb },
    readLog: () => logText,
  }
}

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'magpie-core-'))
  const binDir = join(root, 'bin')
  const stateDir = join(root, 'state')
  mkdirSync(binDir, { recursive: true })
  return { root, binDir, stateDir, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('地址解析覆盖 IPv4、通配与 IPv6', () => {
  assert.deepEqual(parseAddr('127.0.0.1:3425', 999), { host: '127.0.0.1', port: 3425 })
  assert.deepEqual(parseAddr('0.0.0.0:3430', 999), { host: '127.0.0.1', port: 3430 })
  assert.deepEqual(parseAddr('[::1]:4000', 999), { host: '::1', port: 4000 })
  assert.deepEqual(parseAddr('localhost', 3425), { host: 'localhost', port: 3425 })
  assert.deepEqual(parseAddr('', 3430), { host: '127.0.0.1', port: 3430 })
})

test('代理 URL 能取出探测端口', () => {
  assert.deepEqual(proxyEndpoint('http://127.0.0.1:10808'), { host: '127.0.0.1', port: 10808 })
  assert.deepEqual(proxyEndpoint('socks5h://127.0.0.1:1080'), { host: '127.0.0.1', port: 1080 })
  assert.deepEqual(proxyEndpoint('https://proxy.example.com'), { host: 'proxy.example.com', port: 443 })
  assert.deepEqual(proxyEndpoint('nonsense'), { host: '127.0.0.1', port: 10808 })
})

test('从 magpie web 日志里取出 ?k= 的 key', () => {
  assert.equal(keyFromText('magpie web on http://127.0.0.1:3430/?k=0f3c9a1e5b7d4c2a'), '0f3c9a1e5b7d4c2a')
  assert.equal(keyFromText('no key here'), '')
  assert.equal(keyFromText('short ?k=abc'), '')
})

test('没装 magpie 时启动会被拒绝', () => {
  const box = sandbox()
  try {
    const controller = createController({ platform: 'linux', binDir: box.binDir, stateDir: box.stateDir, deps: makeDeps() })
    const result = controller.start()
    assert.equal(result.ok, false)
    assert.match(result.message, /还没装好/)
    controller.dispose()
  } finally {
    box.cleanup()
  }
})

test('网页版：--addr 用配置的 web 端口、--no-open、env 带 key，地址带 ?k=', () => {
  const box = sandbox()
  try {
    writeFileSync(join(box.binDir, 'magpie'), '#!/bin/sh\nexit 0\n')
    const deps = makeDeps()
    const controller = createController({
      platform: 'linux', binDir: box.binDir, stateDir: box.stateDir, deps,
      settings: { startMode: 'web', gatewayPort: 5000, webPort: 5001, webKey: 'k'.repeat(20), proxyMode: 'off' },
    })
    assert.equal(controller.start().ok, true)
    assert.deepEqual(deps.spawned[0].args, ['web', '--addr', '127.0.0.1:5001', '--no-open'])
    const env = deps.spawned[0].opts.env
    assert.equal(env.MAGPIE_ADDR, '127.0.0.1:5000')
    assert.equal(env.MAGPIE_WEB_KEY, 'k'.repeat(20))
    const state = controller.snapshot()
    assert.equal(state.gatewayUrl, 'http://127.0.0.1:5000')
    assert.equal(state.webUrl, `http://127.0.0.1:5001/?k=${'k'.repeat(20)}`)
    assert.equal(state.webKeySet, true)
    controller.dispose()
  } finally {
    box.cleanup()
  }
})

test('没配 key 时从日志里取 magpie 生成的 key', () => {
  const box = sandbox()
  try {
    writeFileSync(join(box.binDir, 'magpie'), '#!/bin/sh\nexit 0\n')
    const deps = makeDeps('magpie web on http://127.0.0.1:3430/?k=abcdef0123456789')
    const controller = createController({
      platform: 'linux', binDir: box.binDir, stateDir: box.stateDir, deps,
      settings: { startMode: 'web', proxyMode: 'off', webKey: '' },
    })
    assert.equal(controller.snapshot().webUrl, 'http://127.0.0.1:3430/?k=abcdef0123456789')
    controller.dispose()
  } finally {
    box.cleanup()
  }
})

test('仅网关模式：地址里没有 web，serve 不需要 web 参数', () => {
  const box = sandbox()
  try {
    writeFileSync(join(box.binDir, 'magpie'), '#!/bin/sh\nexit 0\n')
    const deps = makeDeps()
    const controller = createController({ platform: 'linux', binDir: box.binDir, stateDir: box.stateDir, deps })
    controller.start()
    assert.deepEqual(deps.spawned[0].args, ['serve'])
    assert.equal(deps.spawned[0].opts.env.MAGPIE_WEB_KEY, undefined)
    assert.equal(controller.snapshot().webUrl, '')
    controller.dispose()
  } finally {
    box.cleanup()
  }
})

test('保存新设置时如果是自己起的进程会重启，未运行则只更新', () => {
  const box = sandbox()
  try {
    writeFileSync(join(box.binDir, 'magpie'), '#!/bin/sh\nexit 0\n')
    const deps = makeDeps()
    const controller = createController({ platform: 'linux', binDir: box.binDir, stateDir: box.stateDir, deps })
    assert.equal(controller.setSettings({ startMode: 'web', proxyMode: 'off', webPort: 3430 }).restarted, false)
    controller.start()
    assert.equal(controller.snapshot().needsRestart, false)
    const saved = controller.setSettings({ startMode: 'serve', gatewayPort: 3500, proxyMode: 'off' })
    assert.equal(saved.restarted, true)
    assert.equal(controller.snapshot().needsRestart, true)
    controller.dispose()
  } finally {
    box.cleanup()
  }
})

test('非 Linux 平台不安装也不启动', async () => {
  const box = sandbox()
  try {
    writeFileSync(join(box.binDir, 'magpie'), '#!/bin/sh\nexit 0\n')
    const controller = createController({ platform: 'win32', binDir: box.binDir, stateDir: box.stateDir, deps: makeDeps() })
    assert.equal(await controller.ensureInstalled(), false)
    assert.equal(controller.start().ok, false)
    assert.equal(controller.snapshot().platformOk, false)
    controller.dispose()
  } finally {
    box.cleanup()
  }
})

test('日志文件在构造时清空，面板只显示本次启动以来的日志', () => {
  const box = sandbox()
  try {
    mkdirSync(box.stateDir, { recursive: true })
    writeFileSync(join(box.stateDir, 'autostart.log'), 'old run line\n')
    const controller = createController({ platform: 'linux', binDir: box.binDir, stateDir: box.stateDir, deps: makeDeps() })
    assert.equal(readFileSync(join(box.stateDir, 'autostart.log'), 'utf8'), '')
    controller.log('hello this run')
    assert.match(readFileSync(join(box.stateDir, 'autostart.log'), 'utf8'), /hello this run/)
    const shown = controller.snapshot().logTail
    assert.match(shown, /hello this run/)
    assert.equal(shown.includes('old run line'), false)
    controller.dispose()
  } finally {
    box.cleanup()
  }
})

test('上次中断留下的安装锁会被判定为过期', () => {
  const now = 1_700_000_000_000
  assert.equal(isLockStale(JSON.stringify({ pid: 999999, ts: now }), now, () => false), true)
  assert.equal(isLockStale(JSON.stringify({ pid: 4242, ts: now }), now, () => true), false)
  assert.equal(isLockStale(JSON.stringify({ ts: now - STALE_LOCK_MS - 1 }), now, () => true), true)
  assert.equal(isLockStale(JSON.stringify({ ts: now }), now, () => true), false)
  assert.equal(isLockStale('not json'), true)
  assert.equal(isLockStale('null'), true)
})

test('安装中断后再启动：接管过期锁并继续安装，不空等', async () => {
  const box = sandbox()
  try {
    mkdirSync(box.stateDir, { recursive: true })
    writeFileSync(join(box.stateDir, 'install.lock'), JSON.stringify({ pid: 999999, ts: Date.now() }))
    const deps = makeDeps()
    // 安装脚本“成功”后让 magpie 变得可用
    deps.runAsync = async (cmd, args) => {
      if (cmd === 'sh') writeFileSync(join(box.binDir, 'magpie'), '#!/bin/sh\nexit 0\n')
      return { ok: true, status: 0, error: '', output: '' }
    }
    const controller = createController({ platform: 'linux', binDir: box.binDir, stateDir: box.stateDir, deps })
    assert.equal(await controller.ensureInstalled(), true)
    assert.match(controller.snapshot().logTail, /已接管/)
    assert.equal(existsSync(join(box.stateDir, 'install.lock')), false)
    controller.dispose()
  } finally {
    box.cleanup()
  }
})

test('命令输出按行拆分：处理 \\r 进度条、去尾空白、限长', () => {
  assert.deepEqual(splitLogChunk('a\r\nb\rc\n\n  d  '), ['a', 'b', 'c', '  d'])
  assert.deepEqual(splitLogChunk('x'.repeat(500))[0].length, 400)
  assert.deepEqual(splitLogChunk(''), [])
})
