// 外部工具的完整 bean 字段 + 本仓的持久化通道 + 菜单消费。
// 上游依据：`platform/lang-impl/src/com/intellij/tools/Tool.java:56-77`（16 个 bean 字段）、
// `ToolEditorDialog.java:103-119`（getData 写回的字段）/ `:137-158`（setData 读出的字段）、
// `BaseToolsPanel.java:116`（新建工具 enabled=true）/ `:248`/`:270`（列表里的启用勾选框）、
// `BaseToolManager.java:89-113`（每个 ToolsGroup 一个 delegate group）/ `:164`（停用不进菜单）、
// `ToolEditorDialogPanel.kt:135`（过滤式必须含 `RegexpFilter.FILE_PATH_MACROS`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_TOOL_GROUP, TOOL_DETAIL_STORAGE_KEY, defaultToolDetail, dropToolDetail,
  enabledToolRecords, groupToolRecords, hostCommandOf, outputFiltersMissingFilePathMacro,
  patchToolDetail, reloadToolDetails, renameToolDetail, replaceToolDetails, splitToolCommand,
  toolRecords, toolRecordsFrom, withToolDetailDefaults,
} from '../src/externalToolsRecords.ts'
import { createToolsMenuRows } from '../src/menus/toolsMenu.ts'

test('缺省值照抄上游：分组 = external.tools、新建即启用（BaseToolsPanel.java:116）', () => {
  const base = defaultToolDetail()
  assert.equal(base.group, DEFAULT_TOOL_GROUP)
  assert.equal(base.enabled, true)
  assert.equal(base.description, '')
  assert.deepEqual(base.outputFilters, [])
  // 「Open console for tool output」勾选时，stderr 那一档默认开着（IDEA 新建工具的初值），
  // stdout 档关着；两者都只在 useConsole 为真时可用（ToolEditorDialog.java:149,151）。
  assert.equal(base.useConsole, true)
  assert.equal(base.showConsoleOnStdErr, true)
  assert.equal(base.showConsoleOnStdOut, false)
  // 四个 shownIn* 在上游是「effectively not used anymore」（Tool.java:60-61），本仓同样取 false。
  assert.equal(base.shownInMainMenu, false)
  assert.equal(base.shownInEditor, false)
  assert.equal(base.shownInProjectViews, false)
  assert.equal(base.shownInSearchResultsPopup, false)
})

test('旧存档补默认值：缺键不判损坏、错类型回落（新增字段必须让老数据继续可用）', () => {
  const partial = withToolDetailDefaults({ group: '格式化', enabled: false })
  assert.equal(partial.group, '格式化')
  assert.equal(partial.enabled, false)
  assert.equal(partial.useConsole, true, '没写这个键时按缺省补，不是整份作废')
  assert.equal(withToolDetailDefaults({ group: 42 }).group, DEFAULT_TOOL_GROUP, '类型不对就回落')
  assert.equal(withToolDetailDefaults({ enabled: 'yes' }).enabled, true)
  assert.equal(withToolDetailDefaults(null).group, DEFAULT_TOOL_GROUP)
  assert.equal(withToolDetailDefaults([]).enabled, true)
  // 分组存空串回落缺省分组（上游 `Tool.setGroup`：空 → DEFAULT_GROUP_NAME，Tool.java:144）
  assert.equal(withToolDetailDefaults({ group: '' }).group, DEFAULT_TOOL_GROUP)
  // 过滤式：非字符串与空串都丢掉，其余原样保留
  assert.deepEqual(withToolDetailDefaults({ outputFilters: ['ok', '', 7, ' x ' ] }).outputFilters, ['ok', ' x '])
})

test('command 的反向拆解（Tool.java:75-76 的两段 ← 本仓的一条命令串）', () => {
  assert.deepEqual(splitToolCommand('clang-format -i $FilePath$'), { program: 'clang-format', parameters: '-i $FilePath$' })
  assert.deepEqual(splitToolCommand('"C:\\Program Files\\x.exe" -q'), { program: '"C:\\Program Files\\x.exe"', parameters: '-q' })
  assert.deepEqual(splitToolCommand('only-program'), { program: 'only-program', parameters: '' })
  assert.deepEqual(splitToolCommand(''), { program: '', parameters: '' })
})

test('宿主条目 + 详情表合流：填过程序/参数就用填的，没填过才拆命令', () => {
  const entries = [{ name: 'fmt', command: 'clang-format -i $FilePath$' }]
  const inferred = toolRecordsFrom(entries, {})
  assert.equal(inferred[0].program, 'clang-format')
  assert.equal(inferred[0].parameters, '-i $FilePath$')
  assert.equal(inferred[0].enabled, true)
  assert.equal(inferred[0].group, DEFAULT_TOOL_GROUP)
  const filled = toolRecordsFrom(entries, { fmt: withToolDetailDefaults({ program: 'sh', parameters: '-c x' }) })
  assert.equal(filled[0].program, 'sh')
  assert.equal(filled[0].parameters, '-c x')
  // 详情表里写了 program 但没写 parameters 时不回填命令串的那半（免得半新半旧）；
  // 「第一次建详情」的 seed 由 patchToolDetail 负责，见下面那条用例。
  const half = toolRecordsFrom(entries, { fmt: withToolDetailDefaults({ program: 'sh' }) })
  assert.equal(half[0].program, 'sh')
  assert.equal(half[0].parameters, '')
})

test('hostCommandOf 把 program + parameters 投影回宿主那一条', () => {
  const record = toolRecordsFrom([{ name: 'x', command: 'a b' }], {})[0]
  assert.equal(hostCommandOf(record), 'a b')
  assert.equal(hostCommandOf({ ...record, program: '  clang-format  ', parameters: ' -i $FilePath$ ' }), 'clang-format -i $FilePath$')
  assert.equal(hostCommandOf({ ...record, program: '', parameters: '' }), '')
})

test('菜单可见性与分组（BaseToolManager.java:164 与 :89-113）', () => {
  const entries = [{ name: 'a', command: 'x' }, { name: 'b', command: 'y' }, { name: 'c', command: 'z' }]
  const details = {
    a: withToolDetailDefaults({ group: '格式化' }),
    b: withToolDetailDefaults({ group: '格式化', enabled: false }),
    c: withToolDetailDefaults({ group: DEFAULT_TOOL_GROUP }),
  }
  const records = toolRecordsFrom(entries, details)
  assert.deepEqual(enabledToolRecords(records).map(r => r.name), ['a', 'c'], '停用的那条不进菜单')
  const groups = groupToolRecords(enabledToolRecords(records))
  assert.deepEqual(groups.map(g => [g.group, g.tools.map(t => t.name)]), [['格式化', ['a']], [DEFAULT_TOOL_GROUP, ['c']]])
  // 组顺序 = 首次出现顺序（上游 getGroups() 就是列表本身，BaseToolManager.java:76）
  const reordered = groupToolRecords([{ ...records[2], group: '尾巴' }, { ...records[0], group: '格式化' }, { ...records[1], group: '尾巴' }])
  assert.deepEqual(reordered.map(g => [g.group, g.tools.map(t => t.name)]), [['尾巴', ['c', 'b']], ['格式化', ['a']]])
  assert.deepEqual(groupToolRecords([]), [])
})

test('输出过滤式必须含 $FILE_PATH$（ToolEditorDialogPanel.kt:135 引 FILE_PATH_MACROS）', () => {
  assert.deepEqual(outputFiltersMissingFilePathMacro(['$FILE_PATH$@l@c: (.*)']), [])
  assert.deepEqual(outputFiltersMissingFilePathMacro(['^(.+):(\\d+):(\\d+): (.*)$']), ['^(.+):(\\d+):(\\d+): (.*)$'], '纯正则里没有 $FILE_PATH$ 就是不合规')
  assert.deepEqual(outputFiltersMissingFilePathMacro(['WARN', '$FILE_PATH$ x']), ['WARN'])
  assert.deepEqual(outputFiltersMissingFilePathMacro([]), [])
})

test('第一次建详情时按当前 command 落 program/parameters 的初值（不 seed 就会丢参数）', () => {
  replaceToolDetails({})
  const detail = patchToolDetail('fmt', { group: '格式化' }, 'clang-format -i $FilePath$')
  assert.equal(detail.group, '格式化')
  assert.equal(detail.program, 'clang-format')
  assert.equal(detail.parameters, '-i $FilePath$')
  // 已经有详情时不再 seed（用户清空 program 就是真空了）
  const second = patchToolDetail('fmt', { program: '' }, '别的命令')
  assert.equal(second.program, '')
  assert.equal(second.parameters, '-i $FilePath$')
  replaceToolDetails({})
})

test('详情表：改名搬键、删除清键、未知键回落缺省', () => {
  replaceToolDetails({ old: withToolDetailDefaults({ description: '说明' }) })
  assert.equal(toolRecords([{ name: 'old', command: 'x' }])[0].description, '说明')
  renameToolDetail('old', 'new')
  assert.equal(toolRecords([{ name: 'old', command: 'x' }])[0].description, '', '旧键已经搬走')
  assert.equal(toolRecords([{ name: 'new', command: 'x' }])[0].description, '说明')
  // 改名撞到已有详情时不覆盖
  patchToolDetail('other', { description: '别的' })
  renameToolDetail('new', 'other')
  assert.equal(toolRecords([{ name: 'other', command: 'x' }])[0].description, '别的')
  dropToolDetail('other')
  assert.equal(toolRecords([{ name: 'other', command: 'x' }])[0].description, '')
  dropToolDetail('不存在')
  assert.equal(patchToolDetail('fresh', { group: 'G' }).group, 'G')
})

test('存档里的详情表重读一次仍是同一份（localStorage 往返 + 缺键补默认）', () => {
  const store = new Map()
  globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key),
  }
  replaceToolDetails({ fmt: withToolDetailDefaults({ group: '格式化', outputFilters: ['^$FILE_PATH$:\\d+$'] }) })
  assert.ok(store.get(TOOL_DETAIL_STORAGE_KEY).includes('格式化'))
  reloadToolDetails()
  const [reloaded] = toolRecords([{ name: 'fmt', command: 'clang-format' }])
  assert.equal(reloaded.group, '格式化')
  assert.deepEqual(reloaded.outputFilters, ['^$FILE_PATH$:\\d+$'])
  // 老存档只有几个键：其余按缺省补，不能整份丢掉
  store.set(TOOL_DETAIL_STORAGE_KEY, JSON.stringify({ fmt: { enabled: false } }))
  reloadToolDetails()
  const [legacy] = toolRecords([{ name: 'fmt', command: 'clang-format' }])
  assert.equal(legacy.enabled, false)
  assert.equal(legacy.group, DEFAULT_TOOL_GROUP)
  // 坏数据：详情表整个当空，name/command 那条主表不受影响
  store.set(TOOL_DETAIL_STORAGE_KEY, '{not json')
  reloadToolDetails()
  assert.equal(toolRecords([{ name: 'fmt', command: 'clang-format' }])[0].program, 'clang-format')
  delete globalThis.localStorage
})

test('「工具 › 外部工具」子菜单按分组/启用生成（childrenOf 每次展开都重算）', () => {
  let entries = [{ name: 'a', command: 'x' }, { name: 'b', command: 'y' }]
  replaceToolDetails({
    a: withToolDetailDefaults({ group: '格式化', description: '格式化当前文件' }),
    b: withToolDetailDefaults({ group: DEFAULT_TOOL_GROUP }),
  })
  const runs = []
  const ctx = {
    isDesktop: true, hasWorkspace: () => true,
    externalTools: () => entries,
    runExternalTool: (command, name) => runs.push([command, name]),
    openEndpoints: () => {}, showOutput: () => {}, showView: () => {},
  }
  const row = createToolsMenuRows(ctx).find(item => item.id === 'tools.externalTools')
  assert.equal(typeof row.childrenOf, 'function', '子菜单要能随详情表变化')
  const children = row.childrenOf()
  assert.deepEqual(children.map(item => item.id), ['tools.external.group.格式化', `tools.external.b`])
  const grouped = children[0].children
  assert.deepEqual(grouped.map(item => item.title), ['a'])
  assert.match(grouped[0].keywords, /格式化当前文件/, '说明进 keywords（MenuRow 没有 description 槽位）')
  grouped[0].run()
  assert.deepEqual(runs, [['x', 'a']], '跑的是宿主那条 command')
  // 全部停用 ⇒ 父项自己不可用（enabled 谓词）
  replaceToolDetails({ a: withToolDetailDefaults({ enabled: false }), b: withToolDetailDefaults({ enabled: false }) })
  assert.equal(row.enabled(), false)
  assert.deepEqual(row.childrenOf(), [])
  entries = []
  assert.equal(row.enabled(), false)
})
