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
import { comparisonKeys, DEFAULT_COMPARISON_POLICY, shouldTrimChunks, whitespaceOnlyDifference, type ComparisonPolicy } from './diffComparison.ts'
import { smartLineMatch } from './diffSmartLines.ts'
import { DEFAULT_HIGHLIGHT_POLICY, marksFor, type HighlightPolicy } from './diffWords.ts'

/** `buildDiffRows` 的两个档位（上游 `TextDiffSettingsHolder.PlaceSettings` 的 `IGNORE_POLICY` + `HIGHLIGHT_POLICY`）。 */
export interface DiffOptions {
  /** 空白怎么算（上游 `IgnorePolicy` → `ComparisonPolicy`）。默认 `default` = 尾随空格算不同。 */
  comparison?: ComparisonPolicy
  /** 行内高亮档（上游 `HighlightPolicy`）。默认 `byWord`。 */
  highlight?: HighlightPolicy
}

// Line-level diff rows shared by the clipboard compare and the save-conflict
// preview (left/right aligned, change/delete/insert/equal kinds).
//
// `options` 是本批新加的（默认值 = 上游默认：`IgnorePolicy.DEFAULT` + `HighlightPolicy.BY_WORD`），
// 不传时行为与之前**逐字节相同** —— 三个调用点（`src/vcsActions.ts:122`、
// `src/editorFileOps.ts:54`、`src/components/DiffView.vue` 的父级）因此一行都不用改。
export function buildDiffRows(beforeLines: string[], afterLines: string[], options: DiffOptions = {}): DiffRow[] {
  const comparison = options.comparison ?? DEFAULT_COMPARISON_POLICY
  const highlight = options.highlight ?? DEFAULT_HIGHLIGHT_POLICY
  // 对齐按**折过的**行做（上游同样如此：比的是 comparison policy 看到的东西），
  // 但渲染与词级高亮用的是**原文**。
  //
  // 对齐用**两步比对**（上游 `ByLineRt.compareSmart` + `SmartLineChangeCorrector`，见
  // `src/diffSmartLines.ts`）：先钉住"大行"（非空白字符 > 3 的行），再在两条大行之间的空隙里
  // 做一次局部 LCS。全局 LCS 在并列最优时会随便挑一种配法，短行（括号/空行）就可能配错位置；
  // 两步比对让大行的配对稳定下来（实测：`if (x) { / a(); / }` 那组里它会认"括号挪了"，
  // 而 LCS 会认成"语句挪了"）。
  //
  // **保底一条**：上游在这之后还有 `optimizeLineChunks` 与 `expandRanges` /
  // `correctChangesSecondStep` 两道修补，本仓没做 —— 所以这里加一条"配对数不许比普通 LCS 少"
  // 的判据（少配一定更差，多配/同样多则取语义更好的那一种）。
  const keysBefore = comparison === 'default' ? beforeLines : comparisonKeys(beforeLines, comparison)
  const keysAfter = comparison === 'default' ? afterLines : comparisonKeys(afterLines, comparison)
  const plain = comparison === 'default'
    ? computeLCS(beforeLines, afterLines)
    : alignLines(keysBefore, keysAfter)
  const smart = smartLineMatch(keysBefore, keysAfter, beforeLines, afterLines)
  const lcs = smart.length >= plain.length ? smart : plain
  const rows: DiffRow[] = []
  let bi = 0, ai = 0, li = 0
  while (bi < beforeLines.length || ai < afterLines.length) {
    if (li < lcs.length && bi < lcs[li].from && ai < lcs[li].to) {
      const left = { no: bi + 1, text: beforeLines[bi]! }
      const right = { no: ai + 1, text: afterLines[ai]! }
      const marks = marksFor(highlight, left.text, right.text)
      const row: DiffRow = { kind: 'change', left, right }
      if (marks.left.length) row.leftMarks = marks.left
      if (marks.right.length) row.rightMarks = marks.right
      rows.push(row)
      bi++; ai++
    } else if (li < lcs.length && bi < lcs[li].from) {
      rows.push({ kind: 'delete', left: { no: bi + 1, text: beforeLines[bi]! } })
      bi++
    } else if (li < lcs.length && ai < lcs[li].to) {
      rows.push({ kind: 'insert', right: { no: ai + 1, text: afterLines[ai]! } })
      ai++
    } else if (li < lcs.length) {
      rows.push({ kind: 'equal', left: { no: bi + 1, text: beforeLines[bi]! }, right: { no: ai + 1, text: afterLines[ai]! } })
      bi++; ai++; li++
    } else {
      if (bi < beforeLines.length) rows.push({ kind: 'delete', left: { no: bi + 1, text: beforeLines[bi]! } })
      if (ai < afterLines.length) rows.push({ kind: 'insert', right: { no: ai + 1, text: afterLines[ai]! } })
      bi++; ai++
    }
  }
  return shouldTrimChunks(comparison) ? trimChunkEdges(rows) : rows
}

/**
 * 「忽略空格和空行」那一档多出来的一步：把**只差空白**的改动从每个改动块的首尾剪掉
 * （上游 `IgnorePolicy.isShouldTrimChunks()` → `ComparisonManagerImpl.processAdjoining`
 * 的 `trim && policy == IGNORE_WHITESPACES` 分支：从前往后、从后往前各剪一轮，
 * 遇到"真的不等"的行就停）。
 *
 * 剪掉的行**按未更改渲染**（上游是把那个 fragment 整个丢掉，那几行就落回 unchanged）：
 * 底色与行内标记都不再画，否则用户看到的还是"这块改了"，只是少了几个字。
 */
function trimChunkEdges(rows: DiffRow[]): DiffRow[] {
  const isChange = (row: DiffRow) => row.kind !== 'equal'
  for (let start = 0; start < rows.length;) {
    if (!isChange(rows[start]!)) { ++start; continue }
    let end = start
    while (end < rows.length && isChange(rows[end]!)) ++end
    let from = start
    let to = end
    while (from < to && whitespaceOnlyDifference(rows[from]!.left?.text, rows[from]!.right?.text)) ++from
    while (to > from && whitespaceOnlyDifference(rows[to - 1]!.left?.text, rows[to - 1]!.right?.text)) --to
    for (let i = start; i < from; i++) rows[i] = asUnchanged(rows[i]!)
    for (let i = to; i < end; i++) rows[i] = asUnchanged(rows[i]!)
    start = end
  }
  return rows
}

/** 一行"其实没改"的渲染形态：kind 归位、行内标记清掉。 */
function asUnchanged(row: DiffRow): DiffRow {
  const next: DiffRow = { kind: 'equal', left: row.left, right: row.right }
  return next
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
