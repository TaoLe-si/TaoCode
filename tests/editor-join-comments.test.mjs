// 注释里的「合并行」（上游 `CommentJoinLinesHandler`，注册证据
// `platform/lang-impl/resources/intellij.platform.lang.impl.xml:1676`）。
// 判据分两层：纯函数那一层逐条对着上游的行号断言，命令那一层确认它真的接进了 Ctrl+Shift+J。
import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { java } from '@codemirror/lang-java'
import { JOIN_DOC_LINE_PREFIXES, commentSpans, joinCommentBreak, joinCommentLines } from '../src/editorJoinComments.ts'
import { joinLinesCommand } from '../src/editorCommands.ts'

const JAVA = { line: '//', block: ['/*', '*/'] }
const filled = (text, from = 0, to = from, style = JAVA, margin = 120) => {
  const result = joinCommentLines(text, from, to, style, margin)
  return result ? result.filled : null
}

// CodeMirror 的 Command 只读 view.state、调 view.dispatch ⇒ 离线就能跑（与 tests/editor-commands.test.mjs 同一手法）。
function run(command, doc, anchor, head = anchor, extensions = []) {
  let state = EditorState.create({ doc, selection: { anchor, head }, extensions })
  const view = { get state() { return state }, dispatch: (...specs) => { state = state.update(...specs).state } }
  return { ran: command(view), text: state.doc.toString() }
}

test('相邻两个行注释：吃掉第二行的前缀（CommentJoinLinesHandler.java:59-64、:92-93）', () => {
  assert.equal(filled('// aaa\n// bbb\n'), '// aaa bbb')
  assert.equal(filled('//aaa\n//bbb'), '//aaa bbb')
})

test('三行以上一次命令收拢（每行行首都只留一份前缀）', () => {
  assert.equal(filled('// a\n// b\n// c', 0, 15), '// a b c')
})

test('块注释：吃掉续行的行首 *（:41-46），收尾那一行的 */ 不算续行', () => {
  assert.equal(filled('/* aaa\n * bbb\n */', 0, 17), '/* aaa bbb */')
  // 第三行是 `*/` ⇒ `:41` 的 `text.charAt(end + 1) != '/'` 挡住，不吞收尾。
  assert.equal(joinCommentBreak('/* aaa\n * bbb\n */', 1, JAVA, 120).text, '/* aaa\n * bbb */')
})

test('同一注释内部 ⇒ 粘一个空格；两侧不都在注释里 ⇒ 委托不认（:31-33 的 CANNOT_JOIN）', () => {
  assert.equal(filled('/* aaa\n   bbb */', 0, 14), '/* aaa bbb */')
  assert.equal(filled('code();\n// aaa\n'), null)
  assert.equal(filled('// aaa\ncode();\n'), null)
  assert.equal(filled('// only\n'), null, '最后一行没有可合并的换行')
})

test('字符串里的 // 不算注释：委托直接不认', () => {
  assert.equal(filled('const s = "a//b"\nconst t = 1\n'), null)
  assert.deepEqual(commentSpans('const s = "a//b"\n// real\n', JAVA), [{ from: 17, to: 24, kind: 'line' }])
})

test('右边距：合并后会越界时只搬不越界的那部分（:65-87）', () => {
  const first = `// ${'x'.repeat(20)}`
  const text = `${first}\n// alpha beta gamma delta`
  const margin = first.length + 6
  const result = joinCommentLines(text, 0, 0, JAVA, margin)
  assert.equal(result.text.split('\n').length, 2, '越界时第二行留在原地')
  assert.ok(result.text.startsWith(`${first} alpha`), result.text)
  assert.ok(result.text.split('\n')[0].length <= margin, `留在首行的部分仍越过右边距：${result.text.split('\n')[0].length}`)
  assert.ok(result.text.split('\n')[1].includes('beta gamma delta'), result.text)
})

test('第一行本身已越过右边距 ⇒ 不再搬词（:70 的 lineLength <= margin 门槛），整段收成一行', () => {
  const result = joinCommentLines(`// ${'w '.repeat(80)}\n// tail\n`, 0, 0, JAVA, 40)
  assert.equal(result.text.trimEnd().split('\n').length, 1)
})

test('Java 的 /// 走 :59-64 那一个循环：前缀表里的 // 先命中 ⇒ 留下第三个斜杠（上游同一条形状）', () => {
  const doc = { line: '//', block: ['/*', '*/'], docLines: ['///'] }
  assert.equal(filled('/// aaa\n/// bbb', 0, 0, doc), '/// aaa / bbb')
})

test('命令层：编辑器里有 Java 语言数据时 Ctrl+Shift+J 走注释那一档', () => {
  assert.deepEqual(
    run(joinLinesCommand, '// aaa\n// bbb\nint x;\n', 0, 0, [java()]),
    { ran: true, text: '// aaa bbb\nint x;\n' },
  )
})

test('命令层：代码行仍然是普通粘连（不被注释档抢走）', () => {
  assert.equal(run(joinLinesCommand, 'aaa\n  bbb\n\nccc\n', 0, 0, [java()]).text, 'aaa bbb\n\nccc\n')
})
