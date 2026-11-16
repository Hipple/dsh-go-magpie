// dsh-go 原生插件入口：在引擎里安装/启动 magpie，并给 App 一个面板。
// 面板只在有 dsh-go 桥接的主机上出现；没有桥接时插件照样装、照样起网关。
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { createController } from './core.js'
import { buildView, panelData } from './view.js'
import { loadSettings, saveSettings, normalizeSettings, normalizeProxy } from './settings.js'

export const name = 'dsh-go-magpie-autostart'

const DEFAULT_SETTINGS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'settings.json')

export function apply(ctx, options = {}) {
  const settingsPath = options.settingsPath || DEFAULT_SETTINGS_PATH
  const initial = loadSettings(settingsPath)
  const controller = createController({ settings: initial })

  ctx.effect(() => {
    if (initial.autoStart && process.platform === 'linux') {
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
      view: (_scope, caps) => buildView(controller.snapshot(), caps),
      data: (_scope, emit) => {
        emit(panelData(controller.snapshot()))
        const off = controller.subscribe(state => emit(panelData(state)))
        let busy = false
        const timer = setInterval(() => {
          if (busy) return
          busy = true
          controller.refresh().then(() => { busy = false }, () => { busy = false })
        }, 2000)
        if (typeof timer.unref === 'function') timer.unref()
        return () => {
          clearInterval(timer)
          off()
        }
      },
      actions: {
        save: (_scope, event) => {
          const values = event && event.value && event.value.values ? event.value.values : {}
          let next
          try {
            next = normalizeSettings({
              startMode: values['data.form.startMode'],
              proxyMode: values['data.form.proxyMode'],
              proxy: normalizeProxy(values['data.form.proxy']),
              autoStart: values['data.form.autoStart'],
            })
          } catch (err) {
            return { toast: String(err && err.message ? err.message : '设置有误').slice(0, 40) }
          }
          try {
            saveSettings(settingsPath, next)
          } catch (err) {
            return { toast: '设置没能写入磁盘' }
          }
          controller.setSettings(next)
          return [
            { type: 'patch', data: panelData(controller.snapshot()) },
            { type: 'toast', text: '设置已保存' },
          ]
        },
        install: () => {
          if (controller.snapshot().installing) return { toast: '正在安装，请稍候' }
          controller.ensureInstalled({ force: true }).catch(err => {
            controller.log(`安装失败: ${err && err.message ? err.message : String(err)}`)
          })
          return { toast: '开始安装 magpie' }
        },
        start: () => {
          const result = controller.start()
          return { toast: String(result.message).slice(0, 40) }
        },
        stop: () => {
          const result = controller.stop()
          return { toast: String(result.message).slice(0, 40) }
        },
        copyGateway: () => {
          const { gatewayUrl } = controller.snapshot()
          return { copy: gatewayUrl, toast: '已复制网关地址' }
        },
        copyWeb: () => {
          const { webUrl } = controller.snapshot()
          return { copy: webUrl, toast: '已复制网页地址' }
        },
      },
    })
  })
}
