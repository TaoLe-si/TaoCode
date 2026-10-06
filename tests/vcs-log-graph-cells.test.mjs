// 提交图的**行内图形单元**（每行的列 + 单元类型）与折叠/显示档的判据。
//
// 上游基准（逐条打开过那一行，路径都是树里的真路径）：
//  · 单元四件套 `rowIndex / positionInCurrentRow / colorId / isSelected`
//    —— platform/vcs-log/graph-api/src/com/intellij/vcs/log/graph/PrintElement.kt:7-12
//  · 边单元 `positionInOtherRow` + `Type(UP/DOWN)` + `LineStyle(SOLID/DASHED/DOTTED)` + `hasArrow()`
//    —— platform/vcs-log/graph-api/src/com/intellij/vcs/log/graph/EdgePrintElement.kt:4-21
//  · 边型→线型的映射：`USUAL`/`NOT_LOAD_COMMIT` ⇒ SOLID，`DOTTED`/`DOTTED_ARROW_*` ⇒ **DASHED**
//    —— platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/print/elements/EdgePrintElementImpl.kt:43-48
//  · 节点单元 FILL / OUTLINE / OUTLINE_AND_FILL —— platform/vcs-log/graph-api/src/com/intellij/vcs/log/graph/NodePrintElement.java:7-17；
//    只有带 `HEAD` 引用的那一行被换成头节点单元 —— platform/vcs-log/impl/src/com/intellij/vcs/log/ui/table/GraphTableModel.kt:102-117
//  · 一行的元素集合 = 节点 + 穿过这一行的边，**列 = 元素在这一行里的下标**
//    —— platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/print/PrintElementGeneratorImpl.kt:246-268 与 :134；
//    节点排在最后（"nodes at the end, to be drawn over the edges"，同文件 :126-173）
//  · 终端单元两列同值 —— platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/print/elements/TerminalEdgePrintElement.java:11-17
//  · 收起线性分支时**同时**建那条 DOTTED 边 —— platform/vcs-log/graph/src/com/intellij/vcs/log/graph/collapsing/CollapsedActionManager.java:214-241
//    （`hideNode` 在 :230、`createEdge(..., GraphEdgeType.DOTTED)` 在 :231），而 DOTTED 仍是普通边
//    —— platform/vcs-log/graph/src/com/intellij/vcs/log/graph/api/elements/GraphEdgeType.java:18-24
//  · 「折叠已合并分支」那族文案只在 `GRAPH_OPTIONS == LinearBek` 时出现
//    —— platform/vcs-log/impl/src/com/intellij/vcs/log/ui/actions/CollapseOrExpandGraphAction.java:51-69
//    （文案 key：platform/vcs-log/impl/src/com/intellij/vcs/log/ui/actions/CollapseGraphAction.java:14-19）
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildLogGraph, collapseLinearBranches, collapseLinearGraph, collapsedLinearHashes,
  collapsedLinearSpans, graphUnitsOfRows,
} from '../src/vcsLogGraph.ts'
import {
  DEFAULT_LOG_GRAPH_DISPLAY, LOG_COLLAPSE_MERGES_TITLE, LOG_COLLAPSE_TITLE, LOG_EXPAND_MERGES_TITLE, LOG_EXPAND_TITLE,
  collapseActionTitles, graphDisplayOptions, hasNonDefaultGraphOptions, logGraphOptionsModel,
} from '../src/vcsLogGraphOptions.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const commit = (hash, parents, refs = []) => ({
  hash, shortHash: hash, author: 'A', date: '2026-10-06T00:00:00Z', subject: hash, parents, refs,
})
const HEAD = { name: 'HEAD', type: 'head' }
/** h1 → h2 → h3 → h4：一条长度 4 的线性链（中间两个会被收起）。 */
const chain = [commit('h1', ['h2']), commit('h2', ['h3']), commit('h3', ['h4']), commit('h4', [])]
/** m1 有两条入边（p1 直连 + b1 绕回来），是真正的合并拓扑。 */
const merged = [commit('m1', ['p1', 'p2']), commit('p1', ['b1']), commit('b1', ['p2']), commit('p2', [])]

const unitsAt = (units, index) => units[index] ?? []
const edges = units => units.filter(unit => unit.kind === 'edge')
const nodeOf = units => units.find(unit => unit.kind === 'node')

test('折叠必须把两端连起来：那条边是 DASHED，不是"没有边"', () => {
  const { visible, graph } = collapseLinearGraph(chain, true)
  assert.deepEqual(visible.map(item => item.hash), ['h1', 'h4'], '中间两个提交仍然被收起（上游 hideNode）')
  // 反证用：没有 collapsedSpans 时这两行之间**一条边都没有** —— 这就是本批改掉的那个行为。
  const orphan = buildLogGraph(visible)
  assert.deepEqual(orphan.rows.map(row => row.down.length), [0, 0], '不传折叠跨度 ⇒ 两段互不相连')
  assert.equal(graph.rows[0].down.length, 1, '折叠后 h1 那一行要接住那条跨度边')
  assert.equal(graph.rows[0].down[0].style, 'dashed', '跨度边的线型 = DASHED（EdgePrintElementImpl.kt:46-47）')
  assert.equal(graph.rows[1].up[0].style, 'dashed', '目标行从**上边**接同一条虚线')
  const first = edges(unitsAt(graph.units, 0))
  assert.equal(first.length, 1)
  assert.equal(first[0].style, 'dashed')
  assert.equal(first[0].direction, 'down')
  assert.equal(first[0].hasArrow, false, '普通跨度边不是终端单元，不该带箭头')
  assert.equal(collapseLinearGraph(chain, false).graph.rows[0].down[0].style, 'solid', '展开档 = 逐字实心边照旧')
})

test('collapsedLinearSpans 给的是链的两端；collapsed=false 时不建虚线', () => {
  assert.deepEqual(collapsedLinearSpans(chain), [{ from: 'h1', to: 'h4' }])
  const { graph } = collapseLinearGraph(chain, false)
  assert.deepEqual(graph.rows.map(row => row.down.filter(edge => edge.style === 'dashed').length), [0, 0, 0, 0])
  assert.deepEqual([...collapsedLinearHashes(chain)], ['h2', 'h3'], '隐藏集合与既有判据同一份（不放松）')
})

test('边界：跨度有一端不在可见行里 ⇒ 不生成边，也不崩（上游同样只在可见图上加边）', () => {
  const visible = collapseLinearBranches(chain, true)
  const dangling = buildLogGraph(visible, { collapsedSpans: [{ from: 'h2', to: 'h4' }] })
  assert.equal(dangling.rows.length, 2)
  assert.equal(dangling.rows[0].down.length, 0, 'h2 已被收起 ⇒ 那条跨度边整条丢掉，而不是画到不存在的行上')
  assert.equal(dangling.rows[1].up.length, 0)
  const backwards = buildLogGraph(visible, { collapsedSpans: [{ from: 'h4', to: 'h1' }] })
  assert.equal(backwards.rows[0].down.length, 0, '链尾→链首（targetRow <= fromRow）不是合法跨度')
})

test('边界：链跑到页尾（父提交不在本页）时折叠仍然连得上', () => {
  const tail = [commit('h1', ['h2']), commit('h2', ['h3']), commit('h3', ['h4']), commit('h4', ['offpage'])]
  assert.deepEqual(collapsedLinearSpans(tail), [{ from: 'h1', to: 'h4' }])
  const { graph } = collapseLinearGraph(tail, true)
  assert.equal(graph.rows[0].down[0].style, 'dashed', 'h4 自己那条入边指向页外，不影响跨度边')
  assert.equal(graph.rows[1].up.filter(edge => edge.style === 'dashed').length, 1)
  assert.equal(graph.rows[1].up.filter(edge => edge.style === 'solid').length, 0, 'offpage 不在本页 ⇒ 不凭空造边')
})

test('图形单元：按行密排列，节点排在最后（PrintElementGeneratorImpl.kt:134 与 :171）', () => {
  const { units } = buildLogGraph(merged)
  assert.equal(units.length, merged.length)
  for (const [index, row] of units.entries()) {
    assert.equal(row[row.length - 1].kind, 'node', `第 ${index} 行的最后一个单元必须是节点（画在边之上）`)
    // 同一列允许竖线的"上半 + 下半"两个单元并存（上游给一个节点的两条邻边各发一条 UP/DOWN，
    // PrintElementGeneratorImpl.kt:143-148），但**完全相同**的单元只有一份。
    const key = unit => `${unit.kind}|${unit.direction ?? ''}|${unit.position}|${unit.otherPosition ?? ''}|${unit.style ?? ''}|${unit.hasArrow ?? ''}|${unit.color}`
    assert.equal(new Set(row.map(key)).size, row.length, '同一格不能出现两条一模一样的单元（重合的边要合成一条）')
    const columns = [...new Set(row.map(unit => unit.position))].sort((a, b) => a - b)
    assert.deepEqual(columns, columns.map((_, index) => index), '列号必须是从 0 起连续密排的（positionInCurrentRow = 行内下标）')
  }
  const bend = edges(units[0]).filter(unit => unit.position !== unit.otherPosition)
  assert.equal(bend.length, 1, '合并提交那一行有一条**弯线**：positionInOtherRow 与本行不同')
  assert.equal(bend[0].direction, 'down')
  assert.ok(edges(units[0]).some(unit => unit.position === unit.otherPosition), '同车道的那条是竖线')
})

test('graphInformation=false ⇒ 每行一个单元都不给（GraphTableModel.kt:97-100 的 emptyList）', () => {
  const hidden = buildLogGraph(merged, { graphInformation: false })
  assert.deepEqual(hidden.units, [[], [], [], []], '没有图信息时图格里一格都不画，而不是画一个孤零零的点')
  assert.equal(hidden.rows.length, merged.length, '行本身还在（列表照常显示，只是没有图形）')
  assert.deepEqual(graphUnitsOfRows(hidden.rows, false), [[], [], [], []])
  assert.ok(graphUnitsOfRows(hidden.rows, true).every(row => row.length > 0), '默认按图谱显示')
})

test('节点形状：带 HEAD 引用的那一行是 outlineAndFill，其它行是 fill', () => {
  const withHead = [commit('h1', ['h2'], [HEAD]), commit('h2', [])]
  const units = buildLogGraph(withHead).units
  assert.equal(nodeOf(units[0]).shape, 'outlineAndFill', 'GraphTableModel.kt:105 判的是引用名 == HEAD')
  assert.equal(nodeOf(units[1]).shape, 'fill', '上游 NodePrintElement.java:9-11 的默认档')
  const tagged = buildLogGraph([commit('h1', ['h2'], [{ name: 'v1', type: 'tag' }]), commit('h2', [])])
  assert.equal(nodeOf(tagged.units[0]).shape, 'fill', '标签引用不是 HEAD ⇒ 不换头节点单元')
})

test('长边关档：起点那一行给的是终端单元（两列同值 + 有箭头）', () => {
  // h1 的两条边里只有 m2 那条跨多行；关掉长边 ⇒ 起点留竖线，中间行不再穿过。
  const list = [commit('a1', ['a2', 'a9']), commit('a2', ['a3']), commit('a3', ['a9']), commit('a9', [])]
  const shown = buildLogGraph(list, { showLongEdges: true })
  const closed = buildLogGraph(list, { showLongEdges: false })
  assert.equal(closed.rows[0].stub.length, 1, '关档：那条长边在起点只留一段竖线')
  const terminal = edges(closed.units[0]).find(unit => unit.hasArrow)
  assert.ok(terminal, '竖线段 = 终端单元（TerminalEdgePrintElement.java:16 把 hasArrow 写死为 true）')
  assert.equal(terminal.otherPosition, terminal.position, '终端单元的两列是同一个值')
  assert.equal(terminal.direction, 'down')
  assert.equal(edges(shown.units[0]).filter(unit => unit.hasArrow).length, 0, '开档时同一条边不是终端单元')
})

test('显示档求值：GRAPH_OPTIONS 是单值，LinearBek → FirstParent → Base(sort)', () => {
  const base = { sort: 'date', firstParent: false, noMerges: false }
  assert.equal(graphDisplayOptions(base), DEFAULT_LOG_GRAPH_DISPLAY, '出厂档 = PermanentGraph.Options.Default')
  assert.equal(graphDisplayOptions({ ...base, sort: 'topological' }), 'PermanentGraph.Options.Base(Bek)')
  assert.equal(graphDisplayOptions({ ...base, firstParent: true }), 'PermanentGraph.Options.FirstParent')
  assert.equal(
    graphDisplayOptions({ ...base, sort: 'topological', firstParent: true }),
    'PermanentGraph.Options.FirstParent', '单值属性：开了第一个父项就不再是 Base(Bek)')
  assert.equal(
    graphDisplayOptions({ ...base, linearBek: true, firstParent: true }),
    'PermanentGraph.Options.LinearBek', 'LinearBek 优先（VcsLogGraphOptionsChooserGroup.java:66-69 的添加顺序）')
  assert.equal(hasNonDefaultGraphOptions(base), false)
  assert.equal(hasNonDefaultGraphOptions({ ...base, firstParent: true }), true)
  assert.equal(hasNonDefaultGraphOptions({ ...base, noMerges: true }), true, '父项过滤器那一半也算偏离（:102-103）')
})

test('折叠动作的文案随显示档换：默认=收起线性分支，LinearBek=折叠已合并分支', () => {
  const linear = collapseActionTitles({ sort: 'date', firstParent: false, noMerges: false })
  assert.equal(linear.collapse.title, LOG_COLLAPSE_TITLE, '出厂走 action.title.collapse.linear.branches')
  assert.equal(linear.expand.title, LOG_EXPAND_TITLE)
  assert.equal(linear.collapse.process, '正在收起线性分支…', '进度标题 = action.process.collapsing.linear.branches')
  const merges = collapseActionTitles({ sort: 'date', firstParent: false, noMerges: false, linearBek: true })
  assert.equal(merges.collapse.title, LOG_COLLAPSE_MERGES_TITLE, 'LinearBek 下换成 action.title.collapse.merges')
  assert.equal(merges.expand.title, LOG_EXPAND_MERGES_TITLE)
  assert.equal(merges.collapse.process, '正在折叠已合并分支…')
  const rows = logGraphOptionsModel(
    { sort: 'date', firstParent: false, noMerges: false, linearBek: true, collapsed: true, canCollapse: true },
    { setSort() {}, setFirstParent() {}, setNoMerges() {}, setCollapsed() {} })
  const collapse = rows.find(row => row.id === 'collapse')
  assert.equal(collapse.title, LOG_COLLAPSE_MERGES_TITLE, '弹层里那一行跟着换字（模型直接吃 collapseActionTitles）')
  assert.equal(collapse.process, '正在折叠已合并分支…')
  assert.equal(rows.find(row => row.id === 'expand').disabled, false, '已折叠 ⇒ 展开那条可点（CollapseOrExpandGraphAction.java:57）')
  const off = logGraphOptionsModel(
    { sort: 'date', firstParent: false, noMerges: false, collapsed: false, canCollapse: false },
    { setSort() {}, setFirstParent() {}, setNoMerges() {}, setCollapsed() {} })
  assert.equal(off.find(row => row.id === 'collapse').title, LOG_COLLAPSE_TITLE)
  assert.equal(off.find(row => row.id === 'collapse').disabled, true, '没有可收起的线性段 ⇒ 收起那条不可点')
  assert.equal(off.find(row => row.id === 'expand').disabled, true, '没折叠过 ⇒ 展开那条不可点')
})

test('本仓那两条待接线的事在请求文件里留着（组件不归本代理改）', () => {
  const request = readFileSync(join(root, 'docs', 'wiring-requests-2026-10-06-vcslog2.md'), 'utf8')
  assert.match(request, /collapseLinearGraph\(/, '请求里要给出折叠→建图那一步的替换代码')
  assert.match(request, /graph\.units/, '请求里要给出图形单元的渲染改法')
})
