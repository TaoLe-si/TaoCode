// 「诊断 → IDEA 检查项」身份的判据 —— `src/inspectionIdentity.ts` + 它在问题视图里的两个消费点
// （`src/problemsView.ts` 的分组标题与文本过滤）。
//
// 上游依据（逐条对应，全部按本地解压的上游树核过行号）：
//   · tags → 高亮类型：`platform/lsp/src/api/customization/LspDiagnosticsCustomizer.kt:93-96`
//     （Unnecessary → `LIKE_UNUSED_SYMBOL`，Deprecated → `LIKE_DEPRECATED`，**顺序**是 Unnecessary 先判）；
//     客户端能力声明 `platform/lsp/src/api/LspClientCapabilities.kt:205`。
//   · 这两档在上游是**注册出来的检查项**：
//     `platform/analysis-impl/src/com/intellij/codeInsight/daemon/impl/HighlightInfoType.java:30`
//     （`UNUSED_SYMBOL_SHORT_NAME = "unused"`）、`:49-51`（UNUSED_SYMBOL 用 findOrRegister + 显示名）、
//     `:53-55`（DEPRECATED 用 `DeprecationUtil.DEPRECATION_SHORT_NAME`）、`:217-218`（显示名的来源）。
//     `platform/analysis-impl/src/com/intellij/codeInspection/DeprecationUtil.java:13,15,22-24`；
//     文案原文 `platform/analysis-api/resources/messages/AnalysisBundle.properties:19`
//     （`inspection.dead.code.display.name=Unused declaration`）与 `:68`
//     （`inspection.deprecated.display.name=Deprecated API usage`）。
//   · 分组键的两级回退：`platform/problemsView/ui/src/com/intellij/analysis/problemsView/toolWindow/HighlightingProblem.kt:85-89`
//     （`problemGroup.problemName ?: inspectionToolId` → `HighlightDisplayKey` 显示名）；
//     `ProblemGroup` 的语义（把一条检查拆成几个伪检查项）
//     `platform/analysis-api/src/com/intellij/lang/annotation/ProblemGroup.java:6-12`；
//     工具短名/外部检查名 `platform/analysis-impl/src/com/intellij/codeInsight/daemon/impl/HighlightInfo.java:473-481`
//     + `platform/analysis-api/src/com/intellij/codeInspection/ExternalSourceProblemGroup.kt:13-18`。
//   · 组节点画的就是这个 group 字符串：
//     `platform/problemsView/ui/src/com/intellij/analysis/problemsView/toolWindow/ProblemsViewGroupNode.kt:11-19`。
//   · 上游的过滤器只按严重度：`platform/problemsView/ui/src/com/intellij/analysis/problemsView/toolWindow/ProblemFilter.kt:18-20`
//     —— 文本框是本仓多出来的，所以判据要求它至少能搜到面板上画出来的那一列（检查项名 / 诊断码）。
import test from 'node:test'
import assert from 'node:assert/strict'

const {
  DIAGNOSTIC_TAG_UNNECESSARY, DIAGNOSTIC_TAG_DEPRECATED, problemKindOf,
  KIND_INSPECTIONS, KIND_LABEL_ZH, NO_CHECKER_LABEL, inspectionIdentityOf, identityOfRow,
} = await import('../src/inspectionIdentity.ts')
const {
  PROBLEM_GROUPINGS, groupProblems, filterProblems, codeOf, sourceOf, NO_SOURCE_LABEL,
} = await import('../src/problemsView.ts')
const { diagnosticKind } = await import('../src/annotatorHighlights.ts')

const row = (over = {}) => ({
  path: 'src/a/One.ts', line: 0, character: 0, severity: 2, message: 'm', source: '', ...over,
})

test('tags → 两档伪检查项，判定顺序与未知 tag 逐条照上游', () => {
  // LspDiagnosticsCustomizer.kt:94 先判 Unnecessary、:95 才判 Deprecated ⇒ 两个都在时取「未使用」。
  assert.equal(problemKindOf([DIAGNOSTIC_TAG_UNNECESSARY]), 'unusedSymbol')
  assert.equal(problemKindOf([DIAGNOSTIC_TAG_DEPRECATED]), 'deprecated')
  assert.equal(problemKindOf([DIAGNOSTIC_TAG_DEPRECATED, DIAGNOSTIC_TAG_UNNECESSARY]), 'unusedSymbol')
  assert.equal(problemKindOf([3]), null, '规范外的 tag 不折成检查项')
  assert.equal(problemKindOf([]), null)
  assert.equal(problemKindOf(undefined), null, '服务器没给 tags 也要能判')
})

test('两档的 id 与显示名逐字取上游注册出来的那一份', () => {
  // HighlightInfoType.java:30 + :49-51 / DeprecationUtil.java:13 + HighlightInfoType.java:53-55
  assert.equal(KIND_INSPECTIONS.unusedSymbol.id, 'unused')
  assert.equal(KIND_INSPECTIONS.deprecated.id, 'Deprecation')
  // AnalysisBundle.properties:19 / :68 的原文（本仓不翻译上游的注册名）
  assert.equal(KIND_INSPECTIONS.unusedSymbol.displayName, 'Unused declaration')
  assert.equal(KIND_INSPECTIONS.deprecated.displayName, 'Deprecated API usage')
  // 面板芯片是中文档，与上游显示名并存不冲突
  assert.deepEqual(Object.values(KIND_LABEL_ZH), ['未使用声明', '已废弃 API'])
})

test('身份键的层级：伪检查项 > 检查器::码 > 检查器 > 码 > 空键', () => {
  assert.deepEqual(inspectionIdentityOf({ source: 'tsserver', code: '2304' }).keys,
    ['tsserver::2304', 'tsserver'])
  assert.deepEqual(inspectionIdentityOf({ source: 'eslint', code: 'no-unused-vars', tags: [1] }).keys,
    ['#unused', 'eslint::no-unused-vars', 'eslint'],
    'tags 那档排在最前 —— 上游 groupByToolId 优先读 problemGroup.problemName（HighlightingProblem.kt:87）')
  assert.deepEqual(inspectionIdentityOf({ source: '', code: '6133' }).keys, ['6133'])
  // 空键是旧存档里「（无来源）」那一条的登记位置；丢了它这类诊断就再也停不掉。
  assert.deepEqual(inspectionIdentityOf({}).keys, [''])
})

test('分组标题是检查项显示名，键仍是原来的粒度（存档与既有判据不烂）', () => {
  assert.equal(inspectionIdentityOf({ source: 'tsserver', code: '2304' }).displayName, 'tsserver (2304)')
  assert.equal(inspectionIdentityOf({ source: 'tsserver', code: '6133', tags: [1] }).displayName, 'Unused declaration')
  assert.equal(inspectionIdentityOf({}).label, NO_CHECKER_LABEL)
  const coded = [
    row({ source: 'tsserver', code: '2304' }),
    row({ source: 'tsserver', code: '6133', path: 'src/b/Two.ts' }),
    row({ source: 'tsserver', code: '6133', path: 'README.md' }),
    row({}),
  ]
  // `code` 档：键还是裸码，标题是检查项名；**没码的行不进组**（上游 `group == null` 那一支，
  // ProblemsViewHighlightingChildrenBuilder.kt:53-62）⇒ 第一格是未分组的那批，键与标题都是空串。
  const byCode = groupProblems(coded, 'code')
  assert.deepEqual(byCode.map(g => g.key), ['', '2304', '6133'])
  assert.deepEqual(byCode.map(g => g.label), ['', 'tsserver (2304)', 'tsserver (6133)'])
  assert.equal(codeOf(coded[3]), '', '没码 = 没有键（不进组），不编造组名')
  assert.equal(sourceOf(coded[3]), NO_SOURCE_LABEL, '「按来源」是本仓自己的档，占位组照旧')
  // `inspection` 档 = 上游那个开关（Group by Inspection，ActionsBundle.properties:2659）的等价物：
  // 同检查项合并（两条 6133 一组），折不出身份的那条不进组。
  assert.ok(PROBLEM_GROUPINGS.includes('inspection'), '下拉与存档白名单都要有这一档')
  const byItem = groupProblems(coded, 'inspection')
  assert.deepEqual(byItem.map(g => g.key), ['', 'tsserver::2304', 'tsserver::6133'])
  assert.deepEqual(byItem.map(g => g.rows.length), [1, 1, 2])
  assert.deepEqual(byItem.map(g => g.label), ['', 'tsserver (2304)', 'tsserver (6133)'])
})

test('文本过滤能搜到面板画出来的那一列（检查项名与诊断码）', () => {
  const rows = [row({ source: 'tsserver', code: '2304', message: 'Cannot find name x' }),
                row({ source: 'eslint', code: 'no-unused-vars', tags: [1], message: 'unused' })]
  const q = text => filterProblems(rows, { hidden: [], query: text }).map(r => r.code)
  assert.deepEqual(q('2304'), ['2304'], '按诊断码搜')
  assert.deepEqual(q('Unused declaration'), ['no-unused-vars'], '按检查项显示名搜（分组标题写什么就能搜什么）')
  assert.deepEqual(q('tsserver (2304)'), ['2304'])
})

test('身份入口与编辑器装饰层共用同一份 tags 判定（不各写一遍）', () => {
  for (const tags of [[1], [2], [1, 2], [], [7], undefined]) {
    assert.equal(diagnosticKind({ line: 0, character: 0, severity: 2, message: '', tags }),
      problemKindOf(tags))
  }
  assert.equal(identityOfRow(row({ source: 'eslint', code: 'x', tags: [2] })).kind, 'deprecated')
  assert.equal(identityOfRow(row({ source: 'eslint', code: 'x' })).kindLabel, null, '没有 tags 就不画芯片')
})
