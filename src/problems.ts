// 问题面板的数据源 —— IDEA 的「问题」工具窗口（`ProblemsView`：把所有 `HighlightInfo` 汇总成一张表）。
//
// 为什么单独成模块：它只读 LSP 诊断表（`lspDiagnostics`，reactive Map），是一个**零依赖派生**；
// 放在宿主里会占掉 App.vue 的机检上限，而它与"谁渲染它"无关（状态栏计数、问题面板、让「激活问题工具窗口」
// 那一行按有无问题启停，都读同一个表）。
//
// 表的两个来源：
//   · `lspDiagnostics` —— 语言服务（push `publishDiagnostics` / pull `textDocument/diagnostic`）；
//   · `localDiagnostics` —— 本仓**本地检查**通道（如 JUnit 规则，见 src/junitInspections.ts），
//     与 LSP 诊断并列进同一张表（IDEA 的 daemon 也是把本地 inspection 与外部注解并进 ProblemsView）。
import { computed } from 'vue'
import { lspDiagnostics } from './bridge.ts'
// 分析忽略门控（上游 `AnalysisIgnoreService` 的等价物，见 src/analysisIgnore.ts 的模块注释）：
// 命中的文件不进问题面板，状态栏计数与「激活问题工具窗口」的启停跟着一起变。
import { isAnalysisIgnored } from './analysisIgnore.ts'
// 按文件覆盖文件类型（上游 `OverrideFileTypeManager`/`ProjectPlainTextFileTypeManager`，
// 见 src/fileTypeOverrides.ts）：被标成纯文本的文件退出语言分析 —— 与 IDEA 一样不进问题表。
import { isFileTypeOverridden } from './fileTypeOverrides.ts'
// 逐文件高亮级别（上游 `HighlightingSettingsPerFile` 的 None/Syntax/Inspections 三档，
// 见 src/highlightSettingsPerFile.ts）：聚合前按级别丢掉整档诊断。
import { highlightLevelForPath, keepsDiagnosticAtLevel } from './highlightSettingsPerFile.ts'
// 本地检查配置文件（上游 `InspectionProfile` 的启用/严重度覆盖，见 src/inspectionProfile.ts）：
// 停用的检查项不落表，覆盖了级别的按覆盖级别报；粒度是「检查项身份」（诊断码优先、检查器其次），
// 身份解析共用 src/inspectionIdentity.ts（对应上游 `HighlightingProblem.kt:85-89` 的那一步）。
import { applyInspectionProfile } from './inspectionProfile.ts'
import { localDiagnostics } from './junitInspections.ts'
// 问题高亮过滤器的扩展点宿主（上游 `ProblemHighlightFilter` EP，
// `platform/analysis-api/resources/intellij.platform.analysis.xml:44`）：本仓的「分析忽略」
// 与「按文件覆盖类型」两道门控作为 bundled 贡献登记进同名 EP（见 `src/daemonExtensionPoints.ts`），
// 两张表在读同一条判定；第三方（原版 IDEA 插件）按同一 id 挂自己的过滤器即可被这两处消费。
import { registerProblemHighlightFilter, shouldHighlightFileByFilters } from './daemonExtensionPoints.ts'

/** 「分析忽略」这条 bundled 过滤器（`AnalysisIgnoreService` 的等价物，见 src/analysisIgnore.ts）。 */
registerProblemHighlightFilter({
  id: 'taocode.analysisIgnore',
  shouldHighlightFile: path => !isAnalysisIgnored(path),
  shouldProcessFileInBatch: path => !isAnalysisIgnored(path),
})
/** 「按文件覆盖文件类型」这条 bundled 过滤器（`OverrideFileTypeManager` 的等价物，见 src/fileTypeOverrides.ts）。 */
registerProblemHighlightFilter({
  id: 'taocode.fileTypeOverride',
  shouldHighlightFile: path => !isFileTypeOverridden(path),
  shouldProcessFileInBatch: path => !isFileTypeOverridden(path),
})
// 高亮级别模型（上游 `HighlightDisplayLevel` 一族，见 src/highlightLevels.ts）：严重度文案、
// 样式类与 CodeMirror severity 是同一份，问题面板/状态栏/编辑器标记不再各写三元表达式。
import { severityClass, severityLabel } from './highlightLevels.ts'
// LSP `Diagnostic.relatedInformation`（一条问题的其它相关位置）的折叠面，见
// src/problemRelatedInformation.ts 的文件头 —— 上游 `LspDiagnosticAndLazyQuickFixes.kt:42`
// 原样保留这个字段，本仓同样只做「带出来 + 面板列出」，呈现的排序/去重/越界丢弃都在那边。
import type { RelatedLocationInput } from './problemRelatedInformation.ts'

/**
 * 宿主透传的关联位置：两种线上形态都认 —— `relatedInformation`（LSP 原样；接线请求 R1 给的可照抄实现
 * 就是把这一条数组带出来）与 `related`（宿主已经折成行坐标的那一种）。
 * 认不出来（不是数组）就整体不写这一格，面板据此不渲染那一节，不画假位置。
 */
function relatedFrom(item: object): RelatedLocationInput[] | undefined {
  const raw = (item as { relatedInformation?: unknown; related?: unknown }).relatedInformation
    ?? (item as { related?: unknown }).related
  return Array.isArray(raw) ? raw as RelatedLocationInput[] : undefined
}

/** 一行问题：文件 + 位置 + 严重度 + 消息（IDEA `ProblemDescriptor` 的最小字段集）。 */
export interface ProblemRow {
  path: string
  /** 0 基行号（LSP 基准，渲染时 +1）。 */
  line: number
  character: number
  /** LSP 严重度：1 错误 / 2 警告 / 3 信息 / 4 提示。 */
  severity: number
  message: string
  source: string
  /**
   * 诊断码 —— 「诊断码 → IDEA 检查项」这条主杠杆的地基（上游 `ProblemsViewState.kt:28` 的
   * `groupByToolId` 就是按这一维度分组）。LSP 侧由 `native/lsp_support.cpp:148` 透传
   * （`LspDiagnostic.code` 可能是 number，按规范统一折成字符串）；本地检查侧没有 code，
   * 它的身份就是 `source`（上游本地 inspection 的 tool id 即检查器短名），故回落到 source。
   */
  code?: string
  /**
   * LSP `Diagnostic.tags`（1 = Unnecessary、2 = Deprecated），宿主在 `native/lsp_support.cpp:149`
   * 透传、类型在 `src/bridge.ts:118`。上游靠它把诊断折成两个**注册出来的检查项**
   * （`HighlightInfoType.java:49-55`），本仓的身份解析在 `src/inspectionIdentity.ts`，
   * 编辑器那一层的同一份判定在 `src/annotatorHighlights.ts` 的 `diagnosticKind`。
   */
  tags?: number[]
  /**
   * LSP `Diagnostic.relatedInformation` —— 「同一处错误的其它相关位置」。
   * 上游的对应面是 LSP 宿主把它**原样保留**进诊断数据（`LspDiagnosticAndLazyQuickFixes.kt:42`），
   * 面板因此列得出相关位置；本仓的折叠规则（越界丢弃 / 去重 / 排序 / 跨文件带路径）在
   * `src/problemRelatedInformation.ts`。
   *
   * 宿主侧还**没有**把这个字段透传出来（`native/lsp_support.cpp` 的 `shape_diagnostics` 只到
   * `code`/`tags`，`src/bridge.ts` 的 `LspDiagnostic` 也没有它），所以这里恒为 undefined ⇒
   * 面板的「相关位置」一节一行都不渲染（没数据不渲染，不是假控件）。
   * 透传的可照抄实现已写进 `docs/wiring-requests-2026-10-06-problems.md` R1，接上后本文件零改动即生效。
   */
  related?: RelatedLocationInput[]
}

/**
 * 全部诊断按「严重度 → 路径 → 行号」排序（IDEA 的问题视图默认就是这个顺序）。
 * 表本身是 reactive Map，所以这里是响应式的。
 */
export { severityClass, severityLabel }

export const allProblems = computed<ProblemRow[]>(() => {
  const result: ProblemRow[] = []
  for (const [path, items] of lspDiagnostics) {
    // 文件级过滤器（`ProblemHighlightFilter` EP）：分析忽略 / 覆盖类型两道 bundled 过滤器，
    // 任一条返回 false 就整份文件不进表；第三方挂进来的过滤器同样在这条判定里生效。
    if (!shouldHighlightFileByFilters(path)) continue
    const level = highlightLevelForPath(path)
    if (level === 'none') continue
    for (const item of items) {
      if (!keepsDiagnosticAtLevel(level, item.severity)) continue
      // 门控按「检查项身份」的候选键逐级查（诊断码 > 检查器），见 src/inspectionProfile.ts。
      const severity = applyInspectionProfile(item.source ?? '', item.severity, item.code, item.tags)
      if (severity === null) continue
      // 关联位置原样带出来（宿主没透传时 undefined ⇒ 面板不渲染那一节）；本地检查通道没有这一格，
      // 它按消息模板产诊断，给不出「另一个位置」，所以不编造。
      const related = relatedFrom(item)
      result.push({ path, line: item.line, character: item.character, severity,
                    message: item.message, source: item.source ?? '',
                    code: item.code === undefined || item.code === null ? undefined : String(item.code),
                    tags: item.tags, ...(related ? { related } : {}) })
    }
  }
  for (const [path, items] of localDiagnostics) {
    // 文件级过滤器（`ProblemHighlightFilter` EP）：分析忽略 / 覆盖类型两道 bundled 过滤器，
    // 任一条返回 false 就整份文件不进表；第三方挂进来的过滤器同样在这条判定里生效。
    if (!shouldHighlightFileByFilters(path)) continue
    const level = highlightLevelForPath(path)
    if (level === 'none') continue
    for (const item of items) {
      if (!keepsDiagnosticAtLevel(level, item.severity)) continue
      const severity = applyInspectionProfile(item.source ?? '', item.severity)
      if (severity === null) continue
      // 本地检查没有独立的诊断码，它的身份就是检查器短名（`source`，见 ProblemRow.code 的注释）。
      result.push({ path, line: item.line, character: item.character, severity,
                    message: item.message, source: item.source, code: item.source })
    }
  }
  result.sort((a, b) => a.severity - b.severity || a.path.localeCompare(b.path) || a.line - b.line)
  return result
})
