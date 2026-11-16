import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, openSync, closeSync, existsSync, appendFileSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';

export const name = 'dsh-go-magpie-autostart';

const HOME = process.env.MAGPIE_HOME || '/root';
const BIN_DIR = process.env.MAGPIE_BIN_DIR || join(HOME, '.local/bin');
const BIN = join(BIN_DIR, 'magpie');
const STATE_DIR = process.env.MAGPIE_STATE_DIR || join(HOME, '.local/state/magpie');
const LOG_FILE = join(STATE_DIR, 'autostart.log');
const LOCK_FILE = join(STATE_DIR, 'install.lock');
const INSTALLER_URL = 'https://usemagpie.ai/install.sh';
const PROXY = process.env.MAGPIE_PROXY || 'http://127.0.0.1:10808';

// 网关地址：magpie 自己读 MAGPIE_ADDR，默认 127.0.0.1:3425
const GATEWAY = (() => {
  const raw = (process.env.MAGPIE_ADDR || '127.0.0.1:3425').trim();
  const cut = raw.lastIndexOf(':');
  const port = Number(cut >= 0 ? raw.slice(cut + 1) : raw) || 3425;
  let host = (cut >= 0 ? raw.slice(0, cut) : '127.0.0.1').replace(/^\[|\]$/g, '') || '127.0.0.1';
  if (host === '0.0.0.0' || host === '::' || host === '*') host = '127.0.0.1';
  return { host, port };
})();
const BASHRC = join(HOME, '.bashrc');
const BASHRC_LINE = `export PATH="${BIN_DIR}:$PATH"`;

function log(message) {
  const line = `${new Date().toISOString()} [autostart] ${message}\n`;
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    appendFileSync(LOG_FILE, line);
  } catch {
    // 日志写不进去也不能影响主流程
  }
  console.log(`[magpie] ${message}`);
}

function baseEnv() {
  return {
    ...process.env,
    HOME,
    DEBIAN_FRONTEND: 'noninteractive',
    PATH: `${BIN_DIR}:${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}`
  };
}

// 同步执行一条命令，只用于毫秒级的快速探测
function run(cmd, args, { timeout = 60000 } = {}) {
  const result = spawnSync(cmd, args, {
    env: baseEnv(),
    timeout,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return {
    ok: !result.error && result.status === 0,
    status: result.status,
    error: result.error ? String(result.error.message) : '',
    output: `${result.stdout || ''}${result.stderr || ''}`.trim().slice(-500)
  };
}

// 异步执行一条命令：安装这类耗时操作必须用它，否则会卡住 DSH 事件循环
function runAsync(cmd, args, { timeout = 600000 } = {}) {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let child;
    try {
      child = spawn(cmd, args, { env: baseEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      finish({ ok: false, status: null, error: String(err.message || err), output: '' });
      return;
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ ok: false, status: null, error: `超时 ${timeout}ms`, output: `${stdout}${stderr}`.slice(-500) });
    }, timeout);

    child.stdout.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.on('error', err => {
      clearTimeout(timer);
      finish({ ok: false, status: null, error: String(err.message || err), output: '' });
    });
    child.on('close', code => {
      clearTimeout(timer);
      finish({
        ok: code === 0,
        status: code,
        error: '',
        output: `${stdout}${stderr}`.trim().slice(-500)
      });
    });
  });
}

// magpie 可用 = 文件存在且 --version 能跑通
function magpieWorks() {
  if (!existsSync(BIN)) return false;
  return run(BIN, ['--version'], { timeout: 20000 }).ok;
}

// 网关是否在跑：magpie 没有 healthcheck 子命令，直接探监听端口
function gatewayHealthy() {
  return probeProxy(GATEWAY.host, GATEWAY.port, 1500);
}

// 安装前置：curl 与 CA 证书（apt-get 耗时，用异步）
async function ensurePrerequisites() {
  if (run('curl', ['--version'], { timeout: 10000 }).ok) return true;
  log('curl 缺失，尝试 apt-get 安装 curl ca-certificates');
  await runAsync('apt-get', ['update'], { timeout: 180000 });
  const install = await runAsync('apt-get', ['install', '-y', 'curl', 'ca-certificates'], { timeout: 300000 });
  if (!install.ok) {
    log(`apt-get 安装失败: ${install.error || install.output}`);
    return false;
  }
  return run('curl', ['--version'], { timeout: 10000 }).ok;
}

// 探测本地代理端口是否在监听
function probeProxy(host, port, timeout = 800) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port });
    const done = value => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

// 下载并执行官方安装脚本（--tui：只装 CLI，不装图形桌面版）
async function runInstaller(useProxy) {
  let dir;
  try {
    dir = mkdtempSync(join(tmpdir(), 'magpie-install-'));
    const script = join(dir, 'install.sh');

    const curlArgs = ['-fsSL', '--retry', '2', '--connect-timeout', '20', '--max-time', '900'];
    if (useProxy) curlArgs.push('--proxy', PROXY);
    curlArgs.push('-o', script, INSTALLER_URL);

    log(`下载安装脚本${useProxy ? '（经代理）' : ''}`);
    const download = await runAsync('curl', curlArgs, { timeout: 960000 });
    if (!download.ok) {
      log(`下载安装脚本失败: ${download.error || download.output}`);
      return false;
    }

    const shArgs = [script, '--tui'];
    if (useProxy) shArgs.push('--proxy', PROXY);
    log('执行安装脚本 --tui');
    const install = await runAsync('sh', shArgs, { timeout: 900000 });
    if (!install.ok) {
      log(`安装脚本失败: ${install.error || install.output}`);
      return false;
    }
    return true;
  } catch (err) {
    log(`安装异常: ${err && err.message ? err.message : String(err)}`);
    return false;
  } finally {
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // 临时目录清理失败无关紧要
      }
    }
  }
}

// 确保 ~/.bashrc 里有 PATH 行
function ensureBashrcPath() {
  const check = run('grep', ['-qxF', BASHRC_LINE, BASHRC]);
  if (check.ok) return true;
  try {
    appendFileSync(BASHRC, `\n${BASHRC_LINE}\n`);
    log(`已向 ${BASHRC} 追加 PATH`);
    return true;
  } catch (err) {
    log(`写入 ${BASHRC} 失败: ${err && err.message ? err.message : String(err)}`);
    return false;
  }
}

// 安装锁：避免多个 DSH 实例同时安装
function acquireLock() {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    closeSync(openSync(LOCK_FILE, 'wx'));
    return true;
  } catch {
    return false;
  }
}

function releaseLock() {
  try {
    unlinkSync(LOCK_FILE);
  } catch {
    // 锁本来就不存在
  }
}

// 主流程：已安装则直接返回，未安装则安装
async function ensureInstalled() {
  if (magpieWorks()) return true;

  if (!acquireLock()) {
    log('另一个实例正在安装 magpie，等待其完成');
    for (let i = 0; i < 120; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      if (magpieWorks()) return true;
    }
    log('等待安装超时');
    return false;
  }

  try {
    if (magpieWorks()) return true;

    if (existsSync(BIN)) log('magpie 文件存在但无法运行，重新安装');
    else log('未检测到 magpie，开始安装');

    if (!ensurePrerequisites()) {
      log('前置依赖不可用，跳过安装');
      return false;
    }

    let installed = await runInstaller(false);
    if (!installed && (await probeProxy('127.0.0.1', 10808))) {
      log('直连安装失败，改用本地代理重试');
      installed = await runInstaller(true);
    }
    if (!installed) {
      log('magpie 安装失败');
      return false;
    }

    ensureBashrcPath();

    if (magpieWorks()) {
      log('magpie 安装完成');
      return true;
    }
    log('安装脚本执行完毕，但 magpie 仍不可用');
    return false;
  } finally {
    releaseLock();
  }
}

export function apply(ctx) {
  ctx.effect(() => {
    let child = null;
    let disposed = false;
    const env = baseEnv();

    const startGateway = () => {
      if (disposed) return;
      mkdirSync(STATE_DIR, { recursive: true });
      const fd = openSync(LOG_FILE, 'a');
      child = spawn(BIN, ['serve'], { env, stdio: ['ignore', fd, fd] });
      closeSync(fd);

      child.on('error', err => {
        log(`启动失败: ${err && err.message ? err.message : String(err)}`);
        child = null;
      });
      log(`网关已启动，pid: ${child.pid}`);
    };

    const stopGateway = () => {
      if (child && child.exitCode === null && !child.killed) {
        child.kill('SIGTERM');
        log('网关已停止');
      }
      child = null;
    };

    // 未装则先安装，装好后确认网关；健康探测是异步的，整条路径都在异步里跑，不阻塞 DSH 启动
    (async () => {
      if (!magpieWorks() && !(await ensureInstalled())) return;
      if (disposed) return;
      if (await gatewayHealthy()) {
        log(`网关已在运行（${GATEWAY.host}:${GATEWAY.port}）`);
        return;
      }
      startGateway();
    })();

    return () => {
      disposed = true;
      stopGateway();
    };
  });
}
