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
  naturalCompare, problemCounts, sortProblems, sourceOf, codeOf,
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
  assert.deepEqual(DEFAULT_PROBLEM_SORT, { sortBySeverity: true, sortByName: false })
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
  assert.match(readFileSync('src/problemsView.ts', 'utf8'), /'source', 'code', 'inspection'\]/,
    '分组档清单本身要同时有「按诊断码」与「按检查项」')
})

test('App.vue 真的挂了 ProblemsPanel（不是留下旧内联列表）', () => {
  const app = readFileSync('src/App.vue', 'utf8')
  assert.match(app, /<ProblemsPanel v-else-if="bottomTab === 'problems'"/)
  assert.doesNotMatch(app, /v-for="\(p, index\) in allProblems"/)
})
