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
  activeLinearSpans, buildLogGraph, canCollapseLinearBranches, clickLinearFragment, clickableLinearHashes, collapseLinearBranches,
  collapseLinearGraph, collapsedLinearHashes, collapsedLinearSpans, graphUnitsOfRows, linearFragmentAt,
} from '../src/vcsLogGraph.ts'
import { LONG_EDGE_SIZE, VERY_LONG_EDGE_SIZE } from '../src/vcsLogGraph.ts'
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

test('长边阈值两档 = 上游那两个常量（1000 / 30）', () => {
  // platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/print/PrintElementGeneratorImpl.kt:277-278
  assert.equal(LONG_EDGE_SIZE, 30)
  assert.equal(VERY_LONG_EDGE_SIZE, 1000)
})

test('点一次图形只动**那一条**链：先展后收的先后顺序与上游 CASE 表一致', () => {
  // 两条互不相干的线性链：h1→h2→h3→h4 与 t1→t2→t3→t4，中间夹一条分叉（g1 有两个父）保证不会被串成一条。
  const two = [
    commit('h1', ['h2']), commit('h2', ['h3']), commit('h3', ['h4']), commit('h4', []),
    commit('g1', ['t1', 'x1']), commit('x1', []),
    commit('t1', ['t2']), commit('t2', ['t3']), commit('t3', ['t4']), commit('t4', []),
  ]
  assert.deepEqual(collapsedLinearSpans(two), [{ from: 'h1', to: 'h4' }, { from: 't1', to: 't4' }],
    '两条链各算各的（COLLAPSE_ALL 也是逐节点取各自的下行段）')
  assert.deepEqual(linearFragmentAt(two, 'h2'), { from: 'h1', to: 'h4' },
    '中间那一行归到它所在的链（LinearFragmentGenerator.java:90-92 的 getRelativeFragment + getLongFragment）')
  assert.equal(linearFragmentAt(two, 'g1'), undefined, '分叉提交不属于任何线性链 ⇒ 点了不动')
  // 第一次点：收起 h 那条，t 那条不受影响
  const once = clickLinearFragment(two, [], 'h1')
  assert.deepEqual(once, [{ from: 'h1', to: 'h4' }])
  assert.deepEqual(collapseLinearGraph(two, once).visible.map(c => c.hash),
    ['h1', 'h4', 'g1', 'x1', 't1', 't2', 't3', 't4'], '只藏 h 的中间两个')
  // 再点另一条：两条同时收着
  const twice = clickLinearFragment(two, once, 't4')
  assert.deepEqual(twice, [{ from: 'h1', to: 'h4' }, { from: 't1', to: 't4' }])
  assert.deepEqual(collapseLinearGraph(two, twice).visible.map(c => c.hash), ['h1', 'h4', 'g1', 'x1', 't1', 't4'])
  // 点已经收着的链的端点 = 展开那一条（`getDottedEdge` 那一条判据优先，CollapsedActionManager.java:280-281 的顺序）
  assert.deepEqual(clickLinearFragment(two, twice, 'h4'), [{ from: 't1', to: 't4' }])
  // 再点一次 = 又收回去（同一个函数两头都能走）
  assert.deepEqual(clickLinearFragment(two, [{ from: 't1', to: 't4' }], 'h1'),
    [{ from: 't1', to: 't4' }, { from: 'h1', to: 'h4' }])
  // 没得动 ⇒ undefined（组件据此不给手形光标）
  assert.equal(clickLinearFragment(two, [], 'g1'), undefined)
  assert.deepEqual([...clickableLinearHashes(two, [])].sort(), ['h1', 'h2', 'h3', 'h4', 't1', 't2', 't3', 't4'],
    '未收起时整条链上的行都会响应点击（收起后只剩两端，因为中间行已经不画了）')
  assert.deepEqual([...clickableLinearHashes(two, [{ from: 'h1', to: 'h4' }])].sort(),
    ['h1', 'h4', 't1', 't2', 't3', 't4'])
  // 数组档换页以后：不在本页的链整条丢掉，不留连不上的虚线
  assert.deepEqual(activeLinearSpans(two, [{ from: 'h1', to: 'zz' }]), [], '链尾不在本页 ⇒ 这条跨度不算')
  assert.deepEqual(collapseLinearGraph(two, [{ from: 'h1', to: 'zz' }]).visible.map(c => c.hash),
    two.map(c => c.hash), '所以一行都不藏')
  // 布尔档 = 全收 / 全展（菜单里那两条按钮）
  assert.deepEqual(collapseLinearGraph(two, true).visible.map(c => c.hash), ['h1', 'h4', 'g1', 'x1', 't1', 't4'])
  assert.deepEqual(collapseLinearGraph(two, false).visible.map(c => c.hash), two.map(c => c.hash))
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

test('长边关档：跨满 30 行才叫长边，两端各留一段带箭头的终端竖线', () => {
  // 上游的分界线是个常量，不是"只要跨行就截"：`longEdgeSize` 关档 = `LONG_EDGE_SIZE = 30`、开档 = 1000
  // （platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/print/PrintElementGeneratorImpl.kt:277-278），
  // 判据是 `isEdgeVisibleInRow` 的 `normalEdge.down - normalEdge.up < longEdgeSize`（同文件 :242-243）。
  // 原写「目标行不是紧邻下一行 = 长边」并配一个"缺省开"的档 —— 两个错位凑在一起才没露馅：
  // 这一档上游出厂是关的（VcsLogUiPropertiesImpl.kt:121-122），照原写法默认就会把几乎每条分支边都截掉。
  const far = [commit('a1', ['a2', 'a9']), commit('a2', ['f0']),
    ...Array.from({ length: 29 }, (_, i) => commit(`f${i}`, [i === 28 ? 'a9' : `f${i + 1}`])), commit('a9', [])]
  // a1 在第 0 行、a9 在第 31 行 ⇒ 跨度 31 ≥ 30 = 长边；a1→a2 是相邻边，两档都不受影响。
  assert.equal(far.findIndex(c => c.hash === 'a9'), 31, '夹具本身要跨到第 31 行')
  const shown = buildLogGraph(far, { showLongEdges: true })
  const closed = buildLogGraph(far, { showLongEdges: false })
  assert.equal(shown.rows[10].pass.length, 1, '开档：那条边照常穿过中间行')
  assert.equal(closed.rows[10].pass.length, 0, '关档：中间行不再被穿过')
  assert.equal(closed.rows[0].stub.length, 1, '关档：起点那一行留一段竖线')
  assert.equal(closed.rows[0].stub[0].direction, 'down', '起点那一段朝下（PrintElementGeneratorImpl.kt:219-224 的 DOWN）')
  assert.equal(closed.rows[31].stub.length, 1, '关档：目标行也留一段（上游两头都画，:225）')
  assert.equal(closed.rows[31].stub[0].direction, 'up', '目标行那一段朝上（同一处的 UP）')
  const terminal = edges(closed.units[0]).find(unit => unit.hasArrow)
  assert.ok(terminal, '竖线段 = 终端单元（TerminalEdgePrintElement.java:16 把 hasArrow 写死为 true）')
  assert.equal(terminal.otherPosition, terminal.position, '终端单元的两列是同一个值')
  assert.equal(terminal.direction, 'down')
  assert.equal(edges(closed.units[31]).find(unit => unit.hasArrow).direction, 'up', '目标行那一格画的是朝上的那半段')
  assert.equal(edges(shown.units[0]).filter(unit => unit.hasArrow).length, 0, '开档时同一条边不是终端单元')
  // 缺省档 = 上游的出厂档（关）：不给 options 调 `buildLogGraph` 也和显式关档逐字一致。
  assert.deepEqual(buildLogGraph(far).rows.map(row => row.stub.length), closed.rows.map(row => row.stub.length),
    '缺省 = 长边隐藏（VcsLogUiPropertiesImpl.kt:121-122 的 isShowLongEdges = false）')
  // 跨度不到 30 行的边：关档也照常穿过中间行（阈值那一半的用户可见面）。
  const short = [commit('b1', ['b2', 'b9']), commit('b2', ['b3']), commit('b3', ['b9']), commit('b9', [])]
  const shortClosed = buildLogGraph(short, { showLongEdges: false })
  assert.equal(shortClosed.rows[1].pass.length, 1, '跨 3 行的边没到 30 行 ⇒ 关档也不截')
  assert.deepEqual(shortClosed.rows.map(row => row.stub.length), [0, 0, 0, 0], '一条终端竖线都不该有')
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

// ── 可合并段的判据 = 上游图算法本体（2026-10-06 vcsloge 批）────────────────────────
// 上游收的**不是**「单父 & 独子」那一种形状，而是 `LinearFragmentGenerator.getFragment`
// （`platform/vcs-log/graph/src/com/intellij/vcs/log/graph/collapsing/LinearFragmentGenerator.java:126-166`）
// 判出来的"前沿收窄回一条道"的那一坨：
//  · `:133` `grayNodes = 下一排`，`:138-143` 只有**子提交全都在这一段里**的那个下一排节点才能往里走一步；
//  · `:147-150` 下一排只剩一个且它合格 ⇒ 收窄完成，那一个就是这一段的另一端；
//  · `:152-153` 往里走的那个节点没有下游、或者它是 `myPinnedNodes`（分支尖）里的 ⇒ 整段作废；
//  · `:136` `while (blackNodes.size() < SHORT_FRAGMENT_MAX_SIZE)`，`SHORT_FRAGMENT_MAX_SIZE = 10`（`:23`）；
//  · `:99-124` `getLongFragment` 再朝上下两头一路扩到底（按钮那档 bound = `Integer.MAX_VALUE`），
//    扩不动时 `:121` 那句 `getNodes(up, DOWN).size() != 1` 才决定这一小段算不算；
//  · 中间那批 = `FragmentGenerator.getMiddleNodes(up, down, true)`（`FragmentGenerator.java:50-60`，
//    两端各走一遍取**交集**再摘掉两端），所以合并块**两侧的行都在中间**
//    —— 上游自带用例钉着这个形状：`platform/vcs-log/graph/test/com/intellij/vcs/log/graph/impl/FragmentGeneratorTest.kt:138-139`
//    `downTree.getMiddleNodes(0, 4) = "0,1,2,4"`、`upTree.getMiddleNodes(1, 5) = "1,3,4,5"`
//    （**订正留痕**：这里原先写 `:135-136` —— 那两行是 `class MiddleNodesTest {` 与 `simple` 那条，
//     `sed -n '133,144p'` 打开后 `withDownRedundantBranches` 在 `:138`、`withUpRedundantBranches` 在 `:139`；
//     另外上游那个 helper（`:29-31`）传的是 `strict = false` ⇒ 期望串里带着两端，
//     本仓 `middleNodes()` 走的是 `COLLAPSE_ALL` 那一档的 `strict = true`（`FragmentGenerator.java:56-57` 摘端点），
//     所以本仓**不**把 "0,1,2,4" 当成期望值，只借它钉"两侧都在中间"这一半形状）。
//  · `myPinnedNodes` 传的是 `permanentGraphInfo.getBranchNodeIds()`（`CollapsedActionManager.java:146-147`），
//    那份 id 出自带 `type.isBranch` 的引用（`VcsLogGraphDataFactory.kt:77` → `VcsLogRefsOfSingleRootFactory.kt:24-29`），
//    git 侧 `isBranch = true` 的三类 = HEAD / LOCAL_BRANCH / REMOTE_BRANCH（`GitRefManager.kt:271/275/278`），
//    TAG 与 OTHER 是 false（`GitRefManager.kt:281/284`）⇒ 标签不钉人。

const LOCAL_BRANCH = { name: 'feature', type: 'local' }
const REMOTE_BRANCH = { name: 'origin/feature', type: 'remote' }
const TAG_REF = { name: 'v1.0', type: 'tag' }

test('合并后又并回一条道的菱形也收：判据是"前沿收窄"，不是「单父 & 独子」', () => {
  // m1 ← p1 ← b1 ← p2，同时 m1 ← p2：两条道在 p2 上并回一条。
  assert.deepEqual(collapsedLinearSpans(merged), [{ from: 'm1', to: 'p2' }],
    'LinearFragmentGenerator.java:147-150 在这一排只剩 p2 时收到尾')
  assert.deepEqual([...collapsedLinearHashes(merged)].sort(), ['b1', 'p1'],
    '中间 = 两侧都算（getMiddleNodes 的交集，FragmentGenerator.java:50-60）')
  assert.equal(canCollapseLinearBranches(merged), true, '⇒ 上游那一行（Collapse Linear Branches）在这里是出现并可点的')
  const { visible, graph } = collapseLinearGraph(merged, true)
  assert.deepEqual(visible.map(item => item.hash), ['m1', 'p2'], '端点留在表上（strict 摘端点，FragmentGenerator.java:56-57）')
  const dashed = graph.rows[0].down.filter(edge => edge.style === 'dashed')
  assert.equal(dashed.length, 1, '跨度边照旧补上')
  assert.equal(graph.rows[0].down.length, 2,
    '真边 m1→p2 与跨度虚线**并存**：上游也是两条（CollapsedGraph.java:134-138 直接 createEdge，EdgeStorage.java:30-38 的 putValue 是多重表 ⇒ 不按端点对去重）')
})

test('收不拢的块不收：下一排有死路、或有子提交还在段外', () => {
  // ① 两个父提交都没有下游（Presentation 那边同一形状）⇒ `:153` 前半 nextGrayNodes.isEmpty()
  const deadEnd = [commit('m1', ['p1', 'p2']), commit('p1', []), commit('p2', [])]
  assert.deepEqual(collapsedLinearSpans(deadEnd), [], '死路 ⇒ 一段都不收')
  assert.equal(canCollapseLinearBranches(deadEnd), false)
  // ② p2 除了 m1 还有一个子提交 late 不在这一段里 ⇒ `:139` 的 containsAll(UP) 永远不成立
  //    （late 排在 p2 **之前**才是 `git log` 一页该有的顺序：父提交只会出现在子提交下面）
  const outsideChild = [
    commit('m1', ['p1', 'p2']), commit('p1', ['bottom']),
    commit('late', ['p2']), commit('p2', ['bottom']), commit('bottom', []),
  ]
  assert.deepEqual(collapsedLinearSpans(outsideChild), [],
    '子提交在段外 ⇒ 前沿收不窄（LinearFragmentGenerator.java:139 + :145 nextBlackNode == -1）')
  assert.equal(linearFragmentAt(outsideChild, 'm1'), undefined, '点它也不动')
})

test('被分支引用钉住的提交进不了中间：HEAD/本地/远端都算，标签不算', () => {
  const straight = [commit('h1', ['h2']), commit('h2', ['h3']), commit('h3', ['h4']), commit('h4', [])]
  for (const pin of [LOCAL_BRANCH, REMOTE_BRANCH, HEAD]) {
    const pinned = [straight[0], commit('h2', ['h3'], [pin]), straight[2], straight[3]]
    assert.deepEqual([...collapsedLinearHashes(pinned)], ['h3'],
      `${pin.type} 引用把 h2 钉住 ⇒ 它不进中间（:153 thisNodeCantBeInMiddle），只收起它下面那一个`)
    assert.deepEqual(collapsedLinearSpans(pinned), [{ from: 'h2', to: 'h4' }],
      '尖自己留在表上，段从它**下面**起（:105 的 `!myPinnedNodes.contains(maxDown)` 同一判据）')
  }
  assert.deepEqual([...collapsedLinearHashes([straight[0], commit('h2', ['h3'], [TAG_REF]), straight[2], straight[3]])],
    ['h2', 'h3'], 'GitRefManager.kt:281 TAG 的 isBranch = false ⇒ 标签不钉人，照收')
  assert.deepEqual(collapsedLinearSpans([commit('h1', ['h2'], [LOCAL_BRANCH]), ...straight.slice(1)]),
    [{ from: 'h1', to: 'h4' }], '钉住的行当**端点**是可以的（中间才受限）')
})

test('上游那道界：并排 8 条道收得着，9 条就收不着（SHORT_FRAGMENT_MAX_SIZE = 10）', () => {
  const wide = size => {
    const list = [commit('top', Array.from({ length: size }, (_, index) => `s${index}`))]
    for (let index = 0; index < size; index++) list.push(commit(`s${index}`, ['bottom']))
    list.push(commit('bottom', []))
    return list
  }
  assert.deepEqual([...collapsedLinearHashes(wide(8))].sort(),
    ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7'], 'black 走到 9 还没出界 ⇒ 仍然收窄到 bottom')
  assert.deepEqual(collapsedLinearSpans(wide(9)), [], 'black 满 10 就放弃这一段（:136 + :23）')
  assert.deepEqual(collapsedLinearSpans(wide(10)), [])
  // 展开那一趟不受这道界约束（bound = Integer.MAX_VALUE）⇒ 直链多长都一路收到底
  const long = Array.from({ length: 30 }, (_, index) => commit(`L${index}`, index === 29 ? [] : [`L${index + 1}`]))
  assert.deepEqual(collapsedLinearSpans(long), [{ from: 'L0', to: 'L29' }])
  assert.equal(collapsedLinearHashes(long).size, 28, '30 行只留两端')
})

test('菱形也支持"点一次只动那一条"（同一份段集合，不按形状特判）', () => {
  const once = clickLinearFragment(merged, [], 'b1')
  assert.deepEqual(once, [{ from: 'm1', to: 'p2' }], '点中间那一行的图形也命中这一段')
  assert.deepEqual(clickLinearFragment(merged, once, 'p2'), [], '再点端点 = 展回')
  assert.deepEqual([...clickableLinearHashes(merged, [])].sort(), ['b1', 'm1', 'p1', 'p2'],
    '收起之前整段四个节点都响应点击（clickableLinearHashes 吃的就是这份段集合）')
  assert.deepEqual([...clickableLinearHashes(merged, once)].sort(), ['m1', 'p2'], '收起了就只剩两端')
})

// ── 三条补判据（2026-10-06 vcsloge 收尾复核时补：都是"能失败"的形状，不是复述实现）──────
// 差分口径：另写了一份**忠实照抄上游** `LinearFragmentGenerator` + `CollapsedActionManager.COLLAPSE_ALL`
// 的参考实现（本仓不留文件，跑在临时目录），对 8000 份随机拓扑（4–11 行、含随机钉住的分支尖）
// 比 `collapsedLinearSpans` 与 `collapsedLinearHashes` ⇒ **0 分歧**。下面三条钉的是差分里"随机样本恰好没覆盖到"
// 的三种形状，缺一条就有一段实现没有判据兜着。

test('合并块后面紧跟死路：段在"往里走那一步空了"的那一行停住（LinearFragmentGenerator.java:152-153 前半）', () => {
  // s 有两条道（a、b），在 E 并回一条 ⇒ 收窄成立；E 自己又分两条道，其中 F 没有任何下游
  // ⇒ 从 E 再往里走时 `nextGrayNodes.isEmpty()` ⇒ 整段就停在 E，**不是**一路穿到 F/G。
  const deadStop = [commit('s', ['a', 'b']), commit('a', ['E']), commit('b', ['E']),
    commit('E', ['F', 'G']), commit('F', []), commit('G', [])]
  assert.deepEqual(collapsedLinearSpans(deadStop), [{ from: 's', to: 'E' }],
    '段的两端 = s 与 E（:147-150 在 E 那一排收窄；:152-153 把再往里走那一步否掉）')
  assert.deepEqual([...collapsedLinearHashes(deadStop)], ['a', 'b'],
    '中间 = a、b 两侧都收（getMiddleNodes 的交集，FragmentGenerator.java:50-54）')
  assert.deepEqual(collapseLinearGraph(deadStop, true).visible.map(item => item.hash), ['s', 'E', 'F', 'G'],
    'E 是端点 ⇒ 留在表上，它下面那两条道一行都不动')
  assert.deepEqual(linearFragmentAt(deadStop, 'a'), { from: 's', to: 'E' }, '点中间那一行归到这一段')
  assert.deepEqual(clickLinearFragment(deadStop, [], 'a'), [{ from: 's', to: 'E' }])
})

test('倒挂的父提交不当边：本仓 pageTopology 跳过它，正常那条链照样收（不凭空造边）', () => {
  // q2 的父 q1 排在 q2 **上面**（`git log` 的一页里不该有这种顺序，宿主真给出来了也不能当拓扑用）。
  const inverted = [commit('q1', ['q2']), commit('q2', ['q1']), commit('q3', ['q4']), commit('q4', ['q5']), commit('q5', [])]
  assert.deepEqual(collapsedLinearSpans(inverted), [{ from: 'q3', to: 'q5' }],
    '倒挂那一对没段（它连边都不算），q3→q4→q5 这一段照收')
  assert.deepEqual([...collapsedLinearHashes(inverted)], ['q4'])
  const graph = buildLogGraph(inverted)
  assert.deepEqual(graph.rows.map(row => row.down.length), [1, 0, 1, 1, 0],
    'q1→q2 是正常边（row0.down 一条）；q2→q1 倒挂 ⇒ row1 一条出边都不给')
  assert.deepEqual(graph.rows.map(row => row.up.length), [0, 1, 0, 1, 1],
    'q2 从上一行接进来；q1 那一行**没有**"从下一行接上来"的那一半（上游可见图里没有反向边）')
  assert.deepEqual(graph.rows.map(row => row.stub.length), [0, 0, 0, 0, 0], '倒挂边不该被算成"跨 30 行的长边"')
  assert.deepEqual(linearFragmentAt(inverted, 'q2'), undefined, '点那一行不落到任何段 ⇒ 组件不给手形光标')
})

test('布尔档收着时点一次 = 只展那一条链（其余仍收起；上游 LINEAR_EXPAND_CASE 只摘那一条 DOTTED 边）', () => {
  // 两条互不相干的链 + 中间一条分叉，`state = true` = 菜单里「收起线性分支」那一条按下去的样子。
  const all = [
    commit('h1', ['h2']), commit('h2', ['h3']), commit('h3', ['h4']), commit('h4', []),
    commit('g1', ['t1', 'x1']), commit('x1', []),
    commit('t1', ['t2']), commit('t2', ['t3']), commit('t3', ['t4']), commit('t4', []),
  ]
  assert.deepEqual(activeLinearSpans(all, true), [{ from: 'h1', to: 'h4' }, { from: 't1', to: 't4' }],
    '布尔档 = 本页全部段都收（CollapsedActionManager.java:221-233 那一趟）')
  const one = clickLinearFragment(all, true, 'h1')
  assert.deepEqual(one, [{ from: 't1', to: 't4' }], '点 h 链的端点只把**那一条**摘掉（:259-265 showNode + removeEdge）')
  assert.deepEqual(collapseLinearGraph(all, one).visible.map(item => item.hash),
    ['h1', 'h2', 'h3', 'h4', 'g1', 'x1', 't1', 't4'], '⇒ h 那两条中间行回来了，t 那两条还收着')
  assert.deepEqual(clickLinearFragment(all, true, 'h2'), undefined,
    '点已经收着的链的**中间行**：那一行根本不在表上，本仓也不重复记一条（与 :404 那句同一口径）')
  assert.deepEqual([...clickableLinearHashes(all, true)], ['h1', 'h4', 't1', 't4'],
    '布尔档下只有四条端点给手形光标（MOUSE_OVER 那档对隐藏行没有意义）')
  // 收回去：点 t 链的端点也只剩 h 那条
  assert.deepEqual(clickLinearFragment(all, one, 't4'), [], '两条都点开 = 空集合 = 全展开')
})

test('分页加载后点收的那一条不自己弹回（上游把折叠态记在图上、按节点 id 带过新拓扑）', () => {
  // 第一页只有 h1..h4（h4 的父 h5 还在页外）⇒ 点一次 h1 的图形收到 {h1,h4}。
  const page1 = [commit('h1', ['h2']), commit('h2', ['h3']), commit('h3', ['h4']), commit('h4', ['h5'])]
  const saved = clickLinearFragment(page1, [], 'h1')
  assert.deepEqual(saved, [{ from: 'h1', to: 'h4' }], '第一页上这一段的两端 = h1 与 h4')
  assert.deepEqual(collapseLinearGraph(page1, saved).visible.map(item => item.hash), ['h1', 'h4'])
  // 再往下加载：h5 / h6 进来 ⇒ 上游算法现在会把这一段算成 {h1,h6}（更长）。
  const loaded = [...page1, commit('h5', ['h6']), commit('h6', [])]
  assert.deepEqual(collapsedLinearSpans(loaded), [{ from: 'h1', to: 'h6' }], '段本身确实变长了（不是夹具没生效）')
  // 但**已经收着的那一条不会因为变长而弹回**：`CollapsedGraph.updateInstance`
  // （platform/vcs-log/graph/src/com/intellij/vcs/log/graph/collapsing/CollapsedGraph.java:26-29）
  // 换图时带走的是 `getNodeVisibilityById()`（按节点 id）与 `myEdgeStorage`（那条 DOTTED 边），不是重算段表。
  assert.deepEqual(activeLinearSpans(loaded, saved), [{ from: 'h1', to: 'h4' }],
    '两端都还在本页 ⇒ 这条跨度仍然算（收尾复核前这里写的是"与原样算出的段匹配才留"⇒ 会自己展回去）')
  assert.deepEqual([...collapsedLinearHashes(loaded, saved)], ['h2', 'h3'],
    '中间按两端现算（getMiddleNodes(up, down, true)，FragmentGenerator.java:50-60）⇒ 只收 h2/h3，新来的 h5/h6 不动')
  const { visible, graph } = collapseLinearGraph(loaded, saved)
  assert.deepEqual(visible.map(item => item.hash), ['h1', 'h4', 'h5', 'h6'], '新加载的两行照旧可见')
  assert.deepEqual(graph.rows[0].down.filter(edge => edge.style === 'dashed').length, 1,
    'h1 那一行仍然接住那条虚线（两端都还在可见行上，EdgeStorage 里的附加边没丢）')
  assert.deepEqual(clickLinearFragment(loaded, saved, 'h4'), [], '点尾端 = 把那一条展回来（其余照旧）')
  assert.deepEqual([...clickableLinearHashes(loaded, saved)].sort(), ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    '已收的那条只剩两端可点；还没收的那一段（h1..h6）整段都还响应点击')
})
