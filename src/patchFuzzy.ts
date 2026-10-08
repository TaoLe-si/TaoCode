// 补丁块的**偏移搜索**（上游 `platform/vcs-impl/src/com/intellij/openapi/diff/impl/patch/apply/
// GenericPatchApplier.java` 的可移植子集）。
//
// 上游那条链是两级（`GenericPatchApplier.apply`，`:74-86`）：
//
//     1. 先 `PlainSimplePatchApplier.apply` —— 块头给出的行号**逐块核对上下文**，对不上就返回 null；
//     2. 再走 `GenericPatchApplier`：把块**在文件里挪一挪**再核对（`ourMaxWalk = 1000`，
//        `:41`），还不行才轮到「吃掉上下文行」的宽松匹配（`LongTryMismatchSolver`）。
//
// 第 1 级本仓已经落在 `src/patchApply.ts` 的 `applyHunksToText`（逐块核对、不 fuzz）。
// 本模块是第 2 级的**偏移搜索**那一半：块头的行号会因为文件在上游版本之后被别处改动而
// 偏掉，GNU patch 正是靠"往附近找一找"救回来的（上游那条链在 `PlainSimplePatchApplier`
// 失败后才进这里，所以**默认行为不变**）。
//
// **不做的（如实记）**：`LongTryMismatchSolver` 那种"忽略若干行上下文"的 fuzz（`--fuzz=N`）没有做：
// 它会**改写**匹配处的文本（上游的 `complementInsertAndDelete` 会把上下文行搬进改动两侧），
// 那是改内容而不是挪位置；本仓的补丁应用链是"要么按上下文对上、要么失败"，不引入会静默
// 改内容的路径。要模糊匹配就人工把上下文改窄后重试 —— 记在 `docs/inventory/verdict-platform_rest.md`。
//
// 纯逻辑（不 import bridge），能被 `node --test` 直接加载。
import type { PatchHunk } from './patchApply.ts'
import { detectLineSeparator, patchHunkStartIndex, splitPatchLines } from './vcsFileUtil.ts'

/** `GenericPatchApplier.ourMaxWalk`（`:41`）：从绑定点往两边各走多少行去找这个块。 */
export const MAX_WALK = 1000

/** 一处候选：块在文件里的位置（行下标，0 基）+ 与绑定点的距离。 */
export interface HunkPlacement {
  /** 块在原文里的起点行。 */
  line: number
  /** `Math.abs(line - 绑定点)`，0 = 就在块头说的位置。 */
  distance: number
}

/** 一个块在某一起点处能否对上：`before` 侧（context + remove）逐行相等。 */
function matchesAt(hunk: PatchHunk, source: readonly string[], line: number): boolean {
  const before = hunk.lines.filter(item => item.type !== 'add')
  if (line < 0 || line + before.length > source.length) return false
  for (let i = 0; i < before.length; i++) if (source[line + i] !== before[i]!.text) return false
  return true
}

/** 只取插入（`before` 侧为空）的块 —— 那种块没有锚点可找，任何位置都能插。 */
function isInsertion(hunk: PatchHunk): boolean {
  return hunk.lines.every(item => item.type !== 'remove' && item.type !== 'context')
}

/**
 * 给一个块找位置（上游 `ExactMatchSolver` + `getMatchingIterator` 的口径）：
 *
 *   · 就在块头给的位置 ⇒ 距离 0；
 *   · 否则从绑定点往**外**一圈圈找（先 −1、+1，再 −2、+2…），取**距离最小**的那一处；
 *   · 纯插入块没有锚点（上游 `SplitHunk.isInsertion` 那一路），直接回绑定点。
 *
 * 找不到返回 null（调用方按失败处理）。`floor` 是「这一块之前已经吃掉的内容行数」，
 * 用来保证不与上一块重叠（上游 `myTransformations` 的 TextRange 键不重叠）。
 */
export function findHunkPlacement(hunk: PatchHunk, source: readonly string[], floor = 0, maxWalk = MAX_WALK): HunkPlacement | null {
  // 绑定点与 `patchApply.applyHunksToText` 同一算法（`@@ -l,0` 的纯插入块：`l` 是「插在第 l 行之后」）。
  const bound = patchHunkStartIndex(hunk.beforeStart, hunk.beforeCount)
  if (isInsertion(hunk)) return { line: Math.max(floor, bound), distance: 0 }
  if (matchesAt(hunk, source, bound)) return { line: bound, distance: 0 }
  for (let step = 1; step <= maxWalk; step++) {
    // 先近后远：下标小的先试，与上游 `HunksComparator` 那套"尽早绑定"的口径一致。
    for (const line of [bound - step, bound + step]) {
      if (line < floor) continue
      if (matchesAt(hunk, source, line)) return { line, distance: step }
    }
  }
  return null
}

/** 一次成功应用的结果（`GenericPatchApplier.AppliedPatch`）。 */
export interface OffsetApplyResult {
  ok: boolean
  /** 成功时的新文本。 */
  text?: string
  /** 有几块是靠偏移找到位置的（0 = 全部对在块头说的行号上）。 */
  offsetHunks: number
  /** 失败时：第几块（1 基）与理由。 */
  hunk?: number
  reason?: string
}

/**
 * 逐块偏移搜索后应用（上游 `GenericPatchApplier` 的主循环 `execute` 的位置部分）。
 *
 * 逐块推进：每块都以上一块的结束行作 `floor`（`floor` = 上一块占掉的原文行数），保证块序不乱。
 * 与 `applyHunksToText` 一样，**任一块找不到就整文件失败** —— 不做部分应用。
 */
export function applyHunksWithOffsetSearch(text: string, hunks: readonly PatchHunk[]): OffsetApplyResult {
  const hadTrailingNewline = text.endsWith('\n')
  // 与 `patchApply.applyHunksToText` 同一口径：两侧都按 `LineTokenizer.tokenize(text, false)` 切行
  // （`\r`、`\n`、`\r\n` 都算分隔符且不留在行里），写回时用原文件的主行尾。
  const separator = detectLineSeparator(text)
  const source = splitPatchLines(text)
  const target: string[] = []
  let cursor = 0
  let offsetHunks = 0
  for (let index = 0; index < hunks.length; index++) {
    const hunk = hunks[index]!
    const placement = findHunkPlacement(hunk, source, cursor)
    if (!placement) {
      return { ok: false, offsetHunks, hunk: index + 1, reason: `第 ${index + 1} 块在附近 ±${MAX_WALK} 行内找不到能对上的上下文` }
    }
    if (placement.distance > 0) offsetHunks++
    for (let i = cursor; i < placement.line; i++) target.push(source[i] ?? '')
    let read = placement.line
    for (const line of hunk.lines) {
      if (line.type === 'add') { target.push(line.text); continue }
      if (line.type === 'context') target.push(source[read] ?? '')
      read++
    }
    cursor = read
  }
  for (let i = cursor; i < source.length; i++) target.push(source[i] ?? '')
  let result = target.join(separator)
  // 结尾换行的规矩与 `patchApply.applyHunksToText` 完全一致：块里最后一行带 `\ No newline`
  // 且这一块吃到文件末尾 ⇒ 结果不带结尾换行（上游 `PatchHunk.java:65-70` +
  // `apply/PlainSimplePatchApplier.java:74-79` + `apply/GenericPatchApplier.java:1139-1145`）。
  const lastHunk = hunks[hunks.length - 1]
  const touchesEnd = cursor >= (hadTrailingNewline ? source.length - 1 : source.length)
  const suppress = lastHunk?.lines[lastHunk.lines.length - 1]?.noNewline === true && touchesEnd
  if (suppress) {
    if (result.endsWith('\n')) result = result.slice(0, -1)
  } else if (hadTrailingNewline && !result.endsWith('\n') && result !== '') {
    // `result === ''` = 整份文件被删空 ⇒ 空文件（真 `git apply` 同款，见判据）。
    result += separator
  } else if (!hadTrailingNewline && result.endsWith('\n') && text !== '') {
    result = result.slice(0, -1)
  }
  return { ok: true, text: result, offsetHunks }
}

/**
 * 档位合成（上游 `GenericPatchApplier.getStatus`，`:121-139`）：
 * 一块都没挪过 = SUCCESS；挪过但都挪了 = 仍算 SUCCESS（偏移不改变内容，只改变落点）；
 * 有块已经应用过、别的块真应用了 = PARTIAL；挪不动 = FAILURE。
 */
export function offsetApplyStatus(result: OffsetApplyResult, alreadyApplied: boolean): 'success' | 'partial' | 'failure' {
  if (!result.ok) return 'failure'
  if (alreadyApplied) return 'partial'
  return 'success'
}
