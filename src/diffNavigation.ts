// 差异导航（上游 `PrevNextDifferenceIterable` 一族，`platform/diff-impl/src/com/intellij/diff/tools/util/`）。
//
// 上游把「上一个 / 下一个差异」做成 `PrevNextDifferenceIterable`（`PrevNextDifferenceIterableBase.java:46-96`：
// `canGoNext` 在最后一条差异之后为 false、`canGoPrev` 在第一条之前为 false，**不走回头路**），
// 动作侧由 `DiffNextDifferenceAction` / `DiffPreviousDifferenceAction` 包装（ID `NextDiff` / `PrevDiff`）。
// 本仓的差异是**一行一行的 `DiffRow[]`**（`src/bridge.ts:105`），所以这里把它们按「相邻的非 equal 行合成一块」
// 折成差异块，再照上游的边界语义给出 `canGoNext` / `goNext` / `canGoPrev` / `goPrev`。
//
// 为什么相邻非 equal 行要合并：上游一个 change 是**连续区间**（`Range`），逐个改动行走会让
// 「下一个差异」在同一处改动里一格一格挪 —— 那是导航，不是找差异。

import type { DiffRow } from './bridge.ts'

/** 行下标闭区间 `[start, end]`（两端都含）。 */
export interface DiffChangeBlock { start: number; end: number }

/**
 * 把行表折成差异块：连续的 `insert` / `delete` / `change` 行合成一块；
 * `equal` 行是块与块之间的间隔。没有改动时返回空数组。
 */
export function changeBlocks(rows: readonly DiffRow[]): DiffChangeBlock[] {
  const blocks: DiffChangeBlock[] = []
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.kind === 'equal') continue
    const last = blocks[blocks.length - 1]
    if (last && last.end === i - 1) last.end = i
    else blocks.push({ start: i, end: i })
  }
  return blocks
}

/**
 * `PrevNextDifferenceIterableBase.canGoNext()` 的行表版：
 * 光标在最后一行、或最后一块差异已经在光标之前时，没有下一个。
 */
export function canGoNext(rows: readonly DiffRow[], blocks: readonly DiffChangeBlock[], row: number): boolean {
  if (!blocks.length) return false
  if (row >= rows.length - 1) return false
  return blocks[blocks.length - 1]!.start > row
}

/** `goNext()`：第一块起点在光标之后的差异；没有则返回 null。 */
export function goNext(blocks: readonly DiffChangeBlock[], row: number): DiffChangeBlock | null {
  for (const block of blocks) if (block.start > row) return block
  return null
}

/**
 * `canGoPrev()` 的行表版：光标在第一行、第一块还没开始、或光标落在第一块内部（且不在它末行）时为 false。
 */
export function canGoPrev(rows: readonly DiffRow[], blocks: readonly DiffChangeBlock[], row: number): boolean {
  if (!blocks.length) return false
  if (row <= 0 || row > rows.length - 1) return false
  const first = blocks[0]!
  // 上游 `LineRange.end` 是开区间，这里是闭区间行下标：`end > line` 对应 `end >= row`。
  if (first.end >= row) return false
  if (first.start >= row) return false
  return true
}

/**
 * `goPrev()`：照上游那轮「下一块的”终点 / 起点“已经越过光标」的判定，
 * 返回光标之前（或光标所在块之前）的那一块；没有则返回 null。
 */
export function goPrev(blocks: readonly DiffChangeBlock[], row: number): DiffChangeBlock | null {
  for (let i = 0; i < blocks.length; i++) {
    const change = blocks[i]!
    const next = i < blocks.length - 1 ? blocks[i + 1]! : null
    // 同样把上游的开区间终点折成闭区间行下标。
    if (next === null || next.end >= row || next.start >= row) return change
  }
  return null
}
