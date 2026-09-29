// 行级 diff（剪贴板对比与保存冲突预览共用）—— 从 App.vue 搬出的**纯函数**。
//
// 这一族的判据很干净：三个函数只吃字符串数组、只吐行/字符串，**不碰任何 App 状态**
// （所以它能直接单测，也不需要 ctx 注入）。
//   · `buildDiffRows`：左右对齐的行数组（change/delete/insert/equal），给"对比"视图用；
//   · `computeLCS`：最长公共子序列（DP），是上面那个对齐的依据；
//   · `generateUnifiedDiff`：文本形式的 unified diff。
import type { DiffRow } from './bridge'

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
export function computeLCS(a: string[], b: string[]): { from: number; to: number }[] {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) {
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  }
  const result: { from: number; to: number }[] = []
  let i = 0, j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) { result.push({ from: i, to: j }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++
  }
  return result
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
