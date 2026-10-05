// `src/terminalClipboard.ts` 的判据：可见/可用分开、Ctrl+C 的归属、那四组键与历史清单。
//
// 上游依据：`plugins/terminal/src/org/jetbrains/plugins/terminal/action/TerminalCopyTextAction.kt:29-40`
// （可见 = 有终端编辑器，可用 = `selectionModel.hasSelection()`）、
// `plugins/terminal/src/org/jetbrains/plugins/terminal/action/TerminalCtrlCActionsPromoter.kt:8-18`
// （Windows/Linux 上复制与中断命令共用 Ctrl+C，没选区时轮到中断命令）、
// `plugins/terminal/resources/META-INF/plugin.xml:128-135`（Ctrl+C / Ctrl+Insert）、
// `plugins/terminal/frontend/resources/intellij.terminal.frontend.xml:136-143`（Ctrl+V / Shift+Insert）、
// `:144-147`（Terminal.PasteFromHistory）、`:225-230`（Terminal.OutputContextMenu 的四条顺序）、
// 剪贴板交接本体 `platform/execution-impl/src/com/intellij/terminal/IdeTerminalCopyPasteHandler.java:12-18`。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  TERMINAL_CLIPBOARD_ACTIONS_NOT_PORTED, TERMINAL_COPY_KEYS, TERMINAL_PASTE_KEYS,
  terminalClipboardActions, terminalClipboardKeyFor, terminalCopyAction, terminalCopyOnCtrlC,
  terminalHistoryEntries, terminalPasteAction, terminalPasteFromHistoryAction,
} from '../src/terminalClipboard.ts'

const ctx = (overrides = {}) => ({ hasTerminal: true, hasSelection: true, running: true, historyCount: 3, ...overrides })

test('复制与粘贴把「可见」和「可用」分开（TerminalCopyTextAction.kt:31-39）', () => {
  assert.equal(terminalCopyAction(ctx()).visible, true)
  assert.equal(terminalCopyAction(ctx()).enabled, true)
  const noSelection = terminalCopyAction(ctx({ hasSelection: false }))
  assert.equal(noSelection.visible, true, '没选区时菜单项还在，只是点不动')
  assert.equal(noSelection.enabled, false)
  assert.match(noSelection.reason, /先选中要复制的文字/)
  assert.match(noSelection.reason, /中断命令/, '顺带解释 Ctrl+C 去了哪儿')
  // 没有终端 ⇒ 整条不出现（不是灰掉）
  assert.equal(terminalCopyAction(ctx({ hasTerminal: false })).visible, false)
})

test('粘贴只看有没有终端编辑器；已退出的会话没有接收方所以点不动（frontend.xml:52-57）', () => {
  assert.equal(terminalPasteAction(ctx({ hasSelection: false })).enabled, true, '粘贴不看选区')
  const exited = terminalPasteAction(ctx({ running: false }))
  assert.equal(exited.enabled, false)
  assert.match(exited.reason, /进程已经退出/)
})

test('从历史粘贴：历史为空时整条不出现（frontend.xml:144-147）', () => {
  assert.equal(terminalPasteFromHistoryAction(ctx()).visible, true)
  assert.equal(terminalPasteFromHistoryAction(ctx({ historyCount: 0 })).visible, false)
  assert.match(terminalPasteFromHistoryAction(ctx({ historyCount: 0 })).reason, /没有可粘的条目/)
  assert.equal(terminalPasteFromHistoryAction(ctx({ historyCount: 2, running: false })).enabled, false)
})

test('右键菜单那组按上游顺序排，不可见的整条剔除（frontend.xml:225-230）', () => {
  assert.deepEqual(terminalClipboardActions(ctx()).map(row => row.id),
    ['terminal.copy', 'terminal.paste', 'terminal.paste.fromHistory'])
  assert.deepEqual(terminalClipboardActions(ctx({ historyCount: 0 })).map(row => row.id),
    ['terminal.copy', 'terminal.paste'])
  assert.deepEqual(terminalClipboardActions(ctx({ hasTerminal: false })), [])
})

test('Ctrl+C 的归属：有选区复制，没选区交回 PTY（TerminalCtrlCActionsPromoter.kt:8-18）', () => {
  assert.equal(terminalCopyOnCtrlC(true), true)
  assert.equal(terminalCopyOnCtrlC(false), false)
})

test('键位就是 $default 那四组（plugin.xml:133-134、frontend.xml:141-142）', () => {
  assert.deepEqual([...TERMINAL_COPY_KEYS], ['Ctrl+C', 'Ctrl+Insert'])
  assert.deepEqual([...TERMINAL_PASTE_KEYS], ['Ctrl+V', 'Shift+Insert'])
  assert.equal(terminalClipboardKeyFor({ key: 'c', ctrlKey: true }), 'copy')
  assert.equal(terminalClipboardKeyFor({ key: 'c', metaKey: true }), 'copy', 'mac 上 Cmd+C 同义')
  assert.equal(terminalClipboardKeyFor({ key: 'Insert', ctrlKey: true }), 'copy')
  assert.equal(terminalClipboardKeyFor({ key: 'Insert', shiftKey: true }), 'paste', 'Shift+Insert 不要 Ctrl')
  assert.equal(terminalClipboardKeyFor({ key: 'v', ctrlKey: true }), 'paste')
  assert.equal(terminalClipboardKeyFor({ key: 'v' }), null, '光按 V 是往 PTY 里打字')
  assert.equal(terminalClipboardKeyFor({ key: 'c', altKey: true }), null, 'Alt+C 不是复制')
  assert.equal(terminalClipboardKeyFor({ key: 'Escape' }), null, '其余一律交回 xterm')
})

test('历史清单：不列已清除的占位项，也不列空串，并按上限截断', () => {
  const entries = [{ text: '第一条' }, { text: '', purged: false }, { text: '第二条', purged: true },
    { text: '第三条' }, { text: '第四条' }]
  assert.deepEqual(terminalHistoryEntries(entries, 2).map(row => row.text), ['第一条', '第三条'])
  assert.deepEqual(terminalHistoryEntries([], 5), [])
  assert.deepEqual(terminalHistoryEntries(entries, 0), [], '上限 0 就是空表')
})

test('Terminal.CopyBlock 登记但不渲染：本仓没有 OSC 133 的产生者', () => {
  const [blocked] = TERMINAL_CLIPBOARD_ACTIONS_NOT_PORTED
  assert.equal(blocked.id, 'Terminal.CopyBlock')
  assert.match(blocked.reason, /plugin\.xml:176-178/, '上游那条确实登记在册')
  assert.match(blocked.reason, /OSC 133/, '块边界来自 shell integration')
  assert.match(blocked.reason, /native\/terminal\.hpp/, '本仓宿主是裸 ConPTY 的依据在这里')
  const ids = terminalClipboardActions(ctx({ hasTerminal: true, historyCount: 9 })).map(row => row.id)
  assert.ok(!ids.some(id => id.includes('CopyBlock')), '渲染出来的清单里不许有它')
})

test('消费链：面板的右键菜单、四个键与剪贴板后端都接上了', () => {
  const panel = readFileSync(new URL('../src/components/TerminalPanel.vue', import.meta.url), 'utf8')
  assert.match(panel, /terminalClipboardActions\(clipboardContext\(\)\)/, '菜单条目由纯函数给')
  assert.match(panel, /addEventListener\('contextmenu'/, '窗格上真的能右键')
  assert.match(panel, /attachCustomKeyEventHandler/, '键盘入口走 xterm 那个钩子')
  assert.match(panel, /terminalClipboardKeyFor\(event\)/, '组合键解释走纯函数')
  assert.match(panel, /terminalCopyOnCtrlC\(instance\.hasSelection\(\)\)/, '没选区时把 Ctrl+C 交回 PTY')
  assert.match(panel, /pane\.instance\.paste\(text\)/, '粘贴送进会话（onData → term.write）')
  assert.match(panel, /terminalHistoryEntries\(await readClipboardHistory\(\)\)/, '历史来自 src/clipboard.ts')
  assert.match(panel, /copyToClipboard\(pane\.instance\.getSelection\(\)\)/, '复制交给系统剪贴板')
})
