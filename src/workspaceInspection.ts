// 整工程检查 —— IDEA 的 Analyze → Inspect Code。
//
// 这个模块只管**一件事**：跑一次 `workspace/diagnostic`，把报告合并进问题面板读的那张
// 诊断表。触发方式、通知与 store 都从 `deps` 注入 —— App.vue 里不该出现"遍历报告、
// 判断 kind、写 map"这类过程代码，那正是把逻辑堆回大文件的开始。
//
// 报告怎么合并的规则（尤其 `unchanged` 不能被当成"这个文件没诊断"）在
// `src/workspaceDiagnostics.ts`，这里不复述。

import type { LspDiagnostic } from './bridge'
// 显式 `.ts` 后缀：Node 直跑 .ts 时不做扩展名推断（`tests/workspace-diagnostics.test.mjs` 直接 import 这里）。
import {
  describeWorkspaceDiagnostics,
  planWorkspaceReports,
  previousResultIdsFrom,
  type WorkspaceDiagnosticsResult,
} from './workspaceDiagnostics.ts'

export interface WorkspaceInspectionDeps {
  /** 发一次 `lsp.request { kind: 'workspaceDiagnostic' }`。 */
  query: (previousResultIds: Array<{ path: string; value: string }>) => Promise<WorkspaceDiagnosticsResult>
  /** 问题面板读的那张诊断表（`lspDiagnostics`）。 */
  diagnostics: Map<string, LspDiagnostic[]>
  /** path → resultId，跨次调用保留，供下一轮省掉没变文件的重算。 */
  resultIds: Map<string, string>
}

export interface WorkspaceInspectionOutcome {
  ok: boolean
  message: string
  /** 这一轮真正落到诊断表里的文件数。 */
  scanned: number
  /** 落进诊断表的问题条数。 */
  found: number
}

/**
 * 跑一次整工程检查并把结果并入诊断表。
 *
 * 抛出的错误由调用方兜（网络/协议失败与"服务器没这个能力"都应该变成一句可读的提示，
 * 而不是让面板卡住），所以这里不做 try/catch —— 一个函数只负责一件事。
 */
export async function runWorkspaceInspection(deps: WorkspaceInspectionDeps): Promise<WorkspaceInspectionOutcome> {
  const result = await deps.query(previousResultIdsFrom(deps.resultIds))
  if (!result.available) {
    return { ok: false, message: '语言服务没有返回整工程诊断。', scanned: 0, found: 0 }
  }
  const plan = planWorkspaceReports(result.items)
  for (const write of plan.writes) deps.diagnostics.set(write.path, write.diagnostics)
  // resultId 表整体替换：上一轮报过、这一轮没出现的文件不该继续带着旧 id，
  // 否则下一轮会把一个服务器已经忘掉的 id 发回去。
  deps.resultIds.clear()
  for (const id of plan.ids) deps.resultIds.set(id.path, id.value)
  const found = plan.writes.reduce((sum, write) => sum + write.diagnostics.length, 0)
  return {
    ok: true,
    message: describeWorkspaceDiagnostics(plan),
    scanned: plan.writes.length + plan.unchanged,
    found,
  }
}
