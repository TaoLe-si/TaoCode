// 「插件」节判据 —— 对照 ZCode `.tools/ZCode` 的 plugin 设置面。
//
// 钉住四件事：
//   1. 组件类型顺序 / 分组规则 / 来源标签措辞**逐字**对齐 ZCode（每条带出处）；
//   2. `packageStatus === 'missing'` 的投影不进分组（ZCode 那条注释写明否则会出现
//      「已安装分组 + 未安装状态」的矛盾行）；
//   3. **依赖没满足时不许启用** —— 这是本仓比 ZCode 更严的一档（ZCode 侧 `pluginEnabledChange.ts`
//      全文只做「RPC 成功才继续」，没有依赖图）；
//   4. 每条「不许出现 X」都配一条阳性对照 —— 本仓吃过空判据的亏。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_PLUGINS_STORAGE_KEY,
  AGENT_PLUGINS_TITLE,
  AGENT_PLUGIN_COMPONENT_KINDS,
  AGENT_PLUGIN_COMPONENT_LABELS,
  AGENT_PLUGIN_GROUP_LABELS,
  AGENT_PLUGIN_SCOPE_LABELS,
  AGENT_PLUGIN_TABS,
  ZCODE_BROWSER_USE_PLUGIN_ID,
  ZCODE_DOCUMENT_PLUGIN_ORDER,
  ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
  applyPluginEnabledChange,
  defaultAgentPluginsSettings,
  loadAgentPluginsSettings,
  normalizeAgentPluginsSettings,
  pluginCapabilityProjectionOf,
  pluginSourceLabelOf,
  resolveMarketplaceDisplayName,
  saveAgentPluginsSettings,
  validateAgentPluginsSettings,
} from '../src/agentPlugins.ts'
import { createMemoryStorage, createThrowingStorage } from '../src/agentSettingsStore.ts'

function pluginEntry(overrides = {}) {
  return {
    id: 'sample@personal',
    name: '示例插件',
    enabled: true,
    source: 'personal',
    marketplace: 'my-market',
    mcpServerNames: [],
    rootPath: 'C:\\Users\\Administrator\\.minimax\\plugins\\sample',
    ...overrides,
  }
}

test('出厂默认与常量逐字对齐 ZCode', () => {
  const defaults = defaultAgentPluginsSettings()
  assert.deepEqual(defaults.entries, [])
  assert.deepEqual(defaults.builtInPluginIds, [])
  assert.deepEqual(defaults.marketplaces, [])
  assert.equal(defaults.tab, 'plugins', 'ZCode zh-CN.ts:3698 第一个 Tab')
  assert.equal(defaults.scope, 'user', 'ZCode zcode-protocol/index.ts:2485-2486')
  assert.deepEqual([...AGENT_PLUGIN_TABS], ['plugins', 'mcps', 'skills', 'commands'], 'ZCode zh-CN.ts:3698-3701')
  assert.equal(AGENT_PLUGINS_TITLE, '插件', 'ZCode zh-CN.ts:3695 settings.plugins.title')
  assert.equal(ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID, 'zcode-plugins-official', 'ZCode shared/src/plugin-marketplaces.ts:10')
  assert.equal(ZCODE_BROWSER_USE_PLUGIN_ID, 'browser-use@zcode-plugins-official', 'ZCode BrowserSettingsSection.tsx:30')
  assert.deepEqual([...ZCODE_DOCUMENT_PLUGIN_ORDER], ['pdf', 'presentations', 'spreadsheets', 'documents'],
    'ZCode shared/src/pluginStoreOrdering.ts:16')
  assert.deepEqual(AGENT_PLUGIN_GROUP_LABELS, { installed: '已安装', builtIn: '内置' }, 'ZCode zh-CN.ts:3703-3704')
  assert.deepEqual(AGENT_PLUGIN_SCOPE_LABELS, { user: '用户', workspace: '工作区' }, 'ZCode zh-CN.ts:3696-3697')
})

test('组件类型与顺序逐字对齐 ZCode：agent / command / skill / hook / mcp + 中文标签', () => {
  assert.deepEqual([...AGENT_PLUGIN_COMPONENT_KINDS], ['agent', 'command', 'skill', 'hook', 'mcp'],
    'ZCode zcode-protocol/index.ts:2515-2518 与 pluginManagedResourceGroups.ts:22-28')
  assert.deepEqual(AGENT_PLUGIN_COMPONENT_LABELS,
    { agent: 'Agents', command: '命令', skill: '技能', hook: 'Hooks', mcp: 'MCP 服务器' },
    'ZCode zh-CN.ts:3864-3868')
})

test('能力投影：组件按固定顺序、省略空组、数量 = items.length（不管协议里的声明顺序）', () => {
  const entry = pluginEntry({
    components: [
      { kind: 'mcp', items: [{ name: 'a-mcp' }] },
      { kind: 'agent', items: [{ name: 'a1' }, { name: 'a2' }] },
      { kind: 'skill', items: [] },
    ],
  })
  const capability = pluginCapabilityProjectionOf(entry)
  assert.deepEqual(capability.componentGroups.map((group) => group.kind), ['agent', 'mcp'],
    'ZCode pluginManagedResourceGroups.ts:49-51：按 COMPONENT_KIND_ORDER 输出，不按输入顺序')
  assert.equal(capability.componentGroups[0].count, 2, 'ZCode :43：数量取 items.length，不取协议里的 skillCount')
  assert.equal(capability.componentCount, 3)
  assert.equal(capability.componentGroups[0].label, 'Agents', 'ZCode PluginComponentGroups.tsx:29-35')
  // 阳性对照：空组件给的是「启用后查看」而不是空白。
  assert.equal(pluginCapabilityProjectionOf(pluginEntry()).componentGroups.length, 0)
  assert.equal(pluginCapabilityProjectionOf(pluginEntry()).componentEmptyHint, '无组件', 'ZCode zh-CN.ts:3862')
  assert.equal(pluginCapabilityProjectionOf(pluginEntry({ enabled: false })).componentEmptyHint, '启用插件后查看其组件。',
    'ZCode zh-CN.ts:3863')
})

test('能力投影：packageStatus=missing 的投影不进分组（ZCode 明确注释过矛盾行）', () => {
  const missing = pluginEntry({ packageStatus: 'missing', enabled: false })
  const capability = pluginCapabilityProjectionOf(missing, ['sample@personal'])
  assert.equal(capability.materialized, false, 'ZCode pluginCapabilityProjection.ts:40')
  assert.equal(capability.canEnable, false, '未物化的插件不能启用')
  const ok = pluginCapabilityProjectionOf(pluginEntry(), ['sample@personal'])
  assert.equal(ok.materialized, true, '阳性对照：缺省即已物化（ZCode zcode-protocol/index.ts:2561）')
  assert.equal(ok.canEnable, true)
})

test('分组与官方文档卡置顶序', () => {
  const builtIn = pluginCapabilityProjectionOf(
    pluginEntry({ id: `pdf@${ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID}`, source: 'official' }),
    [`pdf@${ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID}`],
  )
  assert.equal(builtIn.group, 'builtIn', 'ZCode pluginCapabilityProjection.ts:42-46：id 命中内置表走内置组')
  assert.equal(builtIn.groupLabel, '内置')
  assert.equal(builtIn.documentRank, 0, 'ZCode pluginStoreOrdering.ts:16 pdf 排第一')
  const second = pluginCapabilityProjectionOf(pluginEntry({ id: `presentations@${ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID}` }))
  assert.equal(second.documentRank, 1, 'ZCode :16 presentations 排第二')
  const unknown = pluginCapabilityProjectionOf(pluginEntry({ id: 'zzz@personal' }))
  assert.equal(unknown.documentRank, 4, 'ZCode :76-79 compareRanks：未命中的排到 order.size 之后')
  const installed = pluginCapabilityProjectionOf(pluginEntry())
  assert.equal(installed.group, 'installed', '阳性对照：不在内置表里就是已安装组')
})

test('来源标签：官方叫「内置」，其余「从 {marketplace} 安装」，marketplace 查不到回落原始 id', () => {
  const official = pluginEntry({ source: 'official' })
  assert.equal(pluginSourceLabelOf(official), '内置',
    'ZCode zh-CN.ts:3796；内置判据取 pluginCapabilityProjection.ts:24 的 source === "official"')
  const named = pluginEntry({ marketplace: 'my-market' })
  assert.equal(pluginSourceLabelOf(named, [{ id: 'my-market', name: '我的市场' }]), '从 我的市场 安装',
    'ZCode zh-CN.ts:3797 + pluginSourceLabel.ts:12-13')
  assert.equal(pluginSourceLabelOf(named, []), '从 my-market 安装',
    'ZCode pluginSourceLabel.ts:13 的 `?? marketplaceId`：查不到就回落原始 id，不许编名字')
  assert.equal(resolveMarketplaceDisplayName('my-market', [{ id: 'my-market', name: '我的市场' }]), '我的市场')
  assert.equal(pluginSourceLabelOf(pluginEntry({ marketplace: '' })), '从 sample@personal 安装',
    'marketplace 为空（ZCode 协议里 nonEmptyString 不会发生）时退回 id，不出「从  安装」这种破句')
})

test('启停闸门：依赖没满足时拒绝启用，且不改动列表', () => {
  const blocked = pluginEntry({ enabled: false, depends: ['core'], missingDependencies: ['core'] })
  const result = applyPluginEnabledChange([blocked], blocked.id, true, false)
  assert.equal(result.applied, false, '依赖没满足 → 不许启用')
  assert.equal(result.reason, 'dependency-missing')
  assert.equal(result.entries[0].enabled, false, '列表必须原样返回，不许先把开关拨过去')
  assert.ok(result.message.includes('core'), `原因要指名缺哪个依赖：${result.message}`)
  // 阳性对照：依赖满足时同一个调用就落上。
  const ok = applyPluginEnabledChange([blocked], blocked.id, true, true)
  assert.equal(ok.applied, true, 'available=true 且依赖满足 → 允许启用')
  assert.equal(ok.entries[0].enabled, true)
  assert.equal(ok.reason, 'ok')
})

test('启停闸门：未物化 / 未知 id / 已经是目标态都判 applied=false（不许继续授权引导）', () => {
  const missing = pluginEntry({ enabled: false, packageStatus: 'missing' })
  const notMaterialized = applyPluginEnabledChange([missing], missing.id, true, true)
  assert.equal(notMaterialized.applied, false)
  assert.equal(notMaterialized.reason, 'not-materialized', 'ZCode zcode-protocol/index.ts:2561-2562')

  const unknown = applyPluginEnabledChange([pluginEntry()], 'ghost@personal', true, true)
  assert.equal(unknown.applied, false)
  assert.equal(unknown.reason, 'unknown-plugin', 'ZCode pluginEnabledChange.ts:19-21 的 isCurrent 那一半')

  const unchanged = applyPluginEnabledChange([pluginEntry({ enabled: true })], 'sample@personal', true, true)
  assert.equal(unchanged.applied, false, '没有发生 RPC 就没有「服务端确认成功」')
  assert.equal(unchanged.reason, 'unchanged')
  // 阳性对照：停用方向永远放行（依赖只挡启用，与 IDEA 的 `missing` 语义一致）。
  const disabled = applyPluginEnabledChange(
    [pluginEntry({ enabled: true, missingDependencies: ['core'] })], 'sample@personal', false, false,
  )
  assert.equal(disabled.applied, true, '停用不设闸：坏掉的插件必须允许关掉')
  assert.equal(disabled.entries[0].enabled, false)
})

test('启停闸门：停用依赖成环的插件也被校验拦下（上游判为不可加载）', () => {
  const capability = pluginCapabilityProjectionOf(
    pluginEntry({ enabled: false, depends: ['a', 'b'], dependencyCycle: ['a', 'b'] }),
  )
  assert.equal(capability.dependencySatisfied, false, 'src/pluginGroups.ts:82-87 必需依赖成环即不可加载')
  assert.ok(capability.blockedReason.includes('a'), 'blockedReason 要说清缺什么')
  const ok = pluginCapabilityProjectionOf(pluginEntry({ enabled: false, optionalDepends: ['nope'] }))
  assert.equal(ok.dependencySatisfied, true, '阳性对照：只有可选依赖缺失不挡启用')
})

test('坏存档逐字段救：enabled 缺键按停用、非法组件类型丢弃、重 id 去重、marketplace 缺名回落 id', () => {
  const saved = normalizeAgentPluginsSettings({
    entries: [
      { id: 'a@x', name: '甲' },
      { id: 'a@x', name: '重复' },
      { id: 'b@x', name: '乙', components: [{ kind: 'lsp', items: [{ name: 'x' }] }, { kind: 'skill', items: [{ name: ' ' }] }] },
      '不是对象',
      { name: '缺 id' },
    ],
    marketplaces: [{ id: 'm1' }, 'x'],
    tab: 'nope',
  })
  assert.equal(saved.entries.length, 2, '重 id 去重；缺 id 与非对象各丢一条')
  assert.equal(saved.entries[0].enabled, false, 'ZCode index.ts:2541 enabled 是必填布尔；缺键按停用救（默认启用等于替用户做了授权决定）')
  assert.equal(saved.entries[0].source, 'local', 'source 缺键兜底成 local，不猜 official')
  assert.equal(saved.entries[1].components, undefined, '非法组件类型与空名项都丢（ZCode index.ts:2517 的枚举 + :2522 nonEmptyString）')
  assert.deepEqual(saved.marketplaces, [{ id: 'm1', name: 'm1' }], 'ZCode pluginSourceLabel.ts:13 同样的回落')
  assert.equal(saved.tab, 'plugins', '非法 Tab 退回第一个')
  assert.deepEqual(normalizeAgentPluginsSettings(null), defaultAgentPluginsSettings(), 'null → 出厂默认')
  assert.deepEqual(normalizeAgentPluginsSettings('垃圾'), defaultAgentPluginsSettings(), '非对象 → 出厂默认')
})

test('校验拦下：路径越界 / 已启用但依赖缺失 / missing 却启用 / 内置表对不上', () => {
  const settings = normalizeAgentPluginsSettings({
    entries: [
      pluginEntry({ id: 'a@x', name: '甲' }),
      pluginEntry({ id: 'a@x', name: '甲重复' }),
      pluginEntry({ id: 'c@x', name: '丙', rootPath: 'C:\\..\\Windows\\plugin.json' }),
      pluginEntry({ id: 'd@x', name: '丁', depends: ['core'], missingDependencies: ['core'] }),
      pluginEntry({ id: 'e@x', name: '戊', packageStatus: 'missing' }),
      { id: '  ', name: '空 id' },
    ],
    builtInPluginIds: ['ghost@x'],
  })
  assert.equal(settings.entries.length, 4, 'normalize 按 id 去重：同 id 只能是同一个插件，重复那条在读路径上就丢掉了')
  const problems = validateAgentPluginsSettings(settings)
  assert.ok(problems.some((p) => p.includes('丙') && p.includes('越出插件目录')), '路径越界要报')
  assert.ok(problems.some((p) => p.includes('丁') && p.includes('依赖没满足')), '已启用但依赖缺失要报')
  assert.ok(problems.some((p) => p.includes('戊') && p.includes('尚未物化')), 'missing 却启用要报')
  assert.ok(problems.some((p) => p.includes('ghost@x') && p.includes('分组会对不上')), '内置表里有清单外的 id 要报')
  assert.ok(!problems.some((p) => p.includes('重名')), '阴性对照：重复 id 已在 normalize 阶段去重，不该在这里再报一次')
  // 阳性对照：一条干净条目零问题 —— 证明上面四条不是恒真。
  assert.deepEqual(validateAgentPluginsSettings(normalizeAgentPluginsSettings({ entries: [pluginEntry()] })), [],
    '阳性对照：合法条目不报任何问题')
})

test('validate 的空 id / 空名 / 重名守卫不假设 normalize 跑过（它是公开导出）', () => {
  // 这一组刻意绕过 normalize 直接喂脏形状：validate 是导出的纯函数，
  // 任何调用方（包括未来的主代理接线）都可能被喂到未归一化的对象，它必须自己站住。
  const problems = validateAgentPluginsSettings({
    entries: [
      { id: '  ', name: '空 id', enabled: false, source: 'local', marketplace: '', mcpServerNames: [], rootPath: '' },
      { id: 'f@x', name: '   ', enabled: false, source: 'local', marketplace: '', mcpServerNames: [], rootPath: '' },
      { id: 'g@x', name: '重复一', enabled: false, source: 'local', marketplace: '', mcpServerNames: [], rootPath: '' },
      { id: 'g@x', name: '重复二', enabled: false, source: 'local', marketplace: '', mcpServerNames: [], rootPath: '' },
    ],
    builtInPluginIds: [],
    marketplaces: [],
    tab: 'plugins',
    scope: 'user',
    scopeKey: 'user',
    query: '',
  })
  assert.ok(problems.some((p) => p.includes('插件 id 不能为空')), '空 id 要报（ZCode zcode-protocol/index.ts:2537 nonEmptyString）')
  assert.ok(problems.some((p) => p.includes('f@x') && p.includes('名称不能为空')), '空名要报（ZCode :2538）')
  assert.ok(problems.some((p) => p.includes('g@x') && p.includes('重名')), '重名要报（ZCode :2537 是主键）')
  assert.ok(!problems.some((p) => p.includes('依赖没满足')), '阴性对照：未启用且无依赖字段时不误报依赖问题')
})

test('存储往返 + 无存储/抛异常/坏 JSON 静默降级', () => {
  const storage = createMemoryStorage()
  const settings = defaultAgentPluginsSettings()
  settings.entries = [pluginEntry({ components: [{ kind: 'skill', items: [{ name: 's1', description: 'd1' }] }] })]
  settings.builtInPluginIds = ['sample@personal']
  settings.marketplaces = [{ id: 'my-market', name: '我的市场' }]
  settings.tab = 'skills'
  settings.scope = 'workspace'
  settings.scopeKey = 'workspace:/proj'
  settings.query = '示例'
  assert.equal(saveAgentPluginsSettings(settings, storage), true)
  assert.ok(storage.dump()[AGENT_PLUGINS_STORAGE_KEY], `存档必须落在 ${AGENT_PLUGINS_STORAGE_KEY} 上`)
  const back = loadAgentPluginsSettings(storage)
  assert.equal(back.entries[0].components[0].items[0].description, 'd1')
  assert.deepEqual(back.builtInPluginIds, ['sample@personal'])
  assert.deepEqual(back.marketplaces, [{ id: 'my-market', name: '我的市场' }])
  assert.equal(back.tab, 'skills')
  assert.equal(back.scope, 'workspace')
  assert.equal(back.scopeKey, 'workspace:/proj')
  assert.equal(back.query, '示例')

  assert.deepEqual(loadAgentPluginsSettings(null), defaultAgentPluginsSettings(), '无存储 = 出厂默认')
  assert.deepEqual(loadAgentPluginsSettings(createThrowingStorage()), defaultAgentPluginsSettings(), 'getItem 抛异常 = 静默降级')
  assert.deepEqual(
    loadAgentPluginsSettings(createMemoryStorage({ [AGENT_PLUGINS_STORAGE_KEY]: '[坏' })),
    defaultAgentPluginsSettings(),
    '坏 JSON 退回默认，不把用户锁在设置外',
  )
  assert.equal(saveAgentPluginsSettings(settings, null), false, '存不下只丢持久化')
  assert.equal(saveAgentPluginsSettings(settings, createThrowingStorage()), false, 'setItem 抛异常也只丢持久化')
  // 阳性对照：同一个存储正常时读得到。
  const good = createMemoryStorage()
  saveAgentPluginsSettings({ ...defaultAgentPluginsSettings(), query: 'q' }, good)
  assert.equal(loadAgentPluginsSettings(good).query, 'q', '阳性对照：存储可用时往返成立')
})
