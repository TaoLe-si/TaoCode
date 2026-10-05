// 整工程检查 —— IDEA 的 Analyze → Inspect Code。
//
// 这个模块只管**一件事**：跑一次 `workspace/diagnostic`，把报告合并进问题面板读的那张
// 诊断表。触发方式、通知与 store 都从 `deps` 注入 —— App.vue 里不该出现"遍历报告、
// 判断 kind、写 map"这类过程代码，那正是把逻辑堆回大文件的开始。
//
// 报告怎么合并的规则（尤其 `unchanged` 不能被当成"这个文件没诊断"）在
// `src/workspaceDiagnostics.ts`，这里不复述。

import type { LspDiagnostic } from './bridge'
import { backgroundTaskManager } from './progressTasks.ts'
// 分析范围（上游 `BaseAnalysisAction`/`BaseAnalysisActionDialog`/`AnalysisUIOptions` 一族，
// 见 src/analysisScope.ts）：整工程报告写进诊断表之前先过一遍范围，范围外的文件不落表。
import { analysisScope, filterByAnalysisScope, scopeSummary } from './analysisScope.ts'
// 显式 `.ts` 后缀：Node 直跑 .ts 时不做扩展名推断（`tests/workspace-diagnostics.test.mjs` 直接 import 这里）。
import {
  describeWorkspaceDiagnostics,
  planWorkspaceReports,
  previousResultIdsFrom,
  type WorkspaceDiagnosticsResult,
} from './workspaceDiagnostics.ts'
// 当前检查配置档（上游 `InspectionProfileManager.getCurrentProfile()`，见 src/inspectionProfile.ts）：
// 整工程检查是**在当前 profile 下**跑的，报告里带档名，让「跑的是哪份配置」可见。
import { currentProfileName } from './inspectionProfile.ts'

/** 整工程检查在后台任务表里的 id（`src/progressPanel.ts` 的状态栏列表读同一张表）。 */
export const WORKSPACE_INSPECTION_TASK_ID = 'workspace:inspection'

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
  /** 因为不在分析范围里被跳过的报告文件数（`AnalysisScope` 的等价物）。 */
  skipped: number
  /** 这一轮跑在哪个检查配置档下（`getCurrentProfile()`）。 */
  profile: string
}

/**
 * 跑一次整工程检查并把结果并入诊断表。
 *
 * 抛出的错误由调用方兜（网络/协议失败与"服务器没这个能力"都应该变成一句可读的提示，
 * 而不是让面板卡住），所以这里不做 try/catch —— 一个函数只负责一件事。
 */
export async function runWorkspaceInspection(deps: WorkspaceInspectionDeps): Promise<WorkspaceInspectionOutcome> {
  // 整工程检查是长任务：在后台任务表里登记一行（状态栏进度列表可见），
  // 进度拿不到总量 —— 如实按不确定式（percent -1）显示，跑完/出错都收掉这一行
  // （`BackgroundTaskUtil.executeWithProgress` 的 try/finally 语义，见 src/progressTasks.ts）。
  const profile = currentProfileName()
  backgroundTaskManager.begin(WORKSPACE_INSPECTION_TASK_ID, '正在检查代码', { detail: `整工程诊断（配置档 ${profile}）` })
  try {
    const result = await deps.query(previousResultIdsFrom(deps.resultIds))
    if (!result.available) {
      return { ok: false, message: '语言服务没有返回整工程诊断。', scanned: 0, found: 0, skipped: 0, profile }
    }
    const plan = planWorkspaceReports(result.items)
    // 分析范围（问题面板工具栏选的那份）：范围外的报告不写进诊断表 —— 与 IDEA 只在范围内
    // 找问题同义；resultId 仍然全部记下（下一轮这些文件可以回 unchanged，省掉重算）。
    const scoped = filterByAnalysisScope(plan.writes, write => write.path)
    backgroundTaskManager.update(WORKSPACE_INSPECTION_TASK_ID, { detail: `合并 ${scoped.kept.length + plan.unchanged} 个文件` })
    for (const write of scoped.kept) deps.diagnostics.set(write.path, write.diagnostics)
    // resultId 表整体替换：上一轮报过、这一轮没出现的文件不该继续带着旧 id，
    // 否则下一轮会把一个服务器已经忘掉的 id 发回去。
    deps.resultIds.clear()
    for (const id of plan.ids) deps.resultIds.set(id.path, id.value)
    const found = scoped.kept.reduce((sum, write) => sum + write.diagnostics.length, 0)
    const scopeNote = scoped.skipped
      ? `（范围「${scopeSummary(analysisScope.value)}」跳过了 ${scoped.skipped} 个范围外文件）`
      : ''
    return {
      ok: true,
      message: `${describeWorkspaceDiagnostics(plan)}（配置档「${profile}」${scopeNote}）`,
      scanned: scoped.kept.length + plan.unchanged,
      found,
      skipped: scoped.skipped,
      profile,
    }
  } finally {
    backgroundTaskManager.end(WORKSPACE_INSPECTION_TASK_ID)
  }
}
