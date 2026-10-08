// 三方合并编辑器的**行模型**（上游 `MergeThreesideViewer` / `MergeRequest` / `MergeResult` /
// `TextMergeChange` 的等价物，用本仓架构还原）。
//
// 上游形状（逐条核过）：
//   · `ThreesideMergeRequest`（`platform/diff-api/src/com/intellij/diff/merge/ThreesideMergeRequest.java:10-23`）：
//     `getContents()` 三份（**left - middle - right**，注释写明 `local - base - server`）、
//     `getOutputContent()`（结果栏）、`getContentTitles()`；
//   · `TextMergeRequest`（同目录 `:9-19`）：三份是 `DocumentContent`，另有 `getConflictType()`；
//   · `MergeResult`（`platform/diff-api/src/com/intellij/diff/merge/MergeResult.java`）：
//     `LEFT` / `RIGHT` / `RESOLVED` / `CANCEL` 四档；
//   · `MergeThreesideViewer.handleAcceptSide`（`platform/diff-impl/src/com/intellij/diff/merge/MergeThreesideViewer.java:333-351`）：
//     「接受左侧/右侧」= 把**全部**改动换成那一侧（`replaceChanges(getAllChanges(), Side.LEFT/RIGHT, true)`）；
//     逐条接受是 `TextMergeChange` 的粒度。
//
// **本仓的输入**：没有伪文件系统，也没有 stage1/2/3 的取内容通道（`native/git.cpp` 的只读面里
// 没有冲突三阶段的 blob —— 补它要新增 `git.*` 方法，而方法名 union 在 `src/bridge.ts`、
// 分派在 `native/main.cpp`，两者都是本 lane 的禁改文件）。所以三份内容**从 git 写进工作区文件的
// 冲突标记里派生**（与 `src/mergeResolve.ts` / `src/mergeConflicts.ts` 同一份输入）：
//
//     <<<<<<< HEAD
//     我们的内容（左）
//     ||||||| <基线>        ← 只有 diff3 风格才有这一段
//     基线内容（中）
//     =======
//     他们的内容（右）
//     >>>>>>> feature/x
//
// 因此本模块给出**行模型**：把文件切成「未改动区（三栏相同）」与「冲突块（左/中/右三格）」，
// 每块标出能不能自动合（`canAutoResolve`），并提供逐块「接受左/右/两者」与整文件接受一侧的落点。
// 结果**就是这份文件本身**（接受 = 改标记文本），与上游"结果缓冲区"同理。
//
// **与上游的一处明确差异（如实记）**：上游只有「接受左侧」「接受右侧」两个按钮
// （`DiffBundle.properties:250-251` 只有这两条，`MergeThreesideViewer.java:335-336` 取的就是它们），
// **没有「接受两者」**。本仓按任务要求补了这一档（`acceptBoth`），它是本仓的扩展，不是上游行为。
//
// 本模块零依赖（只 import 纯算法模块），能被 `node --test` 直接加载。

import { acceptSide, parseConflicts, type Conflict, type ConflictSide } from './mergeConflicts.ts'
import { canAutoResolve, conflictSides, type ConflictSides } from './mergeResolve.ts'
import type { ComparisonPolicy } from './diffComparison.ts'

/** 三栏里的一格。`no` 是**这一栏自己**的行号（1 基，显示用）；`null` = 这一栏在这一行没有内容。 */
export interface MergeCell {
  no: number | null
  text: string
}

/** 一行（三格 + 归属）。 */
export interface MergeEditorRow {
  /** `equal` = 未改动区（三格相同）；`conflict` = 冲突块的一行。 */
  kind: 'equal' | 'conflict'
  /** 冲突块序号（`equal` 行为 -1）。 */
  block: number
  left: MergeCell | null
  base: MergeCell | null
  right: MergeCell | null
}

/** 一个冲突块（上游 `TextMergeChange` 的可观察字段）。 */
export interface MergeBlock {
  /** 在 `parseConflicts` 里的下标（导航与"接受第 n 块"用它）。 */
  index: number
  /** 能不能自动合（`MergeConflictModel.hasAutoResolvableConflictedChanges` 落到单块上）。 */
  resolvable: boolean
  /** 三份文本（行数组）。 */
  sides: ConflictSides
  /** diff3 基线段在不在（不在时中栏只能显示"无基线段"）。 */
  hasBase: boolean
  /** 起始行（0 基，显示与导航用）。 */
  startLine: number
  endLine: number
}

/** 整个编辑器的模型。 */
export interface MergeEditorModel {
  rows: MergeEditorRow[]
  blocks: MergeBlock[]
  /** 三栏的总行数（表头用）。 */
  lineCounts: { left: number; base: number; right: number }
  /** 三份内容各自的行数组（`getContents()` 的等价物）。 */
  panes: { left: string[]; base: string[]; right: string[] }
}

/** 一份带冲突标记的文件 → 三份内容（上游 `getContents()` 的等价物）。 */
export function mergePanes(content: string): { left: string[]; base: string[]; right: string[] } {
  const lines = content.split('\n')
  const conflicts = parseConflicts(content)
  const left: string[] = []
  const base: string[] = []
  const right: string[] = []
  let cursor = 0
  for (const conflict of conflicts) {
    for (let i = cursor; i < conflict.startLine; i++) { left.push(lines[i]!); base.push(lines[i]!); right.push(lines[i]!) }
    const sides = conflictSides(lines, conflict)
    left.push(...sides.left)
    right.push(...sides.right)
    // 没有 diff3 基线段时中栏这一段留空（不伪造：拿 ours 当 base 会让"改没改"的判定全错）。
    base.push(...sides.base)
    cursor = conflict.endLine + 1
  }
  for (let i = cursor; i < lines.length; i++) { left.push(lines[i]!); base.push(lines[i]!); right.push(lines[i]!) }
  return { left, base, right }
}

/** 冲突块的清单（含"能不能自动合"与三份文本）。 */
export function mergeBlocks(content: string, policy: ComparisonPolicy = 'default'): MergeBlock[] {
  const lines = content.split('\n')
  return parseConflicts(content).map((conflict, index) => {
    const sides = conflictSides(lines, conflict)
    return {
      index, resolvable: canAutoResolve(sides, policy), sides, hasBase: conflict.baseLine !== null,
      startLine: conflict.startLine, endLine: conflict.endLine,
    }
  })
}

/**
 * 行模型：未改动区（三栏相同，逐行一一对应）与冲突块（三栏各自的行，按最长的一栏补空）。
 * 行号是**每一栏自己的**（左栏只有左栏的号、中栏只有中栏的号）—— 上游三栏是三个独立编辑器，
 * 各带各的 `LineNumberConvertor`。
 */
export function buildMergeEditorModel(content: string, policy: ComparisonPolicy = 'default'): MergeEditorModel {
  const lines = content.split('\n')
  const conflicts = parseConflicts(content)
  const blocks = mergeBlocks(content, policy)
  const rows: MergeEditorRow[] = []
  const panes = { left: [] as string[], base: [] as string[], right: [] as string[] }
  let cursor = 0
  const pushEqual = (from: number, to: number) => {
    for (let i = from; i < to; i++) {
      const text = lines[i]!
      panes.left.push(text); panes.base.push(text); panes.right.push(text)
      rows.push({
        kind: 'equal', block: -1,
        left: { no: panes.left.length, text }, base: { no: panes.base.length, text }, right: { no: panes.right.length, text },
      })
    }
  }
  conflicts.forEach((conflict, index) => {
    pushEqual(cursor, conflict.startLine)
    const sides = conflictSides(lines, conflict)
    const block = blocks[index]!
    const height = Math.max(sides.left.length, sides.base.length, sides.right.length, 1)
    for (let i = 0; i < height; i++) {
      const ours = sides.left[i]
      const theirs = sides.right[i]
      const baseline = sides.base[i]
      let left: MergeCell | null = null
      let base: MergeCell | null = null
      let right: MergeCell | null = null
      if (ours !== undefined) { panes.left.push(ours); left = { no: panes.left.length, text: ours } }
      if (baseline !== undefined) { panes.base.push(baseline); base = { no: panes.base.length, text: baseline } }
      if (theirs !== undefined) { panes.right.push(theirs); right = { no: panes.right.length, text: theirs } }
      rows.push({ kind: 'conflict', block: index, left, base, right })
    }
    cursor = conflict.endLine + 1
  })
  pushEqual(cursor, lines.length)
  return { rows, blocks, lineCounts: { left: panes.left.length, base: panes.base.length, right: panes.right.length }, panes }
}

/** 逐块接受一侧（上游 `TextMergeChange` 的粒度）：把第 `index` 块换成那一侧的内容。 */
export function acceptBlock(content: string, index: number, side: ConflictSide): string {
  const conflicts = parseConflicts(content)
  const conflict = conflicts[index]
  return conflict ? acceptSide(content, conflict, side) : content
}

/**
 * 逐块「接受两者」（**本仓扩展**，上游没有这一档）：先左后右拼起来。
 * 右栏为空时就是接受左侧、左栏为空时就是接受右侧 —— 退化情形不另造内容。
 */
export function acceptBoth(content: string, index: number): string {
  const conflicts = parseConflicts(content)
  const conflict = conflicts[index]
  if (!conflict) return content
  const lines = content.split('\n')
  const sides = conflictSides(lines, conflict)
  return [...lines.slice(0, conflict.startLine), ...sides.left, ...sides.right, ...lines.slice(conflict.endLine + 1)].join('\n')
}

/** 整文件接受一侧（上游 `handleAcceptSide` 的 `getAllChanges()`）：每一块都取那一侧。 */
export function acceptAllBlocks(content: string, side: ConflictSide): string {
  let text = content
  let remaining = parseConflicts(text).length
  while (remaining > 0) {
    text = acceptSide(text, parseConflicts(text)[remaining - 1]!, side)
    remaining--
  }
  return text
}

/** 第 `index` 块接受之后，下一个该看的块（收尾时回 0；没有块时回 -1）。 */
export function nextBlockIndex(content: string, index: number): number {
  const count = parseConflicts(content).length
  if (!count) return -1
  return index >= count ? 0 : index
}

/** 上一个/下一个冲突块（走完一圈回绕，与编辑器里的 `MergeBar` 同一语义）。 */
export function stepBlock(count: number, current: number, forward: boolean): number {
  if (count <= 0) return -1
  if (current < 0) return forward ? 0 : count - 1
  return forward ? (current + 1) % count : (current - 1 + count) % count
}

/** 块状态文案（「第 n 块，共 m 块」；没有块时空串）。 */
export function blockStatus(count: number, current: number): string {
  if (count <= 0) return ''
  const at = current < 0 ? 0 : current
  return `${at + 1}/${count}`
}

/** 三栏的表头标题（上游 `getContentTitles()`）：左 = 我们的、中 = 基线、右 = 他们的。 */
export const MERGE_TITLES = { left: '您的版本', base: '基线', right: '他们的版本' } as const
/** 中栏没有 diff3 基线段时那句（不伪造基线）。 */
export const NO_BASE_NOTE = '（没有基线段：只有 diff3 风格的冲突才有）'
/** 能自动合的块那句（对应菜单里的「解决简单的冲突」）。 */
export const AUTO_RESOLVABLE_NOTE = '这一块可以自动合并'
/** 「接受两者」是本仓扩展的说明（上游只有左/右两个按钮）。 */
export const ACCEPT_BOTH_NOTE = '接受两者（本仓扩展；上游只有接受左侧/接受右侧）'
/** 冲突块标头（上游 `VcsBundle.properties:271` 的 `Resolve` 链接那一族）。 */
export const CONFLICT_BLOCK_LABEL = '冲突'
/** 「接受两者」按钮文案（本仓扩展）。 */
export const ACCEPT_BOTH_TEXT = '接受两者'