// Git 日志**图形面**的渲染判据（vcslog3 批：把模块的 `graph.units` 真接到 `VcsLogTable.vue`）。
//
// 三件事各自有判据：
//   1) 折叠后线性链两端之间**必须**画出虚线（`collapseLinearGraph` 的那条 DOTTED 跨度边）；
//   2) 每一行画的是 `graph.units[这一行]`（行数与 `graph.rows` 一致、上下两段都画、弯线在格边界对接）；
//   3) 只画真的存在的单元：`graphInformation` 为假 ⇒ 一格都不画；`row.process`（进度文案）没有宿主 ⇒ 不渲染。
//
// 上游基准（本批逐行打开过，唯一真源 `D:/Backup/Downloads/intellij-community-master/intellij-community-master`）：
//  · 画师几何 `platform/vcs-log/impl/src/com/intellij/vcs/log/paint/SimpleGraphCellPainter.kt`
//      - 虚线笔的选用 `:127-134`（实线**或**带箭头 ⇒ 实笔）
//      - dash 数组 `:219-229`（竖直那条按一个行高算 ⇒ "Exactly one dash and one space fits on the edge"）
//      - `paintEdge` `:147-170`（两列相等 = 竖线 `:158-162`、终端缺口 `circleRadius / 2 + 1` `:159-160`、
//        两列不等 = 画到邻行那一列的两倍长 `:163-169`）
//      - 箭头两翅 `:137-143` + `rotate` `:204-217` + `ARROW_ANGLE_COS2`/`ARROW_LENGTH` `:201-202`
//      - `paintCircle` `:172-187`（FILL 实心 / OUTLINE_AND_FILL 走头节点画师 `:181`）
//  · 头节点三层圆 `platform/vcs-log/impl/src/com/intellij/vcs/log/paint/HeadNodePainter.kt:47-59`，层间距 `:19`
//  · 线宽与点半径 `platform/vcs-log/impl/src/com/intellij/vcs/log/paint/PaintParameters.java:10-11`
//  · 一行的单元集合与"节点/落在这一行的边同列" `platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/print/PrintElementGeneratorImpl.kt:126-173`
//    与邻行取列的 fallback `:175-190`（逐列形状对着该仓自带的期望文本 `platform/vcs-log/graph/testData/elementGenerator/manyNodes_out.txt` 核过）
//  · 收起时同一次修改里补的那条 DOTTED 边 `platform/vcs-log/graph/src/com/intellij/vcs/log/graph/collapsing/CollapsedActionManager.java:230-231`
//  · 没有图信息就 `emptyList()` `platform/vcs-log/impl/src/com/intellij/vcs/log/ui/table/GraphTableModel.kt:97-100`
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { buildLogGraph, collapseLinearGraph, collapsedLinearSpans, graphUnitsOfRows, laneX, ROW_H } from '../src/vcsLogGraph.ts'
import { GRAPH_HEAD_GAP, GRAPH_LINE_WIDTH, GRAPH_NODE_RADIUS, dashArray, paintGraphRow } from '../src/vcsLogGraphRender.ts'
import { loadSfc } from './vue-sfc-loader.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')
const { component: VcsLogTable } = loadSfc('src/components/VcsLogTable.vue')

const commit = (hash, parents, refs = []) => ({
  hash, shortHash: hash, author: 'A', date: '2026-10-06T00:00:00Z', subject: hash, parents, refs,
})
const HEAD = { name: 'HEAD', type: 'head' }
/** h1 → h2 → h3 → h4：长度 4 的线性链（收起中间两个，两端之间那条边就是虚线）。 */
const chain = [commit('h1', ['h2']), commit('h2', ['h3']), commit('h3', ['h4']), commit('h4', [])]
/** a1 的两条出边里 a9 那条跨 3 行 ⇒ 中间两行是"穿行行"（长边开档必须上下两段都画）。 */
const long = [commit('a1', ['a2', 'a9']), commit('a2', ['a3']), commit('a3', ['a9']), commit('a9', [])]
/** 同一条形状，但 a9 挪到第 31 行 ⇒ a1→a9 才够上游那条"长边"的分界（关档才截，PrintElementGeneratorImpl.kt:277-278）。 */
const far = [commit('a1', ['a2', 'a9']), commit('a2', ['f0']),
  ...Array.from({ length: 29 }, (_, i) => commit(`f${i}`, [i === 28 ? 'a9' : `f${i + 1}`])), commit('a9', [])]
const edges = units => units.filter(unit => unit.kind === 'edge')
const nodes = units => units.filter(unit => unit.kind === 'node')
const renderTable = (commits, props = {}) => renderToString(createSSRApp({
  render: () => h(VcsLogTable, { commits, selected: commits[0]?.hash ?? '', root: 'D:/p', ...props }),
}))

test('折叠真的把虚线接到组件上：折叠档有 stroke-dasharray，展开档一条都没有', async () => {
  const folded = await renderTable(chain, { collapsed: true })
  const open = await renderTable(chain, { collapsed: false })
  const dashed = folded.match(/stroke-dasharray="[^"]+"/g) ?? []
  assert.equal(dashed.length, 2, '折叠后 h1 行的下半段 + h4 行的上半段各一条虚线（两端连上）')
  assert.deepEqual([...new Set(dashed)], ['stroke-dasharray="15 11"'],
    'dash 值 = 上游 getDashLength 在竖直边上的算法：一个行高刚好一段 dash + 一段空（SimpleGraphCellPainter.kt:219-229）')
  assert.equal((open.match(/stroke-dasharray=/g) ?? []).length, 0, '展开档全是实线')
  assert.equal((open.match(/class="log-row/g) ?? []).length, 4, '展开档仍是 4 行')
  assert.equal((folded.match(/class="log-row/g) ?? []).length, 2, '折叠档只剩两端两行')
})

test('不传折叠跨度就没有那条虚线（反证：接线前的形状确实会红）', () => {
  const { visible } = collapseLinearGraph(chain, true)
  const orphan = buildLogGraph(visible)
  assert.equal(edges(orphan.units[0]).length, 0, '分两步调 ⇒ 中间提交被过滤掉、父哈希不在可见行里 ⇒ 边整个丢掉')
  const wired = collapseLinearGraph(chain, true).graph
  assert.equal(edges(wired.units[0]).length, 1)
  assert.equal(edges(wired.units[0])[0].style, 'dashed')
  assert.deepEqual(collapsedLinearSpans(chain), [{ from: 'h1', to: 'h4' }])
})

test('graph.units 的行数与 graph.rows 一致（每一行都要有得画）', () => {
  for (const list of [[], chain, long, [commit('solo', [])]]) {
    for (const collapsed of [false, true]) {
      const { graph } = collapseLinearGraph(list, collapsed, { graphInformation: true })
      assert.equal(graph.units.length, graph.rows.length, `${list.length} 行 / collapsed=${collapsed}：units 与 rows 必须同长`)
      assert.equal(graph.units.every(rowUnits => nodes(rowUnits).length <= 1), true, '一行最多一个节点单元')
    }
  }
  const off = buildLogGraph(long, { graphInformation: false })
  assert.equal(off.units.length, off.rows.length, '关掉图信息也是逐行给空数组，不是少给行')
  assert.deepEqual(off.units, [[], [], [], []], '上游 GraphTableModel.kt:97-100 就是 emptyList()')
})

test('穿行行两段都画：上一行的下半段与下一行的上半段在格边界上对接', () => {
  const { units } = buildLogGraph(long)
  // 中间两行（行 1、行 2）各有一条穿行的长边：这一行必须同时给出 DOWN 与 UP ——
  // 画师按 `type` 只画自己那一半（`SimpleGraphCellPainter.kt:158-168`），少一段就是半截线。
  for (const index of [1, 2]) {
    const inRow = edges(units[index])
    assert.ok(inRow.some(unit => unit.direction === 'down'), `行 ${index} 要有下半段`)
    assert.ok(inRow.some(unit => unit.direction === 'up'), `行 ${index} 要有上半段`)
  }
  // 跨行的镜像 + 对接：行 R 的每一条 DOWN 都必须在行 R+1 找到 (otherPosition, position) 反过来的 UP，
  // 而且两段在格边界上必须交于同一个 x（这就是上游那句 "dock with each other well"）。
  const crossX = unit => (unit.position === unit.otherPosition
    ? laneX(unit.position) : (laneX(unit.position) + laneX(unit.otherPosition)) / 2)
  for (let row = 0; row < units.length - 1; row++) {
    for (const unit of edges(units[row])) {
      if (unit.direction !== 'down' || unit.hasArrow) continue
      const mirror = edges(units[row + 1]).find(other => other.direction === 'up'
        && other.position === unit.otherPosition && other.otherPosition === unit.position)
      assert.ok(mirror, `行 ${row} 的 DOWN(${unit.position}->${unit.otherPosition}) 在行 ${row + 1} 缺少镜像的 UP`)
      assert.equal(crossX(mirror), crossX(unit), `行 ${row}/${row + 1} 的两段在格边界没接上`)
    }
  }
})

test('dash 值来自上游算法，不是抄来的字面量', () => {
  assert.equal(dashArray(ROW_H), '15 11', '竖直：dashCount=1、space=26/2-2=11、dash=26-11=15')
  assert.equal(dashArray(2 * ROW_H), '15 11', '两个行高：dashCount=2 ⇒ dash 还是 15（凑整数个 dash）')
  const slant = Math.hypot(14, ROW_H)
  assert.equal(dashArray(slant), `${Math.round((slant - 11) * 100) / 100} 11`, '斜边：space 不变，dash 按边长取')
  // 渲染侧交出去的边长永远 ≥ 一个行高（竖直按 ROW_H 算、斜线按两倍长的端点算）⇒ 不会出现负 dash。
  const painted = paintGraphRow(buildLogGraph(chain, { collapsedSpans: collapsedLinearSpans(chain) }).units[0])
  assert.ok(painted.strokes.every(stroke => stroke.dash === undefined || Math.abs(Number(stroke.dash.split(' ')[0])) > 0))
})

test('竖线 / 弯线 / 终端箭头的几何与上游一致', () => {
  const { units } = buildLogGraph(long)
  const painted = paintGraphRow(units[0])
  const vertical = painted.strokes.find(stroke => stroke.x1 === stroke.x2 && stroke.y2 > stroke.y1)
  assert.ok(vertical, '同列的那条画竖线')
  assert.equal(vertical.y1, ROW_H / 2, '起点在行中线（paintEdge :157）')
  assert.equal(vertical.y2, ROW_H, '竖直 DOWN 收到本行下边（:160）')
  const bend = painted.strokes.find(stroke => stroke.x1 !== stroke.x2)
  assert.ok(bend, '两列不等 ⇒ 画到邻行那一列')
  assert.equal(bend.y2, ROW_H + ROW_H / 2, '弯线画两倍长，超出部分由本格裁掉（:167）')
  assert.equal(painted.marks.length, 1, '行 0 一个节点')
  assert.equal(painted.marks[0].r, GRAPH_NODE_RADIUS)
  assert.equal(GRAPH_LINE_WIDTH, 1.5, '线宽 = PaintParameters.java:11 的 THICK_LINE')
  // 关掉长边：**够 30 行**的那条边在起点那一行换成终端单元（两列同值 + 有箭头 + 留出箭头缺口）。
  const closed = buildLogGraph(far, { showLongEdges: false })
  const terminal = paintGraphRow(closed.units[0])
  const main = terminal.strokes.filter(stroke => stroke.y1 === ROW_H / 2)
  assert.equal(main.length, 2, '起点这一行：一条相邻边的竖线 + 那条长边的终端竖线')
  const stub = main.find(stroke => stroke.y2 < ROW_H)
  assert.ok(stub, '终端竖线在离底边 circleRadius/2+1 处收尾（:159-160）')
  assert.equal(stub.y2, ROW_H - (GRAPH_NODE_RADIUS / 2 + 1))
  const wings = terminal.strokes.filter(stroke => stroke.y1 === stub.y2 && stroke.x1 === stub.x2)
  assert.equal(wings.length, 2, '箭头 = 从线段末端顶点出去的两条翅（:137-143）')
  for (const wing of wings) {
    assert.equal(Math.round(Math.hypot(wing.x2 - wing.x1, wing.y2 - wing.y1) * 1000) / 1000,
      Math.round(0.3 * ROW_H * 1000) / 1000, '翅长 = ARROW_LENGTH * rowHeight（:202）')
    assert.equal(wing.dash, undefined, '带箭头的线段用实笔（:127 的 isUsual || hasArrow）')
  }
  assert.equal(terminal.strokes.filter(stroke => stroke.y1 === ROW_H / 2 && stroke.y2 > ROW_H).length, 0,
    '关档后行 0 不再有画到格外的那一条（长边被换成终端竖线）')
  // 上游两头都留一段（`getArrowType` 的 `upOffset == visiblePartSize` ⇒ DOWN、`downOffset == …` ⇒ UP，
  // platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/print/PrintElementGeneratorImpl.kt:219-226）
  // ⇒ 目标行那一格多一个是**朝上**的终端单元，收口在离顶边同样一个箭头缺口处。
  const bottomUnits = edges(closed.units[31])
  const bottomArrow = bottomUnits.find(unit => unit.hasArrow)
  assert.ok(bottomArrow, '目标行有那条朝上的终端单元')
  assert.equal(bottomArrow.direction, 'up')
  assert.equal(bottomArrow.otherPosition, bottomArrow.position, '终端单元两列同值（TerminalEdgePrintElement.java:16）')
  assert.equal(bottomUnits.filter(unit => unit.hasArrow).length, 1, '只补一条，不给同一头画两个箭头')
  const bottom = paintGraphRow(closed.units[31])
  const upStrokes = bottom.strokes.filter(stroke => stroke.y1 === ROW_H / 2 && stroke.x1 === stroke.x2 && stroke.y2 < ROW_H / 2)
  assert.equal(upStrokes.length, 2, '目标行那一列上有两段朝上的竖线：相邻边整段 + 被截长边的终端段（上游也是两头都画）')
  const arrowStub = upStrokes.find(stroke => stroke.y2 === GRAPH_NODE_RADIUS / 2 + 1)
  assert.ok(arrowStub, '终端段收在**顶边**的箭头缺口（paintEdge :161-162 的 gap 档）')
  assert.ok(upStrokes.some(stroke => stroke.y2 === 0), '相邻那条边整段到顶：非终端 ⇒ 不留缺口')
  assert.equal(bottom.strokes.filter(stroke => stroke.y1 === arrowStub.y2 && stroke.x1 === arrowStub.x2).length, 2,
    '终端段那一头上也有一对箭翅（与起点那一头同一套几何）')
  assert.equal(bottom.strokes.filter(stroke => stroke.y1 === ROW_H / 2 && stroke.y2 > ROW_H).length, 0,
    '关档后目标行不再有画到格外向下的那一段（a9 自己没有出边）')
})

test('虚线的跨度边即使被关成终端竖线也照上游用实笔（isUsual || hasArrow）', () => {
  // 折叠跨度**跨满 30 行以上**（中间那些行不属于这条链）+ 关掉长边 ⇒ 起点那一行只能给终端竖线，
  // 而它的线型仍是 DASHED（线型是数据的属性，笔是画的属性 —— 上游两句分开写）。
  const page = [commit('c1', ['gone']),
    ...Array.from({ length: 30 }, (_, i) => commit(`k${i}`, [])), commit('c3', [])]
  assert.equal(page.findIndex(c => c.hash === 'c3'), 31, '跨度要够长才会被截（PrintElementGeneratorImpl.kt:242-243）')
  const stubbed = buildLogGraph(page, { collapsedSpans: [{ from: 'c1', to: 'c3' }], showLongEdges: false })
  assert.equal(stubbed.rows[0].stub.length, 1, '跨度边在关档下落到起点那一行的竖线')
  assert.equal(stubbed.rows[0].stub[0].style, 'dashed', '单元本身仍记着 DASHED（线型是数据的属性）')
  assert.equal(stubbed.rows[31].stub[0].direction, 'up', '目标行那头的终端段朝上')
  const painted = paintGraphRow(stubbed.units[0])
  assert.ok(painted.strokes.some(stroke => stroke.y2 === ROW_H - (GRAPH_NODE_RADIUS / 2 + 1)), '画出来的是带箭头的终端段')
  assert.ok(painted.strokes.every(stroke => stroke.dash === undefined),
    '画出来全是实笔：上游 paintLine 对 hasArrow 那一档走 ordinaryStroke（SimpleGraphCellPainter.kt:127-129）')
  const shown = buildLogGraph(page, { collapsedSpans: [{ from: 'c1', to: 'c3' }], showLongEdges: true })
  assert.equal(shown.rows[0].down.filter(edge => edge.style === 'dashed').length, 1, '开档时同一条跨度边走弯线')
  assert.ok(paintGraphRow(shown.units[0]).strokes.some(stroke => stroke.dash === '15 11' || Number(stroke.dash?.split(' ')[0]) > 0),
    '开档时它是虚的（终端那一档才转实笔）')
})

test('HEAD 那一行的节点画三层，其它行一层；行里点数与 marks 数一致', async () => {
  const withHead = [commit('h1', ['h2'], [HEAD]), commit('h2', ['h3']), commit('h3', [])]
  const units = buildLogGraph(withHead).units
  assert.equal(nodes(units[0])[0].shape, 'outlineAndFill')
  const head = paintGraphRow(units[0]).marks
  assert.deepEqual(head.map(mark => mark.r), [GRAPH_NODE_RADIUS + GRAPH_HEAD_GAP, GRAPH_NODE_RADIUS, GRAPH_NODE_RADIUS - GRAPH_HEAD_GAP],
    '外圈 / 挖空 / 中心点（HeadNodePainter.kt:47-59 的三层同心圆）')
  assert.deepEqual(head.map(mark => mark.kind), ['fill', 'gap', 'fill'], '中间那层填的是那一格的背景色')
  assert.deepEqual(paintGraphRow(units[1]).marks.map(mark => mark.kind), ['fill'], '非 HEAD 行只有实心点')
  const html = await renderTable(withHead)
  assert.equal((html.match(/class="head-gap"|head-gap/g) ?? []).length >= 1, true, '组件把挖空那一层渲染出来了')
  const circles = html.match(/<circle[^>]*>/g) ?? []
  const expected = units.reduce((total, rowUnits) => total + paintGraphRow(rowUnits).marks.length, 0)
  assert.equal(circles.length, expected, '渲出来的圆数 = 各行 marks 数之和（真的按 units 画）')
})

test('graphInformation 为假时组件一格都不画（行还在，图形空着）', async () => {
  const source = read('src/components/VcsLogTable.vue')
  assert.match(source, /graphInformation: true/, '日志面这一页有父子拓扑 ⇒ 恒按图谱显示（值从模型档来，不在组件里另判）')
  const hidden = buildLogGraph(long, { graphInformation: false })
  assert.deepEqual(hidden.units.map(rowUnits => paintGraphRow(rowUnits)), long.map(() => ({ strokes: [], marks: [] })),
    '没有图信息 ⇒ 每行既无线也无点，而不是画一个孤零零的点')
})

test('边界：空页 / 自环父 / 页外父 都不崩，也不凭空多单元', () => {
  const empty = collapseLinearGraph([], true, { graphInformation: true })
  assert.deepEqual(empty.visible, [])
  assert.deepEqual(empty.graph.units, [])
  assert.deepEqual(empty.graph.rows, [])
  const self = [commit('s1', ['s1']), commit('s0', [])]
  const selfUnits = buildLogGraph(self).units
  assert.equal(selfUnits.length, 2, '父 = 自己（targetRow <= index）不是合法边，不画自环')
  assert.equal(edges(selfUnits[0]).length, 0)
  const offpage = [commit('o1', ['gone']), commit('o0', [])]
  const offUnits = buildLogGraph(offpage).units
  assert.equal(edges(offUnits[0]).length, 0, '父提交不在本页 ⇒ 不造单元（与折叠跨度的判据同一口径）')
  assert.deepEqual(graphUnitsOfRows(buildLogGraph(offpage).rows, false), [[], []])
})

test('请求 3 的证据：row.process 没有宿主，组件不渲染它（不放假控件）', () => {
  const component = read('src/components/VcsLogGraphOptions.vue')
  assert.ok(!component.includes('row.process'), '弹层只渲染 title/description/disabled/on/run，进度文案没有消费方')
  assert.match(component, /v-else-if="row\.command"/, '命令档照旧渲染（收起/展开那两行）')
  const model = read('src/vcsLogGraphOptions.ts')
  assert.match(model, /process/, '文案仍钉在模型里（上游 CollapseOrExpandGraphAction 的 progress 标题），等真宿主')
  const render = read('src/vcsLogGraphRender.ts')
  assert.ok(!/performLongAction|ProgressIndicator/.test(render), '渲染侧不假装有一条不存在的进度条')
})
