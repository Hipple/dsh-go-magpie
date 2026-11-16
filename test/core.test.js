import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createController, parseAddr, proxyEndpoint } from '../lib/core.js'

function makeDeps() {
  const spawned = []
  return {
    spawned,
    run: () => ({ ok: true, status: 0, error: '', output: 'magpie 1.2.3' }),
    runAsync: async () => ({ ok: true, status: 0, error: '', output: '' }),
    spawn: (bin, args) => {
      const child = {
        pid: 4242,
        killed: false,
        kill() { this.killed = true },
        on() {},
        once() {},
      }
      spawned.push({ bin, args, child })
      return child
    },
    probe: async () => false,
    exit: (child, cb) => { child.emitExit = cb },
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

test('magpie web 用 web 子命令启动，stop 会结束它', () => {
  const box = sandbox()
  try {
    writeFileSync(join(box.binDir, 'magpie'), '#!/bin/sh\nexit 0\n')
    const deps = makeDeps()
    const controller = createController({
      platform: 'linux', binDir: box.binDir, stateDir: box.stateDir, deps,
      settings: { startMode: 'web', proxyMode: 'off', proxy: '', autoStart: false },
    })
    const started = controller.start()
    assert.equal(started.ok, true)
    assert.deepEqual(deps.spawned[0].args, ['web'])
    assert.equal(controller.snapshot().running, true)
    assert.equal(controller.snapshot().owned, true)

    const stopped = controller.stop()
    assert.equal(stopped.ok, true)
    assert.equal(deps.spawned[0].child.killed, true)
    controller.dispose()
  } finally {
    box.cleanup()
  }
})

test('serve 模式默认，且没有自己的子进程时 stop 不装作用', () => {
  const box = sandbox()
  try {
    writeFileSync(join(box.binDir, 'magpie'), '#!/bin/sh\nexit 0\n')
    const deps = makeDeps()
    const controller = createController({ platform: 'linux', binDir: box.binDir, stateDir: box.stateDir, deps })
    assert.equal(controller.snapshot().settings.startMode, 'serve')
    controller.start()
    assert.deepEqual(deps.spawned[0].args, ['serve'])
    controller.dispose()
    const idle = createController({ platform: 'linux', binDir: box.binDir, stateDir: box.stateDir, deps: makeDeps() })
    assert.equal(idle.stop().ok, false)
    idle.dispose()
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
