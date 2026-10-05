// 外部工具结构化模型（`src/externalToolsModel.ts`）：上游 `Tool` bean 的字段清单与落点状态、
// 逐条校验、宏插入与宏用法扫描、输出过滤式的串拆。
// 上游依据：`Tool.java:57-76`（bean 字段）、`Tool.java:83,87,91`（getter）、
// `ToolEditorDialog.java:118`（一串 → FilterInfo[]）、`:137-138,155-158`（编辑面字段与顺序）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EXTERNAL_TOOL_EDITOR_FIELD_ORDER, EXTERNAL_TOOL_FIELDS, danglingToolDollars, firstToolMacro,
  insertToolMacro, joinOutputFilters, splitOutputFilters, toolMacroTokens, toolMacroUses,
  validatedTools, validateExternalTool,
} from '../src/externalToolsModel.ts'
import { TOOL_MACROS } from '../src/toolMacros.ts'

const KNOWN = TOOL_MACROS.map(macro => macro.name)

test('上游 Tool 字段清单逐条对上 Tool.java 的行号', () => {
  const byField = new Map(EXTERNAL_TOOL_FIELDS.map(item => [item.field, item]))
  assert.equal(byField.size, EXTERNAL_TOOL_FIELDS.length, '字段不重复')
  for (const [field, upstream] of [
    ['myName', 'Tool.java:83'], ['myDescription', 'Tool.java:57,87'], ['myGroup', 'Tool.java:91,399'],
    ['myShownInMainMenu', 'Tool.java:62'], ['myShownInEditor', 'Tool.java:63'],
    ['myShownInProjectViews', 'Tool.java:64'], ['myShownInSearchResultsPopup', 'Tool.java:65'],
    ['myWorkingDirectory', 'Tool.java:74'], ['myProgram', 'Tool.java:75'], ['myParameters', 'Tool.java:76'],
    ['myUseConsole', 'Tool.java:69'], ['myShowConsoleOnStdOut', 'Tool.java:70'],
    ['myShowConsoleOnStdErr', 'Tool.java:71'], ['mySynchronizeAfterExecution', 'Tool.java:72'],
  ]) {
    const item = byField.get(field)
    assert.ok(item, `${field} 应当登记在册`)
    assert.equal(item.upstream, upstream, `${field} 的上游坐标`)
  }
  assert.equal(byField.get('myName').persisted, true)
  assert.equal(byField.get('myProgram').persisted, true, 'program+parameters 合成一条 command')
  assert.equal(byField.get('myParameters').persisted, true)
  // 「存得下」两档都成立：宿主 `{name, command}` + `src/externalToolsRecords.ts` 的详情表。
  for (const item of EXTERNAL_TOOL_FIELDS) {
    assert.equal(item.persisted, true, `${item.field} 现在都存得下（宿主两键 + 详情表）`)
    assert.equal(item.blocker, '', '没有存不下的字段，就不该留卡点文案')
    // 每条都要写清「谁在读」；没有运行时消费者的那条必须写清缺哪一层（不能是空话）。
    assert.ok(item.consumer.length > 20, `${item.field} 的消费方/卡点要写出来`)
    if (!item.consumed) assert.match(item.consumer, /接线请求|消费|没有|属桶|依赖|禁改/, `${item.field} 的卡点要指到具体的那一层`)
  }
})

test('编辑面字段顺序照抄 ToolEditorDialog.java:137-138,155-158', () => {
  assert.deepEqual(EXTERNAL_TOOL_EDITOR_FIELD_ORDER, ['name', 'description', 'workingDirectory', 'program', 'arguments', 'outputFilters'])
})

test('输出过滤式的串与拆（ToolEditorDialog.java:118 的 FilterInfo 映射、:158 的 joiner）', () => {
  assert.equal(joinOutputFilters(['^\\[main\\]', 'DEBUG']), '^\\[main\\];DEBUG')
  assert.equal(joinOutputFilters(['', 'DEBUG', '']), 'DEBUG')
  assert.equal(joinOutputFilters([]), '')
  assert.deepEqual(splitOutputFilters('^\\[main\\]; DEBUG ;; WARN'), ['^\\[main\\]', 'DEBUG', 'WARN'])
  assert.deepEqual(splitOutputFilters(''), [])
  assert.deepEqual(splitOutputFilters(joinOutputFilters(['a', 'b'])), ['a', 'b'], '串拆可逆')
})

test('宏插入：落在光标处，带参宏保留括号', () => {
  assert.deepEqual(insertToolMacro('clang-format -i ', 'FilePath', 16), { command: 'clang-format -i $FilePath$', caret: 26 })
  assert.deepEqual(insertToolMacro('', 'ProjectName', 0), { command: '$ProjectName$', caret: 13 })
  assert.deepEqual(insertToolMacro('echo x', 'LineNumber', 99), { command: 'echo x$LineNumber$', caret: 18 }, '越界的 caret 夹到末尾')
  assert.deepEqual(insertToolMacro('echo x', 'FileDirPathFromParent', 5), { command: 'echo $FileDirPathFromParent$x', caret: 28 })
  // 设置页的「插入宏」按钮对带参宏补一个左括号，右括号与参数留给用户接着打
  assert.deepEqual(insertToolMacro('echo x', 'FileDirPathFromParent(', 6), { command: 'echo x$FileDirPathFromParent($', caret: 30 })
})

test('宏用法扫描：token、名字、参数与位置', () => {
  const command = 'a $FilePath$ b $FileDirPathFromParent(src)$ c'
  assert.deepEqual(toolMacroTokens(command), ['$FilePath$', '$FileDirPathFromParent(src)$'])
  const uses = toolMacroUses(command)
  assert.equal(uses.length, 2)
  assert.equal(uses[0].name, 'FilePath')
  assert.equal(uses[0].argument, '')
  assert.equal(command.slice(uses[0].start, uses[0].end), '$FilePath$')
  assert.equal(uses[1].name, 'FileDirPathFromParent')
  assert.equal(uses[1].argument, 'src')
  assert.equal(firstToolMacro(command).name, 'FilePath')
  assert.equal(firstToolMacro('no macro'), undefined)
})

test('落单美元符号：$HOME 这种漏写收尾的要能数出来', () => {
  assert.equal(danglingToolDollars('echo $HOME'), 1)
  assert.equal(danglingToolDollars('echo $FilePath$'), 0)
  assert.equal(danglingToolDollars('a $X$ b $Y$'), 0)
  assert.equal(danglingToolDollars('cost $5 and $6'), 2)
  assert.equal(danglingToolDollars('none'), 0)
})

test('校验：空名空命令是错误，重名只在别的条目里查', () => {
  const empty = validateExternalTool({ name: '  ', command: '' }, [], KNOWN)
  assert.equal(empty.valid, false)
  assert.deepEqual(empty.problems.map(problem => problem.field), ['name', 'command'])

  const others = [{ name: '格式化', command: 'x' }]
  const dup = validateExternalTool({ name: ' 格式化 ', command: 'y' }, others, KNOWN)
  assert.equal(dup.valid, false)
  assert.match(dup.problems[0].message, /已经有同名工具「格式化」/)
  // 拿自己跟自己比不算重名：validatedTools 按下标排除自己，见下一条
  assert.equal(validateExternalTool({ name: '别的', command: 'y' }, others, KNOWN).valid, true)
})

test('校验：未知宏与落单 $ 是提示不是错误（上游原样保留）', () => {
  const result = validateExternalTool({ name: 'x', command: 'echo $FlePath$ $HOME' }, [], KNOWN)
  assert.equal(result.valid, true, '未知宏不拦保存')
  assert.deepEqual(result.unknownMacros, ['FlePath'])
  assert.equal(result.danglingDollars, 1)
  const noMacroList = validateExternalTool({ name: 'x', command: 'echo $FlePath$' }, [], [])
  assert.deepEqual(noMacroList.unknownMacros, [], '没给已知宏表就不判未知')
})

test('整表校验：逐条给结论，重名的两条都算有歧义', () => {
  const rows = validatedTools([
    { name: '格式化', command: 'clang-format -i $FilePath$' },
    { name: '', command: '' },
    { name: '重复', command: 'x' },
    { name: '重复', command: 'y' },
  ], KNOWN)
  assert.equal(rows.length, 4)
  assert.equal(rows[0].validation.valid, true)
  assert.equal(rows[1].validation.valid, false, '空名空命令')
  // 下标排除自己，所以第 3 条看到的是第 4 条、第 4 条看到的是第 3 条 —— 两边都有歧义。
  assert.equal(rows[2].validation.valid, false)
  assert.equal(rows[3].validation.valid, false)
  assert.ok(rows[2].validation.problems[0].message.includes('重复'))
  assert.deepEqual(rows[0].validation.unknownMacros, [], '已知宏不算未知')
  // 自己不与自己比
  assert.equal(validatedTools([{ name: '唯一', command: 'x' }], KNOWN)[0].validation.valid, true)
})

test('已知宏表与 src/toolMacros.ts 一致（页面插入按钮直接用这张表）', () => {
  assert.ok(KNOWN.includes('FilePath'))
  assert.ok(KNOWN.includes('FileDirPathFromParent'))
  assert.ok(KNOWN.includes('SelectedText'))
  assert.ok(KNOWN.includes('ClipboardContent'))
  const validated = validateExternalTool({ name: 'x', command: 'run $FilePath$ $SelectedText$' }, [], KNOWN)
  assert.deepEqual(validated.unknownMacros, [])
  assert.deepEqual(validated.problems, [])
})
