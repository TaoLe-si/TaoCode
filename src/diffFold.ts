// diff 查看器的**未更改片段折叠**（上游 `FoldingModelSupport` 的功能落点）。
//
// 上游要点（逐条核过）：
//   · 上下文范围五档 `CONTEXT_RANGE_MODES = intArrayOf(1, 2, 4, 8, -1)`（`TextDiffSettingsHolder.kt:30`），
//     默认 **4**（`:59` 的 `CONTEXT_RANGE: Int = 4`），最后一档 -1 = 禁用
//     （文案 `configurable.diff.collapse.unchanged.ranges.disable`，中文包 `DiffBundle.properties:75` = 禁用）；
//   · 每一段未更改的行按 shift = range / 2×range / 4×range 生成三层候选块
//     （`FoldingModelSupport.java:1234-1241` 的 `getRangeShift`，`addGroup` 在 `:288-303`），
//     **藏起来的行数 < 2 就不生成折叠区**（`createBlock` 的 `ends - starts < 2`，`:310`）；
//   · 默认**展开**（`EXPAND_BY_DEFAULT: Boolean = true`，`TextDiffSettingsHolder.kt:59`）；
//   · 工具栏那个开关 `collapse.unchanged.fragments`（`TextDiffViewerUtil.java:443`，中文包 `:63` = 收起未更改的片段）
//     是"折叠/展开全部"；上下文范围 = 禁用时它**整个不可见**（`TextDiffViewerUtil.java:455` 的
//     `setVisible(getContextRange() != -1 && isEnabled())`）。
//
// 本仓差别（如实记）**：上游折叠区里塞的是 5 个空格的占位文本（`PLACEHOLDER = "     "`，`:86`），
// 被藏起来的行数**不显示**；本仓在那一行上写出「⋯ N 行未更改 ⋯」，因为本仓的行号槽不像 IDEA 那样
// 在折叠处给出区间提示。除此之外的规则（三层候选 `:1234-1241`、点一次只往里展开一层
// `ExpandSuggester`、默认展开、禁用时无折叠、藏不足 2 行不生成区）都照上游。
import type { DiffRow } from './bridge'

/** 上下文范围五档 —— 逐字照抄上游 `CONTEXT_RANGE_MODES`。 */
export const CONTEXT_RANGE_MODES = [1, 2, 4, 8, -1] as const
/** 上游默认（`TextDiffSettingsHolder.kt:59`）。 */
export const DEFAULT_CONTEXT_RANGE = 4
/** `configurable.diff.collapse.unchanged.ranges.disable` 的中文取值。 */
export const CONTEXT_RANGE_DISABLED = '禁用'
/** 下拉里五档的显示文本 —— 前四档上游就是数字本身（`CONTEXT_RANGE_MODE_LABELS`）。 */
export const CONTEXT_RANGE_LABELS: Record<number, string> = { 1: '1', 2: '2', 4: '4', 8: '8', '-1': CONTEXT_RANGE_DISABLED }
/** `collapse.unchanged.fragments` 的中文取值。 */
export const COLLAPSE_UNCHANGED_TEXT = '收起未更改的片段'
/** 那一行折叠标记上的分组名（本仓自己的措辞，见文件头）。 */
export const FOLD_GROUP_LABEL = '未更改片段'

/** 一段未更改的行（半开区间 `[start, end)`，下标落在行数组上）。 */
export interface UnchangedRun {
  start: number
  end: number
}

/** 一处折叠：整段未更改的行 + 折叠时要藏掉的那一段。 */
export interface DiffFold {
  runStart: number
  runEnd: number
  /** 折叠时藏起来的区间（半开）—— 展开时这一段照常显示。 */
  hiddenFrom: number
  hiddenTo: number
}

/** 渲染列表的一项：一行差异，或者一行"这里有 N 行未更改被收起"。 */
export type FoldedItem =
  | { kind: 'row'; row: DiffRow; index: number }
  | { kind: 'fold'; fold: DiffFold; hidden: number; depth: number; layers: number }

/** 找出所有连续未更改段（`equal` 行）。 */
export function unchangedRuns(rows: readonly DiffRow[]): UnchangedRun[] {
  const runs: UnchangedRun[] = []
  let start = -1
  for (let i = 0; i <= rows.length; i++) {
    const equal = i < rows.length && rows[i]!.kind === 'equal'
    if (equal && start < 0) start = i
    else if (!equal && start >= 0) { runs.push({ start, end: i }); start = -1 }
  }
  return runs
}

/**
 * 第 `depth` 层候选块的上下文行数（上游 `getRangeShift`，`FoldingModelSupport.java:1234-1241`：
 * `case 0 -> range; case 1 -> range * 2; case 2 -> range * 4; default -> -1`）。
 * 返回 -1 = 没有这一层（上游用它作循环的结束条件，`:291`）。
 */
export function rangeShift(range: number, depth: number): number {
  if (depth === 0) return range
  if (depth === 1) return range * 2
  if (depth === 2) return range * 4
  return -1
}

/**
 * 一段未更改的行的**三层候选**（上游 `addGroup` 的 `for (number = 0; ; number++)` 循环，
 * `FoldingModelSupport.java:289-298`）：每层各生成一个 block，能被 `createBlock` 留下的
 * （藏起来 ≥2 行，`:310`）才算一层，按藏得最多 → 最少排列，后者嵌在前者里面。
 *
 * 上游把这三层都做成折叠区，点一下只展开**一层**（`ExpandSuggester.isExpanded(block)`，`:403/:418/:455`）；
 * 本仓原来只做"全折/全展"两态，这里补齐逐级那一半。
 */
export function foldCandidates(run: UnchangedRun, contextRange: number): DiffFold[] {
  if (contextRange < 0) return []
  const folds: DiffFold[] = []
  for (let depth = 0; ; depth++) {
    const shift = rangeShift(contextRange, depth)
    if (shift === -1) break
    const fold = foldForRun({ start: run.start, end: run.end }, shift)
    if (fold) folds.push(fold)
  }
  return folds
}

/**
 * 一段未更改的行在某一档上下文范围下的折叠（`null` = 藏不了 ≥2 行，上游不生成折叠区）。
 *
 * 三层都收起来时**可见结果等于包得最外的那一层**（`depth = 0`，`shift = range`，藏得最多），
 * 这就是"折叠"态；展开时按 `foldCandidates` 一层一层往里退。
 */
export function foldForRun(run: UnchangedRun, contextRange: number): DiffFold | null {
  if (contextRange < 0) return null
  const hiddenFrom = run.start + contextRange
  const hiddenTo = run.end - contextRange
  if (hiddenTo - hiddenFrom < 2) return null
  return { runStart: run.start, runEnd: run.end, hiddenFrom, hiddenTo }
}

/** 整份行数组里的所有折叠（顺序即出现顺序）。`contextRange < 0`（禁用）时为空。 */
export function diffFolds(rows: readonly DiffRow[], contextRange: number): DiffFold[] {
  if (contextRange < 0) return []
  const folds: DiffFold[] = []
  for (const run of unchangedRuns(rows)) {
    const fold = foldForRun(run, contextRange)
    if (fold) folds.push(fold)
  }
  return folds
}

/** 折叠区的标识 —— 用它记住哪些被收起来了（同一份差异里位置就是身份）。 */
export function foldKey(fold: DiffFold): number {
  return fold.runStart
}

/** 全部折叠区的标识（"折叠全部"）。 */
export function allFoldKeys(rows: readonly DiffRow[], contextRange: number): number[] {
  return diffFolds(rows, contextRange).map(foldKey)
}

/** 折叠标记上那一句（本仓的呈现，见文件头）。 */
export function foldLabel(hidden: number): string {
  return `⋯ ${hidden} 行未更改 ⋯`
}

/**
 * 把行数组折成渲染列表：收起来的折叠区变成一行 `fold`，其余照旧。
 * `collapsed` 里放的是 `foldKey`；`levels` 记每一处已经往里展开到第几层候选
 * （`0` = 最外层、藏得最多，缺省即 0），点一次只退一层，与上游 `ExpandSuggester` 一致。
 */
export function foldRows(rows: readonly DiffRow[], contextRange: number, collapsed: ReadonlySet<number>,
  levels: ReadonlyMap<number, number> = new Map()): FoldedItem[] {
  const items: FoldedItem[] = []
  let index = 0
  for (const run of unchangedRuns(rows)) {
    const layers = foldCandidates(run, contextRange)
    if (!layers.length || !collapsed.has(run.start)) continue
    const depth = Math.min(levels.get(run.start) ?? 0, layers.length - 1)
    const fold = layers[depth]!
    while (index < fold.hiddenFrom) { items.push({ kind: 'row', row: rows[index]!, index }); index++ }
    items.push({ kind: 'fold', fold, hidden: fold.hiddenTo - fold.hiddenFrom, depth, layers: layers.length })
    index = fold.hiddenTo
  }
  while (index < rows.length) { items.push({ kind: 'row', row: rows[index]!, index }); index++ }
  return items
}

/** 这一处折叠还有没有"再往里展开一层"的余地（点到底层就整段露出来）。 */
export function foldCanStepDeep(foldKey: number, contextRange: number, rows: readonly DiffRow[], level: number): boolean {
  const run = unchangedRuns(rows).find(r => r.start === foldKey)
  if (!run) return false
  return level + 1 < foldCandidates(run, contextRange).length
}
