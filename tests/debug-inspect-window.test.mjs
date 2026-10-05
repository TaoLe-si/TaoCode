// 行动作清单（`src/debugRowActions.ts`）+ 检查值窗口（`src/components/DebugInspectWindow.vue`）。
// 上游：XInspectAction.java:22-30 / XInspectDialog.java:38,41,42,59-63,65-74 /
//       DebuggerTreeWithHistoryContainer.java:88-103 / XCompareWithClipboardAction.java:31-36 /
//       ShowReferringObjectsAction.java:32-41 / XJumpToTypeSourceAction.kt:14-16。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { debugRowActions } from '../src/debugRowActions.ts'

const inspectWindow = readFileSync(new URL('../src/components/DebugInspectWindow.vue', import.meta.url), 'utf8')
const rowMenu = readFileSync(new URL('../src/components/DebugRowMenu.vue', import.meta.url), 'utf8')

function target(overrides = {}) {
  return { expression: 'user.name', reference: 7, isValue: true, value: 'John', arrayView: false, canArray: false, ...overrides }
}

test('清单覆盖上游那一组动作：复制值/名称、加监视、控制台求值、按数组显示、检查、与剪贴板比较', () => {
  const items = debugRowActions(target({ canArray: true }), { paused: true })
  assert.deepEqual(items.map(item => item.mode), [
    'copy-value', 'copy-name', 'watch', 'console', 'array-on', 'inspect', 'compare-clipboard',
  ])
  assert.deepEqual(items.map(item => item.label), [
    '复制值', '复制名称', '添加到监视', '在控制台中求值', '按数组显示', '检查', '与剪贴板比较',
  ])
  assert.deepEqual(items.filter(item => item.disabled), [])
})

test('「显示引用对象」「跳到类型源码」不渲染 —— 上游在不可用时是隐藏，不是留个灰条目', () => {
  // ShowReferringObjectsAction.java:32-36：`setVisible(presentation.isEnabled())`；
  // 它的 isEnabled（:39-41）要求 referrers provider，DAP 的 variables 没有这个字段。
  // XJumpToTypeSourceAction.kt:14-16 要求 canNavigateToTypeSource()，DAP 也不带源码位置。
  const modes = debugRowActions(target(), { paused: true }).map(item => item.mode)
  assert.equal(modes.includes('referrers'), false)
  assert.equal(modes.includes('type-source'), false)
})

test('禁用项都带原因（hint），hint 挂到 title 上（DebugRowMenu.vue）', () => {
  const items = debugRowActions(target({ expression: '', value: '' }), { paused: false })
  const byMode = Object.fromEntries(items.map(item => [item.mode, item]))
  assert.equal(byMode.watch.disabled, true)
  assert.ok(byMode.watch.hint)
  assert.equal(byMode.console.disabled, true)
  assert.equal(byMode['compare-clipboard'].disabled, true)
  assert.equal(byMode.inspect.disabled, false, '检查不需要表达式')
  // 组行（isValue=false）不能复制值/检查，但名字总能复制。
  const group = Object.fromEntries(debugRowActions(target({ isValue: false }), { paused: true }).map(item => [item.mode, item]))
  assert.equal(group['copy-value'].disabled, true)
  assert.equal(group.inspect.disabled, true)
  assert.notEqual(group['copy-name'].disabled, true)
  assert.match(rowMenu, /:title="item\.hint \?\? item\.label"/)
})

test('「按数组显示」随当前状态切标签；孩子没加载/不是索引形态时禁用并说明', () => {
  const on = Object.fromEntries(debugRowActions(target({ arrayView: true, canArray: true }), { paused: true }).map(item => [item.mode, item]))
  assert.equal(on['array-off'].label, '取消按数组显示')
  assert.equal(on['array-off'].disabled, false)
  const off = Object.fromEntries(debugRowActions(target(), { paused: true }).map(item => [item.mode, item]))
  assert.equal(off['array-on'].disabled, true)
  assert.ok(off['array-on'].hint)
  // 「在控制台中求值」要求已暂停（与既有面板行为一致）。
  const running = Object.fromEntries(debugRowActions(target(), { paused: false }).map(item => [item.mode, item]))
  assert.equal(running.console.disabled, true)
  assert.equal(running.console.hint, '要先停在断点上')
})

test('检查值窗口是非模态浮窗、标题带节点名、工具条是「设为根 / Alt+← / Alt+→」', () => {
  // XInspectDialog.java:42 setModal(false) / :38 super(project, false) ⇒ 浮窗而不是模态遮罩。
  assert.match(inspectWindow, /position: fixed/)
  assert.equal(/modal-backdrop/.test(inspectWindow), false, '检查窗口不能是模态遮罩')
  assert.match(inspectWindow, /检查值：/)
  assert.match(inspectWindow, /往回一步（Alt\+←）/)
  assert.match(inspectWindow, /往前一步（Alt\+→）/)
  // XInspectDialog.java:59-63：每次 sessionPaused 重建树 ⇒ 监听停住次数。
  assert.match(inspectWindow, /watch\(\(\) => props\.generation/)
})

test('检查值窗口自己取数：复用 collectReferenceRows + 直接调 dapVariables/dapSetVariable', () => {
  // 与 Variables 视图同一套过滤/排序/分组/按数组显示规则，不另写一份树展开。
  assert.match(inspectWindow, /collectReferenceRows/)
  assert.match(inspectWindow, /dapVariables\(/)
  assert.match(inspectWindow, /dapSetVariable\(row\.container, row\.apiName, text\)/)
  assert.match(inspectWindow, /canViewAsArray/)
})
