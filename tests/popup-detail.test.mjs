// 弹层主从详情面板（B1：`com.intellij.ui.popup.util` 那一族 = `MasterController` +
// `DetailController` + `DetailView` + `ItemWrapperListRenderer`）。
//
// 那一族在整棵上游树里**只有一个真实消费者**：`BreakpointsDialog`（断点对话框）——
// 所以判据也围绕那个消费者写：查看断点对话框的列表 + 详情面板。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ELISION_PREFIX, EMPTY_PREVIEW, NOTHING_TO_SHOW, breakpointDetail, breakpointDetails, breakpointDetailsFromBuffers,
  detailPaneState, elidePath, previewStateOf,
} from '../src/popupDetail.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
// 一个"每字符 1 宽"的量尺：判据只关心算法，不关心字体。
const width = (text) => text.length

// —— getTitle2Text（DetailController.java:38-49）——

test('a short path is shown as is', () => {
  assert.equal(elidePath('src/A.java', 40, width), 'src/A.java')
})

test('a long path is elided from the left, keeping the tail', () => {
  // 每次都从第 4 个字符之后找第一个分隔符，丢掉它之前的部分，前缀 "..."。
  const out = elidePath('deep/nested/dir/file/Name.java', 12, width)
  assert.ok(out.startsWith(ELISION_PREFIX), `要从左侧省略：${out}`)
  assert.ok(out.endsWith('Name.java'), `要保住尾部：${out}`)
  // 注意：省略到只剩一个分隔符之后**可能仍超宽** —— 上游 `sep < 0` 就返回，不再省。
  // 所以这一条只断言"比原来短"，不断言"一定放得下"。
  assert.ok(out.length < 'deep/nested/dir/file/Name.java'.length, `要真的变短：${out}`)
})

// 找不到分隔符时**原样返回**（上游 `sep < 0` 那一支），不再无谓地循环。
test('a long path without separators is returned unchanged', () => {
  const long = 'averyveryverylongnamewithoutanyseparator'
  assert.equal(elidePath(long, 5, width), long)
})

// 空值 → 单个空格（上游 `:41` 是为了让标签仍然占位）。
test('empty input becomes a single space', () => {
  assert.equal(elidePath('', 40, width), ' ')
  assert.equal(elidePath(null, 40, width), ' ')
  assert.equal(elidePath(undefined, 40, width), ' ')
})

// 自定义分隔符（上游用的是 `File.separatorChar`）。
test('the separator is configurable', () => {
  const out = elidePath('a\\bbb\\ccc\\ddd\\eee.txt', 10, width, '\\')
  assert.ok(out.startsWith(ELISION_PREFIX) && out.endsWith('eee.txt'), out)
})

// —— PreviewEditorState（DetailView.java:36-58）——

test('a negative line means "no navigation position"', () => {
  assert.deepEqual(previewStateOf('src/A.java', -1), { file: 'src/A.java', line: null })
  assert.deepEqual(previewStateOf('src/A.java', 12), { file: 'src/A.java', line: 12 })
  assert.deepEqual(EMPTY_PREVIEW, { file: '', line: null }, 'PreviewEditorState.EMPTY')
})

// —— doUpdateDetailView（DetailController.java:60-80）：恰好选一项才出详情 ——

const ITEMS = [
  { id: 'a', title: 'A.java:3', path: 'src/A.java:3', body: 'line three', hasSource: true },
  { id: 'b', title: 'B.java:9', path: 'src/B.java:9', body: 'line nine', hasSource: true },
]

test('exactly one selection fills the detail pane', () => {
  const pane = detailPaneState(ITEMS, ['a'], 40, width)
  assert.equal(pane.item?.id, 'a')
  assert.equal(pane.pathLabel, 'src/A.java:3')
})

test('no selection or a multi-selection clears the pane', () => {
  assert.equal(detailPaneState(ITEMS, [], 40, width).item, null)
  assert.equal(detailPaneState(ITEMS, [], 40, width).pathLabel, ' ', '空选时路径标签是空格')
  assert.equal(detailPaneState(ITEMS, ['a', 'b'], 40, width).item, null, '多选不出详情')
  assert.equal(detailPaneState(ITEMS, ['a', 'b'], 40, width).pathLabel, ' ')
})

test('the empty label is the upstream string', () => {
  assert.equal(NOTHING_TO_SHOW, '没有要显示的内容', 'IdeCoreBundle.properties:143 的中文包取值')
  assert.equal(detailPaneState([], [], 40, width).emptyLabel, NOTHING_TO_SHOW)
})

test('the path label goes through the elision', () => {
  const long = [{ id: 'x', title: 'x', path: 'very/long/nested/path/to/File.java:12', body: '', hasSource: true }]
  const pane = detailPaneState(long, ['x'], 12, width)
  assert.ok(pane.pathLabel.startsWith(ELISION_PREFIX), pane.pathLabel)
})

// —— 断点 → 详情项（BreakpointsDialog 的列表）——

test('a breakpoint detail carries its path, line and source', () => {
  const item = breakpointDetail('src/A.java', { line: 12 }, 'return 1;')
  assert.equal(item.id, 'src/A.java:12')
  assert.equal(item.title, 'A.java:12')
  assert.equal(item.body, 'return 1;')
  assert.equal(item.hasSource, true)
})

// 读不到源码时**如实说读不到**，不编造内容。
test('a missing source line says so instead of inventing text', () => {
  const item = breakpointDetail('src/A.java', { line: 12 }, null)
  assert.equal(item.hasSource, false)
  assert.match(item.body, /读不到第 12 行/)
})

test('the list is sorted by path then line number', () => {
  const table = new Map([['b/B.java', [{ line: 2 }]], ['a/A.java', [{ line: 9 }, { line: 3 }]]])
  const items = breakpointDetails(table, () => null)
  assert.deepEqual(items.map(i => i.id), ['a/A.java:3', 'a/A.java:9', 'b/B.java:2'], '行号按数值')
})

// 行号必须按**数值**比：字典序会把第 10 行排到第 9 行前面（这条是写测试时抓到的）。
test('line numbers sort numerically, not lexicographically', () => {
  const table = new Map([['a/A.java', [{ line: 10 }, { line: 9 }, { line: 100 }]]])
  assert.deepEqual(breakpointDetails(table, () => null).map(i => i.id), ['a/A.java:9', 'a/A.java:10', 'a/A.java:100'])
})

test('the buffer-backed assembly reads the requested line', () => {
  const table = new Map([['src/A.java', [{ line: 2 }]]])
  const items = breakpointDetailsFromBuffers(table, path => (path === 'src/A.java' ? 'one\ntwo\nthree' : null))
  assert.equal(items[0]?.body, 'two')
  // 没有缓冲区的文件 ⇒ 如实 null（不为填详情去读盘）。
  const none = breakpointDetailsFromBuffers(table, () => null)
  assert.equal(none[0]?.hasSource, false)
})

// 行号超出缓冲区范围时也当"读不到"处理（上游那里编辑器会夹到合法位置，本仓不夹）。
test('a line past the end of the buffer is treated as missing', () => {
  const table = new Map([['src/A.java', [{ line: 99 }]]])
  assert.equal(breakpointDetailsFromBuffers(table, () => 'only one line')[0]?.body, '（读不到第 99 行的内容）')
})

// —— 接线 ——

test('the View Breakpoints action opens the dialog, not the debug tool window', () => {
  const menu = read('src/menus/runMenu.ts')
  assert.match(menu, /'run\.viewBreakpoints'[^\n]*run: \(\) => ctx\.openBreakpoints\(\)/, '上游 ViewBreakpointsAction 打开的是对话框')
  assert.match(menu, /openBreakpoints: \(\) => void/)
})

test('the dialog is a real master-detail pane', () => {
  const dialog = read('src/components/BreakpointsDialog.vue')
  assert.match(dialog, /class="breakpoints-list"/, '左列表')
  assert.match(dialog, /class="breakpoints-detail"/, '右详情')
  assert.match(dialog, /pane\.pathLabel/, '详情顶部是省略过的路径标签')
  assert.match(dialog, /pane\.emptyLabel/, '空态用上游文案')
  assert.match(dialog, /@keydown\.down\.prevent="move\(1\)"/, '列表支持上下键（上游 JList 的选中移动）')
})

test('the host renders it and can jump to the selected breakpoint', () => {
  const app = read('src/App.vue')
  assert.match(app, /<BreakpointsDialog v-if="breakpointsOpen"/)
  assert.match(app, /breakpointDetailsFromBuffers/, '装配要来自 popupDetail')
})