// 构造面板视图。v2 用表单和按钮；App 画不了 v2 时退回只读 v1 摘要。
const V2_COMPONENTS = ['textField', 'form', 'select', 'segmented', 'toggle', 'actions', 'list', 'keyValue']

const pick = (caps, zh, en) => (String(caps?.locale ?? '').startsWith('en') ? en : zh)

export function supportsV2(caps) {
  const components = caps?.components
  if (!Array.isArray(components)) return false
  return V2_COMPONENTS.every(name => components.includes(name))
}

export function statusText(state, caps) {
  if (!state.platformOk) return pick(caps, '仅支持 Linux 主机', 'Linux hosts only')
  if (!state.installed) return pick(caps, '未安装', 'Not installed')
  if (state.installing) return pick(caps, '正在安装…', 'Installing…')
  if (state.running) return pick(caps, state.owned ? '运行中（本插件启动）' : '运行中（已在别处启动）', state.owned ? 'Running (started here)' : 'Running (started elsewhere)')
  return pick(caps, '已安装，未运行', 'Installed, stopped')
}

export function modeText(state, caps) {
  return state.settings?.startMode === 'web'
    ? pick(caps, '网关 + 网页（magpie web）', 'Gateway + web (magpie web)')
    : pick(caps, '仅网关（magpie serve）', 'Gateway only (magpie serve)')
}

function summaryRows(state, caps) {
  return [
    [pick(caps, '状态', 'Status'), statusText(state, caps)],
    [pick(caps, '版本', 'Version'), state.version || '—'],
    [pick(caps, '启动方式', 'Start mode'), modeText(state, caps)],
    [pick(caps, '网关地址', 'Gateway'), state.gatewayUrl],
    [pick(caps, '网页版', 'Web'), state.webUrl],
  ]
}

function tailText(state) {
  const text = String(state.logTail ?? '').trim()
  return text === '' ? '—' : text.slice(-600)
}

export function buildView(state, caps = {}) {
  if (!supportsV2(caps)) {
    const children = [
      { type: 'keyValue', items: summaryRows(state, caps) },
      { type: 'text', text: tailText(state), tone: 'muted' },
    ]
    if (state.lastError) children.push({ type: 'text', text: String(state.lastError).slice(0, 120) })
    return { type: 'stack', title: 'Magpie', children }
  }

  const children = [
    { type: 'keyValue', items: summaryRows(state, caps) },
  ]
  if (state.lastError) {
    children.push({ type: 'callout', text: String(state.lastError).slice(0, 160), tone: 'bad' })
  }
  children.push({
    type: 'actions',
    items: [
      { label: pick(caps, '安装 / 重装', 'Install'), action: 'install' },
      { label: pick(caps, '启动', 'Start'), action: 'start' },
      { label: pick(caps, '停止', 'Stop'), action: 'stop' },
    ],
  })
  children.push({
    type: 'list',
    items: [
      { title: pick(caps, '复制网关地址', 'Copy gateway address'), subtitle: state.gatewayUrl, icon: 'copy', action: 'copyGateway' },
      { title: pick(caps, '复制网页版地址', 'Copy web address'), subtitle: state.webUrl, icon: 'globe', action: 'copyWeb' },
    ],
  })
  children.push({
    type: 'form',
    label: pick(caps, '设置', 'Settings'),
    submit: 'save',
    submitLabel: pick(caps, '保存设置', 'Save settings'),
    children: [
      {
        type: 'select',
        label: pick(caps, '启动方式', 'Start mode'),
        bind: 'data.form.startMode',
        options: [
          { label: pick(caps, '仅网关（magpie serve）', 'Gateway only (magpie serve)'), value: 'serve' },
          { label: pick(caps, '网关 + 网页（magpie web）', 'Gateway + web (magpie web)'), value: 'web' },
        ],
      },
      {
        type: 'segmented',
        label: pick(caps, '代理用法', 'Proxy usage'),
        bind: 'data.form.proxyMode',
        options: [
          { label: pick(caps, '直连失败再用', 'Fallback'), value: 'fallback' },
          { label: pick(caps, '始终使用', 'Always'), value: 'always' },
          { label: pick(caps, '不用代理', 'Off'), value: 'off' },
        ],
      },
      {
        type: 'textField',
        label: pick(caps, '安装代理', 'Install proxy'),
        bind: 'data.form.proxy',
        maxLength: 200,
        placeholder: 'http://127.0.0.1:10808',
      },
      {
        type: 'toggle',
        label: pick(caps, '随引擎自动启动', 'Start with the engine'),
        bind: 'data.form.autoStart',
      },
    ],
  })
  children.push({ type: 'text', text: tailText(state), tone: 'muted' })

  return { v: 2, type: 'stack', accent: 'teal', title: 'Magpie', style: { gap: 'M' }, children }
}

/** 面板 data 推送的形状：显示字段 + 表单草稿。 */
export function panelData(state) {
  return {
    ...state,
    form: {
      startMode: state.settings.startMode,
      proxyMode: state.settings.proxyMode,
      proxy: state.settings.proxy,
      autoStart: state.settings.autoStart,
    },
  }
}
