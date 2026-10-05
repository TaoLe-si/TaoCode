// 「与剪贴板比较」—— 上游 `XCompareWithClipboardAction`
// （`platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/ui/tree/actions/XCompareWithClipboardAction.java:31-36`）
// 的等价物：把节点的值文本丢给 `DiffRequestFactory.createClipboardVsValue(value)`，
// 再 `DiffManager.getInstance().showDiff(project, request)`。
//
// 本仓的等价物是**复用本仓已有的行级 diff 引擎**（`src/diffText.ts` 的 `buildDiffRows`，
// 也就是保存冲突预览与「对比」视图用的那一份），不另写一份比对逻辑。
//
// 与上游的一处如实差异：上游父类 `XFetchValueSplitActionBase`（同目录 `.kt`）是
// 前后端分派基类，**不是**取 full value 的通道；上游比的就是节点的 value 文本。
// 本仓同样比变量行上的 `value` 文本 —— 但 DAP 对容器节点给的是摘要（`{…}`/`[0…5]`），
// 不是 full value，所以容器节点的比对结果是「摘要 vs 剪贴板」。调用方手里有更完整的
// 文本时（例如刚 `evaluate` 出来的结果）可以用 `fullValue` 显式传进来。

import { buildDiffRows, type DiffOptions } from './diffText.ts'
import type { DiffRow } from './bridge'

export interface ClipboardCompareInput {
  /** 剪贴板原文（空 = 没有可比的东西）。 */
  clipboard: string
  /** 节点的值文本；`fullValue` 给了就优先用它。 */
  value: string
  /** 节点名（标题用）。 */
  name: string
  /** 有更完整的值文本时传进来（适配器 evaluate 的结果）。 */
  fullValue?: string
}

export interface ClipboardCompareResult {
  /** 逐行对齐的 diff（clipboard 在左、value 在右）。 */
  rows: DiffRow[]
  /** 左右完全一样（上游会直接开一个无修改标记的 diff 窗口）。 */
  identical: boolean
  /** 一行都没有（两边都是空串）时的提示文案。 */
  empty: boolean
  title: string
}

/** 标题：上游 `DiffRequestFactory.createClipboardVsValue` 用节点名做标题。 */
export function clipboardCompareTitle(name: string): string {
  return `剪贴板 ↔ ${name}`
}

/**
 * 两边都按 `\n` 切行。值文本里的换行要参与比对，不能先压成一行
 * （上游 diff 的是完整 value 字符串，交给 diff 引擎自己切行）。
 */
export function clipboardCompare(
  input: ClipboardCompareInput, options: DiffOptions = {},
): ClipboardCompareResult {
  const value = input.fullValue ?? input.value
  const left = input.clipboard === '' ? [] : input.clipboard.split('\n')
  const right = value === '' ? [] : value.split('\n')
  const rows = buildDiffRows(left, right, options)
  const identical = rows.every(row => row.kind === 'equal')
  return { rows, identical, empty: rows.length === 0, title: clipboardCompareTitle(input.name) }
}

/**
 * 差了多少处（`change`/`delete`/`insert` 的行数）。给弹层底部一个「N 处不同」的
 * 摘要用 —— 与上游 diff 底部的统计是同一类信息。
 */
export function clipboardCompareChanges(rows: readonly DiffRow[]): number {
  return rows.filter(row => row.kind !== 'equal').length
}
