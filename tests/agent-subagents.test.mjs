// 「子智能体」节判据 —— 对照 ZCode `.tools/ZCode` 的 subagents 设置面。
//
// 钉住四件事：
//   1. 出厂默认与字段取值**逐字**对齐 ZCode（不是「一般来说 ZCode 是这样的」）；
//   2. 坏存档逐字段救回来，不许把用户锁在设置外（本仓铁律：不许按字段数量判损坏）；
//   3. 保存前校验要当场拦下空名 / 重名 / 路径越界 / 死记录；
//   4. 子智能体定义的**格式已核实 = Markdown + YAML frontmatter**，不是 JSON ——
//      需求里那个「可能是 json」的假设已被源码否掉，这里用阳性/阴性对照把它钉死。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_SUBAGENT_COLORS,
  AGENT_SUBAGENT_INHERIT_MODEL_NAMES,
  AGENT_SUBAGENT_NAME_MAX,
  AGENT_SUBAGENT_NAME_MIN,
  AGENT_SUBAGENTS_STORAGE_KEY,
  AGENT_SUBAGENTS_TITLE,
  AGENT_SUBAGENT_RISKY_TOOLS,
  agentSubagentStateId,
  allowsAllTools,
  defaultAgentSubagentsSettings,
  loadAgentSubagentsSettings,
  mergeSubagentTools,
  normalizeAgentSubagentsSettings,
  parseSubagentMarkdown,
  saveAgentSubagentsSettings,
  subagentCapabilities,
  validateAgentSubagentsSettings,
} from '../src/agentSubagents.ts'
import { createMemoryStorage, createThrowingStorage } from '../src/agentSettingsStore.ts'

/** 一条用户级子智能体（ZCode `subagents-types.ts:4, 6` 的 scope/source 组合）。 */
function userEntry(overrides = {}) {
  return {
    id: '',
    name: 'worker-x',
    description: '有界产出',
    systemPrompt: '你是一个有界产出的 worker。',
    path: 'C:\\Users\\Administrator\\.minimax\\agents\\worker-x\\agent.md',
    scope: 'user',
    source: 'user',
    enabled: true,
    ...overrides,
  }
}

test('出厂默认逐字对齐 ZCode：空清单 + 空覆盖层（agents-state.json 的 emptyAgentsState）', () => {
  const defaults = defaultAgentSubagentsSettings()
  assert.deepEqual(defaults.entries, [], 'ZCode subagentsService.ts:141-147 emptyAgentsState()')
  assert.deepEqual(defaults.disabledAgentIds, [], 'agents-state.json 的 disabledAgentIds 缺省空')
  assert.deepEqual(defaults.modelOverrides, {}, '两个 override map 缺省空')
  assert.equal(defaults.query, '', 'ZCode zh-CN.ts:3613 搜索框出厂为空')
  assert.equal(defaults.scopeFilter, 'all', 'ZCode zh-CN.ts:3633 settings.subagents.filter.all')
})

test('常量逐条对齐 ZCode：颜色 8 值 / 继承别名 5 个 / 名字长度 3..50 / 风险工具 3 个', () => {
  assert.deepEqual([...AGENT_SUBAGENT_COLORS],
    ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan'],
    'ZCode subagentMarkdown.ts:14-23 VALID_COLORS')
  assert.deepEqual([...AGENT_SUBAGENT_INHERIT_MODEL_NAMES], ['inherit', 'main', 'sonnet', 'opus', 'haiku'],
    'ZCode subagent-markdown-selection.ts:8 INHERIT_NAMES')
  assert.equal(AGENT_SUBAGENT_NAME_MIN, 3, 'ZCode SubagentsSection.tsx:929')
  assert.equal(AGENT_SUBAGENT_NAME_MAX, 50, 'ZCode SubagentsSection.tsx:929')
  assert.deepEqual([...AGENT_SUBAGENT_RISKY_TOOLS], ['Bash', 'Edit', 'Write'], 'ZCode SubagentsSection.tsx:99 RISKY_TOOLS')
  assert.equal(AGENT_SUBAGENTS_TITLE, '子智能体', 'ZCode zh-CN.ts:3610 settings.subagents.title')
})

test('状态 id 逐字对齐 ZCode：${source}:${scope}:${name 小写}', () => {
  assert.equal(agentSubagentStateId('user', 'user', '  Worker-X  '), 'user:user:worker-x',
    'ZCode subagents-types.ts:152-158 createAgentStateId')
  assert.equal(agentSubagentStateId('built-in', 'built-in', 'Explore'), 'built-in:built-in:explore')
})

test('定义格式已核实 = Markdown + YAML frontmatter（阳性：能解析；阴性对照：同样内容当 JSON 解析不出来）', () => {
  const markdown = [
    '---',
    'name: "worker-x"',
    'description: "有界产出"',
    'color: blue',
    'model: sonnet',
    'thoughtLevel: high',
    'tools:',
    '  - Bash(git:*)',
    '  - Read',
    'maxTurns: 12',
    'injectAgentsMd: false',
    '---',
    '',
    '你是一个有界产出的 worker。',
  ].join('\n')
  const parsed = parseSubagentMarkdown(markdown, { path: 'agents/worker-x/agent.md', scope: 'user' })
  assert.ok(parsed.agent, '阳性对照：YAML frontmatter Markdown 必须能解析出 agent（ZCode subagentMarkdown.ts:38-103）')
  assert.equal(parsed.agent.name, 'worker-x')
  assert.equal(parsed.agent.id, 'user:user:worker-x')
  assert.equal(parsed.agent.color, 'blue', 'ZCode subagentMarkdown.ts:14-23 + :67 normalizeEnum')
  assert.equal(parsed.agent.maxTurns, 12, 'ZCode subagentMarkdown.ts:308-315 normalizePositiveInteger')
  assert.equal(parsed.agent.injectAgentsMd, false, 'ZCode subagentMarkdown.ts:74')
  assert.equal(parsed.agent.systemPrompt, '你是一个有界产出的 worker。', 'ZCode subagentMarkdown.ts:82 body.trim()')
  // 阴性对照：同一份内容换成 JSON 容器 → 走「没有 frontmatter」诊断，证明解析器真的在读 Markdown。
  const asJson = JSON.stringify({ name: 'worker-x', description: '有界产出' })
  const jsonParsed = parseSubagentMarkdown(asJson, { path: 'agents/worker-x/agent.md' })
  assert.ok(!jsonParsed.agent, '阴性对照：JSON 不是子智能体定义格式，不许悄悄当 JSON 收下')
  assert.equal(jsonParsed.diagnostic.code, 'agent_missing_frontmatter', 'ZCode subagentMarkdown.ts:42-50')
  assert.ok(jsonParsed.diagnostic.message.includes('agents/worker-x/agent.md'), '诊断要带上路径（ZCode :46-47）')
})

test('继承别名不写进 model，工具 pattern 不被逗号/空格切开', () => {
  const parsed = parseSubagentMarkdown([
    '---',
    'name: "inheriter"',
    'description: "继承"',
    'model: sonnet',
    'tools: Bash(git:*), Read  Grep',
    '---',
    'body',
  ].join('\n'), { path: 'a/agent.md' })
  assert.ok(parsed.agent)
  assert.equal(parsed.agent.model, undefined, 'ZCode subagent-markdown-selection.ts:8, 16：继承别名不产生覆盖')
  assert.deepEqual(parsed.agent.tools, ['Bash(git:*)', 'Read', 'Grep'],
    'ZCode subagentMarkdown.ts:332-355 parseToolSpecList：括号深度 0 处的分隔符才切')
})

test('必填字段缺失各给一条诊断（name / description / frontmatter）', () => {
  const noFrontmatter = parseSubagentMarkdown('只是正文', { path: 'x/agent.md' })
  assert.equal(noFrontmatter.diagnostic.code, 'agent_missing_frontmatter', 'ZCode subagentMarkdown.ts:44-49')
  const noName = parseSubagentMarkdown('---\ndescription: "d"\n---\nb', { path: 'x/agent.md' })
  assert.equal(noName.diagnostic.code, 'agent_missing_required_frontmatter', 'ZCode subagentMarkdown.ts:58-60')
  assert.ok(noName.diagnostic.message.includes('name'), '诊断要指名缺哪个字段（ZCode :280-288）')
  const noDescription = parseSubagentMarkdown('---\nname: "n1"\n---\nb', { path: 'x/agent.md' })
  assert.ok(noDescription.diagnostic.message.includes('description'), 'ZCode subagentMarkdown.ts:61-63')
})

test('坏存档逐字段救：非法颜色/轮数丢字段、字符串数组修剪、name 空则丢单条不丢整表', () => {
  const saved = normalizeAgentSubagentsSettings({
    entries: [
      userEntry({ color: 'chartreuse', maxTurns: -3, permissionMode: 'yolo' }),
      userEntry({ name: 'worker-y', tools: ['Read', '  ', 42, 'Bash'] }),
      '不是对象',
      { name: '   ', path: 'x/agent.md' },
    ],
    disabledAgentIds: ['user:user:worker-y', '  ', 7, 'user:user:worker-y'],
  })
  assert.equal(saved.entries.length, 2, '空名那条救不回来 → 丢单条；另外两条留下')
  assert.equal(saved.entries[0].color, undefined, '非法颜色丢字段不报错（ZCode normalizeEnum，:294-297）')
  assert.equal(saved.entries[0].maxTurns, undefined, '非正整数丢字段（ZCode :308-315）')
  assert.equal(saved.entries[0].permissionMode, undefined, '非法权限模式丢字段（ZCode :25, :68）')
  assert.deepEqual(saved.entries[1].tools, ['Read', 'Bash'], '非字符串项丢弃、空串修剪')
  assert.deepEqual(saved.disabledAgentIds, ['user:user:worker-y'], '只留非空字符串并去重（ZCode subagentsService.ts:176-180）')
})

test('enabled 不读存档：一律由 disabledAgentIds 现算，且只对 user scope 生效', () => {
  const saved = normalizeAgentSubagentsSettings({
    entries: [
      userEntry({ name: 'worker-x', enabled: false }),
      userEntry({ name: 'worker-y', scope: 'workspace', enabled: false }),
      { ...userEntry({ name: 'probe' }), scope: 'built-in', source: 'built-in' },
    ],
    disabledAgentIds: ['user:user:worker-x', 'user:workspace:worker-y', 'built-in:built-in:probe'],
  })
  assert.equal(saved.entries[0].enabled, false, 'user scope 在 disabledAgentIds 里 → 停用（ZCode subagentsService.ts:287）')
  assert.equal(saved.entries[1].enabled, true, 'workspace scope 恒 enabled（ZCode :287 只判 user）')
  assert.equal(saved.entries[2].enabled, true, 'built-in 恒 enabled')
  // 阳性对照：同一批条目不在停用表里时全为启用。
  const on = normalizeAgentSubagentsSettings({ entries: [userEntry({ name: 'worker-x', enabled: false })] })
  assert.equal(on.entries[0].enabled, true, '阳性对照：不在停用表里就是启用，不许把存档里的 false 当真')
})

test('校验拦下空名 / 越界名 / 非法字符 / 路径越界', () => {
  const problems = validateAgentSubagentsSettings(normalizeAgentSubagentsSettings({
    entries: [
      userEntry({ name: 'ab' }),
      userEntry({ name: '有中文名' }),
      userEntry({ name: 'escape', path: 'C:\\..\\Windows\\System32\\agent.md' }),
    ],
  }))
  assert.equal(problems.length, 3, `三条硬问题各报一次，实际：${JSON.stringify(problems)}`)
  assert.ok(problems.some((p) => p.includes('ab') && p.includes(String(AGENT_SUBAGENT_NAME_MIN))),
    '短名要报长度区间（ZCode SubagentsSection.tsx:929-936）')
  assert.ok(problems.some((p) => p.includes('有中文名') && p.includes('字母、数字和连字符')),
    '非法字符要报字符集（ZCode :937-943，zh-CN.ts:3672）')
  assert.ok(problems.some((p) => p.includes('escape') && p.includes('越出子智能体目录')),
    '路径越界要当场拦下，不许等到写盘')
  // 阳性对照：一条合法条目零问题 —— 证明上面三条不是「恒真」。
  assert.deepEqual(validateAgentSubagentsSettings(normalizeAgentSubagentsSettings({ entries: [userEntry()] })), [],
    '阳性对照：合法条目不报任何问题')
})

test('校验拦下重名：id 会小写，所以 `dup` 与 `DUP` 撞同一条', () => {
  // normalize **不**去重：静默丢一条会把这个冲突从用户眼前藏起来，交给 validate 当场报。
  const saved = normalizeAgentSubagentsSettings({
    entries: [userEntry({ name: 'dup' }), userEntry({ name: 'dup' }), userEntry({ name: 'DUP' })],
  })
  assert.equal(saved.entries.length, 3, 'normalize 保留三条 —— 去重是 validate 的职责，不是 normalize 的')
  const ids = saved.entries.map((entry) => entry.id)
  assert.deepEqual(ids, ['user:user:dup', 'user:user:dup', 'user:user:dup'],
    'ZCode subagents-types.ts:157：id 用 name 小写，所以大小写不同的同名也撞车')
  const problems = validateAgentSubagentsSettings(saved)
  assert.equal(problems.length, 2, `三条同 id 报两次冲突，实际：${JSON.stringify(problems)}`)
  assert.ok(problems.every((p) => p.includes('重名')), '冲突文案要说清是重名')
  assert.ok(problems.some((p) => p.includes('DUP')), '第三条（DUP）与第二条冲突，要指名它')
  // 阳性对照：名字互不相同则零问题 —— 证明上面不是「恒真」。
  assert.deepEqual(
    validateAgentSubagentsSettings(normalizeAgentSubagentsSettings({
      entries: [userEntry({ name: 'dup' }), userEntry({ name: 'other' })],
    })),
    [],
    '阳性对照：不同名不报冲突',
  )
})

test('校验拦下停用死记录：非 user scope 的 id 运行时不认', () => {
  const builtIn = { ...userEntry({ name: 'probe' }), scope: 'built-in', source: 'built-in', id: 'built-in:built-in:probe' }
  const saved = normalizeAgentSubagentsSettings({ entries: [userEntry(), builtIn], disabledAgentIds: ['built-in:built-in:probe', 'user:user:ghost'] })
  const problems = validateAgentSubagentsSettings(saved)
  assert.equal(problems.length, 2, `两条死记录各报一次，实际：${JSON.stringify(problems)}`)
  assert.ok(problems.some((p) => p.includes('built-in:built-in:probe') && p.includes('运行时不认')),
    '非 user scope 的停用记录是死记录（ZCode SubagentsSection.tsx:140-143 的注释）')
  assert.ok(problems.some((p) => p.includes('user:user:ghost') && p.includes('没有对应')),
    '指向不存在条目的停用记录也要报出来')
  // 阳性对照：合法停用记录零问题。
  const ok = normalizeAgentSubagentsSettings({ entries: [userEntry()], disabledAgentIds: ['user:user:worker-x'] })
  assert.deepEqual(validateAgentSubagentsSettings(ok), [], '阳性对照：user scope 的停用记录是有效的')
})

test('存储往返：save → load 读回同一份（含条目、停用表、模型覆盖、筛选）', () => {
  const storage = createMemoryStorage()
  const settings = defaultAgentSubagentsSettings()
  settings.entries = [userEntry({ color: 'cyan', tools: ['Read'], model: 'zai/glm', thoughtLevel: 'high' })]
  settings.disabledAgentIds = ['user:user:worker-x']
  settings.modelOverrides = { 'user:user:worker-x': { model: 'zai/glm', thoughtLevel: 'high' } }
  settings.query = 'worker'
  settings.scopeFilter = 'disabled'
  assert.equal(saveAgentSubagentsSettings(settings, storage), true, '内存存储必须写成功')
  assert.ok(storage.dump()[AGENT_SUBAGENTS_STORAGE_KEY], `存档必须落在 ${AGENT_SUBAGENTS_STORAGE_KEY} 上`)
  const back = loadAgentSubagentsSettings(storage)
  assert.equal(back.entries.length, 1)
  assert.equal(back.entries[0].color, 'cyan')
  assert.deepEqual(back.entries[0].tools, ['Read'])
  assert.equal(back.entries[0].enabled, false, '往返后仍由停用表算出停用')
  assert.deepEqual(back.disabledAgentIds, ['user:user:worker-x'])
  assert.deepEqual(back.modelOverrides, { 'user:user:worker-x': { model: 'zai/glm', thoughtLevel: 'high' } })
  assert.equal(back.query, 'worker')
  assert.equal(back.scopeFilter, 'disabled')
})

test('无存储 / 抛异常存储 / 非 JSON 存档都静默降级到合法默认值', () => {
  const fromNull = loadAgentSubagentsSettings(null)
  assert.deepEqual(fromNull, defaultAgentSubagentsSettings(), '没有存储 = 出厂默认，不是崩')
  const fromThrowing = loadAgentSubagentsSettings(createThrowingStorage())
  assert.deepEqual(fromThrowing, defaultAgentSubagentsSettings(), 'getItem 抛异常 = 静默降级（store 的 try/catch）')
  const fromGarbage = loadAgentSubagentsSettings(createMemoryStorage({ [AGENT_SUBAGENTS_STORAGE_KEY]: '{不是 json' }))
  assert.deepEqual(fromGarbage, defaultAgentSubagentsSettings(), '坏 JSON 退回默认，不把用户锁在设置外')
  assert.equal(saveAgentSubagentsSettings(defaultAgentSubagentsSettings(), null), false, '存不下只丢持久化')
  assert.equal(saveAgentSubagentsSettings(defaultAgentSubagentsSettings(), createThrowingStorage()), false, 'setItem 抛异常也只丢持久化')
  // 阳性对照：同一份存储正常时读得到东西。
  const good = createMemoryStorage()
  saveAgentSubagentsSettings({ ...defaultAgentSubagentsSettings(), query: 'q' }, good)
  assert.equal(loadAgentSubagentsSettings(good).query, 'q', '阳性对照：存储可用时往返成立')
})

test('能力投影：启用开关只给 user scope；工具文案三档；插件 pattern 原样保留', () => {
  const user = subagentCapabilities(normalizeAgentSubagentsSettings({ entries: [userEntry({ tools: ['Read', 'Bash(git:*)'] })] }).entries[0])
  assert.equal(user.supportsEnabledToggle, true, 'ZCode SubagentsSection.tsx:144-146：user scope 可编辑且可切换')
  assert.equal(user.group, 'user', 'ZCode :375-387 groupAgentsByScope')
  assert.equal(user.knownTools.length, 1, 'ZCode :167-169：只把命中候选的算 known')
  assert.deepEqual(user.preservedTools, ['Bash(git:*)'], 'ZCode :171-173：候选之外的 pattern 不许静默丢掉')
  assert.equal(user.toolLabel, '2 个工具', 'ZCode zh-CN.ts:3642 toolsCount')

  const workspace = subagentCapabilities(normalizeAgentSubagentsSettings({ entries: [userEntry({ scope: 'workspace' })] }).entries[0])
  assert.equal(workspace.supportsEnabledToggle, false, 'workspace scope 恒无开关（ZCode :140-143：点了会静默回弹）')
  assert.equal(workspace.editable, true, 'workspace + source=user 仍可编辑（ZCode :132-138）')

  const plugin = subagentCapabilities(normalizeAgentSubagentsSettings({
    entries: [{ ...userEntry({ name: 'p1' }), source: 'plugin', scope: 'user' }],
  }).entries[0])
  assert.equal(plugin.group, 'plugin', 'ZCode :380-381 source=plugin 走插件分组')
  assert.equal(plugin.supportsModelOverride, true, 'ZCode :156-158：插件 agent 有行内模型覆盖')

  const builtIn = subagentCapabilities(normalizeAgentSubagentsSettings({
    entries: [{ ...userEntry({ name: 'Explore' }), source: 'built-in', scope: 'built-in' }],
  }).entries[0])
  assert.equal(builtIn.group, 'builtIn')
  assert.equal(builtIn.builtInSubagentName, 'Explore', 'ZCode :160-165 只认 general-purpose / Explore')
  assert.equal(builtIn.readOnly, true, 'ZCode subagentMarkdown.ts:100')
  assert.equal(builtIn.supportsEnabledToggle, false)

  // 工具文案三档（ZCode zh-CN.ts:3643-3644 + SubagentsSection.tsx:185-188）
  assert.equal(subagentCapabilities(normalizeAgentSubagentsSettings({ entries: [userEntry({ tools: [] })] }).entries[0]).toolLabel, '继承工具',
    'tools 空数组 = 继承（ZCode :314）')
  assert.equal(subagentCapabilities(normalizeAgentSubagentsSettings({ entries: [userEntry({ tools: ['*'] })] }).entries[0]).toolLabel, '全部工具',
    'ZCode :185-188：通配符 * 显示成「全部工具」而不是「1 个工具」')
  assert.equal(allowsAllTools(['*']), true, 'ZCode :187')
  assert.equal(allowsAllTools(['Read']), false)
  assert.equal(mergeSubagentTools(['Read'], [])?.length, 1, 'ZCode :175-183')
  assert.equal(mergeSubagentTools([], []), undefined, 'ZCode :182：空数组折回 undefined')
})
