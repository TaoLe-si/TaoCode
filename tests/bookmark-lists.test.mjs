// 命名书签列表（上游 `BookmarkGroup` / `GroupState`）—— 机检。
// 规则全部引自 `platform/bookmarks/src/com/intellij/ide/bookmark/BookmarksManagerImpl.kt` 与
// `ui/GroupInputValidator.kt`，逐条写在 src/bookmarkLists.ts 的注释里。
import test from 'node:test'
import assert from 'node:assert/strict'

import { addToListItem, createList, defaultListOf, deleteList, freeListName, listForBookmark, listNameError, listsFromLegacy, renameList, setDefaultList, toggleDefaultList } from '../src/bookmarkLists.ts'

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
