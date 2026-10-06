import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_BOOKMARKS_VIEW, assignedMnemonics, bookmarkKey, bookmarkMnemonicRows, groupBookmarks, scrollTargetFor, stepSelection } from '../src/bookmarksView.ts'

const mark = (path, line, mnemonic) => (mnemonic === undefined ? { path, line } : { path, line, mnemonic })

// BookmarksViewState.kt:23-29 —— groupLineBookmarks = true，其余三个 false。
test('the view defaults match BookmarksViewState', () => {
  assert.deepEqual(DEFAULT_BOOKMARKS_VIEW, {
    groupLineBookmarks: true,
    rewriteBookmarkType: false,
    askBeforeDeletingLists: true,
    autoscrollToSource: false,
    autoscrollFromSource: false,
  })
})

// BookmarksView.GroupLineBookmarks：把行书签按文件分组。
test('grouping puts the bookmarks of one file under its own header', () => {
  const entries = [mark('src/a.cpp', 12), mark('src/b.cpp', 3), mark('src/a.cpp', 4)]
  const grouped = groupBookmarks(entries, true)
  assert.deepEqual(grouped.map(group => group.path), ['src/a.cpp', 'src/b.cpp'], 'group order follows first appearance')
  assert.deepEqual(grouped[0].entries.map(entry => entry.line), [4, 12], 'inside a group the lines are ascending')
  assert.deepEqual(grouped[1].entries.map(entry => entry.line), [3])
})

test('without grouping everything stays in one flat list in its original order', () => {
  const entries = [mark('src/a.cpp', 12), mark('src/b.cpp', 3), mark('src/a.cpp', 4)]
  const flat = groupBookmarks(entries, false)
  assert.equal(flat.length, 1)
  assert.equal(flat[0].path, '', 'the single group has no file header')
  assert.deepEqual(flat[0].entries.map(entry => entry.line), [12, 3, 4], 'the stored order is preserved')
})

test('an empty bookmark list produces no groups at all', () => {
  assert.deepEqual(groupBookmarks([], true), [])
  assert.deepEqual(groupBookmarks([], false), [])
})

// AutoscrollFromSource：编辑器切到某文件时滚到该文件第一条书签（行号最小的那条）。
test('the scroll target is the first bookmark of the active file', () => {
  const entries = [mark('src/a.cpp', 12), mark('src/b.cpp', 3), mark('src/a.cpp', 4)]
  assert.deepEqual(scrollTargetFor(entries, 'src/a.cpp'), mark('src/a.cpp', 4))
  assert.deepEqual(scrollTargetFor(entries, 'src/b.cpp'), mark('src/b.cpp', 3))
  assert.equal(scrollTargetFor(entries, 'src/c.cpp'), null, 'a file without bookmarks does not scroll')
  assert.equal(scrollTargetFor(entries, ''), null)
})

test('the key identifies one bookmark', () => {
  assert.equal(bookmarkKey(mark('src/a.cpp', 4)), 'src/a.cpp:4')
})

// AutoscrollToSource 的键盘导航按**可见顺序**移动，而不是数据顺序。
test('keyboard navigation walks the visible order', () => {
  const visible = [mark('src/a.cpp', 4), mark('src/a.cpp', 12), mark('src/b.cpp', 3)]
  assert.equal(stepSelection(visible, 'src/a.cpp:4', 1), 'src/a.cpp:12')
  assert.equal(stepSelection(visible, 'src/a.cpp:12', -1), 'src/a.cpp:4')
  assert.equal(stepSelection(visible, 'src/a.cpp:4', -1), 'src/a.cpp:4', 'the first row keeps the selection')
  assert.equal(stepSelection(visible, 'src/b.cpp:3', 1), 'src/b.cpp:3', 'the last row keeps the selection')
  assert.equal(stepSelection(visible, '', 1), 'src/a.cpp:4', 'with nothing selected, down starts at the first row')
  assert.equal(stepSelection(visible, '', -1), 'src/b.cpp:3', 'and up starts at the last row')
  assert.equal(stepSelection([], 'x', 1), null)
})

// 「转到助记符…」那一棵树（上游 `ShowTypeBookmarksAction`，动作名 `Go to Mnemonic…`，
// `platform/platform-resources-en/src/messages/ActionsBundle.properties:1332`；
// 标题 `popup.title.type.bookmarks=Go to Mnemonic`，
// `platform/lang-api/resources/messages/BookmarkBundle.properties:63`；键位 Ctrl+Shift+F11，
// `platform/platform-resources/src/keymaps/$default.xml:359-360`）。
// 行 = `BookmarkType.values().mapNotNull { getBookmark(it) }`
// （`platform/bookmarks/src/com/intellij/ide/bookmark/actions/ShowTypeBookmarksAction.kt:38-39`），
// 顺序是**枚举序**（1..9、0、A..Z，`platform/lang-api/src/com/intellij/ide/bookmark/BookmarkType.kt:19-31`），
// 一个键只有一条（`BookmarksManagerImpl.kt:159-166`），没有任何助记键时动作不可用（`:42`）。
test('按助记符的行模型：枚举序（1 先、0 在数字末）、一键一条、无助记键的不进来', () => {
  const entries = [
    { path: 'src/z.cpp', line: 1, mnemonic: '0' },
    { path: 'src/a.cpp', line: 2, mnemonic: '1' },
    { path: 'src/b.cpp', line: 3, mnemonic: 'A' },
    { path: 'src/c.cpp', line: 4 },
    { path: 'src/d.cpp' },
  ]
  assert.deepEqual(bookmarkMnemonicRows(entries).map(row => row.mnemonic), ['1', '0', 'A'],
    '1 在 0 前面是枚举序；没键的两条（行书签与文件书签）都不进这棵树')
  assert.deepEqual(bookmarkMnemonicRows(entries).map(row => row.entry.path), ['src/a.cpp', 'src/z.cpp', 'src/b.cpp'])
  assert.deepEqual(assignedMnemonics(entries), ['1', '0', 'A'], '上游 getAssignedTypes 也是排除 DEFAULT 的那一份')
  assert.deepEqual(bookmarkMnemonicRows([]), [], '一个助记键都没有 ⇒ 空表（上游此时把动作置灰）')
  assert.deepEqual(assignedMnemonics([{ path: 'x.cpp', line: 1 }]), [])
  // 同一个键被两条书签占着（重写没问 / 存档坏了）时只认**第一条**，与 `getBookmark(type)` 的 `find` 同形。
  const dup = [{ path: 'first.cpp', line: 1, mnemonic: '5' }, { path: 'second.cpp', line: 2, mnemonic: '5' }]
  assert.deepEqual(bookmarkMnemonicRows(dup).map(row => row.entry.path), ['first.cpp'])
  assert.deepEqual(assignedMnemonics(dup), ['5'], '集合去重')
  // 这条链的下游：按助记符过滤 = 在这份行里找那一个键。
  assert.equal(bookmarkMnemonicRows(entries).find(row => row.mnemonic === '0').entry.line, 1)
})
