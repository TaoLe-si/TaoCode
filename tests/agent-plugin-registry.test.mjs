// 「插件」节注册表判据 —— 对照 ZCode `.tools/ZCode` 的 plugin 设置面（管理面）。
//
// 钉住四件事：
//   1. 条目形状 / 组件分组顺序 / 作用域徽标 / 卸载确认 / 市场来源**逐字**对齐 ZCode
//      （每条断言尾注 `文件:行号`）；
//   2. 坏档一律救回默认且永不抛（含 getItem 直接抛的存储替身）；
//   3. 启停带作用域：workspace 档写 `enabledSource` 并用 workspace 文案，user 档用 user 文案；
//   4. 每条「不许出现 X」都配一条阳性对照（本仓吃过空判据的亏）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_PLUGIN_COMPONENT_ORDER,
  AGENT_PLUGIN_MESSAGES,
  AGENT_PLUGIN_REGISTRY_STORAGE_KEY,
  AGENT_PLUGIN_SCOPE_MENU_LABELS,
  addAgentPluginMarketplaceSource,
  agentPluginComponentCountLabel,
  agentPluginComponentGroups,
  agentPluginComponentsEmptyHint,
  agentPluginConfigScope,
  agentPluginEnablement,
  agentPluginHookCommand,
  agentPluginHookMatcher,
  agentPluginHookRunnableLabel,
  agentPluginHookShell,
  agentPluginMarketplaceRow,
  agentPluginMarketplaceUpdateOperationId,
  agentPluginMenuHasActionsBeforeUninstall,
  agentPluginScopeBadge,
  agentPluginToggleLabel,
  agentPluginTogglePendingLabel,
  agentPluginUninstallPrompt,
  agentPluginUninstallTarget,
  agentPluginWorkspaceKey,
  canRequestAgentPluginUninstall,
  canResetAgentPluginWorkspaceOverride,
  cancelAgentPluginUninstall,
  confirmAgentPluginUninstall,
  defaultAgentPluginRegistry,
  defaultAgentPluginUninstallState,
  formatPluginMessage,
  formatPluginSourceTime,
  isAgentPluginComponentGroup,
  isAgentPluginItemBusy,
  isAgentPluginMarketplaceRemovable,
  isAgentPluginPublicMarketplace,
  isAgentPluginScopeWorkspaceConnected,
  isAgentPluginUninstalling,
  loadAgentPluginRegistry,
  normalizeAgentPluginMarketplaceSourceInput,
  normalizeAgentPluginRegistry,
  normalizeAgentPluginRegistryEntry,
  partitionAgentPluginRegistry,
  pluginOperationId,
  removeAgentPluginEntry,
  removeAgentPluginMarketplaceSource,
  requestAgentPluginUninstall,
  resetAgentPluginWorkspaceOverride,
  resolveAgentPluginScopeSelection,
  saveAgentPluginRegistry,
  selectAgentPluginScopeOptions,
  setAgentPluginEnabled,
  sortAgentPluginMarketplaceSources,
  validateAgentPluginRegistry,
} from '../src/agentPluginRegistry.ts'
import { createMemoryStorage, createThrowingStorage } from '../src/agentSettingsStore.ts'

function entry(overrides = {}) {
  return {
    id: 'sample@my-market',
    name: 'sample',
    enabled: true,
    source: 'cache',
    marketplace: 'my-market',
    mcpServerNames: [],
    rootPath: 'C:/plugins/sample',
    ...overrides,
  }
}

function marketplace(overrides = {}) {
  return { id: 'my-market', name: '我的市场', source: { kind: 'user' }, pluginCount: 2, ...overrides }
}

test('存储键与节常量对齐 ZCode', () => {
  assert.equal(AGENT_PLUGIN_REGISTRY_STORAGE_KEY, 'taocode.agent.plugins.registry')
  // zh-CN.ts:3695 / 3737-3738
  assert.equal(AGENT_PLUGIN_MESSAGES.sectionTitle, '插件')
  assert.equal(AGENT_PLUGIN_MESSAGES.sectionDescription, '启用或停用已安装的插件。插件可打包技能、命令、Hooks 和 MCP 服务器。')
  // pluginManagedResourceGroups.ts:22-28：agent / command / skill / hook / mcp
  assert.deepEqual([...AGENT_PLUGIN_COMPONENT_ORDER], ['agent', 'command', 'skill', 'hook', 'mcp'])
  assert.equal(AGENT_PLUGIN_SCOPE_MENU_LABELS.user, '用户')
  assert.equal(AGENT_PLUGIN_SCOPE_MENU_LABELS.workspaces, '工作区')
})

test('formatPluginMessage 只替换已知占位符', () => {
  assert.equal(formatPluginMessage('启用 {plugin}', { plugin: '示例' }), '启用 示例')
  assert.equal(formatPluginMessage('{a} / {b}', { a: '1' }), '1 / {b}')
  assert.equal(formatPluginMessage('无占位'), '无占位')
})

test('归一化：垃圾输入回默认，永不抛', () => {
  for (const bad of [null, undefined, 0, 'x', [], true]) {
    assert.deepEqual(normalizeAgentPluginRegistry(bad), defaultAgentPluginRegistry())
  }
  const messy = normalizeAgentPluginRegistry({
    entries: [entry(), { id: 'sample@my-market', name: 'dup' }, { name: 'no id' }, 'nope'],
    builtInPluginIds: ['b@x', '', 7, 'b@x'],
    marketplaces: [marketplace(), { id: 'my-market', name: 'dup' }, { name: 'no id' }],
    tab: 'bogus',
    scope: 'bogus',
    scopeKey: '  ',
    query: 42,
  })
  assert.equal(messy.entries.length, 1, '同 id 去重 + 丢垃圾条目')
  assert.deepEqual(messy.builtInPluginIds, ['b@x'])
  assert.equal(messy.marketplaces.length, 1, '同 id 市场去重')
  assert.equal(messy.tab, 'plugins')
  assert.equal(messy.scope, 'user')
  assert.equal(messy.scopeKey, 'user')
  assert.equal(messy.query, '')
})

test('归一化：管理面字段逐格保留', () => {
  const parsed = normalizeAgentPluginRegistryEntry({
    ...entry({ components: [{ kind: 'skill', items: [{ name: 'pdf', description: 'PDF' }, { name: 'xlsx' }] }] }),
    author: 'ACME',
    homepage: 'https://example.com',
    skillCount: 2,
    skillRootCount: 1,
    commandRootCount: 3,
    declaredMcpServerNames: ['github'],
    hostMcpServerNames: ['host-mcp'],
    hookDetails: [
      {
        event: 'PreToolUse',
        type: 'command',
        command: 'node',
        args: ['hook.js'],
        runnable: true,
        sourcePath: 'C:/plugins/sample/hooks.json',
        shell: true,
        timeoutMs: 5000,
        async: false,
      },
      { event: '', command: 'x', sourcePath: '' },
    ],
    userConfig: { token: { sensitive: true, required: true, title: '令牌', type: 'string' }, level: { type: 'number', default: 2 } },
    configuredOptions: { level: 3, flag: true },
    optionSources: { level: 'workspace', bogus: 'nope' },
    listing: { displayName: '示例', category: 'developer-tools', requiresPaidPlan: true, examplePrompts: ['试试'] },
    installedMeta: { scope: 'user', version: '1.2.0', updateStatus: 'update-available', latestVersion: '1.3.0', installedAt: '2026-01-01T00:00:00Z' },
  })
  assert.equal(parsed.author, 'ACME')
  assert.equal(parsed.skillRootCount, 1)
  assert.deepEqual(parsed.declaredMcpServerNames, ['github'])
  assert.equal(parsed.hookDetails.length, 1, 'event/command 空的那条丢掉（index.ts:2490,2492 nonEmptyString）')
  assert.equal(parsed.hookDetails[0].shell, true)
  assert.equal(parsed.hookDetails[0].timeoutMs, 5000)
  assert.equal(parsed.userConfig.token.sensitive, true)
  assert.equal(parsed.userConfig.level.default, 2)
  assert.deepEqual(parsed.configuredOptions, { level: 3, flag: true })
  assert.deepEqual(parsed.optionSources, { level: 'workspace' }, '非法作用域值丢掉')
  assert.equal(parsed.listing.requiresPaidPlan, true)
  assert.equal(parsed.installedMeta.latestVersion, '1.3.0')
  assert.equal(parsed.components[0].items.length, 2)
})

test('校验：逐类硬问题都有判词，干净的清单零判词', () => {
  assert.deepEqual(validateAgentPluginRegistry({ ...defaultAgentPluginRegistry(), entries: [entry()] }), [])
  const problems = validateAgentPluginRegistry({
    entries: [
      entry({ id: '', name: 'x' }),
      entry({ id: 'a@m', name: '' }),
      entry({ id: 'a@m', name: 'a' }),
      entry({ id: 'b@m', name: 'b', rootPath: 'C:/plugins/../../etc' }),
      entry({ id: 'c@m', name: 'c', packageStatus: 'missing', enabled: true }),
      entry({ id: 'd@m', name: 'd', userConfig: {}, optionSources: { ghost: 'workspace' } }),
    ],
    builtInPluginIds: ['zzz@m'],
    marketplaces: [marketplace(), marketplace()],
  })
  const text = problems.join('\n')
  assert.match(text, /插件 id 不能为空/)
  assert.match(text, /的名称不能为空/)
  assert.match(text, /重名/)
  assert.match(text, /路径越出插件目录/)
  assert.match(text, /尚未物化/)
  assert.match(text, /没有对应的配置项/)
  assert.match(text, /市场源「my-market」重复登记/)
  assert.match(text, /内置插件「zzz@m」不在当前清单里/)
})

test('持久化：内存存储往返，坏档与抛异常的存储都回默认', () => {
  const storage = createMemoryStorage()
  const settings = { ...defaultAgentPluginRegistry(), entries: [entry()], query: 'sample' }
  assert.equal(saveAgentPluginRegistry(settings, storage), true)
  const loaded = loadAgentPluginRegistry(storage)
  assert.equal(loaded.entries.length, 1)
  assert.equal(loaded.query, 'sample')
  assert.equal(saveAgentPluginRegistry(settings, null), false)

  const broken = createMemoryStorage({ [AGENT_PLUGIN_REGISTRY_STORAGE_KEY]: '{not json' })
  assert.deepEqual(loadAgentPluginRegistry(broken), defaultAgentPluginRegistry())
  assert.deepEqual(loadAgentPluginRegistry(createThrowingStorage()), defaultAgentPluginRegistry())
  assert.equal(saveAgentPluginRegistry(settings, createThrowingStorage()), false)
})

test('分组：missing 不进任何组，内置组按文档插件置顶序', () => {
  const entries = [
    entry({ id: 'pdf@zcode-plugins-official', name: 'pdf' }),
    entry({ id: 'documents@zcode-plugins-official', name: 'documents' }),
    entry({ id: 'third@my-market', name: 'third' }),
    entry({ id: 'gone@my-market', name: 'gone', packageStatus: 'missing' }),
  ]
  const groups = partitionAgentPluginRegistry(entries, ['pdf@zcode-plugins-official', 'documents@zcode-plugins-official'])
  assert.deepEqual(groups.installed.map((item) => item.id), ['third@my-market'])
  // pluginStoreOrdering.ts:14-24：pdf 在 documents 之前
  assert.deepEqual(groups.builtIn.map((item) => item.id), ['pdf@zcode-plugins-official', 'documents@zcode-plugins-official'])
  assert.equal(groups.installed.length + groups.builtIn.length, 3, 'missing 那条两个组都不进')
})

test('组件分组：固定顺序、省略空组、标签取 zh-CN 原文', () => {
  const groups = agentPluginComponentGroups(
    entry({
      components: [
        { kind: 'mcp', items: [{ name: 'github' }] },
        { kind: 'agent', items: [{ name: 'reviewer', description: '审查' }] },
        { kind: 'skill', items: [] },
      ],
    }),
  )
  assert.deepEqual(groups.map((group) => group.kind), ['agent', 'mcp'], 'skill 空组被省略，顺序 agent 先于 mcp')
  assert.equal(groups[0].label, 'Agents')
  assert.equal(groups[1].label, 'MCP 服务器')
  assert.equal(groups[0].count, 1)
  assert.equal(agentPluginComponentCountLabel(3), '3 项')

  const sections = agentPluginComponentGroups(entry({ components: [{ kind: 'hook', items: [{ name: 'y' }] }, { kind: 'command', items: [{ name: 'c' }] }] }))
  assert.deepEqual(sections.map((group) => group.kind), ['command', 'hook'], '组件分组按 command…hook 顺序')
  assert.equal(agentPluginComponentsEmptyHint(true), '无组件')
  assert.equal(agentPluginComponentsEmptyHint(false), '启用插件后查看其组件。')
})

test('作用域徽标与启停文案对齐 PluginsSection', () => {
  assert.deepEqual(agentPluginScopeBadge(entry({ enabledSource: 'user' }), 'user'), { scope: 'user', label: 'User 默认' })
  assert.deepEqual(agentPluginScopeBadge(entry({ enabledSource: 'user' }), 'workspace'), { scope: 'user', label: '继承 User 默认' })
  assert.deepEqual(agentPluginScopeBadge(entry({ enabledSource: 'workspace' }), 'workspace'), { scope: 'workspace', label: '本工作区覆盖' })
  assert.deepEqual(agentPluginScopeBadge(entry({ enabledSource: undefined }), 'user'), { scope: 'default' })
  assert.equal(agentPluginToggleLabel(entry({ name: 'X', enabled: true })), '停用 X')
  assert.equal(agentPluginToggleLabel(entry({ name: 'X', enabled: false })), '启用 X')
  assert.equal(agentPluginTogglePendingLabel(entry({ name: 'X' })), '正在更新 X…')
})

test('启停：user 与 workspace 两档文案，enabledSource 落当前作用域', () => {
  const base = { ...defaultAgentPluginRegistry(), entries: [entry({ id: 'p@m', name: 'P', enabled: true })] }
  const off = setAgentPluginEnabled(base, 'p@m', false, 'user')
  assert.equal(off.applied, true)
  assert.equal(off.message, '已停用 P')
  assert.equal(off.settings.entries[0].enabled, false)
  assert.equal(off.settings.entries[0].enabledSource, 'user')

  const onWs = setAgentPluginEnabled(off.settings, 'p@m', true, 'workspace')
  assert.equal(onWs.applied, true)
  assert.equal(onWs.message, '已在当前工作区启用 P（覆盖 User 默认）')
  assert.equal(onWs.settings.entries[0].enabledSource, 'workspace')

  const offWs = setAgentPluginEnabled(onWs.settings, 'p@m', false, 'workspace')
  assert.equal(offWs.message, '已在当前工作区停用 P（覆盖 User 默认）')

  const onUser = setAgentPluginEnabled(offWs.settings, 'p@m', true, 'user')
  assert.equal(onUser.message, '已启用 P')
})

test('启停：依赖没满足 / 未物化 / 无变化 / 未知插件都被拒，且不改列表', () => {
  const missingDep = { ...defaultAgentPluginRegistry(), entries: [entry({ id: 'p@m', name: 'P', enabled: false, missingDependencies: ['dep@m'] })] }
  const blocked = setAgentPluginEnabled(missingDep, 'p@m', true)
  assert.equal(blocked.applied, false)
  assert.equal(blocked.reason, 'dependency-missing')
  assert.equal(blocked.settings.entries[0].enabled, false, '拒绝时不改列表')

  const unmaterialized = { ...defaultAgentPluginRegistry(), entries: [entry({ id: 'p@m', name: 'P', enabled: false, packageStatus: 'missing' })] }
  assert.equal(setAgentPluginEnabled(unmaterialized, 'p@m', true).reason, 'not-materialized')

  const same = { ...defaultAgentPluginRegistry(), entries: [entry({ id: 'p@m', name: 'P', enabled: true })] }
  assert.equal(setAgentPluginEnabled(same, 'p@m', true).reason, 'unchanged')

  const unknown = setAgentPluginEnabled(same, 'ghost@m', true)
  assert.equal(unknown.reason, 'unknown-plugin')
  assert.equal(unknown.applied, false)
  assert.equal(unknown.message, '无法更新 ghost@m，请重试。')
  // 阳性对照：同一份列表里把依赖补上就能启用
  const satisfied = { ...missingDep, entries: [{ ...missingDep.entries[0], missingDependencies: [] }] }
  assert.equal(setAgentPluginEnabled(satisfied, 'p@m', true).applied, true)
})

test('恢复 User 默认：清 workspace 覆盖，只在 workspace + workspace 来源时可用', () => {
  const base = {
    ...defaultAgentPluginRegistry(),
    entries: [entry({ id: 'p@m', name: 'P', enabledSource: 'workspace', optionSources: { level: 'workspace', token: 'user' }, configuredOptions: { level: 3 } })],
  }
  assert.equal(canResetAgentPluginWorkspaceOverride(base.entries[0], 'workspace'), true)
  assert.equal(canResetAgentPluginWorkspaceOverride(base.entries[0], 'user'), false)
  const reset = resetAgentPluginWorkspaceOverride(base, 'p@m')
  assert.equal(reset.applied, true)
  assert.equal(reset.message, '已将 P 恢复为 User 默认')
  assert.equal(reset.settings.entries[0].enabledSource, undefined)
  assert.deepEqual(reset.settings.entries[0].optionSources, { token: 'user' }, '只清 workspace 那一格')
  // 再清一次：没有覆盖了，判 unchanged
  assert.equal(resetAgentPluginWorkspaceOverride(reset.settings, 'p@m').reason, 'unchanged')
})

test('卸载确认：request / cancel / confirm / 进行中判定 / 文案', () => {
  const initial = defaultAgentPluginUninstallState()
  const pending = requestAgentPluginUninstall(initial, 'p@m')
  assert.equal(pending.pendingPluginId, 'p@m')
  assert.equal(requestAgentPluginUninstall(initial, '   '), initial, '空 id 不改状态')
  assert.equal(cancelAgentPluginUninstall(pending).pendingPluginId, null)

  assert.equal(isAgentPluginUninstalling(pending, 'plugin:uninstall:p@m'), true)
  assert.equal(isAgentPluginUninstalling(pending, 'plugin:uninstall:other@m'), false)
  assert.equal(isAgentPluginUninstalling(pending, null), false)

  const target = agentPluginUninstallTarget(pending, [entry({ id: 'p@m', name: 'P' })])
  assert.equal(target.name, 'P')
  assert.equal(agentPluginUninstallTarget(pending, []), null)

  const confirmed = confirmAgentPluginUninstall(pending, null)
  assert.equal(confirmed.pluginId, 'p@m')
  assert.equal(confirmed.state.pendingPluginId, null)
  assert.equal(confirmAgentPluginUninstall(initial, null).pluginId, null, '没有 pending 时什么都不卸')
  assert.equal(confirmAgentPluginUninstall(pending, 'plugin:uninstall:p@m').blocked, true, '进行中时确认被挡')

  const prompt = agentPluginUninstallPrompt('P')
  assert.equal(prompt.title, '卸载 P？')
  assert.equal(prompt.description, '将删除该插件的缓存文件、数据目录以及已保存的配置。此操作无法撤销。')
  assert.equal(prompt.confirm, '卸载')
  assert.equal(prompt.cancel, '取消')

  assert.equal(canRequestAgentPluginUninstall(entry()), true)
  assert.equal(canRequestAgentPluginUninstall(entry({ packageStatus: 'missing' })), false)
  assert.equal(canRequestAgentPluginUninstall(entry(), { installed: false }), false)
})

test('卸载成功后条目被摘掉，内置名单同步清理', () => {
  const base = { ...defaultAgentPluginRegistry(), entries: [entry({ id: 'p@m' }), entry({ id: 'q@m' })], builtInPluginIds: ['p@m', 'q@m'] }
  const next = removeAgentPluginEntry(base, 'p@m')
  assert.deepEqual(next.entries.map((item) => item.id), ['q@m'])
  assert.deepEqual(next.builtInPluginIds, ['q@m'])
})

test('操作 id 与忙碌判定逐条对齐 ZCode 构造', () => {
  assert.equal(pluginOperationId('install', 'sample', 'my-market'), 'plugin:install:sample@my-market')
  assert.equal(pluginOperationId('restore', 'p@m'), 'plugin:restore:p@m')
  assert.equal(pluginOperationId('uninstall', 'p@m'), 'plugin:uninstall:p@m')
  assert.equal(pluginOperationId('update', 'p@m'), 'plugin:update:p@m')
  assert.equal(pluginOperationId('resetConfig', 'p@m'), 'plugin:reset-config:p@m')
  assert.equal(pluginOperationId('configure', 'p@m'), 'plugin:configure:p@m')
  assert.equal(pluginOperationId('marketplaceAdd', 'src'), 'marketplace:add:src')
  assert.equal(pluginOperationId('marketplaceUpdate', ''), 'marketplace:update:__all__')
  assert.equal(pluginOperationId('marketplaceUpdate', 'm1'), 'marketplace:update:m1')
  assert.equal(pluginOperationId('marketplaceRemove', 'm1'), 'marketplace:remove:m1')
  assert.equal(pluginOperationId('marketplaceValidate', 'src'), 'marketplace:validate:src')

  const item = { id: 'p@m', name: 'p', marketplace: 'm' }
  assert.equal(isAgentPluginItemBusy(item, 'plugin:uninstall:p@m'), true)
  assert.equal(isAgentPluginItemBusy(item, 'plugin:install:p@m'), true)
  assert.equal(isAgentPluginItemBusy(item, 'plugin:install:p@other'), false)
  assert.equal(isAgentPluginItemBusy(item, null, 'p@m'), true)
  assert.equal(isAgentPluginItemBusy(item, null, 'q@m'), false)
  assert.equal(isAgentPluginItemBusy(item, 'plugin:update:q@m'), false)

  assert.equal(agentPluginMenuHasActionsBeforeUninstall({ canToggleEnabled: true, updatePending: false, hasResetConfig: false }), true)
  assert.equal(agentPluginMenuHasActionsBeforeUninstall({ canToggleEnabled: false, updatePending: false, hasResetConfig: false }), false)
})

test('市场来源：排序 / 官方不可移除 / 增删 / 行文案 / 输入归一', () => {
  assert.equal(isAgentPluginPublicMarketplace('zcode-plugins-official'), true)
  assert.equal(isAgentPluginMarketplaceRemovable('zcode-plugins-official'), false)
  assert.equal(isAgentPluginMarketplaceRemovable('my-market'), true)

  const sorted = sortAgentPluginMarketplaceSources([
    marketplace({ id: 'old', name: 'old', lastUpdated: '2026-01-01T00:00:00Z' }),
    marketplace({ id: 'zcode-plugins-official', name: 'official', lastUpdated: undefined }),
    marketplace({ id: 'new', name: 'new', lastUpdated: '2026-05-01T00:00:00Z' }),
  ])
  assert.deepEqual(sorted.map((market) => market.id), ['zcode-plugins-official', 'new', 'old'], '官方置顶，其余按刷新时间倒序')

  const base = { ...defaultAgentPluginRegistry(), marketplaces: [marketplace({ id: 'zcode-plugins-official', name: 'official' })] }
  const added = addAgentPluginMarketplaceSource(base, '  https://github.com/acme/plugins  ')
  assert.equal(added.added, true)
  assert.equal(added.operationId, 'marketplace:add:https://github.com/acme/plugins')
  assert.equal(added.settings.marketplaces.length, 2)
  assert.equal(addAgentPluginMarketplaceSource(added.settings, 'https://github.com/acme/plugins').added, false, '同来源不重复登记')
  assert.equal(addAgentPluginMarketplaceSource(base, '   ').added, false)
  assert.equal(normalizeAgentPluginMarketplaceSourceInput('  x  '), 'x')
  assert.equal(normalizeAgentPluginMarketplaceSourceInput('  '), null)

  const removed = removeAgentPluginMarketplaceSource(added.settings, 'https://github.com/acme/plugins')
  assert.equal(removed.removed, true)
  assert.equal(removed.settings.marketplaces.length, 1)
  const refused = removeAgentPluginMarketplaceSource(base, 'zcode-plugins-official')
  assert.equal(refused.removed, false)
  assert.equal(refused.settings.marketplaces.length, 1, '官方源拒绝移除')

  assert.equal(agentPluginMarketplaceUpdateOperationId(null), 'marketplace:update:__all__')
  assert.equal(agentPluginMarketplaceUpdateOperationId('m1'), 'marketplace:update:m1')

  const row = agentPluginMarketplaceRow(
    marketplace({ id: 'm1', name: '市场一', pluginCount: 7, lastUpdated: '2026-05-01T00:00:00Z' }),
    [marketplace({ id: 'm1', name: '市场一' })],
  )
  assert.equal(row.name, '市场一')
  assert.equal(row.pluginCountLabel, '7 个插件')
  assert.match(row.lastUpdatedLabel, /^更新于 /)
  assert.equal(row.removable, true)
  assert.equal(row.updateLabel, '刷新该市场')
  assert.equal(row.removeLabel, '移除该市场')

  const failed = agentPluginMarketplaceRow(marketplace({ id: 'm2', name: 'm2', refreshFailure: { code: 'E', failedAt: 'not-a-date', message: 'boom' } }))
  assert.equal(failed.refreshFailureLabel, '刷新失败于 not-a-date: boom', '非法时间原样返回（PluginStoreSourcesDialog.tsx:155）')
  assert.equal(formatPluginSourceTime('2026-05-01T00:00:00Z').length > 0, true)
})

test('作用域菜单：断连过滤 / 去重 / 失效回退提示', () => {
  assert.equal(agentPluginWorkspaceKey({ workspacePath: 'C:/a', workspaceIdentity: ' id-1 ' }), 'id-1')
  assert.equal(agentPluginWorkspaceKey({ workspacePath: 'C:/a' }), 'C:/a')
  assert.equal(isAgentPluginScopeWorkspaceConnected({ workspacePath: 'C:/a' }), true)
  assert.equal(isAgentPluginScopeWorkspaceConnected({ workspacePath: 'C:/a', availability: 'unavailable-local-directory' }), false)
  assert.equal(isAgentPluginScopeWorkspaceConnected({ workspacePath: 'C:/a', workspaceIdentity: 'id' }), false, '远端没有 session = 不可用')
  assert.equal(isAgentPluginScopeWorkspaceConnected({ workspacePath: 'C:/a', workspaceIdentity: 'id', remoteSessionId: 's1' }), true)

  const options = selectAgentPluginScopeOptions([
    { workspacePath: 'C:/a', label: 'A' },
    { workspacePath: 'C:/a', label: 'A dup' },
    { workspacePath: 'C:/b', label: 'B', workspaceIdentity: 'id-b', remoteSessionId: 's-b' },
    { workspacePath: 'C:/c', label: 'C', workspaceIdentity: 'id-c' },
    { workspacePath: 'C:/d', label: 'D', availability: 'unavailable-local-directory' },
  ])
  assert.deepEqual(options.map((option) => option.key), ['C:/a', 'id-b'], '去重 + 断连（无 session 的远端 / 失效本地）都被滤掉')
  assert.equal(options[0].remote, false)
  assert.equal(options[1].remote, true)

  assert.deepEqual(resolveAgentPluginScopeSelection('user', options), { key: 'user', scope: 'user', fallbackMessage: '' })
  assert.deepEqual(resolveAgentPluginScopeSelection('C:/a', options), { key: 'C:/a', scope: 'workspace', fallbackMessage: '' })
  const fallback = resolveAgentPluginScopeSelection('C:/gone', options)
  assert.equal(fallback.key, 'user')
  assert.equal(fallback.scope, 'user')
  assert.equal(fallback.fallbackMessage, '目标工作区已关闭或断开，已回退到用户插件配置。')
  assert.equal(agentPluginConfigScope('user'), 'user')
  assert.equal(agentPluginConfigScope('workspace'), 'workspace')
})

test('hook 明细辅助：命令行 / matcher / 可运行 / shell', () => {
  const hook = { event: 'PreToolUse', type: 'command', command: 'node', args: ['hook.js', '--x'], sourcePath: 'C:/p/hooks.json', runnable: true }
  assert.equal(agentPluginHookCommand(hook), 'node hook.js --x')
  assert.equal(agentPluginHookCommand({ ...hook, args: undefined }), 'node')
  assert.equal(agentPluginHookMatcher(hook), '默认 matcher')
  assert.equal(agentPluginHookMatcher({ ...hook, matcher: 'Edit' }), 'Edit')
  assert.equal(agentPluginHookRunnableLabel(hook), '可运行')
  assert.equal(agentPluginHookRunnableLabel({ ...hook, runnable: false }), '仅诊断展示')
  assert.equal(agentPluginHookShell({ ...hook, shell: true }), 'true')
  assert.equal(agentPluginHookShell({ ...hook, shell: 'bash' }), 'bash')
  assert.equal(agentPluginHookShell(hook), '')
})

test('启停可用性投影与组件分组守卫', () => {
  assert.deepEqual(agentPluginEnablement(entry()), { canEnable: true, reason: '' })
  const blocked = agentPluginEnablement(entry({ dependencyCycle: ['a', 'b'] }))
  assert.equal(blocked.canEnable, false)
  assert.match(blocked.reason, /依赖没满足/)
  assert.equal(isAgentPluginComponentGroup({ kind: 'skill', items: [] }), true)
  assert.equal(isAgentPluginComponentGroup({ kind: 'bogus', items: [] }), false)
  assert.equal(isAgentPluginComponentGroup({ kind: 'skill' }), false)
  assert.equal(isAgentPluginComponentGroup(null), false)
})