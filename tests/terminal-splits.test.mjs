// `src/terminalSplits.ts` 的判据：启用条件、窗格间跳转的首尾循环、网格与落点。
//
// 上游依据：`plugins/terminal/src/org/jetbrains/plugins/terminal/action/TerminalSplitAction.kt:12-35`
// （一个类管两个方向、`canSplit`/`split` 交给 listener）、
// `plugins/terminal/src/org/jetbrains/plugins/terminal/TerminalToolWindowManager.java:431-439`
// （canSplit 就是把 TW.SplitRight / TW.SplitDown 的可用性原样转出来，**没有数量上限**）、
// `platform/platform-impl/src/com/intellij/ide/actions/ToolWindowSplitActions.kt:15-31`
// （splitWithContent(RIGHT|BOTTOM)、启用 = canSplitTabs + 有 split provider）、
// `platform/platform-impl/src/com/intellij/toolWindow/InternalDecoratorImpl.kt:516-534`
// （getNextPrevCellImpl：非分屏返回 null，否则顺序 ±1 且首尾循环）、
// 动作登记 `platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:463-478`，
// 文案 `platform/platform-resources-en/src/messages/ActionsBundle.properties:1257/1261`。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  TERMINAL_SPLIT_LABELS, canGotoTerminalPane, canTerminalSplit, canUnsplitTerminalPane,
  nextTerminalPaneCell, paneIndexAfterSplit, terminalGridSize,
} from '../src/terminalSplits.ts'

const opts = (overrides = {}) => ({ desktop: true, busy: false, count: 1, ...overrides })

test('文案取上游那五条（去掉助记符下划线）', () => {
  assert.equal(TERMINAL_SPLIT_LABELS.right, '右侧分屏')
  assert.equal(TERMINAL_SPLIT_LABELS.down, '下侧分屏')
  assert.equal(TERMINAL_SPLIT_LABELS.unsplit, '取消分屏')
})

test('分屏没有窗格数上限，只有真实宿主前提（TerminalToolWindowManager.java:431-434）', () => {
  for (const count of [1, 2, 3, 8]) {
    assert.equal(canTerminalSplit('right', opts({ count })).enabled, true, `${count} 格时仍能给右侧`)
    assert.equal(canTerminalSplit('down', opts({ count })).enabled, true)
  }
  assert.equal(canTerminalSplit('right', opts({ desktop: false })).enabled, false)
  assert.match(canTerminalSplit('right', opts({ desktop: false })).reason, /浏览器预览/)
  assert.equal(canTerminalSplit('down', opts({ busy: true })).enabled, false)
  assert.match(canTerminalSplit('down', opts({ busy: true })).reason, /正在创建终端/)
})

test('取消分屏与窗格跳转要求真的分了屏（TW.Unsplit / mode.isSplit）', () => {
  assert.equal(canUnsplitTerminalPane(opts({ count: 1 })).enabled, false)
  assert.match(canUnsplitTerminalPane(opts({ count: 1 })).reason, /没有分屏/)
  assert.equal(canUnsplitTerminalPane(opts({ count: 2 })).enabled, true)
  assert.equal(canGotoTerminalPane(opts({ count: 1 })).enabled, false)
  assert.equal(canGotoTerminalPane(opts({ count: 2 })).enabled, true)
  assert.equal(canGotoTerminalPane(opts({ count: 2, desktop: false })).enabled, false)
})

test('窗格跳转：非分屏返回 null，否则顺序 ±1 且首尾循环（InternalDecoratorImpl.kt:525-534）', () => {
  const cells = [1, 2, 3]
  assert.equal(nextTerminalPaneCell([7], 7, true), null, '一格没有可跳的')
  assert.equal(nextTerminalPaneCell(cells, 1, true), 2)
  assert.equal(nextTerminalPaneCell(cells, 3, true), 1, '末尾往后回到第一个')
  assert.equal(nextTerminalPaneCell(cells, 1, false), 3, '开头往前绕到末尾')
  assert.equal(nextTerminalPaneCell(cells, 2, false), 1)
  assert.equal(nextTerminalPaneCell(cells, 99, true), 1, '当前格不在表里（刚换标签）时从头开始')
})

test('网格：每分一次就多占一块（列 = 1+右侧次数，行 = 1+下侧次数）', () => {
  assert.deepEqual(terminalGridSize(0, 0), { columns: 1, rows: 1 })
  assert.deepEqual(terminalGridSize(2, 0), { columns: 3, rows: 1 })
  assert.deepEqual(terminalGridSize(0, 2), { columns: 1, rows: 3 })
  assert.deepEqual(terminalGridSize(1, 1), { columns: 2, rows: 2 })
  assert.deepEqual(terminalGridSize(-1, -3), { columns: 1, rows: 1 }, '负数不该把网格收成 0')
})

test('新格子的落点：右侧 = 紧跟被分的格，下侧 = 排在整行之后', () => {
  const cells = [{ id: 1, origin: 0 }, { id: 2, origin: 0 }, { id: 3, origin: 0 }]
  assert.equal(paneIndexAfterSplit(cells, 0, 'right', 3), 1)
  assert.equal(paneIndexAfterSplit(cells, 2, 'right', 3), 3, '末格往后就是追加')
  assert.equal(paneIndexAfterSplit(cells, 0, 'down', 2), 2, '第 0 格下面 = 下一行开头')
  assert.equal(paneIndexAfterSplit(cells, 1, 'down', 2), 2, '第 1 格（第一行末列）下面也是下一行')
  assert.equal(paneIndexAfterSplit(cells, 1, 'down', 1), 2, '单列时第 1 格下面就是追加')
})

test('消费链：面板真的按这套排窗格（右/下两个方向 + 跳转 + 取消）', () => {
  const panel = readFileSync(new URL('../src/components/TerminalPanel.vue', import.meta.url), 'utf8')
  assert.match(panel, /canTerminalSplit\(orientation, \{ desktop: isDesktop, busy: busy\.value, count: group\.length \}\)/)
  assert.match(panel, /split\('right'\)[\s\S]*split\('down'\)/, '工具条上两个方向各一枚按钮')
  assert.match(panel, /terminalGridSize\(counts\.rights, counts\.downs\)/, '布局问的是网格')
  assert.match(panel, /paneIndexAfterSplit\(group\.map\(paneCell\), group\.indexOf\(current\), orientation, grid\.columns\)/)
  assert.match(panel, /nextTerminalPaneCell\(groupPanes\(current\), current, forward\)/, '窗格间跳转')
  assert.match(panel, /splitCounts\.delete\(group\)/, '整组关完时把分屏计数清掉')
  const actions = readFileSync(new URL('../src/terminalActions.ts', import.meta.url), 'utf8')
  assert.match(actions, /canTerminalSplit\('right'/)
  assert.match(actions, /canUnsplitTerminalPane\(/)
  assert.match(actions, /canGotoTerminalPane\(/)
  assert.doesNotMatch(actions, /export const MAX_PANES_PER_GROUP/, '本仓自加的那条两格上限已经去掉了')
})
