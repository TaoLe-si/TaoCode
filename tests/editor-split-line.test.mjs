// 拆行（上游 `EditorSplitLine` = Ctrl+Enter）的判据。
// 规则来源：`platform/platform-impl/src/com/intellij/openapi/editor/actions/SplitLineAction.java`
// （:50-55 光标前只有空白那一支、:57-65 委托回车后把光标拽回切点、:30 ForEachCaret 逐光标），
// 默认档在 `EnterAction.java:60-67`（先删选区，再插「换行 + 该行前导空白（最多到切点）」）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EditorSelection, EditorState, Text } from '@codemirror/state'
import { insertNewlineAndIndent } from '@codemirror/commands'

import { indentUpTo, onlySpaces, splitLinePlan } from '../src/editorSplitLine.ts'
import { splitLineCommand } from '../src/editorSplitLine.ts'

/** 纯算式版：把 ranges 换算成 {from,to,head}，返回落地后的文档与每条光标落点。 */
function apply (doc, ranges) {
  const text = doc.join('\n')
  const plan = splitLinePlan(text, Text.of(doc), ranges.map(at => ({ from: at, to: at })))
  let state = EditorState.create({ doc: text, extensions: [EditorState.allowMultipleSelections.of(true)] })
  state = state.update({ changes: plan.changes, selection: EditorSelection.create(plan.heads.map(EditorSelection.cursor), plan.mainIndex) }).state
  return { text: state.doc.toString(), heads: state.selection.ranges.map(range => range.head) }
}

function run (doc, selection, enter = insertNewlineAndIndent) {
  let state = EditorState.create({ doc, selection, extensions: [EditorState.allowMultipleSelections.of(true)] })
  const view = { get state () { return state }, dispatch: (...specs) => { state = state.update(...specs).state } }
  return { ran: splitLineCommand(enter)(view), text: state.doc.toString(), head: state.selection.main.head }
}

test('光标前有文字：在切点插换行，**光标留在切点**（SplitLineAction.java:57-65，不跟到下一行）', () => {
  const done = run('foobar', { anchor: 3, head: 3 })
  assert.equal(done.ran, true)
  assert.equal(done.text, 'foo\nbar')
  assert.equal(done.head, 3, '普通回车会把光标带到下一行开头，拆行必须停在 foo 之后')
})

test('缩进里的光标：整段缩进跟着走，光标仍留在切点（:63-66 的 min(caret, 行首空白结束)）', () => {
  const done = run('    foobar', { anchor: 7, head: 7 })
  assert.equal(done.text, '    foo\n    bar')
  assert.equal(done.head, 7)
})

test('光标前面只有空白 ⇒ 在本行之上开一条同样缩进的空行，光标留在那条空行末尾（:50-55）', () => {
  const done = run('  x', { anchor: 1, head: 1 })
  assert.equal(done.text, ' \n  x', '把「那段空白 + 换行」插到**行首**，不是插到光标处')
  assert.equal(done.head, 1, ':55 用的是拆行之前的那个数值偏移')
})

test('光标在本行第一列：上面开一条空行，光标留在空行上（:50 的空串也算「只有空白」）', () => {
  assert.equal(onlySpaces('abc', 0, 0), true)
  const done = run('abc', { anchor: 0, head: 0 })
  assert.equal(done.text, '\nabc')
  assert.equal(done.head, 0)
})

test('有选区：先删选区再拆（EnterAction.java:60），落点是拆行之前的那个偏移', () => {
  const done = run('abcdef', EditorSelection.range(4, 2))
  assert.equal(done.text, 'ab\nef')
  assert.equal(done.head, 2, 'rangeMarker(:42) 在删除区间之前 ⇒ 回到 2，不是插入之后的 3')
})

test('单空光标时整刀交给回车链（:57-63 的委托），链动完手再把光标拽回切点', () => {
  // 假回车链：插「换行 + >>>」并把光标放到插入之后 —— 只有拽回切点这一步能证明委托走了 enter。
  const fake = view => { view.dispatch({ changes: { from: view.state.selection.main.head, insert: '\n>>>' } }); return true }
  const done = run('foobar', { anchor: 3, head: 3 }, fake)
  assert.equal(done.text, 'foo\n>>>bar')
  assert.equal(done.head, 3, '回车链把光标带到了 >>> 之后，拆行必须把它拽回切点')
})

test('多光标逐刀（:30 ForEachCaret）：每条光标回到自己那一刀的切点', () => {
  const done = apply(['foobar', 'qwerty'], [3, 9])
  assert.equal(done.text, 'foo\nbar\nqw\nerty')
  assert.deepEqual(done.heads, [3, 10], '第二刀的数值落点要跟上第一刀的净增减')
})

test('缩进那一支的纯算式：indentUpTo 只带到切点（EnterAction.java:65-66）', () => {
  assert.equal(indentUpTo('\t  x', 0, 3), '\t  ')
  assert.equal(indentUpTo('\t  x', 0, 1), '\t')
  assert.equal(indentUpTo('x  ', 0, 3), '', '切点前不是空白就什么都不带（不是「整行前导空白的其余部分」）')
})

test('算式：两条分支各落在哪（:50-55 的行首插入 / :63-67 的切点插入）', () => {
  // 切点前只有两个空格 ⇒ 走 `:52-54`：把「那段空白 + 换行」插到**行首**，落点仍是那个数值偏移。
  const blank = splitLinePlan('a\n  bc', Text.of(['a', '  bc']), [{ from: 4, to: 4 }])
  assert.deepEqual([...blank.changes], [{ from: 2, to: 2, insert: '  \n' }])
  assert.deepEqual([...blank.heads], [4])
  // 切点前有文字 ⇒ 在切点插「换行 + 该行前导空白」，落点在切点。
  const texted = splitLinePlan('a\nb  c', Text.of(['a', 'b  c']), [{ from: 5, to: 5 }])
  assert.deepEqual([...texted.changes], [{ from: 5, to: 5, insert: '\n' }])
  assert.deepEqual([...texted.heads], [5], '切点前是 b ⇒ indentUpTo 从行首带到切点，那一段里没有空白')
})

test('只读文档不动作，键位让给下一张 keymap', () => {
  let state = EditorState.create({ doc: 'abc', extensions: [EditorState.readOnly.of(true)] })
  const view = { get state () { return state }, dispatch: (...specs) => { state = state.update(...specs).state } }
  assert.equal(splitLineCommand(insertNewlineAndIndent)(view), false)
})

test('接线：Ctrl+Enter 真的绑在这条命令上（$default.xml:959-961 = control ENTER）', () => {
  const view = readFileSync(new URL('../src/components/CodeEditor.vue', import.meta.url), 'utf8')
  assert.match(view, /import \{ splitLineCommand \} from '\.\.\/editorSplitLine'/)
  assert.match(view, /\{ key: 'Ctrl-Enter', preventDefault: true, run: splitLineCommand\(smartEnter\) \}/,
    'Ctrl+Enter 没接到拆行命令 ⇒ 本仓这条键位是空的')
  // 这一条要排在 basicSetup 之前，否则回车链先赢（与 Enter 那一行同一个理由）。
  assert.ok(view.indexOf(`{ key: 'Ctrl-Enter'`) < view.indexOf('basicSetup,'),
    'Ctrl-Enter 排在 basicSetup 之后 ⇒ 键会被默认档吃掉')
})
