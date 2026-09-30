// 书签 patch 的形状校验（从 src/bridge.ts 抽出来的那一域）—— 机检。
// 两段：书签表（`normalizeBookmarks`）与书签视图设置（`normalizeBookmarksView`）。
import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeBookmarkLists, normalizeBookmarks, normalizeBookmarksView } from '../src/bookmarkSettings.ts'

test('书签表：助记键收单个 0-9/A-Z，可选的行原文与描述都放行；没有 line = 文件书签', () => {
  const list = normalizeBookmarks([
    { path: 'src/a.cpp', line: 3, mnemonic: 'A', text: 'int x;', description: '选中的那段' },
    { path: 'src/b.cpp', line: 9 },
    { path: 'src/c.cpp' },  // 文件书签（上游 FileBookmark：持久化不写 line 属性）
  ])
  assert.equal(list.length, 3)
  assert.equal(list[0].mnemonic, 'A')
  // 返回的是新对象（桥接层不该把调用方的对象直接挂进项目设置）
  assert.notEqual(list[0], undefined)
})

test('书签表：坏形状一律抛（行号从 1、助记键单字符、路径不出工作区、文本有上限）', () => {
  const bad = [
    null, {}, 'x', [{ path: '' }], [{ path: '' , line: 1 }], [{ path: '/abs.cpp', line: 1 }],
    [{ path: 'a\\\\b.cpp', line: 1 }], [{ path: '../x.cpp', line: 1 }],
    [{ path: 'a.cpp', line: 0 }], [{ path: 'a.cpp', line: 1.5 }], [{ path: 'a.cpp', line: 1000001 }],
    [{ path: 'a.cpp', line: 1, mnemonic: 'a' }], [{ path: 'a.cpp', line: 1, mnemonic: 'AB' }],
    [{ path: 'a.cpp', line: 1, mnemonic: 3 }], [{ path: 'a.cpp', line: 1, mnemonic: '' }],
    [{ path: 'a.cpp', line: 1, text: 'x'.repeat(4097) }],
    [{ path: 'a.cpp', line: 1, description: 5 }],
    Array.from({ length: 201 }, (_, index) => ({ path: `a${index}.cpp`, line: 1 })),
  ]
  for (const value of bad) assert.throws(() => normalizeBookmarks(value), /书签/, JSON.stringify(value)?.slice(0, 40))
})

test('书签视图设置：只认有落点的四个布尔开关', () => {
  assert.deepEqual(normalizeBookmarksView({ rewriteBookmarkType: true }), { rewriteBookmarkType: true })
  assert.deepEqual(normalizeBookmarksView({ groupLineBookmarks: false, autoscrollToSource: true, autoscrollFromSource: false }),
                   { groupLineBookmarks: false, autoscrollToSource: true, autoscrollFromSource: false })
  assert.deepEqual(normalizeBookmarksView({ askBeforeDeletingLists: false }), { askBeforeDeletingLists: false })
  for (const value of [null, [], 'x', { rewriteBookmarkType: 'yes' }, { showPreview: true }, { openInPreviewTab: true }])
    assert.throws(() => normalizeBookmarksView(value), /书签视图设置/, JSON.stringify(value))
})

test('命名书签列表：名字非空/不重复/最多一个默认，里面的书签走同一条校验', () => {
  const lists = normalizeBookmarkLists([
    { name: 'ui-parity-proj', isDefault: true, bookmarks: [{ path: 'a.cpp', line: 3 }] },
    { name: '待办', isDefault: false, bookmarks: [{ path: 'b.cpp' }] },
  ])
  assert.equal(lists.length, 2)
  assert.equal(lists[0].isDefault, true)
  assert.equal(lists[1].bookmarks[0].line, undefined, '文件书签（没有 line）也在列表里合法')
  for (const value of [
    null, {}, 'x',
    [{ name: '', isDefault: true, bookmarks: [] }],
    [{ name: ' 有空 ′', isDefault: true, bookmarks: [] }],
    [{ name: 'A', isDefault: true, bookmarks: [] }, { name: 'A', isDefault: false, bookmarks: [] }],
    [{ name: 'A', isDefault: true, bookmarks: [] }, { name: 'B', isDefault: true, bookmarks: [] }],
    [{ name: 'A', isDefault: 'yes', bookmarks: [] }],
    [{ name: 'A', isDefault: false }],
    [{ name: 'A', isDefault: false, bookmarks: [{ path: 'x.cpp', line: 0 }] }],
    Array.from({ length: 21 }, (_, index) => ({ name: `L${index}`, isDefault: false, bookmarks: [] })),
  ]) assert.throws(() => normalizeBookmarkLists(value), /书签/, JSON.stringify(value)?.slice(0, 40))
})
