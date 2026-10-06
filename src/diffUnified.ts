// 差异查看器的**统一（unified）行表**与它的块级折叠/展开（上游 `tools/fragmented/` 那一族）。
//
// 上游口径（逐条开文件核过，行号是本机参考树的实际行号）：
//   · `platform/diff-impl/src/com/intellij/diff/tools/fragmented/UnifiedFragmentBuilder.kt:67-100`
//     `processChanged`：一个改动块在统一文档里是**先出删除行、再出新增行**
//     （`:80-84` 取左侧 `lines1` 那段、`:88-92` 取右侧 `lines2` 那段，中间夹一次 `totalLines` 快照），
//     块与块之间的未更改区间走 `processEquals`（`:57-65`）→ `appendTextMaster`（`:109-121`），
//     由 `masterSide` 决定那一侧的行入文（本仓两侧逐行对齐，等段两侧同行数，取左侧即可）；
//   · `platform/diff-impl/src/com/intellij/diff/tools/fragmented/UnifiedDiffChange.java:28-39`
//     一个改动 = `LineRange(blockStart, insertedStart)`（删除段）+ `LineRange(insertedStart, blockEnd)`（新增段），
//     所以"块"的身份是**删+增合起来的那一段**，本仓的 `block` 序号即它；
//   · 行号换算 `platform/diff-impl/src/com/intellij/diff/tools/fragmented/LineNumberConvertor.java:113-124`
//     （`Builder.put(masterStart, slaveStart, masterLength, slaveLength)`）+ `:245` / `:290`
//     （换算不到就返回 -1）—— 统一文档里新增行问不到原文件行号、删除行问不到新文件行号，
//     本仓把「换算不到」直接落成 `null`，渲染时那一侧的行号槽留空（与并排视图同一条规矩）；
//   · 折叠 `platform/diff-impl/src/com/intellij/diff/tools/fragmented/UnifiedFoldingModel.java:25-41`
//     `createState`：把**改动行区间**喂给 `FoldingModelSupport` 的构建器（改动之外即未更改），
//     `settings.range == -1`（`:36`）就直接不建折叠 —— 上下文范围「禁用」那一档在统一视图里同样生效，
//     规则与并排视图共用一张 `Settings`（`FoldingModelSupport.java:1264-1272`：`range` + `defaultExpanded`）、
//     同一套五档上下文与默认展开（`TextDiffSettingsHolder.kt:30`、`:59-60`）。
//
// 本仓差别（如实记）：
//   · 上游的统一视图是**一个真编辑器 + 折叠层**，行号来自那两个 convertor；本仓的行表由并排行表
//     （`src/bridge.ts:115` 的 `DiffRow[]`）机械换算而来，行号直接取行上已有的 `no`，
//     等价于 convertor 的 `convert`，但没有"文档变了就地修正"那一层（上游 `UnifiedDiffChange.processChange`，
//     `UnifiedDiffChange.java:74-79`）—— 本仓的差异是一次算好的静态行表，没有编辑器改写事件要对齐。
//   · 折叠区里上游显示的是面包屑描述（`UnifiedFoldingModel.java:70-74` 走
//     `getLineSeparatorDescription`，要 `PsiFile` + `FileBreadcrumbsCollector`）；本仓没有语言层，
//     那一行仍用 `src/diffFold.ts` 的「⋯ N 行未更改 ⋯」。

import { foldCandidates, foldForRun, type DiffFold, type UnchangedRun } from './diffFold.ts'
import type { DiffRow } from './bridge'

/** 统一文档里一行的种类：上下文（未更改）/ 删除 / 新增。 */
export type UnifiedKind = 'context' | 'delete' | 'insert'

/** 统一视图的一行（上游那里是编辑器里的一行文本 + 两个行号换算器的换算结果）。 */
export interface UnifiedRow {
  kind: UnifiedKind
  text: string
  /** 统一文档里的行下标（0 基）。 */
  index: number
  /** 原文件（左侧）行号，1 基；换算不到为 null（新增行）。 */
  leftNo: number | null
  /** 新文件（右侧）行号，1 基；换算不到为 null（删除行）。 */
  rightNo: number | null
  /** 行内高亮标记（`[起点, 长度]`），来自并排视图那一侧的 `leftMarks` / `rightMarks`。 */
  marks?: [number, number][]
  /** 这一行出自并排行表的哪一行（查找命中与差异导航用它把两侧坐标对上）。 */
  source: number
  /** 所属改动块序号；未更改行为 -1（上游一个 `UnifiedDiffChange` = 删段 + 增段，见 UnifiedDiffChange.java:28-39）。 */
  block: number
}

/** 渲染列表的一项：一行统一差异，或者一行"这里有 N 行未更改被收起"。 */
export type FoldedUnifiedItem =
  | { kind: 'row'; row: UnifiedRow; index: number }
  | { kind: 'fold'; fold: DiffFold; hidden: number; depth: number; layers: number }

/**
 * 并排行表 → 统一行表（`UnifiedFragmentBuilder` 的那次展开）：
 * 未更改行原样一行；改动块先出全部删除行、再出全部新增行。
 */
export function buildUnifiedRows(rows: readonly DiffRow[]): UnifiedRow[] {
  const out: UnifiedRow[] = []
  const push = (row: UnifiedRow): void => { out.push({ ...row, index: out.length }) }
  let i = 0
  let block = 0
  while (i < rows.length) {
    const current = rows[i]!
    if (current.kind === 'equal') {
      push({
        kind: 'context', text: current.left?.text ?? current.right?.text ?? '',
        index: 0, leftNo: current.left?.no ?? null, rightNo: current.right?.no ?? null, source: i, block: -1,
      })
      i++
      continue
    }
    let end = i
    while (end < rows.length && rows[end]!.kind !== 'equal') end++
    for (let k = i; k < end; k++) {
      const row = rows[k]!
      if (!row.left) continue
      const next: UnifiedRow = { kind: 'delete', text: row.left.text, index: 0, leftNo: row.left.no, rightNo: null, source: k, block }
      if (row.leftMarks?.length) next.marks = row.leftMarks
      push(next)
    }
    for (let k = i; k < end; k++) {
      const row = rows[k]!
      if (!row.right) continue
      const next: UnifiedRow = { kind: 'insert', text: row.right.text, index: 0, leftNo: null, rightNo: row.right.no, source: k, block }
      if (row.rightMarks?.length) next.marks = row.rightMarks
      push(next)
    }
    block++
    i = end
  }
  return out
}

/** 统一行表里的连续**未更改**段（上游那里就是"改动行之外"的那些行，UnifiedFoldingModel.java:31-40）。 */
export function unchangedUnifiedRuns(rows: readonly UnifiedRow[]): UnchangedRun[] {
  const runs: UnchangedRun[] = []
  let start = -1
  for (let i = 0; i <= rows.length; i++) {
    const context = i < rows.length && rows[i]!.kind === 'context'
    if (context && start < 0) start = i
    else if (!context && start >= 0) { runs.push({ start, end: i }); start = -1 }
  }
  return runs
}

/** 一处未更改段的全部候选折叠层（与并排视图同一个 `foldCandidates`：range / 2×range / 4×range）。 */
export function unifiedFoldCandidates(rows: readonly UnifiedRow[], contextRange: number): DiffFold[] {
  const folds: DiffFold[] = []
  for (const run of unchangedUnifiedRuns(rows)) folds.push(...foldCandidates(run, contextRange))
  return folds
}

/**
 * 每段未更改的**最外层**折叠（「折叠全部」用的那一张表，与并排视图的 `allFoldKeys` 同义 ——
 * 一处一段一个键，三层候选共用它）。
 */
export function unifiedFolds(rows: readonly UnifiedRow[], contextRange: number): DiffFold[] {
  const folds: DiffFold[] = []
  for (const run of unchangedUnifiedRuns(rows)) {
    const fold = foldForRun(run, contextRange)
    if (fold) folds.push(fold)
  }
  return folds
}

/**
 * 统一行表折成渲染列表。折叠状态与并排视图**分表存**（两边的行下标不是同一套坐标，
 * 混用会让统一视图收起并排视图里另一处段落）：`collapsed` 放的仍是「未更改段起点」。
 */
export function foldUnifiedRows(rows: readonly UnifiedRow[], contextRange: number, collapsed: ReadonlySet<number>,
  levels: ReadonlyMap<number, number> = new Map()): FoldedUnifiedItem[] {
  const items: FoldedUnifiedItem[] = []
  let index = 0
  for (const run of unchangedUnifiedRuns(rows)) {
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

/** 这一处折叠还能不能再往里展开一层（与并排视图 `foldCanStepDeep` 同一判据，坐标换成统一行表）。 */
export function unifiedFoldCanStepDeep(key: number, contextRange: number, rows: readonly UnifiedRow[], level: number): boolean {
  const run = unchangedUnifiedRuns(rows).find(r => r.start === key)
  if (!run) return false
  return level + 1 < foldCandidates(run, contextRange).length
}

/** 改动块 `block` 在统一行表里的第一行（F7 / Shift+F7 跳转的落点）；没有则 -1。 */
export function unifiedBlockStart(rows: readonly UnifiedRow[], block: number): number {
  const at = rows.findIndex(row => row.block === block)
  return at
}

/** 统一视图那一列的符号（上游是编辑器里的 `+` / `-` 行首；本仓把它做成行号槽后的第一列字符）。 */
export function unifiedSign(kind: UnifiedKind): string {
  return kind === 'insert' ? '+' : kind === 'delete' ? '-' : ' '
}
