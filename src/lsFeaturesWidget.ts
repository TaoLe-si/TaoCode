// 语言服务的**状态面**（上游 `lsWidget` + `serviceView` 两族）在本仓前端的等价物。
//
// 上游这一族分两层，本模块把两层合成一份纯模型（不碰 DOM，所以能直接跑测试）：
//   · `platform/lsp-impl/src/impl/lsWidget/LspWidgetItemsProvider.kt:15-26`
//     —— 一个 provider 汇总所有 `LspIntegrationProvider.createWidgetItems` 的条目，
//     并用 `LspClientManagerListener.serverStateChanged` 订阅状态变化去 `updateWidget()`。
//   · `platform/lsp/src/api/lsWidget/LspClientWidgetItem.kt` —— **每台服务器一个条目**，
//     它决定图标、tooltip、错误标记、存活徽章、动作文案与「停止还是重启」。
//   · `platform/lang-api/src/com/intellij/platform/lang/lsWidget/LanguageServiceWidgetItem.kt:53-80`
//     —— 基类：把 `isError` 叠成错误标记、把 `runningState` 叠成存活徽章（`:57-63`），
//     并定义两个枚举（`:88-91`）。
//   · `platform/lsp-impl/src/impl/serviceView/LspClientServiceViewDescriptor.kt:52-67`
//     —— Services 树里那一行的图标与 details 文案（按状态四分支）。
//
// 本仓的差异（如实，都是宿主能力决定的，不是省事）：
//   1. **一个语言只有一台服务器**（`native/lsp_config.cpp` 的合成表），所以上游
//      `flatMap` 多个 provider 的形状退化成"每种语言一条"；`rootPostfix`
//      （`LspClientWidgetItem.kt:85-90`，多客户端时显示 `…/子目录`）恒为空 —— 本仓没有第二个客户端。
//   2. `versionPostfix`（`:81-83`）取自 `initializeResult.serverInfo.version`，
//      而 `Session::language_status` 的回包只有 `{running, ready, configured, language, error?}`
//      （`native/lsp_capability_queries.cpp:139-144`），**没有 serverInfo** ⇒ 恒为空。
//   3. 上游的 `ShutdownNormally` 在本仓不存在（理由见 `src/lsSessionState.ts` 头注），
//      所以「已停止」那一档本仓判不到，只有「已终止」—— 停机一律按异常停机呈现。
//   4. `showErrorOutput`（`LspClientWidgetItem.kt:129-133`）指向上游的
//      `LspWidgetInternalService.createShowErrorOutputAction`，本仓的等价物是
//      `src/lspServerLog.ts` 的按语言输出（已在消息窗口里），所以这里只保留"该给这条"这个判断。
//   5. **状态表由 `lsp.open` 的回包驱动**（`src/lsSessionState.ts`）—— 宿主不推状态变化事件，
//      而前端唯一会读 `lsp.open` 回包的地方是 `src/lspCompletionStartup.ts` 与
//      `src/components/CodeEditor.vue`，两个都不在本批的可改文件里，所以
//      `lspSessionStates` 目前**没有生产写入方**（见报告的接线请求一节）。

import {
  canTransitionLspState,
  isExpectedToHandleFile,
  isTerminalLspState,
  lspSessionStates,
  type LspClientFacts,
  type LspServerState,
} from './lsSessionState.ts'
import { LSP_FEATURES, degradationForKind, type LspFeatureRow } from './lspFeatureMatrix.ts'

// ——— 文案（逐条取上游中文包，不自编）———

/** `language.services.widget`（`platform/lang-api/resources/messages/LangBundle.properties:604`）。 */
export const LANGUAGE_SERVICES_TITLE = '语言服务'
/** `language.services.widget.no.services`（同文件 `:609`）。 */
export const NO_SERVICES = '无服务'
/** `language.services.widget.section.running.on.current.file`（同文件 `:607`）。 */
export const SECTION_CURRENT_FILE = '正在当前文件上运行'
/** `language.services.widget.section.running.on.other.files`（同文件 `:608`）。 */
export const SECTION_OTHER_FILES = '正在其他文件上运行'

/** `language.services.widget.item.initializing={0} | 正在初始化…`（`LangBundle.properties:610`）。 */
export const ITEM_INITIALIZING = '{0} | 正在初始化…'
/** `language.services.widget.item.shutdown.normally={0} | 已停止`（同文件 `:611`）——
 *  本仓判不到这一档（`lspServerState` 把两种停机都归成 `shutdownUnexpectedly`），保留仅为对照。 */
export const ITEM_STOPPED = '{0} | 已停止'
/** `language.services.widget.item.shutdown.unexpectedly={0} | 已终止`（同文件 `:612`）。 */
export const ITEM_TERMINATED = '{0} | 已终止'

/** `action.RestartLspServerAction.text`（`platform/lsp/resources/messages/LspBundle.properties:27`）。 */
export const RESTART_ACTION = '重启服务器'
/** `action.StopLspServerAction.text`（同文件 `:26`）。 */
export const STOP_ACTION = '根据需要停止并自动运行服务器'

/** `services.lsp.root.node`（`LspBundle.properties:13`）—— Services 树里那一组的名字。 */
export const SERVICES_ROOT_NODE = '语言服务器 (LSP)'

// ——— 两个枚举（`LanguageServiceWidgetItem.kt:88-91`）———

/** `LanguageServiceItemRunningState`（同文件 `:91`）。 */
export type LspRunningState = 'running' | 'initializing' | 'notRunning'

/** `LanguageServicePopupSection`（同文件 `:88`）：这一条是给当前文件用的还是给其它文件用的。 */
export type LspPopupSection = 'forCurrentFile' | 'other'

// ——— 条目本体 ——

/** 上游 `LspClientWidgetItem` 在本仓要的那几项事实（上游那些从 `lspClient` / `descriptor` 直接取）。 */
export interface LspWidgetFacts extends LspClientFacts {
  /** 语言 id（`status.language`，`native/lsp_capability_queries.cpp:141`）；状态表就是按它分格的。 */
  language: string
  /**
   * `descriptor.roots`（上游 `LspClientWidgetItem.kt:87`）。空 = 工作区根。
   * 由调用方给：宿主不向前端暴露 `ServerConfig.workspace_folders`（`native/lsp_session.hpp:38`）。
   */
  roots: readonly string[]
  /** 宿主回包里的停机原因（有 `error` 时给；`unsupportedFeatureMessage` 那类文案用得上）。 */
  error?: { code?: string; message?: string } | null
}

/** `ProjectFileIndex.isInContent` 的等价物（本仓单根工作区 = 在工作区里）。 */
export interface ContentIndex {
  isInContent: (path: string) => boolean
}

/** 一个语言服务条目（上游 `LspClientWidgetItem` 的可见面）。 */
export interface LspWidgetItem {
  language: string
  /** `descriptor.presentableName`（上游 `:44`、`:79`）。 */
  presentableName: string
  /** `statusBarTooltip = presentableName + versionPostfix`（上游 `:43-44`）。 */
  tooltip: string
  /** `isError`（上游 `:46`）：只在异常停机时为真 ⇒ 图标叠错误标记（`LanguageServiceWidgetItem.kt:57`）。 */
  isError: boolean
  /** `runningState`（上游 `:49-53`）⇒ 存活徽章（`LanguageServiceWidgetItem.kt:58-61`）。 */
  runningState: LspRunningState
  /** `widgetActionLocation`（上游 `:55-63`）。 */
  section: LspPopupSection
  /** `widgetActionText`（上游 `:65-71`）：`Running` 那一档就是标签本身，没有后缀。 */
  actionText: string
  /** `createStopOrRestartAction()`（上游 `:115-127`）该出哪个动作；null = 不出。 */
  stopOrRestart: 'restart' | 'stop' | null
  /** `createAdditionalInlineActions()`（上游 `:129-133`）：异常停机才给「看错误输出」。 */
  showErrorOutput: boolean
  /** 宿主回包里的错误（有则带上，排障时能定位）。 */
  error?: string | null
}

/** `itemLabel = presentableName + versionPostfix + rootPostfix`（上游 `:73-90`；本仓后两项恒空，见头注 1/2）。 */
function itemLabel(facts: LspWidgetFacts): string {
  return facts.presentableName
}

/**
 * `runningState`（上游 `:49-53`）：`Running`/`Initializing` 各对一档，**其余全落 `notRunning`**。
 * 所以本仓的 `unconfigured`（还没配服务器）也落 `notRunning` —— 上游那一格是"没有客户端对象"。
 */
export function lspRunningState(state: LspServerState | undefined): LspRunningState {
  if (state === 'running') return 'running'
  if (state === 'initializing') return 'initializing'
  return 'notRunning'
}

/**
 * `widgetActionText`（上游 `:65-71`）的四分支。`Running` 那一支**没有后缀**（`:68`），
 * 其余三支都是 `LangBundle` 的 `{0} | …` 模板。
 */
export function lspWidgetActionText(state: LspServerState | undefined, label: string): string {
  if (state === 'initializing') return ITEM_INITIALIZING.replace('{0}', label)
  if (state === 'running') return label
  if (state === 'shutdownUnexpectedly') return ITEM_TERMINATED.replace('{0}', label)
  return ITEM_STOPPED.replace('{0}', label)
}

/**
 * `widgetActionLocation`（上游 `:55-63`）：当前文件**同时**满足三道闸才归 `ForCurrentFile` ——
 * descriptor 认得这个文件、某个 root 覆盖它、它在工程内容里。
 * 这三道闸就是 `LspPendingClient.isExpectedToHandleFile` 的那三条
 * （`lsp-impl/.../features/LspPendingClient.kt:33-39`），所以直接复用同一个判据，不另写一份。
 */
export function lspWidgetSection(
  facts: LspWidgetFacts,
  content: ContentIndex,
  currentFile: string | null,
): LspPopupSection {
  if (currentFile === null || currentFile === '') return 'other'
  return isExpectedToHandleFile(facts, content, currentFile) ? 'forCurrentFile' : 'other'
}

/**
 * `createStopOrRestartAction()`（上游 `:115-127`）：
 *   · 归 `ForCurrentFile` 的**一律是重启**（用户是为这个文件点的）。
 *   · 归 `Other` 的按状态：握手中/就绪 → 停止；正常停机 → 不出动作；异常停机 → 重启。
 * 本仓判不到「正常停机」那半边（两种停机都落 `shutdownUnexpectedly`），
 * 而 `unconfigured`（没有服务器可停）落上游 `ShutdownNormally` 那一支 —— 不出动作。
 */
export function lspStopOrRestart(section: LspPopupSection, state: LspServerState | undefined): LspWidgetItem['stopOrRestart'] {
  if (section === 'forCurrentFile') return 'restart'
  if (state === 'initializing' || state === 'running') return 'stop'
  if (state === 'shutdownUnexpectedly') return 'restart'
  return null
}

/**
 * 一个条目（上游 `LspClientWidgetItem` 的构造 + 那几个派生属性）。
 * `currentFile` / `content` 缺省时按"没有当前文件"处理（`Other`）。
 */
export function lspClientWidgetItem(
  facts: LspWidgetFacts,
  options: { currentFile?: string | null; content?: ContentIndex } = {},
): LspWidgetItem {
  const section = options.content
    ? lspWidgetSection(facts, options.content, options.currentFile ?? null)
    : 'other'
  const label = itemLabel(facts)
  const isError = facts.state === 'shutdownUnexpectedly'
  return {
    language: facts.language,
    presentableName: facts.presentableName,
    tooltip: facts.presentableName,
    isError,
    runningState: lspRunningState(facts.state),
    section,
    actionText: lspWidgetActionText(facts.state, label),
    stopOrRestart: lspStopOrRestart(section, facts.state),
    showErrorOutput: isError,
    error: facts.error?.message ?? null,
  }
}

/** 上游 `LspWidgetItemsProvider.createWidgetItems`（`:15-16`）的汇总：本仓每种语言一条。 */
export function lspWidgetItems(
  entries: readonly { language: string; facts: LspWidgetFacts }[],
  options: { currentFile?: string | null; content?: ContentIndex } = {},
): LspWidgetItem[] {
  return entries.map(entry => lspClientWidgetItem(entry.facts, options))
}

/**
 * 一行状态摘要（`LspServiceViewContributor` 那一组在 Services 树里的样子）。
 * 一台都没有时给 `language.services.widget.no.services`（`LangBundle.properties:609`）。
 */
export function lspWidgetLine(items: readonly LspWidgetItem[]): string {
  if (items.length === 0) return NO_SERVICES
  return items.map(item => item.actionText).join('; ')
}

/** tooltip 那一行（上游 `statusBarTooltip`，`:43-44`）：多台时逐条换行。 */
export function lspWidgetTooltip(items: readonly LspWidgetItem[]): string {
  return items.map(item => item.tooltip).join('\n')
}

// ——— 与能力降级表的合流（`ls/features`）———

/** 降级处置的三个档（`src/lspFeatureMatrix.ts` 的 `LspFeatureRow.fallback`）。 */
export type LspFallback = LspFeatureRow['fallback']

/** 本仓按设计就走的本地回退（`local` 档）—— 服务端不提供时本仓仍有等价物，功能不算缺。 */
export function localFallbackKinds(): string[] {
  return LSP_FEATURES.filter(row => row.fallback === 'local').map(row => row.kind)
}

/** 某个 kind 在本仓是不是还能用（`featureUsableWithoutServer` 的语义：`local` 才算）。 */
export function featureStillUsable(kind: string): boolean {
  return degradationForKind(kind) === 'local'
}

/**
 * 这个状态的服务器**能不能靠重启救回来**。
 *
 * 上游没有这个函数，它由三处拼出来：`LspClientWidgetItem.kt:124` 只在异常停机时给
 * `RestartLspClientAction`，而 `LspClientImpl.kt:83-84` 把停机态做成**终态**——
 * 也就是说上游不会把一台死掉的服务器自己拽回来，重启一定是个**新客户端对象**。
 * 本仓的等价物是 `lspCompletionStartup.ts` 的 `lsp.stop` + `lsp.open` 那一轮（它已经在做这件事，
 * `tests/lsp-completion-startup.test.mjs:110` 记着那个顺序），所以这里只回答"该不该走那一轮"。
 */
export function shouldRestartLspLanguage(state: LspServerState | undefined): boolean {
  return isTerminalLspState(state)
}

/** 这一格的状态迁移合不合法（`LspClientImpl.kt:81-87` 的闸，转出给别的域用）。 */
export function lspStateTransitionAllowed(from: LspServerState | undefined, to: LspServerState): boolean {
  return canTransitionLspState(from, to)
}

/** 状态表（`lspSessionStates`）的键序快照，供宿主/面板遍历。 */
export function knownLspLanguages(): string[] {
  return Object.keys(lspSessionStates)
}
