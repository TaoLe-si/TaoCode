// LSP `workspace/diagnostic` —— IDEA 的**整工程批处理 Inspection**（Analyze → Inspect Code）：
// 一次问出所有文件的诊断，而不是逐个文件拉。
//
// 两条规则是这个模块存在的理由：
//   1. `kind: "unchanged"` 的报告**没有** `items`（规范如此）。把它当成"这个文件现在没有诊断"
//      会把一整批诊断从问题面板里抹掉 —— 所以 unchanged **不写**诊断表，只更新它的 resultId。
//   2. `previousResultIds` 只带**有 resultId** 的文件。带空串等于告诉服务器"上一份是空的"，
//      它会走另一条路（重算），省不下一次计算。

import type { LspDiagnostic } from './bridge'

/** `WorkspaceDocumentDiagnosticReport`（full / unchanged 两个变体）。 */
export interface WorkspaceDiagnosticReport {
  /** 工作区相对路径（原生层已把 uri 映射回来）。 */
  path: string
  kind: 'full' | 'unchanged' | string
  resultId?: string
  /** 只有 `kind: 'full'` 才有这个键。 */
  diagnostics?: LspDiagnostic[]
}

export interface WorkspaceDiagnosticsResult {
  available: boolean
  items?: WorkspaceDiagnosticReport[]
}

export interface WorkspaceDiagnosticPlan {
  /** 要写进诊断表的条目（只有 full 报告会产生）。 */
  writes: Array<{ path: string; diagnostics: LspDiagnostic[] }>
  /** 下一轮要带上的 `previousResultIds`。 */
  ids: Array<{ path: string; value: string }>
  /** 沿用上一份报告的文件数（没有写诊断表）。 */
  unchanged: number
  /** 认不出来的报告数 —— 只用于如实报告，不猜它的语义。 */
  ignored: number
}

/**
 * 把一次整工程报告拟成"要做什么"。**纯函数**：不改任何 store，便于测试与复用
 * （调用方拿 `writes` 去写诊断表、拿 `ids` 去记下一轮的 previousResultIds）。
 */
export function planWorkspaceReports(reports: readonly WorkspaceDiagnosticReport[] | undefined): WorkspaceDiagnosticPlan {
  const plan: WorkspaceDiagnosticPlan = { writes: [], ids: [], unchanged: 0, ignored: 0 }
  if (!Array.isArray(reports)) return plan
  for (const report of reports) {
    if (!report || typeof report.path !== 'string' || report.path === '') { plan.ignored++; continue }
    if (report.resultId) plan.ids.push({ path: report.path, value: report.resultId })
    if (report.kind === 'full') {
      plan.writes.push({ path: report.path, diagnostics: report.diagnostics ?? [] })
      continue
    }
    if (report.kind === 'unchanged') {
      // 关键：**不写**。这是"沿用上一份"，不是"这个文件没问题"。
      plan.unchanged++
      continue
    }
    // 规范之外的 kind：不假装认识它。
    plan.ignored++
  }
  return plan
}

/** 从现有诊断表里挑出下一轮要带上的 `previousResultIds`（只带非空的）。 */
export function previousResultIdsFrom(
  ids: ReadonlyMap<string, string> | Record<string, string>,
): Array<{ path: string; value: string }> {
  const entries = ids instanceof Map ? [...ids.entries()] : Object.entries(ids)
  const out: Array<{ path: string; value: string }> = []
  for (const [path, value] of entries) {
    if (typeof path === 'string' && path && typeof value === 'string' && value) out.push({ path, value })
  }
  return out
}

/** 状态栏/通知用的一句话总结。空报告也要说清楚（"没有文件报了诊断"与"没跑"是两回事）。 */
export function describeWorkspaceDiagnostics(plan: WorkspaceDiagnosticPlan, total?: number): string {
  const scanned = typeof total === 'number' ? total : plan.writes.length + plan.unchanged + plan.ignored
  const found = plan.writes.reduce((sum, write) => sum + write.diagnostics.length, 0)
  if (scanned === 0) return '整工程诊断没有返回任何文件。'
  const parts = [`检查了 ${scanned} 个文件`, `发现 ${found} 个问题`]
  if (plan.unchanged) parts.push(`沿用 ${plan.unchanged} 个未变化的文件`)
  if (plan.ignored) parts.push(`忽略 ${plan.ignored} 条认不出的报告`)
  return `${parts.join('，')}。`
}
