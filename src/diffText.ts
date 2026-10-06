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
import { DEFAULT_COMPARISON_POLICY, shouldTrimChunks, whitespaceOnlyDifference, type ComparisonPolicy } from './diffComparison.ts'
import { compareLineMatch } from './diffSmartLines.ts'
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
// 默认值 = 上游默认：`IgnorePolicy.DEFAULT` + `HighlightPolicy.BY_WORD`。
// 既有调用点通过同一入口消费完整的行级修正链。
export function buildDiffRows(beforeLines: string[], afterLines: string[], options: DiffOptions = {}): DiffRow[] {
  const comparison = options.comparison ?? DEFAULT_COMPARISON_POLICY
  const highlight = options.highlight ?? DEFAULT_HIGHLIGHT_POLICY
  const lcs = compareLineMatch(beforeLines, afterLines, comparison)
  const rows: DiffRow[] = []
  let bi = 0, ai = 0, li = 0
  while (bi < beforeLines.length || ai < afterLines.length) {
    if (li < lcs.length && bi < lcs[li].from && ai < lcs[li].to) {
      const left = { no: bi + 1, text: beforeLines[bi]! }
      const right = { no: ai + 1, text: afterLines[ai]! }
      const marks = marksFor(highlight, left.text, right.text, comparison)
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
/**
 * 文本形式的 unified diff（一次到底：两侧**每一行**都进正文，所以只有 `@@` 一个块头）。
 *
 * 块头的四个数照上游算法：
 *   · 写法 `UnifiedDiffWriter.writeHunkStart`（`platform/vcs-impl/src/com/intellij/openapi/diff/impl/patch/UnifiedDiffWriter.java:220-225`）
 *     —— `@@ -起始,行数 +起始,行数 @@`，行数 = 块尾下标 - 块头下标（两侧各算一次，即 `PatchHunk.getEndLineBefore() - getStartLineBefore()`）；
 *   · 数法 `PatchHunkUtil.getRange`（`platform/vcs-api/vcs-api-core/src/com/intellij/openapi/diff/impl/patch/PatchHunkUtil.kt:10-30`）
 *     —— 从**真正写进这个块的行**逐行累加：REMOVE 只加 before 侧、ADD 只加 after 侧、CONTEXT 两侧都加。
 * 于是「声明的行数」永远等于「实际收得到的行数」，这才是 `git apply` 认的那份账
 * （读侧按声明行数收块见 `src/patchApply.ts` 的 `parseUnifiedPatch`，上游
 * `PatchReader.readNextHunkUnified`，`platform/vcs-impl/src/com/intellij/openapi/diff/impl/patch/PatchReader.java:335-392`，
 * 收满就 `iterator.previous(); break` 把当前行退回去按表头重判，`:375-379`）。
 *
 * 原来这里写死 `@@ -1 +1 @@`：省略第二个数就是 1（上游 `PatchReader.java:359` 的
 * `linesBeforeText == null ? 1`、本仓 `parseHunkHeader` 同款），也就是向读侧声明「这块只有 1 行」，
 * 而正文是整个文件 ⇒ 声明与实际不符：`git apply` 报 `corrupt patch at line N`，
 * 本仓的解析器也会在收满 1 行之后把剩下的正文行当成表头重新判（跨块残留）。
 *
 * 某一侧行数为 0（纯增 / 纯删）时，那一侧的起始号按 git 惯例退成 0 基的「插在哪一行之后」，
 * 与本仓 `native/history_diff.cpp:116-121` 的 `render_hunks` 同一口径（那里的 `@@` 头也是从实际行累加出来的）。
 */
export function generateUnifiedDiff(a: string[], b: string[]): string {
  const lcs = computeLCS(a, b)
  const body: string[] = []
  let ci = 0, ki = 0, li = 0
  while (ci < a.length || ki < b.length) {
    if (li < lcs.length && ci < lcs[li].from) { body.push(`-${a[ci]}`); ci++ }
    else if (li < lcs.length && ki < lcs[li].to) { body.push(`+${b[ki]}`); ki++ }
    else if (li < lcs.length) { body.push(` ${a[ci]}`); ci++; ki++; li++ }
    else { if (ci < a.length) body.push(`-${a[ci]}`); if (ki < b.length) body.push(`+${b[ki]}`); ci++; ki++ }
  }
  // 声明的行数由正文实际吐出的那些行累加（`PatchHunkUtil.kt:14-27` 的那个 switch）。
  let beforeCount = 0
  let afterCount = 0
  for (const line of body) {
    if (line[0] !== '+') beforeCount++
    if (line[0] !== '-') afterCount++
  }
  const header = `@@ -${beforeCount === 0 ? 0 : 1},${beforeCount} +${afterCount === 0 ? 0 : 1},${afterCount} @@`
  return ['--- 当前文件', '+++ 剪贴板', header, ...body].join('\n')
}
