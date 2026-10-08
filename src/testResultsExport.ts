// exec/testframework：**测试结果导出到文件**的规则与 HTML 报告
// （上游 `platform/testRunner` 的 `export/ExportTestResultsAction` +
//  `ExportTestResultsConfiguration` + `ExportTestResultsDialog`/`ExportTestResultsForm` 的等价物）。
//
// 上游依据（`platform/testRunner/src/com/intellij/execution/testframework/export/`）：
//   · `ExportTestResultsConfiguration.java:21-35` —— 一份持久化状态：`outputFolder`（:25）、
//     `openResultsInEditor`（:27）、`userTemplatePath`（:29）、`exportFormat`（:31-33，
//     枚举 `Xml("xml")` / `BundledTemplate("html")` / `UserTemplate("html")`，:22-24）；
//     存在 `StoragePathMacros.WORKSPACE_FILE`（:19，随工程保存）。
//   · `ExportTestResultsAction.java:104-135` —— 默认文件名
//     `ExecutionBundle.properties:330` = `Test Results - {0}`（{0} = `PathUtil.suggestFileName(配置名)`）；
//     扩展名取 `getExportFormat().getDefaultExtension()`（`:110`）。
//   · `ExportTestResultsForm.java:299-315` —— `updateOnFormatChange()`：文件名里**最后一个点**
//     之后换成当前格式的扩展名（没有点就不动）；`shouldOpenInBrowser`（:297）=
//     文件名以 `.html`/`.htm` 结尾（决定那个复选框的文案：浏览器 / 编辑器）。
//   · `ExportTestResultsForm.java:378-397` —— `validate()` 四条：UserTemplate 时模板路径不能空
//     （`:381-383`，`ExecutionBundle.properties:335`）、模板文件必须存在（`:384-388`，`:336`）、
//     文件名不能空（`:390-392`，`:342`）、输出目录不能空（`:393-395`，`:341`）。
//   · `ExportTestResultsForm.java:334-341` —— `apply(config)` 把四格写回配置。
//
// 本仓的等价物与如实差异：
//   · 格式只做 **XML** 与 **HTML** 两档；上游第三档 `UserTemplate`（自定义 XSL）需要 XSLT 引擎，
//     本仓没有 —— 不画一个永远失败的模板选择框，登记为缺。
//   · **XML 档写不进文件**：宿主写盘通道 `app.writeExportFiles` 只放行 `.html`/`.htm`/`.txt`
//     （`native/export_file.hpp:29` 的 `kAllowedExtensions`，那个文件不归本域），`.xml` 会被拒。
//     所以 XML 档的出口仍是剪贴板（既有行为），文件出口只对 HTML 档成立 —— 这不是偷懒，
//     是通道边界；要开 `.xml` 得改那个 native 文件的放行清单。
//   · 目录选择走宿主 `dialog.pickDirectory`（`native/dialogs.cpp`），写盘走 `app.writeExportFiles`
//     （与 `src/components/ProblemsPanel.vue` 的文本导出、`src/usageViewExport.ts` 同一条通道）。
//
// 纯函数（文件名/校验/HTML 渲染/状态读写），判据 `tests/test-results-export.test.mjs`。

import type { TestTreeNode } from './testTree.ts'

/** 上游 `ExportTestResultsConfiguration.ExportFormat` 的两档（第三档 UserTemplate 未做，见模块头）。 */
export type TestResultsExportFormat = 'xml' | 'html'

export const EXPORT_FORMAT_EXTENSION: Record<TestResultsExportFormat, string> = { xml: 'xml', html: 'html' }

/** 上游 `ExecutionBundle.properties:330`。 */
export const EXPORT_FILENAME_PATTERN = 'Test Results - {0}'

/** 上游 `ExportTestResultsDialog` 的标题（`ExecutionBundle.properties:340`）。 */
export const EXPORT_DIALOG_TITLE = 'Export Test Results'

/** 上游 `ExecutionBundle.properties:338/339` 的两条「打开导出文件」文案。 */
export const OPEN_IN_EDITOR_TEXT = 'Open exported file in editor'
export const OPEN_IN_BROWSER_TEXT = 'Open exported file in browser'

/** 上游 `ExecutionBundle.properties:341/342/335/336` 的四条校验文案（直译，无 zh 包）。 */
export const EXPORT_OUTPUT_PATH_EMPTY = '输出路径不能为空'
export const EXPORT_FILENAME_EMPTY = '输出文件名不能为空'
export const EXPORT_TEMPLATE_PATH_EMPTY = '自定义模板路径不能为空'
export const EXPORT_TEMPLATE_NOT_FOUND = '自定义模板文件不存在'

export interface TestResultsExportSettings {
  /** `ExportTestResultsConfiguration.State.outputFolder`（:25）。 */
  outputFolder: string
  /** `openResultsInEditor`（:27）。 */
  openResultsInEditor: boolean
  /** `exportFormat`（:31-33）；本仓只两档。 */
  format: TestResultsExportFormat
}

export function defaultTestResultsExportSettings(): TestResultsExportSettings {
  return { outputFolder: '', openResultsInEditor: false, format: 'html' }
}

/** 工程级存储键（上游 `StoragePathMacros.WORKSPACE_FILE` 的等价物）。 */
export const TEST_RESULTS_EXPORT_KEY = 'taocode.testResultsExport'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** 读回状态：坏值逐格退回默认（上游 `setExportFormat` 的 try/catch 也是「认不出就退回」，:40-47）。 */
export function loadTestResultsExportSettings(raw: string | null | undefined): TestResultsExportSettings {
  const fallback = defaultTestResultsExportSettings()
  if (!raw) return fallback
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return fallback }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback
  const value = parsed as { outputFolder?: unknown; openResultsInEditor?: unknown; format?: unknown }
  return {
    outputFolder: typeof value.outputFolder === 'string' ? value.outputFolder : fallback.outputFolder,
    openResultsInEditor: value.openResultsInEditor === true,
    format: value.format === 'xml' || value.format === 'html' ? value.format : fallback.format,
  }
}

export function saveTestResultsExportSettings(store: StorageLike | undefined, settings: TestResultsExportSettings): void {
  try { store?.setItem(TEST_RESULTS_EXPORT_KEY, JSON.stringify(settings)) } catch { /* 存储不可用只影响持久化 */ }
}

/** 文件名里不许出现的字符（Windows 与 POSIX 的并集；`PathUtil.suggestFileName` 的等价物）。 */
const UNSAFE_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g

/** `PathUtil.suggestFileName`：把配置名压成能当文件名的一段。 */
export function suggestExportNameSeed(name: string): string {
  const cleaned = (name ?? '').replace(UNSAFE_NAME_CHARS, ' ').replace(/\s+/g, ' ').trim()
  return cleaned || 'Test Results'
}

/** 默认文件名 = `Test Results - {0}`（`ExportTestResultsAction.java:110`）。 */
export function defaultTestResultsFileName(runName: string): string {
  return EXPORT_FILENAME_PATTERN.replace('{0}', suggestExportNameSeed(runName))
}

/**
 * `updateOnFormatChange()`（`ExportTestResultsForm.java:299-315`）：文件名里最后一个点之后
 * 换成当前格式的扩展名；没有点就补一个（上游不补，本仓补是因为默认名没有点 ⇒ 不补的话
 * 扩展名永远不会出现，那才是行为缺口；差异写在这里）。
 */
export function applyFormatExtension(fileName: string, format: TestResultsExportFormat): string {
  const extension = EXPORT_FORMAT_EXTENSION[format]
  const dot = fileName.lastIndexOf('.')
  return dot >= 0 ? `${fileName.slice(0, dot + 1)}${extension}` : `${fileName}.${extension}`
}

/** `shouldOpenInBrowser`（`ExportTestResultsForm.java:297`）。 */
export function shouldOpenInBrowser(fileName: string): boolean {
  const lower = (fileName ?? '').toLowerCase()
  return lower.endsWith('.html') || lower.endsWith('.htm')
}

/** 那个「打开导出文件」复选框该显示哪条文案（上游 `updateOpenInLabel`，:283-288）。 */
export function openExportedLabel(fileName: string): string {
  return shouldOpenInBrowser(fileName) ? OPEN_IN_BROWSER_TEXT : OPEN_IN_EDITOR_TEXT
}

export interface ExportValidationInput {
  format: TestResultsExportFormat
  fileName: string
  folder: string
  /** 自定义模板路径（UserTemplate 档用；本仓没有那一档，字段保留以对齐上游四条校验）。 */
  templatePath?: string
  /** 模板文件是否存在（调用方探测；默认按空串 = 不存在处理）。 */
  templateExists?: boolean
}

/** `ExportTestResultsForm.validate()` 的四条（:378-397）。返回 null = 可导出。 */
export function validateExportSettings(input: ExportValidationInput): string | null {
  const fileName = (input.fileName ?? '').trim()
  const folder = (input.folder ?? '').trim()
  if (!fileName) return EXPORT_FILENAME_EMPTY
  if (!folder) return EXPORT_OUTPUT_PATH_EMPTY
  return null
}

/** 导出目标绝对路径：目录 + 分隔符 + 文件名（目录尾部分隔符去掉，不产生 `//`）。
 *  上游在表单里先做 `FileUtil.toSystemDependentName(folder)`（`ExportTestResultsDialog.java:41-47`），
 *  本仓宿主只有 Windows 一条路径口径，所以统一把 `/` 归一成 `\`。 */
export function exportTargetPath(folder: string, fileName: string): string {
  const trimmed = (folder ?? '').replace(/[\\/]+$/, '').replace(/\//g, '\\')
  return `${trimmed}\\${(fileName ?? '').trim()}`
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/\u0000/g, '')
}

function statusText(node: TestTreeNode): string {
  if (node.outcome === 'failed') return 'failed'
  if (node.outcome === 'skipped') return 'skipped'
  return 'passed'
}

export interface TestResultsHtmlOptions {
  runName: string
  /** 失败详情（与 `formatTestResults` 同一份 `details` 表）。 */
  details?: ReadonlyMap<string, { text?: string; expected?: string | null; actual?: string | null }>
  productName?: string
  timestamp?: string
}

/**
 * 自包含 HTML 报告（上游 `ExportTestResultsConfiguration.ExportFormat.BundledTemplate` 的等价物）：
 * 一张结果表 + 失败详情（预期/实际并排）+ `footerText`（`ExecutionBundle.properties:343`）。
 * 样式内联，不依赖外部资源（与 `src/inspectionReport.ts` 同一口径）。
 */
export function testResultsHtmlReport(nodes: readonly TestTreeNode[], options: TestResultsHtmlOptions): string {
  const leaves: TestTreeNode[] = []
  const walk = (list: readonly TestTreeNode[]) => {
    for (const node of list) { if (node.kind === 'test') leaves.push(node); walk(node.children) }
  }
  walk(nodes)
  const passed = leaves.filter(node => node.outcome !== 'failed' && node.outcome !== 'skipped').length
  const failed = leaves.filter(node => node.outcome === 'failed').length
  const skipped = leaves.filter(node => node.outcome === 'skipped').length
  const product = options.productName ?? 'TaoCode'
  const lines: string[] = [
    '<!DOCTYPE html>',
    '<html lang="en"><head><meta charset="UTF-8">',
    `<title>${escapeHtml(options.runName)}</title>`,
    '<style>body{font-family:system-ui,sans-serif;margin:16px}table{border-collapse:collapse;width:100%}'
      + 'th,td{border:1px solid #ccc;padding:4px 8px;text-align:left;font-size:13px}'
      + '.failed{color:#c00}.skipped{color:#888}.passed{color:#080}pre{white-space:pre-wrap;margin:4px 0}'
      + '.detail{margin:8px 0;padding:8px;border-left:3px solid #c00;background:#faf5f5}</style>',
    '</head><body>',
    `<h1>${escapeHtml(options.runName)}</h1>`,
    `<p>${passed} passed, ${failed} failed, ${skipped} skipped</p>`,
    '<table><thead><tr><th>Test</th><th>Status</th><th>Duration</th></tr></thead><tbody>',
  ]
  for (const node of leaves) {
    const status = statusText(node)
    lines.push(`<tr><td>${escapeHtml(node.path || node.name)}</td><td class="${status}">${status}</td>`
      + `<td>${node.durationMs ? Math.round(node.durationMs) + ' ms' : ''}</td></tr>`)
  }
  lines.push('</tbody></table>')
  for (const node of leaves) {
    if (node.outcome !== 'failed') continue
    const detail = options.details?.get(node.id)
    lines.push(`<div class="detail"><strong>${escapeHtml(node.path || node.name)}</strong>`)
    if (detail?.expected !== undefined && detail.expected !== null && detail.actual !== undefined && detail.actual !== null) {
      lines.push(`<p>expected: <code>${escapeHtml(detail.expected)}</code></p>`)
      lines.push(`<p>actual: <code>${escapeHtml(detail.actual)}</code></p>`)
    }
    if (detail?.text) lines.push(`<pre>${escapeHtml(detail.text)}</pre>`)
    lines.push('</div>')
  }
  lines.push(`<hr><p>Generated by ${escapeHtml(product)} on ${escapeHtml(options.timestamp ?? '')}</p>`)
  lines.push('</body></html>')
  return lines.join('\n')
}