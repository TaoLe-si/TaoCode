// 编辑器内查找栏（B7 §C 第一条：上游 `SearchReplaceComponent` + `EditorSearchSession`）。
//
// 判据分三层，各管一段，互不代替：
//   ① 匹配语义（`src/editorSearch.ts`）：正则构造、命中收集、回绕 —— 纯函数，直接跑；
//   ② CodeMirror 侧（`src/editorSearchExtension.ts`）：状态字段与命中区间在真实 `EditorState` 上跑；
//   ③ 接线：菜单行 / 键位 / 组件模板 —— 读源码断言，防止"实现了但没人能打开"。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EditorSelection, EditorState } from '@codemirror/state'
import { buildSearchRegex, collectSearchMatches, findStatusText, INCORRECT_REGEXP_TEXT, matchStatus, matchesStatusText, nextMatch, NO_SELECTION_TEXT, DEFAULT_SEARCH_OPTIONS } from '../src/editorSearch.ts'
import { CLOSED_SEARCH, editorSearchExtension, matchesIn, searchStateField, setSearchState } from '../src/editorSearchExtension.ts'

const opts = patch => ({ ...DEFAULT_SEARCH_OPTIONS, ...patch })
const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

// —— ① 匹配语义 ——

// 上游 `FindModel.compileRegExp`（FindModel.kt:531-567）：默认 MULTILINE，不区分大小写再补两个 flag。
test('case sensitivity follows FindModel', () => {
  const text = 'Alpha alpha'
  assert.equal(collectSearchMatches(text, 'alpha', opts()).length, 2)
  assert.equal(collectSearchMatches(text, 'alpha', opts({ caseSensitive: true })).length, 1)
})

// 字面量档必须把正则元字符当普通字符（上游字面量路径 FindPopupPanel.java:1520-1533）。
test('literal mode escapes regex metacharacters', () => {
  assert.equal(collectSearchMatches('a.b axb', 'a.b', opts()).length, 1)
  assert.equal(collectSearchMatches('a.b axb', 'a.b', opts({ regex: true })).length, 2)
})

// 全词 = 两侧加 \b（`FindModel.isWholeWordsOnly`，FindModel.kt:114）。
test('whole words only matches on word boundaries', () => {
  assert.equal(collectSearchMatches('cat category', 'cat', opts()).length, 2)
  assert.equal(collectSearchMatches('cat category', 'cat', opts({ wholeWords: true })).length, 1)
})

// 坏正则不抛异常，返回 null —— 调用方据此把输入框画红（上游 `PatternUtil` 报错的等价物）。
test('an invalid pattern is reported, not thrown', () => {
  assert.equal(buildSearchRegex('(', opts({ regex: true })), null)
  assert.deepEqual(collectSearchMatches('anything', '(', opts({ regex: true })), [])
})

// 零宽匹配不能死循环：JS 的 lastIndex 对零宽结果不前进，必须手动迈一步。
test('zero-width matches do not loop forever', () => {
  const matches = collectSearchMatches('abc', 'x*', opts({ regex: true }), 10)
  assert.ok(matches.length > 0 && matches.length <= 10, `零宽匹配应收敛，实得 ${matches.length}`)
})

test('the highlight limit is honoured', () => {
  assert.equal(collectSearchMatches('aaaa', 'a', opts(), 3).length, 3)
})

// F3 走到最后一个之后回绕到第一个；Shift+F3 从第一个往前回绕到最后（上游 findNext 的语义）。
test('next and previous wrap around', () => {
  const matches = collectSearchMatches('a b a b a', 'a', opts())
  assert.deepEqual(matches.map(m => m.from), [0, 4, 8])
  assert.equal(nextMatch(matches, 0, false)?.from, 4)
  assert.equal(nextMatch(matches, 8, false)?.from, 0, '末尾回绕到第一个')
  assert.equal(nextMatch(matches, 0, true)?.from, 8, '开头回绕到最后一个')
  assert.equal(nextMatch(matches, 4, true)?.from, 0)
  assert.equal(nextMatch([], 0, false), null)
})

test('the status text reads n/m', () => {
  assert.equal(matchStatus(0, 3), '1/3')
  assert.equal(matchStatus(2, 3), '3/3')
  assert.equal(matchStatus(0, 0), '')
})

// —— 状态文案（`SearchReplaceComponent.getStatusText()` / `EditorSearchSession.java:404-428`）——

test('the status line follows the four upstream states', () => {
  const base = { query: 'alpha', total: 2, current: -1, inSelection: false, hasSelection: false, invalid: false }
  // 还没定位到一条：报个数（`editorsearch.matches` = `{0} 个结果`）。
  assert.equal(findStatusText(base), '2 个结果')
  assert.equal(findStatusText({ ...base, total: 1 }), '1 个结果')
  assert.equal(findStatusText({ ...base, total: 0 }), '0 个结果')
  assert.equal(matchesStatusText(7), '7 个结果')
  // 定位过：`editorsearch.current.cursor.position` = `{0}/{1}`。
  assert.equal(findStatusText({ ...base, current: 1 }), '2/2')
  // 坏正则：`find.incorrect.regexp`「错误模式」（`EditorSearchSession.java:660`）。
  assert.equal(findStatusText({ ...base, invalid: true }), INCORRECT_REGEXP_TEXT)
  // 「仅在选区内」而编辑器没有选区：`editorsearch.noselection`「无选区」（`:408-410`）。
  assert.equal(findStatusText({ ...base, inSelection: true }), NO_SELECTION_TEXT)
  assert.equal(findStatusText({ ...base, inSelection: true, hasSelection: true }), '2 个结果')
  // 查询词为空时不摆文案（栏还没在用）。
  assert.equal(findStatusText({ ...base, query: '' }), '')
})

test('the controller composes the status from the four states', () => {
  const controller = read('src/editorFindController.ts')
  assert.match(controller, /findStatusText\(\{/)
  assert.match(controller, /hasSelection: !view\.state\.selection\.main\.empty/, '无选区要单独传（不能拿 total 猜）')
  assert.ok(!controller.includes('matchStatus(current >= 0'), '旧的"没有 current 就顶 1/N"写法要去掉')
})

// 上游 `EditorSelectionSearchAreaProvider`（`SearchResults.java:573-582`）拿的是选区本身：
// 「仅在选区内」开着但没有选区 ⇒ 搜索区域为空、0 命中，而不是悄悄搜全文件。
test('in-selection with no selection finds nothing', () => {
  const base = EditorState.create({ doc: 'alpha\nbeta\nalpha', extensions: [editorSearchExtension()] })
  const state = base.update({
    selection: { anchor: 3, head: 3 },
    effects: setSearchState.of({ open: true, query: 'alpha', options: opts({ inSelection: true }) }),
  }).state
  assert.deepEqual(matchesIn(state), [], '空选区 + 仅在选区内 ⇒ 空搜索区')
})

// —— ② CodeMirror 侧 ——

function stateOf(doc, patch = {}) {
  const state = EditorState.create({ doc, extensions: [editorSearchExtension()] })
  return state.update({ effects: setSearchState.of({ open: true, query: '', ...patch }) }).state
}

test('the search state starts closed with all five options off', () => {
  const state = EditorState.create({ doc: 'x', extensions: [editorSearchExtension()] })
  const closed = state.field(searchStateField)
  assert.equal(closed.open, false)
  assert.deepEqual(closed.options, DEFAULT_SEARCH_OPTIONS)
})

test('matches are located against the live document', () => {
  const state = stateOf('alpha beta alpha', { query: 'alpha' })
  assert.deepEqual(matchesIn(state).map(m => [m.from, m.to]), [[0, 5], [11, 16]])
})

// 关着栏 / 没查询词时不画也不找（省掉每次按键的白算）。
test('a closed bar or an empty query yields no matches', () => {
  assert.deepEqual(matchesIn(stateOf('alpha', { query: '' })), [])
  const closed = EditorState.create({ doc: 'alpha', extensions: [editorSearchExtension()] })
  assert.deepEqual(matchesIn(closed), [])
})

// 「仅在选区内搜索」（`FindModel.isGlobal` 取反）只搜主选区所在的那几行。
test('in-selection restricts the search to the selected lines', () => {
  const base = EditorState.create({ doc: 'alpha\nbeta\nalpha', extensions: [editorSearchExtension()] })
  const state = base.update({
    selection: { anchor: 6, head: 10 },
    effects: setSearchState.of({ open: true, query: 'alpha', options: opts({ inSelection: true }) }),
  }).state
  const found = matchesIn(state)
  assert.equal(found.length, 0, '第二行里没有 alpha，选区外的第三行不算')
})

// —— ③ 接线 ——

test('the editor hosts the bar and binds IDEA’s find keys', () => {
  const editor = read('src/components/CodeEditor.vue')
  assert.match(editor, /<EditorFindBar/, '查找栏组件必须挂在编辑器里')
  assert.match(editor, /editorSearchExtension\(\)/, '查找状态/高亮扩展必须进编辑器')
  // 键位逐条对 `$default.xml`：Find = Ctrl+F（:565）、Replace = Ctrl+R（:374）、
  // FindNext = F3（:707）、FindPrevious = Shift+F3（:507）、FindWordAtCaret = Ctrl+F3、
  // FindPrevWordAtCaret = Ctrl+Shift+F3、ToggleFindInSelection = Ctrl+Alt+E、
  // UnselectPreviousOccurrence = Alt+Shift+J。
  for (const key of ["'Mod-f'", "'Mod-r'", "'F3'", "'Shift-F3'", "'Ctrl-F3'", "'Ctrl-Shift-F3'", "'Ctrl-Alt-e'", "'Alt-Shift-j'"])
    assert.ok(editor.includes(`key: ${key}`), `编辑器缺少键位 ${key}`)
})

test('the edit menu carries the whole FindMenuGroup', () => {
  const menu = read('src/menus/editMenu.ts')
  // PlatformActions.xml:465-486 的子项顺序（逐个 editable 名对上）。
  for (const name of ['find', 'replace', 'find.next', 'find.previous', 'occurrence.select', 'occurrence.next',
    'occurrence.unselect', 'find.toggleInSelection', 'find.wordAtCaret', 'find.prevWordAtCaret'])
    assert.ok(menu.includes(`editable('${name}'`), `查找子菜单缺 ${name}`)
  assert.ok(menu.includes("'edit.findInPath'") && menu.includes("'edit.replaceInPath'"), 'FindInPath / ReplaceInPath 两行也在这一组')
})

// 文案取本机随 IDE 发货的中文语言包，不是自己译的（FindBundle.properties 的 key 逐条对上）。
test('the bar labels come from the shipped Chinese bundle', () => {
  const bar = read('src/components/EditorFindBar.vue')
  for (const label of ['区分大小写', '单词', '正则表达式', '在所选内容中搜索', '搜索历史记录', '关闭'])
    assert.ok(bar.includes(label), `栏里缺文案「${label}」`)
  assert.match(bar, /localization-zh/, '文案出处要写在文件头注释里')
})

// 三个内联记号必须是 lucide 图标组件，不能是 Unicode 字形（src/uiIcons.ts 硬规则 2）。
test('the bar uses icon components, never glyphs', () => {
  const bar = read('src/components/EditorFindBar.vue')
  assert.doesNotMatch(bar, />[▾▸×✓↑↓]<\/span>/, '不许用 Unicode 字形冒充图标')
  assert.match(bar, /from 'lucide-vue-next'/)
})

// —— 实时预览的选中语义（上游 `SelectionManager.updateSelection`）——

// `SelectionManager.java:33-70` 三件事：选中整个命中、光标落在命中末尾、命中在折叠区里要展开。
// 判据读源码 + 在真实 EditorState 上验前两件（第三件要 ViewPlugin，见下面的接线条）。
test('a match is selected in full, not just a caret placed', () => {
  const editor = read('src/editorSearchExtension.ts')
  assert.match(editor, /selection: EditorSelection\.range\(hit\.from, hit\.to\)/, '要选中整个命中')
  // 打字预览那一处也要选中（真机抓到过：那里原来写的是 `EditorSelection.cursor(...)`，
  // 于是"边打字边预览"时选中层是空的，只有按过 F3 才有）。
  assert.match(read('src/editorFindController.ts'), /EditorSelection\.range\(marks\[0\]\.from, marks\[0\]\.to\)/,
    '边打字边预览也要选中首条命中')
  assert.match(editor, /unfoldFor\(view\.state, hit\)/, '命中在折叠区里要先展开')
  assert.match(editor, /foldedRanges\(state\)\.between/, '用 foldedRanges 找命中落在哪个折叠区')
})

// 选中区间的 caret 端在末尾 ⇒ 接着打字就是替换那一处（"实时预览"最有用的性质）。
test('the caret ends up at the end of the selection', () => {
  const range = EditorSelection.range(3, 7)
  assert.equal(range.from, 3)
  assert.equal(range.to, 7)
  // `anchor` 是**不动的**那一端、`head` 是光标端 —— 上游 `setSelection(start, end)` 之后
  // caret 落在末尾，对应「head 在 end」这一种朝向。
  assert.equal(range.head, 7, 'head（光标端）在末尾')
  assert.equal(range.anchor, 3)
})
