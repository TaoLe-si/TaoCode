// 命名书签列表（上游 `BookmarkGroup` / `GroupState`）—— 机检。
// 规则全部引自 `platform/bookmarks/src/com/intellij/ide/bookmark/BookmarksManagerImpl.kt` 与
// `ui/GroupInputValidator.kt`，逐条写在 src/bookmarkLists.ts 的注释里。
import test from 'node:test'
import assert from 'node:assert/strict'

import { addToListItem, createList, defaultListOf, deleteList, firstListHolding, freeListName, listForBookmark, listHolds, listsHolding, listNameError, listsFromLegacy, panelSections, removeFromFirstHolder, renameList, setDescriptionInList, setDefaultList, toggleDefaultList } from '../src/bookmarkLists.ts'

const list = (name, isDefault = false, bookmarks = []) => ({ name, isDefault, bookmarks })

test('列表名：空白不算错（还没输入），重名才算；编辑中的那个自己不算重名', () => {
  const lists = [list('笔记', true), list('待办')]
  assert.equal(listNameError('', lists), '')
  assert.equal(listNameError('   ', lists), '')
  assert.equal(listNameError('新名字', lists), '')
  assert.equal(listNameError(' 笔记 ', lists), '名称已存在', '去掉空白后比对')
  assert.equal(listNameError('笔记', lists, lists[0]), '', '给自己改名不算冲突')
})

test('被占用的名字依次试 名字 (1)…(99)（上游 findValidName:27-35）', () => {
  const lists = [list('新建列表'), list('新建列表 (1)'), list('新建列表 (2)')]
  assert.equal(freeListName('新建列表', lists), '新建列表 (3)')
  assert.equal(freeListName('没被占用', lists), '没被占用')
})

test('默认列表只有一个；删掉默认列表后就没有默认（Group.remove:638-647）', () => {
  const a = list('A'), b = list('B')
  const withA = setDefaultList([a, b], a)
  assert.equal(defaultListOf(withA).name, 'A')
  const withB = setDefaultList(withA, withA[1])  // 按身份认目标：要传列表里的那一个
  assert.deepEqual(withB.map(entry => entry.isDefault), [false, true], '旧的默认标记要被清掉')
  const gone = deleteList(withB, withB[1])
  assert.deepEqual(gone.map(entry => entry.name), ['A'])
  assert.equal(defaultListOf(gone), undefined, '不会自动指认下一个')
  assert.deepEqual(toggleDefaultList(withA, withA[0]).map(entry => entry.isDefault), [false, false], '「取消标记为默认」')
})

test('新建列表：可带「用作默认列表」；重命名不动默认标记', () => {
  const lists = createList([list('A', true)], '笔记', false)
  assert.deepEqual(lists.map(entry => [entry.name, entry.isDefault]), [['A', true], ['笔记', false]])
  const asDefault = createList([list('A', true)], '笔记', true)
  assert.deepEqual(asDefault.map(entry => [entry.name, entry.isDefault]), [['A', false], ['笔记', true]])
  assert.deepEqual(renameList(asDefault, asDefault[1], ' 改名 ').map(entry => entry.name), ['A', '改名'])
})

test('行书签只有一个家：加到新列表时从旧列表摘掉；文件书签可以同时在多个列表', () => {
  const line = { path: 'a.cpp', line: 3 }
  const file = { path: 'a.cpp' }
  const lists = [list('A', true, [line, file]), list('B')]
  const moved = addToListItem(lists, lists[1], line)
  assert.deepEqual(moved[0].bookmarks.map(entry => entry.line), [undefined], '行书签离开 A（文件书签留着）')
  assert.deepEqual(moved[1].bookmarks.map(entry => entry.line), [3], '行书签进了 B')
  const copied = addToListItem(lists, lists[1], file)
  assert.deepEqual(copied[0].bookmarks.map(entry => entry.line), [3, undefined], '文件书签在 A 里不动')
  assert.deepEqual(copied[1].bookmarks.map(entry => entry.line), [undefined], '同时也在 B 里')
})

test('一条书签该进哪个列表：行书签看它自己的家，其余进默认列表（findGroupsToAdd:200-207）', () => {
  const line = { path: 'a.cpp', line: 3 }
  const lists = [list('A', false, [line]), list('B', true)]
  assert.equal(listForBookmark(lists, line).name, 'A', '行书签已经属于 A，就不再"自动进默认"')
  assert.equal(listForBookmark(lists, { path: 'other.cpp', line: 1 }).name, 'B', '新书签进默认列表')
  assert.equal(listForBookmark([list('A')], { path: 'x.cpp', line: 1 }).name, 'A', '没有默认列表时退给第一张')
  assert.equal(listForBookmark([], { path: 'x.cpp', line: 1 }), undefined, '一个列表都没有 ⇒ 调用方该弹"创建书签列表"')
})

test('旧状态迁移：平铺的书签成为**默认列表**，名字取项目名（noStateLoaded:93-95）', () => {
  const lists = listsFromLegacy([{ path: 'a.cpp', line: 3, text: 'x' }], 'ui-parity-proj')
  assert.deepEqual(lists.map(entry => [entry.name, entry.isDefault]), [['ui-parity-proj', true]])
  assert.equal(lists[0].bookmarks.length, 1)
})

// `AddAnotherBookmarkAction`（`platform/bookmarks/src/com/intellij/ide/bookmark/actions/AddAnotherBookmarkAction.kt:16-32`）：
// · `update` 里 `if (bookmark is LineBookmark) return false` ⇒ 行书签**不出现**这一行；
// · 动作体是 `manager.add(bookmark, type)` ⇒ 挑一张列表再加进去（本仓的 `runWithChosenList` 捷径）。
test('「添加另一书签…」只给文件书签、且走"挑列表再加"的捷径', async () => {
  const panel = await import('node:fs').then(fs => fs.readFileSync(new URL('../src/components/BookmarksPanel.vue', import.meta.url), 'utf8'))
  assert.match(panel, /<button v-if="isFileBookmark\(rowMenu\.entry\)" role="menuitem" @click="addToAnotherList\(\)">添加另一书签…<\/button>/,
    '行书签那一行不该出现「添加另一书签…」（上游 update 直接 return false）')
  assert.match(panel, /function addToAnotherList\(\) \{[\s\S]{0,220}?runWithChosenList\(name => addBookmarkToNamedList\(name, entry\)\)/,
    '挑列表的捷径 + 加进那张列表（没有列表先建、只有一张直接用、多张弹选择）')
})

// 三处菜单挂点（上游 `popup@ExpandableBookmarkContextMenu` 挂在 `EditorTabPopupMenu` /
// `ProjectViewPopupMenu` 上，见 platform/bookmarks/resources/intellij.platform.bookmarks.xml:222-227）：
// 编辑器标签页与项目视图都要有 ToggleBookmark / EditBookmark / AddAnotherBookmark 这三条，
// 且 AddAnotherBookmark 只在**文件书签已存在**时出现（`AddAnotherBookmarkAction.update:16-22`）。
test('编辑器标签页与项目视图菜单都有文件书签那三条，且"添加另一书签"要已有书签', async () => {
  const fs = await import('node:fs')
  const app = fs.readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
  // 标签页那一份 markup 2026-10-04 搬进了 src/components/TabContextMenu.vue（App.vue 贴上限），
  // 判据跟着搬家 —— 查的东西一个字没变。它经 ctx 取函数，所以那边写的是 `ctx.bookmarkFile(path)`。
  const tabs = fs.readFileSync(new URL('../src/components/TabContextMenu.vue', import.meta.url), 'utf8')
  const runtime = fs.readFileSync(new URL('../src/bookmarkActions.ts', import.meta.url), 'utf8')
  // 用"同一行里同时出现"来判，不写正则（引号/括号的转义在这条链上已经错过两次）。
  const linesOf = text => text.split(String.fromCharCode(10))
  const has = (text, needle, ...also) => linesOf(text).some(line => line.includes(needle) && also.every(part => line.includes(part)))
  const cases = [['标签页', tabs, 'ctx.bookmarkFile(path)', 'ctx.editBookmarkAt(path)', 'ctx.addFileBookmarkToAnotherList(path)'],
                 ['项目视图', app, 'bookmarkFile(treeMenu.entry.path)', 'editBookmarkAt(treeMenu.entry.path)', 'addFileBookmarkToAnotherList(treeMenu.entry.path)']]
  for (const [menu, source, addRow, editRow, anotherRow] of cases) {
    assert.ok(has(source, addRow), `${menu}菜单没有「添加/删除书签」那一行`)
    assert.ok(has(source, "删除书签", editRow), `${menu}菜单没有「编辑描述」那一行`)
    assert.ok(has(source, "删除书签", anotherRow), `${menu}菜单没有「添加另一书签…」那一行（且要跟着"已有书签"的门）`)
  }
  // 动作体：只认**文件**书签，且走"挑一张列表再加"的捷径。
  assert.match(runtime, /function addFileBookmarkToAnotherList\(path: string\) \{[\s\S]{0,260}?item\.path === path && item\.line === undefined/,
    '行书签不该出现这个入口（上游 update 直接 return false）')
  assert.match(runtime, /runWithChosenList\(name => addBookmarkToNamedList\(name, entry\)\)/,
    '加进另一张列表要复用挑列表的捷径')
})

// 「移除书签」与「编辑描述」都要落在**这一行所在的那张列表**里：
//   · 树上删的是被点那一段的列表（`ui/tree/BookmarkListProvider.kt:54-57`
//     的 `node.value?.let { node.bookmarkGroup?.remove(it) }`；`Group.remove(bookmark)` =
//     `BookmarksManagerImpl.kt:636` 的 `removeFromGroup(this, bookmark)`）；
//   · 描述也**按列表各存一份**（`BookmarksManagerImpl.kt:598-609` 把 description 记在 `InGroupInfo`，
//     `setDescription:586-594` 只写那一份），入口 `actions/EditBookmarkAction.kt:27` 取
//     `manager.getGroups(bookmark).firstOrNull()`（`getGroups` 的口径 = `BookmarksManagerImpl.kt:146-148`）。
// 本仓原先这两处只动默认列表那张平铺表 ⇒ "只存在于命名列表里"的书签点 X / 改描述**毫无反应**。
test('按列表身份删/改：第一张持有它的列表优先，都不持有时交回默认列表', () => {
  const line = { path: 'a.cpp', line: 3 }
  const file = { path: 'b.cpp' }
  const lists = [list('待办', false, [line]), list('笔记', false, [{ ...file, description: '旧' }])]
  assert.equal(listHolds(lists[0], line), true)
  assert.equal(listHolds(lists[1], line), false)
  assert.deepEqual(listsHolding(lists, file).map(entry => entry.name), ['笔记'])
  assert.equal(firstListHolding(lists, file).name, '笔记')
  assert.equal(firstListHolding(lists, { path: '没有.cpp', line: 1 }), undefined)

  const removed = removeFromFirstHolder(lists, line)
  assert.equal(removed.removed, true)
  assert.deepEqual(removed.lists[0].bookmarks, [], '从「待办」里删掉')
  assert.equal(removed.lists[1], lists[1], '别的那张列表一个字不动')
  const nothing = removeFromFirstHolder(removed.lists, { path: 'a.cpp', line: 3 })
  assert.equal(nothing.removed, false, '没有列表持有 ⇒ 交给默认列表处理（不是静默失败）')

  const edited = setDescriptionInList(lists, lists[1], file, '新描述')
  assert.equal(edited[1].bookmarks[0].description, '新描述')
  assert.equal(lists[1].bookmarks[0].description, '旧', '纯函数：不改调用方那份数组')
  const cleared = setDescriptionInList(edited, edited[1], file, '   ')
  assert.equal('description' in cleared[1].bookmarks[0], false, '空白 = 清掉自定义描述（回到行原文那一支）')
})

// 「只有一个默认列表」是上游的硬约束（`Group.isDefault` 的 setter 顺手清掉旧默认，
// `BookmarksManagerImpl.kt:529-534`），而本仓的默认列表**恒等于**历史字段 `bookmarks` 那一份。
// 存档里允许一张命名列表自带 `isDefault: true`（`tests/bookmark-settings.test.mjs` 就钉着这条），
// 渲染成两段「默认」就与那条约束冲突 —— 宿主的另一处取数（`src/toolViewContext.ts`）早就是筛掉的。
test('面板的段：命名列表在前、默认列表最后，且只有一段带「默认」标记', () => {
  const named = [list('待办', false, [{ path: 'a.cpp', line: 1 }]), list('越权的默认', true, [{ path: 'b.cpp' }])]
  const sections = panelSections(named, [{ path: 'c.cpp', line: 9 }], 'ui-parity-proj')
  assert.deepEqual(sections.map(section => [section.name, section.isDefault]),
    [['待办', false], ['越权的默认', false], ['ui-parity-proj', true]],
    '命名列表里那个 isDefault 不参与渲染：默认列表只有历史字段那一份')
  assert.equal(sections.filter(section => section.isDefault).length, 1, '两段「默认」= 与上游的单一默认冲突')
  assert.deepEqual(sections[2].entries, [{ path: 'c.cpp', line: 9 }], '默认列表段用的就是传进来的那份')
  assert.deepEqual(panelSections([], [], 'proj').map(section => section.name), ['proj'], '没有命名列表时仍有一段')
  const shape = panelSections(named, [], 'proj')
  assert.deepEqual(Object.keys(shape[0]).sort(), ['entries', 'isDefault', 'name'], '面板的 PanelList 形状')
})
