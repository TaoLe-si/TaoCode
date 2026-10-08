// 覆盖率报告的**导出**（上游 `GenerateCoverageReportAction`：把当前覆盖率套件写成 HTML 报告）。
//
// 上游坐标（已核源码）：
//   · 动作 `plugins/coverage-common/src/com/intellij/coverage/actions/GenerateCoverageReportAction.java:22-40`
//     —— `update` 的门是 `coverageEngine.isReportGenerationAvailable(project, dataContext, currentSuite)`
//     （`:51-58`），`actionPerformed` 先弹 `ExportToHTMLDialog`（`:33-38` reset/showAndGet/apply）
//     再 `coverageEngine.generateReport(project, dataContext, currentSuite)`（`:40`）。
//   · 弹窗 `platform/lang-impl/src/com/intellij/codeInspection/export/ExportToHTMLDialog.kt:19-52`
//     —— 目录选择 `addBrowseDirectoryListener`（`:34`）、标题/按钮/勾选文案取
//     `platform/analysis-api/resources/messages/InspectionsBundle.properties:55-57`
//     （`Save` / `Export` / `Open generated HTML in browser`）、目录标签取
//     `platform/platform-api/resources/messages/EditorBundle.properties:13`（`Output directory:`）。
//
// 本仓落点：`coverageReportHtml` 把已解析的 `CoverageSummary` 写成**自包含** HTML（内联样式、无外部资源、
// 四档聚合都在一份文件里）；写盘走既有通道 `app.writeExportFiles`
// （`native/export_file.cpp` 只放行 `.html`/`.htm`/`.txt`；与 `src/inspectionReport.ts`、
// `src/testResultsExport.ts` 同一条），选目录走 `dialog.pickDirectory`（`native/dialogs.cpp`）。
// 消费点 `src/components/CoverageReportPane.vue` 的「生成报告」按钮（门 = `coverageReportExportAvailable`）。
//
// 与上游的差异（如实记录）：上游由各覆盖率引擎（`CoverageEngine.generateReport`）写**一棵** HTML 树
// （`index.html` + 逐包/逐类页面）；本仓没有采集引擎、只有从标准报告里读回来的汇总 ⇒ 写**一份**
// 自包含 `index.html`（四档表都在里面），不假装有逐类页面。
//
// 判据 tests/coverage-report.test.mjs（导出那几条）。

import {
  COVERAGE_FORMAT_LABELS, coverageViewSection, type CoverageGrouping, type CoverageSummary,
} from './coverageReport.ts'

/** 弹窗标题（上游 `InspectionsBundle.properties:56` 的 `inspection.export.dialog.title`）。 */
export const COVERAGE_EXPORT_DIALOG_TITLE = 'Export'

/** 目录那一行的标签（上游 `EditorBundle.properties:13` 的 `export.to.html.output.directory.label`，去掉助记符 `&`）。 */
export const COVERAGE_EXPORT_DIRECTORY_LABEL = 'Output directory:'

/** 报告入口文件名：上游那棵树也叫 `index.html`（本仓写一份自包含的）。 */
export const COVERAGE_EXPORT_FILE_NAME = 'index.html'

/**
 * 门：`GenerateCoverageReportAction.java:51-58` 的 `isReportGenerationAvailable` —— 没有当前套件
 * （本仓 = 没读到报告 / 报告里一行行覆盖都没有）就**不可用**，不要凭空生成一份空报告。
 */
export function coverageReportExportAvailable(summary: CoverageSummary | null | undefined): boolean {
  if (!summary) return false
  if (summary.files.length > 0) return true
  return summary.coveredLines + summary.missedLines > 0
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => {
    switch (character) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      default: return '&#39;'
    }
  })
}

function percentText(row: { coveredLines: number; missedLines: number; percent: number }): string {
  return row.coveredLines + row.missedLines > 0 ? `${row.percent}%` : '—'
}

const GROUPING_TITLES: Record<CoverageGrouping, string> = {
  file: '按文件', package: '按包', class: '按类', method: '按方法',
}

function sectionTable(summary: CoverageSummary, grouping: CoverageGrouping): string {
  const section = coverageViewSection(summary, grouping)
  if (!section.available) return ''
  const rows = section.rows.map(row => '      <tr>'
    + `<td>${escapeHtml(row.label)}</td>`
    + `<td class="detail">${escapeHtml(row.detail)}</td>`
    + `<td class="num">${row.coveredLines}</td>`
    + `<td class="num">${row.missedLines}</td>`
    + `<td class="num">${percentText(row)}</td>`
    + '</tr>').join('\n')
  return `    <h2>${GROUPING_TITLES[grouping]}（${section.rows.length}）</h2>\n`
    + '    <table>\n      <thead><tr><th>' + GROUPING_TITLES[grouping]
    + '</th><th>归属</th><th class="num">已覆盖</th><th class="num">未覆盖</th><th class="num">行覆盖</th></tr></thead>\n'
    + `      <tbody>\n${rows}\n      </tbody>\n    </table>\n`
}

/**
 * 自包含的覆盖率报告 HTML（内联样式、无脚本、无外部资源 —— 导出的文件在任何浏览器里都长一样）。
 * 四档聚合全在：文件 / 包 / 类 / 方法（哪一档在报告里没有内容就不写那一张表 ——
 * 与面板的 `available` 同一条规则，不给空表）。
 */
export function coverageReportHtml(summary: CoverageSummary, options: { generatedAt?: Date } = {}): string {
  const generatedAt = options.generatedAt ?? new Date()
  const total = summary.coveredLines + summary.missedLines
  const tables = (['file', 'package', 'class', 'method'] as const)
    .map(grouping => sectionTable(summary, grouping)).join('')
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<title>覆盖率报告 · ${escapeHtml(summary.reportPath)}</title>
<style>
  body { margin: 24px; background: #ffffff; color: #1f2328; font: 13px/1.6 -apple-system, 'Segoe UI', sans-serif; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 20px 0 6px; }
  .meta { color: #57606a; font-size: 12px; margin: 0 0 12px; }
  .total { font-weight: 600; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #d0d7de; padding: 3px 8px; text-align: left; }
  th { background: #f6f8fa; font-weight: 600; }
  td.detail { color: #57606a; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
</style>
</head>
<body>
  <h1>覆盖率报告</h1>
  <p class="meta">
    来源 <code>${escapeHtml(summary.reportPath)}</code> · 格式 ${escapeHtml(COVERAGE_FORMAT_LABELS[summary.format])}
    · 生成于 ${escapeHtml(generatedAt.toISOString())}
  </p>
  <p class="total">行覆盖 ${percentText(summary)}（已覆盖 ${summary.coveredLines} / 未覆盖 ${summary.missedLines} / 共 ${total} 行）</p>
  <p class="meta">文件 ${summary.files.length} · 包 ${summary.packages.length} · 类 ${summary.classes.length} · 方法 ${summary.methods.length}${summary.truncated ? '（文件表已截断）' : ''}</p>
${tables}</body>
</html>
`
}

/** 落盘路径（上游那棵树写 `<目录>/index.html`）。 */
export function coverageReportExportPath(directory: string, fileName = COVERAGE_EXPORT_FILE_NAME): string {
  return `${directory.replace(/[\\/]+$/, '')}/${fileName}`
}
