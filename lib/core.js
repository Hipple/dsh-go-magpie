// magpie 安装 / 启动 / 状态的核心逻辑。与 dsh-go 桥接无关：没有桥接时它照样装、照样起网关。
import { spawn, spawnSync } from 'node:child_process'
import {
  mkdirSync, openSync, closeSync, existsSync, appendFileSync, writeFileSync,
  unlinkSync, mkdtempSync, rmSync, symlinkSync, lstatSync, readlinkSync, readFileSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import net from 'node:net'
import { normalizeSettings } from './settings.js'

export const INSTALLER_URL = 'https://usemagpie.ai/install.sh'
export const DEFAULT_LINK_PATH = '/usr/local/bin/magpie'

/** 解析 `host:port`（含 IPv6 的 `[::1]:port`）；`0.0.0.0` / `::` / `*` 归一到 loopback。 */
export function parseAddr(raw, fallbackPort) {
  const text = String(raw ?? '').trim()
  const cut = text.lastIndexOf(':')
  if (cut < 0) {
    if (/^\d+$/.test(text)) return { host: '127.0.0.1', port: Number(text) || fallbackPort }
    return { host: text || '127.0.0.1', port: fallbackPort }
  }
  const port = Number(text.slice(cut + 1)) || fallbackPort
  let host = text.slice(0, cut).replace(/^\[|\]$/g, '') || '127.0.0.1'
  if (host === '0.0.0.0' || host === '::' || host === '*') host = '127.0.0.1'
  return { host, port }
}

/** 从代理 URL 取出可探测的 host:port；解析不了就退回本地 10808。 */
export function proxyEndpoint(url) {
  try {
    const parsed = new URL(url)
    const port = Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 1080)
    const host = parsed.hostname.replace(/^\[|\]$/g, '')
    return { host: host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host, port }
  } catch {
    return { host: '127.0.0.1', port: 10808 }
  }
}

export function probePort(host, port, timeout = 800) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port })
    const done = value => {
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(timeout)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/** magpie web 启动后把带 key 的地址打进日志，日志里取 `?k=` 后面的值。 */
export function keyFromText(text) {
  const matches = String(text ?? '').match(/[?&]k=([A-Za-z0-9._~-]{16,})/g)
  if (!matches || matches.length === 0) return ''
  return matches[matches.length - 1].replace(/^[?&]k=/, '')
}

// 面板里保留的行数上限；日志文件在每次插件加载（= 引擎启动）时清空，只留本次启动的。
const TAIL_LINES = 400
const LOG_TAIL_CHARS = 6000

const RELEVANT = ['startMode', 'gatewayPort', 'webPort', 'webKey']

export function createController(options = {}) {
  const env = options.env ?? process.env
  const HOME = env.MAGPIE_HOME || '/root'
  const BIN_DIR = options.binDir || env.MAGPIE_BIN_DIR || join(HOME, '.local/bin')
  const BIN = join(BIN_DIR, 'magpie')
  const STATE_DIR = options.stateDir || env.MAGPIE_STATE_DIR || join(HOME, '.local/state/magpie')
  const LOG_FILE = join(STATE_DIR, 'autostart.log')
  const LOCK_FILE = join(STATE_DIR, 'install.lock')
  const LINK_PATH = options.linkPath || env.MAGPIE_LINK_PATH || DEFAULT_LINK_PATH
  const HOST = options.host || parseAddr(env.MAGPIE_ADDR || '127.0.0.1:3425', 3425).host
  const platformOk = options.platform === undefined ? process.platform === 'linux' : options.platform === 'linux'

  const injected = options.deps ?? options
  const deps = {
    run: injected.run ?? runSync,
    runAsync: injected.runAsync ?? runAsyncDefault,
    spawn: injected.spawn ?? spawn,
    probe: injected.probe ?? probePort,
    exit: injected.exit ?? ((child, cb) => child.once('exit', cb)),
    readLog: injected.readLog ?? (() => {
      try {
        return readFileSync(LOG_FILE, 'utf8').split(/\r?\n/).slice(-200).join('\n')
      } catch {
        return ''
      }
    }),
  }

  let settings = normalizeSettings(options.settings)
  let child = null
  let childAlive = false
  let disposed = false
  let installing = false
  let lastError = ''
  let version = null
  let activeMode = null
  let startedWith = null
  let externalRunning = false
  let restartTimer = null
  const tail = []
  const listeners = new Set()

  // 本次启动才有意义的日志：插件加载时清空文件，避免面板里混进上一次运行的记录。
  if (options.resetLog !== false) {
    try {
      mkdirSync(STATE_DIR, { recursive: true })
      writeFileSync(LOG_FILE, '')
    } catch {
      // 清不了就照常追加，不影响主流程
    }
  }

  const log = message => {
    const line = `${new Date().toISOString()} [autostart] ${message}`
    tail.push(line)
    if (tail.length > TAIL_LINES) tail.shift()
    try {
      mkdirSync(STATE_DIR, { recursive: true })
      appendFileSync(LOG_FILE, `${line}\n`)
    } catch {
      // 日志写不进去也不能影响主流程
    }
    console.log(`[magpie] ${message}`)
    publish()
  }

  const gatewayUrl = () => `http://${HOST}:${settings.gatewayPort}`
  const webKey = () => settings.webKey || keyFromText(deps.readLog())
  const webUrl = () => {
    const key = webKey()
    return `http://${HOST}:${settings.webPort}${key ? `/?k=${key}` : ''}`
  }

  function baseEnv(mode) {
    const out = {
      ...env,
      HOME,
      DEBIAN_FRONTEND: 'noninteractive',
      MAGPIE_ADDR: `${HOST}:${settings.gatewayPort}`,
      PATH: `${BIN_DIR}:${env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'}`,
    }
    if (mode === 'web' && settings.webKey) out.MAGPIE_WEB_KEY = settings.webKey
    return out
  }

  function runSync(cmd, args, { timeout = 60000 } = {}) {
    const result = spawnSync(cmd, args, {
      env: baseEnv(), timeout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    })
    return {
      ok: !result.error && result.status === 0,
      status: result.status,
      error: result.error ? String(result.error.message) : '',
      output: `${result.stdout || ''}${result.stderr || ''}`.trim().slice(-500),
    }
  }

  function runAsyncDefault(cmd, args, { timeout = 600000 } = {}) {
    return new Promise(resolve => {
      let stdout = ''
      let stderr = ''
      let settled = false
      const finish = value => {
        if (settled) return
        settled = true
        resolve(value)
      }
      let proc
      try {
        proc = spawn(cmd, args, { env: baseEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (err) {
        finish({ ok: false, status: null, error: String(err.message || err), output: '' })
        return
      }
      const timer = setTimeout(() => {
        proc.kill('SIGKILL')
        finish({ ok: false, status: null, error: `超时 ${timeout}ms`, output: `${stdout}${stderr}`.slice(-500) })
      }, timeout)
      proc.stdout.on('data', chunk => { stdout += chunk })
      proc.stderr.on('data', chunk => { stderr += chunk })
      proc.on('error', err => {
        clearTimeout(timer)
        finish({ ok: false, status: null, error: String(err.message || err), output: '' })
      })
      proc.on('close', code => {
        clearTimeout(timer)
        finish({ ok: code === 0, status: code, error: '', output: `${stdout}${stderr}`.trim().slice(-500) })
      })
    })
  }

  function magpieWorks() {
    if (!existsSync(BIN)) return false
    const result = deps.run(BIN, ['--version'], { timeout: 20000 })
    if (result.ok && !version) version = result.output.split(/\r?\n/)[0].trim() || 'magpie'
    return result.ok
  }

  // /usr/local/bin 本来就在 PATH 里，且不在 dsh-Go 引擎升级的替换清单中。
  // DSH 的 bash 工具是 `bash -c`，不读 ~/.bashrc，所以只能靠 PATH 里已有的目录做软链。
  function ensureCliOnPath() {
    try {
      let info = null
      try {
        info = lstatSync(LINK_PATH)
      } catch {
        // 还不存在
      }
      if (info) {
        if (!info.isSymbolicLink()) {
          log(`${LINK_PATH} 已存在且不是软链，保留原文件不动`)
          return false
        }
        let target = ''
        try {
          target = readlinkSync(LINK_PATH)
        } catch {
          // 读不到就重建
        }
        if (target === BIN) return true
        try {
          unlinkSync(LINK_PATH)
        } catch {
          // 删不掉就让下面的 symlink 报错
        }
      }
      mkdirSync(dirname(LINK_PATH), { recursive: true })
      symlinkSync(BIN, LINK_PATH)
      log(`已创建软链 ${LINK_PATH} -> ${BIN}`)
      return true
    } catch (err) {
      log(`创建软链 ${LINK_PATH} 失败: ${err && err.message ? err.message : String(err)}`)
      return false
    }
  }

  async function ensurePrerequisites() {
    if (deps.run('curl', ['--version'], { timeout: 10000 }).ok) return true
    log('curl 缺失，尝试 apt-get 安装 curl ca-certificates')
    await deps.runAsync('apt-get', ['update'], { timeout: 180000 })
    const install = await deps.runAsync('apt-get', ['install', '-y', 'curl', 'ca-certificates'], { timeout: 300000 })
    if (!install.ok) {
      log(`apt-get 安装失败: ${install.error || install.output}`)
      return false
    }
    return deps.run('curl', ['--version'], { timeout: 10000 }).ok
  }

  async function runInstaller(useProxy) {
    let dir
    try {
      dir = mkdtempSync(join(tmpdir(), 'magpie-install-'))
      const script = join(dir, 'install.sh')
      const curlArgs = ['-fsSL', '--retry', '2', '--connect-timeout', '20', '--max-time', '900']
      if (useProxy) curlArgs.push('--proxy', settings.proxy)
      curlArgs.push('-o', script, INSTALLER_URL)

      log(`下载安装脚本${useProxy ? `（经代理 ${settings.proxy}）` : '（直连）'}`)
      const download = await deps.runAsync('curl', curlArgs, { timeout: 960000 })
      if (!download.ok) {
        log(`下载安装脚本失败: ${download.error || download.output}`)
        return false
      }

      const shArgs = [script, '--tui']
      if (useProxy) shArgs.push('--proxy', settings.proxy)
      log('执行安装脚本 --tui')
      const install = await deps.runAsync('sh', shArgs, { timeout: 900000 })
      if (!install.ok) {
        log(`安装脚本失败: ${install.error || install.output}`)
        return false
      }
      return true
    } catch (err) {
      log(`安装异常: ${err && err.message ? err.message : String(err)}`)
      return false
    } finally {
      if (dir) {
        try {
          rmSync(dir, { recursive: true, force: true })
        } catch {
          // 临时目录清理失败无关紧要
        }
      }
    }
  }

  function acquireLock() {
    try {
      mkdirSync(STATE_DIR, { recursive: true })
      closeSync(openSync(LOCK_FILE, 'wx'))
      return true
    } catch {
      return false
    }
  }

  function releaseLock() {
    try {
      unlinkSync(LOCK_FILE)
    } catch {
      // 锁本来就不存在
    }
  }

  /** 安装（或强制重装）。直连/代理按设置决定；同机多实例靠锁互斥。 */
  async function ensureInstalled({ force = false } = {}) {
    if (!platformOk) {
      log(`当前平台 ${process.platform} 不是 Linux，跳过安装`)
      return false
    }
    if (!force && magpieWorks()) return true

    if (!acquireLock()) {
      log('另一个实例正在安装 magpie，等待其完成')
      for (let i = 0; i < 120; i += 1) {
        await delay(5000)
        if (magpieWorks()) return true
      }
      log('等待安装超时')
      return false
    }

    installing = true
    lastError = ''
    publish()
    try {
      if (!force && magpieWorks()) return true
      log(force ? '按要求重装 magpie' : existsSync(BIN) ? 'magpie 文件存在但无法运行，重新安装' : '未检测到 magpie，开始安装')

      if (!(await ensurePrerequisites())) {
        lastError = '前置依赖不可用（curl / ca-certificates）'
        log(`安装中止: ${lastError}`)
        return false
      }

      const attempts = []
      if (settings.proxyMode === 'always') {
        attempts.push(true)
      } else if (settings.proxyMode === 'off' || !settings.proxy) {
        attempts.push(false)
      } else {
        attempts.push(false)
        const endpoint = proxyEndpoint(settings.proxy)
        if (await deps.probe(endpoint.host, endpoint.port)) {
          attempts.push(true)
        } else {
          log(`代理 ${settings.proxy} 未在监听，只用直连`)
        }
      }

      let installed = false
      for (let i = 0; i < attempts.length && !installed; i += 1) {
        if (i > 0) log('直连安装失败，改用代理重试')
        installed = await runInstaller(attempts[i])
      }
      if (!installed) {
        lastError = 'magpie 安装失败，检查网络或代理设置'
        log(lastError)
        return false
      }

      ensureCliOnPath()

      if (magpieWorks()) {
        log('magpie 安装完成')
        publish()
        return true
      }
      lastError = '安装脚本执行完毕，但 magpie 仍不可用'
      log(lastError)
      return false
    } finally {
      installing = false
      releaseLock()
      publish()
    }
  }

  function webArgs() {
    return ['web', '--addr', `${HOST}:${settings.webPort}`, '--no-open']
  }

  function start() {
    if (!platformOk) return { ok: false, message: `当前平台 ${process.platform} 不是 Linux` }
    if (child && childAlive) return { ok: true, message: '网关已在运行' }
    if (!existsSync(BIN)) return { ok: false, message: 'magpie 还没装好，先安装' }
    try {
      mkdirSync(STATE_DIR, { recursive: true })
      const fd = openSync(LOG_FILE, 'a')
      const mode = settings.startMode === 'web' ? 'web' : 'serve'
      const args = mode === 'web' ? webArgs() : ['serve']
      child = deps.spawn(BIN, args, { env: baseEnv(mode), stdio: ['ignore', fd, fd] })
      closeSync(fd)
      childAlive = true
      activeMode = mode
      startedWith = pickRelevant(settings)
      child.on('error', err => {
        log(`启动失败: ${err && err.message ? err.message : String(err)}`)
        childAlive = false
        child = null
        lastError = 'magpie 启动失败'
        publish()
      })
      deps.exit(child, code => {
        childAlive = false
        child = null
        log(`magpie 退出（code ${code ?? 'null'}）`)
        publish()
      })
      log(`已启动 magpie ${mode}${mode === 'web' ? `（网页版 ${webUrl()}）` : ''}，pid: ${child.pid}`)
      publish()
      return { ok: true, message: mode === 'web' ? '已启动网关和网页版' : '已启动网关' }
    } catch (err) {
      lastError = `启动失败: ${err && err.message ? err.message : String(err)}`
      log(lastError)
      return { ok: false, message: lastError }
    }
  }

  function stop() {
    if (!child || !childAlive) {
      return { ok: false, message: '没有由本插件启动的 magpie 在运行' }
    }
    try {
      child.kill('SIGTERM')
      log('已停止 magpie')
      return { ok: true, message: '已停止' }
    } catch (err) {
      return { ok: false, message: `停止失败: ${err && err.message ? err.message : String(err)}` }
    }
  }

  /** 设置改了且是自己起的进程：停掉再按新设置起，保证面板、端口、key 一致。 */
  function restartIfOwned() {
    if (!childAlive) return false
    stop()
    if (restartTimer) clearTimeout(restartTimer)
    restartTimer = setTimeout(() => {
      restartTimer = null
      if (!disposed) start()
    }, 700)
    if (typeof restartTimer.unref === 'function') restartTimer.unref()
    return true
  }

  /** 只探测端口，不落盘：面板每 2 秒刷新用。 */
  async function refresh() {
    if (!platformOk) return snapshot()
    if (existsSync(BIN)) {
      if (!version && !installing) magpieWorks()
    } else {
      version = null
    }
    if (!childAlive) {
      const probes = [deps.probe(HOST, settings.gatewayPort, 500)]
      if (settings.startMode === 'web') probes.push(deps.probe(HOST, settings.webPort, 500))
      const results = await Promise.all(probes)
      externalRunning = results.some(Boolean)
    } else {
      externalRunning = false
    }
    return snapshot()
  }

  function isRunning() {
    return childAlive || externalRunning
  }

  function needsRestart() {
    if (!childAlive || !startedWith) return false
    const now = pickRelevant(settings)
    return RELEVANT.some(key => now[key] !== startedWith[key])
  }

  function snapshot() {
    const showWeb = settings.startMode === 'web'
    return {
      platformOk,
      installed: existsSync(BIN),
      version: version || '',
      running: isRunning(),
      owned: Boolean(childAlive),
      mode: activeMode || (showWeb ? 'web' : 'serve'),
      gatewayPort: settings.gatewayPort,
      webPort: settings.webPort,
      webKeySet: webKey() !== '',
      gatewayUrl: gatewayUrl(),
      webUrl: showWeb ? webUrl() : '',
      installing,
      needsRestart: needsRestart(),
      lastError,
      logTail: tail.slice(-200).join('\n').slice(-LOG_TAIL_CHARS),
      settings: { ...settings },
    }
  }

  function publish() {
    const state = snapshot()
    for (const emit of listeners) {
      try {
        emit(state)
      } catch {
        // 单个订阅者出错不影响别的
      }
    }
  }

  function subscribe(emit) {
    listeners.add(emit)
    return () => listeners.delete(emit)
  }

  function setSettings(next) {
    settings = normalizeSettings(next)
    log(`设置已更新：启动方式 ${settings.startMode}，网关端口 ${settings.gatewayPort}，网页版端口 ${settings.webPort}，代理 ${settings.proxyMode}${settings.proxy ? ` ${settings.proxy}` : ''}`)
    const restarted = restartIfOwned()
    publish()
    return { settings: { ...settings }, restarted }
  }

  function dispose() {
    disposed = true
    listeners.clear()
    if (restartTimer) {
      clearTimeout(restartTimer)
      restartTimer = null
    }
    if (child && childAlive) {
      try {
        child.kill('SIGTERM')
      } catch {
        // 已经退出
      }
    }
    child = null
    childAlive = false
  }

  return {
    BIN, STATE_DIR, LINK_PATH, HOST,
    get settings() { return { ...settings } },
    get disposed() { return disposed },
    ensureInstalled, start, stop, refresh, snapshot, subscribe, publish, setSettings, dispose,
    ensureCliOnPath, magpieWorks, log,
  }
}

function pickRelevant(settings) {
  const out = {}
  for (const key of RELEVANT) out[key] = settings[key]
  return out
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
