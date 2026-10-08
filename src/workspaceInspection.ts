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
  DiagnosticSourceCaches,
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
  /**
   * 诊断的两份按特性缓存（push / pull，上游 `LspHighlightingCacheRegistry.kt:26-27`）。
   * 缺省 = 本模块自持的那一份（跨次调用保留，`Unchanged` 与 push 覆盖后要重并都靠它）；
   * 测试用例各传各的以免互相串状态。
   */
  sources?: DiagnosticSourceCaches
}

/**
 * 本模块自持的那两份缓存（每个会话一份，等价上游"每个 LSP client 一份 registry"，
 * `LspHighlightingCacheRegistry.kt:23` 的构造位置就是 `LspClientImpl.kt:106`）。
 * **不需要**额外的重置口：构造时它自登记进 `src/lspPerFileCache.ts` 的那张注册表，
 * 于是上游 `LspClientImpl.kt:398` 那一次 `highlightingCacheRegistry.clearCache()` 在本仓的两个生产触发点
 * 都会连它一起清掉 —— 语言服务重启（`src/lsSessionHost.ts` 的 `resetLspSession()`）与
 * 服务器自己要求重取（`src/lspProgress.ts` 里 `route === 'refresh'` → `clearAllLspCaches()`）。
 */
const sharedDiagnosticSources = new DiagnosticSourceCaches()

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
  // 取消位：上游的整工程检查是 `Task.Backgroundable(project, title)` —— 那个两参构造器把
  // `canBeCancelled` 写成 **true**（`platform/core-api/src/com/intellij/openapi/progress/Task.java:202-204`，
  // 三参构造器在 `:206-208`），所以「正在检查代码」这一行给得出取消按钮
  // （`InfoAndProgressPanel.kt:753` 那颗按钮就是按 `task.isCancellable()` 画的）。
  // 回调由 `ConcurrentTasksProgressManager.cancel()` 先调（`src/progressTasks.ts:120-130`；
  // 上游那个委托是 `ProgressIndicatorModel.kt:32-34`：`:33` 调回调、`:34` 才真取消），
  // 它把 `cancelled` 置起来之后**剩下的事一件都不做**：上游每处理一个文件、每走一步范围都要过
  // `ProgressManager.checkCanceled()` —— `platform/lang-impl/src/com/intellij/codeInspection/ex/GlobalInspectionContextImpl.java:488` 是处理每个文件的第一句，`:466` 在收集之前，`:694` 与 `:722` 在遍历范围里；
  // 取消就是让那些写入不发生。同文件 `:726-727` 把 `ProcessCanceledException` 吞掉、`:729-733` 的
  // finally 照走 —— 对应这里 `finally` 仍然把那一行收掉。
  let cancelled = false
  backgroundTaskManager.begin(WORKSPACE_INSPECTION_TASK_ID, '正在检查代码', {
    detail: `整工程诊断（配置档 ${profile}）`,
    onCancel: () => { cancelled = true },
  })
  const cancelledOutcome = (): WorkspaceInspectionOutcome =>
    ({ ok: false, message: '整工程检查已取消。', scanned: 0, found: 0, skipped: 0, profile })
  try {
    const result = await deps.query(previousResultIdsFrom(deps.resultIds))
    // 取消发生在请求在途时：结果到手也不写表（把在途那条 `workspace/diagnostic` 真的掐掉是宿主的事，
    // 见 `docs/wiring-requests-2026-10-06-msgaudit.md` R4；这里给的是"不再写入"的可观察停止）。
    if (cancelled) return cancelledOutcome()
    if (!result.available) {
      return { ok: false, message: '语言服务没有返回整工程诊断。', scanned: 0, found: 0, skipped: 0, profile }
    }
    const plan = planWorkspaceReports(result.items)
    const sources = deps.sources ?? sharedDiagnosticSources
    // 分析范围（问题面板工具栏选的那份）：范围外的报告不写进诊断表 —— 与 IDEA 只在范围内
    // 找问题同义；resultId 仍然全部记下（下一轮这些文件可以回 unchanged，省掉重算）。
    const scoped = filterByAnalysisScope(plan.writes, write => write.path)
    const scopedUnchanged = filterByAnalysisScope(
      (result.items ?? []).filter(report => report.kind === 'unchanged'), report => report.path)
    if (cancelled) return cancelledOutcome()
    backgroundTaskManager.update(WORKSPACE_INSPECTION_TASK_ID, { detail: `合并 ${scoped.kept.length + plan.unchanged} 个文件` })
    // 写共享槽的是 **push 那一份 + pull 那一份**（上游 `getDiagnosticsAndQuickFixes` 的合并口径），
    // 不是 pull 报告本身 —— 直接 set 会把编辑器里服务端推来的波浪线整份换掉。
    for (const write of scoped.kept) {
      if (cancelled) break // 上游那句 `ProgressManager.checkCanceled()` 的等价物（每个文件之前一次）
      const merged = sources.applyPullReport(write.path, deps.diagnostics.get(write.path), write.diagnostics)
      deps.diagnostics.set(write.path, merged)
    }
    if (cancelled) return cancelledOutcome()
    // `unchanged` 的文件：内容沿用，但中间 push 可能已经把这个文件的槽整体换掉过，
    // 所以按记着的那份 pull 结果再并一次（不重算请求）。
    for (const report of scopedUnchanged.kept) {
      if (cancelled) break
      const merged = sources.remergePull(report.path, deps.diagnostics.get(report.path))
      if (merged !== null) deps.diagnostics.set(report.path, merged)
    }
    if (cancelled) return cancelledOutcome()
    // 上一轮拉过、这一轮报告里**完全没有**的文件：pull 那一份作废，只剩 push 的那一份
    // （与下面 resultId 表整体替换同一口径）。从没拉过的文件 `dropPull` 给 null，不去动它。
    const mentioned = new Set((result.items ?? []).map(report => report.path))
    for (const path of sources.pulledPaths()) {
      if (cancelled) break
      if (mentioned.has(path)) continue
      const pushed = sources.dropPull(path, deps.diagnostics.get(path))
      if (pushed !== null) deps.diagnostics.set(path, pushed)
    }
    if (cancelled) return cancelledOutcome()
    // resultId 表整体替换：上一轮报过、这一轮没出现的文件不该继续带着旧 id，
    // 否则下一轮会把一个服务器已经忘掉的 id 发回去。
    // 放在取消判据**之后**：这一轮的结果既然没写进诊断表，就不该把上一轮的 id 换掉，
    // 不然下一轮会以为这些文件已经被这次检查覆盖过。
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
