// 回车家族里 `src/enterHandlers.ts` 那三条的判据（此前这一族只有 `smartEnter.ts` 有判据，
// `enterHandlers.ts` 的四个导出**一个测试都没有** —— 补上，并把「只插前缀不换行」那个回归钉住）。
//
// 上游坐标（逐条行号见 `src/enterHandlers.ts` 头注释，2026-10-06 与上游逐行核对）：
//   · `platform/lang-impl/src/com/intellij/codeInsight/editorActions/enter/EnterInLineCommentHandler.java:45-46/52-62/63-88`
//   · `enter/EnterAfterUnmatchedBraceHandler.java:99-114/135-144/173/322-378`
//   · `enter/EnterInStringLiteralHandler.java:44-48/66-81`
//   · 注册表与次序：`platform/lang-impl/resources/intellij.platform.lang.impl.xml:1159-1171`
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EditorState } from '@codemirror/state'
import {
  enterAfterUnmatchedBrace, enterInLineComment, enterInStringLiteral, smartEnterCommand, structuralBraceCounts,
} from '../src/enterHandlers.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const java = { line: '//' }
const javaEnterLanguage = () => ({
  line: '//',
  block: { block: ['/*', '*/'], docPrefix: '/**', linePrefix: '*' },
})

// 端到端跑一次命令（假 view，与 tests/editor-commands.test.mjs 同一套写法）：
// 单元层只看返回值，光标最终落在哪儿只有把 `insertNewlineAndIndent` 那一跳也算进来才看得见。
function runEnter(doc, caret) {
  let state = EditorState.create({ doc, selection: { anchor: caret } })
  const view = { get state() { return state }, dispatch: (...specs) => { state = state.update(...specs).state } }
  const handled = smartEnterCommand(javaEnterLanguage)(view)
  return { handled, doc: state.doc.toString(), caret: state.selection.main.head }
}

// ── ① 行注释（EnterInLineCommentHandler） ────────────────────────────────────────────
test('行尾回车不续行注释（:45-46 的两条 Continue 条件）', () => {
  assert.equal(enterInLineComment('// abc', 6, java), null, '光标就在行尾')
  assert.equal(enterInLineComment('// abc  ', 6, java), null, '跳完空白就到行尾也算')
  assert.equal(enterInLineComment('// abc  ', 8, java), null)
})

test('整行只有注释时：光标处补出前缀，并沿用本行前缀后面的空白当分隔（:63-75、:82）', () => {
  const result = enterInLineComment('// abc def', 4, java)
  assert.deepEqual(result.edits, [{ from: 4, insert: '// ' }])
  assert.equal(result.caretAdvance, 3, 'prefixTrimmed.length + spacing.length（:85-87）')
  // :65-67 沿用注释里已有的那段空白（这里是两个空格）
  const wide = enterInLineComment('//  abc def', 5, java)
  assert.deepEqual(wide.edits, [{ from: 5, insert: '//  ' }])
  assert.equal(wide.caretAdvance, 4)
})

test('光标后面被跳过的空白要删掉（:76-77），只在整行只有注释这一支', () => {
  const result = enterInLineComment('// abc   def', 6, java)
  assert.deepEqual(result.edits, [{ from: 6, to: 9 }, { from: 6, insert: '// ' }])
  // 注释前面还有代码 ⇒ 不删空白，也不按「整行只有注释」挪光标
  const afterCode = enterInLineComment('int x; // abc def', 12, java)
  assert.deepEqual(afterCode.edits, [{ from: 12, insert: '// ' }])
  assert.equal(afterCode.caretAdvance, 0, ':85-87：只有 onlyCommentInCaretLine 才挪光标')
})

test('注释前有代码且光标正挨着一个空格 ⇒ 不补分隔（:80）', () => {
  const result = enterInLineComment('int x; // abc def', 13, java)
  assert.deepEqual(result.edits, [{ from: 13, insert: '//' }])
})

test('光标后面紧跟又一个行注释前缀：补缺的那一个空格，光标仍按 :85-87 前进（订正）', () => {
  const result = enterInLineComment('// abc//def', 6, java)
  assert.deepEqual(result.edits, [{ from: 8, insert: ' ' }])
  // 订正（2026-10-06）：旧断言写 `caretAdvance === 0`（「光标不动」），那是实现被改坏时的值。
  // 上游 `EnterInLineCommentHandler.java:85-87` 的 caretAdvance 在 `:56-62` / `:63-83` 那个
  // if/else 的**外面**，整行只有注释时这一支也照设；`spacing` 在这一支没被改过（`:55` 就是 `" "`），
  // 所以是 `prefixTrimmed.length() + spacing.length()` = 3。`:61` 把光标推到那个前缀上，
  // 本仓由 `insertNewlineAndIndent` 吞掉光标后的空白，切点与文档结果一致（端到端见下一条）。
  assert.equal(result.caretAdvance, 3, ':85-87（整行只有注释时这一支同样前进 prefixTrimmed + spacing）')
  const alreadySpaced = enterInLineComment('// abc// def', 6, java)
  assert.deepEqual(alreadySpaced.edits, [], '前缀后面已经有空格 ⇒ 什么都不改')
  assert.equal(alreadySpaced.caretAdvance, 3, ':85-87 与补不补那个空格无关')
  // 端到端：换行后光标要停在补出来的 `// ` 之后（= 新行行首 + 3），停在行首等于把光标丢在前缀外面。
  const entered = runEnter('// abc//def', 6)
  assert.equal(entered.doc, '// abc\n// def', ':59 补空格 + 默认回车把那个前缀推到下一行')
  assert.equal(entered.caret, entered.doc.indexOf('// def') + 3, ':85-87 的 caretAdvance 落在端到端结果上')
})

test('三条退出门槛：offset < 1（:94）、语言没有行注释、前缀不在光标之前（:103-105）', () => {
  assert.equal(enterInLineComment('// abc', 0, java), null, ':94 offset < 1')
  assert.equal(enterInLineComment('// abc', 1, { line: '' }), null, '没有行注释前缀')
  assert.equal(enterInLineComment('// abc', 1, java), null, '前缀没在光标之前结束（:103-105）')
  assert.equal(enterInLineComment('abc // x', 1, java), null, '这一行光标之前没有行注释')
})

test('命令里注释那一步之后必须真的执行换行（回归：只插前缀不换行等于把注释复制了一遍）', () => {
  const source = readFileSync(join(root, 'src/enterHandlers.ts'), 'utf8')
  const branch = source.slice(source.indexOf('if (inComment)'), source.indexOf('const block ='))
  assert.match(branch, /insertNewlineAndIndent\(view\)/,
    'EnterInLineCommentHandler.java:88 的 Result.DefaultForceIndent 没人执行')
})

// ── ② 未配对的左花括号（EnterAfterUnmatchedBraceHandler） ─────────────────────────────
test('structuralBraceCounts：只数代码里的花括号（:344-375），字符串与注释里的不算', () => {
  assert.deepEqual(structuralBraceCounts('if (x) {\n', 8), { left: 1, right: 0 })
  assert.deepEqual(structuralBraceCounts('{{', 2), { left: 2, right: 0 })
  assert.deepEqual(structuralBraceCounts('x = "{"', 6), { left: 0, right: 0 }, '字符串里的 { 不算')
  assert.deepEqual(structuralBraceCounts('{}', 1), { left: 0, right: 0 }, '右括号追平 ⇒ 归零（:369-372）')
  assert.equal(structuralBraceCounts('abc', 1), null, '光标前一个字符不是 { （:327-329）')
})

test('enterAfterUnmatchedBrace：光标后面就是行尾才动手（:135-144 没有 PSI 就不猜）', () => {
  assert.deepEqual(enterAfterUnmatchedBrace('if (x) {', 8, '  '), { at: 8, text: '  }' })
  assert.deepEqual(enterAfterUnmatchedBrace('{{', 2, ''), { at: 2, text: '}}' }, ':104-113 数连续空白里的 {')
  assert.equal(enterAfterUnmatchedBrace('{ x }', 1, ''), null, '后面还有内容 ⇒ 交回默认回车')
  assert.equal(enterAfterUnmatchedBrace('const s = "{ "', 13, ''), null, '那个 { 在字符串里 ⇒ 没有未配对的左括号')
})

// ── ③ 字符串字面量（EnterInStringLiteralHandler） ────────────────────────────────────
test('enterInStringLiteral：插 " + "，光标停在补出来的第二个引号之后（:66-81）', () => {
  assert.deepEqual(enterInStringLiteral('String s = "abcd"', 14), { at: 14, insert: '" + "' })
  assert.equal(enterInStringLiteral('String s = "abcd"', 12), null, '光标就在开引号后一位（:46）')
  assert.equal(enterInStringLiteral('String s = "abcd"', 17), null, '已经过了收尾引号')
  assert.equal(enterInStringLiteral('String s = abcd', 5), null, '这一行没有字面量')
  assert.equal(enterInStringLiteral('"a\\', 3), null, '光标落在转义序列里（:69 skipStringLiteralEscapes 的位置）—— 词法层判不准，不猜')
  // 端到端（订正 2026-10-06）：换行的切点必须在 `" +` **之后**、补出来的那个引号之前
  // （`EnterInStringLiteralHandler.java:73` `caretOffset += insertedFragment.length()`，
  // insertedFragment = 首字符 + 空格 + 连接符 = 3，`:71-72`），`:74` 的 `caretAdvance = 1`
  // 再把光标推进到那个引号之后。旧实现在插入处直接换行 ⇒ 上一行留下没闭合的字面量
  // `String s = "ab`，下一行 `" + "cd"`，写出来的代码是坏的。
  const entered = runEnter('String s = "abcd"', 14)
  assert.equal(entered.doc, 'String s = "ab" +\n"cd"', ':72 插入 + :73 在其后切行')
  assert.equal(entered.caret, entered.doc.indexOf('"cd"') + 1, ':74 caretAdvance=1 ⇒ 光标在补出来的第二个引号之后')
})

// ── ④ 四条的次序与 EnterBetweenBraces 的落点（架构差别，照实钉住） ────────────────────
test('回车四条的问法次序与注释里引号的保护（文件头记录了与上游 EP 次序的差异）', () => {
  const source = readFileSync(join(root, 'src/enterHandlers.ts'), 'utf8')
  assert.match(source, /intellij\.platform\.lang\.impl\.xml[\s\S]{0,400}:1159/, '没引上游注册表的行号')
  assert.match(source, /EnterHandler\.java:136-137/,
    '没引「按注册表顺序逐个问」的依据（订正：那条循环在 EnterHandler.java:136-137，旧断言核的 :181 是 postProcessEnter）')
  const command = source.slice(source.indexOf('export function smartEnterCommand'))
  const commentStep = command.indexOf('enterInLineComment(lineText')
  const stringStep = command.indexOf('enterInStringLiteral(lineText')
  assert.ok(commentStep < stringStep, '行注释要排在字面量之前：否则 `// 说 "abc` 里的引号会被误切')
  // 注释里的引号由「先问注释」这一条保护住：这一例行注释那条接管了，命令走不到字面量那条。
  assert.ok(enterInLineComment('// 说 "abc', 8, java), '行注释那条该接管这一下回车')
  assert.equal(enterInStringLiteral('// 说 "abc', 8)?.insert, '" + "',
    '单看字面量那条会误切 —— 问法次序就是它的防线（文件头有记录）')
})
