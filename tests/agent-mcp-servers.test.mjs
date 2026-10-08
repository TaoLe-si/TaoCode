// `agent/mcp-servers` 判据：MCP 服务器条目的形状、逐字段救、校验拦截、持久化往返、
// JSON 导入导出、失败码折述。
//
// 判据锚点全部指回 ZCode 权威源码（`.tools/ZCode`，只读参照）：
//   · `settingsPageConfig.ts:94-99`        —— 这一节存在，id `mcp`、图标 Cable
//   · `mcpSettingsShared.ts`               —— 表单形状与 JSON 双向转换
//   · `McpServerList.tsx`                  —— 列表行展示字段与开关
//   · `McpFailurePresentation.tsx:7-11`    —— 失败码兜底语义
//   · `zcode-protocol/index.ts:664-684`    —— 失败码枚举（19 个）
//   · `i18n/locales/zh-CN.ts:2448-2469`    —— 19 条中文文案
// 以及本仓实测：`native/mcp_server.cpp:291-335, 391-417` 与 `~/.qoder/settings.json`。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_MCP_FAILURE_FALLBACK,
  AGENT_MCP_STORAGE_KEY,
  AGENT_MCP_TIMEOUT_MAX_MS,
  AGENT_MCP_TIMEOUT_MIN_MS,
  AGENT_TAOCODE_MCP_SAMPLE_CONFIG,
  builtinTaocodeMcpServer,
  defaultAgentMcpSettings,
  describeMcpFailure,
  loadAgentMcpSettings,
  mcpServerConfigJson,
  normalizeAgentMcpSettings,
  parseMcpServerInput,
  saveAgentMcpSettings,
  validateAgentMcpSettings,
} from '../src/agentMcpServers.ts'
import { createMemoryStorage, createThrowingStorage } from '../src/agentSettingsStore.ts'

/** 造一条能通过校验的 http 服务器，测试里只在要改某一个字段时覆盖它。 */
function httpServer(overrides = {}) {
  return {
    id: 'srv-1',
    name: 'remote',
    enabled: true,
    transport: 'http',
    command: '',
    args: [],
    url: 'https://mcp.example.com/mcp',
    env: {},
    headers: {},
    timeoutMs: 0,
    protocolVersion: '',
    scope: 'user',
    capabilities: { tools: true, serverName: 'remote', serverVersion: '1.0.0', serverTitle: '', protocolVersions: [] },
    declaredTools: [],
    failureKind: '',
    ...overrides,
  }
}

test('出厂默认逐字对齐 ZCode 这一节：只有本仓自带的 stdio 服务端，字段全为未设置', () => {
  const settings = defaultAgentMcpSettings()
  assert.equal(settings.servers.length, 1, 'ZCode 那一节出厂是空列表；本仓多出一条自带的，不预置假条目')
  const server = settings.servers[0]
  assert.equal(server.name, 'taocode', '名字取自 ~/.qoder/settings.json 的 mcpServers.taocode 键')
  assert.equal(server.transport, 'stdio', 'mcpSettingsShared.ts:50 有 command 即 stdio')
  assert.equal(server.enabled, true, 'McpServerList.tsx:162 的开关默认开')
  assert.equal(server.url, '', 'stdio 不带 url（mcpSettingsShared.ts:115 的 http 分支才有）')
  assert.equal(server.headers && Object.keys(server.headers).length, 0, 'stdio 没有请求头')
  assert.equal(server.timeoutMs, 0, '0 = 未设置；ZCode 这时压根不落这个键（mcpSettingsShared.ts:90）')
  assert.equal(server.protocolVersion, '', '空串 = 未设置 = 自动协商（McpServerForm.tsx:196-199 的 auto 哨兵）')
  assert.equal(server.scope, 'user', 'mcpSettingsShared.ts:6 的 ConfigStorageLevel')
  assert.equal(server.failureKind, '', '没失败过就没有失败码')
  // 阳性对照：默认设置本身必须是能保存的，否则主代理一进来就看到一堆红字。
  assert.deepEqual(validateAgentMcpSettings(settings), [], '出厂默认必须零校验问题')
})

test('传输枚举就是 ZCode 表单开放的三项（streamableHttp 在 ZCode 侧被注释掉了）', () => {
  // McpServerForm.tsx:281-284 —— streamableHttp 那一项在 ZCode 表单里是注释状态。
  const servers = normalizeAgentMcpSettings({
    servers: [
      { name: 'a', transport: 'streamableHttp', url: 'https://x.example.com/mcp' },
      { name: 'b', transport: 'sse', url: 'https://y.example.com/sse' },
      { name: 'c', transport: 'http', url: 'https://z.example.com/mcp' },
    ],
  }).servers
  assert.equal(servers[0].transport, 'http', 'streamableHttp 落到最近的 http 传输，不凭空造第四项')
  assert.equal(servers[1].transport, 'sse')
  assert.equal(servers[2].transport, 'http')
  // 阳性对照：stdio 那一档没被上面的规则误伤。
  const stdio = normalizeAgentMcpSettings({ servers: [{ name: 'd', command: 'node' }] }).servers[0]
  assert.equal(stdio.transport, 'stdio', '有 command 就是 stdio（mcpSettingsShared.ts:50）')
})

test('传输非法枚举时从内容反推，不是一刀切成 stdio（照 mcpSettingsShared.ts:45-54）', () => {
  const saved = normalizeAgentMcpSettings({
    servers: [
      { name: '手滑的 type', transport: 'highttp', command: 'node', args: [] },
      { name: '只有 url', transport: '???', url: 'https://a.example.com/mcp' },
      { name: '带 sse 的 type', type: 'sse', url: 'https://b.example.com/sse' },
    ],
  }).servers
  assert.equal(saved[0].transport, 'stdio', '有 command → stdio')
  assert.equal(saved[1].transport, 'http', '没 command → http')
  assert.equal(saved[2].transport, 'sse', 'type 为 sse 优先于 command 判定')
})

test('内置样例与本机 ~/.qoder/settings.json 的真实形状逐字对齐', () => {
  // 核实来源：Get-Content C:\Users\Administrator\.qoder\settings.json -Raw → mcpServers.taocode
  assert.equal(AGENT_TAOCODE_MCP_SAMPLE_CONFIG.command, 'D:\\TaoCode\\build\\taocode_mcp.exe')
  assert.deepEqual([...AGENT_TAOCODE_MCP_SAMPLE_CONFIG.args], ['--root', 'D:\\TaoCode', '--repo-dir', 'D:\\TaoCode'])
  assert.deepEqual({ ...AGENT_TAOCODE_MCP_SAMPLE_CONFIG.env }, { TAOCODE_DEBUG_PORT: '9333' })
  // 真实配置里**没有** type 键；mcpServerConfigJson 走 ZCode formToConfig 的口径会补上它。
  // 这不是冲突：ZCode 自己的读法（mcpSettingsShared.ts:50-53）"有 command 即 stdio"两种都认。
  const config = mcpServerConfigJson(builtinTaocodeMcpServer())
  for (const [key, value] of Object.entries(AGENT_TAOCODE_MCP_SAMPLE_CONFIG)) {
    assert.deepEqual(config.mcpServers.taocode[key], value, `导出配置里的 ${key} 必须与真实注册一致`)
  }
  assert.equal(Object.keys(config).length, 1, '整份文档只包一层 mcpServers（本机 settings.json 的形状）')
  assert.deepEqual(Object.keys(config.mcpServers), ['taocode'], '服务器名当键（mcpSettingsShared.ts:136）')
})

test('内置的 10 个工具名是点号分隔的 —— 写 fs_read 会拿到 -32602 Unknown tool', () => {
  const tools = builtinTaocodeMcpServer().declaredTools
  assert.equal(tools.length, 10, 'native/mcp_server.cpp:391-417 的分派表正好 10 条')
  // 阳性对照：这条否定判据的正则本身是有效的，不是永不命中的空判据。
  assert.ok(/^[a-z]+_[a-z]+$/.test('fs_read'), '下划线形确实能匹配该正则 —— 证明下面的否定判据会真的跑')
  for (const tool of tools) {
    assert.match(tool, /^[a-z]+\.[a-z]+$/, `${tool} 应为点号分隔`)
  }
  assert.equal(tools.some((tool) => tool.includes('_')), false, '没有任何下划线形工具名')
  assert.deepEqual(
    [...tools].sort(),
    ['fs.list', 'fs.read', 'fs.write', 'git.diff', 'git.status', 'project.list', 'run.output', 'run.start', 'run.stop', 'ui.probe'],
    '逐条取自 native/mcp_server.cpp:391-417'
  )
})

test('内置能力面是实测值，不是编的（native/mcp_server.cpp:328-335 的 initialize 回包）', () => {
  const { capabilities } = builtinTaocodeMcpServer()
  assert.equal(capabilities.tools, true, 'capabilities.tools 已声明（mcp_server.cpp:333）')
  assert.equal(capabilities.serverName, 'taocode')
  assert.equal(capabilities.serverVersion, '0.1.0')
  assert.equal(capabilities.serverTitle, 'TaoCode IDE (offscreen debug bridge)')
  assert.deepEqual([...capabilities.protocolVersions], ['2024-11-05', '2025-03-26', '2025-06-18'], 'mcp_server.cpp:328')
  // 阴性对照 + 阳性对照：ZCode 那三个协议版本枚举（legacy/auto/2026-07-28）不是同一族，不能混填。
  assert.equal(capabilities.protocolVersions.includes('2026-07-28'), false, '服务端没声明 ZCode 那个版本号')
  assert.equal(capabilities.protocolVersions.includes('2025-06-18'), true, '阳性对照：确实声明了本仓支持的版本')
})

test('坏存档逐字段救：缺键补默认、错类型退默认、超时夹进区间', () => {
  const saved = normalizeAgentMcpSettings({
    servers: [{
      name: '  ',
      enabled: '是',
      transport: 123,
      command: null,
      args: ['-y', 42, '  ', '-y', ''],
      url: 7,
      env: { OK: 'v', BAD: { a: 1 }, NUL: null, NUM: 3 },
      headers: '不是表',
      timeoutMs: 999_999_999,
      protocolVersion: 'draft-99',
      scope: 'machine',
      capabilities: '不是对象',
      declaredTools: ['a', 1, 'a', '  ', 'b'],
      failureKind: 5,
    }],
  })
  assert.equal(saved.servers.length, 1, '有救的条目不丢')
  const server = saved.servers[0]
  assert.equal(server.id, 'mcp-1', '缺 id 补一个生成 id（照 agentSettings.ts:178 的做法）')
  assert.equal(server.name, 'mcp-1', '空名退回 id，不留空串')
  assert.equal(server.enabled, true, '错类型退默认（默认启用）')
  assert.equal(server.command, '', 'null 退空串')
  assert.deepEqual([...server.args], ['-y', '-y'], '非字符串丢弃、空串丢弃；**重复参数必须保留**（真实注册里 D:\\TaoCode 出现两次）')
  assert.equal(server.url, '', '数字不是 url')
  assert.deepEqual({ ...server.env }, { OK: 'v', NUM: '3' }, '字符串保留、数字转字符串、对象/ null 丢弃；不丢整表')
  assert.deepEqual({ ...server.headers }, {}, 'headers 不是表就退空表')
  assert.equal(server.timeoutMs, AGENT_MCP_TIMEOUT_MAX_MS, '超上限夹到上限而不是丢弃')
  assert.equal(server.protocolVersion, '', '非法协议版本归一为未设置（mcpSettingsShared.ts:215 的同一语义）')
  assert.equal(server.scope, 'user', '非法作用域退 user')
  assert.equal(server.capabilities.tools, false, 'capabilities 不是对象就退空声明面')
  assert.deepEqual([...server.declaredTools], ['a', 'b'], '工具名去重去空')
  assert.equal(server.failureKind, '', '错类型退空串')
})

test('坏存档不按字段数量判损坏：只有 1 个键的条目照样要救回来（本仓铁律）', () => {
  // 阳性对照：这条判据要证明"字段少"不会被当成损坏丢弃 —— 历史上真出过把用户锁在项目外的事故。
  const saved = normalizeAgentMcpSettings({ servers: [{ name: '只有一个键' }] })
  assert.equal(saved.servers.length, 1, '不能因为只有 1 个键就判定损坏并丢弃')
  assert.equal(saved.servers[0].name, '只有一个键')
  // 阴性对照：非对象条目确实被丢掉。
  const withJunk = normalizeAgentMcpSettings({ servers: ['字符串', 42, null, [{ name: '数组' }], { name: '好的' }] })
  assert.equal(withJunk.servers.length, 1, '垃圾条目只丢自己')
  assert.equal(withJunk.servers[0].name, '好的')
  // 顶层不是对象时退回默认（不是空表）。
  assert.equal(normalizeAgentMcpSettings(null).servers.length, 1)
  assert.equal(normalizeAgentMcpSettings('垃圾').servers.length, 1)
  assert.equal(normalizeAgentMcpSettings({ servers: '不是数组' }).servers.length, 1, 'servers 不是数组时退回默认')
})

test('校验拦下 stdio 缺 command', () => {
  const bad = normalizeAgentMcpSettings({ servers: [{ name: '空的 stdio', transport: 'stdio' }] })
  const problems = validateAgentMcpSettings(bad)
  assert.equal(problems.length, 1, `应恰好一条问题，实际：${JSON.stringify(problems)}`)
  assert.match(problems[0], /stdio/, '文案要说清是 stdio')
  assert.match(problems[0], /命令/, '文案要说清缺的是命令')
  // 阳性对照：补上 command 就干净了 —— 证明上面那条不是因为别的原因才命中。
  const good = normalizeAgentMcpSettings({ servers: [{ name: '好的 stdio', transport: 'stdio', command: 'node' }] })
  assert.deepEqual(validateAgentMcpSettings(good), [], '补上 command 后零问题')
})

test('校验拦下 http/sse 缺 url，并要求 http(s) 开头', () => {
  const noUrl = normalizeAgentMcpSettings({ servers: [{ name: '空的 http', transport: 'http' }] })
  assert.equal(validateAgentMcpSettings(noUrl).length, 1)
  assert.match(validateAgentMcpSettings(noUrl)[0], /URL/)
  const badScheme = validateAgentMcpSettings({ servers: [httpServer({ url: 'ftp://x.example.com' })] })
  assert.equal(badScheme.length, 1)
  assert.match(badScheme[0], /http:\/\/ 或 https:\/\//)
  // 阳性对照：合法 https 放行。
  assert.deepEqual(validateAgentMcpSettings({ servers: [httpServer()] }), [], '合法 https URL 零问题')
})

test('校验拦下 command 与 url 混填（两种传输不许并存）', () => {
  // mcpSettingsShared.ts:73-125 的 formToConfig 是两个互斥 return，混填在 ZCode 那边也不可能产出。
  const mixed1 = validateAgentMcpSettings({ servers: [httpServer({ command: 'node' })] })
  assert.equal(mixed1.length, 1, `http 填了 command 应恰好一条问题：${JSON.stringify(mixed1)}`)
  assert.match(mixed1[0], /不能混用/)
  const mixed2 = validateAgentMcpSettings(normalizeAgentMcpSettings({
    servers: [{ name: '混填', transport: 'stdio', command: 'node', url: 'https://x.example.com/mcp' }],
  }))
  assert.equal(mixed2.length, 1, `stdio 填了 url 应恰好一条问题：${JSON.stringify(mixed2)}`)
  assert.match(mixed2[0], /不能混用/)
  // 阳性对照：单独填 command（stdio）或单独填 url（http）都放行。
  assert.deepEqual(validateAgentMcpSettings({ servers: [httpServer()] }), [])
  assert.deepEqual(validateAgentMcpSettings(normalizeAgentMcpSettings({
    servers: [{ name: '纯 stdio', transport: 'stdio', command: 'node' }],
  })), [])
})

test('校验拦下 args 非字符串数组（手搭对象的最后一道闸）', () => {
  const problems = validateAgentMcpSettings({ servers: [httpServer({ args: [1, 2] })] })
  assert.equal(problems.length, 1, `应恰好一条：${JSON.stringify(problems)}`)
  assert.match(problems[0], /字符串数组/)
  // 阳性对照：字符串数组放行 —— 证明上面的判定不是因为别的字段坏了才命中。
  assert.deepEqual(validateAgentMcpSettings({ servers: [httpServer({ args: ['--root', 'D:\\x'] })] }), [])
})

test('校验拦下超时越界与非整数，0 与合法值放行', () => {
  assert.equal(AGENT_MCP_TIMEOUT_MIN_MS, 1)
  assert.equal(AGENT_MCP_TIMEOUT_MAX_MS, 600_000)
  const zero = validateAgentMcpSettings({ servers: [httpServer({ timeoutMs: 0 })] })
  assert.deepEqual(zero, [], '0 = 未设置，放行（ZCode 这时压根不落这个键）')
  const low = validateAgentMcpSettings({ servers: [httpServer({ timeoutMs: -1 })] })
  assert.equal(low.length, 1)
  assert.match(low[0], /超时必须在/)
  const high = validateAgentMcpSettings({ servers: [httpServer({ timeoutMs: 600_001 })] })
  assert.equal(high.length, 1)
  const frac = validateAgentMcpSettings({ servers: [httpServer({ timeoutMs: 1000.5 })] })
  assert.equal(frac.length, 1)
  assert.match(frac[0], /整数/)
  // 阳性对照：区间内的整数与两端都放行。
  assert.deepEqual(validateAgentMcpSettings({ servers: [httpServer({ timeoutMs: 30_000 })] }), [])
  assert.deepEqual(validateAgentMcpSettings({ servers: [httpServer({ timeoutMs: 1 })] }), [], '下界本身合法')
  assert.deepEqual(validateAgentMcpSettings({ servers: [httpServer({ timeoutMs: 600_000 })] }), [], '上界本身合法')
})

test('校验拦下空名与重名（重名会让导出时后者覆盖前者）', () => {
  const empty = validateAgentMcpSettings({ servers: [httpServer({ name: '   ' })] })
  assert.equal(empty.length, 1)
  assert.match(empty[0], /名称不能为空/)
  const dup = validateAgentMcpSettings({ servers: [httpServer({ name: 'x' }), httpServer({ name: 'x', id: 'srv-2' })] })
  assert.equal(dup.length, 1, `重名应恰好一条：${JSON.stringify(dup)}`)
  assert.match(dup[0], /重复/)
  // 阳性对照：不同名放行。
  assert.deepEqual(validateAgentMcpSettings({ servers: [httpServer({ name: 'x' }), httpServer({ name: 'y', id: 'srv-2' })] }), [])
})

test('存储往返：写入的键名与内容都对，读回是同一份', () => {
  const storage = createMemoryStorage()
  const settings = defaultAgentMcpSettings()
  settings.servers.push(httpServer({ id: 'srv-1', timeoutMs: 30_000, protocolVersion: 'legacy' }))
  assert.equal(saveAgentMcpSettings(settings, storage), true, '存得下要返回 true')
  const dump = storage.dump()
  assert.deepEqual(Object.keys(dump), [AGENT_MCP_STORAGE_KEY], `只写自己的键，实际：${Object.keys(dump).join(',')}`)
  assert.equal(AGENT_MCP_STORAGE_KEY, 'taocode.agent.mcpServers', '与 taocode.agent.settings 同一族')
  const written = JSON.parse(dump[AGENT_MCP_STORAGE_KEY])
  assert.equal(written.servers.length, 2)
  assert.equal(written.servers[1].timeoutMs, 30_000, '落盘的是结构化字段，不是表单那行空格串')
  const loaded = loadAgentMcpSettings(storage)
  assert.deepEqual(loaded.servers, settings.servers, '读回逐字段相同')
})

test('存储不可用时静默降级：返回合法默认值、写入返回 false，绝不抛', () => {
  assert.deepEqual(loadAgentMcpSettings(null), defaultAgentMcpSettings(), '无存储 → 出厂默认')
  assert.equal(saveAgentMcpSettings(defaultAgentMcpSettings(), null), false, '无存储 → 只丢持久化')
  const throwing = createThrowingStorage()
  assert.doesNotThrow(() => loadAgentMcpSettings(throwing), 'getItem 抛异常必须被兜住')
  assert.deepEqual(loadAgentMcpSettings(throwing), defaultAgentMcpSettings(), '读路径也退回默认值')
  assert.equal(saveAgentMcpSettings(defaultAgentMcpSettings(), throwing), false, 'setItem 抛异常时返回 false')
  // 坏 JSON 也走同一条降级路径。
  assert.deepEqual(
    loadAgentMcpSettings(createMemoryStorage({ [AGENT_MCP_STORAGE_KEY]: '{不是 JSON' })),
    defaultAgentMcpSettings(),
    '存档不是 JSON 时退回默认值，不把用户锁在外面'
  )
})

test('parseMcpServerInput 挡下坏 JSON / 数组 / 空对象 / 缺 name', () => {
  const bad = parseMcpServerInput('{ 坏 JSON')
  assert.equal(bad.ok, false)
  assert.equal(bad.server, null, '失败时 server 恒为 null，Vue 侧不用写可选链')
  assert.match(bad.error, /JSON 解析失败/, '对齐 settings.mcp.form.jsonParseError（zh-CN.ts:2479）')

  const array = parseMcpServerInput('[{"name":"x","url":"https://x.example.com"}]')
  assert.equal(array.ok, false, '顶层数组不是配置对象（mcpSettingsShared.ts:167）')
  assert.equal(array.error, 'JSON 内容不是有效的 MCP server 配置对象。')

  const empty = parseMcpServerInput('{}')
  assert.equal(empty.ok, false, '空对象解析不出名字（mcpSettingsShared.ts:171-173）')
  assert.equal(empty.error, 'JSON 模式需要提供 server 名称。')

  const blank = parseMcpServerInput('   ')
  assert.equal(blank.ok, false)
  assert.equal(blank.error, 'JSON 内容为空。')

  const scalar = parseMcpServerInput('"字符串"')
  assert.equal(scalar.ok, false, '顶层标量同样被挡')

  const twoServers = parseMcpServerInput('{"mcpServers":{"a":{"url":"https://a"},"b":{"url":"https://b"}}}')
  assert.equal(twoServers.ok, false, 'mcpServers 包了 2 条 → ZCode 一次只准编辑一条（mcpSettingsShared.ts:146-149）')
  assert.equal(twoServers.error, 'JSON 模式暂时只支持一次编辑一个 MCP server。')
})

test('parseMcpServerInput 认两种形状并转成条目（mcpServers 包 + 扁平单条目）', () => {
  const wrapped = parseMcpServerInput('{"mcpServers":{"notion":{"type":"http","url":"https://mcp.notion.com/mcp","timeoutMs":30000}}}')
  assert.equal(wrapped.ok, true, `应解析成功：${wrapped.error}`)
  assert.equal(wrapped.server.name, 'notion', 'mcpServers 的键就是服务器名（mcpSettingsShared.ts:145-151）')
  assert.equal(wrapped.server.transport, 'http')
  assert.equal(wrapped.server.url, 'https://mcp.notion.com/mcp')
  assert.equal(wrapped.server.timeoutMs, 30_000, 'timeoutMs 必须保留（mcpSettingsShared.ts:197-200 明确要求）')

  const flat = parseMcpServerInput('{"my-server":{"command":"npx","args":["-y","pkg"]}}')
  assert.equal(flat.ok, true, `应解析成功：${flat.error}`)
  assert.equal(flat.server.name, 'my-server', '顶层单条目且不含 type/command/url 时键名即服务器名（mcpSettingsShared.ts:153-165）')
  assert.equal(flat.server.transport, 'stdio')
  assert.deepEqual([...flat.server.args], ['-y', 'pkg'], '数组形态的 args 保留，不被空格串化')

  // 裸配置（顶层直接是 command/url/type）没有名字可取：ZCode 那一支的守卫是
  // `!('type' in p) && !('command' in p) && !('url' in p)`（mcpSettingsShared.ts:157-159），
  // 含 command 就跳过"键名即服务器名"那一支，最后落到「需要提供 server 名称」（`:171-173`）。
  const bare = parseMcpServerInput('{"command":"node","args":[]}')
  assert.equal(bare.ok, false, '裸配置因缺名字被拒 —— 与 ZCode 同一分支')
  assert.equal(bare.error, 'JSON 模式需要提供 server 名称。')
  // 阴性对照：解析成功 ≠ 校验通过，坏配置仍要被校验挡住。
  const half = parseMcpServerInput('{"mcpServers":{"broken":{"type":"http"}}}')
  assert.equal(half.ok, true, '解析只看形状，不看语义')
  assert.equal(validateAgentMcpSettings({ servers: [half.server] }).length, 1, 'http 缺 url 仍被校验拦下')
})

test('mcpServerConfigJson 二选一：stdio 不出 url，http 不出 command（阳性对照各自成对）', () => {
  const stdio = mcpServerConfigJson(builtinTaocodeMcpServer()).mcpServers.taocode
  assert.equal(stdio.command, 'D:\\TaoCode\\build\\taocode_mcp.exe')
  assert.equal(stdio.url, undefined, 'stdio 不得带 url（formToConfig 的 stdio 分支只给 command/args/env）')
  assert.equal(stdio.headers, undefined, 'stdio 不得带 headers')
  assert.equal(stdio.timeoutMs, undefined, 'timeoutMs 0 时不落盘')
  assert.equal(stdio.protocolVersion, undefined, 'protocolVersion 空串时不落盘')

  const remote = mcpServerConfigJson(httpServer({ headers: { Authorization: 'Bearer t' }, protocolVersion: 'legacy' })).mcpServers.remote
  assert.equal(remote.url, 'https://mcp.example.com/mcp', '阳性对照：http 那一档确实出 url')
  assert.deepEqual({ ...remote.headers }, { Authorization: 'Bearer t' })
  assert.equal(remote.protocolVersion, 'legacy', '非空协议版本要落盘')
  assert.equal(remote.command, undefined, 'http 不得带 command')
  assert.equal(remote.args, undefined, 'http 不得带 args')
  assert.equal(remote.env, undefined, 'http 不得带 env')
})

test('describeMcpFailure 把 19 个码逐条折成 ZCode 的中文文案', () => {
  // 码表逐条取自 packages/shared/src/zcode-protocol/index.ts:664-684，文案取自 zh-CN.ts:2448-2469。
  const kinds = [
    'config_invalid', 'runtime_unavailable', 'process_start_failed', 'network_unreachable',
    'connection_timeout', 'protocol_negotiation_failed', 'tool_list_failed', 'unexpected_disconnect',
    'oauth_authorization_failed', 'official_origin_untrusted', 'not_authenticated', 'coding_plan_required',
    'server_not_found', 'server_unavailable', 'rate_limited', 'server_internal_error',
    'protocol_error', 'status_unavailable', 'connection_failed',
  ]
  for (const kind of kinds) {
    const message = describeMcpFailure(kind)
    assert.ok(message.startsWith('MCP ') || message.startsWith('已连接') || message.startsWith('无法连接')
      || message.startsWith('连接 MCP') || message.startsWith('当前') || message.startsWith('暂时')
      || message.startsWith('找不到'), `${kind} 应当折出一句中文，实际：${message}`)
  }
  assert.equal(describeMcpFailure('connection_timeout'), '连接 MCP 服务器超时，请稍后重试。', '逐字对照 zh-CN.ts:2453')
  assert.equal(describeMcpFailure('rate_limited'), 'MCP 请求过于频繁，请稍后重试。', '逐字对照 zh-CN.ts:2465')
  assert.equal(describeMcpFailure('config_invalid'), 'MCP 配置无效，请检查服务器配置。', '逐字对照 zh-CN.ts:2448')
  // 收对象形态：ZCode 是 resolveMcpFailureMessageId(failureKind)（McpFailurePresentation.tsx:7-11）。
  assert.equal(describeMcpFailure({ failureKind: 'server_unavailable' }), 'MCP 服务暂时不可用，请稍后重试。')
})

test('describeMcpFailure 对未知码 / 空值兜底到 connection_failed（照 McpFailurePresentation.tsx:10）', () => {
  assert.equal(describeMcpFailure('不存在的码'), AGENT_MCP_FAILURE_FALLBACK, '未知码 → connection_failed')
  assert.equal(describeMcpFailure(''), AGENT_MCP_FAILURE_FALLBACK, '空串 → connection_failed')
  assert.equal(describeMcpFailure(undefined), AGENT_MCP_FAILURE_FALLBACK, 'undefined → connection_failed')
  assert.equal(describeMcpFailure(null), AGENT_MCP_FAILURE_FALLBACK, 'null → connection_failed')
  assert.equal(describeMcpFailure(42), AGENT_MCP_FAILURE_FALLBACK, '数字 → connection_failed')
  assert.equal(describeMcpFailure({ error: 'boom' }), AGENT_MCP_FAILURE_FALLBACK, '只有 error 没有 failureKind → connection_failed')
  assert.equal(AGENT_MCP_FAILURE_FALLBACK, 'MCP 服务器连接失败，请稍后重试。', '兜底文案逐字对照 zh-CN.ts:2469')
  // 阳性对照：兜底不是"所有输入都返回同一句" —— 合法码必须走自己的分支。
  assert.notEqual(describeMcpFailure('network_unreachable'), AGENT_MCP_FAILURE_FALLBACK)
  assert.equal(describeMcpFailure('network_unreachable'), '无法连接到 MCP 服务器，请检查网络、代理和服务器地址。')
})
