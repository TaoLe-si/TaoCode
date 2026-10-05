// 注释切换（`src/commentToggle.ts`）—— 上游 `CommentByLineCommentHandler` /
// `CommentByBlockCommentHandler` 的文本子集：行/块两个动作、缩进与空格规则、往返幂等。
import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import {
  applyCommentEdits, blockCommentCommand, commentStyleFor, lineCommentCommand, toggleBlockComment, toggleLineComment,
} from '../src/commentToggle.ts'

const JAVA = { line: '//', block: ['/*', '*/'] }
const HASH = { line: '#' }

function line(text, from, to = from, style = JAVA) {
  const outcome = toggleLineComment(text, from, to, style)
  return outcome && applyCommentEdits(text, outcome.edits)
}

function block(text, from, to = from, style = JAVA) {
  const outcome = toggleBlockComment(text, from, to, style)
  return outcome && applyCommentEdits(text, outcome.edits)
}

test('行注释：空选区给光标所在行加前缀与一个空格，再按一次还原', () => {
  const once = line('const x = 1\n', 6)
  assert.equal(once, '// const x = 1\n')
  assert.equal(line(once, 9), 'const x = 1\n')
})

test('行注释：多行选区按块内最小缩进对齐，空行单独成一条注释', () => {
  const text = 'if (a) {\n\n    work();\n}\n'
  const commented = line(text, 0, text.length - 1)
  assert.equal(commented, '// if (a) {\n//\n//     work();\n// }\n')
  // 全部已注释 → 往返还原（空行那条也拆掉，且整行清空）。
  assert.equal(line(commented, 0, commented.length - 1), text)
})

test('行注释：混合行（有注释有未注释）→ 全部加注释；只有空行不算"已注释"', () => {
  const text = '// done\nplain\n'
  assert.equal(line(text, 0, text.length - 1), '// // done\n// plain\n')
  assert.equal(line('\n', 0, 0), '//\n')
})

test('行注释：选区末尾落在行首时不含最后一行（上游 :118-120）', () => {
  const text = 'a;\nb;\nc;\n'
  // 选到第二行行首（offset = 3）→ 只动第一行。
  assert.equal(line(text, 0, 3), '// a;\nb;\nc;\n')
})

test('行注释：取消时删前缀 + 一个后随空格；整行只剩注释时清空该行', () => {
  assert.equal(line('    // x = 1\n', 8), '    x = 1\n')
  assert.equal(line('    //x = 1\n', 8), '    x = 1\n')
  assert.equal(line('    //\n', 6), '\n')
  assert.equal(line('    //   \n', 6), '\n')
})

test('行注释：语言表按语言 id 与扩展名两种口径取标记', () => {
  assert.deepEqual(commentStyleFor('typescript', 'a.ts'), { line: '//', block: ['/*', '*/'] })
  assert.deepEqual(commentStyleFor(undefined, 'dir/a.py'), { line: '#' })
  assert.deepEqual(commentStyleFor(undefined, 'index.html'), { block: ['<!--', '-->'] })
  assert.equal(commentStyleFor('other', 'notes.unknown'), null)
})

test('块注释：空选区插入一对标记并把光标放进中间（BLOCK_COMMENT_ADD_SPACE）', () => {
  const outcome = toggleBlockComment('x\n', 1, 1, JAVA)
  assert.equal(applyCommentEdits('x\n', outcome.edits), 'x/*  */\n')
  assert.deepEqual(outcome.selection, { from: 4, to: 4 })
})

test('块注释：选区包裹标记，恰好包住时拆掉（含标记内空格）', () => {
  assert.equal(block('value = 1;\n', 0, 10), '/* value = 1; */\n')
  assert.equal(block('/* value = 1; */\n', 0, 16), 'value = 1;\n')
  assert.equal(block('/*value = 1;*/\n', 0, 14), 'value = 1;\n')
})

test('块注释：没有块标记的语言拒绝（返回 null）', () => {
  assert.equal(toggleBlockComment('echo hi\n', 0, 0, HASH), null)
})

// 命令层：CodeMirror 的 Command 只读 state、调 dispatch，真机函数可离线跑。
function run(command, doc, anchor, head = anchor, language = null) {
  const extensions = language ? [language] : []
  let state = EditorState.create({ doc, selection: { anchor, head }, extensions })
  const view = {
    get state() { return state },
    dispatch: (...specs) => { state = state.update(...specs).state },
  }
  return { ran: command(view), text: state.doc.toString(), head: state.selection.main.head }
}

test('命令层：注释标记取自 CodeMirror 语言数据 commentTokens', () => {
  // 手写一个最小 languageData（真机上由 @codemirror/lang-java 等提供）。
  const java = EditorState.languageData.of(() => [{ commentTokens: { line: '//', block: { open: '/*', close: '*/' } } }])
  const out = run(lineCommentCommand, 'x = 1\n', 2, 2, java)
  assert.equal(out.ran, true)
  assert.equal(out.text, '// x = 1\n')
  assert.equal(out.head, 5, '光标被前缀推到注释文本之后')
  const back = run(lineCommentCommand, out.text, 5, 5, java)
  assert.equal(back.text, 'x = 1\n')
})

test('命令层：没有语言数据（无 Commenter）时不吞键', () => {
  const out = run(lineCommentCommand, 'plain text\n', 0, 0)
  assert.equal(out.ran, false)
  assert.equal(out.text, 'plain text\n')
})

test('命令层：块命令对空选区插入双空格标记', () => {
  const java = EditorState.languageData.of(() => [{ commentTokens: { line: '//', block: { open: '/*', close: '*/' } } }])
  const out = run(blockCommentCommand, 'a\n', 1, 1, java)
  assert.equal(out.ran, true)
  assert.equal(out.text, 'a/*  */\n')
})
