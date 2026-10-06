// LSP `workspace/diagnostic` —— IDEA 的**整工程批处理 Inspection**（Analyze → Inspect Code）：
// 一次问出所有文件的诊断，而不是逐个文件拉。
//
// 两条规则是这个模块存在的理由：
//   1. `kind: "unchanged"` 的报告**没有** `items`（规范如此）。把它当成"这个文件现在没有诊断"
//      会把一整批诊断从问题面板里抹掉 —— 所以 unchanged **不写**诊断表，只更新它的 resultId。
//   2. `previousResultIds` 只带**有 resultId** 的文件。带空串等于告诉服务器"上一份是空的"，
//      它会走另一条路（重算），省不下一次计算。
//
// 第三块（本轮补的 `ls/highlighting` 缺项）：诊断的**两份来源**按特性各存一份、读时合并
// —— 上游 `platform/lsp-impl/src/impl/features/highlightingCommon/LspHighlightingCacheRegistry.kt:26-27`
// 把 push 与 pull 两个缓存**并列注册**：
//   · `publishDiagnosticsCache`（`LspPublishDiagnosticsCache.kt:31` 的 `supportsPull = false`）
//     —— 服务端 `textDocument/publishDiagnostics` 推来的；
//   · `pullDiagnosticsCache`（`LspPullDiagnosticsCache.kt:19`）—— `workspace/diagnostic` 拉来的。
// 面板读的是 `getDiagnosticsAndQuickFixes`（`:64-80`）：**先给 push 的那一份、再把 pull 里
// 与 push 重复的那条丢掉**（`:92` `if (alreadyKnownDiagnostics.contains(diagnostic)) return@mapNotNull null`），
// 两份缓存都不会被对方覆盖。
// 本仓原来只有**一个共享槽**（`bridge.ts` 的 `lspDiagnostics`）：整工程报告直接 `set` 进去，
// 于是"跑一次检查代码"会把编辑器里 push 来的波浪线整份换掉 —— 与上游语义不符，
// 且被换掉的那一份再也不会回来（服务端不重推就没机会）。下面的 `DiagnosticSourceCaches`
// 就是那两份缓存的等价物：pull 那一份单独记，写回共享槽的是合并结果，
// 下次合并前先把"我们上次塞进去的那几条"减掉，剩下的就是 push 的当前真相。

import type { LspDiagnostic } from './bridge'
// 批量作废的注册表（上游 `LspClientImpl.kt:398` 那一次 `highlightingCacheRegistry.clearCache()` 的等价物）：
// 两个生产触发点都在别人那侧 —— 语言服务重启（`src/lsSessionHost.ts` 的 `resetLspSession()`）与
// 服务器自己发 `workspace/…/refresh`（`src/lspProgress.ts` 的 `route === 'refresh'`）。
// 构造时自登记与 `LspPerFileCache` / `HighlightingSnapshotCache` 同一套做法。
import { registerLspCache, type LspCache } from './lspPerFileCache.ts'

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

// ---------------------------------------------------------------- 按特性的两份诊断缓存（LspHighlightingCacheRegistry）

/**
 * 一条诊断的身份键。上游那一步是 `alreadyKnownDiagnostics.contains(diagnostic)`
 * （`platform/lsp-impl/src/impl/features/highlightingCommon/LspHighlightingCacheRegistry.kt:92`），
 * 走的是 lsp4j `Diagnostic.equals` —— **lsp4j 不在本机参考树里，它到底比哪几个字段无法核实**，
 * 所以这里不猜，按本仓宿主**实际透传**的那几个字段取键（行列 + 严重度 + 消息 + source + code），
 * 也就是"两条看起来完全一样的诊断算同一条"。少一个字段都可能把不同的两条并成一条，
 * 那比留两条重复更糟（问题面板少一行看不出来，重复一行看得出来）。
 */
export function diagnosticIdentityKey(item: LspDiagnostic): string {
  return [item.line, item.character, item.endLine ?? -1, item.endCharacter ?? -1,
    item.severity, item.source ?? '', item.code ?? '', item.message].join('\u0000')
}

/**
 * push 在前、pull 追加 —— 与上游 `getDiagnosticsAndQuickFixes` 同一条顺序
 * （`LspHighlightingCacheRegistry.kt:79` `pushedDiagnosticsAndQuickFixes + pulledDiagnosticsAndQuickFixes`），
 * 重复的那条按 `:92` 丢掉：**只**与 push 比重复（上游也不在 pull 自己那份里再去重，
 * 服务端一次报两条一样的，面板就显示两条 —— 那是服务端的事）。
 */
export function mergeDiagnosticSources(
  pushed: readonly LspDiagnostic[],
  pulled: readonly LspDiagnostic[],
): LspDiagnostic[] {
  if (!pulled.length) return [...pushed]
  if (!pushed.length) return [...pulled]
  const known = new Set(pushed.map(diagnosticIdentityKey))
  return [...pushed, ...pulled.filter(item => !known.has(diagnosticIdentityKey(item)))]
}

/** 按身份键从 `list` 里减掉 `subtract` 的那些（按**次数**减，两条一样的只减两条）。 */
function subtractByIdentity(list: readonly LspDiagnostic[], subtract: readonly LspDiagnostic[]): LspDiagnostic[] {
  if (!subtract.length) return [...list]
  const remaining = new Map<string, number>()
  for (const item of subtract) {
    const key = diagnosticIdentityKey(item)
    remaining.set(key, (remaining.get(key) ?? 0) + 1)
  }
  const out: LspDiagnostic[] = []
  for (const item of list) {
    const key = diagnosticIdentityKey(item)
    const left = remaining.get(key) ?? 0
    // 我们上一次塞进去的那一条：不当成 push 的（它可能已经被服务端 push 覆盖了，也可能没有）。
    if (left > 0) { remaining.set(key, left - 1); continue }
    out.push(item)
  }
  return out
}

/**
 * 诊断的两份按特性注册的缓存（`LspHighlightingCacheRegistry.kt:26-27`）+ 读时合并（`:64-80`）。
 *
 * 上游有两个独立槽（push 那份 `supportsPull = false`，见 `LspPublishDiagnosticsCache.kt:31`），
 * 面板每次读都现算并集；本仓的共享槽（`bridge.ts` 的 `lspDiagnostics`）只有一个，
 * push 处理器会整体替换它 —— 所以这里必须自己记住两件事：
 *   · `pulled`：`workspace/diagnostic` 的权威 pull 那一份（`Full` 整份替换、`Unchanged` 沿用）；
 *   · `contributed`：上一次合并时**我们往共享槽里多塞了哪几条**，下次合并前先把它减掉，
 *     减完剩下的就是服务端 push 的当前真相（等价于"从 push 缓存里读"）。
 * 少了 `contributed` 这一步，重复跑整工程检查就会把上一轮的 pull 结果误当 push 供在面板里 ——
 * 服务端已经不报的那条会变成永久幽灵行。
 */
export class DiagnosticSourceCaches implements LspCache {
  private readonly pulled = new Map<string, LspDiagnostic[]>()
  private readonly contributed = new Map<string, LspDiagnostic[]>()

  constructor() {
    // 自登记：服务器一句 `workspace/diagnostic/refresh` 或一次语言服务重启，
    // 这两份缓存都必须跟着作废（否则旧服务器的 pull 结果会留在问题面板里）。
    registerLspCache(this)
  }

  /**
   * `Unchanged` 报告：**不重算**，但要按记着的那份 pull 结果再并一次 ——
   * 中间服务端可能 push 过这个文件（共享槽被整体换掉），不重新并就会把拉来的那几条永久丢掉。
   * 这个文件从没被拉过时返回 `null`（没什么可沿用的）。
   */
  remergePull(path: string, shared: readonly LspDiagnostic[] | undefined): LspDiagnostic[] | null {
    const items = this.pulled.get(path)
    if (!items) return null
    return this.applyPullReport(path, shared, items)
  }

  /** 共享槽里"属于 push"的那一份（减掉我们上次塞进去的 pull 条目）。 */
  private pushedOf(path: string, shared: readonly LspDiagnostic[] | undefined): LspDiagnostic[] {
    return subtractByIdentity(shared ?? [], this.contributed.get(path) ?? [])
  }

  /**
   * 一次 `Full` 报告落到该文件：整份替换它的 pull 那一份，返回要写进共享槽的合并结果。
   * 合并语义见 `mergeDiagnosticSources`。
   */
  applyPullReport(path: string, shared: readonly LspDiagnostic[] | undefined, items: readonly LspDiagnostic[]): LspDiagnostic[] {
    this.pulled.set(path, [...items])
    const pushed = this.pushedOf(path, shared)
    const merged = mergeDiagnosticSources(pushed, items)
    // 记的就是"多出来的那几条"：push 里本来有的不算我们塞的（下次也不该减掉它）。
    const pushedKeys = new Set(pushed.map(diagnosticIdentityKey))
    this.contributed.set(path, merged.filter(item => !pushedKeys.has(diagnosticIdentityKey(item))))
    return merged
  }

  /**
   * 本轮报告**完全没提到**这个文件：pull 那一份作废（与 `resultId` 表整体替换同一口径），
   * 返回只剩 push 的那一份 —— 上一轮塞进去的 pull 条目不该永久留在面板里。
   * 从没拉过的文件返回 `null` = 不归本模块管，调用方别动它。
   */
  dropPull(path: string, shared: readonly LspDiagnostic[] | undefined): LspDiagnostic[] | null {
    const contributed = this.contributed.get(path)
    if (!this.pulled.has(path) && contributed === undefined) return null
    this.pulled.delete(path)
    this.contributed.delete(path)
    return subtractByIdentity(shared ?? [], contributed ?? [])
  }

  /** 上游 `clearCache`（`LspHighlightingCacheRegistry.kt:46-48`）：语言服务重启/服务器要求刷新时两份一起丢。 */
  clearCache(): void {
    this.pulled.clear()
    this.contributed.clear()
  }

  /** 调试/判据用：当前记着 pull 的那些文件。 */
  pulledPaths(): string[] {
    return [...this.pulled.keys()]
  }
}
