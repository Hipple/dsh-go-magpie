// 构造面板视图：网关 / 设置 两个页签。v2 的显示值都走 data 绑定，
// 这样每次数据推送（含进入页签时的首推、以及每 2 秒的刷新）都是最新值，不依赖视图缓存。
const V2_COMPONENTS = ['tabs', 'form', 'number', 'select', 'segmented', 'textField', 'toggle', 'actions', 'list', 'keyValue', 'text']

const pick = (caps, zh, en) => (String(caps?.locale ?? '').startsWith('en') ? en : zh)
const en = caps => String(caps?.locale ?? '').startsWith('en')
const bind = path => ({ $: `data.${path}` })

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
  const webMode = (state.mode || state.settings?.startMode) === 'web'
  return webMode
    ? pick(caps, '网关 + 网页（magpie web）', 'Gateway + web (magpie web)')
    : pick(caps, '仅网关（magpie serve）', 'Gateway only (magpie serve)')
}

export function proxyModeText(mode, caps) {
  if (mode === 'always') return pick(caps, '始终使用', 'Always')
  if (mode === 'fallback') return pick(caps, '直连失败再用', 'Fallback')
  return pick(caps, '不用代理', 'Off')
}

function summaryRowsBound(caps) {
  const rows = [
    [pick(caps, '状态', 'Status'), bind(en(caps) ? 'statusEn' : 'statusZh')],
    [pick(caps, '版本', 'Version'), bind('versionText')],
    [pick(caps, '启动方式', 'Start mode'), bind(en(caps) ? 'modeEn' : 'modeZh')],
    [pick(caps, '网关地址', 'Gateway'), bind('gatewayUrl')],
  ]
  // 仅网关时不显示网页版相关地址。
  if (summaryShowsWeb(caps)) rows.push([pick(caps, '网页版', 'Web'), bind('webUrlText')])
  return rows
}

// v2 里由数据决定显隐；v1 静态摘要无法响应，所以仍按当前设置判断。
function summaryShowsWeb(caps) {
  return caps.__showWeb === true
}

function summaryRowsLiteral(state, caps) {
  const rows = [
    [pick(caps, '状态', 'Status'), statusText(state, caps)],
    [pick(caps, '版本', 'Version'), state.version || '—'],
    [pick(caps, '启动方式', 'Start mode'), modeText(state, caps)],
    [pick(caps, '网关地址', 'Gateway'), state.gatewayUrl],
  ]
  if (state.settings?.startMode === 'web') rows.push([pick(caps, '网页版', 'Web'), state.webUrl || '—'])
  return rows
}

function tailText(state) {
  const text = String(state.logTail ?? '').trim()
  return text === '' ? '—' : text
}

/** 日志：优先用 codeBlock（App 给固定高度 + 可滚动；code 必须是字符串，不能绑定）。 */
function logNode(state, caps) {
  const text = tailText(state)
  if (Array.isArray(caps?.components) && caps.components.includes('codeBlock')) {
    return { type: 'codeBlock', code: text, language: 'text' }
  }
  return { type: 'text', text: text.slice(-1200), tone: 'muted' }
}

export function buildView(state, caps = {}, draft = state.settings) {
  const showWeb = state.settings?.startMode === 'web'
  const viewCaps = { ...caps, __showWeb: showWeb }

  if (!supportsV2(viewCaps)) {
    const children = [
      { type: 'keyValue', items: summaryRowsLiteral(state, viewCaps) },
      { type: 'text', text: tailText(state), tone: 'muted' },
    ]
    if (state.lastError) children.push({ type: 'text', text: String(state.lastError).slice(0, 120) })
    return { type: 'stack', title: 'Magpie', children }
  }

  const gatewayChildren = [
    { type: 'keyValue', items: summaryRowsBound(viewCaps) },
    { type: 'text', text: bind(en(viewCaps) ? 'noticeEn' : 'noticeZh'), tone: 'muted' },
    {
      type: 'actions',
      items: [
        { label: pick(viewCaps, '安装 / 重装', 'Install'), action: 'install' },
        { label: pick(viewCaps, '启动', 'Start'), action: 'start' },
        { label: pick(viewCaps, '停止', 'Stop'), action: 'stop' },
      ],
    },
  ]
  const copyItems = [
    { title: pick(viewCaps, '复制网关地址', 'Copy gateway address'), subtitle: bind('gatewayUrl'), icon: 'copy', action: 'copyGateway' },
  ]
  if (showWeb) {
    copyItems.push({ title: pick(viewCaps, '复制网页版地址（含 key）', 'Copy web address (with key)'), subtitle: bind('webUrlText'), icon: 'globe', action: 'copyWeb' })
  }
  gatewayChildren.push({ type: 'list', items: copyItems })
  gatewayChildren.push(logNode(state, viewCaps))

  const settingsChildren = [
    {
      type: 'select',
      label: pick(viewCaps, '启动方式', 'Start mode'),
      bind: 'data.form.startMode',
      onChange: 'change',
      options: [
        { label: pick(viewCaps, '仅网关（magpie serve）', 'Gateway only (magpie serve)'), value: 'serve' },
        { label: pick(viewCaps, '网关 + 网页（magpie web）', 'Gateway + web (magpie web)'), value: 'web' },
      ],
    },
    { type: 'number', label: pick(viewCaps, '网关端口', 'Gateway port'), bind: 'data.form.gatewayPort', min: 1, max: 65535, required: true },
  ]
  if (draft?.startMode === 'web') {
    settingsChildren.push({ type: 'number', label: pick(viewCaps, '网页版端口', 'Web port'), bind: 'data.form.webPort', min: 1, max: 65535, required: true })
    settingsChildren.push({
      type: 'textField',
      label: pick(viewCaps, '网页版 key（MAGPIE_WEB_KEY）', 'Web key (MAGPIE_WEB_KEY)'),
      bind: 'data.form.webKey',
      maxLength: 64,
      placeholder: pick(viewCaps, '留空则每次启动随机生成', 'Empty: a new key each start'),
    })
  }
  settingsChildren.push({
    type: 'segmented',
    label: pick(viewCaps, '代理用法', 'Proxy usage'),
    bind: 'data.form.proxyMode',
    onChange: 'change',
    options: [
      { label: pick(viewCaps, '不用代理', 'Off'), value: 'off' },
      { label: pick(viewCaps, '直连失败再用', 'Fallback'), value: 'fallback' },
      { label: pick(viewCaps, '始终使用', 'Always'), value: 'always' },
    ],
  })
  if (draft?.proxyMode !== 'off') {
    settingsChildren.push({
      type: 'textField',
      label: pick(viewCaps, '安装代理', 'Install proxy'),
      bind: 'data.form.proxy',
      maxLength: 200,
      placeholder: 'http://127.0.0.1:10808',
    })
  }
  settingsChildren.push({ type: 'toggle', label: pick(viewCaps, '随引擎自动启动', 'Start with the engine'), bind: 'data.form.autoStart' })

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
          { label: pick(viewCaps, '网关', 'Gateway'), children: gatewayChildren },
          {
            label: pick(viewCaps, '设置', 'Settings'),
            children: [{ type: 'form', label: pick(viewCaps, '设置', 'Settings'), submit: 'save', submitLabel: pick(viewCaps, '保存设置', 'Save settings'), children: settingsChildren }],
          },
        ],
      },
    ],
  }
}

/** 面板数据：显示值（带中英文两版文案）与表单草稿。每次推送都是最新的。 */
export function panelData(state, draft = state.settings) {
  const notice = []
  if (state.lastError) notice.push(String(state.lastError))
  if (state.needsRestart) notice.push('启动方式或端口改过了，重启网关后生效')
  const noticeEn = []
  if (state.lastError) noticeEn.push(String(state.lastError))
  if (state.needsRestart) noticeEn.push('Start mode or ports changed; restart the gateway to apply')
  return {
    ...state,
    versionText: state.version || '—',
    webUrlText: state.webUrl || '—',
    statusZh: statusText(state, { locale: 'zh-CN' }),
    statusEn: statusText(state, { locale: 'en-US' }),
    modeZh: modeText(state, { locale: 'zh-CN' }),
    modeEn: modeText(state, { locale: 'en-US' }),
    noticeZh: notice.join('；'),
    noticeEn: noticeEn.join('; '),
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
