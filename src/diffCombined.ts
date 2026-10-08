// 多文件**合成**差异与逐文件导航（上游 `CombinedDiffViewer`，`platform/diff-impl/src/com/intellij/diff/tools/combined/`）。
//
// 上游那张窗口把多个文件的差异块叠在一个滚动面里（`CombinedDiffBlocksPanel` 按 `BlockOrder` 排块），
// 导航分两档：`canGoNextDiff`/`goNextDiff`（块**内**的下一个差异，`CombinedDiffViewer.kt:314-341`）
// 与 `canGoNextBlock`/`goNextBlock`（下一个**文件**块，`:343-362`）。本仓没有 Swing 的块布局，
// 落成"当前看哪个文件 + 该文件内的差异导航"两层 —— 两层的边界语义都照上游：**不走回头路**
// （`canGoNext`/`canGoPrev` 在两端为假，`PrevNextDifferenceIterableBase` 的既有口径）。
//
// 本模块只有纯逻辑（文件表、当前位置、两层边界、标题），视图与取数在 `DiffView.vue`
// 与调用方（`SourceControl.vue` 的「查看全部差异…」）。行内差异导航复用 `src/diffNavigation.ts`。
import type { DiffRow } from './bridge.ts'

/** 合成差异里的一个文件块（上游 `CombinedDiffBlockContent` 的用户可见那半）。 */
export interface CombinedDiffFile {
  path: string
  /** 行上那句副标题（`（已暂存）`/`（与 main 的比较）`…），可省。 */
  subtitle?: string
  /** 这个文件的对齐行表（与单文件视图同一形状）。 */
  rows: DiffRow[]
  /** 这个文件的补丁文本（空串 = 没有）。 */
  unified: string
  /** 行表被截断（上游也有"块太大先放占位"那一档，`:220-223`）。 */
  truncated?: boolean
  /** git 的两列状态（`M`/`A`/`D`…），只用于行上那个记号。 */
  status?: string
}

/** 只保留有内容的文件块（行表或补丁至少有一个非空）—— 上游也是"没有差异就不建块"。 */
export function combinedFiles(files: readonly CombinedDiffFile[] | null | undefined): CombinedDiffFile[] {
  return (files ?? []).filter(file => file.path && (file.rows.length > 0 || file.unified.trim() !== ''))
}

/** 当前文件（越界时给 null，视图据此显示空态）。 */
export function activeCombinedFile(files: readonly CombinedDiffFile[], index: number): CombinedDiffFile | null {
  if (index < 0 || index >= files.length) return null
  return files[index] ?? null
}

/** 块间导航能不能走（两端为假 —— 与块内 `canGoNext`/`canGoPrev` 同一口径）。 */
export function canGoNextFile(index: number, count: number): boolean {
  return count > 0 && index >= 0 && index < count - 1
}
export function canGoPrevFile(index: number, count: number): boolean {
  return count > 0 && index > 0 && index <= count - 1
}

/**
 * 块间跳转（不绕圈，返回新下标；走不动时原样返回）。
 * 上游 `goNextBlock`/`goPrevBlock`（`CombinedDiffViewer.kt:346-362`）先滚到块的边界再选块 ——
 * 本仓一次只显示一个块，所以"跳到下一个块"就是把当前下标推进一格。
 */
export function stepFile(index: number, count: number, forward: boolean): number {
  if (forward) return canGoNextFile(index, count) ? index + 1 : index
  return canGoPrevFile(index, count) ? index - 1 : index
}

/** 当前位置文案（上游 `CombinedDiffMainToolbar` 的块计数那一档）。 */
export function filePositionLabel(index: number, count: number): string {
  if (count <= 0) return '0 / 0'
  return `${Math.min(Math.max(index, 0) + 1, count)} / ${count}`
}

/** 合成差异整份的增/删合计（行表口径与单文件视图一致）。 */
export function combinedStats(files: readonly CombinedDiffFile[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const file of files) {
    for (const row of file.rows) {
      if (row.kind === 'insert') ++added
      else if (row.kind === 'delete') ++removed
      else if (row.kind === 'change') { ++added; ++removed }
    }
  }
  return { added, removed }
}
