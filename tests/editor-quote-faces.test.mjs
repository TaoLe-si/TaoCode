// 多字符引号（Java 文本块 `"""`）三个动作的判据 —— 上游 `MultiCharQuoteHandler` 那一档。
// 实现 `src/editorQuoteFaces.ts`；逐条行号在那个文件的头注释里（2026-10-06 与上游逐行核对）。
//
// 三条行为各自钉住的上游：
//   · `java/java-frontback-impl/src/com/intellij/codeInsight/editorActions/JavaQuoteHandler.java:58-63`
//     —— 光标落在收尾那三个引号里（`offset >= end - 3`）⇒ 敲引号只挪光标（`skip`）；
//   · 同文件 `:104-108` + `:111-128` —— 刚敲完**开** face 且后面没有别的 `"""` ⇒ 要补配对（`open`）；
//   · 同文件 `:134-149` —— 补的是 `"\n\"\"\""`（`:136`），光标停在新起那一行的开头（`:148`）。
// 接口侧：`platform/lang-impl/src/com/intellij/codeInsight/editorActions/QuoteHandler.java:28`（接口）、
// `:40` `isClosingQuote`、`:49` `isOpeningQuote`、`:64` `hasNonClosedLiteral`、`:66` `isInsideLiteral`；
// EP 注册面 `QuoteHandlerEP.java:16-27`（按 fileType），XML 声明
// `platform/lang-impl/resources/intellij.platform.lang.impl.xml:405`/`:408`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FACE_CARET_ADVANCE, faceAction, faceInsertion, faceOffsets, facesBefore, insideClosingFace, opensFaceHere,
} from '../src/editorQuoteFaces.ts'
import {
  LANGUAGE_QUOTES, quoteAction, quoteActionWithSwitch, quotedChars, quotesFor, stringConcatFor,
} from '../src/editorTyping.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const FACE = '"""'
const read = (relative) => readFileSync(join(root, relative), 'utf8')

test('faceOffsets：只数非转义的 face 起始位（转义那条是词法近似，见模块头「已知差别」）', () => {
  assert.deepEqual(faceOffsets('"""abc"""', FACE), [0, 6])
  assert.deepEqual(faceOffsets('\\"""', FACE), [], '前面一个反斜杠 ⇒ 这个 face 不算')
  assert.deepEqual(faceOffsets('a"b"c"d', FACE), [], '凑不成三个引号就不算')
})

test('facesBefore：奇偶 = 开/收（JavaQuoteHandler.java:120-124 的奇偶判法）', () => {
  const text = '"""\nabc"""'
  assert.equal(facesBefore(text, 3, FACE), 1, '开 face 已经算进去了')
  assert.equal(facesBefore(text, 10, FACE), 2, '收尾 face 也算完 ⇒ 下一段是新的一段')
})

test('opensFaceHere：刚敲完开 face 且后面没有配对的才接管（:104-108 + :111-128）', () => {
  // 敲完第三个引号之前：文档里只有 ""，光标在它后面
  assert.equal(opensFaceHere('String s = ""', 13, FACE), true)
  assert.equal(opensFaceHere('String s = ""\nabc"""', 13, FACE), false, '后面已经有收尾 ⇒ 不补')
  assert.equal(opensFaceHere('"""\nabc""', 9, FACE), false, '这一段是**收尾** face，不是新的开 face')
  assert.equal(opensFaceHere('String s = "', 12, FACE), false, '只敲到第二个引号还不算一个 face')
  assert.equal(opensFaceHere('String s = x', 13, FACE), false, '前面不是两个连续引号')
})

test('insideClosingFace：光标在收尾 face 的那三个字符里（:58-63 的 offset >= end - 3）', () => {
  const text = '"""\nabc"""'                       // 收尾 face 在 7..9
  assert.equal(insideClosingFace(text, 7, FACE), true)
  assert.equal(insideClosingFace(text, 9, FACE), true)
  assert.equal(insideClosingFace(text, 6, FACE), false, '还在文本正文里 ⇒ 不算收尾')
  assert.equal(insideClosingFace('"""\nabc', 7, FACE), false, '没有收尾 face 时不接管')
  assert.equal(insideClosingFace('"""abc', 3, FACE), false, '偶数那一段是开 face，不算收尾')
})

test('faceAction：开/收/不接管三种答复都对得上上游那两条问法', () => {
  assert.equal(faceAction('String s = ""', 13, FACE, '"'), 'open')
  assert.equal(faceAction('"""\nabc"""', 9, FACE, '"'), 'skip')
  assert.equal(faceAction('String s = ', 11, FACE, '"'), null, '既不是收尾也不是刚敲完 face ⇒ 交给单引号规则')
  assert.equal(faceAction('String s = ""', 13, FACE, "'"), null, '敲的不是 face 的那个字符')
})

test('faceInsertion / FACE_CARET_ADVANCE：插的是 \\n"""，光标停在新行开头（:136 + :148）', () => {
  assert.equal(faceInsertion(FACE), '\n"""')
  assert.equal(FACE_CARET_ADVANCE, 1)
})

// ── 注册表与接线 ────────────────────────────────────────────────────────────────────
test('按语言的注册表只有能核到的那一条（C/C++ 与 TS 的 handler 不在社区树 ⇒ 不编）', () => {
  assert.deepEqual(Object.keys(LANGUAGE_QUOTES), ['java'], 'intellij.java.frontback.impl.xml:74 是唯一能核到的 JavaLike 注册')
  // concat 这一格是 2026-10-06 加的：回车切分字面量那一条要问「这门语言有没有 JavaLikeQuoteHandler」
  // （enter/EnterInStringLiteralHandler.java:39-42 + :109-114、JavaLikeQuoteHandler.java:15-17），
  // Java 的连接符是 `+`（JavaQuoteHandler.java:83-86）。形状从两格变三格 ⇒ 这条断言同步收紧，没放松。
  assert.deepEqual(LANGUAGE_QUOTES.java, { single: ['"'], multi: [FACE], concat: '+' })
  assert.equal(quotesFor('cpp'), null, 'CLion 那一侧读不到源码 ⇒ 无法核实，不接管')
  assert.deepEqual(quotedChars(), ['"'])
  // 语言 id 拿不到 / 表里没有 ⇒ null（调用方按「整条不接管」处理）。
  assert.equal(stringConcatFor('java'), '+')
  assert.equal(stringConcatFor('python'), null, 'Python 的引号 handler 不在社区树里能核到的那张表 ⇒ 不编')
  assert.equal(stringConcatFor(undefined), null)
})

test('smartQuotes 先问 face 那一档，再问单引号规则（引号链路的次序）', () => {
  const typing = read('src/editorTyping.ts')
  assert.match(typing, /from '\.\/editorQuoteFaces\.ts'/, '没接上 face 模块')
  const faceStep = typing.indexOf('faceAction(view.state.doc.toString()')
  const singleStep = typing.indexOf('const action = quoteActionWithSwitch(')
  assert.ok(faceStep >= 0, 'smartQuotes 里没真的问 faceAction')
  assert.ok(faceStep < singleStep, 'face 那一档要排在单引号规则之前，否则 `"""` 会被当成三个独立引号')
  assert.match(typing, /insert: ch \+ faceInsertion\(face\)/, '开 face 补配对时要把敲的那个字符一起落下去')
})

test('单引号规则本身没被改动：文本块边界仍回 plain（那一档现在由 face 模块接管）', () => {
  assert.equal(quoteAction('String s = """', 13, '"', LANGUAGE_QUOTES.java, false), 'plain')
  assert.equal(quoteAction('String s = ', 11, '"', LANGUAGE_QUOTES.java, false), 'pair')
  assert.equal(quoteAction('String s = "abc"', 15, '"', LANGUAGE_QUOTES.java, false), 'skip')
})

// ── AUTOINSERT_PAIR_QUOTE（CodeInsightSettings.java:140）：关掉就整条不接管 ──────────────
test('引号开关关掉：跳过收尾引号与补一对都不接管，包住选区仍接管（那是另一条开关）', () => {
  const rules = LANGUAGE_QUOTES.java
  assert.equal(quoteActionWithSwitch('String s = ', 11, '"', rules, false, true), 'pair', '开着 ⇒ 补一对')
  assert.equal(quoteActionWithSwitch('String s = ', 11, '"', rules, false, false), 'plain',
    'TypedQuoteImpl.java:66-68：开关关掉 ⇒ handleQuote 直接返回 false，插的就是一个普通字符')
  assert.equal(quoteActionWithSwitch('String s = "abcd"', 16, '"', rules, false, true), 'skip', '开着 ⇒ 只挪光标')
  assert.equal(quoteActionWithSwitch('String s = "abcd"', 16, '"', rules, false, false), 'plain',
    '关掉 ⇒ 收尾引号也不跳过')
  assert.equal(quoteActionWithSwitch('String s = ', 11, '"', rules, true, false), 'wrap',
    'SelectionQuotingTypedHandler.java:47 的包住选区问的是 SURROUND_SELECTION_ON_QUOTE_TYPED（本仓没这一格设置）')
  // smartQuotes 里那条问法必须真的排在 face 那一档之前：否则关掉开关时文本块还在补配对。
  const typing = read('src/editorTyping.ts')
  assert.match(typing, /const pairQuote = autoInsertPairQuote\(\)/, 'smartQuotes 没问开关')
  assert.match(typing, /if \(selection\.empty && pairQuote\) \{/, 'face 那一档没被开关挡住')
  assert.ok(typing.indexOf('const pairQuote = autoInsertPairQuote()') < typing.indexOf('faceAction(view.state.doc.toString()'),
    '开关要在读 face 之前问')
})

// ── 接线：两个导出必须真的挂进编辑器，否则「文本块补 `"""`」「泛型 `<>` 两侧一起亮」用户点不到 ──
// （上游 handler 是按 fileType 取的：`QuoteHandlerEP.java:16-27` +
//  `platform/lang-impl/resources/intellij.platform.lang.impl.xml:405`/`:408` ⇒ 本仓对应 `() => props.language`）
test('smartQuotes 与 angleBraceHighlight 都进了编辑器的扩展面（不是只过自己测试的死模块）', () => {
  const view = readFileSync(new URL('../src/components/CodeEditor.vue', import.meta.url), 'utf8')
  assert.match(view, /import \{ insertedText, smartQuotes \} from '\.\.\/editorTyping'/)
  assert.match(view, /import \{ angleBraceHighlight, rainbowBrackets \} from '\.\.\/editorBrackets'/)
  assert.match(view, /smartQuotes\(\(\) => props\.language\), angleBraceHighlight\(\(\) => props\.language\)/,
    '两个扩展没挂进 extensions ⇒ 引号链路与尖括号配对在真实编辑器里没有入口')
})
