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
  enterAfterUnmatchedBrace, enterInLineComment, enterInStringLiteral, lexUntil, smartEnterCommand, structuralBraceCounts,
  LEX_BLOCK_COMMENT, LEX_CODE, LEX_LINE_COMMENT, LEX_STRING, LEX_TEXT_BLOCK,
} from '../src/enterHandlers.ts'
import { ENTER_HANDLER_ORDER, preprocessSteps } from '../src/enterHandlerOrder.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const java = { line: '//' }
// 完整一份 Java 词法（行前缀 + 块注释四件套）：`lexUntil` 只认语言给了的前缀，
// 上游那两个 getter 都在 `Commenter` 上（`JavaCommenter.java:27-28/:32-33`）。
const fullJava = {
  line: '//',
  block: { block: ['/*', '*/'], docPrefix: '/**', linePrefix: '*' },
}
const javaEnterLanguage = () => fullJava

// 端到端跑一次命令（假 view，与 tests/editor-commands.test.mjs 同一套写法）：
// 单元层只看返回值，光标最终落在哪儿只有把 `insertNewlineAndIndent` 那一跳也算进来才看得见。
function runEnter(doc, caret) {
  return runEnterWith(doc, caret, fullJava)
}

function runEnterWith(doc, caret, lexicon) {
  let state = EditorState.create({ doc, selection: { anchor: caret } })
  const view = { get state() { return state }, dispatch: (...specs) => { state = state.update(...specs).state } }
  const handled = smartEnterCommand(() => lexicon)(view)
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
  // 订正（2026-10-06 · edact3）：次序改成表驱动（src/enterHandlerOrder.ts）之后，原来那一段
  // `if (inComment) … insertNewlineAndIndent(view)` 拆成了「分支给载荷 + applyEnterHit 落换行」，
  // 切片锚点 `if (inComment)` 已不存在。原断言的两件事一件没松：
  // ① 行注释那一条仍然在表里、仍然自己声明 caretAdvance（`EnterInLineCommentHandler.java:88` 那一档）；
  const branch = source.slice(source.indexOf('EnterInLineCommentHandler: ctx =>'), source.indexOf('afterUnmatchedBrace: ctx =>'))
  assert.match(branch, /enterInLineComment\(ctx\.lineText, ctx\.caret, ctx\.lexicon, ctx\.lex\)/,
    '行注释那一条没接进次序表')
  assert.match(branch, /caretAdvance: inComment\.caretAdvance/, ':85-87 的 caretAdvance 丢了')
  // ② 换行真的被执行（= 原断言要防的那个回归）。
  const apply = source.slice(source.indexOf('export function applyEnterHit'), source.indexOf('export function smartEnterCommand'))
  assert.match(apply, /insertNewlineAndIndent\(view\)/,
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

// ── ④ 四条的次序：按上游注册表**排完序**的有效次序问（`order="last"` 的那条排到最后） ────
// 订正（2026-10-06）：这一族原来钉的是「行注释排在字面量之前」，理由写的是「否则 `// 说 "abc` 里的引号
// 会被字面量那条误切」。那是拿**问法次序**当**词法**用 —— 上游区分这两件事靠 token 类型：
// `platform/lang-impl/src/com/intellij/codeInsight/editorActions/enter/EnterInStringLiteralHandler.java:39-42`
// 先问 `isInStringLiteral`、`:116-125` 读的是 `offset-1` 那个 token 的类型（注释 token 直接 false），
// `enter/EnterInLineCommentHandler.java:97` 要求光标前那个 token 是**行注释**类型。
// 注册表 `platform/lang-impl/resources/intellij.platform.lang.impl.xml`：`:1159` 字面量 → `:1160` 行注释 →
// `:1163-1164` 未配对左花括号 →（`:1165-1166` 成对花括号：本仓由 CodeMirror 承担）→
// `:1161-1162` 块注释（`order="last"`）。循环与 break 的口径在 `EnterHandler.java:136-153`。
// 本批把词法补上（`lexUntil`）之后次序就照抄上游，被钉的断言因此**改严**（下面第 2、3 条）。
test('回车四条按上游有效次序问：字面量 → 行注释 → 左花括号 → 块注释（order="last" 排最后）', () => {
  const source = readFileSync(join(root, 'src/enterHandlers.ts'), 'utf8')
  assert.match(source, /intellij\.platform\.lang\.impl\.xml[\s\S]{0,600}:1159/, '没引上游注册表的行号')
  assert.match(source, /EnterHandler\.java:136-137/,
    '没引「按注册表顺序逐个问」的依据（订正：那条循环在 EnterHandler.java:136-137，旧断言核的 :181 是 postProcessEnter）')
  const command = source.slice(source.indexOf('export function smartEnterCommand'))
  assert.match(command, /preprocessEnter\(ENTER_HANDLER_ORDER/,
    '2026-10-06 · edact3：次序改成读 src/enterHandlerOrder.ts 那张表，循环入口不在这了 ⇒ 改钉表本身（下面两条）')
  // 次序不再散在 if 链里 ⇒ 钉表：rank 升序、id 序列、每条带的注册行号，一条都不能少。
  const steps = preprocessSteps(ENTER_HANDLER_ORDER).filter(step => step.ported)
  assert.deepEqual(steps.map(step => step.id), [
    'EnterInStringLiteralHandler', 'EnterInLineCommentHandler', 'afterUnmatchedBrace',
    'EnterBetweenBracesHandler', 'blockComment',
  ], '次序必须是上游排完序的有效次序：字面量(:1159) → 行注释(:1160) → 左花括号(:1163-1164) → 块注释(:1161-1162 的 order="last")')
  assert.deepEqual(steps.map(step => step.xml), [
    'intellij.platform.lang.impl.xml:1159', 'intellij.platform.lang.impl.xml:1160',
    'intellij.platform.lang.impl.xml:1163-1164', 'intellij.platform.lang.impl.xml:1165-1166',
    'intellij.platform.lang.impl.xml:1161-1162',
  ], '每条的注册行要指得到上游那张表')
  assert.deepEqual(steps.map(step => step.rank), [1, 2, 3, 4, 6], 'rank 与 id 序列必须一致（块注释被 order="last" 推到 6）')
  // 四条问法在 src/enterHandlers.ts 里都还得在（表里有、没人实现 = 少一条）。
  const impls = source.slice(source.indexOf('const ENTER_IMPLS'), source.indexOf('export function applyEnterHit'))
  const order = ['enterInStringLiteral(ctx.lineText', 'enterInLineComment(ctx.lineText',
    'enterAfterUnmatchedBrace(ctx.docText', 'enterInBlockComment(ctx.docText'].map(step => impls.indexOf(step))
  assert.deepEqual(order.map(at => at >= 0), [true, true, true, true], '四条问法少了一条')
  assert.deepEqual([...order].sort((a, b) => a - b), order, '本仓那四条的实现体也得按同一次序摆（读的人按这个次序对表）')
})

test('词法（lexUntil）才是「引号在注释里 / `//` 在字符串里」的防线，不是问法次序', () => {
  // `x = "a/b" /* c */ y // z`：字符串 1、块注释 3、行注释 2，其余是代码。
  const { kinds, starts } = lexUntil('x = "a/b" /* c */ y // z', 24, fullJava)
  assert.deepEqual(kinds, [0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 3, 3, 3, 3, 3, 3, 3, 0, 0, 0, 2, 2, 2, 2, 0],
    '最后一格是「光标在行尾」的哨兵，恒为代码')
  assert.deepEqual(starts.slice(4, 5), [4], '字符串 token 的开引号下标')
  assert.deepEqual(starts.slice(10, 11), [10], '块注释 token 的起始下标')
  assert.deepEqual(starts.slice(20, 21), [20], '行注释 token 的起始下标')
  assert.deepEqual([kinds[5], kinds[12], kinds[21]], [LEX_STRING, LEX_BLOCK_COMMENT, LEX_LINE_COMMENT])
  assert.equal(kinds[LEX_CODE], LEX_CODE, '常数对得上')
  assert.equal(lexUntil('x = """abc', 9, fullJava).kinds[8], LEX_TEXT_BLOCK, '三引号开 face 之后整段是文本块')
  // 同一行里的 `//` 在字符串里 ⇒ 行注释那条不接管（改动前会把它当注释续行，是用户能看见的错）。
  assert.equal(enterInLineComment('String s = "http://x"', 17, fullJava), null,
    'EnterInLineCommentHandler.java:97 要的是行注释 token，那个 `//` 属于字符串 token')
  // 反过来：注释里的引号不是一把新字面量的开引号，而注释那条照样接管这一下回车。
  assert.equal(enterInStringLiteral('// 说 "abc', 8, fullJava), null,
    'EnterInStringLiteralHandler.java:116-125 读 offset-1 那个 token，注释 token 直接 false')
  assert.equal(runEnter('// 说 "abc def', 8).doc, '// 说 "ab\n// c def', '行注释那条仍接管（旧断言里那条行为不变）')
  // 端到端：`String s = "http://x"` 里回车走字面量那条（上游 `:71-72` 插首字符+连接符+空格+首字符）。
  const entered = runEnter('String s = "http://x"', 17)
  assert.equal(entered.doc, 'String s = "http:" +\n"//x"', '切的是字面量，不是把 `//` 当注释续行')
})

test('第二个字面量、文本块与「按语言决定能不能切」（改动前这三处都判错）', () => {
  // `foo("a", "bcd")`：光标在第二个字面量里。改动前 `indexOf('"')` 只看第一个字面量、撞到收尾引号就放弃。
  assert.deepEqual(enterInStringLiteral('foo("a", "bcd")', 13, fullJava), { at: 13, insert: '" + "' })
  // Java 文本块不在「能连的字符串」那张表里（`JavaQuoteHandler.java:32`）⇒ 整段不切。
  assert.equal(enterInStringLiteral('x = """abc', 8, fullJava), null, '三引号开 face 之后的正文不是 STRING token')
  // 文本块跨行：第二行 `ab "cd"` 里的那个引号仍在 face 里（状态从全文开头推）。
  assert.equal(runEnter('String s = """\nab "cd"', 20).handled, false, '文本块续行里回车不切字符串')
  // 宿主给了语言 id、而那张引号表里没有这门语言 ⇒ 上游那道 instanceof JavaLikeQuoteHandler 的门槛拦住。
  assert.equal(enterInStringLiteral('foo("a", "bcd")', 13, { line: '//', stringConcat: null }), null,
    'EnterInStringLiteralHandler.java:39-42：不是 JavaLikeQuoteHandler 就整条 Continue')
})

test('两条回车开关：insertBraceOnEnter（:130/:84-87）与 blockCloseOnEnter（:132/:62）', () => {
  const base = { line: '//' }
  const block = { block: ['/*', '*/'], docPrefix: '/**', linePrefix: '*' }
  // 上游关掉 INSERT_BRACE_ON_ENTER ⇒ getMaxRBraceCount 返回 0 ⇒ 整条不接管（交回默认回车）。
  assert.equal(runEnterWith('if (x) {', 8, { ...base, insertBraceOnEnter: false }).handled, false)
  assert.equal(runEnterWith('if (x) {', 8, { ...base, insertBraceOnEnter: true }).doc, 'if (x) {\n\n}')
  assert.equal(runEnterWith('if (x) {', 8, base).doc, 'if (x) {\n\n}', '没给开关时按上游默认 true')
  // 上游关掉 CLOSE_COMMENT_ON_ENTER ⇒ 没闭合的块注释不再补闭尾（`* ` 续行那一支不受它管）。
  assert.equal(runEnterWith('/*abc', 3, { ...base, block, blockCloseOnEnter: false }).handled, false)
  assert.equal(runEnterWith('/*abc', 3, { ...base, block, blockCloseOnEnter: true }).doc, '/*a\nbc\n */')
  assert.equal(runEnterWith('/*abc', 3, { ...base, block }).doc, '/*a\nbc\n */', '没给开关时按上游默认 true')
})

