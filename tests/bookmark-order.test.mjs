// 书签的排序口径（B5 §G 的 `BookmarkManager` 一行）：
// 上游 `BookmarkManager.getValidBookmarks`（`BookmarkManager.java:140-150`）两支 ——
//   `UISettings.sortBookmarks` 为真 ⇒ 按**位置**（`ContainerUtil.sorted`，Bookmark 的 Comparable）；
//   为假 ⇒ 按**加入顺序**（`Comparator.comparingInt(b -> b.index)`）。
// `UISettingsState.kt:249` `var sortBookmarks: Boolean by property(false)` ⇒ **默认 false**。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SORT_GROUP_LABEL, orderedBookmarks, sortGroupBookmarks, sortedBookmarks } from '../src/bookmarks.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const bm = (path, line) => ({ path, line })

// 加入顺序：数组顺序就是 `index` 顺序（本仓的持久化数组就是按加入顺序写的）。
const ADDED = [bm('b/B.java', 9), bm('a/A.java', 3), bm('b/B.java', 1)]

test('the default order is the order they were added', () => {
  assert.deepEqual(orderedBookmarks(ADDED, false).map(b => `${b.path}:${b.line}`), ['b/B.java:9', 'a/A.java:3', 'b/B.java:1'])
})

test('position order sorts by path then line', () => {
  assert.deepEqual(orderedBookmarks(ADDED, true).map(b => `${b.path}:${b.line}`), ['a/A.java:3', 'b/B.java:1', 'b/B.java:9'])
})

// 上游默认是 false —— 这一条钉住本仓的默认口径没有漂回"按位置"。
test('the upstream default is insertion order, not position', () => {
  assert.equal(orderedBookmarks(ADDED, false).map(b => b.line)[0], 9, '第一条仍是先加的那条')
  assert.deepEqual(orderedBookmarks([], false), [])
  assert.deepEqual(orderedBookmarks([], true), [])
})

// 两种口径都不改原数组（computed 里直接读 `bookmarks.value`）。
test('neither order mutates the input', () => {
  const input = [...ADDED]
  orderedBookmarks(input, false)
  orderedBookmarks(input, true)
  assert.deepEqual(input, ADDED)
})

// `sortedBookmarks` 仍是"按位置"那一支（既有调用点不动）。
test('sortedBookmarks stays the position order', () => {
  assert.deepEqual(sortedBookmarks(ADDED).map(b => `${b.path}:${b.line}`), ['a/A.java:3', 'b/B.java:1', 'b/B.java:9'])
})

// —— 组内排序（SortGroupBookmarksAction + Group.sortLater）——

test('sorting a group puts its own entries in position order', () => {
  assert.deepEqual(sortGroupBookmarks([bm('a/A.java', 9), bm('a/A.java', 2)]).map(b => b.line), [2, 9])
})

// 上游 `Group.sort` 里有一条 `if (list == groupBookmarks) return` —— 已经有序时不做事（不通知）。
test('an already sorted group is left as is', () => {
  const sorted = [bm('a/A.java', 2), bm('a/A.java', 9)]
  assert.deepEqual(sortGroupBookmarks(sorted), sorted)
})

test('file bookmarks (no line) sort first', () => {
  const withFile = [{ path: 'a/A.java' }, bm('a/A.java', 4)]
  assert.deepEqual(sortGroupBookmarks(withFile).map(b => b.line), [undefined, 4], '文件书签的行号是 -1')
})

// 文案取随 IDE 发货的中文语言包。
test('the action label comes from the shipped Chinese bundle', () => {
  assert.equal(SORT_GROUP_LABEL, '按类型和名称对书签进行排序', 'ActionsBundle.properties:76')
})

// —— 接线 ——

test('the panel offers the sort action on a group with more than one entry', () => {
  const panel = read('src/components/BookmarksPanel.vue')
  assert.match(panel, /v-if="group\.entries\.length > 1"/, '单条书签的组没有可排的')
  assert.match(panel, /emit\('sortGroup', group\.path\)/)
  assert.match(panel, /SORT_GROUP_LABEL/)
})

test('the action reaches the host and is persisted', () => {
  assert.match(read('src/components/ToolWindowView.vue'), /onBookmarkSortGroup/, '面板的事件要有人接')
  assert.match(read('src/toolViewContext.ts'), /onBookmarkSortGroup: \(path: string\) => sortBookmarkGroup\(path\)/)
  assert.match(read('src/App.vue'), /sortGroup: sortBookmarkGroup/, '宿主要把它接到 bookmarkActions')
  const actions = read('src/bookmarkActions.ts')
  assert.match(actions, /function sortGroup\(path: string\)/, '实现在 bookmarkActions')
  assert.match(actions, /persistBookmarks\(\)\s*\n\s*\}/, '排序要落盘（上游 groupBookmarks 是持久的）')
})

test('the ordering switch is registered on all four sides', () => {
  assert.match(read('src/settingsModel.ts'), /sortBookmarks: boolean;/)
  assert.match(read('src/settingsModel.ts'), /sortBookmarks: false,/)
  // 白名单 2026-10-04 从 src/bridge.ts 搬到了 src/previewSettings.ts（bridge 贴着机检上限）。
  assert.match(read('src/previewSettings.ts'), /sortBookmarks/)
  assert.match(read('native/settings_schema.hpp'), /"sortBookmarks"/)
  assert.match(read('native/settings_schema.cpp'), /\{"sortBookmarks", false\}/)
})
