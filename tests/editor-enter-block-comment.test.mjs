// 回车家族里**块注释**那一条的判据（上游 `enter/EnterInBlockCommentHandler.java:31-101`，
// 实现 `src/editorEnterBlockComment.ts`）。注册表位置与逐条行号见那个文件的头注释。
//
// 四条上游行为各自的出处：
//   · `:42-43` + `:103-120` 光标要在块注释 token 里、要在 `/*` 之后、不能在收尾 `*/` 里面；
//   · `:48-51` 文档注释 `/**` 开头 ⇒ 让给文档注释那一族（本仓不接）；
//   · `:53-54` `/*` 前面除了空白不能有别的东西；
//   · `:62-68` 注释没闭合 ⇒ 光标行行尾补「缩进 + */」（`Result.Default`）；
//   · `:86-98` 有 `*` 行前缀 ⇒ 在光标处补 `* `，`caretAdvance = 2`（`Result.DefaultForceIndent`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  blockCommentAt, blockCommentClose, blockCommentComplete, blockCommentStartOffset, blockLexiconFor, enterInBlockComment,
} from '../src/editorEnterBlockComment.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const java = { block: ['/*', '*/'], docPrefix: '/**', linePrefix: '*' }

test('blockLexiconFor：本仓的注释标记 → 上游 CodeDocumentationAwareCommenter 那三件套', () => {
  // JavaCommenter.java:27-28 / :32-33 / :62-63（`/**` = 块前缀 + `*`）/ :67-68（续行 `*`）。
  assert.deepEqual(blockLexiconFor({ block: ['/*', '*/'] }),
    { block: ['/*', '*/'], docPrefix: '/**', linePrefix: '*' })
  // 块前缀不是 `/*` 的语言没有文档注释形态 ⇒ 只给 block：`EnterInBlockCommentHandler.java:86-87`
  // 在 linePrefix 为 null 时本来就不进 `* ` 续行那一支。
  assert.deepEqual(blockLexiconFor({ block: ['<!--', '-->'] }), { block: ['<!--', '-->'] })
  assert.deepEqual(blockLexiconFor({ block: ['--[[', ']]'] }), { block: ['--[[', ']]'] })
  assert.equal(blockLexiconFor({}), undefined, '没有块注释词法 ⇒ 这一条压根不问')
  assert.equal(blockLexiconFor(undefined), undefined)
})

test('blockCommentAt：认得出光标所在的那条块注释与它的闭尾（字符串、行注释里的 /* 不算）', () => {
  // EnterInBlockCommentHandler.java:103-112
  // 订正留痕（2026-10-06）：这一条旧断言写 `close: 6`，是过期断言、不是实现被改坏。
  // 上游 `enter/EnterInBlockCommentHandler.java:113-119`：`int tokenEnd = iterator.getEnd()` 取的是
  // **排他**末尾，随后 `offset > tokenEnd - suffix.length()` 才算「落在收尾里」，比较的正是
  // 闭尾 `*/` 的**起始**下标（`'/* a */'` ⇒ tokenEnd 7 − suffix 2 = 5）。实现的
  // `text.indexOf(close, start + open.length)`（`src/editorEnterBlockComment.ts:67`）同样给 5。
  assert.deepEqual(blockCommentAt('/* a */', 4, java), { start: 0, close: 5 }, 'close 是 */ 的起始下标')
  assert.deepEqual(blockCommentAt('const s = "/* x */";', 14, java), { start: -1, close: -1 }, '字符串里的不算')
  assert.deepEqual(blockCommentAt('// /* x\nfoo', 3, java), { start: -1, close: -1 }, '行注释里的不算')
  assert.deepEqual(blockCommentAt('/* a */\n/* b', 10, java), { start: 8, close: -1 }, '第二条没闭合')
})

test('blockCommentClose / blockCommentComplete：EnterHandler.java:207-210 的「必须以 suffix 收尾」', () => {
  // 5 = 闭尾 `*/` 的起始下标（同一处订正留痕，见上一条测试的注释；上游依据
  // `enter/EnterInBlockCommentHandler.java:113-119` 的 `offset > tokenEnd - suffix.length()`）。
  assert.equal(blockCommentClose('/* a */', 0, java), 5)
  assert.equal(blockCommentClose('/* a', 0, java), -1)
  assert.equal(blockCommentComplete('/* a */', 0, java), true)
  assert.equal(blockCommentComplete('/* a', 0, java), false, '没闭尾 ⇒ 注释不算写完')
  // Java 的块注释不嵌套：JavaCommenter.java:37-44 的两个 getCommentedBlockComment* 返回 null
  assert.equal(blockCommentComplete('/* /* ', 0, java), false, '内层那个 /* 不算闭尾')
})

test('blockCommentStartOffset：光标在 /* 之前（:112）或落在 */ 里面（:114-118）都退出', () => {
  assert.equal(blockCommentStartOffset('/* abc', 1, java), -1, 'caret 还在 /* 这一段里')
  assert.equal(blockCommentStartOffset('/* abc', 2, java), 0, '正好在 /* 之后才开始接管')
  assert.equal(blockCommentStartOffset('/* a */', 7, java), -1, '收尾 */ 里面不接管')
  assert.equal(blockCommentStartOffset('/* a */', 8, java), -1, '整条注释之后不接管')
  assert.equal(blockCommentStartOffset('foo', 1, java), -1)
  assert.equal(blockCommentStartOffset('/* a', 4, { linePrefix: '*' }), -1, '没有块注释词法 ⇒ 不接管')
})

test('块注释里回车：* 续行那一支（:86-98），前缀落在光标处、caretAdvance=2', () => {
  const text = '/*\n * one\n */'
  const caret = text.indexOf('\n', 3)  // ` * one` 的行尾
  const result = enterInBlockComment(text, caret, java)
  assert.ok(result, '这一支本该接管')
  assert.deepEqual(result.edits, [{ from: caret, to: caret, insert: '* ' }])
  assert.equal(result.caretAdvance, 2, 'linePrefix.length + 1（:97）')
  assert.equal(result.forceIndent, true, 'Result.DefaultForceIndent（:98）')
})

test('块注释里回车：参照行不是 * 开头就不接管（:89-91）', () => {
  const text = '/*\nfoo\n */'
  assert.equal(enterInBlockComment(text, text.indexOf('foo') + 3, java), null)
})

test('块注释没闭合：光标行行尾补「缩进 + */」（:62-68），且只走普通回车', () => {
  const text = '/*abc'
  const result = enterInBlockComment(text, text.length, java)
  assert.deepEqual(result.edits, [{ from: 5, insert: '\n */' }])
  assert.equal(result.caretAdvance, 0)
  assert.equal(result.forceIndent, false, 'Result.Default（:67），不是 DefaultForceIndent')
  // 缩进取 /* 那一行的前导空白（:66 的 text.subSequence(beforeWhitespace + 1, blockCommentStartOffset)）
  const indented = '    /*abc'
  assert.deepEqual(enterInBlockComment(indented, indented.length, java).edits, [{ from: 9, insert: '\n     */' }])
})

test('CLOSE_COMMENT_ON_ENTER 关掉时不补 */（CodeInsightSettings.java:132 是开关，默认 true）', () => {
  const text = '/*abc'
  assert.equal(enterInBlockComment(text, text.length, java, false), null, '注释没闭合又没有 * 续行 ⇒ 全部不接管')
})

test('文档注释 /** 开头那一段让给文档注释那一族（:48-51）', () => {
  const text = '/**\n * one'
  assert.equal(enterInBlockComment(text, text.length, java), null)
})

test('/* 不在行首（前面还有代码）时不接管（:53-54）', () => {
  const text = 'int x; /* abc'
  assert.equal(enterInBlockComment(text, text.length, java), null)
})

test('没有块注释词法的语言（py 只有 #）一律返回 null', () => {
  const text = '# 注释\n# 第二行'
  assert.equal(enterInBlockComment(text, text.length, { linePrefix: '*' }), null)
})

// ── 接线：enterHandlers 的命令必须真的问这一条，CodeEditor.vue 必须把块注释词法喂进来 ──────
test('smartEnterCommand 接上了块注释那一步（顺序：行注释 → 块注释 → 字面量 → 未配对右括号）', () => {
  const source = readFileSync(join(root, 'src/enterHandlers.ts'), 'utf8')
  assert.match(source, /from '\.\/editorEnterBlockComment\.ts'/, '没接上块注释模块')
  assert.match(source, /enterInBlockComment\(doc\.toString\(\), selection\.head, block\)/, '命令里没有真的问块注释')
  const command = source.slice(source.indexOf('export function smartEnterCommand'))
  const lineStep = command.indexOf('enterInLineComment(lineText')
  const blockStep = command.indexOf('enterInBlockComment(doc')
  const stringStep = command.indexOf('enterInStringLiteral(lineText')
  const braceStep = command.indexOf('enterAfterUnmatchedBrace(')
  assert.ok(lineStep < blockStep && blockStep < stringStep && stringStep < braceStep,
    '四条的先后次序变了：注释两条要排在字面量之前（见文件头的理由）')
})

test('Enter 键确实绑在回车家族上（上游 EditorEnter，$default.xml:800-801）', () => {
  const view = readFileSync(join(root, 'src/components/CodeEditor.vue'), 'utf8')
  assert.match(view, /\{ key: 'Enter', preventDefault: true, run: smartEnter \}/,
    'Enter 没接到 smartEnterCommand ⇒ 这四条全都落不了地')
  // 语言工厂必须把**块注释**那一半也喂进来：只给 `line` 时第②步在真实编辑器里永远问不到
  // （上游要的是 `CodeDocumentationAwareCommenter`，`EnterInBlockCommentHandler.java:38-39`；
  //  四件套对应关系 `JavaCommenter.java:27-28/:32-33/:62-63/:67-68`）。
  assert.match(view, /import \{ smartEnterCommand, smartEnterLanguageFor \} from '\.\.\/enterHandlers'/,
    'CodeEditor 没引词法装配出口 ⇒ 编辑器里按 Enter 不会补 */、也不会续行 `* `')
  assert.match(view, /smartEnterCommand\(\(\) => smartEnterLanguageFor\(/,
    'smartEnter 的语言工厂没走 smartEnterLanguageFor ⇒ 块注释那一半（第②步）在真实编辑器里问不到')
  const handlers = readFileSync(join(root, 'src/enterHandlers.ts'), 'utf8')
  assert.match(handlers, /export function smartEnterLanguageFor/, '装配出口被搬走了')
  assert.match(handlers, /return \{ line: style\?\.line, block: blockLexiconFor\(style \?\? undefined\) \}/,
    '出口没把块注释四件套翻成 lexicon')
})
