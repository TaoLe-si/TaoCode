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
test('smartEnterCommand 接上了块注释那一步（有效次序：字面量 → 行注释 → 左花括号 → 块注释）', () => {
  const source = readFileSync(join(root, 'src/enterHandlers.ts'), 'utf8')
  assert.match(source, /from '\.\/editorEnterBlockComment\.ts'/, '没接上块注释模块')
  // 订正（2026-10-06）：这一条原本钉的是「行注释 → 块注释 → 字面量 → 未配对右括号」，那是上一任为了
  // 绕开「行注释里的引号被字面量那条误切」而调的次序 —— 拿问法次序顶了词法的班。上游那张表
  // （`platform/lang-impl/resources/intellij.platform.lang.impl.xml`）排完序的有效次序是
  // `:1159` 字面量 → `:1160` 行注释 → `:1163-1164` 左花括号 → `:1161-1162` 块注释（`order="last"`），
  // 循环在 `EnterHandler.java:136-153`；区分那两件事靠的是 token 类型
  // （`enter/EnterInStringLiteralHandler.java:116-125`、`enter/EnterInLineCommentHandler.java:97`）。
  // 本批补了 `lexUntil` 那份词法 ⇒ 次序断言照上游改写，四条问法一条没少（下面逐条核）。
  // 订正（2026-10-06 · edact3）：次序改成表驱动之后这四条问法从 `smartEnterCommand` 的 if 链搬进了
  // `ENTER_IMPLS`（表在 src/enterHandlerOrder.ts），坐标也从 `docText/selection.head/lexicon` 改成
  // `ctx.docText/ctx.head/ctx.lexicon` ⇒ 下面两条锚点跟着搬，**断言强度不变**：
  // 「开关真的传进了 enterInBlockComment」与「四条问法一条没少、次序照上游」都还是逐字钉的。
  assert.match(source, /enterInBlockComment\(ctx\.docText, ctx\.head, block, ctx\.lexicon\.blockCloseOnEnter \?\? true\)/,
    '命令里没有真的问块注释，或没把 CLOSE_COMMENT_ON_ENTER（CodeInsightSettings.java:132）传进去')
  const impls = source.slice(source.indexOf('const ENTER_IMPLS'), source.indexOf('export function applyEnterHit'))
  const order = ['enterInStringLiteral(ctx.lineText', 'enterInLineComment(ctx.lineText',
    'enterAfterUnmatchedBrace(ctx.docText', 'enterInBlockComment(ctx.docText'].map(step => impls.indexOf(step))
  assert.deepEqual(order.map(at => at >= 0), [true, true, true, true], '四条问法少了一条')
  assert.deepEqual([...order].sort((a, b) => a - b), order,
    '次序要等于上游排完序之后的有效次序（块注释那条 order="last" ⇒ 排最后）')
})

test('Enter 键确实绑在回车家族上（上游 EditorEnter，$default.xml:800-801）', () => {
  const view = readFileSync(join(root, 'src/components/CodeEditor.vue'), 'utf8')
  // 常驻 keymap 那一张表 2026-10-06 搬进 src/editorKeymap.ts（CodeEditor.vue 贴着机检上限，
  // 拆一次降一次）；判据跟着搬到新落点，钉的仍是同一条键位，没有放松。
  const keymap = readFileSync(join(root, 'src/editorKeymap.ts'), 'utf8')
  assert.match(keymap, /\{ key: 'Enter', preventDefault: true, run: smartEnter \}/,
    'Enter 没接到 smartEnterCommand ⇒ 这四条全都落不了地')
  // 语言工厂必须把**块注释**那一半也喂进来：只给 `line` 时第②步在真实编辑器里永远问不到
  // （上游要的是 `CodeDocumentationAwareCommenter`，`EnterInBlockCommentHandler.java:38-39`；
  //  四件套对应关系 `JavaCommenter.java:27-28/:32-33/:62-63/:67-68`）。
  // 订正（2026-10-06 · edinput3）：宿主那一行改成了 `smartEnterLanguageForView(view, path, language, settings)`
  // —— 注释词法的两次调用搬进了模块（`CodeEditor.vue` 顶在 1147 行上限，要给它腾出拆行/列模式两行键位），
  // 意图没变：块注释那一半仍必须由 enterHandlers 那个出口喂进来。断言跟着换成新出口名，**没有放松**。
  assert.match(view, /import \{ smartEnterCommand, smartEnterLanguageForView \} from '\.\.\/enterHandlers'/,
    'CodeEditor 没引词法装配出口 ⇒ 编辑器里按 Enter 不会补 */、也不会续行 `* `')
  assert.match(view, /smartEnterCommand\(\(\) => smartEnterLanguageForView\(view, props\.path, props\.language, props\.settings\)\)/,
    'smartEnter 的语言工厂没走模块出口 ⇒ 块注释那一半（第②步）在真实编辑器里问不到；'
    + '少传 props.settings 就是设置页那两格（closeCommentOnEnter / insertBraceOnEnter）没有消费方')
  const handlers = readFileSync(join(root, 'src/enterHandlers.ts'), 'utf8')
  assert.match(handlers, /export function smartEnterLanguageFor/, '装配出口被搬走了')
  // 两条开关（上游 `CodeInsightSettings.java:130`/`:132`，本仓 `settingsModel.ts:429`/`:431`）要在模块里
  // 真的落到 `EnterLanguage` 那两个字段上，缺省按上游默认 true。
  assert.match(handlers, /blockCloseOnEnter: settings\?\.closeCommentOnEnter \?\? true/, 'closeCommentOnEnter 没落到 blockCloseOnEnter')
  assert.match(handlers, /insertBraceOnEnter: settings\?\.insertBraceOnEnter \?\? true/, 'insertBraceOnEnter 没落到 insertBraceOnEnter')
  // 订正（2026-10-06）：出口原来是一行 `return { line, block }`，现在多带回连接符那一格
  // （`EnterLanguage.stringConcat`，上游 `EnterInStringLiteralHandler.java:39-42` 的门槛），
  // 形状从单行变成多行 ⇒ 断言只核「块注释那一半有没有被翻成 lexicon」这条实质，不核整行字面。
  assert.match(handlers, /block: blockLexiconFor\(style \?\? undefined\)/,
    '出口没把块注释四件套翻成 lexicon')
  assert.match(handlers, /stringConcat: language === undefined \? undefined : stringConcatFor\(language\)/,
    '出口没把「这门语言能不能切字符串字面量」装配进来')
})
