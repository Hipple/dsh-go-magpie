import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export const DEFAULT_SETTINGS = Object.freeze({
  startMode: 'web',
  proxyMode: 'off',
  proxy: '',
  autoStart: true,
  gatewayPort: 3425,
  webPort: 3430,
  webKey: '',
})

export const START_MODES = new Set(['serve', 'web'])
export const PROXY_MODES = new Set(['off', 'fallback', 'always'])
const PROXY_RE = /^(?:https?|socks5h?):\/\/[^\s/]+/i
const WEB_KEY_RE = /^[A-Za-z0-9._~-]{16,}$/

/** 代理地址：空串表示没填；否则必须是 http/https/socks5 的完整 URL，≤ 200 字。 */
export function normalizeProxy(value) {
  if (value === undefined || value === null) return ''
  const text = String(value).trim()
  if (text === '') return ''
  if (text.length > 200 || !PROXY_RE.test(text) || /\s/.test(text)) {
    throw new TypeError('代理地址要以 http://、https:// 或 socks5:// 开头')
  }
  return text
}

/** 端口：1–65535 的整数；坏值退回默认。 */
export function normalizePort(value, fallback) {
  const number = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  if (!Number.isInteger(number) || number < 1 || number > 65535) return fallback
  return number
}

/** 网页版 key：空串表示让 magpie 每次启动自己生成；否则 ≥16 个安全字符。 */
export function normalizeWebKey(value) {
  if (value === undefined || value === null) return ''
  const text = String(value).trim()
  if (text === '') return ''
  return WEB_KEY_RE.test(text) ? text : ''
}

/** 把任意来源（文件、默认值）收敛成一份可用设置；不认识的值退回默认。 */
export function normalizeSettings(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const startMode = START_MODES.has(source.startMode) ? source.startMode : DEFAULT_SETTINGS.startMode
  const proxyMode = PROXY_MODES.has(source.proxyMode) ? source.proxyMode : DEFAULT_SETTINGS.proxyMode
  let proxy = DEFAULT_SETTINGS.proxy
  try {
    proxy = normalizeProxy(source.proxy === undefined ? DEFAULT_SETTINGS.proxy : source.proxy)
  } catch {
    proxy = DEFAULT_SETTINGS.proxy
  }
  const autoStart = typeof source.autoStart === 'boolean' ? source.autoStart : DEFAULT_SETTINGS.autoStart
  const gatewayPort = normalizePort(source.gatewayPort, DEFAULT_SETTINGS.gatewayPort)
  let webPort = normalizePort(source.webPort, DEFAULT_SETTINGS.webPort)
  if (webPort === gatewayPort) webPort = gatewayPort === DEFAULT_SETTINGS.webPort ? 3431 : DEFAULT_SETTINGS.webPort
  const webKey = normalizeWebKey(source.webKey)
  return { startMode, proxyMode, proxy, autoStart, gatewayPort, webPort, webKey }
}

/** 保存前的严格校验：端口必须不同，网页版 key 不合法要报错而不是静默丢弃。 */
export function validateSettings(input) {
  const gatewayPort = normalizePort(input.gatewayPort, NaN)
  const webPort = normalizePort(input.webPort, NaN)
  if (!Number.isInteger(gatewayPort)) throw new TypeError('网关端口要是 1–65535 的整数')
  if (!Number.isInteger(webPort)) throw new TypeError('网页版端口要是 1–65535 的整数')
  if (gatewayPort === webPort) throw new TypeError('网关端口和网页版端口不能相同')
  const proxy = normalizeProxy(input.proxy)
  if (input.proxyMode !== 'off' && proxy === '') throw new TypeError('选了代理却没填代理地址')
  const rawKey = String(input.webKey ?? '').trim()
  if (rawKey !== '' && !WEB_KEY_RE.test(rawKey)) throw new TypeError('网页版 key 至少 16 个字母、数字或 - . _ ~')
  return normalizeSettings({ ...input, proxy, webKey: rawKey })
}

export function loadSettings(path, logger) {
  try {
    return normalizeSettings(JSON.parse(readFileSync(path, 'utf8')))
  } catch (err) {
    if (err && err.code !== 'ENOENT' && logger) logger(`读取设置失败，使用默认值: ${err.message || err}`)
    return normalizeSettings({})
  }
}

export function saveSettings(path, settings) {
  const normalized = normalizeSettings(settings)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
  return normalized
}
