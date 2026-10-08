// 「记忆」节判据（ZCode section id `memory`）—— 形状、坏档救回、校验、往返、降级。
//
// 判据里引的 ZCode 出处都能在 `.tools/ZCode` 指到：
//   · MemorySettingsSection.tsx:157-176  「工作区记忆」总开关那一行
//   · validationAppSettings.ts:464      `memoryEnabled: z.boolean().default(false)`
//   · protocol.ts:324-325               「新建或冷恢复 Session 是否启用 Memory；默认关闭」
//   · MemorySettingsViewer.tsx:94-151   查看器（条数/搜索/刷新/文件列表）
//   · MemorySettingsViewer.tsx:96       `includeUser={false}`（不含用户档）
//   · memory.ts:8-22 / :24-33           清单形状与 IMemoryService（本仓没有这条通道）
//   · memoryService.ts:11-12            项目记忆叫 MEMORY.md、目录叫 memory
//   · projectMemoryStableRead.ts:8      5 MiB 预览上限（不是注入上限）
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_MEMORY_FILES_STORAGE_KEY,
  AGENT_MEMORY_PATH_TEMPLATES,
  AGENT_MEMORY_SCOPES,
  agentMemoryScopeLabel,
  clipMemoryText,
  defaultAgentMemoryFiles,
  injectedMemoryFiles,
  loadAgentMemoryFiles,
  normalizeAgentMemoryFiles,
  resolveAgentMemoryFilePath,
  saveAgentMemoryFiles,
  validateAgentMemoryFiles,
} from '../src/agentMemoryFiles.ts'
import { createMemoryStorage, createThrowingStorage } from '../src/agentSettingsStore.ts'

test('存储键与三档作用域（ZCode settingsPageConfig.ts:76-81 的 memory 节）', () => {
  assert.equal(AGENT_MEMORY_FILES_STORAGE_KEY, 'taocode.agent.memoryFiles')
  assert.deepEqual([...AGENT_MEMORY_SCOPES], ['workspace', 'user', 'agent'])
  assert.equal(agentMemoryScopeLabel('workspace'), '工作区')
  assert.equal(agentMemoryScopeLabel('user'), '用户')
  assert.equal(agentMemoryScopeLabel('agent'), '智能体')
})

test('出厂默认逐字对齐 ZCode：总开关 false，协议注释也是「默认关闭」', () => {
  const defaults = defaultAgentMemoryFiles()
  // ZCode：validationAppSettings.ts:464 `memoryEnabled: z.boolean().default(false)`
  assert.equal(defaults.enabled, false, 'ZCode 出厂 memoryEnabled = false')
  // protocol.ts:324-325：「新建或冷恢复 Session 是否启用 Memory；默认关闭」
  assert.equal(defaultAgentMemoryFiles().enabled, false, '与 ZCode 协议默认一致')
  assert.equal(validateAgentMemoryFiles(defaults).length, 0, '出厂默认必须能保存')
})

test('出厂清单只放本机实测存在的那条用户级记忆文件', () => {
  const defaults = defaultAgentMemoryFiles()
  // 2026-10-07 实测 C:\Users\Administrator\.minimax\memory\user.md 存在
  assert.equal(defaults.files.length, 1)
  assert.equal(defaults.files[0].scope, 'user')
  assert.equal(defaults.files[0].path, '~/.minimax/memory/user.md')
  assert.equal(defaults.files[0].sizeLimitChars, 0, '0 = 不限；ZCode 这一节没有注入上限控件')
  // 工作区级 AGENTS.md 本仓不存在（实测），所以出厂清单里没有 workspace 条目
  assert.equal(defaults.files.some(entry => entry.scope === 'workspace'), false)
})

test('大小上限出厂 0 而不是抄 ZCode 的 5 MiB（那是预览上限）', () => {
  // ZCode 唯一的大小限制是预览上限：projectMemoryStableRead.ts:8
  // `PROJECT_MEMORY_PREVIEW_MAX_BYTES = 5 * 1024 * 1024`，与注入无关。
  const defaults = defaultAgentMemoryFiles()
  assert.ok(defaults.files.every(entry => entry.sizeLimitChars === 0))
  assert.notEqual(defaults.files[0].sizeLimitChars, 5 * 1024 * 1024, '不许把预览上限冒充成注入上限')
})

test('坏存档逐字段救：缺键补默认、错类型退默认、垃圾条目只丢自己', () => {
  const saved = normalizeAgentMemoryFiles({ files: [
    '不是对象',
    { path: 'AGENTS.md', scope: 'workspace' },
    { path: '', scope: 'user' },
    null,
  ] })
  // 阳性对照：合法条目活下来了（否则「只丢垃圾」这条判据可能是「全丢」也能通过）
  assert.equal(saved.files.length, 1, '合法条目必须保留')
  assert.equal(saved.files[0].path, 'AGENTS.md')
  assert.equal(saved.files[0].scope, 'workspace', '缺 enabled 按「参与注入」处理')
  assert.equal(saved.enabled, false, '缺总开关退 ZCode 出厂值')
})

test('坏存档逐字段救：非法作用域/负上限/非有限数各退该字段默认', () => {
  const saved = normalizeAgentMemoryFiles({ enabled: 'yes', files: [
    { scope: '宇宙级', path: 'a.md', sizeLimitChars: -5 },
    { scope: 'user', path: 'b.md', sizeLimitChars: Number.POSITIVE_INFINITY },
    { scope: 'agent', path: 'c.md', sizeLimitChars: 10.7 },
  ] })
  assert.equal(saved.enabled, false, '非布尔的总开关退默认')
  assert.equal(saved.files.length, 3, '三条都合法，只是字段坏')
  assert.equal(saved.files[0].scope, 'user', '非法作用域退 user')
  assert.equal(saved.files[0].sizeLimitChars, 0, '负数退 0（不限）')
  assert.equal(saved.files[1].sizeLimitChars, 0, 'Infinity 退 0')
  assert.equal(saved.files[2].sizeLimitChars, 10, '小数向下取整')
})

test('坏存档逐字段救：重复路径只留第一条（哪条生效说不清就是坏数据）', () => {
  const saved = normalizeAgentMemoryFiles({ files: [
    { scope: 'user', path: '~/.minimax/memory/user.md' },
    { scope: 'agent', path: '~/.minimax/memory/user.md', enabled: false },
  ] })
  assert.equal(saved.files.length, 1)
  assert.equal(saved.files[0].scope, 'user', '留的是第一条')
})

test('坏存档逐字段救：反斜杠归一成 / 、两端空白去掉', () => {
  const saved = normalizeAgentMemoryFiles({ files: [{ scope: 'user', path: '  C:\\Users\\me\\.minimax\\memory\\user.md  ' }] })
  assert.equal(saved.files[0].path, 'C:/Users/me/.minimax/memory/user.md')
})

test('校验拦下非法输入：空路径 / 目录尾 / 重复 / 负上限 / 非整数 / 坏作用域', () => {
  const problems = validateAgentMemoryFiles({
    enabled: true,
    files: [
      { scope: 'workspace', path: '   ', enabled: true, sizeLimitChars: 0 },
      { scope: 'user', path: 'notes/', enabled: true, sizeLimitChars: 0 },
      { scope: 'user', path: 'a.md', enabled: true, sizeLimitChars: -1 },
      { scope: 'user', path: 'a.md', enabled: true, sizeLimitChars: 1.5 },
      { scope: 'user', path: 'a.md', enabled: true, sizeLimitChars: 0 },
      { scope: '宇宙级', path: 'b.md', enabled: true, sizeLimitChars: 0 },
      { scope: 'user', path: 'mid~dle.md', enabled: true, sizeLimitChars: 0 },
    ],
  })
  assert.ok(problems.length >= 6, `至少 6 条问题，实际 ${problems.length}`)
  assert.ok(problems.some(text => text.includes('路径不能为空')))
  assert.ok(problems.some(text => text.includes('不能以 / 结尾')))
  assert.ok(problems.some(text => text.includes('非负整数')))
  assert.ok(problems.some(text => text.includes('同一个文件')))
  assert.ok(problems.some(text => text.includes('作用域只能是')))
  assert.ok(problems.some(text => text.includes('~ 只能出现在路径开头')))
  // 阳性对照：合法的一份必须零问题（否则上面那些「拦下」可能只是全部乱报）
  assert.deepEqual(validateAgentMemoryFiles({
    enabled: true,
    files: [{ scope: 'agent', path: '~/.minimax/agents/worker/memory/MEMORY.md', enabled: true, sizeLimitChars: 4096 }],
  }), [])
})

test('存储往返：写进去读回来是同一份', () => {
  const storage = createMemoryStorage()
  const settings = defaultAgentMemoryFiles()
  settings.enabled = true
  settings.files = [
    { scope: 'workspace', path: 'AGENTS.md', enabled: true, sizeLimitChars: 20_000 },
    { scope: 'agent', path: '~/.minimax/agents/worker/memory/MEMORY.md', enabled: false, sizeLimitChars: 0 },
  ]
  assert.equal(saveAgentMemoryFiles(settings, storage), true, '落盘成功必须返回 true')
  assert.ok(storage.dump()[AGENT_MEMORY_FILES_STORAGE_KEY], '存档落在自己那个键上')
  const back = loadAgentMemoryFiles(storage)
  assert.equal(back.enabled, true)
  assert.equal(back.files.length, 2)
  assert.deepEqual(back.files[1], { scope: 'agent', path: '~/.minimax/agents/worker/memory/MEMORY.md', enabled: false, sizeLimitChars: 0 })
})

test('无存储 / 抛异常存储时静默降级：不抛、给默认、save 返回 false', () => {
  assert.deepEqual(loadAgentMemoryFiles(null), defaultAgentMemoryFiles(), '没有存储也给合法默认值')
  assert.equal(saveAgentMemoryFiles(defaultAgentMemoryFiles(), null), false, '存不下要说没落盘')
  const throwing = createThrowingStorage()
  assert.deepEqual(loadAgentMemoryFiles(throwing), defaultAgentMemoryFiles(), 'getItem 抛也要退默认')
  assert.equal(saveAgentMemoryFiles(defaultAgentMemoryFiles(), throwing), false, 'setItem 抛要说没落盘')
})

test('存档里是坏 JSON 时也退默认（不许把用户锁在设置外）', () => {
  const storage = createMemoryStorage({ [AGENT_MEMORY_FILES_STORAGE_KEY]: '{ 这不是 JSON' })
  assert.deepEqual(loadAgentMemoryFiles(storage), defaultAgentMemoryFiles())
})

test('参与注入：总开关关 ⇒ 一条都不参与；开 ⇒ 只留启用的', () => {
  const settings = defaultAgentMemoryFiles()
  settings.files = [
    { scope: 'user', path: 'user.md', enabled: true, sizeLimitChars: 0 },
    { scope: 'agent', path: 'agent.md', enabled: false, sizeLimitChars: 0 },
  ]
  assert.deepEqual(injectedMemoryFiles(settings), [], '总开关关 = 全部不注入')
  settings.enabled = true
  assert.equal(injectedMemoryFiles(settings).length, 1, '阳性对照：开着时只有启用的那条')
  assert.equal(injectedMemoryFiles(settings)[0].path, 'user.md')
})

test('~ 展开：带 ~ 的展开，不带 ~ 的原样返回', () => {
  // 阳性对照：没有 ~ 的绝对路径不许被改写
  assert.equal(resolveAgentMemoryFilePath('C:/work/AGENTS.md', 'C:/Users/me'), 'C:/work/AGENTS.md')
  assert.equal(resolveAgentMemoryFilePath('C:/work/AGENTS.md', 'C:/Users/me'), 'C:/work/AGENTS.md')
  assert.equal(resolveAgentMemoryFilePath('~/.minimax/memory/user.md', 'C:/Users/me'), 'C:/Users/me/.minimax/memory/user.md')
  assert.equal(resolveAgentMemoryFilePath('~', 'C:/Users/me'), 'C:/Users/me')
})

test('大小上限截断：超了截断并标注，没超与 0（不限）都原样返回', () => {
  const long = 'x'.repeat(100)
  const clipped = clipMemoryText(long, 10)
  assert.equal(clipped.truncated, true)
  assert.ok(clipped.text.startsWith('x'.repeat(10)))
  assert.ok(clipped.text.includes('已按上限 10 字符截断'))
  // 阳性对照 1：没超上限不许截
  assert.deepEqual(clipMemoryText(long, 100), { text: long, truncated: false })
  // 阳性对照 2：0 = 不限（出厂值），不许悄悄截断
  assert.deepEqual(clipMemoryText(long, 0), { text: long, truncated: false })
})

test('路径模板表：三档都在，且智能体那档留了占位符而不是写死名字', () => {
  assert.deepEqual(AGENT_MEMORY_PATH_TEMPLATES.map(item => item.scope), ['workspace', 'user', 'agent'])
  const agentTemplate = AGENT_MEMORY_PATH_TEMPLATES.find(item => item.scope === 'agent')
  assert.ok(agentTemplate.template.includes('<name>'), '出厂不许写死某个智能体名')
  assert.ok(agentTemplate.template.endsWith('/memory/MEMORY.md'), '与本机实测的 agents/<name>/memory/MEMORY.md 同形')
})