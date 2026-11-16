// dsh-go 原生插件入口：在引擎里安装/启动 magpie，并给 App 一个面板（网关 / 设置 两个页签）。
// 面板只在有 dsh-go 桥接的主机上出现；没有桥接时插件照样装、照样起网关。
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { createController } from './core.js'
import { buildView, panelData } from './view.js'
import { loadSettings, saveSettings, validateSettings } from './settings.js'

export const name = 'dsh-go-magpie'

const DEFAULT_SETTINGS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'settings.json')
const FIELD_BY_BIND = {
  'data.form.startMode': 'startMode',
  'data.form.proxyMode': 'proxyMode',
}

export function apply(ctx, options = {}) {
  const settingsPath = options.settingsPath || DEFAULT_SETTINGS_PATH
  const initial = loadSettings(settingsPath)
  // 测试/嵌入场景可以关掉自动安装，避免真的去跑 apt/curl。
  const autoStart = options.autoStart === undefined ? initial.autoStart : Boolean(options.autoStart)
  const controller = createController({ settings: initial })
  // 面板草稿：onChange 时先本地生效（决定字段显隐），保存时才落盘。
  let draft = { ...initial }

  ctx.effect(() => {
    if (autoStart && process.platform === 'linux') {
      ;(async () => {
        if (!(await controller.ensureInstalled())) return
        const state = await controller.refresh()
        if (!state.running) controller.start()
      })().catch(err => controller.log(`自动启动失败: ${err && err.message ? err.message : String(err)}`))
    }
    return () => controller.dispose()
  })

  ctx.inject(['dshGo'], ctx => {
    ctx.dshGo.panel('magpie', {
      view: (_scope, caps) => buildView(controller.snapshot(), caps, draft),
      data: (_scope, emit) => {
        emit(panelData(controller.snapshot(), draft))
        const off = controller.subscribe(state => emit(panelData(state, draft)))
        let busy = false
        const timer = setInterval(() => {
          if (busy) return
          busy = true
          // refresh 会重读日志（网页版 key 可能刚生成），并把最新快照推给 App，
          // 所以面板开着时显示值一直是当下的，不依赖视图缓存。
          controller.refresh().then(
            state => { busy = false; emit(panelData(state, draft)) },
            () => { busy = false },
          )
        }, 2000)
        if (typeof timer.unref === 'function') timer.unref()
        return () => {
          clearInterval(timer)
          off()
        }
      },
      actions: {
        change: (_scope, event) => {
          const bind = event && event.value ? event.value.bind : undefined
          const field = FIELD_BY_BIND[bind]
          if (!field) return { toast: '这个改动不能即时预览' }
          draft = { ...draft, [field]: event.value.value }
          // onChange 只能回 patch / refresh；refresh 让 App 重新取视图，字段显隐随之变化。
          return [
            { type: 'patch', data: panelData(controller.snapshot(), draft) },
            { type: 'refresh' },
          ]
        },
        save: (_scope, event) => {
          const values = event && event.value && event.value.values ? event.value.values : {}
          const pickValue = (key, fallback) => (values[key] === undefined ? fallback : values[key])
          let next
          try {
            next = validateSettings({
              startMode: pickValue('data.form.startMode', draft.startMode),
              proxyMode: pickValue('data.form.proxyMode', draft.proxyMode),
              proxy: pickValue('data.form.proxy', draft.proxy),
              autoStart: pickValue('data.form.autoStart', draft.autoStart),
              gatewayPort: pickValue('data.form.gatewayPort', draft.gatewayPort),
              webPort: pickValue('data.form.webPort', draft.webPort),
              webKey: pickValue('data.form.webKey', draft.webKey),
            })
          } catch (err) {
            return { toast: String(err && err.message ? err.message : '设置有误').slice(0, 40) }
          }
          let restarted = false
          try {
            saveSettings(settingsPath, next)
            ;({ restarted } = controller.setSettings(next))
          } catch (err) {
            return { toast: '设置没能写入磁盘' }
          }
          draft = { ...next }
          return [
            { type: 'patch', data: panelData(controller.snapshot(), draft) },
            { type: 'refresh' },
            { type: 'toast', text: restarted ? '已保存，网关已重启' : '设置已保存' },
          ]
        },
        install: () => {
          if (controller.snapshot().installing) return { toast: '正在安装，请稍候' }
          controller.ensureInstalled({ force: true }).catch(err => {
            controller.log(`安装失败: ${err && err.message ? err.message : String(err)}`)
          })
          return [{ type: 'toast', text: '开始安装 magpie' }, { type: 'refresh' }]
        },
        start: () => [{ type: 'toast', text: String(controller.start().message).slice(0, 40) }, { type: 'refresh' }],
        stop: () => [{ type: 'toast', text: String(controller.stop().message).slice(0, 40) }, { type: 'refresh' }],
        copyGateway: () => ({ copy: controller.snapshot().gatewayUrl, toast: '已复制网关地址' }),
        copyWeb: () => {
          const { webUrl } = controller.snapshot()
          if (!webUrl) return { toast: '当前不是网页版模式' }
          return { copy: webUrl, toast: '已复制网页版地址' }
        },
      },
    })
  })
}

