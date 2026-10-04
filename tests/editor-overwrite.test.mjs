// 插入/覆盖模式（B2：`InsertOverwrite` 那一族里**唯一没有状态栏组件**的能力 ——
// `EditorToggleInsertStateAction` + `EditorEx.setInsertMode`）。
//
// 上游要点（逐条核过）：
//   · `$default.xml:457-459`：INSERT 键 → `EditorToggleInsertState`；
//   · `TypedCharImpl.java:31-47`：`COMPLEX_CHARS`（`\n \t ( ) < > [ ] { } " '`）与代理对**永不覆盖**；
//   · `ImmediatePainter.java:164`：可见指示是**块状光标**，不是状态栏组件
//     （`intellij.platform.ide.impl.xml:1627` 的 `InsertOverwrite` 那个 id 其实指向列选择组件）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EditorSelection, EditorState } from '@codemirror/state'
import { COMPLEX_CHARS, overwriteChange, overwriteExtension, setOverwriteMode, shouldOverwrite } from '../src/editorOverwrite.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

/** 一个带光标的编辑器状态（覆盖模式可选）。 */
function stateAt(doc, pos, overwrite = false) {
  const base = EditorState.create({ doc, extensions: [overwriteExtension()] })
  const withCursor = base.update({ selection: { anchor: pos } }).state
  return overwrite ? withCursor.update({ effects: setOverwriteMode.of(true) }).state : withCursor
}

// —— shouldOverwrite（TypedCharImpl 的两道守卫）——

test('an ordinary character overwrites', () => {
  assert.equal(shouldOverwrite('a'), true)
  assert.equal(shouldOverwrite('1'), true)
  assert.equal(shouldOverwrite('中'), true)
})

// `COMPLEX_CHARS` 逐字照抄 —— 打一个 `(` 不该吃掉右边那个配对括号。
test('the complex characters never overwrite', () => {
  for (const ch of ['\n', '\t', '(', ')', '<', '>', '[', ']', '{', '}', '"', "'"])
    assert.equal(shouldOverwrite(ch), false, `${JSON.stringify(ch)} 不该覆盖`)
  assert.deepEqual([...COMPLEX_CHARS].sort(), ['\t', '\n', '"', "'", '(', ')', '<', '>', '[', ']', '{', '}'].sort())
})

test('multi-character input (paste / IME) never overwrites', () => {
  assert.equal(shouldOverwrite('ab'), false)
  assert.equal(shouldOverwrite(''), false)
})

test('surrogates and control characters never overwrite', () => {
  assert.equal(shouldOverwrite('\ud83d'), false, '代理对的一半')
  assert.equal(shouldOverwrite(String.fromCharCode(13)), false, 'CR')
  assert.equal(shouldOverwrite(String.fromCharCode(7)), false, 'BEL')
})

// —— overwriteChange（把插入改写成替换）——

test('typing over a character replaces it', () => {
  const state = stateAt('abcdef', 2, true)
  assert.deepEqual(overwriteChange(state, 'X'), { from: 2, to: 3, insert: 'X' })
})

// 行尾没有可覆盖的字符 ⇒ 照常追加。
test('at the end of a line the character is appended', () => {
  assert.equal(overwriteChange(stateAt('abc', 3, true), 'X'), null)
})

test('at the end of the document the character is appended', () => {
  assert.equal(overwriteChange(stateAt('abc', 3, true), 'X'), null)
})

// 关掉覆盖模式就什么也不改。
test('nothing is rewritten while the mode is off', () => {
  assert.equal(overwriteChange(stateAt('abcdef', 2, false), 'X'), null)
})

// 有选区时按普通插入走（先删选区这件事由 CodeMirror 自己处理）。
test('a non-empty selection is left alone', () => {
  const base = EditorState.create({ doc: 'abcdef', extensions: [overwriteExtension()] })
  const state = base.update({ selection: { anchor: 1, head: 4 }, effects: setOverwriteMode.of(true) }).state
  assert.equal(overwriteChange(state, 'X'), null)
})

// 结构性字符即使开着覆盖也不改写。
test('a complex character is not rewritten even in overwrite mode', () => {
  assert.equal(overwriteChange(stateAt('a(b', 2, true), '('), null)
})

// 多光标不处理（逐光标改写要自己维护偏移，收益低风险高）。
// 注意：CodeMirror 默认会**把多选区折成一个**，要开 `allowMultipleSelections` 才留得住
// （`basicSetup` 里就带着它，所以真实编辑器有；测试里得自己加）。
test('multiple carets are left alone', () => {
  const base = EditorState.create({
    doc: 'abcdef',
    extensions: [EditorState.allowMultipleSelections.of(true), overwriteExtension()],
  })
  const state = base.update({
    selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(3)], 0),
    effects: setOverwriteMode.of(true),
  }).state
  assert.equal(state.selection.ranges.length, 2, '两个光标要在（否则这条判据是空跑）')
  assert.equal(overwriteChange(state, 'X'), null)
})

// 行中间：覆盖的是**下一个**字符，不是前一个。
test('the character after the caret is the one replaced', () => {
  assert.deepEqual(overwriteChange(stateAt('abcdef', 4, true), 'Z'), { from: 4, to: 5, insert: 'Z' })
})

// —— 接线 ——

test('the editor installs the extension and binds INSERT', () => {
  const editor = read('src/components/CodeEditor.vue')
  assert.match(editor, /overwriteExtension\(\)/, '扩展要进编辑器')
  assert.match(editor, /overwriteTheme/, '块光标主题要进编辑器')
  assert.match(editor, /\{ key: 'Insert', preventDefault: true, run: editor => \{ toggleOverwrite\(editor\); return true \} \}/)
  assert.match(editor, /'editor\.overwrite': editor => \{ toggleOverwrite\(editor\); return true \}/, '菜单要走同一个实现')
})

test('the menu row sits before the column-selection one, as upstream', () => {
  const menu = read('src/menus/editMenu.ts')
  const insert = menu.indexOf("id: 'edit.toggleInsertState'")
  const column = menu.indexOf("id: 'edit.columnSelect'")
  assert.ok(insert > 0 && column > 0, '两条都要在')
  assert.ok(insert < column, 'PlatformActions.xml:241-242：切换插入/覆盖 紧跟 列选择模式 之前')
  assert.match(menu, /'切换插入\/覆盖'/, 'action.EditorToggleInsertState.text 的中文取值')
})
