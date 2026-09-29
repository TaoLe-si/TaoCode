// 问题面板的数据源 —— IDEA 的「问题」工具窗口（`ProblemsView`：把所有 `HighlightInfo` 汇总成一张表）。
//
// 为什么单独成模块：它只读 LSP 诊断表（`lspDiagnostics`，reactive Map），是一个**零依赖派生**；
// 放在宿主里会占掉 App.vue 的机检上限，而它与"谁渲染它"无关（状态栏计数、问题面板、让「激活问题工具窗口」
// 那一行按有无问题启停，都读同一个表）。
import { computed } from 'vue'
import { lspDiagnostics } from './bridge'

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
}

/**
 * 全部诊断按「严重度 → 路径 → 行号」排序（IDEA 的问题视图默认就是这个顺序）。
 * 表本身是 reactive Map，所以这里是响应式的。
 */
/** IDEA `ProblemDescriptor` 的严重度中文名（问题面板与状态栏同一套）。 */
export const severityLabel = (severity: number): string =>
  severity === 1 ? '错误' : severity === 2 ? '警告' : severity === 3 ? '提示' : '信息'

/** 严重度对应的样式类（`src/style.css` 里的 `.sev-*`）。 */
export const severityClass = (severity: number): string =>
  severity === 1 ? 'sev-error' : severity === 2 ? 'sev-warning' : 'sev-info'

export const allProblems = computed<ProblemRow[]>(() => {
  const result: ProblemRow[] = []
  for (const [path, items] of lspDiagnostics) {
    for (const item of items)
      result.push({ path, line: item.line, character: item.character, severity: item.severity,
                    message: item.message, source: item.source ?? '' })
  }
  result.sort((a, b) => a.severity - b.severity || a.path.localeCompare(b.path) || a.line - b.line)
  return result
})
