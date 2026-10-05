// 行内词级/字符级 diff + 空白比较策略（B7 §C 的"词级/字符级差异"与"非默认比较策略"两族）。
//
// 判据分三层：
//   ① 词法切分与 native 同规则（同一文件在两条渲染路径上必须圈出同一个词）；
//   ② 词级/字符级标记的性质（只圈差异、不丢缩进改动的可见性、越界不产生标记）；
//   ③ 档位接线（默认档 = 上游默认；`byLine` 不产标记；空白三档的判等语义）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { charMarks, marksFor, tokenizeLine, wordMarks } from '../src/diffWords.ts'
import { compareCharChanges, trimSpaceChanges } from '../src/diffChars.ts'
import { comparisonKey, comparisonKeys, COMPARISON_POLICY_LABELS, DEFAULT_COMPARISON_POLICY, DEFAULT_COMPARISON_POLICY as _d, shouldTrimChunks, whitespaceOnlyDifference } from '../src/diffComparison.ts'
import { buildDiffRows } from '../src/diffText.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

// —— ① 词法切分 ——

// `ByWordRt.getInlineChunks`（`ByWordRt.kt:638-683`）：只有**词 / 连续文字 / 换行**进 chunk 表，
// 标点与空白是隐含在相邻 chunk 之间的空隙，交给 `matchAdjustmentDelimiters` 与 whitespace 那一层。
// （下划线按 `TrimUtil.kt:24-26` 的 isAlpha = 非空白且非标点算词内字符。）
test('tokenize keeps only word runs and continuous-script characters, like upstream', () => {
  const tokens = tokenizeLine('foo_bar = 12 + x;')
  assert.deepEqual(tokens.map(t => t.text), ['foo_bar', '12', 'x'])
  assert.deepEqual(tokens.map(t => t.start), [0, 10, 15])
})

test('punctuation and whitespace between words stay outside the chunk table', () => {
  assert.deepEqual(tokenizeLine('a, b').map(t => t.text), ['a', 'b'])
  // 连续文字：每个字各自一个 chunk（`ByWordRt.kt:667-669` 的 isContinuousScript 分支）。
  assert.deepEqual(tokenizeLine('中文').map(t => t.text), ['中', '文'])
  // 纯空白的行没有任何 chunk —— 它的差异完全由 whitespace 那一层表达。
  assert.deepEqual(tokenizeLine('   \t '), [])
})

test('an empty line yields no tokens', () => {
  assert.deepEqual(tokenizeLine(''), [])
})

// —— ② 标记的性质 ——

// 改一个词：只圈那个词，两侧的公共部分不被圈。
test('a changed word is the only thing marked', () => {
  const marks = wordMarks('const foo = 1', 'const bar = 1')
  assert.equal(marks.left.length, 1)
  assert.equal('const foo = 1'.slice(marks.left[0][0], marks.left[0][0] + marks.left[0][1]), 'foo')
  assert.equal('const bar = 1'.slice(marks.right[0][0], marks.right[0][0] + marks.right[0][1]), 'bar')
})

// 纯新增：`DefaultCorrector`（`ByWordRt.kt:880-895`，`expandWhitespacesBackward` 在 `:890`、
// `expandWhitespacesForward` 在 `:893`）先向后让、再向前让。两个让白函数都带
// `while (start1 < end1 && start2 < end2)` 的守卫（`TrimUtil.kt:401` 与 `:418`），
// 而纯插入的改动块**左半边是空的**（`hello` 只有 5 个字符）⇒ 两个让白都一步都走不了，
// 那个没被标点匹配吃掉的空格（`ByCharRt.kt:259-270` 只收 isPunctuation，空格不是标点）
// 就留在改动块里 ⇒ mark 是 `' world'` 而不是 `'world'`。
// （`ByWordRt.kt:610-630` 那一段是 `isTrailingSpace`，只被 `TrimSpacesCorrector`
// `ByWordRt.kt:989-1028` 用，与默认档无关 —— 独立验收 H2 就是这条引用漂了 270 行。）
test('an appended word takes the leading space, as the default corrector expands backward', () => {
  const marks = wordMarks('hello', 'hello world')
  assert.equal(marks.left.length, 0, '左侧没有改动')
  assert.equal(marks.right.length, 1)
  assert.equal('hello world'.slice(marks.right[0][0], marks.right[0][0] + marks.right[0][1]), ' world')
})

// 纯缩进改动：整段都是空白，这时**保留标记**，否则用户看不到改动（native 同款处置）。
test('a pure indentation change stays visible', () => {
  const marks = wordMarks('x = 1', '    x = 1')
  assert.ok(marks.right.length >= 1, '缩进改动不能被抹成"无差异"')
})

// 完全相同的两行不产生标记。
test('identical lines produce no marks', () => {
  assert.deepEqual(wordMarks('same', 'same'), { left: [], right: [] })
})

// 标记必须落在文本范围内（渲染层的 `parts` 会丢掉越界的，但产出的这一侧就不该越界）。
test('every mark stays inside the line', () => {
  for (const [a, b] of [['a', 'b'], ['foo bar baz', 'foo qux baz'], ['', 'x'], ['x', '']]) {
    const marks = wordMarks(a, b)
    for (const [start, length] of [...marks.left]) assert.ok(start >= 0 && start + length <= a.length, `${a} 越界`)
    for (const [start, length] of [...marks.right]) assert.ok(start >= 0 && start + length <= b.length, `${b} 越界`)
  }
})

// 字符级：改一个字符就只圈那一个字符（词级会把整个词圈住）。
test('char level pinpoints the single changed character', () => {
  const word = wordMarks('abcdef', 'abcdefg')
  const chars = charMarks('abcdef', 'abcdefg')
  assert.equal(word.left[0][1], 6, '词级：整词是一个新 token')
  assert.equal(word.right[0][1], 7, '词级：右侧整词都是新 token')
  assert.deepEqual(chars.right, [[6, 1]], '字符级：只圈那一个字符')
  assert.deepEqual(chars.left, [], '左侧每个字符都能对上')
})

test('char level marks both sides of a substitution', () => {
  const marks = charMarks('axc', 'ayc')
  assert.deepEqual(marks.left, [[1, 1]])
  assert.deepEqual(marks.right, [[1, 1]])
})

// —— ②.5 标点调整组与字符级三档（`ByWordRt.matchAdjustmentDelimiters` / `ByCharRt` 三条路）——

// `AdjustmentPunctuationMatcher`（`ByWordRt.kt:54,464-471`，类体在 `:695-860`）：标点只在**未匹配词之间的空隙**里配对，
// 所以 `a.b` vs `a,b` 只圈那一个点/逗号，词本身不算改动。
test('punctuation between matched words is matched by the adjustment matcher', () => {
  assert.deepEqual(wordMarks('a.b', 'a,b'), { left: [[1, 1]], right: [[1, 1]] })
  assert.deepEqual(wordMarks('foo(bar)', 'foo[bar]').left, [[3, 1], [7, 1]])
  assert.deepEqual(wordMarks('x=1', 'x==1').right, [[2, 1]], '多出来的 `=` 是改动')
})

// 字符级三条路对应 `ByCharRt.compareTwoStep` / `compareTrimWhitespaces` / `compareIgnoreWhitespaces`：
// 非空白码点先跑、空隙里过 `DefaultCharChangeCorrector`；trim 归一后仍有内部空白差异；ignore 全消。
test('char comparison has the three ByCharRt lanes', () => {
  assert.deepEqual(charMarks('axc', 'ayc'), { left: [[1, 1]], right: [[1, 1]] })
  const spaces = charMarks('a b', 'ab')
  assert.ok(spaces.left.length > 0, 'default 档把空格算改动')
  assert.ok(trimSpaceChanges([{ a: { start: 0, end: 3 }, b: { start: 0, end: 2 } }], 'a b', 'ab').length >= 1)
  assert.deepEqual(compareCharChanges('x = 1', 'x=1', 'ignoreWhitespaces'), [], 'ignore 档只剩空白差异 ⇒ 无改动')
  assert.ok(compareCharChanges('x = 1', 'x=1', 'trimWhitespaces').length > 0, 'trim 档不删内部空白差异')
  assert.match(read('src/diffChars.ts'), /DefaultCharChangeCorrector/)
})

// —— ③ 档位 ——

test('byLine produces no inline marks at all', () => {
  assert.deepEqual(marksFor('byLine', 'foo', 'bar'), { left: [], right: [] })
})

test('byWord and byChar both produce marks for a changed word', () => {
  assert.ok(marksFor('byWord', 'foo', 'bar').left.length > 0)
  assert.ok(marksFor('byChar', 'foo', 'bar').left.length > 0)
})

// 三档默认值必须是上游那两个常量。
test('the defaults are the upstream ones', () => {
  assert.equal(DEFAULT_COMPARISON_POLICY, 'default', 'IgnorePolicy.DEFAULT')
  assert.deepEqual(Object.keys(COMPARISON_POLICY_LABELS), ['default', 'trimWhitespaces', 'ignoreWhitespaces', 'ignoreWhitespacesChunks'])
  assert.equal(COMPARISON_POLICY_LABELS.default, '无', 'DiffBundle.properties:234 option.ignore.policy.none')
  assert.equal(COMPARISON_POLICY_LABELS.trimWhitespaces, '修整空白', ':235 option.ignore.policy.trim')
  assert.equal(COMPARISON_POLICY_LABELS.ignoreWhitespaces, '忽略空格', ':236 option.ignore.policy.whitespaces')
})

test('comparison keys fold only what the policy says', () => {
  assert.equal(comparisonKey('  a b  ', 'default'), '  a b  ')
  assert.equal(comparisonKey('  a b  ', 'trimWhitespaces'), 'a b')
  assert.equal(comparisonKey('  a b  ', 'ignoreWhitespaces'), 'ab')
  assert.deepEqual(comparisonKeys([' a ', 'b'], 'trimWhitespaces'), ['a', 'b'])
})

// —— 接进 buildDiffRows ——

// 不传档位时与之前**完全一致**（这是三个既有调用点不被影响的前提）。
test('buildDiffRows without options matches the old behaviour exactly', () => {
  // 末尾变化配对成 change 需要后面还有一条公共行（`li < lcs.length` 那条守卫的既有语义）。
  const rows = buildDiffRows(['a', 'b', 'z'], ['a', 'c', 'z'])
  assert.deepEqual(rows.map(r => r.kind), ['equal', 'change', 'equal'])
  // 默认档下 change 行**带**词级标记（上一版这一段是空的 —— 见本模块头注释）。
  assert.deepEqual(rows[1].leftMarks, [[0, 1]])
  assert.deepEqual(rows[1].rightMarks, [[0, 1]])
})

test('buildDiffRows honours byLine by leaving marks out', () => {
  const rows = buildDiffRows(['a', 'b'], ['a', 'c'], { highlight: 'byLine' })
  assert.equal(rows[1].leftMarks, undefined)
  assert.equal(rows[1].rightMarks, undefined)
})

// `trimWhitespaces`：只差尾随空白的行算相等（上游 `ComparisonPolicy.TRIM_WHITESPACES`）。
// 用「末行就该是 delete/insert」这个既有的配对语义来对照：默认档把它们当不同行，
// trim 档折出来的键相同 ⇒ 直接判等。
test('trimWhitespaces makes trailing-space-only lines equal', () => {
  const strict = buildDiffRows(['a', 'b', 'z'], ['a', 'b  ', 'z'])
  const trimmed = buildDiffRows(['a', 'b', 'z'], ['a', 'b  ', 'z'], { comparison: 'trimWhitespaces' })
  assert.deepEqual(strict.map(r => r.kind), ['equal', 'change', 'equal'], '默认档：尾随空格算不同')
  assert.deepEqual(trimmed.map(r => r.kind), ['equal', 'equal', 'equal'], 'trim 档：折掉后判等')
})

// `ignoreWhitespaces`：中间的空白也不参与比较。
test('ignoreWhitespaces makes internal whitespace irrelevant', () => {
  const strict = buildDiffRows(['a', 'a b', 'z'], ['a', 'ab', 'z'])
  const ignored = buildDiffRows(['a', 'a b', 'z'], ['a', 'ab', 'z'], { comparison: 'ignoreWhitespaces' })
  assert.deepEqual(strict.map(r => r.kind), ['equal', 'change', 'equal'])
  assert.deepEqual(ignored.map(r => r.kind), ['equal', 'equal', 'equal'])
})

// 折过的键只用于判等：渲染的仍是**原文**（行号与文本都不能被折掉）。
test('the folded key never replaces the rendered text', () => {
  const rows = buildDiffRows(['  a  '], ['a'], { comparison: 'trimWhitespaces' })
  assert.equal(rows[0].left.text, '  a  ')
  assert.equal(rows[0].right.text, 'a')
})

// 接线：两个调用点都还在（改成"只接一处"会让另一处悄悄退回旧行为）。
test('both existing callers still go through buildDiffRows', () => {
  assert.match(read('src/vcsActions.ts'), /buildDiffRows/)
  assert.match(read('src/editorFileOps.ts'), /buildDiffRows/)
})
// —— 第一百零四批：第四档「忽略空格和空行」（`IgnorePolicy.IGNORE_WHITESPACES_CHUNKS`）——

// 上游这一档**不是** `ComparisonPolicy` 的值：比较仍按 `IGNORE_WHITESPACES`，
// 多出来的是 `isShouldTrimChunks()`（`IgnorePolicy.java:41-43`）→ `processAdjoining` 的
// `trim && policy == IGNORE_WHITESPACES` 分支：把"只差空白"的改动从改动块首尾剪掉。
test('the fourth tier folds to the same key as ignoreWhitespaces', () => {
  assert.equal(comparisonKey('  a b  ', 'ignoreWhitespacesChunks'), 'ab')
  assert.equal(comparisonKey('  a b  ', 'ignoreWhitespacesChunks'), comparisonKey('  a b  ', 'ignoreWhitespaces'))
})

test('only the fourth tier trims chunk edges', () => {
  assert.equal(shouldTrimChunks('default'), false)
  assert.equal(shouldTrimChunks('trimWhitespaces'), false)
  assert.equal(shouldTrimChunks('ignoreWhitespaces'), false)
  assert.equal(shouldTrimChunks('ignoreWhitespacesChunks'), true)
})

test('a missing side counts as an empty line when deciding "whitespace only"', () => {
  assert.equal(whitespaceOnlyDifference(undefined, ''), true)
  assert.equal(whitespaceOnlyDifference('   ', undefined), true)
  assert.equal(whitespaceOnlyDifference(' a ', 'a'), true)
  assert.equal(whitespaceOnlyDifference('a', 'b'), false)
})

// 这一档和上一档的**唯一**差别就在这里：空行的增删不再算改动。
test('an inserted blank line is not a change under the fourth tier', () => {
  const before = ['a', 'b']
  const after = ['a', '', 'b']
  assert.deepEqual(buildDiffRows(before, after, { comparison: 'ignoreWhitespaces' }).map(r => r.kind),
    ['equal', 'insert', 'equal'], '忽略空格那一档：空行插入仍算改动')
  assert.deepEqual(buildDiffRows(before, after, { comparison: 'ignoreWhitespacesChunks' }).map(r => r.kind),
    ['equal', 'equal', 'equal'], '忽略空格和空行那一档：不再算改动')
})

test('a deleted blank line is not a change either', () => {
  const rows = buildDiffRows(['a', '', 'b'], ['a', 'b'], { comparison: 'ignoreWhitespacesChunks' })
  assert.deepEqual(rows.map(r => r.kind), ['equal', 'equal', 'equal'])
})

// 剪的是**改动块的首尾**：块中间真的改了东西，那几行照旧算改动。
test('trimming stops at the first real change in the block', () => {
  const before = ['a', '   ', 'real = 1']
  const after = ['a', '', 'real=2']
  const rows = buildDiffRows(before, after, { comparison: 'ignoreWhitespacesChunks' })
  // 尾部那一对没有"后面还有公共行"，所以是 delete+insert（这是本模块既有的配对语义）。
  assert.deepEqual(rows.map(r => r.kind), ['equal', 'equal', 'delete', 'insert'], '只差空白的首行 ⇒ 剪掉；真改动留着')
  assert.equal(rows[1].left.text, '   ', '剪掉的行照旧渲染原文')
})

// 剪掉的行按未更改渲染：不画底色、不画行内标记（上游是把那个 fragment 整个丢掉）。
test('a trimmed row carries no marks and renders as context', () => {
  const rows = buildDiffRows(['a', 'b'], ['a', '', 'b'], { comparison: 'ignoreWhitespacesChunks' })
  const trimmed = rows[1]
  assert.equal(trimmed.kind, 'equal')
  assert.equal(trimmed.leftMarks, undefined)
  assert.equal(trimmed.rightMarks, undefined)
  assert.equal(trimmed.right.text, '')
})

test('the selector lists the shipped Chinese label for the fourth tier', () => {
  assert.equal(COMPARISON_POLICY_LABELS.ignoreWhitespacesChunks, '忽略空格和空行', ':237 option.ignore.policy.whitespaces.empty.lines')
  assert.equal(Object.keys(COMPARISON_POLICY_LABELS).length, 4, '四档都在（第五、六档要格式化器/语言侧规则，不列）')
})
