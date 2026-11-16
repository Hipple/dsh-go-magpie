// 构造面板视图：网关 / 设置 两个页签。v2 用表单和按钮；App 画不了 v2 时退回只读 v1 摘要。
const V2_COMPONENTS = ['tabs', 'form', 'number', 'select', 'segmented', 'textField', 'toggle', 'actions', 'list', 'keyValue', 'callout', 'text']

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
  if (state.running) {
    return pick(caps, state.owned ? '运行中（本插件启动）' : '运行中（已在别处启动）', state.owned ? 'Running (started here)' : 'Running (started elsewhere)')
  }
  return pick(caps, '已安装，未运行', 'Installed, stopped')
}

export function modeText(state, caps) {
  const web = (state.mode || state.settings?.startMode) === 'web'
  return web
    ? pick(caps, '网关 + 网页（magpie web）', 'Gateway + web (magpie web)')
    : pick(caps, '仅网关（magpie serve）', 'Gateway only (magpie serve)')
}

export function proxyModeText(mode, caps) {
  if (mode === 'always') return pick(caps, '始终使用', 'Always')
  if (mode === 'fallback') return pick(caps, '直连失败再用', 'Fallback')
  return pick(caps, '不用代理', 'Off')
}

function summaryRows(state, caps) {
  const rows = [
    [pick(caps, '状态', 'Status'), statusText(state, caps)],
    [pick(caps, '版本', 'Version'), state.version || '—'],
    [pick(caps, '启动方式', 'Start mode'), modeText(state, caps)],
    [pick(caps, '网关地址', 'Gateway'), state.gatewayUrl],
  ]
  // 仅网关时不显示网页版相关地址。
  if (state.settings?.startMode === 'web') rows.push([pick(caps, '网页版', 'Web'), state.webUrl || '—'])
  return rows
}

function tailText(state) {
  const text = String(state.logTail ?? '').trim()
  return text === '' ? '—' : text
}

/** 日志：优先用 codeBlock（App 给固定高度 + 可滚动）；没有这个组件时退回截断的纯文本。 */
function logNode(state, caps) {
  const text = tailText(state)
  if (Array.isArray(caps?.components) && caps.components.includes('codeBlock')) {
    return { type: 'codeBlock', code: text, language: 'text' }
  }
  return { type: 'text', text: text.slice(-1200), tone: 'muted' }
}

function callouts(state, caps) {
  const out = []
  if (state.lastError) out.push({ type: 'callout', text: String(state.lastError).slice(0, 160), tone: 'bad' })
  if (state.needsRestart) {
    out.push({ type: 'callout', text: pick(caps, '启动方式或端口改过了，重启网关后生效', 'Start mode or ports changed; restart the gateway to apply'), tone: 'warn' })
  }
  return out
}

export function buildView(state, caps = {}, draft = state.settings) {
  if (!supportsV2(caps)) {
    const children = [
      { type: 'keyValue', items: summaryRows(state, caps) },
      { type: 'text', text: tailText(state), tone: 'muted' },
    ]
    for (const callout of callouts(state, caps)) children.push({ type: 'text', text: callout.text })
    return { type: 'stack', title: 'Magpie', children }
  }

  const showWeb = state.settings?.startMode === 'web'
  const gatewayChildren = [
    { type: 'keyValue', items: summaryRows(state, caps) },
    ...callouts(state, caps),
    {
      type: 'actions',
      items: [
        { label: pick(caps, '安装 / 重装', 'Install'), action: 'install' },
        { label: pick(caps, '启动', 'Start'), action: 'start' },
        { label: pick(caps, '停止', 'Stop'), action: 'stop' },
      ],
    },
  ]
  const copyItems = [
    { title: pick(caps, '复制网关地址', 'Copy gateway address'), subtitle: state.gatewayUrl, icon: 'copy', action: 'copyGateway' },
  ]
  if (showWeb) {
    copyItems.push({ title: pick(caps, '复制网页版地址（含 key）', 'Copy web address (with key)'), subtitle: state.webUrl || '—', icon: 'globe', action: 'copyWeb' })
  }
  gatewayChildren.push({ type: 'list', items: copyItems })
  gatewayChildren.push(logNode(state, caps))

  const settingsChildren = [
    {
      type: 'select',
      label: pick(caps, '启动方式', 'Start mode'),
      bind: 'data.form.startMode',
      onChange: 'change',
      options: [
        { label: pick(caps, '仅网关（magpie serve）', 'Gateway only (magpie serve)'), value: 'serve' },
        { label: pick(caps, '网关 + 网页（magpie web）', 'Gateway + web (magpie web)'), value: 'web' },
      ],
    },
    { type: 'number', label: pick(caps, '网关端口', 'Gateway port'), bind: 'data.form.gatewayPort', min: 1, max: 65535, required: true },
  ]
  if (draft?.startMode === 'web') {
    settingsChildren.push({ type: 'number', label: pick(caps, '网页版端口', 'Web port'), bind: 'data.form.webPort', min: 1, max: 65535, required: true })
    settingsChildren.push({
      type: 'textField',
      label: pick(caps, '网页版 key（MAGPIE_WEB_KEY）', 'Web key (MAGPIE_WEB_KEY)'),
      bind: 'data.form.webKey',
      maxLength: 64,
      placeholder: pick(caps, '留空则每次启动随机生成', 'Empty: a new key each start'),
    })
  }
  settingsChildren.push({
    type: 'segmented',
    label: pick(caps, '代理用法', 'Proxy usage'),
    bind: 'data.form.proxyMode',
    onChange: 'change',
    options: [
      { label: pick(caps, '不用代理', 'Off'), value: 'off' },
      { label: pick(caps, '直连失败再用', 'Fallback'), value: 'fallback' },
      { label: pick(caps, '始终使用', 'Always'), value: 'always' },
    ],
  })
  if (draft?.proxyMode !== 'off') {
    settingsChildren.push({
      type: 'textField',
      label: pick(caps, '安装代理', 'Install proxy'),
      bind: 'data.form.proxy',
      maxLength: 200,
      placeholder: 'http://127.0.0.1:10808',
    })
  }
  settingsChildren.push({ type: 'toggle', label: pick(caps, '随引擎自动启动', 'Start with the engine'), bind: 'data.form.autoStart' })

  return {
    v: 2,
    type: 'stack',
    accent: 'teal',
    title: 'Magpie',
    style: { gap: 'M' },
    children: [
      {
        type: 'tabs',
        items: [
          { label: pick(caps, '网关', 'Gateway'), children: gatewayChildren },
          {
            label: pick(caps, '设置', 'Settings'),
            children: [{ type: 'form', label: pick(caps, '设置', 'Settings'), submit: 'save', submitLabel: pick(caps, '保存设置', 'Save settings'), children: settingsChildren }],
          },
        ],
      },
    ],
  }
}

/** 面板 data 推送的形状：显示字段 + 表单草稿。 */
export function panelData(state, draft = state.settings) {
  return {
    ...state,
    form: {
      startMode: draft.startMode,
      proxyMode: draft.proxyMode,
      proxy: draft.proxy,
      autoStart: draft.autoStart,
      gatewayPort: draft.gatewayPort,
      webPort: draft.webPort,
      webKey: draft.webKey,
    },
  }
}
