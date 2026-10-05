// 错误树/消息视图 —— 上游 `ErrorViewStructure` + `ErrorTreeElement`/`ErrorTreeElementKind`
// + `ErrorViewTextExporter`（`platform/platform-impl/src/com/intellij/ide/errorTreeView/`）。
//
// 上游结构（逐条对照）：
//   · `ErrorViewStructure.ourMessagesOrder`：根的子节点按 **INFO, ERROR, WARNING, NOTE, GENERIC**
//     的固定顺序排（空桶不出现）；
//   · 具名分组 = `GroupingElement`（首行是组名，子树是 `NavigatableMessageElement`）；
//   · `ErrorTreeElementKind.getPresentableText()` 给导出文本的 kind 前缀
//     （IdeBundle `errortree.information`/`errortree.error`/…）；
//   · `ErrorViewTextExporter.getReportText`：每条子节点前换行、按层缩进 **4 空格**、
//     「Show details」不勾（`withUsages=false`）时跳过 `NavigatableMessageElement`、只留分组头。
//
// 本仓：构建/运行/LSP 的问题都在 `src/problems.ts` 的 `ProblemRow` 表里（问题面板与状态栏同一数据源）。
// 这里的映射是 —— 严重度分桶（1 错误 / 2 警告 / 3 提示 / 4 信息）当具名分组、每条问题当
// `NavigatableMessageElement`（有真实路径与行列，可跳转）；文本导出就是 `ErrorViewTextExporter`
// 的等价物，消费者是问题面板的「导出文本…」（IDEA 的消息窗口也有这条 Export to text file）。
import type { ProblemRow } from './problems.ts'

/** 上游 `ErrorTreeElementKind` 的五个档（GENERIC 没有可显示文案，导出时前缀为空）。 */
export type ErrorTreeKind = 'info' | 'error' | 'warning' | 'note' | 'generic'

/** `ErrorViewStructure.ourMessagesOrder` 的固定顺序 —— 输入顺序不影响输出顺序。 */
export const ERROR_TREE_KIND_ORDER: readonly ErrorTreeKind[] = ['info', 'error', 'warning', 'note', 'generic']

/** `ErrorTreeElementKind.getPresentableText()` 的文案（本仓界面语言）。 */
export const ERROR_TREE_KIND_LABEL: Record<ErrorTreeKind, string> = {
  info: '信息', error: '错误', warning: '警告', note: '提示', generic: '',
}

/** 严重度 → kind。上游 `ErrorTreeElementKind.convertMessageFromCompilerErrorType`（MessageCategory → kind）的对应物。 */
export function errorTreeKind(severity: number): ErrorTreeKind {
  switch (severity) {
    case 1: return 'error'
    case 2: return 'warning'
    case 3: return 'note'
    case 4: return 'info'
    default: return 'generic'
  }
}

/** 一个分组（上游 `GroupingElement` 的等价物）：同 kind 的消息桶。 */
export interface ErrorTreeBucket {
  kind: ErrorTreeKind
  /** 组名（空桶不产生分组；GENERIC 的名字为空串，导出时不会有组头行）。 */
  label: string
  rows: ProblemRow[]
}

/** 按 kind 分桶：只保留非空桶，顺序固定为 `ERROR_TREE_KIND_ORDER`（与上游 getChildElements(root) 同口径）。 */
export function buildErrorTree(rows: readonly ProblemRow[]): ErrorTreeBucket[] {
  const buckets = new Map<ErrorTreeKind, ProblemRow[]>()
  for (const row of rows) {
    const kind = errorTreeKind(row.severity)
    const list = buckets.get(kind)
    if (list) list.push(row)
    else buckets.set(kind, [row])
  }
  return ERROR_TREE_KIND_ORDER
    .filter(kind => (buckets.get(kind)?.length ?? 0) > 0)
    .map(kind => ({ kind, label: ERROR_TREE_KIND_LABEL[kind], rows: buckets.get(kind)! }))
}

/** 组头文案：`错误 (3)`（上游组名 + 条目数；没有条目数的组头在长列表里没法对账）。 */
export function bucketHeader(bucket: ErrorTreeBucket): string {
  return bucket.label ? `${bucket.label} (${bucket.rows.length})` : `(${bucket.rows.length})`
}

/** 一条消息的导出行：`路径:行:列 消息`（0 基行列转 1 基，与编辑器/问题面板同一口径）。 */
export function errorTreeLine(row: ProblemRow): string {
  const position = `${row.path}:${row.line + 1}:${row.character + 1}`
  return row.message ? `${position} ${row.message}` : position
}

/**
 * 文本导出（上游 `ErrorViewTextExporter.getReportText`）：
 *   · `details !== false` 时逐个分组输出「组头 + 每条消息（缩进 4 空格）」；
 *   · `details === false`（上游「Show details」不勾）只输出组头 —— 消息元素整条跳过；
 *   · 组与组之间换行，末尾带一个换行（写文件用）。
 */
export function errorTreeText(rows: readonly ProblemRow[], options: { details?: boolean } = {}): string {
  const details = options.details !== false
  const lines: string[] = []
  for (const bucket of buildErrorTree(rows)) {
    lines.push(bucketHeader(bucket))
    if (details) for (const row of bucket.rows) lines.push(`    ${errorTreeLine(row)}`)
  }
  return lines.length ? `${lines.join('\n')}\n` : ''
}

/** 导出文件名（与 HTML 报告同一时间戳口径）：`error-report-20261004-1530.txt`。 */
export function errorReportFileName(date: Date): string {
  const two = (value: number) => String(value).padStart(2, '0')
  const stamp = `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}`
  return `error-report-${stamp}.txt`
}
