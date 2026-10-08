// `src/selectAllOccurrences.ts` 的门禁 —— 上游三档语义逐条对着 `文件:行号` 验。
//
// 上游基准：`SelectAllOccurrencesAction.java:40-84`（驱动）、
// `SelectOccurrencesActionHandler.java:64-68,79-85`（取词 / getFindModel）、
// `SelectWordUtil.java:109-142`（取词规则）、`FindManagerBase.java:247-276`（整词）、
// `FindUtil.java:1051-1053` + `registry.properties:484`（1000 上限，整条不做）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MAX_CARET_COUNT,
  literalOccurrences,
  occurrenceWordAt,
  selectAllOccurrences,
} from '../src/selectAllOccurrences.ts'
import { wordRange } from '../src/editorExtendSelection.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// ── 档 1：大小写敏感恒真（SelectOccurrencesActionHandler.java:79-85）────────────
// `getFindModel` 里 `model.setCaseSensitive(true)` 是硬编码，没有任何配置入口。

test('大小写敏感：选中的 foo 只命中全小写的 foo，不吃 Foo/FOO', () => {
  const text = 'const foo = 1;\nconst Foo = 2;\nconst FOO = 3;'
  const result = selectAllOccurrences({ text, selectionFrom: 6, selectionTo: 9, cursor: 9 })
  assert.equal(result.kind, 'selected')
  assert.equal(result.query, 'foo')
  assert.equal(result.wholeWords, false)
  assert.deepEqual(result.ranges, [{ from: 6, to: 9 }])
})

test('大小写敏感：选中的 Foo 同样只命中自己', () => {
  const text = 'foo Foo FOO'
  const result = selectAllOccurrences({ text, selectionFrom: 4, selectionTo: 7, cursor: 7 })
  assert.equal(result.kind, 'selected')
  assert.deepEqual(result.ranges, [{ from: 4, to: 7 }])
})

test('literalOccurrences 的查找是大小写敏感的（StringSearcher.java:46）', () => {
  assert.deepEqual(literalOccurrences('aAaA', 'aA', false), [{ from: 0, to: 2 }, { from: 2, to: 4 }])
  assert.deepEqual(literalOccurrences('aAaA', 'aa', false), [])
})

// ── 档 2：无选区先取词 + wholeWords（SelectAllOccurrencesAction.java:43-50）────

test('无选区：先取光标下的词，并打开 wholeWords', () => {
  const text = 'foo foobar foo'
  const result = selectAllOccurrences({ text, selectionFrom: 1, selectionTo: 1, cursor: 1 })
  assert.equal(result.kind, 'selected')
  assert.equal(result.query, 'foo')
  assert.equal(result.wholeWords, true)
  // foobar 里的那个 foo 不算（整词档）。
  assert.deepEqual(result.ranges, [{ from: 0, to: 3 }, { from: 11, to: 14 }])
})

test('有选区：不取词，wholeWords 保持关 —— 同一段文本这时会吃掉 foobar 里的 foo', () => {
  const text = 'foo foobar foo'
  const result = selectAllOccurrences({ text, selectionFrom: 0, selectionTo: 3, cursor: 3 })
  assert.equal(result.kind, 'selected')
  assert.equal(result.wholeWords, false)
  assert.deepEqual(result.ranges, [{ from: 0, to: 3 }, { from: 4, to: 7 }, { from: 11, to: 14 }])
})

test('无选区：光标在 foobar 中间时取整词 foobar，只命中它自己', () => {
  const text = 'foo foobar foo'
  const result = selectAllOccurrences({ text, selectionFrom: 5, selectionTo: 5, cursor: 5 })
  assert.equal(result.kind, 'selected')
  assert.equal(result.query, 'foobar')
  assert.deepEqual(result.ranges, [{ from: 4, to: 10 }])
})

test('无选区且光标不在词上：整条不做事（上游 getSelectedText() 为 null ⇒ return）', () => {
  const text = 'a + b'
  const result = selectAllOccurrences({ text, selectionFrom: 2, selectionTo: 2, cursor: 2 })
  assert.deepEqual(result, { kind: 'noop', reason: 'no-query', matchCount: 0 })
})

test('空文档：不做事', () => {
  assert.deepEqual(selectAllOccurrences({ text: '', selectionFrom: 0, selectionTo: 0, cursor: 0 }),
    { kind: 'noop', reason: 'no-query', matchCount: 0 })
})

test('有选区但选区为空（from == to）等同无选区', () => {
  const text = 'foo foo'
  const result = selectAllOccurrences({ text, selectionFrom: 0, selectionTo: 0, cursor: 0 })
  assert.equal(result.kind, 'selected')
  assert.equal(result.wholeWords, true)
  assert.deepEqual(result.ranges, [{ from: 0, to: 3 }, { from: 4, to: 7 }])
})

// ── 档 3：1000 上限是「整条不做」，不是截断（FindUtil.java:1051-1053）──────────

test('MAX_CARET_COUNT 取上游 registry 的 1000', () => {
  assert.equal(MAX_CARET_COUNT, 1000)
})

test('恰好 1000 条：选（判据是严格大于）', () => {
  const text = 'ab '.repeat(1000)
  const result = selectAllOccurrences({ text, selectionFrom: 0, selectionTo: 2, cursor: 2 })
  assert.equal(result.kind, 'selected')
  assert.equal(result.ranges.length, 1000)
})

test('1001 条：整条不做，且报出真实命中数（不截断到 1000）', () => {
  const text = 'ab '.repeat(1001)
  const result = selectAllOccurrences({ text, selectionFrom: 0, selectionTo: 2, cursor: 2 })
  assert.deepEqual(result, { kind: 'noop', reason: 'too-many-matches', matchCount: 1001 })
})

test('注入 maxCarets 验边界：等于上限要选、超过上限不做', () => {
  const text = 'ab '.repeat(3)
  assert.equal(selectAllOccurrences({ text, selectionFrom: 0, selectionTo: 2, cursor: 2, maxCarets: 3 }).kind, 'selected')
  assert.deepEqual(
    selectAllOccurrences({ text, selectionFrom: 0, selectionTo: 2, cursor: 2, maxCarets: 2 }),
    { kind: 'noop', reason: 'too-many-matches', matchCount: 3 },
  )
})

test('maxCarets 走 Math.max(1, …)（CaretModelImpl.java:120-121）', () => {
  const text = 'ab ab'
  const result = selectAllOccurrences({ text, selectionFrom: 0, selectionTo: 2, cursor: 2, maxCarets: 0 })
  assert.deepEqual(result, { kind: 'noop', reason: 'too-many-matches', matchCount: 2 })
})

// ── 光标位置：FindUtil.java:1040 + :1100-1103 ──────────────────────────────────

test('光标落在选区内：每条 caret = min(命中起点 + shift, 命中终点)', () => {
  const text = 'foo foo'
  const result = selectAllOccurrences({ text, selectionFrom: 0, selectionTo: 3, cursor: 2 })
  assert.equal(result.kind, 'selected')
  assert.deepEqual(result.carets, [2, 6])
})

test('光标在选区终点：shift 等于选区长度 ⇒ caret 落在命中终点', () => {
  const text = 'foo foo'
  const result = selectAllOccurrences({ text, selectionFrom: 0, selectionTo: 3, cursor: 3 })
  assert.deepEqual(result.carets, [3, 7])
})

test('shift < 0 分支：防御性覆盖 FindUtil.getCaretPosition(:1100-1103) 的负分支', () => {
  // 真实动作里 shift 不可能为负：上游 caret.getOffset() 恒在 [selectionStart, selectionEnd]
  // （CaretImpl.getSelectionOffset:1383-1391 无选区时回退到 getOffset）。这里直接喂
  // cursor < selectionFrom，只为把那个分支的语义钉住。
  const text = 'foo foo'
  const result = selectAllOccurrences({ text, selectionFrom: 4, selectionTo: 7, cursor: 3 })
  assert.equal(result.kind, 'selected')
  assert.deepEqual(result.ranges, [{ from: 0, to: 3 }, { from: 4, to: 7 }])
  assert.deepEqual(result.carets, [3, 7])
})

test('反向选区（CodeMirror head == from）：shift 为 0，caret 落在命中起点', () => {
  // 上游同形：Shift+Left 反向选 4..7 时 caret/lead 在 4，shift = 4 - 4 = 0。
  const text = 'foo foo'
  const result = selectAllOccurrences({ text, selectionFrom: 4, selectionTo: 7, cursor: 4 })
  assert.equal(result.kind, 'selected')
  assert.deepEqual(result.carets, [0, 4])
})

// ── 取词规则：SelectWordUtil.java:109-142（editor == null 分支）───────────────

test('occurrenceWordAt 就是 editorExtendSelection 的 wordRange（同一套规则，复用而非重写）', () => {
  const text = 'alpha beta_1 $x 你好 42'
  for (let at = 0; at <= text.length; ++at) {
    assert.deepEqual(occurrenceWordAt(text, at), wordRange(text, at))
  }
})

test('取词：光标在词中间 → 整个词', () => {
  assert.deepEqual(occurrenceWordAt('hello world', 2), { from: 0, to: 5 })
})

test('取词：光标紧贴词尾右侧 → 仍然取那个词（上游 :118-122 的 cursorOffset-- 等价）', () => {
  assert.deepEqual(occurrenceWordAt('a + b', 1), { from: 0, to: 1 })
})

test('取词：光标在文档末尾 → 取最后一个词（上游 cursorOffset == length 分支）', () => {
  assert.deepEqual(occurrenceWordAt('abc', 3), { from: 0, to: 3 })
})

test('取词：光标在空白/标点上 → null', () => {
  assert.equal(occurrenceWordAt('a + b', 2), null)
  assert.equal(occurrenceWordAt('   ', 1), null)
})

test('取词：下划线 / $ / 数字都算词字符（isJavaIdentifierPart）', () => {
  assert.deepEqual(occurrenceWordAt('a_b', 1), { from: 0, to: 3 })
  assert.deepEqual(occurrenceWordAt('$x', 1), { from: 0, to: 2 })
  assert.deepEqual(occurrenceWordAt('x12', 2), { from: 0, to: 3 })
})

test('取词：CJK 连成一词（Character.isJavaIdentifierPart 认 Unicode 字母）', () => {
  assert.deepEqual(occurrenceWordAt('你好 世界', 1), { from: 0, to: 2 })
  assert.equal(selectAllOccurrences({ text: '你好 世界', selectionFrom: 0, selectionTo: 0, cursor: 1 }).ranges.length, 1)
})

test('取词：下划线把标识符连成一词（不做词素/驼峰切分，editor == null 那条路）', () => {
  assert.deepEqual(occurrenceWordAt('foo_bar', 4), { from: 0, to: 7 })
})

// ── literalOccurrences：字面量、不重叠、整词过滤 ────────────────────────────────

test('literalOccurrences：空查询返回空（上游 toFind.isEmpty() ⇒ NOT_FOUND）', () => {
  assert.deepEqual(literalOccurrences('abc', '', false), [])
})

test('literalOccurrences：命中互不重叠（下一条从上一命中终点起，:74）', () => {
  assert.deepEqual(literalOccurrences('aaaa', 'aa', false), [{ from: 0, to: 2 }, { from: 2, to: 4 }])
})

test('literalOccurrences：整词被拒时起点推 1（FindManagerBase.java:116），可产出重叠候选', () => {
  // 'aaa' 里找 'aa'：两条候选 [0,2) 与 [1,3) 都不是整词 ⇒ 空。
  assert.deepEqual(literalOccurrences('aaa', 'aa', true), [])
  // 'aa aa' 里找 'aa'：两条都整词。
  assert.deepEqual(literalOccurrences('aa aa', 'aa', true), [{ from: 0, to: 2 }, { from: 3, to: 5 }])
})

test('literalOccurrences：整词档对非标识符查询也按 isWholeWord 判（FindManagerBase.java:250-273）', () => {
  // '->' 首尾都不是标识符字符 ⇒ 走「前一/后一字符是否与命中首/末字符相同」那两支。
  assert.deepEqual(literalOccurrences('a->b', '->', true), [{ from: 1, to: 3 }])
  assert.deepEqual(literalOccurrences('-->', '->', true), [])
})

// ── 有选区时标点也可选（上游这条路 wholeWords 为 false）────────────────────────

test('有选区：标点串可选（wholeWords 关）', () => {
  const text = 'a->b'
  const result = selectAllOccurrences({ text, selectionFrom: 1, selectionTo: 3, cursor: 3 })
  assert.equal(result.kind, 'selected')
  assert.equal(result.query, '->')
  assert.deepEqual(result.ranges, [{ from: 1, to: 3 }])
  assert.deepEqual(result.carets, [3])
})

// ── 纯逻辑约束：零 Vue / 零 DOM / 零 CodeMirror ────────────────────────────────

test('模块是纯逻辑：不 import vue / @codemirror，不碰 document/window', () => {
  const source = readFileSync(join(root, 'src', 'selectAllOccurrences.ts'), 'utf8')
  assert.doesNotMatch(source, /from\s+['"](?:vue|@codemirror)/)
  assert.doesNotMatch(source, /\bdocument\.|\bwindow\./)
})