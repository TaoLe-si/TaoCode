// 提交图的**行内图形单元**（每行的列 + 单元类型）与折叠显示档的求值都在这一个模块里。
// 接线状态（2026-10-06 vcslog3 批已接）：`src/components/VcsLogTable.vue` 折叠走 `collapseLinearGraph()`
// （折叠跨度在图里 ⇒ 两端之间那条虚线边不再丢），渲染走 `graph.units`（经 `src/vcsLogGraphRender.ts`
// 把单元翻译成线/圆），**点一次图形收/展那一条链**走 `clickLinearFragment()`（上游 GraphCommitCellController
// 的 MOUSE_CLICK）+ `clickableLinearHashes()`（同一处的悬停光标判据）。形状判据在
// `tests/vcs-log-graph-cells.test.mjs`，渲染判据在 `tests/vcs-log-graph-render.test.mjs`。
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
  /**
   * 跨行的**长边**在被截断的那一端只画一段带箭头的竖线（`SHOW_LONG_EDGES` 关掉时用它代替弯线）。
   * `direction` = 这一段朝哪一行去：`'down'` 挂在**起点行**、`'up'` 挂在**目标行**（上游两头各留一段，
   * `platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/print/PrintElementGeneratorImpl.kt:219-226`
   * 的 `upOffset == visiblePartSize` ⇒ DOWN、`downOffset == visiblePartSize` ⇒ UP）。缺省 `'down'`。
   */
  stub: Array<{ lane: number; color: string; direction?: 'up' | 'down' } & GraphLineStyleUnit>
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

/**
 * 「长边」的分界线，两档（上游 `PrintElementGeneratorImpl` 的 companion 常量）：
 *  · 显示长边时 `longEdgeSize = VERY_LONG_EDGE_SIZE = 1000`（`platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/print/PrintElementGeneratorImpl.kt:277`）
 *    ⇒ 跨 1000 行以内一律照常穿过中间行；
 *  · 隐藏长边时 `longEdgeSize = LONG_EDGE_SIZE = 30`（同一文件 `:278`）
 *    ⇒ 只有**跨满 30 行**的那几条才被截成两头各一段带箭头的竖线。
 * 判据是同一句 `isEdgeVisibleInRow`：`normalEdge.down - normalEdge.up < longEdgeSize` 才算"这一行要画这条边"
 * （`platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/print/PrintElementGeneratorImpl.kt:242-243`）。
 * 原写「目标行不在紧邻下一行 = 长边」—— 与本仓当时"这一档默认开"的判断一起错位：那样默认就会把绝大多数
 * 分支边都截掉，而上游默认（关档）只截 ≥30 行的那几条。
 */
export const VERY_LONG_EDGE_SIZE = 1000
export const LONG_EDGE_SIZE = 30

/**
 * 折叠态：`true` = 收起**所有**线性链（上游 `Vcs.Log.CollapseAll`）、`false` = 全展开（`Vcs.Log.ExpandAll`）、
 * 数组 = 只收起列出的那几条链（上游点一次图形 = `GraphAction.Type.MOUSE_CLICK` 作用在**单个** fragment 上，
 * `platform/vcs-log/impl/src/com/intellij/vcs/log/ui/table/GraphCommitCellController.java:58-64`）。
 */
export type LinearCollapseState = boolean | readonly CollapsedSpan[]

export interface GraphOptions {
  /**
   * `MainVcsLogUiProperties.SHOW_LONG_EDGES`（`impl/src/com/intellij/vcs/log/impl/MainVcsLogUiProperties.java:16`，
   * `VcsLogApplicationSettings.kt` 的 State 里没这一项 ⇒ 用 `VcsLogUiPropertiesImpl.kt:33` 那一条读的属性值，
   * 而 `ShowLongEdgesAction` 是个纯勾选动作，勾上=显示）。
   * **缺省关**（原写"缺省开"是猜的，两处独立证据都指着反面：
   * `platform/vcs-log/impl/src/com/intellij/vcs/log/impl/VcsLogUiPropertiesImpl.kt:121-122`
   * 的 `@get:OptionTag("LONG_EDGES_VISIBLE") var isShowLongEdges = false`，
   * 以及图侧那份同名开关 `platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/facade/VisibleGraphImpl.kt:35`
   * 的 `private var isShowLongEdges = false` ⇒ `areLongEdgesHidden()` 出厂为真）。
   * 关掉的可见差别（文案 `action.Vcs.Log.ShowLongEdges.description` = 即使提交在当前视图中不可见，也显示长分支边）：
   * 跨度 ≥ `LONG_EDGE_SIZE`（30 行）的那几条边**不再穿过中间那些行**，改为在起点行留一段朝下的带箭头竖线、
   * 在目标行留一段朝上的（= "这条分支从看不见的地方接着来 / 还要往看不见的地方去"）；
   * 跨度不到 30 行的边照旧穿过中间行 —— 见 `VERY_LONG_EDGE_SIZE` / `LONG_EDGE_SIZE` 上面那段。
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
  const longEdgeSize = options.showLongEdges === true ? VERY_LONG_EDGE_SIZE : LONG_EDGE_SIZE
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
    // 长边 = 跨度达到这一档的分界线（上游 `isEdgeVisibleInRow` 判的就是 `down - up < longEdgeSize`）。
    if (edge.targetRow - edge.fromRow >= longEdgeSize) {
      // 两端各留一段**带箭头的终端竖线**、中间不穿：起点行那段朝下、目标行那段朝上
      // （`PrintElementGeneratorImpl.kt:219-226`：`upOffset == visiblePartSize` ⇒ DOWN、`downOffset == visiblePartSize` ⇒ UP。
      // 上游那两段落在离端点**一行**远的位置，本仓落在端点自己那一行上 —— 方向、箭头条数一致，差一行位置，已登记）。
      rows[edge.fromRow]?.stub.push({ lane: edge.from, color: edge.color, style: edge.style, direction: 'down' })
      rows[edge.targetRow]?.stub.push({ lane: edge.to, color: edge.color, style: edge.style, direction: 'up' })
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
    for (const edge of row.stub) pushEdge(edge.direction ?? 'down', edge.lane, edge.lane, undefined, edge.style ?? 'solid', true, edge.color)
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
 *   （`LinearFragmentGenerator.java:86-88` —— `getLongFragment(getDownFragment(…), Integer.MAX_VALUE)`，
 *    按钮那一档不设长度上限；而 `getFragment` `:126-166` 判的是「下一排（父提交）收窄回一个」，
 *    **不是**「单父 & 独子」：合并块只要重新并成一条道也收，被分支引用钉住的提交进不了中间），
 *  · 然后 `modification.hideNode(middleNode)` 把**中间那些节点藏起来**，
 *    并 `createEdge(… GraphEdgeType.DOTTED)` 在两端之间补一条**虚线边**（`:183-187`）；
 *  · `EXPAND_ALL` 就是 `resetNodesVisibility()` + `removeAdditionalEdges()`（`:202-205`）。
 * 文案（`platform/vcs-log/impl/resources/messages/VcsLogBundle.properties`，本树里只有这一份**英文**包，
 * 没有中文语言包 ⇒ 下面这些中文措辞是本仓沿用的界面口径，上游随 IDE 发货的中文原文**无法核实**）：
 * `action.title.collapse.linear.branches` = Collapse Linear Branches（`:44`）/
 * `action.title.expand.linear.branches` = Expand Linear Branches（`:38`）。
 *
 * 本仓的等价物：图是 `buildLogGraph` 对**已加载那一页**的一次性绘制，没有 BEK 折叠层，
 * 所以"隐藏中间节点"落在列表上 —— 折叠后把剩下的行交给 `buildLogGraph` 重算车道，
 * 端点之间那条"跨行的边"由 `collapsedLinearSpans()` + `GraphOptions.collapsedSpans` 生成，线型 dashed。
 * （原写"本仓用同一车道穿过中间行的竖线表示" —— 与代码不符：中间提交被过滤掉之后父哈希不在可见列表里，
 * `rowOf.get(parent)` 取不到 ⇒ 那条边整个被丢，折叠后是两段互不相连的行。实测见
 * `tests/vcs-log-graph-cells.test.mjs` 里"折叠必须连上虚线"那一条。）
 * 一条**可合并段** = 上游 `LinearFragmentGenerator.getFragment` 判出来的那一坨：从某一行出发，下一排（父提交）
 * 里只有"子提交全都在这一段内"的才往里走，走到下一排只剩一个为止 —— 于是**直链**收得着，
 * **合并后又并回一条道的菱形块**也收得着；被分支引用钉住的提交进不了中间（`myPinnedNodes`），
 * 段的两端始终留在表上（当虚线的两个落点）。判据、界限与逐行坐标都在下面的 `collapseFragments()`。
 *
 * 除这两条按钮以外，上游还能**在图形上点一次收起/展开某一条链**：
 * `platform/vcs-log/impl/src/com/intellij/vcs/log/ui/table/GraphCommitCellController.java:58-64` 的
 * `performMouseClick` 取"格子那个点下面的那个图形单元"，交给 `ActionController.performAction(MOUSE_CLICK)`（同文件 `:102-104`），
 * 命中的是 `LINEAR_COLLAPSE_CASE` / `LINEAR_EXPAND_CASE` 那两条（不是按钮那两条）。本仓的等价物 =
 * `clickLinearFragment()`：一次点击只动**那一条**链，收起态因此是一个集合而不是一个布尔。
 * 悬停那一档（`:66-81` 的 MOUSE_OVER）上游会把手形光标换出来（`LinearGraphUtils.java:88-95` + `:105`），
 * 本仓用 CSS `cursor: pointer` 表达；至于"悬停时把那几条中间行描亮"要的是多行同时高亮的宿主，没接（见批次报告）。
 */

/**
 * 一条**可合并段** = 上游 `GraphFragment` 的两端 + `getMiddleNodes` 算出的那批可被 `hideNode` 的行
 * （`middle` 空 ⇒ 这条段收了也看不见变化，`buildLogGraph` 那头也就不会有跨度边）。
 * 判据不再是一句「单父 & 独子」：那只是上游 `LinearFragmentGenerator.getFragment` 的一个特例，
 * 上游真正收的是「前沿收窄回一条道」的那一坨（合并块只要重新并成一条线也收），
 * 并且被分支引用钉住的那些提交不能进中间。算法逐行抄在下面 `collapseFragments()` 那一段。
 */
interface LinearFragment extends CollapsedSpan { middle: string[] }

function chainFragments(list: readonly GitFullCommit[]): LinearFragment[] {
  return collapseFragments(list)
}

/** 本页里"哈希 → 行号"的第一次出现（数组档的判据与 `buildLogGraph` 的 `rowOf` 同一口径）。 */
function pageIndex(list: readonly GitFullCommit[]): Map<string, number> {
  const position = new Map<string, number>()
  list.forEach((commit, index) => { if (!position.has(commit.hash)) position.set(commit.hash, index) })
  return position
}

/**
 * 当前折叠态落在**本页**上的那些链。
 *
 * 数组档（点一次图形收的那几条）过筛的判据 = **两端都还在本页**（且尾在首之后），不是"这条链还能被
 * `collapseFragments()` 原样算出来"。根据是上游把折叠态记在**图上**、不是记在段表上：
 * `platform/vcs-log/graph/src/com/intellij/vcs/log/graph/collapsing/CollapsedGraph.java:26-29` 的 `updateInstance`
 * 在图换掉（加载更多提交 / 拓扑重排）时带走 `myDelegateNodesVisibility.getNodeVisibilityById()`（**按节点 id**）
 * 与 `myEdgeStorage`（那条 DOTTED 附加边照抄）⇒ 已经收起来的中间节点不会因为"段现在能算得更长"而自己弹回来。
 * 收尾复核之前这里写的是"与原样算出的段匹配才留"，效果 = 分页加载后点收的那一条会自己展回去 ⇒ 与上游不同一条，已按上面那句改齐。
 * 仍然该丢的是"两端有一端不在本页"（换仓库根 / 过滤把端点滤掉）—— 那种跨度在 `buildLogGraph` 里本来就画不出虚线
 * （同文件里 `rowOf.get(...)` 取不到就跳过那一支）。
 */
export function activeLinearSpans(list: readonly GitFullCommit[], state: LinearCollapseState): CollapsedSpan[] {
  if (state === true) return collapsedLinearSpans(list)
  if (state === false) return []
  const position = pageIndex(list)
  return state.filter(span => {
    const from = position.get(span.from)
    const to = position.get(span.to)
    return from !== undefined && to !== undefined && to > from
  }).map(span => ({ from: span.from, to: span.to }))
}

/**
 * 被收起的那些提交的哈希（当前折叠态里那些链的中间节点；首尾不动）。
 * 每一段的中间按 `FragmentGenerator.getMiddleNodes(up, down, true)`（`collapsing/FragmentGenerator.java:50-60`，
 * 两端各走一遍取**交集**再摘掉两端）**现算**，不查预生成段表 —— 收着的那条链可能落在"比当初点它时更长的那一条链"里
 * （见 `activeLinearSpans` 里 `CollapsedGraph.updateInstance:26-29` 那一段），只有按两端现算才与上游
 * "可见性按节点 id 记、附加边按两端记"的口径一致。
 */
export function collapsedLinearHashes(list: readonly GitFullCommit[], state: LinearCollapseState = true): Set<string> {
  const position = pageIndex(list)
  const topology = pageTopology(list)
  const hidden = new Set<string>()
  for (const span of activeLinearSpans(list, state)) {
    const up = position.get(span.from)
    const down = position.get(span.to)
    if (up === undefined || down === undefined) continue
    for (const index of middleNodes(topology, up, down)) {
      const hash = list[index]?.hash
      if (hash) hidden.add(hash)
    }
  }
  return hidden
}

/** 折叠链的两端：`from` = 链首（较新的那个提交），`to` = 链尾（较旧的那个）。 */
export function collapsedLinearSpans(list: readonly GitFullCommit[]): CollapsedSpan[] {
  return chainFragments(list).map(fragment => ({ from: fragment.from, to: fragment.to }))
}

/**
 * 点一次落在某一行上 ⇒ 那**一条**链的两端（上游 `LinearFragmentGenerator.getLongFragment(element)`，
 * `platform/vcs-log/graph/src/com/intellij/vcs/log/graph/collapsing/LinearFragmentGenerator.java:90-92`
 * —— 先 `getRelativeFragment(element)` 找到元素所在的那一段（节点用它自己、边用它那两端，`:49-62`），
 * 再沿上下两头扩到最长）。链上的中间节点收起后就不在可见行了上，所以实际点到的只会是端点或中间行的两端。
 *
 * 已登记的差异（收尾复核时逐句对的，不是"看着像"）：上游 `getRelativeFragment` 里那道
 * `MAX_SEARCH_SIZE = 10` 的界（`:24` 定义、`:64-73` 那个循环 —— 取不到段就沿**唯一**的子上排继续找，最多十步）
 * 本仓**没有照搬**：本仓的段集合是 `collapseFragments()` 对整页**预生成**的，每一次点击只认这份表。
 * 两边可观测面一致的根据：本仓的扫描是自上而下逐行取 `getLongDownFragment`（同上游 `COLLAPSE_ALL:221-233`），
 * 任何"上面那一行所属的段"在它自己那一行就已经算过了 ⇒ 那十次回溯在本仓没有可观测的差异
 * （差分实测：8000 份随机拓扑里本仓与照抄上游的参考实现 `spans` / `hidden` 全等，0 分歧）。
 */
export function linearFragmentAt(list: readonly GitFullCommit[], hash: string): CollapsedSpan | undefined {
  const fragment = chainFragments(list)
    .find(item => item.from === hash || item.to === hash || item.middle.includes(hash))
  return fragment ? { from: fragment.from, to: fragment.to } : undefined
}

/**
 * 在某一行的**图形**上点一次 ⇒ 新的收起集合；返回 `undefined` = 这一次点击不改变任何东西。
 *
 * 上游一次 MOUSE_CLICK 走的是 CASE 表**顺序**（`CollapsedActionManager.java:280-281`：
 * `LINEAR_EXPAND_CASE` 在 `LINEAR_COLLAPSE_CASE` 之前），两个判据分别是：
 *  · 展开：这一行的图形单元是那条 DOTTED 边、或它是某条 DOTTED 边的邻接节点
 *    （`getDottedEdge` `platform/vcs-log/graph/src/com/intellij/vcs/log/graph/collapsing/CollapsedActionManager.java:305-316`）
 *    ⇒ `showNode(中间节点)` + `removeEdge(DOTTED)`（同文件 `:261-265`）；
 *  · 收起：这一行的单元落在某条线性链上 ⇒ `hideNode(中间节点)` + `createEdge(DOTTED)`（`:184-187`）。
 * 本仓按行收这个点击（图形格子一次点击 = 该行的那个提交），两档的先后与上面一致。
 */
export function clickLinearFragment(list: readonly GitFullCommit[], state: LinearCollapseState,
                                    hash: string): CollapsedSpan[] | undefined {
  const spans = activeLinearSpans(list, state)
  const at = spans.findIndex(span => span.from === hash || span.to === hash)
  if (at >= 0) return spans.filter((_, index) => index !== at)
  const fragment = linearFragmentAt(list, hash)
  if (!fragment) return undefined
  // 那条链已经收着了（点到的只可能是中间行 —— 端点上面一档已经接走）⇒ 不重复记一条。
  if (spans.some(span => span.from === fragment.from && span.to === fragment.to)) return undefined
  return [...spans, fragment]
}

/**
 * 点一次图形**会真的改变**折叠态的那些提交 = 组件用来决定"这一格给不给手形光标"的那一集。
 * 上游对应 MOUSE_OVER 那一档：命中 `LINEAR_COLLAPSE_CASE` / `LINEAR_EXPAND_CASE` 才回一个
 * `HAND_CURSOR`（`platform/vcs-log/graph/src/com/intellij/vcs/log/graph/utils/LinearGraphUtils.java:88-95`
 * 的 `getCursor(true)`，由 `createSelectedAnswer` `:98-106` 带出去），否则是默认光标。
 * 收起态里的链只有两端点在这一格上有那条虚线（中间行已经看不见了）⇒ 只有端点算；未收起的链整条都算。
 */
export function clickableLinearHashes(list: readonly GitFullCommit[], state: LinearCollapseState): Set<string> {
  const active = new Set(activeLinearSpans(list, state).map(span => `${span.from}|${span.to}`))
  const out = new Set<string>()
  for (const fragment of chainFragments(list)) {
    out.add(fragment.from); out.add(fragment.to)
    if (!active.has(`${fragment.from}|${fragment.to}`)) for (const hash of fragment.middle) out.add(hash)
  }
  return out
}

/** 有没有可收起的东西（上游 `CollapseOrExpandGraphAction.update` 的 `isActionSupported(BUTTON_COLLAPSE)`）。 */
export function canCollapseLinearBranches(list: readonly GitFullCommit[]): boolean {
  return collapsedLinearHashes(list).size > 0
}

/** 折叠态下的可见提交列表（`state` 为假时逐字返回原列表）。 */
export function collapseLinearBranches(list: readonly GitFullCommit[], state: LinearCollapseState = false): GitFullCommit[] {
  const hidden = collapsedLinearHashes(list, state)
  return hidden.size ? list.filter(commit => !hidden.has(commit.hash)) : [...list]
}

/**
 * 折叠态的**一次成型**出口：可见列表 + 已经连上虚线的图。
 * `VcsLogTable.vue` 的 `folded` / `graph` 两个 computed 吃的就是这一个调用 —— 分成两步
 * （先 `collapseLinearBranches` 再 `buildLogGraph`）丢的就是上游那条 DOTTED 边：中间提交被过滤掉 ⇒
 * 父哈希不在可见行里 ⇒ 边根本不生成。落地的渲染侧判据在 `tests/vcs-log-graph-render.test.mjs`。
 */
export function collapseLinearGraph(list: readonly GitFullCommit[], state: LinearCollapseState = false,
                                    options: GraphOptions = {}) {
  const spans = activeLinearSpans(list, state)
  const visible = collapseLinearBranches(list, spans)
  return { visible, graph: buildLogGraph(visible, { ...options, collapsedSpans: spans }) }
}

/**
 * 上游 `LinearFragmentGenerator.java:23` 的 `SHORT_FRAGMENT_MAX_SIZE`：`getFragment` 往里最多收 10 个节点
 * 就放弃这一段（前沿收不窄 ⇒ 整段不收，`:136` 那句 `while (blackNodes.size() < SHORT_FRAGMENT_MAX_SIZE)`）。
 * 展开那一趟（`getLongFragment` `:99-124`）没有这个上限，所以一条长直链照样一路串到底。
 */
const SHORT_FRAGMENT_MAX_SIZE = 10

/**
 * 本页的拓扑。上游吃的是 `LiteLinearGraph`（`LinearFragmentGenerator.java:26` 的 `myLinearGraph`），
 * 它的 DOWN = 这一行的**父提交**所在行、UP = **子提交**所在行（`LinearGraphUtils.java:75-84`
 * 那个 `getNodes` 就是按邻接边两头取的）；行号在本页里自上而下递增，和上游可见图的节点号同一口径。
 */
interface PageTopology { down: number[][]; up: number[][]; pinned: Set<number> }

function pageTopology(list: readonly GitFullCommit[]): PageTopology {
  const position = new Map<string, number>()
  list.forEach((commit, index) => { if (!position.has(commit.hash)) position.set(commit.hash, index) })
  const down: number[][] = list.map(() => [])
  const up: number[][] = list.map(() => [])
  list.forEach((commit, index) => {
    const seen = new Set<number>()
    for (const parent of commit.parents) {
      const target = position.get(parent)
      // 父提交不在本页 / 号比自己小（上游的可见图里不存在这种反向边）⇒ 这条边不当它存在，不凭空造。
      if (target === undefined || target <= index || seen.has(target)) continue
      seen.add(target)
      down[index]!.push(target)
      up[target]!.push(index)
    }
  })
  // `myPinnedNodes` = `FragmentGenerators` 构造时传进来的 `permanentGraphInfo.getBranchNodeIds()`
  // （`CollapsedActionManager.java:146-147`）。那份 id 的出处：`VcsLogGraphDataFactory.kt:77` 取
  // `refsModel.branches`，`RootRefsModel` 把 `ref.type.isBranch` 为真的引用装进 `branchesMapping`
  // （`VcsLogRefsOfSingleRootFactory.kt:24-29`），而 git 侧 `isBranch = true` 的是
  // HEAD / LOCAL_BRANCH / REMOTE_BRANCH 三类（`GitRefManager.kt:271/275/278`），TAG 与 OTHER 是 false
  // （`:281/284`）。本仓的引用就这四档（`src/vcsLogTypes.ts:9-10`，宿主 `%D` 的解析在 `native/git_log.cpp:85-101`）
  // ⇒ 钉住的行 = 这一行的提交带着**任何一个非 tag 的引用**（分支尖、远端尖、HEAD 都算）。
  const pinned = new Set<number>()
  list.forEach((commit, index) => {
    if ((commit.refs ?? []).some(ref => ref.type !== 'tag')) pinned.add(index)
  })
  return { down, up, pinned }
}

/**
 * 上游 `LinearFragmentGenerator.getFragment`（`:126-166`）逐句对应：从 `start` 出发，
 * `gray` 是"下一排"，只有**子提交全都已经收进 black** 的那个灰节点才能往里走一步；
 * 某一趟 `gray` 只剩一个且它合格 ⇒ 前沿收窄了，那一个就是这一段的另一端。
 * 收不窄（`nextBlackNode == -1`，`:145`）、往里走的那个节点没有下游（`:153` 前半）、
 * 或者它是被钉住的分支尖（`:153` 后半 `thisNodeCantBeInMiddle`）都整段作废。
 *
 * 已登记的差异：上游 `grayNodes` 是 `HashSet`，同一趟里多个候选谁先被取**不确定**
 * （`LinearFragmentGenerator.java:138` 那句 for）；本仓按行号升序取第一个 ⇒ 同一份数据每次算出同一个结果。
 */
function narrowFragment(topology: PageTopology, start: number, isDown: boolean): { up: number; down: number } | undefined {
  const next = (index: number) => (isDown ? topology.down[index]! : topology.up[index]!)
  const prev = (index: number) => (isDown ? topology.up[index]! : topology.down[index]!)
  const black = new Set<number>([start])
  let gray = sortedUnique(next(start))
  let endNode = -1
  while (black.size < SHORT_FRAGMENT_MAX_SIZE) {
    let nextBlack = -1
    for (const grayNode of gray) {
      if (prev(grayNode).every(node => black.has(node))) { nextBlack = grayNode; break }
    }
    if (nextBlack < 0) return undefined
    if (gray.length === 1) { endNode = nextBlack; break }
    const nextGray = next(nextBlack)
    if (!nextGray.length || topology.pinned.has(nextBlack)) return undefined
    black.add(nextBlack)
    gray = sortedUnique([...gray, ...nextGray].filter(node => node !== nextBlack))
  }
  if (endNode < 0) return undefined
  return isDown ? { up: start, down: endNode } : { up: endNode, down: start }
}

/**
 * 上游 `getLongFragment(startFragment, bound)`（`:99-124`）：把那一小段朝上下两头一路扩到不能再扩
 * （按钮那档 `bound = Integer.MAX_VALUE` ⇒ `Infinity`；悬停那档才是 500，`:95-97`）。
 * 扩不动了才回头看一眼 `:121`：起点下面**不止一条**边才算一段真分支的开头，值得收；
 * 只有一条边（直链的中间那种）说明这一小段本来就收不出东西，回 `undefined`。
 *
 * 收尾复核登记（两处"看着像上游、其实没有可观测面"的地方，都不删、也不假装有成）：
 *  · 朝上那一趟（`:110-114`）在本仓的扫描顺序下**一次都没移动过** `maxUp`：穷举 3–6 行的全部拓扑
 *    ×（不钉 + 钉一行 + 钉两行）全部钉法，`maxUp < fragment.up` 命中 0 次；8000 份随机拓扑的差分里也是 0。
 *    上游能走到的那条路是点击用的 `getLongFragment(element)`（`:90-92`，段来自"元素相对的那一段"），
 *    本仓点击吃的是预生成段集合 ⇒ 这一趟留着只与上游**同形**，不产生行为，因此**没有**判据钉它。
 *  · `:121` 的否定那一支（起点下面恰好一条边 ⇒ 不收）同样没有单独判据：`narrowFragment` 从"只有一条下游"
 *    的起点出发永远给出**相邻**两行，而相邻两行的 `middle` 是空集，先被 `collapseFragments()` 里那句
 *    `if (!middle.length) continue` 挡掉 ⇒ 两支在可观测面上是同一条。
 */
function longestFragment(topology: PageTopology, fragment: { up: number; down: number } | undefined,
                         bound = Infinity): { up: number; down: number } | undefined {
  if (!fragment) return undefined
  let maxDown = fragment.down
  for (;;) {
    const short = narrowFragment(topology, maxDown, true)
    if (!short || topology.pinned.has(maxDown)) break
    maxDown = short.down
    if (maxDown - fragment.down > bound) break
  }
  let maxUp = fragment.up
  for (;;) {
    const short = narrowFragment(topology, maxUp, false)
    if (!short || topology.pinned.has(maxUp)) break
    maxUp = short.up
    if (fragment.up - maxUp > bound) break
  }
  if (maxUp !== fragment.up || maxDown !== fragment.down) return { up: maxUp, down: maxDown }
  if (topology.down[fragment.up]!.length !== 1) return fragment
  return undefined
}

/**
 * 上游 `FragmentGenerator.getMiddleNodes(up, down, strict = true)`（`:50-60`）+ `getWalkNodes`（`:96-109`）：
 * 从两端各走一遍再取交集，所以中间那批**包含合并块两侧的那些行**，不只是"一条道上的"
 * （上游自带用例钉着这个形状：`graph/test/com/intellij/vcs/log/graph/impl/FragmentGeneratorTest.kt:135-139`
 * 的 `downTree.getMiddleNodes(0, 4) = "0,1,2,4"`、`upTree.getMiddleNodes(1, 5) = "1,3,4,5"`）。
 * `strict` 那一步（`:56-57`）把两端自己摘掉 ⇒ 端点始终留在表上，虚线才有落点。
 */
function middleNodes(topology: PageTopology, up: number, down: number): Set<number> {
  const downWalk = walkNodes(topology, up, index => topology.down[index]!, index => index > down)
  const upWalk = walkNodes(topology, down, index => topology.up[index]!, index => index < up)
  const middle = new Set<number>()
  for (const index of downWalk) {
    if (index !== up && index !== down && upWalk.has(index)) middle.add(index)
  }
  return middle
}

/** 上游 `getWalkNodes`：`TreeSetNodeIterator` 是有序集合 ⇒ 同一个节点只走一次；`stop` 命中的不收入也不往下扩。 */
function walkNodes(topology: PageTopology, start: number, next: (index: number) => readonly number[],
                   stop: (index: number) => boolean): Set<number> {
  const collected = new Set<number>()
  const queue = [start]
  const walked = new Set<number>([start])
  while (queue.length) {
    const node = queue.shift()!
    if (stop(node)) continue
    collected.add(node)
    for (const child of next(node)) {
      if (walked.has(child)) continue
      walked.add(child)
      queue.push(child)
    }
  }
  return collected
}

/**
 * 本页所有的可合并段 = 上游 `COLLAPSE_ALL` 那一趟（`CollapsedActionManager.java:221-233`）：
 * 自上而下逐节点取 `getLongDownFragment(nodeIndex)`（`LinearFragmentGenerator.java:86-88`），
 * 已经因为前一段被收起的节点跳过（`:223` 的 `if (modification.isNodeHidden(nodeIndex)) continue`），
 * 每段 = `hideNode(中间节点)` + 在两端之间补一条 DOTTED 边（`:230-231`）。
 */
function collapseFragments(list: readonly GitFullCommit[]): LinearFragment[] {
  if (!list.length) return []
  const topology = pageTopology(list)
  const hidden = new Set<number>()
  const fragments: LinearFragment[] = []
  for (let start = 0; start < list.length; start++) {
    if (hidden.has(start)) continue
    const fragment = longestFragment(topology, narrowFragment(topology, start, true))
    if (!fragment) continue
    const middle = [...middleNodes(topology, fragment.up, fragment.down)]
    if (!middle.length) continue
    for (const index of middle) hidden.add(index)
    fragments.push({
      from: list[fragment.up]!.hash,
      to: list[fragment.down]!.hash,
      middle: middle.sort((a, b) => a - b).map(index => list[index]!.hash),
    })
  }
  return fragments
}

const sortedUnique = (values: readonly number[]) => [...new Set(values)].sort((a, b) => a - b)
