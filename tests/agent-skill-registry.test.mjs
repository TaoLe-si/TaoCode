// `agent/skills + agent/commands` 判据：技能注册表与用户命令注册表的形状、逐字段救、
// 校验、增删改、启用停用、作用域、搜索过滤、持久化。
//
// 判据锚点（逐条指到 ZCode 源码）：
//   · `packages/shared/src/skills-types.ts:10-29`   —— SkillSummary / SkillScope / SkillMetadata
//   · `packages/shared/src/command-types.ts:7-55`   —— CommandInfo / UserCommand / PluginCommand / CommandConfig
//   · `packages/shared/src/settings-source.ts:1-10` —— SettingsDirectoryLocation
//   · `SkillsSection.tsx:73-82 / :365-404 / :408-454 / :613-618 / :621-641` —— 发布时间、开关、删除、回落
//   · `CommandForm.tsx:12-14 / :82-129 / :136-141 / :168` —— 命令校验与提交折形
//   · `CommandCard.tsx:10-12`                       —— isEditableUserCommand
//   · `CommandsSection.tsx:158-218 / :220-270`      —— 保存 / 删除 / 开关
//   · `commandWorkspaceScope.ts:7-42`               —— 作用域三函数
//   · `pluginCapabilityProjection.ts:96-99 / :121-131` —— 作用域投影
//   · `pluginManagedResourceGroups.ts:143-149 / :164 / :186` —— 搜索匹配
//   · `i18n/locales/zh-CN.ts:3481 / :3588-3592 / :3974-3976` —— 回落与校验文案
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_COMMAND_REGISTRY_STORAGE_KEY,
  AGENT_SKILL_REGISTRY_STORAGE_KEY,
  COMMAND_MAX_NAME_LENGTH,
  COMMAND_MIN_NAME_LENGTH,
  COMMAND_NAME_REGEX,
  addUserCommandEntry,
  commandConfigToContent,
  commandMatchesScope,
  commandWorkspaceKey,
  createSkillRegistryEntry,
  defaultCommandRegistrySettings,
  defaultSkillRegistrySettings,
  filterCommandRegistry,
  filterSkillRegistry,
  isEditableUserCommand,
  isPluginCommandEntry,
  isUserCommandEntry,
  loadCommandRegistrySettings,
  loadSkillRegistrySettings,
  normalizeCommandRegistrySettings,
  normalizeSkillRegistrySettings,
  removeCommandEntry,
  removeSkillRegistryEntry,
  resolveCommandScopeRecovery,
  resolveCommandStorageTarget,
  saveCommandRegistrySettings,
  saveSkillRegistrySettings,
  selectCommandsForRegistryScope,
  selectSkillsForRegistryScope,
  setCommandEntryEnabled,
  setSkillRegistryEnabled,
  shouldRefreshCurrentCommandList,
  skillEnabledLabel,
  skillEntryCapabilities,
  skillMatchesScope,
  updateUserCommandEntry,
  upsertSkillRegistryEntry,
  validateCommandConfig,
  validateSkillRegistrySettings,
} from '../src/agentSkillRegistry.ts'
import { createMemoryStorage, createThrowingStorage } from '../src/agentSettingsStore.ts'

/** 造一条能过校验的技能；只在要改某个字段时覆盖它。 */
function skill(overrides = {}) {
  return {
    id: 's-1',
    name: 'my-skill',
    description: '一个技能',
    body: '# my-skill',
    path: 'C:\\Users\\Administrator\\.taocode\\skills\\my-skill',
    scope: 'user',
    enabled: true,
    ...overrides,
  }
}

/** 造一条可编辑的用户命令。 */
function userCommand(overrides = {}) {
  return {
    id: 'c-1',
    name: 'my-command',
    prompt: '做点事',
    content: '做点事',
    description: '',
    argumentHint: '',
    filePath: 'C:\\Users\\Administrator\\.taocode\\commands\\my-command.md',
    source: 'user',
    agentSource: 'zcodeAgent',
    location: { source: 'zcode', scope: 'user', directoryPath: 'C:\\Users\\Administrator\\.taocode\\commands' },
    enabled: true,
    scope: 'global',
    ...overrides,
  }
}

// ---------------------------------------------------------------- 技能：归一化

test('技能：空输入退回空清单（本仓没有技能扫描通道，不假造条目）', () => {
  assert.deepEqual(normalizeSkillRegistrySettings(null), { entries: [] })
  assert.deepEqual(normalizeSkillRegistrySettings(undefined), { entries: [] })
  assert.deepEqual(normalizeSkillRegistrySettings(42), { entries: [] })
  assert.deepEqual(defaultSkillRegistrySettings(), { entries: [] })
})

test('技能：entries 键缺失 / 非数组退回默认；空数组被尊重', () => {
  assert.deepEqual(normalizeSkillRegistrySettings({}), { entries: [] })
  assert.deepEqual(normalizeSkillRegistrySettings({ entries: 'nope' }), { entries: [] })
  assert.deepEqual(normalizeSkillRegistrySettings({ entries: [] }), { entries: [] })
})

test('技能：逐条救 —— 非对象条目只丢自己，其余各救各的', () => {
  const result = normalizeSkillRegistrySettings({
    entries: [null, 'garbage', 7, { name: 'ok', path: '/p/ok' }],
  })
  assert.equal(result.entries.length, 1)
  assert.equal(result.entries[0].name, 'ok')
})

test('技能：缺 id 用 path 兜底，缺 path 用生成 id；缺 name 用 id 兜底', () => {
  const a = normalizeSkillRegistrySettings({ entries: [{ path: '/p/a' }] }).entries[0]
  assert.equal(a.id, '/p/a')
  assert.equal(a.name, '/p/a')
  const b = normalizeSkillRegistrySettings({ entries: [{}] }).entries[0]
  assert.equal(b.id, 'skill-1')
  assert.equal(b.name, 'skill-1')
})

test('技能：缺 enabled 视为启用；缺 scope 视为 user；sourcePath 回落 path', () => {
  const entry = normalizeSkillRegistrySettings({ entries: [{ path: '/p/a', name: 'a' }] }).entries[0]
  assert.equal(entry.enabled, true)
  assert.equal(entry.scope, 'user')
  assert.equal(entry.sourcePath, '/p/a')
})

test('技能：非法 scope 退回 user；显式 false 的 enabled 被保留', () => {
  const entry = normalizeSkillRegistrySettings({
    entries: [{ name: 'a', path: '/p/a', scope: 'nope', enabled: false }],
  }).entries[0]
  assert.equal(entry.scope, 'user')
  assert.equal(entry.enabled, false)
})

test('技能：描述空就是空（回落文案是渲染时的事，不写回数据）', () => {
  const entry = normalizeSkillRegistrySettings({ entries: [{ name: 'a', path: '/p/a' }] }).entries[0]
  assert.equal(entry.description, '')
})

test('技能：metadata 只认四个键自己的类型，publishedAt 非法即丢', () => {
  const entry = normalizeSkillRegistrySettings({
    entries: [{
      name: 'a',
      path: '/p/a',
      metadata: { slug: 'sg', version: '1.0.0', ownerId: 'o-1', publishedAt: 1700000000000, extra: 'x' },
    }],
  }).entries[0]
  assert.deepEqual(entry.metadata, { slug: 'sg', version: '1.0.0', ownerId: 'o-1', publishedAt: 1700000000000 })

  const bad = normalizeSkillRegistrySettings({
    entries: [{ name: 'a', path: '/p/a', metadata: { publishedAt: 'not-a-date' } }],
  }).entries[0]
  assert.deepEqual(bad.metadata, {})
})

test('技能：publishedAt 接受 ISO 串（照 SkillsSection.tsx:73-82 的口径）', () => {
  const entry = normalizeSkillRegistrySettings({
    entries: [{ name: 'a', path: '/p/a', metadata: { publishedAt: '2026-03-20T07:12:40.768Z' } }],
  }).entries[0]
  assert.equal(entry.metadata.publishedAt, Date.parse('2026-03-20T07:12:40.768Z'))
})

// ---------------------------------------------------------------- 技能：校验

test('技能校验：空名 / 重名 / 空路径都拦下；合法清单零问题', () => {
  assert.deepEqual(validateSkillRegistrySettings({ entries: [skill()] }), [])

  const problems = validateSkillRegistrySettings({
    entries: [
      skill({ id: 's-1', name: '' }),
      skill({ id: 's-2', name: 'dup' }),
      skill({ id: 's-3', name: 'dup' }),
      skill({ id: 's-4', name: 'no-path', path: '' }),
    ],
  })
  assert.equal(problems.length, 3)
  assert.ok(problems.some((p) => p.includes('技能名不能为空')))
  assert.ok(problems.some((p) => p.includes('「dup」重复')))
  assert.ok(problems.some((p) => p.includes('必须填目录路径')))
})

test('技能校验：坏输入不抛（entries 非数组当空）', () => {
  assert.deepEqual(validateSkillRegistrySettings(undefined), [])
  assert.deepEqual(validateSkillRegistrySettings({ entries: 'nope' }), [])
})

// ---------------------------------------------------------------- 技能：增删改 / 开关

test('技能：upsert 按 id 覆盖、不新增重复、不改原数组', () => {
  const before = { entries: [skill({ id: 's-1', name: 'a' })] }
  const after = upsertSkillRegistryEntry(before, skill({ id: 's-1', name: 'b' }))
  assert.equal(after.entries.length, 1)
  assert.equal(after.entries[0].name, 'b')
  assert.equal(before.entries[0].name, 'a')

  const added = upsertSkillRegistryEntry(after, skill({ id: 's-2', name: 'c' }))
  assert.equal(added.entries.length, 2)
})

test('技能：删除对普通档生效、对 plugin 档无效（SkillsSection.tsx:410）', () => {
  const settings = { entries: [skill({ id: 's-1' }), skill({ id: 'p-1', scope: 'plugin' })] }
  const after = removeSkillRegistryEntry(settings, 's-1')
  assert.deepEqual(after.entries.map((e) => e.id), ['p-1'])
  const pluginStill = removeSkillRegistryEntry(settings, 'p-1')
  assert.deepEqual(pluginStill.entries.map((e) => e.id), ['s-1', 'p-1'])
})

test('技能：启用停用只对非 plugin 生效，未知 id 是空操作', () => {
  const settings = { entries: [skill({ id: 's-1' }), skill({ id: 'p-1', scope: 'plugin' })] }
  const off = setSkillRegistryEnabled(settings, 's-1', false)
  assert.equal(off.entries[0].enabled, false)
  const pluginOff = setSkillRegistryEnabled(settings, 'p-1', false)
  assert.equal(pluginOff.entries[1].enabled, true)
  const unknown = setSkillRegistryEnabled(settings, 'nope', false)
  assert.equal(unknown.entries[0].enabled, true)
})

test('技能：能力判定 —— plugin 档既不可拨也不可删（SkillsSection.tsx:621-641）', () => {
  assert.deepEqual(skillEntryCapabilities(skill({ scope: 'user' })), { toggleable: true, deletable: true })
  assert.deepEqual(skillEntryCapabilities(skill({ scope: 'workspace' })), { toggleable: true, deletable: true })
  assert.deepEqual(skillEntryCapabilities(skill({ scope: 'plugin' })), { toggleable: false, deletable: false })
})

test('技能：createSkillRegistryEntry 折出合法形状（缺省 name 用 id 兜底）', () => {
  const entry = createSkillRegistryEntry({ id: 's-new', path: '/p/new' })
  assert.equal(entry.id, 's-new')
  assert.equal(entry.scope, 'user')
  assert.equal(entry.enabled, true)
  assert.equal(entry.sourcePath, '/p/new')
})

// ---------------------------------------------------------------- 技能：作用域 / 搜索

test('技能：作用域投影 —— plugin 档不归入任一节（无插件运行时）', () => {
  const entry = skill({ scope: 'user' })
  assert.equal(skillMatchesScope(entry, 'user'), true)
  assert.equal(skillMatchesScope(entry, 'workspace'), false)
  assert.equal(skillMatchesScope(skill({ scope: 'plugin' }), 'user'), false)
  assert.equal(skillMatchesScope(skill({ scope: 'plugin' }), 'workspace'), false)
  assert.equal(skillMatchesScope(null, 'user'), false)

  const settings = {
    entries: [skill({ id: 'u', scope: 'user' }), skill({ id: 'w', scope: 'workspace' }), skill({ id: 'p', scope: 'plugin' })],
  }
  assert.deepEqual(selectSkillsForRegistryScope(settings, 'user').map((e) => e.id), ['u'])
  assert.deepEqual(selectSkillsForRegistryScope(settings, 'workspace').map((e) => e.id), ['w'])
})

test('技能：搜索空查询返回全部，命中 name / description / pluginName（pluginManagedResourceGroups.ts:164）', () => {
  const entries = [
    skill({ id: '1', name: 'Alpha', description: 'x', pluginName: '' }),
    skill({ id: '2', name: 'beta', description: 'GAMMA', pluginName: '' }),
    skill({ id: '3', name: 'delta', description: '', pluginName: 'MyPlugin' }),
  ]
  assert.equal(filterSkillRegistry(entries, '').length, 3)
  assert.equal(filterSkillRegistry(entries, '   ').length, 3)
  assert.deepEqual(filterSkillRegistry(entries, 'alpha').map((e) => e.id), ['1'])
  assert.deepEqual(filterSkillRegistry(entries, 'gamma').map((e) => e.id), ['2'])
  assert.deepEqual(filterSkillRegistry(entries, 'myplugin').map((e) => e.id), ['3'])
  assert.deepEqual(filterSkillRegistry(entries, 'zzz'), [])
})

test('技能：作用域标签与状态文案取 zh-CN 原文', () => {
  assert.equal(skillEnabledLabel(true), '已启用')
  assert.equal(skillEnabledLabel(false), '已停用')
})

// ---------------------------------------------------------------- 技能：持久化

test('技能：保存 / 读取往返；读回来是归一化后的形状', () => {
  const storage = createMemoryStorage()
  const settings = { entries: [skill({ id: 's-1', name: 'a' })] }
  assert.equal(saveSkillRegistrySettings(settings, storage), true)
  const loaded = loadSkillRegistrySettings(storage)
  assert.equal(loaded.entries.length, 1)
  assert.equal(loaded.entries[0].id, 's-1')
  assert.equal(loaded.entries[0].body, '# my-skill')
})

test('技能：坏 JSON / 存储抛异常都退回默认，永不抛', () => {
  assert.deepEqual(loadSkillRegistrySettings(createMemoryStorage({ [AGENT_SKILL_REGISTRY_STORAGE_KEY]: '{oops' })), { entries: [] })
  assert.deepEqual(loadSkillRegistrySettings(createThrowingStorage()), { entries: [] })
  assert.equal(saveSkillRegistrySettings({ entries: [] }, createThrowingStorage()), false)
  assert.equal(saveSkillRegistrySettings({ entries: [] }, null), false)
})

// ---------------------------------------------------------------- 命令：常量与校验

test('命令：名字规则常量逐字照 CommandForm.tsx:12-14', () => {
  assert.equal(COMMAND_NAME_REGEX.source, '^[a-zA-Z0-9_-]+$')
  assert.equal(COMMAND_MIN_NAME_LENGTH, 1)
  assert.equal(COMMAND_MAX_NAME_LENGTH, 50)
})

test('命令校验：合法配置通过', () => {
  const result = validateCommandConfig({ name: 'my-cmd', prompt: '干活' })
  assert.equal(result.ok, true)
  assert.equal(result.nameError, null)
  assert.equal(result.promptError, null)
})

test('命令校验：名字超长 / 空名报长度错，文案取 zh-CN.ts:3974', () => {
  const tooLong = validateCommandConfig({ name: 'a'.repeat(51), prompt: 'p' })
  assert.equal(tooLong.ok, false)
  assert.equal(tooLong.nameError, '长度必须在 1 到 50 个字符之间')

  const empty = validateCommandConfig({ name: '   ', prompt: 'p' })
  assert.equal(empty.ok, false)
  assert.equal(empty.nameError, '长度必须在 1 到 50 个字符之间')
})

test('命令校验：非法字符报字符错，文案取 zh-CN.ts:3975', () => {
  const result = validateCommandConfig({ name: 'bad name!', prompt: 'p' })
  assert.equal(result.ok, false)
  assert.equal(result.nameError, '仅允许使用字母、数字、连字符和下划线')
})

test('命令校验：提示词空报错，文案取 zh-CN.ts:3976', () => {
  const result = validateCommandConfig({ name: 'ok', prompt: '   ' })
  assert.equal(result.ok, false)
  assert.equal(result.promptError, '提示词不能为空')
})

test('命令校验：编辑态跳过名称校验（CommandForm.tsx:95-96 的 initial 分支）', () => {
  const result = validateCommandConfig({ name: '', prompt: 'p' }, true)
  assert.equal(result.nameError, null)
  assert.equal(result.ok, true)
})

// ---------------------------------------------------------------- 命令：归一化

test('命令：空输入退回空清单；commands 键非数组同理', () => {
  assert.deepEqual(normalizeCommandRegistrySettings(null), { commands: [] })
  assert.deepEqual(normalizeCommandRegistrySettings({ commands: 'x' }), { commands: [] })
  assert.deepEqual(defaultCommandRegistrySettings(), { commands: [] })
})

test('命令：用户命令归一化 —— 缺省 source/agentSource/enabled/scope 各按其默认', () => {
  const entry = normalizeCommandRegistrySettings({ commands: [{ name: 'a', prompt: 'p' }] }).commands[0]
  assert.equal(entry.source, 'user')
  assert.equal(entry.agentSource, 'zcodeAgent')
  assert.equal(entry.enabled, true)
  assert.equal(entry.scope, 'global')
  assert.equal(entry.location.source, 'zcode')
  assert.equal(entry.location.scope, 'user')
  assert.equal(entry.content, 'p')
  assert.equal(isUserCommandEntry(entry), true)
  assert.equal(isPluginCommandEntry(entry), false)
})

test('命令：插件命令归一化 —— scope 恒 global，带插件三字段', () => {
  const entry = normalizeCommandRegistrySettings({
    commands: [{ id: 'pc-1', name: 'plug', prompt: 'p', source: 'plugin', pluginName: 'P', pluginMarketplace: 'M' }],
  }).commands[0]
  assert.equal(entry.source, 'plugin')
  assert.equal(entry.scope, 'global')
  assert.equal(entry.pluginName, 'P')
  assert.equal(entry.pluginMarketplace, 'M')
  assert.equal(entry.pluginEnabled, true)
  assert.equal(isPluginCommandEntry(entry), true)
  assert.equal(isUserCommandEntry(entry), false)
})

test('命令：逐条救 —— 垃圾条目只丢自己', () => {
  const result = normalizeCommandRegistrySettings({ commands: [null, 'x', { name: 'ok', prompt: 'p' }] })
  assert.equal(result.commands.length, 1)
  assert.equal(result.commands[0].name, 'ok')
})

test('命令：可编辑判定照 CommandCard.tsx:10-12 —— 只有 user + zcode 来源可编辑', () => {
  assert.equal(isEditableUserCommand(userCommand()), true)
  assert.equal(isEditableUserCommand(userCommand({ location: { source: 'claude', scope: 'user', directoryPath: '/c' } })), false)
  assert.equal(isEditableUserCommand(userCommand({ source: 'plugin', scope: 'global', pluginName: 'P', pluginMarketplace: 'M', pluginEnabled: true })), false)
})

test('命令：CommandConfig 折成 content（照 CommandForm.tsx:136-141，字段各自 trim）', () => {
  const content = commandConfigToContent({ name: ' n ', prompt: ' p ', description: ' d ', argumentHint: ' h ' })
  assert.deepEqual(content, { name: 'n', prompt: 'p', content: 'p', description: 'd', argumentHint: 'h', filePath: '' })
})

// ---------------------------------------------------------------- 命令：增删改 / 开关

test('命令：新增到 user 层 → scope global / location user', () => {
  const result = addUserCommandEntry(defaultCommandRegistrySettings(), { name: 'new-cmd', prompt: 'p' }, 'user')
  assert.ok(result)
  assert.equal(result.entry.scope, 'global')
  assert.equal(result.entry.location.scope, 'user')
  assert.equal(result.settings.commands.length, 1)
})

test('命令：新增到 project 层 → scope project 且带 projectPath', () => {
  const result = addUserCommandEntry(defaultCommandRegistrySettings(), { name: 'new-cmd', prompt: 'p' }, 'project', 'D:\\proj')
  assert.ok(result)
  assert.equal(result.entry.scope, 'project')
  assert.equal(result.entry.location.scope, 'project')
  assert.equal(result.entry.projectPath, 'D:\\proj')
  assert.equal(result.entry.location.projectPath, 'D:\\proj')
})

test('命令：同名同层是冲突，返回 null（CommandsSection.tsx:196-202 的 fileExists）', () => {
  const first = addUserCommandEntry(defaultCommandRegistrySettings(), { name: 'dup', prompt: 'p' }, 'user')
  assert.ok(first)
  const second = addUserCommandEntry(first.settings, { name: 'dup', prompt: 'p' }, 'user')
  assert.equal(second, null)
  // 不同层不算冲突
  const third = addUserCommandEntry(first.settings, { name: 'dup', prompt: 'p' }, 'project', 'D:\\proj')
  assert.ok(third)
})

test('命令：空名不新增', () => {
  assert.equal(addUserCommandEntry(defaultCommandRegistrySettings(), { name: '  ', prompt: 'p' }, 'user'), null)
})

test('命令：更新只改 prompt / description / argumentHint，名称不变（CommandForm.tsx:168 disabled）', () => {
  const settings = { commands: [userCommand({ id: 'c-1', name: 'fixed' })] }
  const after = updateUserCommandEntry(settings, 'c-1', { name: 'changed', prompt: 'new-p', description: 'nd', argumentHint: 'na' })
  const entry = after.commands[0]
  assert.equal(entry.name, 'fixed')
  assert.equal(entry.prompt, 'new-p')
  assert.equal(entry.content, 'new-p')
  assert.equal(entry.description, 'nd')
  assert.equal(entry.argumentHint, 'na')
})

test('命令：更新对不可编辑条目无效（plugin / 外部来源）', () => {
  const plugin = userCommand({ id: 'c-2', source: 'plugin', scope: 'global', pluginName: 'P', pluginMarketplace: 'M', pluginEnabled: true })
  const settings = { commands: [plugin] }
  const after = updateUserCommandEntry(settings, 'c-2', { name: 'x', prompt: 'y' })
  assert.equal(after.commands[0].prompt, '做点事')
})

test('命令：删除只对可编辑用户命令生效（CommandsSection.tsx:222-224）', () => {
  const settings = {
    commands: [
      userCommand({ id: 'c-1' }),
      userCommand({ id: 'c-2', location: { source: 'claude', scope: 'user', directoryPath: '/c' } }),
    ],
  }
  assert.deepEqual(removeCommandEntry(settings, 'c-1').commands.map((c) => c.id), ['c-2'])
  assert.deepEqual(removeCommandEntry(settings, 'c-2').commands.map((c) => c.id), ['c-1', 'c-2'])
})

test('命令：启用停用只对 user 命令生效（CommandsSection.tsx:254-256）', () => {
  const settings = {
    commands: [
      userCommand({ id: 'c-1' }),
      userCommand({ id: 'c-2', source: 'plugin', scope: 'global', pluginName: 'P', pluginMarketplace: 'M', pluginEnabled: true }),
    ],
  }
  const after = setCommandEntryEnabled(settings, 'c-1', false)
  assert.equal(after.commands[0].enabled, false)
  const pluginAfter = setCommandEntryEnabled(settings, 'c-2', false)
  assert.equal(pluginAfter.commands[1].enabled, true)
})

// ---------------------------------------------------------------- 命令：作用域

test('命令：workspace key = identity 优先，否则 path（workspaceKey.ts:5-7）', () => {
  assert.equal(commandWorkspaceKey({ workspacePath: 'D:\\p', workspaceIdentity: ' id-1 ' }), 'id-1')
  assert.equal(commandWorkspaceKey({ workspacePath: 'D:\\p' }), 'D:\\p')
  assert.equal(commandWorkspaceKey({ workspacePath: 'D:\\p', workspaceIdentity: '   ' }), 'D:\\p')
})

test('命令：scope 恢复 —— user / 命中页签 keep，编辑态 close-editor，新建态 fallback-user', () => {
  const tabs = [{ workspacePath: 'D:\\a' }, { workspacePath: 'D:\\b', workspaceIdentity: 'id-b' }]
  assert.equal(resolveCommandScopeRecovery({ editing: false, scopeKey: 'user', workspaceTabs: tabs }), 'keep')
  assert.equal(resolveCommandScopeRecovery({ editing: true, scopeKey: 'D:\\a', workspaceTabs: tabs }), 'keep')
  assert.equal(resolveCommandScopeRecovery({ editing: true, scopeKey: 'id-b', workspaceTabs: tabs }), 'keep')
  assert.equal(resolveCommandScopeRecovery({ editing: true, scopeKey: 'D:\\gone', workspaceTabs: tabs }), 'close-editor')
  assert.equal(resolveCommandScopeRecovery({ editing: false, scopeKey: 'D:\\gone', workspaceTabs: tabs }), 'fallback-user')
})

test('命令：存储目标 —— user 层不带 workspace，其余落到同 key 页签', () => {
  const tabs = [{ workspacePath: 'D:\\a' }, { workspacePath: 'D:\\b', workspaceIdentity: 'id-b' }]
  assert.deepEqual(resolveCommandStorageTarget('user', tabs), { storageLevel: 'user', workspace: null })
  assert.deepEqual(resolveCommandStorageTarget('D:\\a', tabs), { storageLevel: 'project', workspace: tabs[0] })
  assert.deepEqual(resolveCommandStorageTarget('id-b', tabs), { storageLevel: 'project', workspace: tabs[1] })
  assert.deepEqual(resolveCommandStorageTarget('D:\\gone', tabs), { storageLevel: 'project', workspace: null })
})

test('命令：刷新判定 —— user 层或当前工作区才刷新', () => {
  assert.equal(shouldRefreshCurrentCommandList('user', 'D:\\a'), true)
  assert.equal(shouldRefreshCurrentCommandList('D:\\a', 'D:\\a'), true)
  assert.equal(shouldRefreshCurrentCommandList('D:\\b', 'D:\\a'), false)
})

test('命令：作用域投影照 selectCommandsForScope:121-131 —— 只认 user 命令的 location.scope', () => {
  const settings = {
    commands: [
      userCommand({ id: 'u', location: { source: 'zcode', scope: 'user', directoryPath: '/u' } }),
      userCommand({ id: 'p', location: { source: 'zcode', scope: 'project', directoryPath: '/p' } }),
      userCommand({ id: 'pl', source: 'plugin', scope: 'global', pluginName: 'P', pluginMarketplace: 'M', pluginEnabled: true }),
    ],
  }
  assert.equal(commandMatchesScope(settings.commands[0], 'user'), true)
  assert.equal(commandMatchesScope(settings.commands[0], 'workspace'), false)
  assert.equal(commandMatchesScope(settings.commands[1], 'workspace'), true)
  assert.equal(commandMatchesScope(settings.commands[2], 'user'), false)
  assert.deepEqual(selectCommandsForRegistryScope(settings, 'user').map((c) => c.id), ['u'])
  assert.deepEqual(selectCommandsForRegistryScope(settings, 'workspace').map((c) => c.id), ['p'])
})

test('命令：搜索空查询返回全部，命中 name / description / prompt（pluginManagedResourceGroups.ts:186）', () => {
  const commands = [
    userCommand({ id: '1', name: 'Alpha', description: '', prompt: '' }),
    userCommand({ id: '2', name: 'beta', description: 'GAMMA', prompt: '' }),
    userCommand({ id: '3', name: 'delta', description: '', prompt: 'DO-THIS' }),
  ]
  assert.equal(filterCommandRegistry(commands, '').length, 3)
  assert.deepEqual(filterCommandRegistry(commands, 'alpha').map((c) => c.id), ['1'])
  assert.deepEqual(filterCommandRegistry(commands, 'gamma').map((c) => c.id), ['2'])
  assert.deepEqual(filterCommandRegistry(commands, 'do-this').map((c) => c.id), ['3'])
  assert.deepEqual(filterCommandRegistry(commands, 'zzz'), [])
})

// ---------------------------------------------------------------- 命令：持久化

test('命令：保存 / 读取往返', () => {
  const storage = createMemoryStorage()
  const settings = { commands: [userCommand({ id: 'c-1' })] }
  assert.equal(saveCommandRegistrySettings(settings, storage), true)
  const loaded = loadCommandRegistrySettings(storage)
  assert.equal(loaded.commands.length, 1)
  assert.equal(loaded.commands[0].id, 'c-1')
  assert.equal(loaded.commands[0].prompt, '做点事')
})

test('命令：坏 JSON / 存储抛异常都退回默认，永不抛', () => {
  assert.deepEqual(loadCommandRegistrySettings(createMemoryStorage({ [AGENT_COMMAND_REGISTRY_STORAGE_KEY]: 'not json' })), { commands: [] })
  assert.deepEqual(loadCommandRegistrySettings(createThrowingStorage()), { commands: [] })
  assert.equal(saveCommandRegistrySettings({ commands: [] }, createThrowingStorage()), false)
  assert.equal(saveCommandRegistrySettings({ commands: [] }, null), false)
})

test('两节用各自独立的存储键（技能节与 src/agentSkills.ts 同键，命令节独立）', () => {
  assert.equal(AGENT_SKILL_REGISTRY_STORAGE_KEY, 'taocode.agent.skills')
  assert.equal(AGENT_COMMAND_REGISTRY_STORAGE_KEY, 'taocode.agent.commands')
  assert.notEqual(AGENT_SKILL_REGISTRY_STORAGE_KEY, AGENT_COMMAND_REGISTRY_STORAGE_KEY)
})