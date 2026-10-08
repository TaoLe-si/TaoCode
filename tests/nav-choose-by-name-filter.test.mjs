// 「按类型过滤」条（`src/navChooseByNameFilter.ts`）—— 上游 goto-by-name 弹层右上角那条过滤条。
//
// 上游依据（逐条，已按行核过）：
//   · `platform/lang-impl/src/com/intellij/ide/util/gotoByName/ChooseByNameFilter.java:40` 类本体；
//     开关的点亮条件 `isActive()` 在 **:82-84**（`!getFilteredOutFileTypeNames().isEmpty()`），
//     工具条 **:87** 建、**:95** `popup.setToolArea(...)` 挂到弹层右上角；
//   · 同文件 **:101-117** `createChooserPanel()` = 多选清单 + 三个按钮：
//     All `setAllElementsMarked(true)`（**:107**）/ None `setAllElementsMarked(false)`（**:110**）/
//     Invert `invertSelection()`（**:113**）；文案 `platform/lang-api/resources/messages/LangBundle.properties:372-374`；
//   · `platform/lang-impl/src/com/intellij/ide/util/gotoByName/FilteringGotoByModel.java:45-52` `acceptItem`
//     （`filterValueFor(item)` 在 **:54**）：取不到过滤值一律接受；
//   · `platform/lsp-impl/src/impl/features/workspaceSymbol/LspWorkspaceSymbolContributor.kt:69`/`:86`
//     —— LSP 这一族本来就是按 `SymbolKind` 决定收不收，所以本仓的过滤维度取 SymbolKind 分组；
//   · 「转到类」那一档的四类 = `platform/lsp-impl/src/impl/features/workspaceSymbol/LspGoToClassContributor.kt:7-12`
//     （Class 5 / Enum 10 / Interface 11 / Struct 23），与 `Ctrl+N` 共用 `src/lspSymbolBridge.ts:58` 的常量。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CLASS_GROUP_KINDS, SYMBOL_FILTER_GROUPS, SYMBOL_FILTER_GROUP_IDS, SYMBOL_FILTER_STORAGE_KEY,
  acceptSymbolKind, filterActionActive, filterGroupOfKind, filterSymbols, hiddenAfterAll, hiddenAfterNone,
  hiddenSymbolGroups, invertHidden, isDegenerateHidden, readHiddenGroups, symbolFilterRows, toggleHiddenGroup,
  visibleGroupsOf,
} from '../src/navChooseByNameFilter.ts'
import { createNavigateMenuRows } from '../src/menus/navigateMenu.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('分组表：四档、顺序稳定、兜底档 kinds 为 null', () => {
  assert.deepEqual(SYMBOL_FILTER_GROUP_IDS, ['class', 'method', 'field', 'other'])
  assert.equal(SYMBOL_FILTER_GROUPS.length, 4)
  assert.equal(SYMBOL_FILTER_GROUPS.at(-1).kinds, null, '「其它」是取不到归属时的兜底档（上游 acceptItem 的「取不到值就接受」）')
})

test('「类」那一档 = 上游 LspGoToClassContributor 的四类，与 Ctrl+N 同一份常量', () => {
  assert.deepEqual([...CLASS_GROUP_KINDS], [5, 10, 11, 23])
})

test('filterGroupOfKind：每一档都能落对，未知/缺省 kind 落兜底档', () => {
  assert.equal(filterGroupOfKind(5), 'class')
  assert.equal(filterGroupOfKind(23), 'class')
  assert.equal(filterGroupOfKind(6), 'method')
  assert.equal(filterGroupOfKind(9), 'method')   // Constructor
  assert.equal(filterGroupOfKind(12), 'method')  // Function
  assert.equal(filterGroupOfKind(8), 'field')
  assert.equal(filterGroupOfKind(14), 'field')   // Constant
  assert.equal(filterGroupOfKind(1), 'other')    // File
  assert.equal(filterGroupOfKind(26), 'other')   // TypeParameter：没有专门一档 → 兜底
  assert.equal(filterGroupOfKind(undefined), 'other')
  assert.equal(filterGroupOfKind(Number.NaN), 'other')
})

test('acceptSymbolKind / filterSymbols：没排除任何类别时原样全收，排除的那档整档消失且不乱序', () => {
  const items = [{ name: 'A', kind: 5 }, { name: 'b', kind: 6 }, { name: 'c', kind: 8 }, { name: 'd', kind: 1 }]
  assert.deepEqual(filterSymbols(items, []), items)
  assert.deepEqual(filterSymbols(items, ['method', 'other']).map(item => item.name), ['A', 'c'])
  assert.equal(acceptSymbolKind(5, []), true)
  assert.equal(acceptSymbolKind(5, ['class']), false)
  assert.equal(acceptSymbolKind(undefined, ['method']), true, '兜底档没被排除就收（上游「取不到过滤值一律接受」同效）')
})

test('visibleGroupsOf 是排除集合的补集（上游存的是被排除的那份）', () => {
  assert.deepEqual([...visibleGroupsOf([])], SYMBOL_FILTER_GROUP_IDS)
  assert.deepEqual([...visibleGroupsOf(['class', 'field'])], ['method', 'other'])
})

test('开关的点亮条件 = 存在被排除的类别（上游 isActive，ChooseByNameFilter.java:82-84）', () => {
  assert.equal(filterActionActive([]), false)
  assert.equal(filterActionActive(['class']), true)
})

test('All / None / Invert 三钮（:107/:110/:113）', () => {
  assert.deepEqual(hiddenAfterAll(), [])
  assert.deepEqual([...hiddenAfterNone()], SYMBOL_FILTER_GROUP_IDS)
  assert.deepEqual(invertHidden([]), [...SYMBOL_FILTER_GROUP_IDS], '全选中 → 反选 = 全排除')
  assert.deepEqual(invertHidden([...SYMBOL_FILTER_GROUP_IDS]), [], '全排除 → 反选 = 全选中')
  assert.deepEqual(invertHidden(['class', 'other']), ['method', 'field'], '反选就是补集')
  assert.deepEqual(invertHidden(invertHidden(['method'])), ['method'], '两下回到原样')
})

test('单条勾选：已知 id 才生效，重复勾同一个不会写坏状态', () => {
  assert.deepEqual(toggleHiddenGroup([], 'class'), ['class'])
  assert.deepEqual(toggleHiddenGroup(['class'], 'class'), [])
  assert.deepEqual(toggleHiddenGroup(['class'], 'method'), ['class', 'method'])
  assert.deepEqual(toggleHiddenGroup(['class'], 'nope'), ['class'])
  assert.notEqual(toggleHiddenGroup(['class'], 'nope'), ['class'], '未知 id 也返回新数组，不改入参')
})

test('isDegenerateHidden：只有全部类别都被排除时才是退化态（菜单标题用它换措辞）', () => {
  assert.equal(isDegenerateHidden([]), false)
  assert.equal(isDegenerateHidden(['class', 'method', 'field']), false)
  assert.equal(isDegenerateHidden([...SYMBOL_FILTER_GROUP_IDS]), true)
})

test('持久化：坏数据退回「没过滤」，已知 id 去重，未知 id 丢掉（不判成损坏）', () => {
  assert.equal(SYMBOL_FILTER_STORAGE_KEY, 'taocode.gotoSymbolFilter')
  assert.deepEqual(readHiddenGroups(null), [])
  assert.deepEqual(readHiddenGroups(''), [])
  assert.deepEqual(readHiddenGroups('不是 JSON'), [])
  assert.deepEqual(readHiddenGroups('{"class":true}'), [])
  assert.deepEqual(readHiddenGroups('["class", 5, "class", "nope", "field"]'), ['class', 'field'])
})

test('界面态与呈现：默认四档全可见，symbolFilterRows 给菜单用的就是这份', () => {
  const before = [...hiddenSymbolGroups.value]
  try {
    hiddenSymbolGroups.value = ['method']
    assert.deepEqual(symbolFilterRows().map(row => `${row.id}:${row.visible ? 'v' : 'h'}`), ['class:v', 'method:h', 'field:v', 'other:v'])
    assert.deepEqual(symbolFilterRows([]).map(row => row.visible), [true, true, true, true])
  } finally { hiddenSymbolGroups.value = before }
})

test('接线：导航菜单里那条过滤条真的驱动状态（不是只过自己测试的死模块）', () => {
  const rows = createNavigateMenuRows({})
  const submenu = rows.find(row => row.id === 'navigate.filterByType')
  assert.ok(submenu, '「按类型过滤」这一行在菜单里')
  const children = submenu.childrenOf()
  assert.deepEqual(children.filter(row => !row.rule).map(row => row.id), [
    'navigate.filter.class', 'navigate.filter.method', 'navigate.filter.field', 'navigate.filter.other',
    'navigate.filter.all', 'navigate.filter.none', 'navigate.filter.invert',
  ], '多选清单四档 + All/None/Invert 三钮（上游 :101-117 的形状）')

  const before = [...hiddenSymbolGroups.value]
  try {
    const classRow = children.find(row => row.id === 'navigate.filter.class')
    assert.equal(classRow.checked(), true, '默认没排除')
    hiddenSymbolGroups.value = []
    classRow.run()
    assert.deepEqual(hiddenSymbolGroups.value, ['class'], '点一下 = 排除这一档')
    assert.equal(classRow.checked(), false)
    assert.match(submenu.title(), /^按类型过滤（已排除 /, '标题里的点亮信息（上游 isActive 的可见形式）')
    children.find(row => row.id === 'navigate.filter.all').run()
    assert.deepEqual(hiddenSymbolGroups.value, [])
    assert.equal(submenu.title(), '按类型过滤', '一个都没排除时按钮是灭的')
    children.find(row => row.id === 'navigate.filter.none').run()
    assert.deepEqual(hiddenSymbolGroups.value, [...SYMBOL_FILTER_GROUP_IDS])
    assert.match(submenu.title(), /已排除全部类别/)
    children.find(row => row.id === 'navigate.filter.invert').run()
    assert.deepEqual(hiddenSymbolGroups.value, [], '反选 = 补集')
  } finally { hiddenSymbolGroups.value = before }

  const nav = read('src/lspNavigation.ts')
  assert.match(nav, /from '\.\/navChooseByNameFilter\.ts'/, '值 import 必须带扩展名')
  assert.match(nav, /filterSymbols\(documentSymbolEntries\(/, '文件符号列表过这一档')
  assert.match(nav, /mergeWorkspaceSymbols\(\[filterSymbols\(symbols, hiddenSymbolGroups\.value\), contributed\]/, '工作区符号在合并前过这一档')
  assert.match(nav, /watch\(hiddenSymbolGroups/, '开关一变就重算当前列表')
})

test('接线：Ctrl+U / Ctrl+Shift+T 两行只在宿主真的给了动作时才出现（不放假控件）', () => {
  assert.equal(createNavigateMenuRows({}).some(row => row.id === 'navigate.super'), false)
  assert.equal(createNavigateMenuRows({}).some(row => row.id === 'navigate.test'), false)
  const wired = createNavigateMenuRows({ gotoSuper: () => 0, gotoTest: () => 0, active: { value: { path: 'src/main/java/FooTest.java' } }, workspace: { value: {} } })
  const superRow = wired.find(row => row.id === 'navigate.super')
  assert.equal(superRow.keys, 'Ctrl U', '$default.xml:251-253')
  const testRow = wired.find(row => row.id === 'navigate.test')
  assert.equal(testRow.keys, 'Ctrl Shift T', '$default.xml:254-256')
  assert.equal(testRow.title(), '转到被测对象', '当前文件是测试 → 标题走「被测对象」那一档')
})
