// 列表拆行 / 合行（上游 `SplitLineIntention` / `JoinLinesIntention`，纯文本档）的判据。
//
// 每条断言都对着上游源码的行号（本地基准树实测）：
//   · `platform/lang-impl/src/com/intellij/openapi/editor/actions/lists/DefaultListSplitJoinContext.kt`
//   · 同目录 `ListSplitJoinContext.kt` / `ListSplitJoinIntentions.kt`
// 上游自带的期望输出取 `java/java-tests/testData/codeInsight/daemonCodeAnalyzer/quickFix/splitJoinLines/`
// 的 `beforeSplitArrayElements.java` → `afterSplitArrayElements.java`（逗号元素拆开）
// 与 `beforeJoinArrayElements.java` → `afterJoinArrayElements.java`（合回一行）。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  LIST_SPLIT_JOIN_TEXTS, joinListPlan, listContinuationIndent, listIntentionTitles, listJoinEdits,
  listSpanAt, listSplitEdits, splitListPlan, listValidateRange, scanListTokens,
} from '../src/listSplitJoin.ts'

/** 光标（空选区）在 `at`。 */
const caret = at => ({ anchor: at, head: at })

// ───────────────────────── 词法：分隔符 / 字符串 / 注释 ─────────────────────────

test('逗号是分隔符，字符串里的逗号不是（上游 isSeparator = textMatches(",")，DefaultListSplitJoinContext.kt:316,360）', () => {
  const kinds = scanListTokens('f("a, b", c)').map(token => `${token.kind}:${token.from}-${token.to}`)
  // `"a, b"` 整段是一个 code token（[2,8)），里面的逗号没有被切成分隔符。
  assert.ok(kinds.includes('code:2-8'))
  assert.ok(kinds.includes('separator:8-9'))
  // 只有两个分隔符候选位置里的第二个（真正的那个）出现。
  assert.equal(kinds.filter(entry => entry.startsWith('separator:')).length, 1)
})

test('行注释与块注释各成一个 comment token（默认档只认空白，注释让列表不可拆，:34,:245-265）', () => {
  assert.deepEqual(
    scanListTokens('a /* x */ b // y\nc').filter(token => token.kind === 'comment').map(token => `${token.from}-${token.to}`),
    ['2-9', '12-16'],
  )
})

test('separator="" 时一个分隔符 token 都不产生（XmlAttributesSplitJoinContext.kt:31 isSeparator 恒 false）', () => {
  assert.equal(scanListTokens('a b c', '').filter(token => token.kind === 'separator').length, 0)
  assert.equal(scanListTokens('a, b', '').filter(token => token.kind === 'separator').length, 0)
})

test('顶层分隔符切段得到元素；尾逗号不是元素（上游 elements 不含分隔符，:28,:100-114）', () => {
  const span = listSpanAt('f(a, b,)', 2)
  assert.ok(span)
  assert.deepEqual(span.separators, [3, 6])
  assert.deepEqual(span.elements, [{ from: 2, to: 3 }, { from: 5, to: 6 }])
})

test('嵌套时取最内层的列表（上游 getParentOfType 逐层上溯，JavaListSplitJoinContexts.kt:33）', () => {
  const span = listSpanAt('g(f(a, b), c)', 5)
  assert.ok(span)
  assert.deepEqual([span.open, span.close, span.depth], [3, 8, 2])
  assert.deepEqual(span.elements, [{ from: 4, to: 5 }, { from: 7, to: 8 }])
})

// ───────────────────────── 拆行（getReplacementsForSplitting，:93-117）─────────────────────────

test('单行逗号列表拆成多行：在分隔符之后断，续行 = 首行缩进 + 一个缩进单位（:105-107 + reformatRange :90-91）', () => {
  const plan = splitListPlan('f(a, b)', caret(2))
  assert.ok(plan)
  assert.equal(plan.text, 'f(a,\n    b)')
  assert.deepEqual(plan.edits, [{ from: 4, to: 5, insert: '\n    ' }])
})

test('三个元素一次全拆开（:103 逐元素，dropLast(1)）', () => {
  const plan = splitListPlan('f(a, b, c)', caret(2))
  assert.ok(plan)
  assert.equal(plan.text, 'f(a,\n    b,\n    c)')
})

test('已有断行的元素跳过（:104 nextBreak != null ⇒ continue）', () => {
  // 只有第一个元素与第二个之间是断行 ⇒ 只剩第二处可拆。
  const plan = splitListPlan('f(a,\n    b, c)', caret(2))
  assert.ok(plan)
  assert.equal(plan.text, 'f(a,\n    b,\n    c)')
})

test('一条内层替换都没有 ⇒ 不可拆（:111-112 那句 don\'t split）', () => {
  assert.equal(splitListPlan('f(a,\n    b)', caret(2)), null)
  assert.equal(splitListPlan('f(\n    a,\n    b\n)', caret(3)), null)
})

test('单元素 / 空列表 / 不在括号里 ⇒ 不可拆（isSplitAvailable:84-85 的 size > 1 与 validateRange）', () => {
  assert.equal(splitListPlan('f(a)', caret(2)), null)
  assert.equal(splitListPlan('f()', caret(2)), null)
  assert.equal(splitListPlan('a, b, c', caret(0)), null)
  assert.equal(splitListPlan('f(a, b)', caret(0)), null) // 光标压在 `f` 上：元素识别取不到参数列表
})

test('顶层注释让拆/合都不可用（validateRange:229-234 + validateHeadOrTail:245-265）', () => {
  assert.equal(splitListPlan('f(a, /* x */ b)', caret(2)), null)
  assert.equal(joinListPlan('f(a,\n/* x */ b)', caret(2)), null)
  assert.equal(listValidateRange(listSpanAt('f(a, /* x */ b)', 2)), false)
  assert.equal(listValidateRange(listSpanAt('f(a, b)', 2)), true)
})

test('字符串里的逗号不算分隔符 ⇒ 单行列表仍是两个元素（:360 isComma 只看 token 文本）', () => {
  const plan = splitListPlan('f("a, b", c)', caret(2))
  assert.ok(plan)
  assert.equal(plan.text, 'f("a, b",\n    c)')
})

test('缩进跟着首行走：首行缩进 2 空格 ⇒ 续行 6 空格', () => {
  assert.equal(splitListPlan('  f(a, b)', caret(4)).text, '  f(a,\n      b)')
})

test('尾逗号不添不删（TrailingComma 默认 IGNORE，:313,:355-357；全树无 getTrailingComma 覆写）', () => {
  assert.equal(splitListPlan('f(a, b,)', caret(2)).text, 'f(a,\n    b,)')
})

test('续行缩进的算式：列表首行缩进 + 一个缩进单位（CodeStyleManager.java:171-179 只重算行首空白）', () => {
  const span = listSpanAt('    f(a, b)', 5)
  assert.equal(listContinuationIndent('    f(a, b)', span, '\t'), '    \t')
  assert.equal(listContinuationIndent('    f(a, b)', span, '  '), '      ')
})

// ───────────────────────── 合行（getReplacementsForJoining，:119-137）─────────────────────────

test('多行逗号列表合回一行：断行换成一个空格，首尾断行删掉（:130 + :154,:175 默认空替换）', () => {
  const plan = joinListPlan('f(\n    a,\n    b\n)', caret(5))
  assert.ok(plan)
  assert.equal(plan.text, 'f(a, b)')
  assert.deepEqual(plan.edits, [
    { from: 2, to: 7, insert: '' },
    { from: 9, to: 14, insert: ' ' },
    { from: 15, to: 16, insert: '' },
  ])
})

test('上一行的续行缩进不保留：join 的编辑把整段空白一起换掉（:212-218 删兄弟空白）', () => {
  // 8 空格续行（上游 Java 默认 continuation indent 就是 8，见 afterSplitArrayElements.java）。
  assert.equal(joinListPlan('f(\n        a,\n        b\n)', caret(5)).text, 'f(a, b)')
})

test('单行 / 单元素 / 无断行 ⇒ 不可合（isJoinAvailable:87-88）', () => {
  assert.equal(joinListPlan('f(a, b)', caret(2)), null)
  assert.equal(joinListPlan('f(a)', caret(2)), null)
  assert.equal(joinListPlan('a, b', caret(0)), null)
})

test('首元素之前没有断行时头替换不产生编辑（:151-157 那一支的前置判断）', () => {
  const span = listSpanAt('f(a,\n    b)', 2)
  assert.deepEqual(listJoinEdits('f(a,\n    b)', span), [{ from: 4, to: 9, insert: ' ' }])
})

test('合行时光标跟着文本走（上游靠 document.replaceString 自动移动 caret，ListSplitJoinIntentions.kt:42-44）', () => {
  // 光标在第二行行首（偏移 11）：首段空白（含换行）被删 ⇒ 前移到 5；中间那段净减 4。
  const plan = joinListPlan('f(\n    a,\n    b\n)', caret(11))
  assert.deepEqual(plan.selection, { anchor: 5, head: 5 })
  assert.equal(plan.text, 'f(a, b)')
})

test('拆行时光标在列表之前的偏移不动；在编辑之后的偏移按净增减平移', () => {
  const plan = splitListPlan('f(a, b)  // tail', caret(5))
  assert.ok(plan)
  // 原偏移 5 落在插入点上（编辑 [4,5) → 5 个字符）⇒ 落到插入段末尾 = 9；文档其余部分（含行注释）不动。
  assert.deepEqual(plan.selection, { anchor: 9, head: 9 })
  assert.equal(plan.text, 'f(a,\n    b)  // tail')
})

// ───────────────────────── 文档首尾 / 空选区边界 ─────────────────────────

test('光标在开/闭括号上仍算在列表里（上游元素识别按包含关系，不是严格小于）', () => {
  assert.ok(listSpanAt('f(a, b)', 1))
  assert.ok(listSpanAt('f(a, b)', 6))
  assert.equal(listSpanAt('f(a, b)', 0), null)
  assert.equal(listSpanAt('f(a, b)', 7), null)
})

test('文档首尾不越界：空文本 / 只有光标的位置都返回 null', () => {
  assert.equal(listSpanAt('', 0), null)
  assert.equal(splitListPlan('', caret(0)), null)
  assert.equal(joinListPlan('', caret(0)), null)
  assert.equal(listSpanAt(')', 0), null)
  assert.equal(listSpanAt('(', 1), null)
})

test('闭括号配对错误时不认那个列表（[) 不是一对）', () => {
  assert.equal(listSpanAt('[a, b)', 2), null)
})

test('拆/合的编辑区间升序且互不重叠（ListSplitJoinIntentions.kt:56-67 validateOrder）', () => {
  for (const plan of [splitListPlan('f(a, b, c)', caret(2)), joinListPlan('f(\n    a,\n    b\n)', caret(5))]) {
    assert.ok(plan)
    for (let i = 1; i < plan.edits.length; ++i) assert.ok(plan.edits[i].from >= plan.edits[i - 1].to)
  }
})

// ───────────────────────── 文案（弹层里显示的那一行）─────────────────────────

test('文案：英文原文 CodeInsightBundle.properties:539-542，中文包 CodeInsightBundle.properties:274-275,283-284', () => {
  assert.deepEqual(LIST_SPLIT_JOIN_TEXTS, {
    commaSplit: 'Put comma-separated elements on multiple lines',
    commaJoin: 'Put comma-separated elements on one line',
    familySplit: 'Put elements on multiple lines',
    familyJoin: 'Put elements on one line',
    commaSplitZh: '将逗号分隔的元素放在多行中',
    commaJoinZh: '将逗号分隔的元素放在同一行中',
    familySplitZh: '将元素放在多行中',
    familyJoinZh: '将元素放在同一行中',
  })
})

test('逗号档取 comma 那对文案，其余档取 family 那对（CommaListSplitJoinContext:318-319 覆写）', () => {
  assert.equal(listIntentionTitles(',').split, 'Put comma-separated elements on multiple lines')
  assert.equal(listIntentionTitles(',').splitZh, '将逗号分隔的元素放在多行中')
  assert.equal(listIntentionTitles(';').split, 'Put elements on multiple lines')
  assert.equal(listIntentionTitles(';').joinZh, '将元素放在同一行中')
})