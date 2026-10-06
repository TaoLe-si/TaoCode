// 图形单元 → SVG 图元的换算（`src/components/VcsLogTable.vue` 的每一行提交格用这一块）。
// 本模块只做**几何**：把 `src/vcsLogGraph.ts` 的 `GraphUnit`（= 上游一个 PrintElement）翻译成
// 直线段与圆，列号→像素沿用 `laneX()` / `ROW_H`，常量不抄进组件。
//
// 上游画师 = `platform/vcs-log/impl/src/com/intellij/vcs/log/paint/SimpleGraphCellPainter.kt` 的 `MyPainter`：
//  · `paintEdge` `:147-170`：x = `elementWidth * position + elementCenter`（`:156`/`:166`），y1 = `rowCenter`（`:157`）。
//    两列相等 ⇒ 竖线，另一端按方向取 `rowHeight - arrowGap` 或 `arrowGap`，`arrowGap = circleRadius / 2 + 1`
//    只给终端单元（`:158-162`）；两列不等 ⇒ **直线画到邻行那一列的两倍长度**（`:163-169`，
//    原注释 "paint non-vertical lines twice the size to make them dock with each other well" ——
//    相邻两格各画自己那一半，两段在格边界的中点处正好对接），且那一档 assert(!isTerminal)（`:164`）⇒ 弯线不会有箭头。
//  · `paintCircle` `:172-187`：FILL = 实心圆；OUTLINE_AND_FILL = `headNodePainter.paint`（`:181`），
//    真身是三层同心圆「外=节点色 / 中=那一格的背景色 / 内=节点色」
//    （`platform/vcs-log/impl/src/com/intellij/vcs/log/paint/HeadNodePainter.kt:47-59`，层间距 `RADIUS_DELTA = 2` `:19`）。
//  · 线型：`isUsual = lineStyle == SOLID`（`:149`），只有**非实线且没有箭头**才换成虚线笔（`:127-134`）；
//    dash 数组由 `getDashLength` 按边长算：`dashCount = max(1, floor(len / rowHeight))`、
//    `space = rowHeight / 2 - 2`、`dash = len / dashCount - space`（`:219-229`）。
//  · 箭头：`ARROW_ANGLE_COS2 = 0.7`、`ARROW_LENGTH = 0.3`（`:201-202`），两条翅从箭头顶点按 ±θ 转出去
//    （`rotate` `:204-217`，画在 `:137-143`）。
//  · 画的顺序 = 集合顺序（`paint` `:40-56`），而生成侧把节点排在最后
//    （`platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/print/PrintElementGeneratorImpl.kt:128`、`:171`）
//    ⇒ 本模块同样先交线（strokes）再交圆（marks），组件按这个顺序渲染就是"线在下、点在上"。
import { laneX, ROW_H } from './vcsLogGraph.ts'
import type { GraphUnit } from './vcsLogGraph.ts'

/** 线宽 = 上游 `PaintParameters.THICK_LINE`（`platform/vcs-log/impl/src/com/intellij/vcs/log/paint/PaintParameters.java:11`）。 */
export const GRAPH_LINE_WIDTH = 1.5
/** 节点半径：本仓既有值（原组件的 `r="3.5"`，上游 `CIRCLE_RADIUS = 4` 在 22px 行高上，`PaintParameters.java:10`）。 */
export const GRAPH_NODE_RADIUS = 3.5
/** 头节点三层圆的层间距 = 上游 `RADIUS_DELTA`（`HeadNodePainter.kt:19`）。 */
export const GRAPH_HEAD_GAP = 2
/** 箭头翅长系数与张角余弦平方 = 上游 `ARROW_LENGTH` / `ARROW_ANGLE_COS2`（`SimpleGraphCellPainter.kt:201-202`）。 */
const ARROW_LENGTH = 0.3
const ARROW_ANGLE_COS = Math.sqrt(0.7)
const ARROW_ANGLE_SIN = Math.sqrt(1 - 0.7)

/** 一段线（竖线、弯线、箭头翅都用它）。`dash` 有值 ⇒ 虚线，值就是 `stroke-dasharray`。 */
export interface GraphStroke {
  x1: number; y1: number; x2: number; y2: number
  color: string
  dash?: string
}

/** 一个圆：`kind === 'gap'` 是头节点中间那层**背景色**（上游用 `commitStyle.background` 填它，`HeadNodePainter.kt:50-54`）。 */
export interface GraphMark {
  cx: number; cy: number; r: number
  color: string
  kind: 'fill' | 'gap'
}

export interface GraphRowPaint {
  strokes: GraphStroke[]
  marks: GraphMark[]
}

/**
 * 虚线的 dash 值。上游 `getDashLength`（`SimpleGraphCellPainter.kt:219-229`）：竖直那条边长恰好是一个行高
 * ⇒ "Exactly one dash and one space fits on the edge"；斜边保持同一个 space、把 dash 取大一点凑整数个 dash。
 * 返回给 SVG 的 `stroke-dasharray` 字符串（dash 在前、space 在后，与 `BasicStroke` 的 dash 数组同序）。
 */
export function dashArray(edgeLength: number, rowHeight: number = ROW_H): string {
  const dashCount = Math.max(1, Math.floor(edgeLength / rowHeight))
  const spaceLength = rowHeight / 2 - 2
  const dashLength = edgeLength / dashCount - spaceLength
  return `${round(dashLength)} ${round(spaceLength)}`
}

/** 一行单元 → 本行那格的图元。`units` 为空（`graphInformation` 为假）时什么都不画，与上游 `emptyList()` 一致。 */
export function paintGraphRow(units: readonly GraphUnit[]): GraphRowPaint {
  const strokes: GraphStroke[] = []
  const marks: GraphMark[] = []
  const rowCenter = ROW_H / 2
  for (const unit of units) {
    if (unit.kind === 'node') {
      const cx = laneX(unit.position)
      if (unit.shape === 'outlineAndFill') {
        // HeadNodePainter.kt:47-59 的三层：外圈实心 → 中间挖出底色 → 里面再一个实心点。
        marks.push({ cx, cy: rowCenter, r: GRAPH_NODE_RADIUS + GRAPH_HEAD_GAP, color: unit.color, kind: 'fill' })
        marks.push({ cx, cy: rowCenter, r: GRAPH_NODE_RADIUS, color: unit.color, kind: 'gap' })
        marks.push({ cx, cy: rowCenter, r: GRAPH_NODE_RADIUS - GRAPH_HEAD_GAP, color: unit.color, kind: 'fill' })
      }
      else marks.push({ cx, cy: rowCenter, r: GRAPH_NODE_RADIUS, color: unit.color, kind: 'fill' })
      continue
    }
    const isDown = unit.direction === 'down'
    const x1 = laneX(unit.position)
    const vertical = unit.position === unit.otherPosition
    // `:158-169`：竖线落在本格内（终端那一档留出箭头缺口），弯线画到格外两倍长、由本格裁掉一半。
    const gap = unit.hasArrow ? GRAPH_NODE_RADIUS / 2 + 1 : 0
    const x2 = vertical ? x1 : laneX(unit.otherPosition)
    const y2 = vertical ? (isDown ? ROW_H - gap : gap) : (isDown ? ROW_H + rowCenter : rowCenter - ROW_H)
    // `:127-134`：实线**或**带箭头都用实笔；只有既非实线又没箭头才换虚线笔。
    // 边长按上游取法：竖线一律按**一个行高**算（`:131` 的 `if (x1 == x2) rowHeight`，
    // 注释 `:220-221` "Exactly one dash and one space fits on the edge"），斜线按两点距离（本行那一段的两倍长端点）。
    const dashed = unit.style !== 'solid' && !unit.hasArrow
    const edgeLength = vertical ? ROW_H : Math.hypot(x2 - x1, y2 - rowCenter)
    strokes.push({ x1, y1: rowCenter, x2, y2, color: unit.color, dash: dashed ? dashArray(edgeLength) : undefined })
    if (unit.hasArrow) {
      // 箭头顶点：竖线用线段末端（`:161` 传的是 x2,y2），弯线用中点（`:168`）—— 上游 assert 弯线不是终端单元。
      const vx = vertical ? x2 : (x1 + x2) / 2
      const vy = vertical ? y2 : (rowCenter + y2) / 2
      for (const wing of arrowWings(x1, rowCenter, vx, vy, ARROW_LENGTH * ROW_H)) {
        strokes.push({ x1: vx, y1: vy, x2: wing.x, y2: wing.y, color: unit.color })
      }
    }
  }
  return { strokes, marks }
}

/** 上游 `rotate(x1, y1, startArrowX, startArrowY, √0.7, ±√0.3, ARROW_LENGTH * rowHeight)`（`:137-143` + `:204-217`）。 */
function arrowWings(fromX: number, fromY: number, vertexX: number, vertexY: number, length: number) {
  const dx = fromX - vertexX
  const dy = fromY - vertexY
  const distance = Math.hypot(dx, dy) || 1
  const scale = length / distance
  const vx = dx * scale
  const vy = dy * scale
  return [
    { x: vertexX + (vx * ARROW_ANGLE_COS - vy * ARROW_ANGLE_SIN), y: vertexY + (vx * ARROW_ANGLE_SIN + vy * ARROW_ANGLE_COS) },
    { x: vertexX + (vx * ARROW_ANGLE_COS + vy * ARROW_ANGLE_SIN), y: vertexY + (-vx * ARROW_ANGLE_SIN + vy * ARROW_ANGLE_COS) },
  ]
}

const round = (value: number) => Math.round(value * 100) / 100
