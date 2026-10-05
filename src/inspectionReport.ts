// 检查结果导出为 HTML 报告 —— IDEA `codeInspection/export` 一族的对应物
// （`ExportToHTMLAction.kt` 从 Inspection Results 工具窗口触发，`ExportToHTMLDialog.kt` 选输出目录，
// 落盘的是自包含的 HTML）。本仓没有 InspectionResultsView 的 Swing 树，但**报告本身**是
// 问题面板数据（`src/problems.ts` 的 `ProblemRow`）的纯函数：分组、计数、转义、文件名。
//
// 为什么单独成模块：导出与「谁渲染问题面板」无关，且要能 `node --test` 直接测
// （HTML 转义与计数是这种报告唯一容易出错的地方）。写盘走现成的
// `app.writeExportFiles`（native/export_file.cpp 只允许 .html/.htm），不新开通道。

/** 报告里的一行问题（复用 `ProblemRow` 的字段，但这里只要这几列就够）。 */
export interface ReportRow {
  path: string
  /** 0 基行号（LSP 基准，报告里显示 1 基）。 */
  line: number
  character: number
  severity: number
  message: string
  source: string
}

export interface InspectionReportOptions {
  /** 项目名（标题里显示；空串时用「工作区」）。 */
  projectName?: string
  /** 生成时间（测试注入固定值；渲染层传 `new Date()`）。 */
  generatedAt: Date
}

/** 与问题面板同一套严重度名（IDEA `ProblemDescriptor` 的四档）。 */
const SEVERITY_NAMES: Record<number, string> = { 1: '错误', 2: '警告', 3: '提示', 4: '信息' }
const SEVERITY_CLASSES: Record<number, string> = { 1: 'error', 2: 'warning', 3: 'weak', 4: 'info' }

export function inspectionSeverityName(severity: number): string {
  return SEVERITY_NAMES[severity] ?? '信息'
}

export function inspectionSeverityClass(severity: number): string {
  return SEVERITY_CLASSES[severity] ?? 'info'
}

/** HTML 转义（消息与路径都来自用户代码/语言服务，必须转，不然报告会被注入标签）。 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 两栏时间戳（文件名与标题同一份口径，避免跨时区漂移）。 */
function two(value: number): string {
  return String(value).padStart(2, '0')
}

/** 报告文件名：`inspection-report-20261004-1530.html`。 */
export function inspectionReportFileName(date: Date): string {
  const stamp = `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}`
  return `inspection-report-${stamp}.html`
}

/** 标题里的可读时间：`2026-10-04 15:30`。 */
export function inspectionReportTimestamp(date: Date): string {
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}

export interface InspectionReportCounts {
  total: number
  errors: number
  warnings: number
  infos: number
  files: number
}

/** 计数（与问题面板的 `problemCounts` 同一口径：severity<=2 的细分，3/4 都算「信息」）。 */
export function inspectionReportCounts(rows: readonly ReportRow[]): InspectionReportCounts {
  let errors = 0, warnings = 0, infos = 0
  const files = new Set<string>()
  for (const row of rows) {
    if (row.severity === 1) ++errors
    else if (row.severity === 2) ++warnings
    else ++infos
    files.add(row.path)
  }
  return { total: rows.length, errors, warnings, infos, files: files.size }
}

/** 文件分组：按路径排序，组内按行号排序（IDEA 的 HTML 报告也是按文件聚合的）。 */
export function groupReportRows(rows: readonly ReportRow[]): Array<{ path: string; rows: ReportRow[] }> {
  const groups = new Map<string, ReportRow[]>()
  for (const row of rows) {
    const list = groups.get(row.path)
    if (list) list.push(row)
    else groups.set(row.path, [row])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, list]) => ({ path, rows: [...list].sort((a, b) => a.line - b.line || a.character - b.character) }))
}

/**
 * 生成自包含的 HTML 报告（内联样式，不引外部资源 —— 报告要能单独发给别人打开）。
 * 空集合也生成：报告里写明「没有问题」，比不产文件诚实。
 */
export function inspectionReportHtml(rows: readonly ReportRow[], options: InspectionReportOptions): string {
  const counts = inspectionReportCounts(rows)
  const groups = groupReportRows(rows)
  const project = options.projectName?.trim() || '工作区'
  const groupsHtml = groups.map(group => `
    <section class="file">
      <h2>${escapeHtml(group.path)} <span class="count">${group.rows.length}</span></h2>
      <table>
        <thead><tr><th>严重度</th><th>位置</th><th>说明</th><th>来源</th></tr></thead>
        <tbody>
${group.rows.map(row => `          <tr class="${inspectionSeverityClass(row.severity)}">
            <td>${inspectionSeverityName(row.severity)}</td>
            <td class="pos">${row.line + 1}:${row.character + 1}</td>
            <td>${escapeHtml(row.message)}</td>
            <td class="src">${escapeHtml(row.source)}</td>
          </tr>`).join('\n')}
        </tbody>
      </table>
    </section>`).join('\n')
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>检查报告 - ${escapeHtml(project)}</title>
<style>
  body { margin: 0; padding: 24px; background: #fff; color: #1f2328; font: 13px/1.6 "Segoe UI", "Microsoft YaHei", sans-serif; }
  h1 { margin: 0 0 4px; font-size: 20px; }
  .meta { margin: 0 0 16px; color: #59636e; font-size: 12px; }
  .summary { display: flex; gap: 16px; margin: 0 0 20px; padding: 10px 14px; background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 6px; }
  .summary b { font-variant-numeric: tabular-nums; }
  .file { margin: 0 0 18px; }
  .file h2 { margin: 0; padding: 6px 8px; font-size: 13px; background: #f6f8fa; border: 1px solid #d0d7de; border-bottom: 0; border-radius: 6px 6px 0 0; font-family: ui-monospace, Consolas, monospace; }
  .file .count { color: #59636e; font-weight: 400; }
  table { width: 100%; border-collapse: collapse; border: 1px solid #d0d7de; border-radius: 0 0 6px 6px; }
  th, td { padding: 4px 8px; border-top: 1px solid #d8dee4; text-align: left; vertical-align: top; }
  th { background: #f6f8fa; font-weight: 600; }
  td.pos { white-space: nowrap; font-family: ui-monospace, Consolas, monospace; }
  td.src { color: #59636e; }
  tr.error td:first-child { color: #cf222e; }
  tr.warning td:first-child { color: #9a6700; }
  tr.weak td:first-child, tr.info td:first-child { color: #57606a; }
</style>
</head>
<body>
<h1>检查报告 — ${escapeHtml(project)}</h1>
<p class="meta">生成时间 ${inspectionReportTimestamp(options.generatedAt)} · 共 ${counts.files} 个文件、${counts.total} 条问题</p>
<div class="summary">
  <span>错误 <b>${counts.errors}</b></span>
  <span>警告 <b>${counts.warnings}</b></span>
  <span>提示/信息 <b>${counts.infos}</b></span>
</div>
${counts.total ? groupsHtml : '<p class="meta">没有问题。</p>'}
</body>
</html>
`
}
