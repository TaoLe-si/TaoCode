// 用法视图（引用 / IDEA 的 Find 窗口）**自己的齿轮组** —— `additionalGearActions` 的第二个落点。
//
// 上游：`UsageViewContentManagerImpl.java:114-116` 把一组「视图选项」挂到那个工具窗口上：
//   `DefaultActionGroup.createPopupGroup(IdeBundle "group.view.options")`
//   + `toggleAutoscrollAction`（`UIBundle.properties:23` "Navigate with Single Click"）
//   + `toggleSortAction`（`UsageViewBundle` 的 `sort.alphabetically.action.text`，
//     `UsageViewSettings.isSortAlphabetically`，默认 false）
//   + `toggleNewTabAction`（`find.open.in.new.tab.action`，`FindUsagesSettings.showResultsInSeparateView`）
// 两条接住了（排序与"在新标签页中打开"），「一键导航」需要结果列表的选择模型 —— 登记不做。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  USAGE_NAVIGATE_ON_SINGLE_CLICK_TITLE, USAGE_OPEN_IN_NEW_TAB_TITLE, USAGE_SORT_TITLE,
  USAGE_VIEW_OPTIONS_TITLE,
  closeAllReferences, finishReferences, references, referencesInNewTab, referencesNavigateOnSingleClick,
  referencesSortAlphabetically, sortUsages, startReferences,
} from '../src/referenceContents.ts'
import { isUsageView, usageViewGearRows } from '../src/usageViewGear.ts'
import { TOOL_WINDOW_GEAR_SPEC, toolWindowGearRows } from '../src/menus/toolWindowGear.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

const at = (path, line, character = 0) => ({ path, line, character })

test('字母序：路径（大小写不敏感）→ 行 → 列，且不改原数组', () => {
  const input = [at('b.ts', 5), at('A.ts', 9), at('a.ts', 2, 7), at('a.ts', 2, 1)]
  const sorted = sortUsages(input)
  assert.deepEqual(sorted.map(item => `${item.path}:${item.line}:${item.character}`),
    ['a.ts:2:1', 'a.ts:2:7', 'A.ts:9:0', 'b.ts:5:0'],
    '大小写不敏感 ⇒ A.ts 与 a.ts 归同一组，组内再按行、列（所以 9 行的 A.ts 排在 2 行的 a.ts 之后）')
  assert.equal(input[0].path, 'b.ts', '排序不许改原数组（面板读的是同一份 payload）')
})

test('「按字母顺序排列成员」真的改面板里的顺序', () => {
  closeAllReferences()
  const search = startReferences('alpha', 'A#alpha')
  finishReferences(search, [at('z.ts', 1), at('a.ts', 3)])
  const previous = referencesSortAlphabetically.value
  try {
    referencesSortAlphabetically.value = false
    assert.deepEqual(references.value.map(item => item.path), ['z.ts', 'a.ts'], '关着按语言服务给的顺序')
    referencesSortAlphabetically.value = true
    assert.deepEqual(references.value.map(item => item.path), ['a.ts', 'z.ts'], '开着按字母序')
  } finally {
    referencesSortAlphabetically.value = previous
    closeAllReferences()
  }
})

test('齿轮组只在用法视图上出现，三条成员都是真的开关', () => {
  assert.equal(isUsageView('references'), true)
  for (const other of ['output', 'run', 'problems', 'terminal']) assert.equal(isUsageView(other), false, `${other} 不是用法视图`)
  assert.deepEqual(usageViewGearRows('output'), {}, '不是用法视图 ⇒ 整组不给（不留点了没用的行）')

  const rows = usageViewGearRows('references')
  const group = rows['usage.viewOptions']
  assert.ok(group, '用法视图要有「视图选项」这一组')
  assert.equal(group.title, USAGE_VIEW_OPTIONS_TITLE, 'group.view.options = 视图选项')
  assert.deepEqual(group.children.map(child => child.id),
    ['usage.navigateOnSingleClick', 'usage.sortAlphabetically', 'usage.openInNewTab'],
    '顺序照 :114-116 的 addAll（一键导航在最前，排序在"新标签页"之前）')
  assert.deepEqual(group.children.map(child => child.title),
    [USAGE_NAVIGATE_ON_SINGLE_CLICK_TITLE, USAGE_SORT_TITLE, USAGE_OPEN_IN_NEW_TAB_TITLE],
    '文案取随 IDE 发货的语言包：单击导航 / 按字母顺序排列成员 / 在新标签页中打开结果')

  const toggleProbe = child => {
    const before = child.checked()
    child.run()
    assert.equal(child.checked(), !before, `${child.id} 点一下要真的翻状态`)
    child.run()
    assert.equal(child.checked(), before, `${child.id} 再点一下回来`)
  }
  // 三条都是开关：勾选态与状态、点击与翻转走同一条链（上游三条都是 `DumbAwareToggleAction`）。
  for (const child of group.children) toggleProbe(child)
  assert.equal(group.children[0].checked(), referencesNavigateOnSingleClick.value, '勾选态跟着单击导航偏好')
  assert.equal(group.children[1].checked(), referencesSortAlphabetically.value, '勾选态跟着排序偏好')
  assert.equal(group.children[2].checked(), referencesInNewTab.value, '与 Window 菜单那一行是**同一份**状态')
})

test('「一键导航」已接 —— 单击偏好由结果选择模型消费，来源边界登记在册', () => {
  const todo = read('docs/source-todo.md')
  const section = todo.split('## 10.')[1] ?? ''
  assert.match(section, /一键导航|Navigate with Single Click/, '要逐条登记')
  assert.match(section, /结果选择态|选择模型/, '理由：本仓结果行有选择态，单击导航偏好由它消费')
  assert.match(section, /AutoScrollToSourceHandler/, '来源边界（上游 UsageView 没装单击 handler）要留痕')
  // 真状态、真消费链：偏好可持久化（localStorage 键），选择模型读它（面板 prop 由宿主给）。
  const contents = read('src/referenceContents.ts')
  assert.match(contents, /referencesNavigateOnSingleClick = ref\(readStoredFlag\(/, '偏好是有存档的 ref')
  assert.match(contents, /persistFlag\(NAVIGATE_ON_SINGLE_CLICK_KEY/, '翻转要写回存档')
  assert.match(read('src/components/ReferencePanel.vue'), /if \(props\.navigateOnSingleClick\) openUsage\(row\)/,
    '选择模型消费：开着时选中即导航')
  assert.match(read('src/components/ToolWindowView.vue'), /:navigate-on-single-click="referencesNavigateOnSingleClickEnabled\(\)"/,
    '宿主把偏好传给面板（不是死值）')
})

test('additionalGearActions 排在齿轮组最前，且只在挂内容的窗口上给', () => {
  assert.equal(TOOL_WINDOW_GEAR_SPEC[0].action, 'usage.viewOptions', '`ToolWindowImpl.kt:859-868` 里它排第一')
  assert.equal(TOOL_WINDOW_GEAR_SPEC[0].contentsScoped, true, '它属于挂着内容的那个窗口')
  assert.equal(TOOL_WINDOW_GEAR_SPEC[0].fromHost, true, '行由宿主按当前内容给')
  const host = usageViewGearRows('references')
  const find = id => (id === 'window.resizeToolWindow' ? { id, title: '调整工具窗口', run: () => {} } : undefined)
  assert.deepEqual(toolWindowGearRows(find, TOOL_WINDOW_GEAR_SPEC, true, host).map(row => row.id),
    ['usage.viewOptions', 'usage.groupBy', 'window.resizeToolWindow'], '底部齿轮：视图选项在最前，「分组」紧随其后（都来自引用表）')
  assert.deepEqual(toolWindowGearRows(find, TOOL_WINDOW_GEAR_SPEC, false, host).map(row => row.id),
    ['window.resizeToolWindow'], '侧栏齿轮拿不到它（不是那个窗口的内容）')
})

test('接线：宿主按当前底部内容给行，组行会被摊平渲染', () => {
  const app = read('src/App.vue')
  assert.match(app, /bottomGearHostRows: \(\) => usageViewGearRows\(bottomTab\.value\)/, '宿主要接上这一组')
  assert.match(read('src/components/ToolWindowGearRows.vue'), /v-for="child in row\.children/,
    '组行的成员摊平在下面（compact 组的形态），标题栏只负责渲染')
  const menu = read('src/menuUi.ts')
  assert.match(menu, /bottomGearHostRows = \(\) => \(\{\}\)/, '缺省 = 没有宿主行')
})
