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
  TERMINAL_DEFAULT_TITLE, TERMINAL_TITLE_MAX_LENGTH, buildTerminalFullTitle, buildTerminalTitle,
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
  assert.match(panel, /buildTerminalTitle\(pane\.title\)/, '标签文字取 buildTerminalTitle')
  assert.match(panel, /buildTerminalFullTitle\(pane\.title\)/, 'tooltip 取 buildTerminalFullTitle')
  assert.match(panel, /setPaneTitle\(pane, renameTerminal\(pane\.title, renameText\.value\)\)/, '重命名写 userDefinedTitle')
  assert.match(panel, /if \(!titleChanged\(pane\.title, next\)\) return/, '内容没变不重绘')
})
