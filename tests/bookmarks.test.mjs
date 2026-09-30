import test from 'node:test'
import assert from 'node:assert/strict'

import { BOOKMARK_MNEMONICS, BOOKMARK_TEXT_LIMIT, bookmarkAnchor, bookmarkDescription, bookmarkOwner, isFileBookmark, nextBookmark, normalizeMnemonic, placeBookmark, reconcileBookmarks, removeBookmark, sortedBookmarks, toggleFileBookmark, withoutMnemonic } from '../src/bookmarks.ts'

test('F11 adds a bookmark on the line and clears it again', () => {
  const once = placeBookmark([], 'src/a.cpp', 12)
  assert.deepEqual(once, [{ path: 'src/a.cpp', line: 12 }])
  assert.equal('mnemonic' in once[0], false, 'a plain bookmark carries no digit key')
  assert.deepEqual(placeBookmark(once, 'src/a.cpp', 12), [])
  assert.deepEqual(placeBookmark(once, 'src/a.cpp', 13), [once[0], { path: 'src/a.cpp', line: 13 }])
})

test('一个已被占用的助记键改贴到新行：老的那条行书签被删掉（上游 rewriteType:285-295）', () => {
  // 上游不是"把编号从老的那条摘下来"：`rewriteType` 对行书签走的是 `removeFromAllGroups`
  // （整条删掉），所以这里老书签也消失 —— 真机上点"重写"就是这个效果。
  const first = placeBookmark([], 'src/a.cpp', 10, '3')
  const moved = placeBookmark(first, 'src/b.cpp', 7, '3')
  assert.deepEqual(moved, [{ path: 'src/b.cpp', line: 7, mnemonic: '3' }])
  assert.equal(bookmarkOwner(moved, '3').path, 'src/b.cpp')
  assert.equal(bookmarkOwner(moved, '0'), undefined, 'an unused mnemonic has no owner')
})

test('the same digit on the same line is a toggle off', () => {
  const marked = placeBookmark([], 'src/a.cpp', 10, '9')
  assert.deepEqual(placeBookmark(marked, 'src/a.cpp', 10, '9'), [])
  const renamed = placeBookmark(marked, 'src/a.cpp', 10, '1')
  assert.deepEqual(renamed, [{ path: 'src/a.cpp', line: 10, mnemonic: '1' }], 'a different digit renames it')
  assert.deepEqual(placeBookmark(renamed, 'src/a.cpp', 10), [], 'F11 removes a digit bookmark outright')
})

test('the walk follows document order and wraps around the project', () => {
  const list = [
    { path: 'src/b.cpp', line: 3 },
    { path: 'src/a.cpp', line: 40 },
    { path: 'src/a.cpp', line: 5, mnemonic: 1 },
  ]
  assert.deepEqual(sortedBookmarks(list).map(entry => `${entry.path}:${entry.line}`),
    ['src/a.cpp:5', 'src/a.cpp:40', 'src/b.cpp:3'])
  assert.equal(nextBookmark(list, 'src/a.cpp', 5, false).line, 40)
  assert.equal(nextBookmark(list, 'src/a.cpp', 40, false).path, 'src/b.cpp', 'the walk crosses into the next file')
  assert.equal(nextBookmark(list, 'src/b.cpp', 3, false).path, 'src/a.cpp', 'it wraps to the very first one')
  assert.equal(nextBookmark(list, 'src/b.cpp', 3, true).line, 40)
  assert.equal(nextBookmark(list, 'src/a.cpp', 5, true).path, 'src/b.cpp', 'backwards wraps to the last')
  assert.equal(nextBookmark(list, 'src/a.cpp', 1, true).line, 3, 'before the first it still lands somewhere')
  assert.equal(nextBookmark([], 'src/a.cpp', 1, false), undefined, 'no bookmarks means no jump')
})

test('the panel can drop one entry without touching the rest', () => {
  const list = [{ path: 'a', line: 1 }, { path: 'b', line: 2, mnemonic: 4 }]
  assert.deepEqual(removeBookmark(list, list[1]), [{ path: 'a', line: 1 }])
  assert.deepEqual(removeBookmark(list, { path: 'c', line: 9 }), list)
})

// 编辑后对账（上游 BookmarkManager.beforeDocumentChange + documentChanged，:430-536）
test('越界的书签被删掉并记下原文；原文回到同一行号就放回去', () => {
  const before = ['a', 'b', 'c', 'd'].join(String.fromCharCode(10))
  const placed = placeBookmark([], 'x.java', 4, undefined, 'd')
  // 第一次对账：行还在 ⇒ 留着，并把原文刷成当前那一行
  const first = reconcileBookmarks(placed, 'x.java', before)
  assert.deepEqual(first.list.map(b => [b.line, b.text]), [[4, 'd']])
  assert.deepEqual(first.dropped, [])
  // 删掉最后一行 ⇒ 越界被丢（记着行号与原文）
  const shorter = ['a', 'b', 'c'].join(String.fromCharCode(10))
  const second = reconcileBookmarks(first.list, 'x.java', shorter, first.dropped)
  assert.deepEqual(second.list, [])
  assert.deepEqual(second.dropped.map(b => [b.line, b.text]), [[4, 'd']])
  // 撤销（行又回来了）⇒ 放回原位
  const back = reconcileBookmarks(second.list, 'x.java', before, second.dropped)
  assert.deepEqual(back.list.map(b => [b.line, b.text, b.mnemonic]), [[4, 'd', undefined]])
  assert.deepEqual(back.dropped, [])
})

test('别的文件的书签不参与本文件的对账', () => {
  const list = [{ path: 'y.java', line: 9, text: 'zz' }]
  const out = reconcileBookmarks(list, 'x.java', 'a' + String.fromCharCode(10) + 'b')
  assert.deepEqual(out.list, list)
  assert.deepEqual(out.dropped, [])
})

test('单行上移的特例：原文出现在两行之前（上游 :499-506 的 line -= 2）', () => {
  const dropped = [{ path: 'x.java', line: 5, text: 'moved' }]
  const content = ['one', 'two', 'moved', 'four', 'five'].join(String.fromCharCode(10))
  const out = reconcileBookmarks([], 'x.java', content, dropped)
  assert.deepEqual(out.list.map(b => [b.line, b.text]), [[3, 'moved']])
})

test('没有原文的老书签（旧数据）只在行还在时保留；空原文按上游那一句照样能放回', () => {
  const NL = String.fromCharCode(10)
  const legacy = [{ path: 'x.java', line: 2 }]
  // 行还在（第 2 行是空行）⇒ 保留并把原文补成 ''
  const kept = reconcileBookmarks(legacy, 'x.java', 'a' + NL, [{ path: 'x.java', line: 3, text: '' }])
  assert.deepEqual(kept.list.map(b => [b.line, b.text]), [[2, '']])
  assert.deepEqual(kept.dropped, [{ path: 'x.java', line: 3, text: '' }], '行越界 ⇒ 仍丢着')
  // 空原文的丢弃项：那一行还是空的就放回去（上游 `''.equals('')`，:536）
  const restored = reconcileBookmarks([], 'x.java', 'a' + NL, [{ path: 'x.java', line: 2, text: '' }])
  assert.deepEqual(restored.list.map(b => [b.line, b.text]), [[2, '']])
  // 完全没有原文（老数据）的丢弃项不认（entry.text === undefined）
  assert.deepEqual(reconcileBookmarks([], 'x.java', 'a', [{ path: 'x.java', line: 1 }]).dropped, [{ path: 'x.java', line: 1 }])
})

test('同一行只留一条：丢掉的那条回来时这一行已有新书签，就把回来的那条再丢回去（isDuplicate:517-530）', () => {
  const NL = String.fromCharCode(10)
  const content = 'a' + NL + 'b'
  const out = reconcileBookmarks([{ path: 'x.java', line: 2, text: 'b' }], 'x.java', content, [{ path: 'x.java', line: 2, text: 'b' }])
  assert.equal(out.list.length, 1, '保留原有那条')
  assert.equal(out.dropped.length, 1, '回来的那条进回丢弃表')
})

test('描述 = 那一行的原文（去掉首尾空白）；空白行/旧数据没有描述', () => {
  assert.equal(bookmarkDescription({ path: 'a.cpp', line: 3, text: '  int x = 1;  ' }), 'int x = 1;')
  assert.equal(bookmarkDescription({ path: 'a.cpp', line: 3, text: '   ' }), undefined, '全空白按"没有描述"')
  assert.equal(bookmarkDescription({ path: 'a.cpp', line: 3 }), undefined, '旧数据没有原文')
})

test('长行锚按 1024 个字符截断，而且存/比两侧口径一致（超长行不会假失效）', () => {
  const long = 'x'.repeat(BOOKMARK_TEXT_LIMIT + 500)
  assert.equal(bookmarkAnchor(long).length, BOOKMARK_TEXT_LIMIT, '构造锚时就截断')
  assert.equal(bookmarkAnchor('  ' + long + '  '), long.slice(0, BOOKMARK_TEXT_LIMIT), '先 trim 再截断')
  // 放书签时存的就是截断后的锚；对账时比的是同一段 —— 行没变就该留着
  const stored = [{ path: 'a.cpp', line: 1, text: bookmarkAnchor(long) }]
  const kept = reconcileBookmarks(stored, 'a.cpp', long, [])
  assert.equal(kept.list.length, 1, '行没动 ⇒ 书签留着')
  assert.deepEqual(kept.dropped, [])
  // 行还在只是内容变了 ⇒ 书签留着，锚刷成**截断后的**当前行（上游"还留着的书签把原文刷成当前那一行"）
  const changed = reconcileBookmarks(stored, 'a.cpp', 'y' + long.slice(1), [])
  assert.equal(changed.list.length, 1, '行还在 ⇒ 书签留着')
  assert.equal(changed.list[0].text, ('y' + long.slice(1)).slice(0, BOOKMARK_TEXT_LIMIT), '刷新后的锚同样按上限截断')
})

test('选中文字再放书签：那段文本成为自定义描述，且优先于行原文', () => {
  const once = placeBookmark([], 'a.cpp', 4, undefined, 'int x = 1;', 'selected  text')
  assert.deepEqual(once, [{ path: 'a.cpp', line: 4, text: 'int x = 1;', description: 'selected  text' }])
  assert.equal(bookmarkDescription(once[0]), 'selected  text', '自定义描述优先（上游 BookmarkGroup.getDescription 的顺序）')
  // 没有选中文字时退回行原文
  const plain = placeBookmark([], 'a.cpp', 4, undefined, 'int x = 1;')
  assert.equal(bookmarkDescription(plain[0]), 'int x = 1;')
  // 描述是"放上时写一次"的快照：对账刷新的是锚，不是它
  const next = reconcileBookmarks(once, 'a.cpp', ['one', 'two', 'three', 'int y = 2;'].join(String.fromCharCode(10)), [])
  assert.equal(next.list[0].text, 'int y = 2;', '锚跟着当前行刷新')
  assert.equal(next.list[0].description, 'selected  text', '自定义描述不动')
  // 数字编号换行时描述一起搬（withMnemonic 不许把它丢掉）
  const moved = placeBookmark(once, 'a.cpp', 9, 3)
  assert.equal(moved[0].description, 'selected  text')
})

test('助记键是单个 0-9/A-Z 字符：字母能用，大小写归一，非单字符不认', () => {
  assert.equal(normalizeMnemonic('a'), 'A')
  assert.equal(normalizeMnemonic('Z'), 'Z')
  assert.equal(normalizeMnemonic('7'), '7')
  assert.equal(normalizeMnemonic(''), undefined)
  assert.equal(normalizeMnemonic('ab'), undefined)
  assert.equal(normalizeMnemonic('!'), undefined)
  assert.deepEqual(BOOKMARK_MNEMONICS.length, 36, '0-9 + A-Z = 36 个可贴的助记键')
  const placed = placeBookmark([], 'a.cpp', 2, 'A')
  assert.equal(bookmarkOwner(placed, 'A')?.line, 2, '字母助记键照样能查到主人')
  assert.deepEqual(withoutMnemonic(placed[0]), { path: 'a.cpp', line: 2 }, '移除助记键只摘键，书签留着')
})

test('助记键被占用：重写 = 老的那条被删掉（上游 rewriteType:285-295）；取消 = 整件事作废', () => {
  const taken = placeBookmark([], 'old.cpp', 5, 'B', 'old line')
  // 取消（rewrite = false）：列表原样，不新增也不动老主人
  const cancelled = placeBookmark(taken, 'new.cpp', 9, 'B', 'new line', undefined, false)
  assert.deepEqual(cancelled, taken, '取消重写 ⇒ 什么也不变')
  // 重写：老的那条行书签被删掉，新的拿到 B
  const rewritten = placeBookmark(taken, 'new.cpp', 9, 'B', 'new line', undefined, true)
  assert.deepEqual(rewritten.map(entry => [entry.path, entry.line, entry.mnemonic]), [['new.cpp', 9, 'B']])
})

test('文件书签：没有行号，按文件的开关切换，且不与行书签互相干扰', () => {
  const withFile = toggleFileBookmark([], 'src/a.cpp')
  assert.deepEqual(withFile, [{ path: 'src/a.cpp' }], '文件书签没有 line 键')
  assert.equal(isFileBookmark(withFile[0]), true)
  assert.equal(isFileBookmark({ path: 'src/a.cpp', line: 3 }), false)
  // 同一个文件的行书签照旧能加（两种并存）
  const both = placeBookmark(withFile, 'src/a.cpp', 3, undefined, 'int x;')
  assert.deepEqual(both.map(entry => entry.line), [undefined, 3])
  // 再点一次是取消，而且不动行书签
  assert.deepEqual(toggleFileBookmark(both, 'src/a.cpp').map(entry => entry.line), [3])
  // 排序：文件书签排在同一个文件的行书签前面（上游 line = -1）
  assert.deepEqual(sortedBookmarks(both).map(entry => entry.line), [undefined, 3])
})

test('内容变更不碰文件书签（上游 documentChanged 只动行书签）', () => {
  const twoLines = 'one' + String.fromCharCode(10) + 'keep'
  const list = [{ path: 'a.cpp' }, { path: 'a.cpp', line: 2, text: 'keep' }]
  const out = reconcileBookmarks(list, 'a.cpp', twoLines, [])
  assert.deepEqual(out.list.map(entry => entry.line), [undefined, 2], '文件书签原样留着，行书签也还在')
  assert.deepEqual(out.dropped, [], '两行都在 ⇒ 不该丢任何一条')
  // 行号越界时只有行书签被丢掉，文件书签不受影响
  const shrunk = reconcileBookmarks(list, 'a.cpp', 'one', [])
  assert.deepEqual(shrunk.list.map(entry => entry.line), [undefined])
})

test('重写助记键时：行书签被删掉，文件书签降级成无键（上游 rewriteType:285-295）', () => {
  const taken = [{ path: 'a.cpp' }, { path: 'b.cpp', line: 4, mnemonic: 'C', text: 'x' }]
  const fileSquatter = placeBookmark([{ path: 'a.cpp', mnemonic: 'C' }], 'new.cpp', 9, 'C')
  // 列表顺序是"插入顺序"（排序在 sortedBookmarks 里做），所以这里按路径排一下再比。
  const byPath = fileSquatter.slice().sort((a, b) => a.path.localeCompare(b.path)).map(entry => [entry.path, entry.line, entry.mnemonic])
  assert.deepEqual(byPath, [['a.cpp', undefined, undefined], ['new.cpp', 9, 'C']],
                   '文件书签只被摘掉助记键，条目留着')
  const lineSquatter = placeBookmark(taken, 'new.cpp', 9, 'C')
  assert.deepEqual(lineSquatter.map(entry => entry.path), ['a.cpp', 'new.cpp'], '行书签那条（b.cpp:4）被整条删掉')
})
