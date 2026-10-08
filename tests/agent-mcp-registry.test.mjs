// `agent/mcp-registry` 判据：MCP 服务器注册表的形状归一、逐字段校验、增删改查、启用停用、
// 搜索排序、操作集合与文案。
//
// 判据锚点全部指回 ZCode 权威源码（`.tools/ZCode`，只读参照）：
//   · `mcpSettingsShared.ts:9-22`      —— FormState 字段集合
//   · `McpServerForm.tsx:167-183`      —— canSave 的两条硬判据
//   · `McpServerForm.tsx:277-288`      —— 传输类型只开放 stdio / http / sse
//   · `mcpSettingsShared.ts:73-125`    —— formToConfig 的二选一分支
//   · `mcpSettingsShared.ts:127-132`   —— parseTimeoutMs
//   · `mcpSettingsShared.ts:45-54`     —— serverToForm 的传输反推顺序
//   · `McpServerList.tsx:99-103,162`   —— 行副标题与启用开关
//   · `McpSettingsSection.tsx:1194-1243,1265-1297` —— 排序 / 开关 / 保存 / 删除 handler
//   · `pluginManagedResourceGroups.ts:143-213`     —— 搜索匹配
//   · `i18n/locales/zh-CN.ts:2355-2531`            —— 文案原文
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_MCP_DELETE_CONFIRM_ACTION,
  AGENT_MCP_DELETE_CONFIRM_DESCRIPTION,
  AGENT_MCP_DELETE_CONFIRM_TITLE,
  AGENT_MCP_REGISTRY_ACTIONS,
  AGENT_MCP_REGISTRY_RUNTIME_ACTIONS,
  AGENT_MCP_REGISTRY_STORAGE_KEY,
  AGENT_MCP_TEXT,
  AGENT_MCP_TIMEOUT_MAX_MS,
  AGENT_MCP_TIMEOUT_MIN_MS,
  agentMcpEntryDescription,
  agentMcpProtocolVersionLabel,
  agentMcpTransportLabel,
  createAgentMcpRegistryEntry,
  deleteAgentMcpRegistryEntry,
  emptyAgentMcpRegistry,
  filterAgentMcpRegistry,
  findAgentMcpRegistryEntry,
  loadAgentMcpRegistry,
  normalizeAgentMcpRegistry,
  saveAgentMcpRegistry,
  setAgentMcpRegistryEnabled,
  sortAgentMcpRegistry,
  updateAgentMcpRegistryEntry,
  validateAgentMcpRegistry,
  validateAgentMcpRegistryEntry,
} from '../src/agentMcpRegistry.ts'
import { createMemoryStorage, createThrowingStorage } from '../src/agentSettingsStore.ts'

/** 造一条能过校验的 stdio 条目，测试里只覆盖要改的字段。 */
function stdioEntry(overrides = {}) {
  return {
    name: 'taocode',
    transport: 'stdio',
    scope: 'user',
    enabled: true,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    env: {},
    url: '',
    headers: {},
    timeoutMs: 0,
    oauth: null,
    protocolVersion: '',
    ...overrides,
  }
}

/** 造一条能过校验的 http 条目。 */
function httpEntry(overrides = {}) {
  return stdioEntry({
    name: 'remote',
    transport: 'http',
    command: '',
    args: [],
    url: 'https://mcp.example.com/mcp',
    ...overrides,
  })
}

test('空档是空列表：ZCode 这一节出厂没有预置条目（McpSettingsSection.tsx:1496 的 empty 分支）', () => {
  const registry = emptyAgentMcpRegistry()
  assert.deepEqual(registry, { servers: [] })
  assert.deepEqual(validateAgentMcpRegistry(registry), [], '空档必须零问题')
})

test('归一化永不抛：非对象 / 缺 servers / 垃圾条目各自退默认，不丢整表', () => {
  assert.deepEqual(normalizeAgentMcpRegistry(null), { servers: [] })
  assert.deepEqual(normalizeAgentMcpRegistry('x'), { servers: [] })
  assert.deepEqual(normalizeAgentMcpRegistry({ servers: 'nope' }), { servers: [] })
  // 数组里混了标量：只丢那一条，其余照救（本仓铁律：不许按数量判损坏）。
  const rescued = normalizeAgentMcpRegistry({
    servers: [null, 42, { name: 'a', transport: 'stdio', command: 'npx' }],
  })
  assert.equal(rescued.servers.length, 1)
  assert.equal(rescued.servers[0].name, 'a')
})

test('传输反推照 serverToForm 的顺序：sse → streamableHttp → 有 command → stdio → 否则 http', () => {
  // mcpSettingsShared.ts:45-54
  assert.equal(normalizeAgentMcpRegistry({ servers: [{ name: 'a', type: 'sse', url: 'https://x/sse' }] }).servers[0].transport, 'sse')
  // streamableHttp 在 ZCode 表单里没开放（McpServerForm.tsx:281-284），落到最近的 http。
  assert.equal(normalizeAgentMcpRegistry({ servers: [{ name: 'b', type: 'streamableHttp', url: 'https://x/mcp' }] }).servers[0].transport, 'http')
  assert.equal(normalizeAgentMcpRegistry({ servers: [{ name: 'c', command: 'npx' }] }).servers[0].transport, 'stdio')
  assert.equal(normalizeAgentMcpRegistry({ servers: [{ name: 'd', url: 'https://x/mcp' }] }).servers[0].transport, 'http')
})

test('缺 enabled 视为启用；非法 protocolVersion 归一为未设置；超时夹进区间', () => {
  const entry = normalizeAgentMcpRegistry({
    servers: [{ name: 'a', command: 'npx', protocolVersion: 'bogus', timeoutMs: 99999999 }],
  }).servers[0]
  assert.equal(entry.enabled, true, 'McpServerList.tsx:162 的开关默认开')
  assert.equal(entry.protocolVersion, '', 'mcpSettingsShared.ts:215-217 非法枚举归一为未设置')
  assert.equal(entry.timeoutMs, AGENT_MCP_TIMEOUT_MAX_MS, '超时夹到上界，不丢整条配置')
  assert.equal(normalizeAgentMcpRegistry({ servers: [{ name: 'b', command: 'npx', timeoutMs: -5 }] }).servers[0].timeoutMs, 0, '非正数 = 未设置')
})

test('校验：名称必填与重名（mcpSettingsShared.ts:171-173 与 { [name]: config } 覆盖语义）', () => {
  const noName = validateAgentMcpRegistryEntry(stdioEntry({ name: '   ' }))
  assert.ok(noName.some((p) => p.field === 'name' && p.message.includes('名称不能为空')))

  const dup = validateAgentMcpRegistryEntry(stdioEntry({ name: 'a' }), ['A'])
  assert.ok(dup.some((p) => p.field === 'name' && p.message.includes('重复')), '查重大小写不敏感')

  const registry = { servers: [stdioEntry({ name: 'same' }), stdioEntry({ name: 'SAME', command: 'node' })] }
  assert.ok(validateAgentMcpRegistry(registry).some((p) => p.message.includes('重复')), '整档校验也要抓到重名')
})

test('校验：stdio 必须有命令；http/sse 必须有 http(s) URL；两者不能混填', () => {
  // McpServerForm.tsx:169-171 的 canSave 与 mcpSettingsShared.ts:75/:115 的两个互斥 return。
  const noCommand = validateAgentMcpRegistryEntry(stdioEntry({ command: '' }))
  assert.ok(noCommand.some((p) => p.field === 'command' && p.message.includes('必须填命令')))

  const mixed = validateAgentMcpRegistryEntry(stdioEntry({ url: 'https://x/mcp' }))
  assert.ok(mixed.some((p) => p.message.includes('不能混用')))

  const noUrl = validateAgentMcpRegistryEntry(httpEntry({ url: '' }))
  assert.ok(noUrl.some((p) => p.field === 'url' && p.message.includes('必须填 URL')))

  const badUrl = validateAgentMcpRegistryEntry(httpEntry({ url: 'mcp.example.com/mcp' }))
  assert.ok(badUrl.some((p) => p.field === 'url' && p.message.includes('http:// 或 https://')))

  const httpWithCommand = validateAgentMcpRegistryEntry(httpEntry({ command: 'npx' }))
  assert.ok(httpWithCommand.some((p) => p.message.includes('不能混用')))

  assert.deepEqual(validateAgentMcpRegistryEntry(stdioEntry()), [], '正例零问题')
  assert.deepEqual(validateAgentMcpRegistryEntry(httpEntry()), [], '正例零问题')
})

test('校验：超时区间与协议版本枚举', () => {
  const tooBig = validateAgentMcpRegistryEntry(stdioEntry({ timeoutMs: AGENT_MCP_TIMEOUT_MAX_MS + 1 }))
  assert.ok(tooBig.some((p) => p.field === 'timeoutMs'))

  const fractional = validateAgentMcpRegistryEntry(stdioEntry({ timeoutMs: 1.5 }))
  assert.ok(fractional.some((p) => p.field === 'timeoutMs' && p.message.includes('正整数')))

  assert.deepEqual(
    validateAgentMcpRegistryEntry(stdioEntry({ timeoutMs: AGENT_MCP_TIMEOUT_MIN_MS, protocolVersion: 'legacy' })),
    [],
  )
  const badVersion = validateAgentMcpRegistryEntry(stdioEntry({ protocolVersion: 'nope' }))
  assert.ok(badVersion.some((p) => p.field === 'protocolVersion'))
})

test('增：重名被拦下且原档不被改动；合法新增成功', () => {
  const base = { servers: [stdioEntry({ name: 'a' })] }
  const dup = createAgentMcpRegistryEntry(base, stdioEntry({ name: 'A' }))
  assert.equal(dup.ok, false)
  assert.deepEqual(dup.registry, base, '失败时原档一字不动')

  const added = createAgentMcpRegistryEntry(base, httpEntry({ name: 'b' }))
  assert.equal(added.ok, true)
  assert.equal(added.registry.servers.length, 2)
  assert.equal(base.servers.length, 1, 'create 不改原对象')
})

test('改：按名字定位、名字不可改；定位不到就是失败（不是静默新增）', () => {
  const base = { servers: [stdioEntry({ name: 'a', command: 'npx' })] }
  // McpServerForm.tsx:258 —— 编辑态 name 输入 disabled，所以 patch 里的新名字被忽略。
  const updated = updateAgentMcpRegistryEntry(base, 'a', httpEntry({ name: 'renamed', url: 'https://x/mcp' }))
  assert.equal(updated.ok, true)
  assert.equal(updated.registry.servers[0].name, 'a', '主键保持原名')
  assert.equal(updated.registry.servers[0].transport, 'http')

  const missing = updateAgentMcpRegistryEntry(base, 'ghost', httpEntry())
  assert.equal(missing.ok, false)
  assert.equal(missing.registry.servers.length, 1, '不许变成新增')
})

test('删：幂等（定位不到也算成功，照 handleDelete 的 no-op）', () => {
  const base = { servers: [stdioEntry({ name: 'a' }), httpEntry({ name: 'b' })] }
  const removed = deleteAgentMcpRegistryEntry(base, 'a')
  assert.equal(removed.ok, true)
  assert.deepEqual(removed.registry.servers.map((s) => s.name), ['b'])
  assert.equal(deleteAgentMcpRegistryEntry(base, 'ghost').ok, true, '幂等')
})

test('启用停用：启用要后续刷新、停用不要（McpSettingsSection.tsx:1221-1242）', () => {
  const base = { servers: [stdioEntry({ name: 'a', enabled: true })] }
  const off = setAgentMcpRegistryEnabled(base, 'a', false)
  assert.equal(off.ok, true)
  assert.equal(off.registry.servers[0].enabled, false)
  assert.equal(off.shouldRefresh, false, '停用不需要刷新')

  const on = setAgentMcpRegistryEnabled(base, 'a', true)
  assert.equal(on.shouldRefresh, true, '启用后要拉一次状态')

  const missing = setAgentMcpRegistryEnabled(base, 'ghost', true)
  assert.equal(missing.ok, false)
  assert.equal(missing.shouldRefresh, false)
})

test('搜索：匹配 name / url / command，大小写不敏感、子串命中（pluginManagedResourceGroups.ts:206-213）', () => {
  const registry = {
    servers: [
      stdioEntry({ name: 'memory', command: 'npx' }),
      httpEntry({ name: 'remote', url: 'https://mcp.example.com/mcp' }),
      stdioEntry({ name: 'fs', command: 'node', args: ['server.js'] }),
    ],
  }
  assert.equal(filterAgentMcpRegistry(registry, '').length, 3, '空查询返回全部')
  assert.deepEqual(filterAgentMcpRegistry(registry, 'MEM').map((s) => s.name), ['memory'], 'name 大小写不敏感')
  assert.deepEqual(filterAgentMcpRegistry(registry, 'example.com').map((s) => s.name), ['remote'], 'url 命中')
  assert.deepEqual(filterAgentMcpRegistry(registry, 'npx').map((s) => s.name), ['memory'], 'command 命中')
  assert.equal(filterAgentMcpRegistry(registry, 'zzz').length, 0)
})

test('排序：需要关注的行（本仓=停用）先出，其余保持原序（McpSettingsSection.tsx:1194-1209）', () => {
  const registry = {
    servers: [
      stdioEntry({ name: 'a', enabled: true }),
      stdioEntry({ name: 'b', enabled: false }),
      stdioEntry({ name: 'c', enabled: true }),
    ],
  }
  assert.deepEqual(sortAgentMcpRegistry(registry).servers.map((s) => s.name), ['b', 'a', 'c'])
})

test('行副标题照 McpServerList.tsx:99-103 拼：类型 · url 或 类型 · command args', () => {
  assert.equal(agentMcpEntryDescription(httpEntry()), 'HTTP · https://mcp.example.com/mcp')
  assert.equal(agentMcpEntryDescription(stdioEntry()), 'stdio（本地命令） · npx -y @modelcontextprotocol/server-memory')
  assert.equal(agentMcpEntryDescription(stdioEntry({ args: [] })), 'stdio（本地命令） · npx')
})

test('标签取值照表单 SelectItem：传输三项 + 协议版本三项', () => {
  assert.equal(agentMcpTransportLabel('stdio'), 'stdio（本地命令）')
  assert.equal(agentMcpTransportLabel('http'), 'HTTP')
  assert.equal(agentMcpTransportLabel('sse'), 'SSE（Server-Sent Events）')
  assert.equal(agentMcpProtocolVersionLabel(''), '自动（推荐）')
  assert.equal(agentMcpProtocolVersionLabel('legacy'), '兼容旧版')
  assert.equal(agentMcpProtocolVersionLabel('2026-07-28'), 'v2')
})

test('操作集合照 McpServerList/McpSettingsSection 真实存在的动作，运行态项单独登记', () => {
  const ids = AGENT_MCP_REGISTRY_ACTIONS.map((a) => a.id)
  assert.deepEqual(ids, ['refresh', 'import', 'new', 'edit', 'toggle', 'delete', 'authorize'])
  for (const id of AGENT_MCP_REGISTRY_RUNTIME_ACTIONS) {
    assert.ok(ids.includes(id), `${id} 必须来自真实动作集合`)
  }
  // ZCode 的 refresh/authorize 都要 MCP 客户端运行时；本仓没有，界面据此不渲染成可点控件。
  assert.deepEqual([...AGENT_MCP_REGISTRY_RUNTIME_ACTIONS].sort(), ['authorize', 'refresh'])
})

test('文案逐字取自 zh-CN.ts（含删除确认三句与表单标签）', () => {
  assert.equal(AGENT_MCP_TEXT.title, 'MCP 服务器')
  assert.equal(AGENT_MCP_TEXT.emptyTitle, '还没有 MCP 服务器')
  assert.equal(AGENT_MCP_TEXT.searchPlaceholder, '搜索 MCP 服务器…')
  assert.equal(AGENT_MCP_TEXT.formArgs, '参数（空格分隔）')
  assert.equal(AGENT_MCP_TEXT.formTimeoutMs, '超时时间 MS')
  assert.equal(AGENT_MCP_DELETE_CONFIRM_TITLE, '删除 MCP 服务器"{name}"？')
  assert.equal(AGENT_MCP_DELETE_CONFIRM_DESCRIPTION, '删除后将无法恢复，该服务器配置将从文件中移除。')
  assert.equal(AGENT_MCP_DELETE_CONFIRM_ACTION, '确认删除')
})

test('持久化往返：写进去的档能原样读回（normalize 幂等）', () => {
  const storage = createMemoryStorage()
  const registry = { servers: [stdioEntry({ name: 'a' }), httpEntry({ name: 'b' })] }
  assert.equal(saveAgentMcpRegistry(registry, storage), true)
  const loaded = loadAgentMcpRegistry(storage)
  assert.deepEqual(loaded, normalizeAgentMcpRegistry(registry), '读回的形状与归一化后一致')
  assert.equal(loaded.servers.length, 2)
  assert.deepEqual(Object.keys(storage.dump()), [AGENT_MCP_REGISTRY_STORAGE_KEY])
})

test('坏档永不抛：存储不可用 / 非 JSON 都退回空档', () => {
  assert.deepEqual(loadAgentMcpRegistry(null), { servers: [] })
  assert.deepEqual(loadAgentMcpRegistry(createThrowingStorage()), { servers: [] })
  const corrupt = createMemoryStorage({ [AGENT_MCP_REGISTRY_STORAGE_KEY]: '{ not json' })
  assert.deepEqual(loadAgentMcpRegistry(corrupt), { servers: [] })
  assert.equal(saveAgentMcpRegistry(emptyAgentMcpRegistry(), createThrowingStorage()), false, '写不下返回 false，不抛')
})

test('find 按名字大小写不敏感；空名查不到', () => {
  const registry = { servers: [stdioEntry({ name: 'Memory' })] }
  assert.equal(findAgentMcpRegistryEntry(registry, 'memory')?.name, 'Memory')
  assert.equal(findAgentMcpRegistryEntry(registry, '  '), null)
  assert.equal(findAgentMcpRegistryEntry(registry, 'ghost'), null)
})