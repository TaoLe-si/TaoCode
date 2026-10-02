// 行级 diff（剪贴板对比与保存冲突预览共用）—— 从 App.vue 搬出的**纯函数**。
//
// 这一族的判据很干净：三个函数只吃字符串数组、只吐行/字符串，**不碰任何 App 状态**
// （所以它能直接单测，也不需要 ctx 注入）。
//   · `buildDiffRows`：左右对齐的行数组（change/delete/insert/equal），给"对比"视图用；
//   · `computeLCS`：最长公共子序列（Myers O(ND) 线性空间），是上面那个对齐的依据；
//   · `generateUnifiedDiff`：文本形式的 unified diff。
//
// 对齐内核本身在 `diffAlign.ts`（Myers O(ND) 线性空间，移植自上游 `Diff` + `MyersLCS`）。
// 这里保留 `computeLCS` 这个名字与 `{from,to}` 形状 —— 它是这个模块的既有对外契约。
import type { DiffRow } from './bridge'
import { alignLines } from './diffAlign.ts'

// Line-level diff rows shared by the clipboard compare and the save-conflict
// preview (left/right aligned, change/delete/insert/equal kinds).
export function buildDiffRows(beforeLines: string[], afterLines: string[]): DiffRow[] {
  const lcs = computeLCS(beforeLines, afterLines)
  const rows: DiffRow[] = []
  let bi = 0, ai = 0, li = 0
  while (bi < beforeLines.length || ai < afterLines.length) {
    if (li < lcs.length && bi < lcs[li].from && ai < lcs[li].to) {
      rows.push({ kind: 'change', left: { no: bi + 1, text: beforeLines[bi] }, right: { no: ai + 1, text: afterLines[ai] } })
      bi++; ai++
    } else if (li < lcs.length && bi < lcs[li].from) {
      rows.push({ kind: 'delete', left: { no: bi + 1, text: beforeLines[bi] } })
      bi++
    } else if (li < lcs.length && ai < lcs[li].to) {
      rows.push({ kind: 'insert', right: { no: ai + 1, text: afterLines[ai] } })
      ai++
    } else if (li < lcs.length) {
      rows.push({ kind: 'equal', left: { no: bi + 1, text: beforeLines[bi] }, right: { no: ai + 1, text: afterLines[ai] } })
      bi++; ai++; li++
    } else {
      if (bi < beforeLines.length) rows.push({ kind: 'delete', left: { no: bi + 1, text: beforeLines[bi] } })
      if (ai < afterLines.length) rows.push({ kind: 'insert', right: { no: ai + 1, text: afterLines[ai] } })
      bi++; ai++
    }
  }
  return rows
}
/**
 * 最长公共子序列：返回按下标升序的 `{from,to}` 配对（`from` 落在 before、`to` 落在 after）。
 *
 * 算法是 Myers O(ND) 线性空间（`diffAlign.ts`，移植上游 `Diff.buildChanges` + `MyersLCS`）。
 * 换掉之前的 DP 表实现，是因为 DP 要开 (m+1)×(n+1) 的完整表：实测 10 000 行对 10 000 行
 * 要 1.4 秒、堆涨 773 MB，而且这是**跑在 UI 线程上**的（剪贴板对比 / 保存冲突预览）。
 * 换成同一算法后同样的输入是 10 毫秒、0.5 MB。
 */
export function computeLCS(a: string[], b: string[]): { from: number; to: number }[] {
  return alignLines(a, b)
}
export function generateUnifiedDiff(a: string[], b: string[]): string {
  const lcs = computeLCS(a, b)
  const lines: string[] = ['--- 当前文件', '+++ 剪贴板', '@@ -1 +1 @@']
  let ci = 0, ki = 0, li = 0
  while (ci < a.length || ki < b.length) {
    if (li < lcs.length && ci < lcs[li].from) { lines.push(`-${a[ci]}`); ci++ }
    else if (li < lcs.length && ki < lcs[li].to) { lines.push(`+${b[ki]}`); ki++ }
    else if (li < lcs.length) { lines.push(` ${a[ci]}`); ci++; ki++; li++ }
    else { if (ci < a.length) lines.push(`-${a[ci]}`); if (ki < b.length) lines.push(`+${b[ki]}`); ci++; ki++ }
  }
  return lines.join('\n')
}
