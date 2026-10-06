import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { BOOKMARK_MNEMONICS, BOOKMARK_TEXT_LIMIT, BOOKMARK_TYPE_ORDER, bookmarkAnchor, bookmarkDescription, bookmarkGutterTooltip, bookmarkOwner, bookmarkSelectionDescription, isFileBookmark, nextBookmark, nextLineBookmarkInFile, normalizeMnemonic, placeBookmark, reconcileBookmarks, removeBookmark, sortedBookmarks, toggleFileBookmark, withoutMnemonic } from '../src/bookmarks.ts'

const read = relative => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', relative), 'utf8')

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

test('装订线的悬停文本按上游拼：书签 + 助记键 + 描述 + 键位（字母没有键位）', () => {
  assert.equal(bookmarkGutterTooltip({ path: 'a.cpp', line: 3, text: '  int x = 1;  ' }), '书签: int x = 1;')
  assert.equal(bookmarkGutterTooltip({ path: 'a.cpp', line: 3, text: 'int x;', mnemonic: 'A' }), '书签 A: int x;',
               '字母没有全局键位 ⇒ 不拼括号那一段')
  assert.equal(bookmarkGutterTooltip({ path: 'a.cpp', line: 3, text: 'int x;', mnemonic: '4' }),
               '书签 4: int x; (Ctrl+Shift+4 以切换，Ctrl+4 以跳转到)')
  assert.equal(bookmarkGutterTooltip({ path: 'a.cpp', line: 3, text: 'int x;', description: '选中的那段', mnemonic: '9' }),
               '书签 9: 选中的那段 (Ctrl+Shift+9 以切换，Ctrl+9 以跳转到)', '自定义描述优先于行原文')
  assert.equal(bookmarkGutterTooltip({ path: 'a.cpp', line: 3 }), '书签', '没有原文/描述/助记键时只有"书签"')
})

// ---------------------------------------------------------------- EDITOR_TAB_POPUP（编辑器标签右键那一支）
// 上游 `platform/bookmarks/src/com/intellij/ide/bookmark/actions/extensions.kt:57-61`：
// 标签右键与项目树右键都拿不到行号 ⇒ `manager.createBookmark(file)` 建**文件书签**；
// `ToggleBookmarkAction.addSingleBookmark:72-82` = `manager.toggle(bookmark, type)` ＋
// `:78-81` 的「该编辑器有非空白选区 ⇒ 那段文本成为自定义描述」。
// 菜单标题 = `ToggleBookmarkAction.update:54-58`（右键上下文里 `bookmark.add.action.text` /
// `bookmark.delete.action.text`，中文包 `BookmarkBundle.properties:8/10` = 添加书签 / 删除书签）。

test('选区 → 描述的规则照上游：空白与没有选区都不设，设的是原文（不 trim）', () => {
  assert.equal(bookmarkSelectionDescription(undefined), undefined, '取不到 editor ⇒ 没有 selectedText')
  assert.equal(bookmarkSelectionDescription(null), undefined)
  assert.equal(bookmarkSelectionDescription(''), undefined)
  assert.equal(bookmarkSelectionDescription('   \n '), undefined, 'isNullOrBlank 的那一支')
  assert.equal(bookmarkSelectionDescription('  void run()  '), '  void run()  ',
    '存的是选区原文：上游 `setDescription(bookmark, selectedText)` 不 trim（trim 只在算默认描述时做）')
})

test('标签右键的三段行为：新增带描述、再点整条删掉、与同文件行书签互不干扰', () => {
  const added = toggleFileBookmark([], 'src/a.cpp', '  int x;  ')
  assert.deepEqual(added, [{ path: 'src/a.cpp', description: '  int x;  ' }], '文件书签**不写 line 键**（BookmarkManager.writeExternal:335-337）')
  assert.equal(bookmarkDescription(added[0]), '  int x;  ', '描述就是那段原文')
  // 空白选区 ⇒ 形状回到"只有 path"（与旧存档同形，不多一个空 description 键）。
  assert.deepEqual(toggleFileBookmark([], 'src/a.cpp', '   '), [{ path: 'src/a.cpp' }])
  assert.deepEqual(toggleFileBookmark([], 'src/a.cpp', undefined), [{ path: 'src/a.cpp' }])
  // 再点一次 = 取消（上游 toggle → remove），描述不复活、同文件的行书签不动。
  const both = placeBookmark(added, 'src/a.cpp', 3, undefined, 'int y;')
  assert.deepEqual(both.map(entry => entry.line), [undefined, 3], '两种书签并存')
  assert.deepEqual(toggleFileBookmark(both, 'src/a.cpp', '别的').map(entry => entry.line), [3])
  assert.deepEqual(toggleFileBookmark(both, 'src/a.cpp').map(entry => entry.line), [3],
    '取消那一下与选区无关（上游 toggle 命中已有书签就直接 remove）')
})

test('标签菜单标题随状态（添加书签 / 删除书签），且挂点真的消费了模型', () => {
  const actions = read('src/bookmarkActions.ts')
  // 模型侧：文件书签的开关要拿**被右键那个标签**的选区（宿主 `selection(path)`），
  // 行书签那一支走同一个纯函数 ⇒ 两条分支的"空白不设"是同一份规则。
  assert.match(actions, /toggleFileBookmark\(bookmarks\.value, path, deps\.selection\?\.\(path\)\)/,
    'EDITOR_TAB_POPUP 的选区必须进描述')
  assert.match(actions, /bookmarkSelectionDescription\(deps\.selection\?\.\(tab\.path\)\)/, 'F11 那一支共用同一条规则')
  assert.match(actions, /'删除书签' : '添加书签'/, '标题两态（BookmarkBundle 中文包 :8/:10）')
  // 挂点：编辑器标签右键菜单（`src/components/TabContextMenu.vue`，桶 8 名下）确实调了这两个口 ——
  // 没有这一行，模型就是零消费方的死代码。
  const tabMenu = read('src/components/TabContextMenu.vue')
  assert.match(tabMenu, /ctx\.bookmarkFile\(/, '标签右键必须挂上 ToggleBookmark 的等价物')
  assert.match(tabMenu, /ctx\.fileBookmarkLabel\(/, '标题由模型给（不在组件里另写一份文案）')
})

// 项目级「下一个 / 上一个书签」= 上游 `GotoNextBookmark` / `GotoPreviousBookmark`。
// 名字里就写着 Line（`platform/platform-resources-en/src/messages/ActionsBundle.properties:1333-1334`
// = "Next Line Bookmark" / "Previous Line Bookmark"），实现那张表是
// `platform/bookmarks/src/com/intellij/ide/bookmark/actions/NextBookmarkService.kt:47` 的
// `bookmarks.filterIsInstance<LineBookmark>()` ⇒ **文件书签不进这个循环**。
test('项目级循环只走行书签：文件书签不参与（NextBookmarkService.kt:47）', () => {
  const file = { path: 'src/a.cpp' }
  const lines = [{ path: 'src/a.cpp', line: 8 }, { path: 'src/b.cpp', line: 2 }]
  assert.deepEqual(nextBookmark([file, ...lines], 'src/a.cpp', 1, false), lines[0], '第一条还是行书签')
  assert.deepEqual(nextBookmark(lines, 'src/a.cpp', 8, false), lines[1], '行书签之间照旧')
  assert.deepEqual(nextBookmark([file, ...lines], 'src/b.cpp', 2, false), lines[0],
    '走到头回绕到的也是行书签，不是那条文件书签')
  assert.deepEqual(nextBookmark([file, ...lines], 'src/a.cpp', 1, true), lines[1], '反向同理')
  assert.equal(nextBookmark([file], 'src/a.cpp', 1, false), undefined, '只有文件书签 ⇒ 这条动作跳不动（上游据此置灰）')
})

// 编辑器内的「下一个 / 上一个行书签」= `GotoNextBookmarkInEditor` / `GotoPreviousBookmarkInEditor`
// （`platform/bookmarks/resources/intellij.platform.bookmarks.xml:74-79`；
// 本体 `actions/NextBookmarkInEditor.kt:32-59`）。三条与项目级不同之处全部照搬：
// 只看当前文件（`:36`）、严格大于/小于光标行（`:39-52`）、**默认不回绕**
// （`:53-56` 那段在 `BookmarkOccurrence.cyclic` 里，而它默认 false —— `BookmarkOccurrence.kt:57-58`）。
test('编辑器内循环：同文件、跨不过去、光标那一行不算、默认不回绕', () => {
  const own = [{ path: 'src/a.cpp', line: 4 }, { path: 'src/a.cpp', line: 9 }, { path: 'src/b.cpp', line: 1 }]
  assert.deepEqual(nextLineBookmarkInFile(own, 'src/a.cpp', 1, false), own[0], '1 行之后第一条是 4')
  assert.deepEqual(nextLineBookmarkInFile(own, 'src/a.cpp', 4, false), own[1], '4 行之后是 9')
  assert.deepEqual(nextLineBookmarkInFile(own, 'src/a.cpp', 9, false), undefined, '到头了不回绕（cyclic 默认 false）')
  assert.deepEqual(nextLineBookmarkInFile(own, 'src/a.cpp', 9, true), own[0], '反向：降序后第一条 <9 的是 4')
  assert.deepEqual(nextLineBookmarkInFile(own, 'src/a.cpp', 4, true), undefined, '4 之前没有别的行书签')
  assert.deepEqual(nextLineBookmarkInFile(own, 'src/a.cpp', 1, true), undefined, '最前面再往前也没有')
  assert.deepEqual(nextLineBookmarkInFile(own, 'src/a.cpp', 9, false, true), own[0], '开着 cyclic 才回绕')
  assert.deepEqual(nextLineBookmarkInFile(own, 'src/a.cpp', 4, true, true), own[1], '反向回绕取降序后的第一条 = 9')
  // 绕回来正好是光标那一行时不动（`NextBookmarkInEditor.kt:55` 的 `bookmark.line != line`）。
  const single = [{ path: 'src/a.cpp', line: 7 }]
  assert.deepEqual(nextLineBookmarkInFile(single, 'src/a.cpp', 7, false, true), undefined, '只有书签那一行 ⇒ 不算下一个')
  assert.deepEqual(nextLineBookmarkInFile(single, 'src/a.cpp', 8, true, true), single[0], '8 之前那条(7)不是光标行 ⇒ 照回')
  assert.deepEqual(nextLineBookmarkInFile(single, 'src/a.cpp', 7, true, true), undefined, '反向同理：绕回自己那行不算')
  assert.deepEqual(nextLineBookmarkInFile([{ path: 'other.cpp', line: 2 }], 'src/a.cpp', 1, false), undefined, '别的文件不算')
  assert.deepEqual(nextLineBookmarkInFile([{ path: 'src/a.cpp' }], 'src/a.cpp', 1, false), undefined, '文件书签不算（只收 LineBookmark）')
})

// 缺锚的书签不能被"空行"骗回来：上游那份比的是删除前**实读**的行文本
// （`platform/bookmarks/src/com/intellij/ide/bookmarks/BookmarkManager.java` 的
// `beforeDocumentChange:439-443` 记 `BookmarkInfo(bookmark, line, doc.getText(...))`，
// `moveToDeleted:530-538` 存进 `myDeletedDocumentBookmarks`，`:506` 才 `bookmarkedText.equals(lineContent)`）。
// 本仓的历史状态可能根本没有 `text`，补一个空串就等于给任意空行发通行证。
test('缺锚的书签越界后不会因为某个空行被假放回；有锚的照旧放回', () => {
  const noAnchor = { path: 'x.java', line: 4 }
  const first = reconcileBookmarks([noAnchor], 'x.java', 'a\nb\nc')
  assert.deepEqual(first.list, [], '第 4 行没了 ⇒ 删掉')
  assert.equal(first.dropped[0].text, undefined, '丢掉表里也**不**给它编一个空串锚')
  const back = reconcileBookmarks(first.list, 'x.java', 'a\nb\nc\n\n', first.dropped)
  assert.deepEqual(back.list, [], '新内容第 4 行是空行：空串 == 空行那种"放回"是假放回')
  assert.equal(back.dropped.length, 1, '它仍留在丢掉的那张表里（上游也不静默丢数据）')
  // 对照组：有锚的那条照旧放回（这条判据保证不是把整条放回逻辑写死了）。
  const anchored = placeBookmark([], 'x.java', 4, undefined, 'd')
  const gone = reconcileBookmarks(anchored, 'x.java', 'a\nb\nc')
  const revived = reconcileBookmarks(gone.list, 'x.java', 'a\nb\nc\nd', gone.dropped)
  assert.deepEqual(revived.list.map(entry => entry.line), [4], '原文回到同一行号就放回去（:506）')
  assert.deepEqual(revived.dropped, [])
})

// 两份助记键顺序是**两件事**：菜单里 36 行「转到书签 {0}」照
// `platform/bookmarks/resources/intellij.platform.bookmarks.xml:82-117`（GotoBookmark0 在前），
// 而凡"遍历所有类型"的地方照枚举序 `platform/lang-api/src/com/intellij/ide/bookmark/BookmarkType.kt:19-31`
// （DIGIT_1…DIGIT_9、DIGIT_0、LETTER_A…LETTER_Z）—— 选择器网格与「转到助记符…」都用后者。
test('菜单序（0 先）与枚举序（1 先、0 在数字末）不是一份数组', () => {
  assert.deepEqual(BOOKMARK_MNEMONICS.slice(0, 11), [...'0123456789', 'A'])
  assert.deepEqual(BOOKMARK_TYPE_ORDER.slice(0, 11), [...'1234567890', 'A'])
  assert.equal(BOOKMARK_TYPE_ORDER.length, 36)
  assert.equal(BOOKMARK_TYPE_ORDER.includes('0'), true, 'DEFAULT（无键）不进这张表')
  assert.deepEqual([...BOOKMARK_TYPE_ORDER].sort(), [...BOOKMARK_MNEMONICS].sort(), '只是顺序不同，成员一致')
})

// 上面那两条"按列表删/改"要真的在运行时的链上（不是只过纯函数测试的死模型）：
// 面板的 X 与行右键 → `ctx.onBookmarkRemove` → `dropBookmark`；「编辑描述」→ `requestBookmarkEdit`
// → `editBookmarkAt` → 保存 → `saveBookmarkDescription`。这三条边一条断掉，模型就退回"点了没反应"。
test('删/改描述的运行时链路确实接了命名列表那一份', () => {
  const actions = read('src/bookmarkActions.ts')
  assert.match(actions, /function dropBookmark\(entry: Bookmark\) \{[\s\S]{0,160}?if \(removeBookmarkFromNamedList\(entry\)\) return/,
    '移除要先看哪张命名列表持有它')
  assert.match(actions, /bookmarkInFirstNamedList\(holder\)/, '「编辑描述」的取数走"第一张持有它的列表"')
  assert.match(actions, /setNamedListBookmarkDescription\(at\.list, \{ path: at\.path, line: at\.line \}, value\)/,
    '保存要落回同一张列表（上游 setDescription 只写那一个 group）')
  assert.match(actions, /import \{[^}]*removeBookmarkFromNamedList[^}]*\} from '\.\/bookmarkListActions\.ts'/, '值 import 带 .ts 扩展名')
  const view = read('src/toolViewContext.ts')
  assert.match(view, /onBookmarkRemove: entry => dropBookmark/, '面板的移除事件确实进 dropBookmark')
  assert.match(view, /onBookmarkEdit: \(entry: \{ path: string; line\?: number \}\) => requestBookmarkEdit\(entry\.path, entry\.line\)/,
    '面板的编辑事件确实进 requestBookmarkEdit')
})
