// B5：`Bookmark` 行最后两块可移植行为的判据 —— **书签字体**（`getBookmarkFont`）。
//
// 上游 `platform/bookmarks/src/com/intellij/ide/bookmarks/Bookmark.java:95`：
// `getBookmarkFont()` 给**带助记键**的书签返回粗体，`BookmarkType.DEFAULT`（没有编号）的是常规体。
// 本仓的等价物是 `src/bookmarks.ts` 的 `bookmarkFontBold`，面板按它落 `.bookmark-bold`
// （`src/components/BookmarksPanel.vue` 的行与文件书签的组头两处）。
//
// 这里同时把「类型」的口径钉住：2026.2 的 `BookmarkType` 是**助记键枚举**
// （`platform/lang-api/.../BookmarkType.kt:24-45`：DIGIT_1..DIGIT_0 / LETTER_A..LETTER_Z / DEFAULT），
// 本仓早已落成 `Bookmark.mnemonic` + `BOOKMARK_MNEMONICS` + `normalizeMnemonic`
// （见 `docs/inventory/verdict-bookmarks.md` §C②），所以"粗体 = 有编号"这条就是它的渲染面。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { bookmarkFontBold, BOOKMARK_MNEMONICS, isFileBookmark, normalizeMnemonic } from '../src/bookmarks.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

test('带助记键的书签是粗体，没有编号的（DEFAULT）是常规体', () => {
  assert.equal(bookmarkFontBold({ path: 'a.ts', line: 3, mnemonic: 'A' }), true)
  assert.equal(bookmarkFontBold({ path: 'a.ts', line: 3, mnemonic: '0' }), true)
  assert.equal(bookmarkFontBold({ path: 'a.ts', line: 3 }), false)
  // 文件书签也能带编号（上游 FileBookmark 一样有 type）。
  assert.equal(bookmarkFontBold({ path: 'a.ts', mnemonic: 'Z' }), true)
  assert.equal(bookmarkFontBold({ path: 'a.ts' }), false)
})

test('「类型」就是助记键枚举：0-9 + A-Z，DEFAULT = 字段不存在', () => {
  assert.equal(BOOKMARK_MNEMONICS.length, 36, 'DIGIT_1..DIGIT_0 + LETTER_A..LETTER_Z')
  assert.equal(normalizeMnemonic('a'), 'A', '小写归一到大写')
  assert.equal(normalizeMnemonic(' 7 '), '7', '去空白')
  assert.equal(normalizeMnemonic('AA'), undefined, '多字符不是助记键')
  assert.equal(normalizeMnemonic('!'), undefined)
})

test('行/文件两档仍然是 `isFileBookmark` 说的那件事（没有行号 = 文件书签）', () => {
  assert.equal(isFileBookmark({ path: 'a.ts' }), true)
  assert.equal(isFileBookmark({ path: 'a.ts', line: 1 }), false)
})

test('接线：面板对行与文件书签的组头都落 bookmark-bold', () => {
  const panel = read('src/components/BookmarksPanel.vue')
  assert.match(panel, /bookmarkFontBold/, '面板要引这个纯函数')
  assert.match(panel, /'bookmark-bold': bookmarkFontBold\(entry\)/, '行书签的粗体绑定')
  assert.match(panel, /bookmarkFontBold\(fileBookmarks\.get\(group\.path\)!\)/, '文件书签组头的粗体绑定')
  assert.match(panel, /\.bookmark-bold \{ font-weight: 600; \}/, '粗体的实际样式')
})
