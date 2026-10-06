// 提交图的**行内图形单元**（每行的列 + 单元类型）与折叠显示档的求值都在这一个模块里。
// 接线状态（2026-10-06 vcslog3 批已接）：`src/components/VcsLogTable.vue` 折叠走 `collapseLinearGraph()`
// （折叠跨度在图里 ⇒ 两端之间那条虚线边不再丢），渲染走 `graph.units`（经 `src/vcsLogGraphRender.ts`
// 把单元翻译成线/圆）。形状判据在 `tests/vcs-log-graph-cells.test.mjs`，渲染判据在
// `tests/vcs-log-graph-render.test.mjs`。
import type { GitFullCommit } from './bridge'

const palette = ['#4FC1E9', '#A0D468', '#FFCE54', '#FC6E51', '#ED5565', '#AC92EC', '#48CFAD', '#EC87C0', '#5D9CEC', '#E8636F']
export const ROW_H = 26
const LANE_W = 14
export const laneX = (lane: number) => lane * LANE_W + LANE_W / 2
export const lanePath = (from: number, to: number) =>
  `M ${laneX(from)} ${ROW_H / 2} C ${laneX(from)} ${ROW_H * 0.75} ${laneX(to)} ${ROW_H * 0.75} ${laneX(to)} ${ROW_H}`
export function rootColor(root: string): string {
  let hash = 0
  for (let i = 0; i < root.length; i++) hash = ((hash << 5) - hash + root.charCodeAt(i)) | 0
  return palette[Math.abs(hash) % palette.length]!
}
/** 一条边的线型；缺省 = `solid`（上游 `GraphEdgeType.USUAL` ⇒ `LineStyle.SOLID`，`EdgePrintElementImpl.kt:45`）。 */
export interface GraphLineStyleUnit { style?: GraphLineStyle }

export interface GraphRow {
  commit: GitFullCommit
  lane: number
  color: string
  down: Array<{ from: number; to: number; color: string } & GraphLineStyleUnit>
  /** 跨行的**长边**在起点那一行只画一段竖线（`SHOW_LONG_EDGES` 关掉时用它代替弯线）。 */
  stub: Array<{ lane: number; color: string } & GraphLineStyleUnit>
  /**
   * 从上一行接进来的边。`above` = 这条边在**上一行**占的那一车道，往上一行取列就用它：
   * 上一行正是这条边的起点行时给的是**起点车道**（那一行里这条边不占自己的元素位，上游
   * `createEndPositionFunction` 查不到这条边就退到那个节点的列，
   * `platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/print/PrintElementGeneratorImpl.kt:183-187`），
   * 否则给的是它自己在上一行的车道。两行各按自己那一行的列密排编号，只有上下两段引用**同一对列**
   * 才能在格边界上接得上（画师 `platform/vcs-log/impl/src/com/intellij/vcs/log/paint/SimpleGraphCellPainter.kt:163-169`
   * 那句 "paint non-vertical lines twice the size to make them dock with each other well"）。
   */
  up: Array<{ lane: number; above: number; color: string } & GraphLineStyleUnit>
  /** 穿过这一行的边（同样带 `above`，理由见 `up`）。 */
  pass: Array<{ lane: number; above: number; color: string } & GraphLineStyleUnit>
}

/**
 * 一格里线条的样式。上游是 `EdgePrintElement.LineStyle` 的三档 SOLID / DASHED / DOTTED
 * （`platform/vcs-log/graph-api/src/com/intellij/vcs/log/graph/EdgePrintElement.kt:16-20`），
 * 但**生成侧只产两档**：`convertToLineStyle` 把 `USUAL`/`NOT_LOAD_COMMIT` 归成 SOLID、
 * 把 `DOTTED`/`DOTTED_ARROW_UP`/`DOTTED_ARROW_DOWN` 归成 DASHED
 * （`platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/print/elements/EdgePrintElementImpl.kt:43-48`），
 * DOTTED 那一档没有任何生产者 ⇒ 本仓不列它，免得开一个永远不成立的显示档。
 */
export type GraphLineStyle = 'solid' | 'dashed'

/**
 * 节点那一格的画法。上游 `NodePrintElement.Type` = FILL / OUTLINE / OUTLINE_AND_FILL
 * （`platform/vcs-log/graph-api/src/com/intellij/vcs/log/graph/NodePrintElement.java:14-16`，默认 FILL `:8-11`），
 * 画师三档都画得出来（`platform/vcs-log/impl/src/com/intellij/vcs/log/paint/SimpleGraphCellPainter.kt:179-186`），
 * 但 OUTLINE 在这个树里同样只有画师那一条分支、没有生成者 ⇒ 只留真存在的两档：
 * 带 `HEAD` 引用的那一行才是 OUTLINE_AND_FILL（`platform/vcs-log/impl/src/com/intellij/vcs/log/ui/table/GraphTableModel.kt:105-108` 按 `refs.name == HEAD` 判定）。
 */
export type GraphNodeShape = 'fill' | 'outlineAndFill'

export interface GraphEdgeUnit {
  kind: 'edge'
  /** 上游 `EdgePrintElement.Type`（`platform/vcs-log/graph-api/src/com/intellij/vcs/log/graph/EdgePrintElement.kt:11-14`）：UP = 往上一行接，DOWN = 往下一行接。 */
  direction: 'up' | 'down'
  /** `PrintElement.positionInCurrentRow`（`platform/vcs-log/graph-api/src/com/intellij/vcs/log/graph/PrintElement.kt:9`）：这一格里的那一**列**。 */
  position: number
  /** `EdgePrintElement.positionInOtherRow`（`platform/vcs-log/graph-api/src/com/intellij/vcs/log/graph/EdgePrintElement.kt:5`）：邻行里的落点列；两列相等 ⇒ 竖线（画师 `platform/vcs-log/impl/src/com/intellij/vcs/log/paint/SimpleGraphCellPainter.kt:158-161`）。 */
  otherPosition: number
  style: GraphLineStyle
  /** 上游 `EdgePrintElement.hasArrow()`（`platform/vcs-log/graph-api/src/com/intellij/vcs/log/graph/EdgePrintElement.kt:9`）：终端箭头。真身 = `TerminalEdgePrintElement`，它把两列写成同一个值（`platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/print/elements/TerminalEdgePrintElement.java:16`）。 */
  hasArrow: boolean
  color: string
}

export interface GraphNodeUnit {
  kind: 'node'
  position: number
  shape: GraphNodeShape
  color: string
}

/** 一格图形 = 一个上游 PrintElement（`graph-api/.../PrintElement.kt:7-12` 是共同的四件套：行、列、颜色、是否选中）。 */
export type GraphUnit = GraphEdgeUnit | GraphNodeUnit

/** 折叠链的两端（上游 `CollapsedActionManager.java:231` 那条 `GraphEdgeType.DOTTED` 的附加边）。 */
export interface CollapsedSpan { from: string; to: string }

export interface GraphOptions {
  /**
   * `MainVcsLogUiProperties.SHOW_LONG_EDGES`（`impl/src/com/intellij/vcs/log/impl/MainVcsLogUiProperties.java:16`，
   * 缺省开：`VcsLogApplicationSettings.kt` 的 State 里没这一项 ⇒ 用 `VcsLogUiPropertiesImpl.kt:33` 的默认值，
   * 而 `ShowLongEdgesAction` 是个纯勾选动作，勾上=显示）。
   * 关掉的可见差别（文案 `action.Vcs.Log.ShowLongEdges.description` = 即使提交在当前视图中不可见，也显示长分支边）：
   * 目标行不在紧邻下一行的边**不再穿过中间那些行**，只在起点那一行留一段竖线，
   * 到了目标行再从上边接进来 —— 中间没有该分支的提交时，那一条竖线就是没有意义的长线。
   */
  showLongEdges?: boolean
  /**
   * 折叠链两端之间那条**虚线边**（`collapsedLinearSpans()` 的产物）。
   * 上游 `COLLAPSE_ALL` 在收起中间节点的同时 `createEdge(new GraphEdge(up, down, null, GraphEdgeType.DOTTED))`
   * （`platform/vcs-log/graph/src/com/intellij/vcs/log/graph/collapsing/CollapsedActionManager.java:231`），
   * 而 `DOTTED` 是**普通边**（`platform/vcs-log/graph/src/com/intellij/vcs/log/graph/api/elements/GraphEdgeType.java:20` 的 `DOTTED(true)`）
   * ⇒ 它照常穿过中间每一行，只是线型走 `LineStyle.DASHED`（`EdgePrintElementImpl.kt:46`）。
   * 没有这一条时本仓折叠后是**两段互不相连的行**（原写"端点之间留一条同车道的竖线"，实际代码里那条边整个被丢了：
   * 隐藏提交的哈希不在可见列表里 ⇒ `rowOf.get(parent)` 取不到 ⇒ 边不生成）。
   */
  collapsedSpans?: readonly CollapsedSpan[]
  /**
   * 「按图谱显示」这一档的开关（本仓不新增勾选，它由**数据**决定，与上游同一口径）：
   * 上游在拿不到图信息的那份 pack 上直接不给任何图形单元 —— `GraphTableModel.getPrintElements`
   * 判 `VisiblePack.NO_GRAPH_INFORMATION` 为真就返回 `emptyList()`（`platform/vcs-log/impl/src/com/intellij/vcs/log/ui/table/GraphTableModel.kt:97-100`，
   * 键定义 `platform/vcs-log/impl/src/com/intellij/vcs/log/visible/VisiblePack.kt:80`，
   * 置位处 `platform/vcs-log/impl/src/com/intellij/vcs/log/history/FileHistoryFilterer.kt:243`）⇒ 图格里一格都不画。
   * 缺省 true（日志面本来就有父子拓扑）。
   */
  graphInformation?: boolean
}

// Preserve the existing child-before-parent graph; missing parents are not invented.
export function buildLogGraph(list: GitFullCommit[], options: GraphOptions = {}) {
  const showLongEdges = options.showLongEdges !== false
  if (!list.length) return { rows: [] as GraphRow[], width: 0, units: [] as GraphUnit[][] }
  const rowOf = new Map<string, number>()
  list.forEach((commit, index) => { if (!rowOf.has(commit.hash)) rowOf.set(commit.hash, index) })
  const laneOf = new Map<string, number>()
  const lanes: Array<string | null> = []
  const claimLane = (hash: string) => {
    const existing = laneOf.get(hash)
    if (existing !== undefined) return existing
    const free = lanes.indexOf(null)
    const lane = free >= 0 ? free : lanes.push(null) - 1
    laneOf.set(hash, lane)
    return lane
  }
  const rows: GraphRow[] = []
  const edges: Array<{ from: number; to: number; fromRow: number; targetRow: number; color: string; style: GraphLineStyle }> = []
  list.forEach((commit, index) => {
    const lane = claimLane(commit.hash)
    lanes[lane] = null
    for (const parent of commit.parents) {
      const targetRow = rowOf.get(parent)
      if (targetRow === undefined || targetRow <= index) continue
      const parentLane = claimLane(parent)
      lanes[parentLane] = parent
      edges.push({ from: lane, to: parentLane, fromRow: index, targetRow, color: rootColor(parent), style: 'solid' })
    }
    rows.push({ commit, lane, color: rootColor(commit.hash), down: [], stub: [], up: [], pass: [] })
  })
  // 折叠链的那条虚线边：两端都还在可见行上才连（上游也是只在可见图里加边 ——
  // `CollapsedActionManager.java:186` 的 `hideNode` + `:187`/`:231` 的 `createEdge` 是同一次修改里做的）。
  // 它按普通边参与穿行走廊（`GraphEdgeType.java:20` 的 `DOTTED(true)` = isNormalEdge），只是线型 DASHED。
  for (const span of options.collapsedSpans ?? []) {
    const fromRow = rowOf.get(span.from)
    const targetRow = rowOf.get(span.to)
    if (fromRow === undefined || targetRow === undefined || targetRow <= fromRow) continue
    edges.push({ from: claimLane(span.from), to: claimLane(span.to), fromRow, targetRow,
      color: rootColor(span.to), style: 'dashed' })
  }
  for (const edge of edges) {
    // 长边 = 目标行不是紧邻的下一行（中间那些行没有这条分支上的提交）。
    const long = edge.targetRow > edge.fromRow + 1
    if (long && !showLongEdges) {
      // 起点那一行只留一段竖线（本车道往下到底），中间不穿、目标行不再从上边接。
      rows[edge.fromRow]?.stub.push({ lane: edge.from, color: edge.color, style: edge.style })
      continue
    }
    rows[edge.fromRow]?.down.push({ from: edge.from, to: edge.to, color: edge.color, style: edge.style })
    // 上一行占的那一车道：紧邻上一行就是起点行 ⇒ 起点车道（那一行里这条边跟着节点走）；否则 ⇒ 它自己的车道。
    const aboveLane = (row: number) => (edge.fromRow === row - 1 ? edge.from : edge.to)
    rows[edge.targetRow]?.up.push({ lane: edge.to, above: aboveLane(edge.targetRow), color: edge.color, style: edge.style })
    for (let row = edge.fromRow + 1; row < edge.targetRow; row++) {
      rows[row]?.pass.push({ lane: edge.to, above: aboveLane(row), color: edge.color, style: edge.style })
    }
  }
  let laneCount = 1
  for (const row of rows) laneCount = Math.max(laneCount, row.lane + 1)
  for (const edge of edges) laneCount = Math.max(laneCount, edge.to + 1)
  return { rows, width: laneCount * LANE_W, units: graphUnitsOfRows(rows, options.graphInformation !== false) }
}

/** 一行里出现过的车道（= 上游那一行的可见元素集合，`impl/print/PrintElementGeneratorImpl.kt:246-268`：节点 + 穿过这一行的边）。 */
function rowLanes(row: GraphRow): number[] {
  const found = new Set<number>([row.lane])
  for (const edge of row.down) { found.add(edge.from); found.add(edge.to) }
  for (const edge of row.up) found.add(edge.lane)
  for (const edge of row.pass) found.add(edge.lane)
  for (const edge of row.stub) found.add(edge.lane)
  return [...found].sort((a, b) => a - b)
}

/**
 * 每行的**图形单元**（上游 `PrintElementGenerator.getPrintElements` 的本仓等价物，
 * `platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/print/PrintElementGeneratorImpl.kt:126-173`）。
 *
 * 三件要紧的事都照上游：
 *  · **列是按行现排的**（`positionInCurrentRow` 来自 `getSortedVisibleElementsInRow` 的下标，`:134` 的
 *   `visibleElements.forEachIndexed { position, element ->`），不是全局车道号 ⇒ 同一分支在两行里可能落到不同列。
 *  · 弯线由 `positionInOtherRow` 表达：`createEndPositionFunction` 去**邻行**的元素表里找同一条边的位置
 *   （`:175-190`），找不到就退回端点节点的位置（`:185-187`）⇒ 本仓同样"邻行取列、取不到用本行列"。
 *  · 节点排在**最后**（`:128` 的注释 "nodes at the end, to be drawn over the edges" 与 `:171` 的 `result.addAll(nodes)）
 *   ⇒ 消费侧按数组顺序画就是"线在下、点在上"。
 *
 * `graphInformation` 为假时每行给空数组 —— 上游 `GraphTableModel.kt:97-100` 在 `NO_GRAPH_INFORMATION` 下
 * 就是 `emptyList()`，图格里一格都不画。
 */
export function graphUnitsOfRows(rows: readonly GraphRow[], graphInformation = true): GraphUnit[][] {
  if (!graphInformation) return rows.map(() => [])
  const columns = rows.map(rowLanes)
  const indexOf = (lanes: number[] | undefined, lane: number): number => (lanes ? lanes.indexOf(lane) : -1)
  return rows.map((row, index) => {
    const own = columns[index]!
    const prev = columns[index - 1]
    const next = columns[index + 1]
    const units: GraphUnit[] = []
    // 同一格里的重复单元只出一份：上游是"每个图元素占一列"（`impl/print/PrintElementGeneratorImpl.kt:134`），
    // 本仓的车道按**哈希**分配 ⇒ 两条并到同一父车道的边（例：合并提交与它那条旁支边同时进 p2）会落在同一列、
    // 同一颜色、同一落点 —— 画两次只会加深那一条线，所以合并成一条。
    const emitted = new Set<string>()
    const position = (lane: number) => { const at = indexOf(own, lane); return at < 0 ? 0 : at }
    const pushEdge = (direction: 'up' | 'down', lane: number, otherLane: number,
      otherColumns: number[] | undefined, style: GraphLineStyle, hasArrow: boolean, color: string) => {
      const at = position(lane)
      // 邻行取不到这一列 ⇒ 终端单元：两列同一个值（`platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/print/elements/TerminalEdgePrintElement.java:16` 就是这么传的）。
      const otherAt = indexOf(otherColumns, otherLane)
      const unit: GraphEdgeUnit = { kind: 'edge', direction, position: at, otherPosition: otherAt < 0 ? at : otherAt,
        style, hasArrow, color }
      const key = `${unit.direction}|${unit.position}|${unit.otherPosition}|${unit.style}|${unit.hasArrow}|${unit.color}`
      if (emitted.has(key)) return
      emitted.add(key)
      units.push(unit)
    }
    // 穿行的那条边在本行要发**上下两段**（上游同一支边在同一行里 DOWN 与 UP 各 add 一次，
    // `platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/print/PrintElementGeneratorImpl.kt:151-168`
    // 的 `if (down != null)` 与 `if (up != null)` 两个分支），画师按 `type` 只画自己那一半
    // （`platform/vcs-log/impl/src/com/intellij/vcs/log/paint/SimpleGraphCellPainter.kt:158-168`）。
    // 原写「pass 只发 DOWN 一个单元」—— 少了上半段那一半 ⇒ 按 units 渲染时长边的中间行只有下半截（梳齿）。
    for (const edge of row.pass) {
      pushEdge('down', edge.lane, edge.lane, next, edge.style ?? 'solid', false, edge.color)
      pushEdge('up', edge.lane, edge.above, prev, edge.style ?? 'solid', false, edge.color)
    }
    for (const edge of row.down) pushEdge('down', edge.from, edge.to, next, edge.style ?? 'solid', false, edge.color)
    for (const edge of row.up) pushEdge('up', edge.lane, edge.above, prev, edge.style ?? 'solid', false, edge.color)
    for (const edge of row.stub) pushEdge('down', edge.lane, edge.lane, undefined, edge.style ?? 'solid', true, edge.color)
    units.sort((a, b) => a.position - b.position)
    // HEAD 那一行的节点是 OUTLINE_AND_FILL（`GraphTableModel.kt:105` 判引用名 == HEAD，`:108` 换成头节点单元）。
    const isHead = row.commit.refs?.some(ref => ref.name === 'HEAD') === true
    units.push({ kind: 'node', position: position(row.lane), shape: isHead ? 'outlineAndFill' : 'fill', color: row.color })
    return units
  })
}
export function logDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/**
 * 「收起 / 展开线性分支」—— 上游 `Vcs.Log.CollapseAll` / `Vcs.Log.ExpandAll`
 * （`platform/vcs-log/impl/src/com/intellij/vcs/log/ui/actions/CollapseGraphAction.java:11-32`、
 * `ExpandGraphAction.java:11-32`（原写 `:13-38`；两文件真身各 33 行，类体都是 11-32 ⇒ 38 行越界），
 * 共同父类 `CollapseOrExpandGraphAction.java:44-47`；
 * 真正的动作体在 `platform/vcs-log/graph/src/com/intellij/vcs/log/graph/collapsing/CollapsedActionManager.java`
 * 的 `COLLAPSE_ALL:214-241` 与 `EXPAND_ALL:200-210`）。
 *
 * 上游那一段做的事（逐行读的结论，不是"IDEA 一般是这样"）：
 *  · `COLLAPSE_ALL` 对每个**当前可见**的节点取 `linearFragmentGenerator.getLongDownFragment(nodeIndex)`
 *   （`LinearFragmentGenerator.java:86` —— `getLongFragment(getDownFragment(…), Integer.MAX_VALUE)`，
 *    也就是把「单父 & 独子」的小段一路串到底，按钮那一档不设长度上限），
 *  · 然后 `modification.hideNode(middleNode)` 把**中间那些节点藏起来**，
 *    并 `createEdge(… GraphEdgeType.DOTTED)` 在两端之间补一条**虚线边**（`:183-187`）；
 *  · `EXPAND_ALL` 就是 `resetNodesVisibility()` + `removeAdditionalEdges()`（`:202-205`）。
 * 文案：`action.title.collapse.linear.branches` = 收起线性分支 / `action.title.expand.linear.branches` = 展开线性分支
 * （随 IDE 发货的中文包 `messages/VcsLogBundle.properties`；英文原文 = Collapse/Expand Linear Branches）。
 *
 * 本仓的等价物：图是 `buildLogGraph` 对**已加载那一页**的一次性绘制，没有 BEK 折叠层，
 * 所以"隐藏中间节点"落在列表上 —— 折叠后把剩下的行交给 `buildLogGraph` 重算车道，
 * 端点之间那条"跨行的边"由 `collapsedLinearSpans()` + `GraphOptions.collapsedSpans` 生成，线型 dashed。
 * （原写"本仓用同一车道穿过中间行的竖线表示" —— 与代码不符：中间提交被过滤掉之后父哈希不在可见列表里，
 * `rowOf.get(parent)` 取不到 ⇒ 那条边整个被丢，折叠后是两段互不相连的行。实测见
 * `tests/vcs-log-graph-cells.test.mjs` 里"折叠必须连上虚线"那一条。）
 * 一条**线性段** = 恰好一个父提交、且那个父提交在**本页里**也只有这一个子提交；
 * 把这样的相邻段一路串起来，长度 ≥ 3 时中间那些提交被收起（首尾保留 ⇒ 端点还能连上）。
 */

/** 提交哈希 → 本页里以它为唯一父提交的提交数（算"独子"用）。 */
function childCounts(list: readonly GitFullCommit[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const commit of list) {
    if (commit.parents.length !== 1) continue
    const parent = commit.parents[0]!
    counts.set(parent, (counts.get(parent) ?? 0) + 1)
  }
  return counts
}

/** 被收起的那些提交的哈希（每段线性链的中间节点；首尾不动）。 */
export function collapsedLinearHashes(list: readonly GitFullCommit[]): Set<string> {
  const hidden = new Set<string>()
  for (const chain of linearChains(list)) {
    for (const index of chain.slice(1, -1)) { const hash = list[index]?.hash; if (hash) hidden.add(hash) }
  }
  return hidden
}

/** 折叠链的两端：`from` = 链首（较新的那个提交），`to` = 链尾（较旧的那个）。 */
export function collapsedLinearSpans(list: readonly GitFullCommit[]): CollapsedSpan[] {
  const spans: CollapsedSpan[] = []
  for (const chain of linearChains(list)) {
    const from = list[chain[0]!]?.hash
    const to = list[chain[chain.length - 1]!]?.hash
    if (from && to) spans.push({ from, to })
  }
  return spans
}

/** 有没有可收起的东西（上游 `CollapseOrExpandGraphAction.update` 的 `isActionSupported(BUTTON_COLLAPSE)`）。 */
export function canCollapseLinearBranches(list: readonly GitFullCommit[]): boolean {
  return collapsedLinearHashes(list).size > 0
}

/** 折叠态下的可见提交列表（`collapsed` 为假时逐字返回原列表）。 */
export function collapseLinearBranches(list: readonly GitFullCommit[], collapsed: boolean): GitFullCommit[] {
  if (!collapsed) return [...list]
  const hidden = collapsedLinearHashes(list)
  return hidden.size ? list.filter(commit => !hidden.has(commit.hash)) : [...list]
}

/**
 * 折叠态的**一次成型**出口：可见列表 + 已经连上虚线的图。
 * `VcsLogTable.vue` 的 `folded` / `graph` 两个 computed 吃的就是这一个调用 —— 分成两步
 * （先 `collapseLinearBranches` 再 `buildLogGraph`）丢的就是上游那条 DOTTED 边：中间提交被过滤掉 ⇒
 * 父哈希不在可见行里 ⇒ 边根本不生成。落地的渲染侧判据在 `tests/vcs-log-graph-render.test.mjs`。
 */
export function collapseLinearGraph(list: readonly GitFullCommit[], collapsed: boolean, options: GraphOptions = {}) {
  const visible = collapseLinearBranches(list, collapsed)
  const spans = collapsedLinearSpans(list)
  return { visible, graph: buildLogGraph(visible, { ...options, collapsedSpans: collapsed ? spans : [] }) }
}

/** 本仓的线性链 = 上游 `getLongDownFragment` 的对应物（`LinearFragmentGenerator.java:86`，见上面的注释）：
 *  「单父 & 独子」一路串到底，长度 ≥ 3 才算（首尾要留着当虚线的两端）。 */
function linearChains(list: readonly GitFullCommit[]): number[][] {
  const position = new Map<string, number>()
  list.forEach((commit, index) => { if (!position.has(commit.hash)) position.set(commit.hash, index) })
  const children = childCounts(list)
  // 线性段的下一跳：单父 + 那个父提交在本页里只有我这一个子提交 + 它在更靠后的行上。
  const nextOf = (index: number): number | undefined => {
    const commit = list[index]!
    if (commit.parents.length !== 1) return undefined
    const parent = commit.parents[0]!
    if ((children.get(parent) ?? 0) !== 1) return undefined
    const target = position.get(parent)
    return target !== undefined && target > index ? target : undefined
  }
  const chains: number[][] = []
  const visited = new Set<number>()
  for (let start = 0; start < list.length; start++) {
    if (visited.has(start)) continue
    const chain: number[] = [start]
    visited.add(start)
    let cursor = start
    for (;;) {
      const next = nextOf(cursor)
      if (next === undefined || visited.has(next)) break
      chain.push(next)
      visited.add(next)
      cursor = next
    }
    if (chain.length >= 3) chains.push(chain)
  }
  return chains
}
