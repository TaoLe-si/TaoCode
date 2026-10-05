// `BookmarkItem`（`platform/bookmarks/src/com/intellij/ide/bookmarks/BookmarkItem.java`）的判据：
//   · `speedSearchText()`（`:104`）= `file.getName() + " " + description`；
//   · `allowedToRemove()`（`:119`）= 恒 true，`removed()`（`:123-125`）落到 removeBookmark；
//   · 速度搜索本体沿用 `SpeedSearchBase` 的匹配/走序（本仓 `src/speedSearch.ts` 已按它实现），
//     面板接线（打字即开、上下键走命中、Esc/回车收起）在 `src/components/BookmarksPanel.vue`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { bookmarkRemovable, bookmarkSpeedSearchText, removeBookmark } from '../src/bookmarks.ts'
import { firstSpeedSearchHit, nextSpeedSearchHit, speedSearchKeyAction, speedSearchStepForKey } from '../src/speedSearch.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('速度搜索文本 = 文件名 + 描述（BookmarkItem.speedSearchText:104）', () => {
  assert.equal(bookmarkSpeedSearchText({ path: 'src/deep/Alpha.java', line: 3, text: '  void run()  ' }),
    'Alpha.java void run()', '文件名 + 行原文（trim 后）')
  assert.equal(bookmarkSpeedSearchText({ path: 'README.md', text: 'small scratch' }),
    'README.md small scratch', '文件书签同一个形状')
  assert.equal(bookmarkSpeedSearchText({ path: 'a/b/C.kt', line: 1 }),
    'C.kt', '没有描述时不留下尾随空格')
})

test('描述优先取自定义 description（与 Panel 的 bookmarkDescription 同序）', () => {
  assert.equal(bookmarkSpeedSearchText({ path: 'a/B.java', line: 2, text: 'line text', description: '选中那段' }),
    'B.java 选中那段')
})

test('匹配对象接上现有的 MinusculeMatcher：驼峰缩写/空格分隔都能命中', () => {
  const labels = [
    bookmarkSpeedSearchText({ path: 'src/Alpha.java', line: 1, text: 'void run()' }),
    bookmarkSpeedSearchText({ path: 'src/beta.java', line: 2, text: 'class Beta' }),
  ]
  assert.equal(firstSpeedSearchHit(labels, 'beta'), 1)
  assert.equal(firstSpeedSearchHit(labels, 'vr'), 0, 'camelCase 缩写命中 void run')
  assert.equal(firstSpeedSearchHit(labels, 'zzz'), -1)
  assert.equal(nextSpeedSearchHit(labels, 'alpha', 0, 1), 0, '只有一条命中时绕一圈回到原处')
})

test('allowedToRemove 恒 true；removed 落到 removeBookmark', () => {
  assert.equal(bookmarkRemovable(), true)
  const list = [{ path: 'a', line: 1 }, { path: 'b', line: 2, mnemonic: '4' }]
  assert.deepEqual(removeBookmark(list, list[1]), [{ path: 'a', line: 1 }])
})

test('走序按键与上游 SpeedSearchBase 的按键归属一致（复用 speedSearch.ts）', () => {
  assert.deepEqual(speedSearchStepForKey('ArrowDown'), { kind: 'next' })
  assert.deepEqual(speedSearchStepForKey('ArrowUp'), { kind: 'previous' })
  assert.equal(speedSearchStepForKey('x'), null)
  assert.equal(speedSearchKeyAction('Escape', 'a'), 'hide')
  assert.equal(speedSearchKeyAction('Enter', 'a'), 'accept')
  assert.equal(speedSearchKeyAction('Backspace', ''), 'ignore')
})

test('面板接线：SpeedSearchBar + 打字开搜 + 上下键走命中（BookmarksPanel.vue）', () => {
  const panel = read('src/components/BookmarksPanel.vue')
  assert.match(panel, /SpeedSearchBar/, '要挂上现成的搜索框展示件')
  assert.match(panel, /bookmarkSpeedSearchText/, '匹配文本必须来自 BookmarkItem.speedSearchText 的等价物')
  assert.match(panel, /firstSpeedSearchHit|nextSpeedSearchHit/, '命中定位复用 speedSearch.ts')
  assert.match(panel, /event\.key\.length === 1/, '无修饰键的可打印字符开始打字即开搜')
  assert.match(panel, /bookmarkRemovable\(\)/, '移除项要过 allowedToRemove 的等价判据')
})
