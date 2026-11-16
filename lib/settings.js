import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export const DEFAULT_SETTINGS = Object.freeze({
  startMode: 'serve',
  proxyMode: 'fallback',
  proxy: 'http://127.0.0.1:10808',
  autoStart: true,
})

const START_MODES = new Set(['serve', 'web'])
const PROXY_MODES = new Set(['off', 'fallback', 'always'])
const PROXY_RE = /^(?:https?|socks5h?):\/\/[^\s/]+/i

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
  return { startMode, proxyMode, proxy, autoStart }
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
