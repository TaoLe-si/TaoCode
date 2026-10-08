// exec/console：控制台执行动作（`src/consoleExecute.ts`）的判据。
//
// 上游依据：`platform/lang-impl/src/com/intellij/execution/console/` 的
// `ConsoleExecuteAction.java:30`（动作 id）、`:72-85`（update 的四道门）、`:97-99`（isEnabled）、
// `:101-114`（execute 的回显）、`:118-152`（runExecuteAction 的两档）、
// `ProcessBackedConsoleExecuteActionHandler.java:32-48`（解释器档的字节写入）、
// `BaseConsoleExecuteActionHandler.java:26-31`（doExecute → execute）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const {
  CONSOLE_EXECUTE_ACTION_ID, consoleExecuteEnabled, consoleExecuteMode, consoleExecuteEcho,
  interpreterCommand, interpreterAvailable,
} = await import('../src/consoleExecute.ts')

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const base = { text: 'x', rendererMode: false, emptyCommandAllowed: false, lookupActive: false, enabled: true }

test('动作 id 与上游一致（ConsoleExecuteAction.java:30）', () => {
  assert.equal(CONSOLE_EXECUTE_ACTION_ID, 'Console.Execute')
})

test('update 的四道门（ConsoleExecuteAction.java:72-85）', () => {
  assert.equal(consoleExecuteEnabled(base), true)
  assert.equal(consoleExecuteEnabled({ ...base, rendererMode: true }), false, 'renderer 模式不启用')
  assert.equal(consoleExecuteEnabled({ ...base, enabled: false }), false, '会话条件不满足')
  assert.equal(consoleExecuteEnabled({ ...base, text: '   ' }), false, '空文档且不允许空命令')
  assert.equal(consoleExecuteEnabled({ ...base, text: '   ', emptyCommandAllowed: true }), true, '允许空命令')
  assert.equal(consoleExecuteEnabled({ ...base, lookupActive: true }), false, '补全下拉正在选东西')
})

test('执行档按 myUseProcessStdIn 分（runExecuteAction 的两档）', () => {
  assert.equal(consoleExecuteMode(true), 'stdin')
  assert.equal(consoleExecuteMode(false), 'interpreter')
})

test('回显：末尾没有换行就补一个（:103-108）', () => {
  assert.equal(consoleExecuteEcho('1+1'), '1+1\n')
  assert.equal(consoleExecuteEcho('1+1\n'), '1+1\n')
})

test('解释器命令：空命令/空解释器返回空串；引号被正确转义', () => {
  assert.equal(interpreterCommand('python', '1+1'), "python -c '1+1'")
  assert.equal(interpreterCommand('', '1+1'), '')
  assert.equal(interpreterCommand('python', '   '), '')
  assert.equal(interpreterCommand('  python  ', 'print(1)'), "python -c 'print(1)'")
  assert.equal(interpreterCommand('node', "console.log('x')"), "node -c 'console.log('\\''x'\\'')'")
})

test('解释器可用性只看有没有解释器命令（与进程存活无关，差异见模块头）', () => {
  assert.equal(interpreterAvailable('python'), true)
  assert.equal(interpreterAvailable('  '), false)
})

test('接线：runActions 记解释器命令，RunConsole 有输入行与执行入口', () => {
  const actions = read('src/runActions.ts')
  assert.match(actions, /runInterpreterCommand\.value = \(params\.program \?\? ''\)\.trim\(\)/)
  const console = read('src/components/RunConsole.vue')
  assert.match(console, /from '\.\.\/consoleExecute\.ts'/)
  assert.match(console, /interpreterAvailable\(interpreterProgram\)/, '没有解释器命令就不显示这一行')
  assert.match(console, /request<\{ instance: number \}>\('run\.start'/)
  assert.match(console, /aria-label="解释器输入"/)
})