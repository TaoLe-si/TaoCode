// 克隆光标（上/下）：上游 `EditorCloneCaretAbove` / `EditorCloneCaretBelow` 的键盘语义。
//
// 上游依据：
//  · 动作注册 `platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:218-219`
//    （`EditorCloneCaretBelow` / `EditorCloneCaretAbove` → `CloneCaretBelow` / `CloneCaretAbove`）。
//  · 动作组次序 `platform/platform-impl/resources/idea/PlatformActions.xml:199-200`（Below 在 Above 之前）。
//  · 文案 `platform/platform-resources-en/src/messages/ActionsBundle.properties:119-122`
//    （`Clone Caret Below` / `Clone Caret Above`）。中文包不在本地参考树里 ⇒ 菜单行的中文是直译。
//  · 键位：`platform/platform-resources/src/keymaps/$default.xml` **没有**这两条的绑定
//    （只有 `platform/platform-resources/src/keymaps/Sublime Text.xml:280-285` 给过 Ctrl+Alt+↑/↓），
//    而 `$default.xml:879-884` 把 Ctrl+Alt+Shift+↑/↓ 给了 `ResizeToolWindowUp/Down`。
//    本仓那对键在 `src/components/CodeEditor.vue:865-866` 已经绑给 `cursor.above` / `cursor.below`
//    （键位面是保留文件）⇒ 这里换的是**同名命令的实现**，键位栏保持仓库既有事实，不新编键。
//  · 本体行为 `platform/platform-impl/src/com/intellij/openapi/editor/actions/CloneCaretActionHandler.java`：
//      - `:24` 继承的是 `EditorActionHandler`（不是 `ForEachCaret`）⇒ 键盘路径走 `targetCaret == null`
//        那一支，也就是 `:64-101` 的「层级」逻辑。
//      - `:66-75` 只挑 |level| 最大的那一圈（首次调用时所有光标 level 都是 0 ⇒ 全体各克隆一次）。
//      - `:76` `removeCarets = currentLevel > 0 && myCloneAbove || currentLevel < 0 && !myCloneAbove`
//        ⇒ **朝反方向再按一次是删掉最外圈**，不是继续往下长。
//      - `:59`/`:92` 上限 `EditorUtil.checkMaxCarets`（`platform/platform-impl/src/com/intellij/openapi/editor/ex/util/EditorUtil.java:1381-1390`），
//        上限值取 `platform/util/resources/misc/registry.properties:484` 的 `editor.max.caret.count=1000`。
//  · 单个光标怎么克隆 `platform/platform-impl/src/com/intellij/openapi/editor/impl/CaretImpl.java:845-893`：
//      - `:847-852` 目标行 = 逻辑行 ± 1，越出文档 ⇒ 返回 null（**这就是「按到顶/到底就停」**）。
//      - `:861-877` 有选区时把选区两端各自挪一行、按目标行长度截断 ⇒ **选区跟着一起克隆**。
//      - `:888-889` 用的是 `myColumnNumberForCloning`（克隆链上一直传下去的那个原始列），
//        落点 `truncate(newLine, column)` = 列超过行宽就贴到行尾。
//
// 本仓与上游的一处实现差异（如实记）：上游把 level / 原始列放在 caret 的 user data 上，
// CodeMirror 的 Range 没有这个挂载点，而装 StateField 要改 `src/components/CodeEditor.vue`
// 的扩展表（保留文件）⇒ 这里把「是不是重复调用」做成**从选区本身推出来**的规则：
// 选区是一串行号连续、列位一致（或被行尾截断）、主光标停在最外圈的多光标 ⇒ 判定为克隆链，
// 与上游 `:66-76` 在同一条链上的取值等价；不满足就当首次调用（全体各克隆一次，等价于 level 全 0）。

import { EditorSelection } from '@codemirror/state'
import type { Command } from '@codemirror/view'

/** 上游 `editor.max.caret.count` 的默认值（`platform/util/resources/misc/registry.properties:484`）。 */
export const MAX_CARET_COUNT = 1000

/** 一个光标/选区的最小形状（文档坐标）。 */
export interface CloneRange { anchor: number; head: number }

/** 克隆后的新选区：范围 + 主光标下标。null = 什么都没发生（上游返回 null，命令据此不吞键）。 */
export interface ClonePlan { ranges: CloneRange[]; mainIndex: number }

export interface CloneInput {
  /** 当前选区，**按文档顺序**（CodeMirror 的 `selection.ranges` 就是这个顺序）。 */
  ranges: CloneRange[]
  mainIndex: number
  /** 每行的行首/行尾文档偏移（行尾不含换行）。 */
  lineStarts: number[]
  lineEnds: number[]
  /** true = 在上行克隆（`CloneCaretAbove`），false = 在下行（`CloneCaretBelow`）。 */
  above: boolean
  maxCarets?: number
}

/** 文档偏移 → 0 基行号。 */
export function lineAt(lineStarts: number[], offset: number): number {
  let low = 0
  let high = lineStarts.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (lineStarts[mid] <= offset) low = mid
    else high = mid - 1
  }
  return low
}

/** 上游 `CaretImpl.java:871-872` 的 `truncate(line, column)`：列位越过行宽就贴到行尾。 */
export function offsetAtColumn(lineStarts: number[], lineEnds: number[], line: number, column: number): number {
  return Math.min(lineStarts[line] + column, lineEnds[line])
}

interface Ring { range: CloneRange; line: number; column: number; lineLength: number }

/**
 * 「这串光标是不是一次克隆链的产物」——即上游 `:64-76` 里 |level| 最大那一圈的判定。
 * 成立的条件：一行一个光标、行号连续、列位能对上同一个「克隆链原始列」（被短行截断过的也算），
 * 并且主光标停在最外圈（上游每次 `addCaret(clone, true)` 都把焦点交给新克隆出来的那一圈）。
 * 成立时返回链的行进方向（-1 = 一路往上，1 = 一路往下），否则返回 0（当作首次调用）。
 */
function travelDirection(rings: Ring[], mainIndex: number): number {
  if (rings.length < 2) return 0
  for (let i = 1; i < rings.length; i++) if (rings[i].line !== rings[i - 1].line + 1) return 0
  const goingUp = mainIndex === 0
  const goingDown = mainIndex === rings.length - 1
  if (!goingUp && !goingDown) return 0
  // 原始列只能从现有列里推：链上出现过的那个最大列就是它（`CaretImpl.java:888-889` 往下传的那个数），
  // 比它小的列只能是「这一行不够长、贴到了行尾」。
  const column = Math.max(...rings.map(ring => ring.column))
  if (!rings.every(ring => ring.column === column || ring.column === ring.lineLength)) return 0
  return goingUp ? -1 : 1
}

/** 两端各挪一行、按目标行截断（`CaretImpl.java:861-877`）。列位用链上传下来的 `column`。 */
function cloneRangeTo(input: CloneInput, ring: Ring, column: number, lineShift: number): CloneRange | null {
  const headLine = ring.line + lineShift
  if (headLine < 0 || headLine >= input.lineStarts.length) return null
  const head = offsetAtColumn(input.lineStarts, input.lineEnds, headLine, column)
  const anchorLine = lineAt(input.lineStarts, ring.range.anchor) + lineShift
  if (anchorLine < 0 || anchorLine >= input.lineStarts.length) return { anchor: head, head }
  const anchorColumn = ring.range.anchor - input.lineStarts[lineAt(input.lineStarts, ring.range.anchor)]
  return { anchor: offsetAtColumn(input.lineStarts, input.lineEnds, anchorLine, anchorColumn), head }
}

/** 两个范围是否重叠（CodeMirror 的 selection 不允许重叠；上游靠 `doWithCaretMerging` 合并）。 */
function overlaps(a: CloneRange, b: CloneRange): boolean {
  return Math.min(a.anchor, a.head) < Math.max(b.anchor, b.head) &&
    Math.min(b.anchor, b.head) < Math.max(a.anchor, a.head)
}

/**
 * 一次克隆的完整计划：可能是「往外加一圈」，也可能是「往回收一圈」（`:76` 的 removeCarets）。
 * 返回 null 表示无事可做（越界、落点全被占用、或已到光标数上限）。
 */
export function cloneCaretPlan(input: CloneInput): ClonePlan | null {
  const lineShift = input.above ? -1 : 1
  const rings: Ring[] = input.ranges.map(range => {
    const line = lineAt(input.lineStarts, range.head)
    return { range, line, column: range.head - input.lineStarts[line], lineLength: input.lineEnds[line] - input.lineStarts[line] }
  })
  const travel = travelDirection(rings, input.mainIndex)
  const maxCarets = input.maxCarets ?? MAX_CARET_COUNT

  // 反方向再按一次 ⇒ 删掉最外圈那一个光标（`CloneCaretActionHandler.java:76-81`）。
  if (travel !== 0 && travel !== lineShift) {
    const kept = rings.filter((_, index) => index !== input.mainIndex).map(ring => ring.range)
    if (!kept.length) return null
    // 上游只调 removeCaret，没规定剩下的谁是主光标；这里取离被删的那圈最近的一个（新的最外圈），
    // 这样继续按同一个键能把整条链逐圈收回去。
    return { ranges: kept, mainIndex: travel < 0 ? 0 : kept.length - 1 }
  }

  // 首次调用（level 全 0）⇒ 每个光标各克隆一次；克隆链上继续往外 ⇒ 只克隆最外圈那一圈。
  const column = Math.max(...rings.map(ring => ring.column))
  const source = travel !== 0 ? [rings[input.mainIndex]] : rings
  const merged = input.ranges.slice()
  let last: CloneRange | null = null
  for (const ring of source) {
    if (merged.length >= maxCarets) break
    const next = cloneRangeTo(input, ring, column, lineShift)
    if (!next) continue
    if (merged.some(existing => existing.anchor === next.anchor && existing.head === next.head)) continue
    merged.push(next)
    last = next
  }
  if (!last) return null
  merged.sort((a, b) => Math.min(a.anchor, a.head) - Math.min(b.anchor, b.head))
  const kept: CloneRange[] = []
  for (const range of merged) {
    if (kept.some(existing => overlaps(existing, range))) continue
    kept.push(range)
  }
  // 主光标 = 最后加进来的那一圈（上游 `addCaret(clone, true)`）；它被重叠规则挤掉时退回原来的主光标。
  const mainIndex = kept.indexOf(kept.includes(last) ? last : input.ranges[input.mainIndex])
  return { ranges: kept, mainIndex: mainIndex < 0 ? 0 : mainIndex }
}

const cloneCaret = (above: boolean): Command => view => {
  const { state } = view
  const lineStarts: number[] = []
  const lineEnds: number[] = []
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n)
    lineStarts.push(line.from)
    lineEnds.push(line.to)
  }
  const plan = cloneCaretPlan({
    ranges: state.selection.ranges.map(range => ({ anchor: range.anchor, head: range.head })),
    mainIndex: state.selection.mainIndex,
    lineStarts, lineEnds, above,
  })
  if (!plan) return false
  view.dispatch({
    selection: EditorSelection.create(plan.ranges.map(range => EditorSelection.range(range.anchor, range.head)), plan.mainIndex),
    scrollIntoView: true, userEvent: 'select',
  })
  return true
}

/** `EditorCloneCaretAbove`：命令表里的 `cursor.above`。 */
export const cloneCaretAboveCommand = cloneCaret(true)
/** `EditorCloneCaretBelow`：命令表里的 `cursor.below`。 */
export const cloneCaretBelowCommand = cloneCaret(false)
