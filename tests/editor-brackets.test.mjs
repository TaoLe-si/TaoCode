// 彩虹括号（上游 `RainbowHighlighter.java`）的判据。
//
// 纯词法 `scanBrackets`（层级计算、坏代码不抛）+ 视图层 `rainbowBrackets()` 的接线：
// 设置用 `bracketMatching`（与 CodeMirror 的配对高亮同一个门），挂在 brackets compartment 上，
// 大文件模式不挂。字符串/注释里的括号由 lezer 语法树排除（源码级断言钉住这条规则）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hasAngleBraces, isAngleTypeArgumentList, LANGUAGE_ANGLE_BRACES, matchingAnglePair, rainbowSlot, scanBrackets, RAINBOW_COLORS } from '../src/editorBrackets.ts'
import { LANGUAGE_QUOTES, quotedChars, quoteAction, quotesFor } from '../src/editorTyping.ts'

test('层级：开括号用它进入前算的层，闭括号与配对的另一侧同档', () => {
  const { tokens, depth } = scanBrackets('(a[b])')
  assert.equal(depth, 0)
  assert.deepEqual(tokens.map(token => [token.pos, token.ch, token.depth]), [
    [0, '(', 0], [2, '[', 1], [4, ']', 1], [5, ')', 0],
  ])
})

test('跨行续算：startDepth 接上一行的未闭合层级', () => {
  const first = scanBrackets('function f() {')
  assert.equal(first.depth, 1, '函数体打开了一层')
  const second = scanBrackets('  if (x) {', first.depth)
  assert.deepEqual(second.tokens.map(token => token.depth), [1, 1, 1], '(x) 与函数体同层（括号先进后退）')
  assert.equal(second.depth, 2, 'if 的花括号又进一层')
})

test('坏代码不抛：多出来的闭括号按空栈算 0，层级不变成负数', () => {
  const { tokens, depth } = scanBrackets(')]}')
  assert.deepEqual(tokens.map(token => token.depth), [0, 0, 0])
  assert.equal(depth, 0)
  assert.equal(scanBrackets('((', -3).depth, 2, '负 startDepth 夹到 0 后从 0 起算')
  assert.equal(scanBrackets('((', -3).tokens[0].depth, 0)
})

test('档位 = 层级对上游五档取模', () => {
  assert.equal(RAINBOW_COLORS, 5)
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(rainbowSlot), [0, 1, 2, 3, 4, 0, 1])
})

test('接线：CodeEditor 挂 brackets compartment（bracketMatching 门 + 非大文件），字符串/注释按语法树排除', () => {
  const editor = readFileSync(new URL('../src/components/CodeEditor.vue', import.meta.url), 'utf8')
  assert.match(editor, /import \{ angleBraceHighlight, rainbowBrackets \} from '\.\.\/editorBrackets'/)
  assert.match(editor, /brackets\.of\(props\.settings\.bracketMatching && !heavy \? rainbowBrackets\(\) : \[\]\)/, '初始挂载：设置门 + 大文件门')
  assert.match(editor, /brackets\.reconfigure\(props\.settings\.bracketMatching && !heavy \? rainbowBrackets\(\) : \[\]\)/, '设置一改立刻重配')
  const module = readFileSync(new URL('../src/editorBrackets.ts', import.meta.url), 'utf8')
  assert.match(module, /resolveInner\(pos, 1\)/, '用 lezer 语法树判断字面量/注释')
  assert.match(module, /string\|comment\|regexp\|regex/i, '排除节点名覆盖字符串/注释/正则')
  assert.match(module, /visibleRanges/, '只扫可见区域')
})

// ── 逐语言的尖括号配对（`lp/editor-actions` 缺项 ① 的括号那一半） ──────────────────────
// 上游 `JavaPairedBraceMatcher.java:11/31-38`（`lt()`/`gt()` = `JavaTokenType.LT`/`GT`）把泛型的
// `<` `>` 也算一对括号；CodeMirror 的 `bracketMatching` 只认 `()[]{}`。
// 「哪些语言认 `<>`」= 那张按语言的注册表：社区树里只有 Java 能核到（C++ 在 CLion、TS/JS 在商业插件
// ⇒ 无法核实，表里不给）。中间是不是类型用 `JavaPairedBraceMatcher.java:16-21` 的 TYPE_TOKENS
// 做词法近似，近似不出来就不高亮。
test('尖括号配对：只有核得到 provider 的语言进表', () => {
  assert.deepEqual(LANGUAGE_ANGLE_BRACES, { java: true }, 'C++/TS 无上游依据 ⇒ 不进表，不编')
  assert.equal(hasAngleBraces('java'), true)
  assert.equal(hasAngleBraces('cpp'), false)
  assert.equal(hasAngleBraces('typescript'), false)
  assert.equal(hasAngleBraces(undefined), false)
})

test('配对扫描：两侧都算，嵌套能穿过去，比较表达式不算', () => {
  const text = 'Map<String, List<Integer>> m = new HashMap<>();'
  // 光标在 `List<` 的 `<` 之后 → 配到它自己的 `>`。
  const inner = text.indexOf('List<') + 5
  assert.deepEqual(matchingAnglePair(text, inner), { open: inner - 1, close: text.indexOf('>>') })
  // 光标贴在 `>>` 之后 → 往左配到 `Map<` 的开括号。
  const outerClose = text.indexOf('>>') + 2
  assert.deepEqual(matchingAnglePair(text, outerClose), { open: text.indexOf('<'), close: outerClose - 1 })
  // 空的一对 `<>`（`new HashMap<>()`）也配得上。
  const empty = text.indexOf('<>')
  assert.deepEqual(matchingAnglePair(text, empty + 1), { open: empty, close: empty + 1 })
  // 比较表达式：`<` 后面是空格 ⇒ 不当它是类型表。
  assert.equal(matchingAnglePair('int c = a < b > c;', 12), null)
  // 没有配对（`a < b`）。
  assert.equal(matchingAnglePair('if (a < b) {}', 7), null)
})

test('中间是不是类型（TYPE_TOKENS 的词法近似）', () => {
  const ok = (text) => { const pair = { open: text.indexOf('<'), close: text.indexOf('>') }; return isAngleTypeArgumentList(text, pair) }
  assert.equal(ok('List<String>'), true)
  assert.equal(ok('Map<String, List<Integer>>'), true, '逗号与嵌套的 <> 都在类型那一族里')
  assert.equal(ok('Foo<? extends Bar>'), true)
  assert.equal(ok('Foo<Bar[]>'), true, '数组根号的 [ ] 也是类型 token')
  assert.equal(ok('Foo<@NonNull String>'), true, '`@` 注解是 TYPE_TOKENS 里的（JavaPairedBraceMatcher:19）')
  assert.equal(ok('a + b >'), false, '算式里的 `>` 不算')
  assert.equal(ok('<>'), false, '空的没有内容')
})

test('高亮扩展：非 Java 语言一律不画，画出来用的是 CodeMirror 那个既有类名', () => {
  const module = readFileSync(new URL('../src/editorBrackets.ts', import.meta.url), 'utf8')
  assert.match(module, /if \(!hasAngleBraces\(getLanguage\(\)\)\) return Decoration\.none/, '语言不在表里 ⇒ 一条装饰都不建')
  assert.match(module, /class: 'cm-matchingBracket'/, '复用既有类名 ⇒ 颜色与 data-bracket-matching 开关都自动跟上')
  assert.ok(!/\.cm-matching[A-Za-z]*\s*\{/.test(module), '本模块不新增样式规则')
})

// ── 逐语言的引号规则（缺项 ① 的引号那一半，上游 `QuoteHandler` 的四个问法） ─────────────
test('引号表：只有 Java 那条注册能核到', () => {
  assert.deepEqual(Object.keys(LANGUAGE_QUOTES), ['java'])
  assert.deepEqual(LANGUAGE_QUOTES.java.single, ['"'])
  assert.deepEqual(LANGUAGE_QUOTES.java.multi, ['"""'], 'JavaQuoteHandler.java:31 的 MultiCharQuoteHandler')
  assert.equal(quotesFor('cpp'), null, 'C++/TS 的 handler 不在社区树 ⇒ 不抢 CodeMirror 的默认行为')
  assert.deepEqual(quotedChars(), ['"'], '键只注册表里出现过的字符')
})

test('quoteAction：跳过收尾 / 补一对 / 包住选区 / 普通插，四条各自对上 QuoteHandler 的问法', () => {
  const java = LANGUAGE_QUOTES.java
  // `isClosingQuote`（QuoteHandler.java:40）：光标正对着收尾引号 ⇒ 只挪光标。
  assert.equal(quoteAction('String s = "abc"', 15, '"', java, false), 'skip')
  // `isOpeningQuote` + `hasNonClosedLiteral`（:37-56）：行内前面没有落单的引号 ⇒ 补一对。
  assert.equal(quoteAction('String s = ', 11, '"', java, false), 'pair')
  // `isInsideLiteral`（:58）：行内已经有一个没配对的引号 ⇒ 就按普通字符插。
  assert.equal(quoteAction('String s = "abc', 15, '"', java, false), 'plain')
  // 转义里的那个不算（JavaQuoteHandler.java:42-56 挡 STRING_LITERAL_ESCAPES 的同一支）。
  assert.equal(quoteAction('String s = "a\\"', 16, '"', java, false), 'plain', '最后一个引号是 \\" 转义里的')
  // 有选区 ⇒ 包住（surroundWithQuotes）。
  assert.equal(quoteAction('x = ab', 4, '"', java, true), 'wrap')
  // 文本块边界：`"""` 旁边不按单引号规则配对（face 那一档在 src/editorQuoteFaces.ts 里判）。
  assert.equal(quoteAction('String s = """', 13, '"', java, false), 'plain')
  assert.equal(quoteAction('"""', 0, '"', java, false), 'plain')
  // 这门语言不认的字符 ⇒ 一律普通插（不进本模块的配对逻辑）。
  assert.equal(quoteAction("char c = '", 9, "'", java, false), 'plain')
})
