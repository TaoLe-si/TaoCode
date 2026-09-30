import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_BOOKMARKS_VIEW, bookmarkKey, groupBookmarks, scrollTargetFor, stepSelection } from '../src/bookmarksView.ts'

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
