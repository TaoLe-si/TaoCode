// `src/terminalTitle.ts` 的判据：四份标题数据的优先级、`trimMiddle` 的几何、变更通知与重命名。
//
// 上游依据：`platform/execution-impl/src/com/intellij/terminal/TerminalTitle.kt:78-86`（buildTitle）、
// `:93-98`（buildFullTitle 不截断也不拼 tag）、`:100-102`（shortenApplicationTitle = trimMiddle 30）、
// `:112-117`（State 的四份数据）、`:125-137`（application title 监听 + track 开关）、
// `:26-41`（值没变不通知），兜底文案 `ExecutionBundle.properties:728` = Unnamed，
// `trimMiddle` 的几何 `platform/util/src/com/intellij/openapi/util/text/StringUtil.java:2817-2838`。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  buildSettingsAwareFullTitle, buildSettingsAwareTitle, nextTerminalTabName, shouldShowApplicationTitle,
  TERMINAL_DEFAULT_TITLE, TERMINAL_TAB_BASE_NAME, TERMINAL_TITLE_MAX_LENGTH, terminalRenameInitialValue,
  buildTerminalFullTitle, buildTerminalTitle,
  renameTerminal, setApplicationTitle, shortenApplicationTitle, titleChanged, trimMiddle,
} from '../src/terminalTitle.ts'

test('trimMiddle：前缀 = max - 后缀 - 省略号，后缀 = max >> 1（StringUtil.java:2822-2838）', () => {
  assert.equal(TERMINAL_TITLE_MAX_LENGTH, 30)
  const short = trimMiddle('0123456789', 30)
  assert.equal(short, '0123456789', '没超就不动')
  const long = trimMiddle('x'.repeat(40), 30)
  assert.equal(long.length, 30)
  assert.equal(long.slice(0, 14), 'x'.repeat(14), '前缀 14')
  assert.equal(long.charAt(14), '\u2026', '中间是单个省略号字符')
  assert.equal(long.slice(15), 'x'.repeat(15), '后缀 15')
  assert.equal(trimMiddle('abcdef', 3), 'a…f', '奇数上限也按同一公式（后缀 1、前缀 3-1-1=1）')
  assert.equal(trimMiddle('abcdef', 0), 'abcdef', 'max<=0 不动（防御坏调用）')
})

test('优先级：重命名 > shell 标题 > 默认标题 > Unnamed（TerminalTitle.kt:78-86）', () => {
  assert.equal(buildTerminalTitle({}), TERMINAL_DEFAULT_TITLE)
  assert.equal(buildTerminalTitle({ defaultTitle: '终端 3' }), '终端 3')
  assert.equal(buildTerminalTitle({ application: 'powershell', defaultTitle: '终端 3' }), 'powershell')
  assert.equal(buildTerminalTitle({ userDefined: '我的壳', application: 'powershell' }), '我的壳', '重命名压过 shell 标题')
  assert.equal(buildTerminalTitle({ application: '   ', defaultTitle: '终端 3' }), '终端 3', '全空白算没有（isNullOrBlank）')
  assert.equal(buildTerminalTitle({ application: 'powershell', defaultTitle: '终端 3' }, { ignoreAppTitle: true }), '终端 3')
})

test('标签上 shell 标题要截断，tooltip 不截断也不拼 tag（:100-102 与 :93-98）', () => {
  const state = { application: 'a'.repeat(20) + 'b'.repeat(20), tag: 'build' }
  const title = buildTerminalTitle(state)
  assert.equal(shortenApplicationTitle(state).length, 30)
  assert.match(title, /…/, '标签走截断过的那一条')
  assert.ok(title.endsWith(' (build)'), 'tag 拼在括号里')
  assert.equal(buildTerminalFullTitle(state), state.application, 'full title 不截断')
  assert.ok(!buildTerminalFullTitle(state).includes('build'), 'full title 不拼 tag')
})

test('trackTerminalApplicationTitleChanges 关掉时不收 shell 标题（:125-131）', () => {
  const tracked = setApplicationTitle({ defaultTitle: '终端 1' }, 'cmd')
  assert.equal(tracked.application, 'cmd')
  const muted = setApplicationTitle({ defaultTitle: '终端 1', trackApplicationTitle: false, application: '旧值' }, '新值')
  assert.equal(muted.application, '旧值', '不追踪时原样返回')
})

test('值没变就不通知（:26-41 的 change {}）', () => {
  const before = { defaultTitle: '终端 1', application: 'cmd' }
  assert.equal(titleChanged(before, { ...before }), false)
  assert.equal(titleChanged(before, { ...before, application: 'bash' }), true)
  assert.equal(titleChanged({ application: 'cmd' }, { application: 'cmd', trackApplicationTitle: true }), false,
    'track 的默认值等价，不算变更')
  assert.equal(titleChanged({ application: 'cmd' }, { application: 'cmd', trackApplicationTitle: false }), true)
})

test('重命名：截到输入框上限，空标题 = 取消重命名', () => {
  const renamed = renameTerminal({ defaultTitle: '终端 1', application: 'cmd' }, '  发布用  ')
  assert.equal(renamed.userDefined, '发布用')
  assert.equal(buildTerminalTitle(renamed), '发布用')
  assert.equal(renameTerminal({ userDefined: '发布用' }, '   ').userDefined, undefined, '空的一律取消重命名')
  assert.equal(renameTerminal({}, 'x'.repeat(60)).userDefined.length, 40, '面板输入框 maxlength 40')
})

test('消费链：TerminalPanel 的标签文字/tooltip/重命名/OSC 标题都走这条链路', () => {
  const panel = readFileSync(new URL('../src/components/TerminalPanel.vue', import.meta.url), 'utf8')
  assert.match(panel, /instance\.onTitleChange\(raw => setPaneTitle\(pane, setApplicationTitle\(pane\.title, raw\)\)\)/,
    'xterm 的 onTitleChange 就是上游的 TerminalApplicationTitleListener')
  assert.match(panel, /buildSettingsAwareTitle\(pane\.title, TITLE_SETTINGS, isCommandRunning\(pane\)\)/, '标签文字取设置感知的标题')
  assert.match(panel, /buildSettingsAwareFullTitle\(pane\.title, TITLE_SETTINGS, isCommandRunning\(pane\)\)/, 'tooltip 取设置感知的全标题')
  assert.match(panel, /setPaneTitle\(pane, renameTerminal\(pane\.title, renameText\.value\)\)/, '重命名写 userDefinedTitle')
  assert.match(panel, /if \(!titleChanged\(pane\.title, next\)\) return/, '内容没变不重绘')
  // 新建会话的默认名与重命名初值也挂在面板上（不是只有模块自己过测试）。
  assert.match(panel, /attachPane\(id, nextTerminalTabName\(TERMINAL_TAB_BASE_NAME, panes\.value\.map\(paneLabel\)\), group\)/,
    '新建标签的名走那条去重的行模型')
  assert.match(panel, /renameText\.value = terminalRenameInitialValue\(pane\.title, TITLE_SETTINGS, isCommandRunning\(pane\)\)/,
    '重命名输入框预填全标题（RenameTerminalSessionAction.kt:20-23）')
})

// 标签行模型（新建会话的去重默认名）与「按设置采纳 shell 标题」那一档。
// 上游依据：`plugins/terminal/src/org/jetbrains/plugins/terminal/util/TerminalTitleUtils.kt:37-59`（门）、
// `:61-88`（去重）＋ `platform/util/src/com/intellij/util/text/UniqueNameGenerator.java:102-124`（编号几何）、
// `plugins/terminal/src/org/jetbrains/plugins/terminal/TerminalOptionsProvider.kt:68/71/325`（三个默认值）、
// `plugins/terminal/resources/messages/TerminalBundle.properties:96`（`local.terminal.default.name=Local`）、
// `RenameTerminalSessionAction.kt:20-23`（弹窗初值 = buildSettingsAwareFullTitle）。

test('新建会话的默认标签名：基础名没被占用就用它，占用后从 2 起编号（UniqueNameGenerator.java:105-123）', () => {
  assert.equal(nextTerminalTabName('本地', []), '本地', '先试原名')
  assert.equal(nextTerminalTabName('本地', ['本地']), '本地 (2)', '起点是 2（:99 把 startingNumber 传成 2）')
  assert.equal(nextTerminalTabName('本地', ['本地', '本地 (2)']), '本地 (3)', '逐个试到没人用为止')
  assert.equal(nextTerminalTabName('本地', ['本地 (2)']), '本地', '只占了 (2) 时基础名仍然可用')
  // 上游的正则是 `(.+?) \((\d{1,9})` 配 matches() ⇒ 结尾的 `)` 不在模式里：
  // 「本地 (2)」整体匹配不上，只有缺右括号的「本地 (2」才会把计数接下去。这条 quirk 照搬，不"修好"它。
  assert.equal(nextTerminalTabName('本地 (2)', ['本地 (2)']), '本地 (2) (2)')
  assert.equal(nextTerminalTabName('本地 (2', ['本地 (2']), '本地 (3)', '缺右括号时才认成已编号')
  assert.equal(nextTerminalTabName(TERMINAL_TAB_BASE_NAME, []), TERMINAL_TAB_BASE_NAME)
})

test('shouldShowApplicationTitle 的四档组合（TerminalTitleUtils.kt:54-59）', () => {
  const always = { showApplicationTitle: true, applicationTitleShowingMode: 'always' }
  const whenRunning = { showApplicationTitle: true, applicationTitleShowingMode: 'whenCommandRunning' }
  const off = { showApplicationTitle: false, applicationTitleShowingMode: 'always' }
  assert.equal(shouldShowApplicationTitle(always, false), true, 'ALWAYS 不看信号')
  assert.equal(shouldShowApplicationTitle(whenRunning, true), true)
  assert.equal(shouldShowApplicationTitle(whenRunning, false), false, '默认档 + 命令没在跑 ⇒ 不采纳 shell 标题')
  assert.equal(shouldShowApplicationTitle(off, true), false, '总闸关掉时两档都不给')
})

test('设置感知的标题：门关掉就不采纳 shell 标题，其余优先级不变', () => {
  const state = { application: 'vim ~/notes', defaultTitle: '本地', tag: 'beta' }
  const off = { showApplicationTitle: false, applicationTitleShowingMode: 'always' }
  assert.equal(buildSettingsAwareTitle(state, off), '本地 (beta)', '不采纳 shell 标题 ⇒ 落回默认标题，tag 照样拼')
  assert.equal(buildSettingsAwareTitle(state, { showApplicationTitle: true, applicationTitleShowingMode: 'always' }), 'vim ~/notes (beta)')
  // 重命名永远压过一切（TerminalTitle.kt:78-86）。
  assert.equal(buildSettingsAwareTitle({ ...state, userDefined: '发布用' }, off), '发布用 (beta)')
  // 全标题不截断、不拼 tag（:93-98），门是同一扇。
  const long = { application: 'a'.repeat(40), defaultTitle: '本地' }
  assert.equal(buildSettingsAwareTitle(long, { showApplicationTitle: true, applicationTitleShowingMode: 'always' }).length, 30,
    '标签这条按 trimMiddle 截到 30')
  assert.equal(buildSettingsAwareFullTitle(long, { showApplicationTitle: true, applicationTitleShowingMode: 'always' }), long.application,
    'tooltip 这条不截断')
})

test('重命名弹窗的初值是**全标题**，不是标签上那条截断过的文字（RenameTerminalSessionAction.kt:20-23）', () => {
  const long = { application: `${'前'.repeat(20)}${'后'.repeat(20)}`, defaultTitle: '本地' }
  const settings = { showApplicationTitle: true, applicationTitleShowingMode: 'always' }
  const initial = terminalRenameInitialValue(long, settings)
  assert.equal(initial, long.application, '预填的是 buildSettingsAwareFullTitle（未截断）')
  assert.notEqual(initial, buildTerminalTitle(long), '绝不是标签那条')
  assert.equal(terminalRenameInitialValue({ defaultTitle: '本地' }, settings), '本地')
  // 门关掉时预填的也是「不采纳 shell 标题」那一条全标题。
  assert.equal(terminalRenameInitialValue(long, { showApplicationTitle: false, applicationTitleShowingMode: 'always' }), '本地')
})
