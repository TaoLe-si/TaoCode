// dm/problems-view 的判据：问题面板的过滤/排序/分组（`src/problemsView.ts`）。
//
// 上游依据：
//   · 工具栏动作组 `platform/problemsView/ui/resources/intellij.platform.problemView.ui.xml:81-107`
//     （Options = 严重度过滤 + 三个排序开关 + 按检查器分组；ExpandAll / CollapseAll）；
//   · 严重度过滤是**多选**：`ProblemsViewState.hideBySeverity`（`ProblemsViewState.kt:34`）
//     + `ProblemFilter.kt:20`（`!state.hideBySeverity.contains(severity)`）；
//   · 排序是 `ProblemsViewNodeComparator`（`ProblemsViewNodeComparator.kt:14-46`），
//     自然序来自 `NaturalComparator.java:20-105`。
// 这里钉住纯规则；面板组件只是把规则接到 DOM（源码断言见文件尾）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DEFAULT_PROBLEM_FILTER, DEFAULT_PROBLEM_SORT, filterProblems, groupProblems, hiddenSeveritiesFor,
  itemsCountText, levelCountText, levelCountsOf, naturalCompare, orderDirectoryGroups,
  problemCounts, problemTailCounts, groupTailOf, PROBLEM_GROUPINGS, groupKeyOf, severityKeyOf, sortProblems, sourceOf, codeOf,
  MAX_TAIL_LEVEL_TYPES,
} from '../src/problemsView.ts'

const row = (path, line, severity, message, source = 'tsserver') => ({ path, line, character: 0, severity, message, source })
const rows = [
  row('src/a/One.ts', 4, 1, 'Cannot find name x'),
  row('src/a/One.ts', 9, 2, 'unused variable'),
  row('src/b/Two.ts', 0, 2, 'unused import'),
  row('README.md', 2, 3, 'hint: consider renaming'),
]
/** 单选 → 隐藏集合的快捷写法：「只看第 n 档」= 藏起其余三档。 */
const only = severity => filterProblems(rows, { hidden: hiddenSeveritiesFor(severity), query: '' })

test('默认过滤不动表（隐藏集合为空 + 空查询）', () => {
  assert.deepEqual(DEFAULT_PROBLEM_FILTER, { hidden: [], query: '' })
  assert.equal(filterProblems(rows, DEFAULT_PROBLEM_FILTER).length, 4)
})

test('严重度过滤是多选：勾掉两档只影响那两档，其余照常显示', () => {
  assert.deepEqual(only(1).map(r => r.message), ['Cannot find name x'])
  assert.deepEqual(only(2).map(r => r.path), ['src/a/One.ts', 'src/b/Two.ts'])
  // 上游的核心行为：能同时显示错误与警告、只藏起信息（单选下拉做不到这件事）。
  assert.deepEqual(filterProblems(rows, { hidden: [3, 4], query: '' }).map(r => r.severity), [1, 2, 2])
  assert.equal(filterProblems(rows, { hidden: [1, 2, 3, 4], query: '' }).length, 0, '全藏起来就是空表')
})

test('文本过滤看消息、路径与来源，大小写不敏感', () => {
  const q = query => filterProblems(rows, { hidden: [], query })
  assert.deepEqual(q('UNUSED').length, 2)
  assert.deepEqual(q('src/b').map(r => r.message), ['unused import'])
  assert.deepEqual(q('tsserver').length, 4)
  assert.equal(q('  ').length, 4, '空白查询等于不过滤')
})

test('不分组：一组，行序原样（严重度 → 路径 → 行号的既有排序不被破坏）', () => {
  const groups = groupProblems(rows, 'none')
  assert.equal(groups.length, 1)
  assert.equal(groups[0].label, '')
  assert.deepEqual(groups[0].rows, rows)
})

test('按文件分组：同文件合并，组序 = 首次出现顺序', () => {
  const groups = groupProblems(rows, 'file')
  assert.deepEqual(groups.map(g => g.key), ['src/a/One.ts', 'src/b/Two.ts', 'README.md'])
  assert.deepEqual(groups[0].rows.map(r => r.line), [4, 9])
})

test('按目录分组：根级文件归到 `.`', () => {
  const groups = groupProblems(rows, 'directory')
  assert.deepEqual(groups.map(g => g.key), ['src/a', 'src/b', '.'])
  assert.deepEqual(groups[2].rows.map(r => r.path), ['README.md'])
})

test('按来源（检查器）分组：同 source 合并，没来源的归到显式占位组', () => {
  const mixed = [...rows, row('src/c/Three.ts', 0, 1, 'boom', '')]
  const groups = groupProblems(mixed, 'source')
  assert.deepEqual(groups.map(g => g.key), ['tsserver', '（无来源）'])
  assert.equal(groups[0].rows.length, 4)
  assert.deepEqual(groups[1].rows.map(r => r.path), ['src/c/Three.ts'])
  assert.equal(sourceOf(mixed[0]), 'tsserver')
  assert.equal(sourceOf(mixed[4]), '（无来源）', '空白来源不渲染成空白标题')
})

test('按诊断码分组：同 code 合并；没码的行**不进组**并排在所有组之前', () => {
  // 上游：`group == null` 的问题不挂组节点，直接挂在父节点下
  // （ProblemsViewHighlightingChildrenBuilder.kt:53-62），而同层的比较器把问题节点排在组节点之前
  // （ProblemsViewNodeComparator.kt:19-20），组与组之间按组名自然序（:25）。
  // ⇒ 订正前任在这里造的「（无诊断码）」占位组：上游没有那一格。
  const coded = [
    { ...row('src/a/One.ts', 4, 1, 'Cannot find name x'), code: '2304' },
    { ...row('src/b/Two.ts', 0, 2, 'unused import'), code: '6133' },
    { ...row('README.md', 2, 3, 'hint'), code: '6133' },
    { ...row('src/c/Three.ts', 0, 1, 'boom') },
  ]
  const groups = groupProblems(coded, 'code')
  assert.deepEqual(groups.map(g => g.key), ['', '2304', '6133'], '第一组是"未分组"的那批（键与标题都是空串）')
  assert.equal(groups[0].label, '', '不给未分组的那批编一个组名')
  assert.deepEqual(groups[0].rows.map(r => r.path), ['src/c/Three.ts'])
  assert.deepEqual(groups[2].rows.map(r => r.path), ['src/b/Two.ts', 'README.md'])
  // 四行 source 全是 tsserver：按来源只有一组，按诊断码分出两组 + 一批未分组 —— 新增这一档就是为了这个区分。
  assert.deepEqual(groupProblems(coded, 'source').map(g => g.key), ['tsserver'])
  assert.equal(codeOf(coded[0]), '2304')
  assert.equal(codeOf(coded[3]), '', '没码就是没有键（不进组），不是造出来的组名')
})

test('按诊断码分组的组序 = 组名自然序，不是首次出现顺序', () => {
  // 上游组节点之间走 `naturalCompare(node1.name, node2.name)`（ProblemsViewNodeComparator.kt:25），
  // 组名就是 `ProblemsViewGroupNode.kt:19` 的那个 group 串 ⇒ 码 9 排在码 10 前面。
  const coded = [
    { ...row('src/a/One.ts', 1, 1, 'a'), code: '10' },
    { ...row('src/a/One.ts', 2, 1, 'b'), code: '9' },
    { ...row('src/a/One.ts', 3, 1, 'c'), code: '100' },
  ]
  assert.deepEqual(groupProblems(coded, 'code').map(g => g.key), ['9', '10', '100'],
    '纯字典序会是 10 < 100 < 9，自然序才是上游那一把')
  // 其余四档不受这条影响（本仓自己的档，没有上游的组节点语义可照）。
  assert.deepEqual(groupProblems(coded, 'file').map(g => g.key), ['src/a/One.ts'])
})

test('严重度计数与标签同一口径', () => {
  assert.deepEqual(problemCounts(rows), { errors: 1, warnings: 2, infos: 1 })
  assert.deepEqual(problemCounts([]), { errors: 0, warnings: 0, infos: 0 })
})

// —— 排序（`ProblemsViewNodeComparator`）——

test('默认档：严重度降序（= LSP 数字升序）→ 路径自然序 → 行号', () => {
  // 原写 `{ sortBySeverity: true, sortByName: false }` 两格；实际上游是**三个**开关一起递进比较器
  // （`platform/problemsView/ui/src/com/intellij/analysis/problemsView/toolWindow/ProblemsViewPanel.java:523-529`
  //   `new ProblemsViewNodeComparator(sortFoldersFirst, sortBySeverity, sortByName)`，
  //   默认值 `ProblemsViewState.kt:29-31` = true / true / false）⇒ 这里补第三格，断言只是变严不变松。
  assert.deepEqual(DEFAULT_PROBLEM_SORT, { sortFoldersFirst: true, sortBySeverity: true, sortByName: false })
  const sorted = sortProblems(rows, DEFAULT_PROBLEM_SORT)
  assert.deepEqual(sorted.map(r => `${r.severity}:${r.path}:${r.line}`),
    ['1:src/a/One.ts:4', '2:src/a/One.ts:9', '2:src/b/Two.ts:0', '3:README.md:2'])
  assert.deepEqual(rows.map(r => r.line), [4, 9, 0, 2], '不改动传入的数组')
})

test('关掉 sortBySeverity：只按位置（路径 + 行 + 列），同级再比消息自然序', () => {
  const sorted = sortProblems(rows, { sortBySeverity: false, sortByName: false })
  assert.deepEqual(sorted.map(r => r.path), ['README.md', 'src/a/One.ts', 'src/a/One.ts', 'src/b/Two.ts'])
  assert.deepEqual(sorted.filter(r => r.path === 'src/a/One.ts').map(r => r.line), [4, 9])
})

test('打开 sortByName：先按消息自然序，再回落到位置', () => {
  const sorted = sortProblems(rows, { sortBySeverity: false, sortByName: true })
  assert.deepEqual(sorted.map(r => r.message),
    ['Cannot find name x', 'hint: consider renaming', 'unused import', 'unused variable'])
})

test('sortBySeverity 与 sortByName 可以同时开：严重度优先，档内按名称', () => {
  const sorted = sortProblems(rows, { sortBySeverity: true, sortByName: true })
  assert.deepEqual(sorted.map(r => r.severity), [1, 2, 2, 3])
  assert.deepEqual(sorted.filter(r => r.severity === 2).map(r => r.message), ['unused import', 'unused variable'])
})

test('自然序：数字段按位数比（file10 > file9），前导零与空格参与比较', () => {
  assert.ok(naturalCompare('a9', 'a10') < 0)
  assert.ok(naturalCompare('a10', 'a9') > 0)
  assert.equal(naturalCompare('a2', 'a2'), 0)
  assert.ok(naturalCompare('a2', 'a10') < 0, '位数多的更大（NaturalComparator.java:57-59）')
  assert.ok(naturalCompare('A', 'a') === 0, '默认按 ignoreCase=true 比较（:26）')
  assert.ok(naturalCompare('abc', 'abcd') < 0, '前缀相同时短的在前（:102）')
  assert.ok(naturalCompare('a b', 'a#b') > 0, '空格排在 # 之前（:118-119）')
})

test('面板真的接上了新的过滤/排序/折叠面（不是只改了纯函数）', () => {
  const panel = readFileSync('src/components/ProblemsPanel.vue', 'utf8')
  assert.match(panel, /sortProblems\(\s*filterProblems\(visibleProblems\.value, \{ hidden: hiddenSeverities\.value/)
  assert.match(panel, /:aria-expanded="optionsOpen"/, '严重度多选与排序开关要有可展开的弹层')
  assert.match(panel, /@click="toggleGroup\(group\.key\)"/, '组头没接折叠')
  assert.match(panel, /copyDescription\(rowMenu\.row\)/, '行菜单没有「复制问题描述」')
  assert.doesNotMatch(panel, /v-model="severity"/, '单选严重度下拉没换成多选')
  assert.match(panel, /<option value="code">/, '分组下拉少了「按诊断码」这一档')
  assert.match(readFileSync('src/problemsPanelState.ts', 'utf8'),
    /const GROUPINGS: readonly ProblemGrouping\[\] = PROBLEM_GROUPINGS/,
    '存档白名单必须直接取 `PROBLEM_GROUPINGS`：手写清单漏一档（code、inspection 都踩过）会静默退回「不分组」')
  // 原写 `/'source', 'code', 'inspection'\]/`（钉的是「清单末尾 = inspection」这个形状）；
  // 本轮补了「按严重级」那一档 ⇒ 末尾变成 'severity'。断言的**意图**（清单里同时有码档与检查项档）
  // 没变，只是把新形状一起钉住 —— 比原来更严，不是放松。
  // 上游依据：`AnalysisUIOptions.java:37,70-93`（Group by Severity 开关）+
  // `InspectionTree.java:452-479`（级别组节点）+ `ProblemsViewPanel.java:523-529`（第三个排序开关）。
  assert.match(readFileSync('src/problemsView.ts', 'utf8'), /'source', 'code', 'inspection', 'severity'\]/,
    '分组档清单本身要同时有「按诊断码」「按检查项」「按严重级」')
  // —— 本轮新接的三处（缺一处就是「只改了纯函数、面板没动」）——
  assert.match(panel, /<option value="severity">/, '分组下拉没有「按严重级」那一档')
  assert.match(panel, /sortFoldersFirst: sortFoldersFirst\.value/, '第三个排序开关没进存档/没进比较器')
  assert.match(panel, /@change="sortFoldersFirst =/, '选项弹层里没有「目录在前」那个复选')
  assert.match(panel, /tail: groupTailOf\(group\.rows, grouping\.value === 'severity'\)/, '组头没接逐级计数')
  assert.match(panel, /problemCounts\(rows\.value\)/, '`problemCounts` 仍然没有生产消费方')
})

test('App.vue 真的挂了 ProblemsPanel（不是留下旧内联列表）', () => {
  const app = readFileSync('src/App.vue', 'utf8')
  assert.match(app, /<ProblemsPanel v-else-if="bottomTab === 'problems'"/)
  assert.doesNotMatch(app, /v-for="\(p, index\) in allProblems"/)
})

// —— 按严重级分组（上游「Group by Severity」）+ 树节点尾巴的逐级计数 ——
// 上游依据（本轮逐条打开核对过）：
//   · 开关与默认值：`platform/lang-impl/src/com/intellij/analysis/AnalysisUIOptions.java:37`
//     （`GROUP_BY_SEVERITY = false`，Inspect Code Results 出厂不按级别分）+ `:70-93` 那个 toggle，
//     文案 `platform/analysis-api/resources/messages/InspectionsBundle.properties:98-100`；
//   · 树形状：`platform/lang-impl/src/com/intellij/codeInspection/ui/InspectionTree.java:452-479`
//     （根的直接子节点 = 级别组节点）+ `InspectionTreeModel.java:151-157`（按 level 去重）+
//     `InspectionSeverityGroupNode.java:37-39`（组名 = 级别的首字母大写显示名）；
//   · 组序：`platform/lang-impl/src/com/intellij/codeInspection/ui/InspectionResultsViewComparator.java:34-38`
//     （两个级别组之间 `-registrar.compare(severity1, severity2)` = 严重度降序）；
//   · 计数：`platform/lang-impl/src/com/intellij/codeInspection/ui/InspectionTreeNode.java:81-99`
//     （子节点的 `LevelAndCount` 按级别累加）+ `InspectionTreeTailRenderer.java:34-67`
//     （> `MAX_LEVEL_TYPES`(=5) 只报合计，否则逐级；ERROR 那格只在**没**按级别分组时是红的）；
//   · 文案模板：`platform/analysis-api/src/com/intellij/lang/annotation/HighlightSeverity.java:176-180` +
//     `platform/analysis-api/resources/messages/InspectionsBundle.properties:23,35,39,43,47,83`。

test('按严重级分组：键 = 级别 id，组序 = 严重度降序（不是首次出现顺序）', () => {
  const mixed = [
    row('README.md', 2, 3, 'hint'),      // WEAK_WARNING
    row('src/a/One.ts', 4, 1, 'boom'),   // ERROR
    row('src/b/Two.ts', 0, 4, 'note'),   // INFO
  ]
  const groups = groupProblems(mixed, 'severity')
  assert.deepEqual(groups.map(g => g.key), ['ERROR', 'WEAK_WARNING', 'INFO'],
    '传进来的顺序是弱→强，组序必须按级别 rank 反过来（InspectionResultsViewComparator.java:34-38）')
  assert.deepEqual(groups.map(g => g.label), ['错误', '提示', '信息'], '组名 = 那一级的显示名')
  assert.deepEqual(groups.map(g => g.rows.map(r => r.message)), [['boom'], ['hint'], ['note']])
  // 每条都折得出级别 ⇒ 这一档没有「不进组」的那些行（与 `code`/`inspection` 两档的形状不同，
  // 那一支来自 HighlightingProblem.kt:87 的 `?: return null`，级别这边没有对应的 null）。
  assert.equal(groups.filter(g => g.key === '').length, 0)
  assert.equal(severityKeyOf(mixed[1]), 'ERROR')
  assert.equal(groupKeyOf(mixed[0], 'severity'), 'WEAK_WARNING')
  assert.ok(PROBLEM_GROUPINGS.includes('severity'), '下拉与存档白名单都要有这一档')
})

test('按严重级分组：认不出的严重度不丢行，落进最弱一级', () => {
  const odd = [row('x.ts', 0, 99, 'weird'), row('x.ts', 1, 0, 'also weird')]
  const groups = groupProblems(odd, 'severity')
  assert.deepEqual(groups.map(g => g.key), ['ERROR', 'INFO'], '99 按 INFO、0 按 ERROR（levelForSeverity 的两端回落）')
  assert.equal(groups[1].rows.length, 1)
  assert.equal(groups.reduce((sum, g) => sum + g.rows.length, 0), 2, '一行都不能在分组里丢掉')
})

test('逐级计数：只产在场的级别，顺序恒为严重度降序（上游 LevelAndCount[]）', () => {
  assert.deepEqual(levelCountsOf(rows), [
    { id: 'ERROR', label: '错误', count: 1 },
    { id: 'WARNING', label: '警告', count: 2 },
    { id: 'WEAK_WARNING', label: '提示', count: 1 },
  ])
  assert.deepEqual(levelCountsOf([]), [], '空表不造一个「0 errors」')
  // 三格计数与它是同一份实现（面板/报告不再各数一遍，两处的 3/4 档合并在同一处）
  assert.deepEqual(problemCounts(rows), { errors: 1, warnings: 2, infos: 1 })
  assert.deepEqual(problemCounts([]), { errors: 0, warnings: 0, infos: 0 })
})

test('尾巴计数：ERROR 那一格只在没按严重级分组时标红（InspectionTreeTailRenderer.java:63-65）', () => {
  const levels = levelCountsOf(rows)
  assert.deepEqual(problemTailCounts(levels, false), [
    { id: 'ERROR', text: '错误 1', error: true },
    { id: 'WARNING', text: '警告 2', error: false },
    { id: 'WEAK_WARNING', text: '提示 1', error: false },
  ])
  const grouped = problemTailCounts(levels, true)
  assert.deepEqual(grouped.map(e => e.error), [false, false, false],
    '按级别分组时组名已经是那一级 ⇒ 上游不给红色（TREE_GRAY 一致灰）')
  assert.deepEqual(grouped.map(e => e.text), ['错误 1', '警告 2', '提示 1'], '只有颜色这一档变，条数不变')
  assert.deepEqual(problemTailCounts([], false), [])
})

test('会失败的那一条：级别种数超过 MAX_LEVEL_TYPES 才折成合计，恰好 5 档不折（上游是 > 不是 >=）', () => {
  assert.equal(MAX_TAIL_LEVEL_TYPES, 5, '上游 `InspectionTreeTailRenderer.java:23` 的常量')
  const five = Array.from({ length: 5 }, (_unused, i) => ({ id: `L${i}`, label: `级${i + 1}`, count: i + 1 }))
  assert.equal(problemTailCounts(five, false).length, 5, '5 档仍然逐级（把 `>` 写成 `>=` 就是这一条先红）')
  const six = [...five, { id: 'L5', label: '级6', count: 6 }]
  assert.deepEqual(problemTailCounts(six, false), [{ id: 'TOTAL', text: '(21 items)', error: false }],
    '合计那一格 = inspection.problem.descriptor.count 的 2# 支（`{0,number,integer} items`）')
  // 0 条的那一支容易写错：上游 choice 的 0# 是**空串**（`InspectionsBundle.properties:83`），
  // 不是 `(0 items)` ⇒ 尾巴上什么都不写。
  assert.deepEqual(problemTailCounts(six.map(item => ({ ...item, count: 0 })), false), [])
  assert.equal(itemsCountText(0), '')
  assert.equal(itemsCountText(1), '(1 item)')
  assert.equal(itemsCountText(21), '(21 items)')
})

test('计数文案：名字 + 数字，数字与级别的对应逐字照上游模板', () => {
  assert.equal(levelCountText(3, '错误'), '错误 3')
  assert.equal(levelCountText(1, '警告'), '警告 1')
  assert.equal(levelCountText(0, '信息'), '信息 0')
})

// —— 第三个排序开关 sortFoldersFirst（上游默认 true，本仓此前只有两格）——
//   · 开关：`platform/problemsView/ui/src/com/intellij/analysis/problemsView/toolWindow/ProblemsViewState.kt:29`
//     （`var sortFoldersFirst: Boolean by property(true)`）+ 动作 `intellij.platform.problemView.ui.xml:85-87`
//     （`ProblemsView.SortFoldersFirst`）+ 递给比较器 `ProblemsViewPanel.java:523-529`；
//   · 规则：`ProblemsViewNodeComparator.kt:21-24`（同层两个 FileNode 之间，`file.isDirectory` 的在前）
//     → 关掉时只剩 `:25` 的 `naturalCompare(node.name)`。

test('目录在前：同层的子目录组排在本层文件组之前，DFS 展开顺序逐字照比较器', () => {
  const keys = ['.', 'src', 'src/a', 'src/b', 'test']
  assert.deepEqual(orderDirectoryGroups(keys, true),
    ['src/a', 'src/b', 'src', 'test', '.'],
    '`.` 那一组（根级文件）在所有子树之后；src 自己的那一组在 src/a、src/b 之后')
  // 关掉开关 = 纯自然序（`naturalCompare(node1.name, node2.name)`，:25）：`.` 排在字母前。
  assert.deepEqual(orderDirectoryGroups(keys, false), ['.', 'src', 'src/a', 'src/b', 'test'])
  // 中间层没有自己的组时不断链：`src/a/b` 仍然是 `src` 的后代。
  assert.deepEqual(orderDirectoryGroups(['src/a/b', 'src'], true), ['src/a/b', 'src'])
  // 自然序在兄弟之间生效：a10 排在 a9 之后（数字段按位数比）。
  assert.deepEqual(orderDirectoryGroups(['src/a10', 'src/a9', 'src'], true), ['src/a9', 'src/a10', 'src'])
})

test('按目录分组跟着 sortFoldersFirst 走；缺省用上游默认 true', () => {
  const nested = [
    row('README.md', 0, 1, 'a'),
    row('src/a/One.ts', 1, 1, 'b'),
    row('src/b/Two.ts', 1, 1, 'c'),
    row('src/Zero.ts', 1, 1, 'd'),
  ]
  assert.deepEqual(groupProblems(nested, 'directory').map(g => g.key), ['src/a', 'src/b', 'src', '.'],
    '默认（目录在前）：子目录组先于 src 自己的那一组，根级文件最后')
  assert.deepEqual(groupProblems(nested, 'directory', { sortFoldersFirst: false }).map(g => g.key),
    ['.', 'src', 'src/a', 'src/b'], '关掉后回到纯自然序')
})

test('面板那一格：组内只有一级时不补逐级（同一个数不报两遍），混级才补', () => {
  const oneLevel = [row('a.ts', 1, 2, 'x'), row('b.ts', 2, 2, 'y')]
  assert.deepEqual(groupTailOf(oneLevel, false), [], '两条都是警告 ⇒ 组头的总条数已经是那个数')
  const mixed = [row('a.ts', 1, 1, 'x'), row('b.ts', 2, 2, 'y')]
  assert.deepEqual(groupTailOf(mixed, false), [
    { id: 'ERROR', text: '错误 1', error: true },
    { id: 'WARNING', text: '警告 1', error: false },
  ])
  // 按严重级分组时每组恒一级 ⇒ 面板这一节整体不出现（组名就是那一级）。
  assert.deepEqual(groupProblems(mixed, 'severity').map(g => g.key), ['ERROR', 'WARNING'],
    '先把这份混合表按级别分组，再逐组问尾巴 —— 才是面板实际会喂进去的东西')
  assert.deepEqual(groupProblems(mixed, 'severity').map(g => groupTailOf(g.rows, true)), [[], []])
})
