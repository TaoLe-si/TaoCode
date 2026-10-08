// Ctrl+W「按光标取词」（上游 `EditorSelectWord` = `SelectWordAtCaretAction`）的纯逻辑判据。
//
// 期望值直接来自上游自带用例的数据文件，不是我自己编的：
//   · `platform/platform-tests/testData/codeInsight/selectWordWithoutPSIAction/test1/before` + `after1..after3`
//   · 同目录 `camelHumps/before` + `after1..after4`
// 驱动它们的测试是 `platform/platform-tests/testSrc/com/intellij/codeInsight/SelectWordWithoutPSITest.java:52-69`。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  camelSelectionRange, caretLineRange, effectiveCaret, isHumpBound, isJavaIdentifierPart,
  selectWordAtCaret, selectWordLevels, wordSelectionRange, wordSelectionRanges,
} from '../src/selectWordAtCaret.ts'

const at = (text, needle) => {
  const index = text.indexOf(needle)
  assert.notEqual(index, -1, `样本里找不到 ${needle}`)
  return index
}

// ── ① 上游 test1：纯文本（isCamelWords=false）的逐档阶梯 ──────────────────────────
// before 里光标在 "quis <caret>nostrud"，after1 选 nostrud、after2 选整行、after3 选整篇。

const TEST1 = 'Lorem ipsum dolor sit amet, consectetur adipisicing elit, sed do eiusmod\n' +
  'tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam,\n' +
  'quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.\n' +
  'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu\n' +
  'fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui\n' +
  'officia deserunt mollit anim id est laborum.\n'

test('test1：光标紧贴 nostrud 词首 → 选中 nostrud', () => {
  const caret = at(TEST1, 'nostrud')
  assert.deepEqual(selectWordAtCaret({ text: TEST1, caret }), { from: caret, to: caret + 7 })
})

test('test1：第一档 → 第二档是整行（不含行尾换行）', () => {
  const caret = at(TEST1, 'nostrud')
  const line = caretLineRange(TEST1, caret)
  assert.equal(TEST1.slice(line.from, line.to), 'quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.')
  assert.deepEqual(selectWordAtCaret({ text: TEST1, caret, current: { from: caret, to: caret + 7 } }), line)
})

test('test1：第二档 → 第三档是整篇', () => {
  const caret = at(TEST1, 'nostrud')
  const line = caretLineRange(TEST1, caret)
  assert.deepEqual(
    selectWordAtCaret({ text: TEST1, caret, current: line }),
    { from: 0, to: TEST1.length },
  )
})

test('test1：已是整篇时不再长（返回整篇自己，上游保持 minimumRange）', () => {
  const caret = at(TEST1, 'nostrud')
  assert.deepEqual(
    selectWordAtCaret({ text: TEST1, caret, current: { from: 0, to: TEST1.length } }),
    { from: 0, to: TEST1.length },
  )
})

// ── ② 上游 camelHumps：驼峰词素那一档（isCamelWords=true）──────────────────────────
// before 是 `class C {\n  String s = "CamelHu<caret>mp$word"\n}`：
// after1=Hump、after2=CamelHump$word、after3=整行、after4=整篇。

const CAMEL = 'class C {\n  String s = "CamelHump$word"\n}'
const CAMEL_WORD = at(CAMEL, 'CamelHump$word')
const CAMEL_CARET = CAMEL_WORD + 7 // 落在 "Hu|mp" 之间

test('camelHumps：光标处先给驼峰词素 Hump', () => {
  assert.deepEqual(
    selectWordAtCaret({ text: CAMEL, caret: CAMEL_CARET, camelWords: true }),
    { from: CAMEL_WORD + 5, to: CAMEL_WORD + 9 },
  )
  assert.equal(CAMEL.slice(CAMEL_WORD + 5, CAMEL_WORD + 9), 'Hump')
})

test('camelHumps：词素 → 整个词 CamelHump$word（$ 算标识符字符）', () => {
  const camel = { from: CAMEL_WORD + 5, to: CAMEL_WORD + 9 }
  assert.deepEqual(
    selectWordAtCaret({ text: CAMEL, caret: CAMEL_CARET, camelWords: true, current: camel }),
    { from: CAMEL_WORD, to: CAMEL_WORD + 14 },
  )
})

test('camelHumps：整个词 → 整行 → 整篇', () => {
  const word = { from: CAMEL_WORD, to: CAMEL_WORD + 14 }
  const line = caretLineRange(CAMEL, CAMEL_CARET)
  assert.equal(CAMEL.slice(line.from, line.to), '  String s = "CamelHump$word"')
  assert.deepEqual(selectWordAtCaret({ text: CAMEL, caret: CAMEL_CARET, camelWords: true, current: word }), line)
  assert.deepEqual(
    selectWordAtCaret({ text: CAMEL, caret: CAMEL_CARET, camelWords: true, current: line }),
    { from: 0, to: CAMEL.length },
  )
})

test('camelHumps：关掉 isCamelWords 就没有词素档，直接从整个词起', () => {
  assert.deepEqual(
    selectWordAtCaret({ text: CAMEL, caret: CAMEL_CARET }),
    { from: CAMEL_WORD, to: CAMEL_WORD + 14 },
  )
})

test('camelWords 默认 false（上游 IS_CAMEL_WORDS 默认就是 false）', () => {
  assert.deepEqual(selectWordLevels({ text: 'getUserName', caret: 4 })[0], { from: 0, to: 11 })
  assert.deepEqual(
    selectWordLevels({ text: 'getUserName', caret: 4, camelWords: true })[0],
    { from: 3, to: 7 },
  )
})

// ── ③ 取词规则逐条 ─────────────────────────────────────────────────────────────

test('标识符字符：字母/数字/_/$ 与 CJK 都算，空白与标点不算', () => {
  for (const ch of ['a', 'Z', '9', '_', '$', '中', 'é']) assert.equal(isJavaIdentifierPart(ch), true, ch)
  for (const ch of [' ', '\t', '\n', ',', '.', '(', '"', '!', '±']) {
    assert.equal(isJavaIdentifierPart(ch), false, JSON.stringify(ch))
  }
  // 与 `src/editorExtendSelection.ts` 的 `isIdentifierPart`（`[\p{L}\p{N}_$]`）的两处差：
  // ① `Sc` 里除 `$` 外的货币符号上游算标识符字符；② `No`（上标数字）上游**不**算。
  assert.equal(isJavaIdentifierPart('€'), true, '€ 是 Sc ⇒ 算（上游 isJavaIdentifierPart）')
  assert.equal(isJavaIdentifierPart('²'), false, '² 是 No ⇒ 不算')
})

test('数字是词的一部分，且不在字母↔数字处断开（与 editorExtendSelection 的驼峰切法不同）', () => {
  const text = 'foo12bar'
  assert.deepEqual(wordSelectionRange(text, 3), { from: 0, to: 8 })
  assert.deepEqual(camelSelectionRange(text, 3), { from: 0, to: 8 }, '上游 isHumpBound 没有「字母↔数字」这条')
})

test('纯标点处没有词：只给整行那一档', () => {
  const text = 'a = (b);'
  const caret = at(text, '(')
  assert.equal(wordSelectionRange(text, caret), null)
  assert.deepEqual(selectWordAtCaret({ text, caret }), { from: 0, to: text.length })
})

test('纯空白处没有词：只给整行那一档', () => {
  const text = 'aaa   bbb'
  const caret = 4
  assert.equal(wordSelectionRange(text, caret), null)
  assert.deepEqual(selectWordAtCaret({ text, caret }), { from: 0, to: text.length })
})

test('引号/注释标记不是词字符：词档在引号处停住（没有「整个字符串字面量」档）', () => {
  const text = 'x = "hello" // note'
  assert.deepEqual(wordSelectionRange(text, at(text, 'hello') + 2), { from: at(text, 'hello'), to: at(text, 'hello') + 5 })
  assert.deepEqual(wordSelectionRange(text, at(text, 'note') + 1), { from: at(text, 'note'), to: at(text, 'note') + 4 })
})

test('CJK 连成一片算一个词（Lo 属于标识符字符）', () => {
  const text = 'let 变量名 = 1'
  const start = at(text, '变量名')
  assert.deepEqual(wordSelectionRange(text, start + 1), { from: start, to: start + 3 })
})

test('词可以「右含」光标：紧贴词尾仍选中那个词', () => {
  const text = 'value = compute'
  assert.deepEqual(wordSelectionRange(text, text.length), { from: at(text, 'compute'), to: text.length })
})

// ── ④ isHumpBound 的四条判据（EditorActionUtil.java:960-974）─────────────────────

test('isHumpBound：小写/数字 → 大写处断开（断点偏移 = 大写字符自己那一位）', () => {
  assert.equal(isHumpBound('fooBar', 3, true), true, 'start 侧：curr 是大写 B')
  assert.equal(isHumpBound('fooBar', 3, false), true, 'end 侧：prev 是小写 t 之外，curr 是大写 B')
  assert.equal(isHumpBound('fooBar', 4, false), false, 'B 之后不再是断点')
})

test('isHumpBound：下划线与 $ 是断点，但连续下划线本身不算', () => {
  assert.equal(isHumpBound('a_b', 1, true), false, '`_` 自己那一位不是断点')
  assert.equal(isHumpBound('a_b', 2, true), true, '`_` 之后那一位才是断点（neighbor == `_`）')
  assert.equal(isHumpBound('a_b', 2, false), false, 'end 侧在 `b` 上不是断点')
  assert.equal(isHumpBound('a__b', 2, true), false, '`__` 不断（hump == `_`）')
  assert.equal(isHumpBound('CamelHump$word', 9, false), true, '$ 之前那一位是断点')
})

test('isHumpBound：连续大写后面跟小写处断开（HTTPServer → HTTP|Server）', () => {
  assert.equal(isHumpBound('HTTPServer', 4, true), true)
  assert.equal(isHumpBound('HTTPServer', 4, false), true)
})

test('isHumpBound：越界返回 false', () => {
  assert.equal(isHumpBound('abc', 0, true), false)
  assert.equal(isHumpBound('abc', 3, false), false)
})

// ── ⑤ 边界条件 ─────────────────────────────────────────────────────────────────

test('空文档：什么都不做（getWordOrLexemeSelectionRange 的 length==0 分支）', () => {
  assert.equal(selectWordAtCaret({ text: '', caret: 0 }), null)
  assert.deepEqual(selectWordLevels({ text: '', caret: 0 }), [])
  assert.equal(wordSelectionRange('', 0), null)
})

test('光标在文档末尾：取词先退一格（DefaultHandler:60）', () => {
  const text = 'abc'
  assert.equal(effectiveCaret(text, 3), 2)
  assert.deepEqual(selectWordAtCaret({ text, caret: 3 }), { from: 0, to: 3 })
})

test('光标在词中间：选中整个词', () => {
  const text = 'let alpha = 1'
  const start = at(text, 'alpha')
  assert.deepEqual(selectWordAtCaret({ text, caret: start + 2 }), { from: start, to: start + 5 })
})

test('光标在词尾（右邻是空白）：左移一格后选中那个词', () => {
  const text = 'let alpha = 1'
  const start = at(text, 'alpha')
  const end = start + 5
  assert.deepEqual(selectWordAtCaret({ text, caret: end }), { from: start, to: end })
})

test('词素档：光标在文档末尾时直接 null（上游 :75-77 的 cursorOffset >= length）', () => {
  assert.deepEqual(camelSelectionRange('getUserName', 0), { from: 0, to: 3 }, '词头那一段是 get')
  assert.equal(camelSelectionRange('getUserName', 11), null, '光标在文档末尾时词素档直接 null')
})

test('整行档不含行分隔符：\\n 与 \\r\\n 都不含', () => {
  assert.deepEqual(caretLineRange('a\nb', 0), { from: 0, to: 1 })
  assert.deepEqual(caretLineRange('a\r\nb', 0), { from: 0, to: 1 })
  assert.deepEqual(caretLineRange('a\r\nb', 3), { from: 3, to: 4 })
})

test('空行的整行档是零长区间，与空选区相等 ⇒ 那一档被跳过（上游 range.equals(selectionRange)）', () => {
  const text = 'a\n\nb'
  const caret = 2
  assert.deepEqual(caretLineRange(text, caret), { from: 2, to: 2 })
  assert.deepEqual(selectWordAtCaret({ text, caret }), { from: 0, to: text.length })
})

test('password 档：全选（SelectWordAtCaretAction.java:45-48）', () => {
  const text = 'secret text'
  assert.deepEqual(selectWordAtCaret({ text, caret: 3, password: true }), { from: 0, to: text.length })
  assert.deepEqual(selectWordLevels({ text, caret: 3, password: true }), [{ from: 0, to: text.length }])
})

test('caret 越界（负 / 超出）不抛异常', () => {
  assert.deepEqual(selectWordLevels({ text: 'abc', caret: 99 }), [])
  assert.deepEqual(selectWordLevels({ text: 'abc', caret: -1 }), [])
  assert.equal(selectWordAtCaret({ text: 'abc', caret: 99 }), null)
})

// ── ⑥ lexemeBoundary 钩子：上游 isLexemeBoundary(editor, offset) 的承接点 ─────────

test('lexemeBoundary 为真处，词档就停在那里（等价上游 editor != null 那一支）', () => {
  const text = 'foo.bar'
  // 让 `.` 两侧的偏移算词素边界：上游 isLexemeBoundary 靠高亮器 token，本仓由宿主喂。
  const boundary = offset => offset === 3 || offset === 4
  assert.deepEqual(wordSelectionRange(text, 5, boundary), { from: 4, to: 7 }, '只选中 bar')
  assert.deepEqual(wordSelectionRange(text, 1), { from: 0, to: 3 }, '不给钩子时 `.` 本身就不是词字符，foo 到此为止')
})

test('wordSelectionRanges 的顺序即优先级：词素 → 词 → 整行', () => {
  const text = 'getUserName'
  assert.deepEqual(
    wordSelectionRanges({ text, caret: 4, camelWords: true }),
    [{ from: 3, to: 7 }, { from: 0, to: 11 }, { from: 0, to: 11 }],
  )
  assert.deepEqual(wordSelectionRanges({ text, caret: 4 }), [{ from: 0, to: 11 }, { from: 0, to: 11 }])
})

test('selectWordLevels 的阶梯含兜底的整篇，相邻重复项去掉，按一次长一级', () => {
  const text = 'getUserName'
  const levels = selectWordLevels({ text, caret: 4, camelWords: true })
  assert.deepEqual(levels, [{ from: 3, to: 7 }, { from: 0, to: 11 }], '词素 → 整个词（单行时整行就是整篇）')
  for (let i = 1; i < levels.length; ++i) {
    assert.ok(levels[i].from <= levels[i - 1].from && levels[i].to >= levels[i - 1].to, '每一档都包含上一档')
    assert.ok(levels[i].to - levels[i].from > levels[i - 1].to - levels[i - 1].from, '每一档都严格更大')
  }
})