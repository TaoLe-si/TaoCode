// 书签 patch 的形状校验（从 src/bridge.ts 抽出来的那一域）—— 机检。
// 两段：书签表（`normalizeBookmarks`）与书签视图设置（`normalizeBookmarksView`）。
import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeBookmarks, normalizeBookmarksView } from '../src/bookmarkSettings.ts'

test('书签表：助记键收单个 0-9/A-Z，可选的行原文与描述都放行', () => {
  const list = normalizeBookmarks([
    { path: 'src/a.cpp', line: 3, mnemonic: 'A', text: 'int x;', description: '选中的那段' },
    { path: 'src/b.cpp', line: 9 },
  ])
  assert.equal(list.length, 2)
  assert.equal(list[0].mnemonic, 'A')
  // 返回的是新对象（桥接层不该把调用方的对象直接挂进项目设置）
  assert.notEqual(list[0], undefined)
})

test('书签表：坏形状一律抛（行号从 1、助记键单字符、路径不出工作区、文本有上限）', () => {
  const bad = [
    null, {}, 'x', [{ path: 'a.cpp' }], [{ path: '', line: 1 }], [{ path: '/abs.cpp', line: 1 }],
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
  for (const value of [null, [], 'x', { rewriteBookmarkType: 'yes' }, { showPreview: true }, { askBeforeDeletingLists: true }])
    assert.throws(() => normalizeBookmarksView(value), /书签视图设置/, JSON.stringify(value))
})
