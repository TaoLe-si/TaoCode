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
  USAGE_OPEN_IN_NEW_TAB_TITLE, USAGE_SORT_TITLE, USAGE_VIEW_OPTIONS_TITLE,
  closeAllReferences, finishReferences, references, referencesInNewTab, referencesSortAlphabetically,
  sortUsages, startReferences,
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

test('齿轮组只在用法视图上出现，两条成员都是真的开关', () => {
  assert.equal(isUsageView('references'), true)
  for (const other of ['output', 'run', 'problems', 'terminal']) assert.equal(isUsageView(other), false, `${other} 不是用法视图`)
  assert.deepEqual(usageViewGearRows('output'), {}, '不是用法视图 ⇒ 整组不给（不留点了没用的行）')

  const rows = usageViewGearRows('references')
  const group = rows['usage.viewOptions']
  assert.ok(group, '用法视图要有「视图选项」这一组')
  assert.equal(group.title, USAGE_VIEW_OPTIONS_TITLE, 'group.view.options = 视图选项')
  assert.deepEqual(group.children.map(child => child.id), ['usage.sortAlphabetically', 'usage.openInNewTab'],
    '顺序照 :114-116 的 addAll（排序在"新标签页"之前）')
  assert.deepEqual(group.children.map(child => child.title), [USAGE_SORT_TITLE, USAGE_OPEN_IN_NEW_TAB_TITLE],
    '文案取随 IDE 发货的语言包：按字母顺序排列成员 / 在新标签页中打开结果')

  const sortRow = group.children[0]
  const before = referencesSortAlphabetically.value
  sortRow.run()
  assert.equal(referencesSortAlphabetically.value, !before, '点一下要真的翻状态')
  assert.equal(sortRow.checked(), !before, '勾选态跟着同一份状态')
  sortRow.run()
  assert.equal(referencesSortAlphabetically.value, before, '再点一下回来')

  const newTabRow = group.children[1]
  const wasNewTab = referencesInNewTab.value
  newTabRow.run()
  assert.equal(referencesInNewTab.value, !wasNewTab, '与 Window 菜单那一行是**同一份**状态')
  newTabRow.run()
})

test('「一键导航」没接 —— 它在登记表里，不是被忘掉的', () => {
  const todo = read('docs/source-todo.md')
  const section = todo.split('## 10.')[1] ?? ''
  assert.match(section, /一键导航|Navigate with Single Click/, '要逐条登记理由')
  assert.match(section, /选择模型/, '理由：本仓结果行单击即导航，缺选择态')
  assert.ok(!read('src/usageViewGear.ts').includes('autoscroll'), '不许在代码里留一个点了没反应的勾选项')
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
