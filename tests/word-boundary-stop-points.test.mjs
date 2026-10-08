// 词边界停点算法的判据 —— 期望值来自逐字转写的 Java 参照实现（`build/Ref.java`，
// 转写自 `EditorActionUtil.java:249-281, 363-406, 928-982`），并用真实 `java.lang.Character`
// 在整段 BMP（U+0000-U+FFFF）上做过差分。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CARET_STOP, CARET_STOP_POLICY, DEFAULT_WORD_BOUNDARY,
  isBetweenWhitespaces, isDigitChar, isHumpBound, isIdentifierPart, isLetterOrDigitChar,
  isLowerCaseChar, isPunctuation, isUpperCaseChar, isWhitespaceChar, isWordBoundary,
  isWordEnd, isWordStart, isWordStopOffset, nextCaretStopOffset, nextWordEnd, nextWordStart,
  prevCaretStopOffset, prevWordEnd, prevWordStart,
} from '../src/wordBoundaryStopPoints.ts'

// ─────────────── 字符分类（对 java.lang.Character）───────────────
test('identifier part follows Character.isJavaIdentifierPart (EditorActionUtil.java:951-952)', () => {
  assert.equal(isIdentifierPart('a'), true)
  assert.equal(isIdentifierPart('Z'), true)
  assert.equal(isIdentifierPart('0'), true)
  assert.equal(isIdentifierPart('_'), true, '下划线是标识符字符')
  assert.equal(isIdentifierPart('$'), true, '美元符号是标识符字符')
  assert.equal(isIdentifierPart('中'), true, 'CJK 表意文字是标识符字符')
  assert.equal(isIdentifierPart('あ'), true, '平假名是标识符字符')
  assert.equal(isIdentifierPart('\u2160'), true, '罗马数字 Nl 是标识符字符')
  assert.equal(isIdentifierPart('\u0301'), true, '组合记号 Mn 是标识符字符')
  assert.equal(isIdentifierPart('\u00A3'), true, '货币符号 Sc 是标识符字符')
  assert.equal(isIdentifierPart('\u203F'), true, '连接标点 Pc 是标识符字符')
  assert.equal(isIdentifierPart('\u0000'), true, 'NUL 是可忽略控制符 ⇒ 标识符字符（哨兵依赖此性质）')
  assert.equal(isIdentifierPart('\u0007'), true, 'U+0000-U+0008 是标识符字符')
  assert.equal(isIdentifierPart('\u000B'), false, 'U+000B 不在 U+0000-U+0008 内')
  assert.equal(isIdentifierPart('\u001C'), false, 'U+001C 不是标识符字符')
  assert.equal(isIdentifierPart('+'), false)
  assert.equal(isIdentifierPart(' '), false)
  assert.equal(isIdentifierPart('\u00A0'), false, '不断行空格不是标识符字符')
})

test('whitespace follows Character.isWhitespace (EditorActionUtil.java:930-931,981)', () => {
  for (const c of [' ', '\t', '\n', '\r', '\u000B', '\f', '\u001C', '\u001D', '\u001E', '\u001F', '\u3000']) {
    assert.equal(isWhitespaceChar(c), true, `U+${c.codePointAt(0).toString(16)} 应是空白`)
  }
  for (const c of ['\u00A0', '\u2007', '\u202F']) {
    assert.equal(isWhitespaceChar(c), false, `U+${c.codePointAt(0).toString(16)} 是不换行空格，不是空白`)
  }
  assert.equal(isWhitespaceChar('a'), false)
})

test('punctuation is the complement of identifier-part and whitespace (EditorActionUtil.java:980-982)', () => {
  assert.equal(isPunctuation(','), true)
  assert.equal(isPunctuation('.'), true)
  assert.equal(isPunctuation('-'), true)
  assert.equal(isPunctuation('\uFF0C'), true, '全角逗号是标点')
  assert.equal(isPunctuation('\u3002'), true, '句号是标点')
  assert.equal(isPunctuation('\u00B7'), true, '间隔号是标点')
  assert.equal(isPunctuation('a'), false)
  assert.equal(isPunctuation('中'), false)
  assert.equal(isPunctuation(' '), false)
  assert.equal(isPunctuation('\u0000'), false, 'NUL 是标识符字符 ⇒ 不是标点')
})

test('case / digit / letter-or-digit classes (EditorActionUtil.java:970-978)', () => {
  assert.equal(isLowerCaseChar('a'), true)
  assert.equal(isUpperCaseChar('A'), true)
  assert.equal(isDigitChar('0'), true)
  assert.equal(isDigitChar('\u0660'), true, '阿拉伯-印度数字 Nd 也算数字')
  assert.equal(isLetterOrDigitChar('a'), true)
  assert.equal(isLetterOrDigitChar('中'), true)
  assert.equal(isLetterOrDigitChar('\u2160'), false, 'Nl 不是 isLetterOrDigit')
  assert.equal(isLetterOrDigitChar('\u0660'), true)
  assert.equal(isUpperCaseChar('中'), false)
  assert.equal(isLowerCaseChar('中'), false)
})

// ─────────────── isBetweenWhitespaces / isHumpBound ───────────────
test('isBetweenWhitespaces (EditorActionUtil.java:928-932)', () => {
  assert.equal(isBetweenWhitespaces('a b', 1), false, '左是 a 不是空白')
  assert.equal(isBetweenWhitespaces('a  b', 2), true, '左右都是空白')
  assert.equal(isBetweenWhitespaces('  ', 1), true)
  assert.equal(isBetweenWhitespaces('  ', 0), false, '偏移 0 处 0 < offset 不成立')
  assert.equal(isBetweenWhitespaces('a b', 3), false, 'offset == length 不成立')
})

test('isHumpBound (EditorActionUtil.java:960-974)', () => {
  assert.equal(isHumpBound('getFoo', 3, true), true, '小写+大写 = 驼峰切口')
  assert.equal(isHumpBound('ABCd', 2, true), true, '大写+大写+小写 = 全大写词末尾切口')
  assert.equal(isHumpBound('a_b', 1, false), true, 'neighbor 是下划线，hump=a')
  assert.equal(isHumpBound('a_b', 2, true), true, 'neighbor 是下划线，hump=b')
  assert.equal(isHumpBound('a_b', 1, true), false, 'isStart 时 hump 是下划线 ⇒ 该分支不成立')
  assert.equal(isHumpBound('a$b', 1, false), true, 'neighbor 是 $ 且 hump=a 是字母数字')
  assert.equal(isHumpBound('a$b', 2, true), true, 'neighbor 是 $ 且 hump=b 是字母数字')
  assert.equal(isHumpBound('__', 1, true), false, 'hump 也是下划线 ⇒ 不算')
  assert.equal(isHumpBound('a1', 1, true), false, '数字前面是字母：无大写')
  assert.equal(isHumpBound('ab', 1, true), false, '两个小写之间不是驼峰切口')
  assert.equal(isHumpBound('ab', 0, true), false, 'offset <= 0 直接 false')
  assert.equal(isHumpBound('ab', 2, true), false, 'offset >= length 直接 false')
})

// ─────────────── isWordBoundary / isWordStart / isWordEnd ───────────────
// 期望值 = `java build/Ref.java` 的 bounds() 输出。
function boundaries(text, camel) {
  const starts = [], ends = []
  for (let i = 0; i <= text.length; i++) {
    if (isWordStart(text, i, camel)) starts.push(i)
    if (isWordEnd(text, i, camel)) ends.push(i)
  }
  return { starts, ends }
}

test('word boundaries on "foo bar" (camel off): E3 S4', () => {
  assert.deepEqual(boundaries('foo bar', false), { starts: [4], ends: [3] })
})

test('word boundaries on "getFoo" — camel off has no interior cut', () => {
  assert.deepEqual(boundaries('getFoo', false), { starts: [], ends: [] })
  assert.deepEqual(boundaries('getFoo', true), { starts: [3], ends: [3] }, '驼峰切口 S3/E3')
})

test('word boundaries on "ABCd" (camel on): S2 E2', () => {
  assert.deepEqual(boundaries('ABCd', true), { starts: [2], ends: [2] })
})

test('word boundaries on "a_b" / "a$b" (camel on): E1 S2', () => {
  assert.deepEqual(boundaries('a_b', true), { starts: [2], ends: [1] })
  assert.deepEqual(boundaries('a$b', true), { starts: [2], ends: [1] })
})

test('word boundaries on "a1b" (camel on): none — 数字不是驼峰切口', () => {
  assert.deepEqual(boundaries('a1b', true), { starts: [], ends: [] })
})

test('word boundaries on "--x": S0 E0 S2 E2', () => {
  assert.deepEqual(boundaries('--x', false), { starts: [0, 2], ends: [0, 2] })
})

test('word boundaries on "a,b": S1 E1 S2 E2', () => {
  assert.deepEqual(boundaries('a,b', false), { starts: [1, 2], ends: [1, 2] })
})

test('word boundaries on two spaces: E0 S2', () => {
  assert.deepEqual(boundaries('  ', false), { starts: [2], ends: [0] })
})

test('word boundaries on empty text: none', () => {
  assert.deepEqual(boundaries('', false), { starts: [], ends: [] })
})

test('CJK letters are identifier parts, so "中文abc" is one word', () => {
  assert.deepEqual(boundaries('中文abc', false), { starts: [], ends: [] })
  assert.deepEqual(boundaries('中文abc', true), { starts: [], ends: [] }, 'CJK 无大小写 ⇒ 无驼峰切口')
})

test('isWordBoundary rejects out-of-range offsets (EditorActionUtil.java:943)', () => {
  assert.equal(isWordBoundary('ab', -1, false, true), false)
  assert.equal(isWordBoundary('ab', 3, false, true), false)
  // 偏移 == length 合法但在范围内：右字符取哨兵 NUL，NUL 是标识符字符（:951），
  // 于是右边界不成立、左边界看 'b' 也被 NUL 挡住 ⇒ 两侧都 false（Java 参照同样 false）。
  assert.equal(isWordBoundary('ab', 2, false, true), false, '哨兵 NUL 是标识符字符 ⇒ 末尾不是词首')
  assert.equal(isWordBoundary('ab', 2, false, false), false)
})

// ─────────────── 四个停点：next/prev × start/end ───────────────
// 期望值 = `java build/Ref.java` 的 row() 输出（DEFAULT_UNIX 行档 ⇒ 整篇文本）。
test('nextWordStart / prevWordStart / nextWordEnd / prevWordEnd on "foo bar"', () => {
  assert.equal(nextWordStart('foo bar', 0), 4)
  assert.equal(prevWordStart('foo bar', 0), 0)
  assert.equal(nextWordEnd('foo bar', 0), 3)
  assert.equal(prevWordEnd('foo bar', 0), 0)

  assert.equal(nextWordStart('foo bar', 4), 7, '词中间：扫不到下一个起点 ⇒ 文本末尾')
  assert.equal(prevWordStart('foo bar', 4), 0)
  assert.equal(nextWordEnd('foo bar', 4), 7)
  assert.equal(prevWordEnd('foo bar', 4), 3)

  assert.equal(nextWordStart('foo bar', 7), 7, '文档末尾：不动')
  assert.equal(prevWordStart('foo bar', 7), 4)
  assert.equal(nextWordEnd('foo bar', 7), 7)
  assert.equal(prevWordEnd('foo bar', 7), 3)
})

test('camel mode cuts at humps (DEFAULT_UNIX boundaries)', () => {
  assert.equal(nextWordStart('getFoo', 0, true), 3)
  assert.equal(nextWordStart('getFoo', 0, false), 6, '关掉驼峰后整个标识符是一词')
  assert.equal(nextWordEnd('getFoo', 0, true), 3)
  assert.equal(nextWordEnd('getFoo', 0, false), 6)
  assert.equal(nextWordStart('getFoo', 3, true), 6)
  assert.equal(nextWordEnd('getFoo', 3, true), 6)
  assert.equal(prevWordStart('getFoo', 3, true), 0)
})

test('consecutive whitespace: stops skip the run', () => {
  assert.equal(nextWordStart('a  b', 0), 3)
  assert.equal(nextWordEnd('a  b', 0), 1)
  assert.equal(nextWordStart('a  b', 3), 4, '末尾无词 ⇒ 文本末尾')
  assert.equal(nextWordEnd('a  b', 3), 4)
  assert.equal(prevWordEnd('a  b', 3), 1)
  assert.equal(prevWordStart('a  b', 3), 0)
})

test('empty document: every stop stays at 0', () => {
  assert.equal(nextWordStart('', 0), 0)
  assert.equal(prevWordStart('', 0), 0)
  assert.equal(nextWordEnd('', 0), 0)
  assert.equal(prevWordEnd('', 0), 0)
})

test('whitespace-only document: forward to length, backward to 0', () => {
  assert.equal(nextWordStart('  ', 0), 2)
  assert.equal(nextWordEnd('  ', 0), 2)
  assert.equal(prevWordStart('  ', 2), 0)
  assert.equal(prevWordEnd('  ', 2), 0)
  assert.equal(nextWordStart('  ', 2), 2, '已在末尾不动')
})

test('pure punctuation: "a,b" and "--x"', () => {
  assert.equal(nextWordStart('a,b', 0), 1)
  assert.equal(nextWordEnd('a,b', 0), 1)
  assert.equal(prevWordStart('a,b', 2), 1)
  assert.equal(nextWordStart('a,b', 2), 3)
  assert.equal(nextWordEnd('a,b', 2), 3)

  assert.equal(nextWordStart('--x', 0), 2)
  assert.equal(nextWordEnd('--x', 0), 2)
  assert.equal(prevWordStart('--x', 2), 0)
  assert.equal(nextWordEnd('--x', 2), 3)
})

test('CJK run is a single word', () => {
  assert.equal(nextWordStart('中文abc', 0), 5)
  assert.equal(nextWordEnd('中文abc', 0), 5)
})

test('digits do not create camel cuts (a1b2, XMLHttpRequest)', () => {
  assert.equal(nextWordStart('a1b2', 0, true), 4)
  assert.equal(nextWordEnd('a1b2', 0, true), 4)
  assert.equal(nextWordStart('XMLHttpRequest', 0, true), 3, '全大写串末尾切口在 3')
  assert.equal(nextWordEnd('XMLHttpRequest', 0, true), 3)
})

test('single char and trailing whitespace boundaries', () => {
  assert.equal(nextWordStart('x', 0), 1)
  assert.equal(nextWordStart('x', 1), 1)
  assert.equal(nextWordEnd('x', 0), 1)
  assert.equal(prevWordEnd('x', 1), 0)
  assert.equal(nextWordStart('trailing ', 0), 9)
  assert.equal(nextWordEnd('trailing ', 0), 8)
  assert.equal(prevWordEnd('trailing ', 9), 8)
})

test('dot is punctuation and starts a word (a.B)', () => {
  assert.equal(nextWordStart('a.B', 0), 1)
  assert.equal(nextWordStart('a.B', 0, true), 1)
  assert.equal(nextWordEnd('a.B', 0), 1)
})

// ─────────────── isWordStopOffset 三档 ───────────────
test('isWordStopOffset: BOTH / START / END / NONE (EditorActionUtil.java:271-281)', () => {
  const t = 'getFoo'
  assert.equal(isWordStopOffset(t, CARET_STOP.BOTH, 3, true), true, '词首 或 词尾')
  assert.equal(isWordStopOffset(t, CARET_STOP.START, 3, true), true, '是词首')
  assert.equal(isWordStopOffset(t, CARET_STOP.END, 3, true), true, '是词尾')
  assert.equal(isWordStopOffset(t, CARET_STOP.BOTH, 3, false), false, '关驼峰后 3 处不是边界')
  assert.equal(isWordStopOffset(t, CARET_STOP.NONE, 3, true), false, 'NONE 永不停')
})

test('isWordStopOffset: lexeme boundary participates only when not the opposite word end (EditorActionUtil.java:278-279)', () => {
  // 'foo bar'：偏移 1/2 在标识符内部 —— 既非词首也非词尾，可单独检验 lexeme 分支。
  assert.equal(isWordStart('foo bar', 1, false), false)
  assert.equal(isWordEnd('foo bar', 1, false), false)
  // START 档：(lexeme 且 非词尾) 或 词首 ⇒ 偏移 1 靠 lexeme 停，关掉 lexeme 就不停。
  assert.equal(isWordStopOffset('foo bar', CARET_STOP.START, 1, false, true), true, 'lexeme 边界、非词尾 ⇒ 停')
  assert.equal(isWordStopOffset('foo bar', CARET_STOP.START, 1, false, false), false)
  // END 档：(lexeme 且 非词首) 或 词尾 ⇒ 偏移 2 靠 lexeme 停。
  assert.equal(isWordStopOffset('foo bar', CARET_STOP.END, 2, false, true), true, 'lexeme 边界、非词首 ⇒ 停')
  assert.equal(isWordStopOffset('foo bar', CARET_STOP.END, 2, false, false), false)
  // BOTH 档：lexeme 边界本身就够。
  assert.equal(isWordStopOffset('foo bar', CARET_STOP.BOTH, 1, false, true), true)
  assert.equal(isWordStopOffset('foo bar', CARET_STOP.BOTH, 1, false, false), false)
})

// ─────────────── 带行档的完整停点（上游真正入口）───────────────
// 期望值 = `java build/Ref.java` 的 pol() 输出。
test('nextCaretStopOffset / prevCaretStopOffset with WORD_START (CaretStopOptions.kt:25)', () => {
  const t = 'foo bar\nbaz qux'
  assert.equal(nextCaretStopOffset(t, CARET_STOP_POLICY.WORD_START, 0, false), 4)
  assert.equal(prevCaretStopOffset(t, CARET_STOP_POLICY.WORD_START, 0, false), 0)
  assert.equal(nextCaretStopOffset(t, CARET_STOP_POLICY.WORD_START, 4, false), 7)
  assert.equal(prevCaretStopOffset(t, CARET_STOP_POLICY.WORD_START, 4, false), 0)
  assert.equal(nextCaretStopOffset(t, CARET_STOP_POLICY.WORD_START, 7, false), 8, '行尾 ⇒ 下一行行首')
  assert.equal(prevCaretStopOffset(t, CARET_STOP_POLICY.WORD_START, 7, false), 4)
})

test('nextCaretStopOffset / prevCaretStopOffset with WORD_END (CaretStopOptions.kt:26)', () => {
  const t = 'foo bar\nbaz qux'
  assert.equal(nextCaretStopOffset(t, CARET_STOP_POLICY.WORD_END, 0, false), 3)
  assert.equal(prevCaretStopOffset(t, CARET_STOP_POLICY.WORD_END, 0, false), 0)
  assert.equal(nextCaretStopOffset(t, CARET_STOP_POLICY.WORD_END, 4, false), 7)
  assert.equal(prevCaretStopOffset(t, CARET_STOP_POLICY.WORD_END, 4, false), 3)
})

test('nextCaretStopOffset / prevCaretStopOffset with BOTH (CaretStopOptions.kt:27)', () => {
  const t = 'foo bar\nbaz qux'
  assert.equal(nextCaretStopOffset(t, CARET_STOP_POLICY.BOTH, 0, false), 3)
  assert.equal(prevCaretStopOffset(t, CARET_STOP_POLICY.BOTH, 4, false), 3)
  assert.equal(nextCaretStopOffset('getFoo', CARET_STOP_POLICY.BOTH, 0, true), 3)
  assert.equal(nextCaretStopOffset('getFoo', CARET_STOP_POLICY.BOTH, 0, false), 6)
  assert.equal(nextCaretStopOffset('', CARET_STOP_POLICY.BOTH, 0, false), 0)
})

test('NONE policy ignores word stops and only honours the line stop (CaretStopOptions.kt:24)', () => {
  const t = 'foo bar\nbaz qux'
  assert.equal(nextCaretStopOffset(t, CARET_STOP_POLICY.NONE, 0, false), 15, 'lineStop NONE ⇒ 文本末尾')
  assert.equal(prevCaretStopOffset(t, CARET_STOP_POLICY.NONE, 4, false), 0)
})

test('line stop BOTH: at line end the forward stop is the next line start', () => {
  const t = 'one\ntwo'
  assert.equal(nextCaretStopOffset(t, CARET_STOP_POLICY.WORD_START, 0, false), 3)
  assert.equal(nextCaretStopOffset(t, CARET_STOP_POLICY.WORD_START, 3, false), 4, '3 是行尾 ⇒ 跳到 4')
  assert.equal(nextCaretStopOffset(t, CARET_STOP_POLICY.WORD_START, 4, false), 7)
  assert.equal(prevCaretStopOffset(t, CARET_STOP_POLICY.WORD_START, 4, false), 3)
})

test('CRLF: line end excludes the \\r (Document.getLineEndOffset semantics)', () => {
  const t = 'one\r\ntwo'
  assert.equal(nextCaretStopOffset(t, CARET_STOP_POLICY.WORD_START, 3, false), 5, '行尾 3 ⇒ 下一行首 5')
})

// ─────────────── 档位常量与默认 ───────────────
test('CaretStop / CaretStopPolicy constants match CaretStopOptions.kt:13-16,24-27', () => {
  assert.deepEqual(CARET_STOP.NONE, { atStart: false, atEnd: false })
  assert.deepEqual(CARET_STOP.START, { atStart: true, atEnd: false })
  assert.deepEqual(CARET_STOP.END, { atStart: false, atEnd: true })
  assert.deepEqual(CARET_STOP.BOTH, { atStart: true, atEnd: true })
  assert.deepEqual(CARET_STOP_POLICY.WORD_START, { wordStop: CARET_STOP.START, lineStop: CARET_STOP.BOTH })
  assert.deepEqual(CARET_STOP_POLICY.WORD_END, { wordStop: CARET_STOP.END, lineStop: CARET_STOP.BOTH })
  assert.deepEqual(CARET_STOP_POLICY.BOTH, { wordStop: CARET_STOP.BOTH, lineStop: CARET_STOP.BOTH })
  assert.deepEqual(CARET_STOP_POLICY.NONE, { wordStop: CARET_STOP.NONE, lineStop: CARET_STOP.NONE })
})

test('platform defaults: UNIX/DEFAULT forward = END, WINDOWS forward = START (CaretStopOptions.kt:71-78)', () => {
  assert.deepEqual(DEFAULT_WORD_BOUNDARY.UNIX, { backward: CARET_STOP.START, forward: CARET_STOP.END })
  assert.deepEqual(DEFAULT_WORD_BOUNDARY.DEFAULT, { backward: CARET_STOP.START, forward: CARET_STOP.END })
  assert.deepEqual(DEFAULT_WORD_BOUNDARY.WINDOWS, { backward: CARET_STOP.START, forward: CARET_STOP.START })
})

// ─────────────── 与 completionCamelHump.ts 不是同一套 ───────────────
test('completionCamelHump.isWordStart is a character-property rule, not a boundary rule', async () => {
  const { isWordStart: completionWordStart } = await import('../src/completionCamelHump.ts')
  // 上游 EditorActionUtil 的 isWordStart 判「相邻两字符之间的边界」；
  // NameUtilCore.kt:95-117 的 isWordStart 判「单个字符自身是不是词首」。
  // 关键反例：'a.b' 偏移 2 —— 两者都为 true，但理由不同（前者：标点后；后者：前一字符非字母数字）。
  assert.equal(isWordStart('a.b', 2, false), true)
  assert.equal(completionWordStart('a.b', 2), true)
  // 分道反例：'-' 串内部。EditorActionUtil 在第二个 '-' 处判 false（左也是标点），
  // 补全匹配器的 isWordStart 对非字母数字一律 false —— 恰好一致，但后者根本没有「标点/非标点交界」分支。
  assert.equal(isWordStart('--x', 1, false), false)
  assert.equal(completionWordStart('--x', 1), false)
  // 真正分道：EditorActionUtil 的边界判据在「标识符/标点交界」处成立，而补全判据只在串首或前非字母数字处成立。
  // 'x-y' 偏移 1（'-'）：EditorActionUtil 看右字符 '-' 是标点、左 'x' 非标点 ⇒ true。
  assert.equal(isWordStart('x-y', 1, false), true)
  assert.equal(completionWordStart('x-y', 1), false, '补全判据对非字母数字的 \'-\' 一律 false')
})