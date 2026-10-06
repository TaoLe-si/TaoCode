// 回车家族的**问题次序表**判据（`lp/editor-actions` 重点①）。
//
// 上游依据（2026-10-06 逐行打开核对，本文件里每条断言后面都标了它钉的是哪一行）：
//   · 注册表与 `order`：`platform/lang-impl/resources/intellij.platform.lang.impl.xml:1159-1171`
//     （EP 声明在同文件 `:399`）。
//   · 五档返回值：`platform/lang-impl/src/com/intellij/codeInsight/editorActions/enter/EnterHandlerDelegate.java:25-26`。
//   · 循环与 break：`platform/lang-impl/src/com/intellij/codeInsight/editorActions/EnterHandler.java:136-153`
//     （`:142-144` 的 `Stop` 直接 return，`:145-153` 其余非 `Continue` 档 break）。
//   · 每一档的出处：`enter/EnterInStringLiteralHandler.java:81`、`enter/EnterInLineCommentHandler.java:88`、
//     `enter/EnterAfterUnmatchedBraceHandler.java:57`、`enter/EnterInBlockCommentHandler.java:67` 与 `:98`、
//     `enter/EnterAfterJavadocTagHandler.java:77`、
//     `enter/EnterBetweenBracesFinalHandler.java:94-96`（那条 `InjectedIndentPostProcessor` 只覆写 postProcessEnter）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ENTER_HANDLER_ORDER, ENTER_RESULTS, enterInsertsNewline, preprocessEnter, preprocessSteps,
} from '../src/enterHandlerOrder.ts'

// 假表用的构造器：只关心 rank/id/ported/result 这四列，其余给个能过的形状。
function step(id, rank, extra = {}) {
  return {
    rank, id, className: `com.intellij.codeInsight.editorActions.enter.${id}`, xml: 'x.xml:1',
    orderAttr: '', phase: 'preprocess', result: 'defaultForceIndent', resultAt: `${id}.java:1`,
    ported: true, owner: '判据用的假表条目', ...extra,
  }
}

test('五档与上游 EnterHandlerDelegate.Result 逐字对齐（:25-26）', () => {
  assert.deepEqual([...ENTER_RESULTS].sort(),
    ['continue', 'default', 'defaultForceIndent', 'defaultSkipIndent', 'stop'],
    '上游就是这五档（Default / Continue / DefaultForceIndent / DefaultSkipIndent / Stop），本仓不许自己加一档')
})

test('表覆盖平台注册的那 7 条，rank 就是排完序的被问次序（xml:1159-1171）', () => {
  assert.equal(ENTER_HANDLER_ORDER.length, 7, '平台那张表在 :1159-1171 里一共 7 条')
  assert.deepEqual(ENTER_HANDLER_ORDER.map(item => item.rank), [1, 2, 3, 4, 5, 6, 7])
  assert.deepEqual(ENTER_HANDLER_ORDER.map(item => item.id), [
    'EnterInStringLiteralHandler', 'EnterInLineCommentHandler', 'afterUnmatchedBrace',
    'EnterBetweenBracesHandler', 'EnterAfterJavadocTagHandler', 'blockComment',
    'EnterBetweenBracesInjectedIndentPostProcessor',
  ], 'id 用 XML 里的 bean id（没写 id 的取类名）')
  // order="last" 的两条 ⇒ rank 6、7（块注释虽然声明在 :1161，实际最后被问）。
  assert.deepEqual(ENTER_HANDLER_ORDER.filter(item => item.orderAttr === 'last').map(item => item.id),
    ['blockComment', 'EnterBetweenBracesInjectedIndentPostProcessor'])
  assert.deepEqual(ENTER_HANDLER_ORDER.filter(item => item.phase === 'postprocess').map(item => item.id),
    ['EnterBetweenBracesInjectedIndentPostProcessor'], '只有那一条是后置处理器（:94-96 只覆写 postProcessEnter）')
  // 每一档的出处（命中时上游 return 的那一行的行号，逐条打开核过）。
  assert.deepEqual(ENTER_HANDLER_ORDER.map(item => item.resultAt), [
    'EnterInStringLiteralHandler.java:81', 'EnterInLineCommentHandler.java:88',
    'EnterAfterUnmatchedBraceHandler.java:57',
    'EnterBetweenBracesFinalHandler.java:45-122（本树里这条只有 Continue 与下面的 postProcess 支）',
    'EnterAfterJavadocTagHandler.java:77',
    'EnterInBlockCommentHandler.java:67（补闭尾那一支）与 :98（`* ` 续行那一支）',
    'EnterBetweenBracesFinalHandler.java:94-96（只覆写 postProcessEnter）',
  ])
  assert.deepEqual(ENTER_HANDLER_ORDER.map(item => item.result),
    ['defaultForceIndent', 'defaultForceIndent', 'defaultForceIndent', null, 'defaultForceIndent', 'default', null])
})

test('preprocess 那一段的本仓有效次序：字面量 → 行注释 → 左花括号 →（成对花括号）→ 块注释', () => {
  assert.deepEqual(preprocessSteps(ENTER_HANDLER_ORDER).map(item => item.id), [
    'EnterInStringLiteralHandler', 'EnterInLineCommentHandler', 'afterUnmatchedBrace',
    'EnterBetweenBracesHandler', 'EnterAfterJavadocTagHandler', 'blockComment',
  ], '后置那条不参与 preprocess')
  assert.deepEqual(preprocessSteps(ENTER_HANDLER_ORDER).filter(item => item.ported).map(item => item.id), [
    'EnterInStringLiteralHandler', 'EnterInLineCommentHandler', 'afterUnmatchedBrace',
    'EnterBetweenBracesHandler', 'blockComment',
  ], '本仓没实现的那条（EnterAfterJavadocTagHandler）按 Continue 处理，不改后面几条的相对次序')
})

test('循环按表的次序问、第一个接管的算（EnterHandler.java:136-153）', () => {
  const steps = [step('A', 1), step('B', 2), step('C', 3)]
  const asked = []
  const hit = preprocessEnter(steps, item => {
    asked.push(item.id)
    return item.id === 'B' ? { edits: [], caretAdvance: 2 } : null
  })
  assert.deepEqual(asked, ['A', 'B'], 'C 不该被问：B 已经接管（:145-153 的 break）')
  assert.equal(hit?.step.id, 'B')
  assert.equal(hit?.result, 'defaultForceIndent', '没声明载荷档 ⇒ 用表里那一档')
  assert.equal(hit?.branch.caretAdvance, 2)
})

test('判据可失败：把表倒过来，赢的就换成另一条（次序不是写在代码里的顺序）', () => {
  const steps = [step('A', 1), step('B', 2)]
  const forward = preprocessEnter(steps, item => ({ edits: [], result: item.id === 'A' ? 'stop' : 'default' }))
  assert.equal(forward?.step.id, 'A')
  // 同一份 ask、只把数组次序换掉 ⇒ 命中的必须是 B。这一条就是为了「调乱次序表要变红」而写的。
  const reversed = preprocessEnter([steps[1], steps[0]], item => ({ edits: [], result: item.id === 'A' ? 'stop' : 'default' }))
  assert.equal(reversed?.step.id, 'B')
  assert.notEqual(reversed?.result, forward?.result, '两条的档本来就不同 ⇒ 换次序确实换了行为，这条判据不是恒真')
})

test('Stop 那一档什么都不再做（EnterHandler.java:142-144）', () => {
  assert.equal(enterInsertsNewline('stop'), false)
  assert.equal(enterInsertsNewline('default'), true)
  assert.equal(enterInsertsNewline('defaultForceIndent'), true)
  assert.equal(enterInsertsNewline('defaultSkipIndent'), true,
    'SkipIndent 也是「跑原 handler，只是别再前进/跳过空白」，插换行这一步照做（:149-152 + :163-165）')
  assert.equal(enterInsertsNewline('continue'), false, 'continue 轮不到落文档：它表示没接管')
  const hit = preprocessEnter([step('A', 1)], () => ({ edits: [], result: 'stop' }))
  assert.equal(hit?.result, 'stop', '载荷声明的档覆盖表里那一档（块注释那条有两档）')
})

test('表里标了未实现的条目不参与问（本仓按 Continue 处理，不是跳过整张表）', () => {
  const steps = [step('A', 1, { ported: false }), step('B', 2)]
  const asked = []
  const hit = preprocessEnter(steps, item => { asked.push(item.id); return { edits: [] } })
  assert.deepEqual(asked, ['B'], 'A 未实现 ⇒ 不问它，但仍然继续问后面的')
  assert.equal(hit?.step.id, 'B')
  assert.equal(preprocessEnter([step('A', 1, { ported: false })], () => ({ edits: [] })), null,
    '整张表都没人接 ⇒ null（= 交回默认回车）')
})

test('后置那一条与 javadoc 那一条在本仓的理由都写明了（不是漏登记）', () => {
  for (const id of ['EnterAfterJavadocTagHandler', 'EnterBetweenBracesInjectedIndentPostProcessor']) {
    const item = ENTER_HANDLER_ORDER.find(entry => entry.id === id)
    assert.equal(item?.ported, false)
    assert.ok(String(item?.owner).length > 8, `${id} 的理由要能读懂，不能只写「无」`)
  }
  // 成对花括号那一条本仓由 CodeMirror 承担 ⇒ 表里 ported: true，但理由要指得到那个落点。
  const between = ENTER_HANDLER_ORDER.find(item => item.id === 'EnterBetweenBracesHandler')
  assert.match(String(between?.owner), /insertNewlineAndIndent/)
  assert.equal(between?.ported, true, '这一条本仓由 CodeMirror 承担 ⇒ 算已实现，不是漏登记')
})
