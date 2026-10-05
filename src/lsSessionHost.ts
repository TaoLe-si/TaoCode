// 语言服务会话在**前端的装配层**：把「每次 `lsp.open` / `lsp.request status` 的回包」同时落到
// 两张账上 —— 状态表（`src/lsSessionState.ts` 的 `lspSessionStates`）与文档账
// （`src/lsSessionDocuments.ts` 的 `DocumentLedger`），并给消费方一个可查询的面。
//
// 为什么要有这一层（判决 `docs/inventory/verdict-platform_rest.md` 的 `ls/session` 与 `ls/platform`）：
//   · `ls/session`：「`LspOpenedFilesService` 的按文件打开集合（宿主自持，**前端没有查询面**）」；
//   · `ls/platform`：「文档同步视图（`LspDocumentAdapter`/`LspDocumentMapping`：……前端按文件路径
//     收诊断，没有 per-document 版本映射对象）」；
//   · `lsSessionStates` 此前**零生产写入方**（宿主不推状态变化事件，只有回包可读）。
// 两边都是"宿主已经算了、前端没人记账"，所以记账的**唯一真源头**就是那个回包，而回包只从
// `src/lspCompletionStartup.ts`（`lsp.open`）与 `src/lspNavigation.ts` 那一条会话启动链上经过。
// 这一层就是那条链上的落点：谁都不再各自抄一份表。
//
// 上游逐条：
//   · `platform/lsp/src/api/LspServerState.kt:10-12` —— `Initializing` 是初始态，**收到 initialize
//     回包才变 `Running`**。本仓的对应时点就是这里的 `recordSessionStatus`（每次 `lsp.open` 与
//     每一拍 `status` 轮询）。
//   · `platform/lsp-impl/src/impl/LspClientImpl.kt:83-84` —— 两个停机态是**终态**，一台死掉的客户
//     端不会自己活过来；要重启就是**新的客户端对象**（`lsSessionState.ts` 的头注第 2 条）。
//     本仓的等价物：`lsp.open` 来的时候如果这一格已经是终态，先把格子清掉再记新状态 ——
//     不清的话状态闸（`canTransitionLspState`）会把新会话的第一份状态也拒掉，界面永远停在「已终止」。
//   · `platform/lsp-impl/src/impl/documentSync/LspOpenedFilesService.kt:94-98` —— 只有
//     `state == Running` 且**还没** opened 的文件才排 `didOpen`。`pendingDidOpen()` 就是这条的查询面。
//   · `platform/lsp-impl/src/impl/features/LspPendingClient.kt:46-58` `showLspServerNotReadyHint` ——
//     客户端还在 `Initializing` 时给的是**提示**而不是静默失败。`serverHintFor()` 是给所有
//     「现在要发一条 LSP 请求」的调用方用的那一句（快速文档、Code Vision、内联提示都走它）。
//
// 本仓与上游的差异（如实）：
//   · 上游一个文件可能有多个客户端，本仓一种语言只有一台（`native/lsp_config.cpp` 的合成表），
//     所以状态表按 `status.language` 分格就够了，`rootPostfix`/`versionPostfix` 恒空
//     （理由见 `src/lsFeaturesWidget.ts` 头注 1/2）；
//   · 宿主不向前端暴露 `descriptor.presentableName`，所以提示文案里的 `{0}` 填的是
//     回包给的 `language`（`native/lsp_capability_queries.cpp:141`），不另编一个显示名。
import {
  applyLspLanguageStatus,
  lspSessionStates,
  parseLspLanguageStatus,
  serverExitedMessage,
  serverNotReadyMessage,
  type LspLanguageStatus,
  type LspServerState,
} from './lsSessionState.ts'
import {
  DocumentLedger,
  filesNeedingDidOpen,
  OpenedFilesTracker,
  type OpenedFileEntry,
  type ServerFileFacts,
  type TrackedDocument,
} from './lsSessionDocuments.ts'
import {
  lspClientWidgetItem,
  RESTART_ACTION,
  STOP_ACTION,
  type LspWidgetItem,
  type LspWidgetFacts,
} from './lsFeaturesWidget.ts'

/** 一条 `lsp.open` / `lsp.request status` 回包（宿主形状，见 `src/bridge.ts` 的 `LspOpenResult`）。 */
export type LspSessionReply = unknown

/** 文档账要的语言解析器；缺省用回包里的 `language`（宿主给的就是这台服务器认领的语言）。 */
export interface LspSessionHostOptions {
  /** 路径 → 语言 id。缺省按「这个文件由它最后一次回包的语言管」（`openedAs` 记的那一份）。 */
  languageOf?: (path: string) => string
  /** `descriptor.roots` 的等价物（空 = 工作区根，`native/lsp_session.hpp:38`）。 */
  roots?: readonly string[]
  /** `descriptor.isSupportedFile` 的等价物；缺省 = 全部认领（本仓按语言选唯一一台）。 */
  supportsFile?: (path: string) => boolean
  /** 一批待处理文件（`LspOpenedFilesService.processOpenedFiles` 的入参）。 */
  openedPaths?: readonly string[]
}

const languageByPath = new Map<string, string>()
/** 每种语言最后一份**合格**的状态回包（停机文案要用宿主给的原话，不能另编）。 */
const statusByLanguage = new Map<string, LspLanguageStatus>()
const facts = { roots: [] as readonly string[], supportsFile: (_path: string) => true }

/** 前端这一份文档账（与宿主的 `struct Document`（`native/lsp_session.hpp:143-149`）逐条对齐）。 */
export const sessionDocuments = new DocumentLedger(path => languageByPath.get(path) ?? '')
/** 待处理上报集合（`openedFilesToHandle`）；stamp 由 `nextStartRequestStamp` 供。 */
let stampCounter = 0
export const sessionOpenedFiles = new OpenedFilesTracker(() => stampCounter)

/** 换了一代服务器（停机/重启）：stamp 推进，旧的一批全部作废。 */
export function advanceLspStartRequestStamp(): number {
  return ++stampCounter
}

/**
 * `lsp.open` 那一拍：这台服务器**开始**看着这个文件（宿主 `Session::open` 建文档、`version = 1`，
 * `native/lsp_session.cpp:84-92`）。握手好了才 `opened = true`（`:92`）。
 */
export function noteDocumentOpened(path: string, serverReady: boolean, language?: string, options: LspSessionHostOptions = {}): TrackedDocument {
  const resolved = (options.languageOf?.(path) ?? language ?? '') || languageByPath.get(path) || ''
  if (resolved) languageByPath.set(path, resolved)
  const doc = sessionDocuments.open(path, serverReady)
  // `LspOpenedFilesService.kt:94-98`：Running 且还没 opened 才排一次 didOpen 上报。
  if (!serverReady) sessionOpenedFiles.reportOpened([path])
  return doc
}

/** 宿主补发完 didOpen（`flush_opens`，`native/lsp_session.cpp:353`）：把 opened 记上。 */
export function noteDocumentSynced(path: string): void {
  sessionDocuments.markSynced(path)
  const batch: OpenedFileEntry[] = sessionOpenedFiles.pending().filter(entry => entry.path === path)
  if (batch.length) sessionOpenedFiles.commit({ files: batch, scheduled: true, requestStamp: batch[0].requestStamp })
}

/** 每次编辑（宿主 `Session::change` 的 `++version`，`native/lsp_session.cpp:104`）。 */
export function noteDocumentChanged(path: string): TrackedDocument | null {
  return sessionDocuments.change(path)
}

/** 关文件（宿主 `Session::close` 先 did_close 再 erase，`native/lsp_session.cpp:110-128`）。 */
export function noteDocumentClosed(path: string): void {
  sessionDocuments.close(path)
  languageByPath.delete(path)
}

/**
 * 一条状态回包进状态表。**必须在 `lsp.open` 之后马上调**：
 * 上游的 `Initializing → Running` 时点就是 initialize 回包（`LspServerState.kt:10-12`）。
 * 回包同时用来把文档账的语言与 `opened` 补记上（`language` 是回包给的，不是猜的）。
 */
export function recordSessionStatus(data: LspSessionReply, path?: string): LspServerState | null {
  const status = parseLspLanguageStatus(data)
  if (!status) return null
  // 终态之后又来了回包 = 宿主换了一台新进程（`LspClientImpl.kt:83-84` 的"重启是新对象"）。
  if (lspSessionStates[status.language] === 'shutdownUnexpectedly') delete lspSessionStates[status.language]
  const applied = applyLspLanguageStatus(status)
  statusByLanguage.set(status.language, status)
  if (path) {
    if (status.language) languageByPath.set(path, status.language)
    if (applied && status.ready) noteDocumentSynced(path)
  }
  return applied ? lspSessionStates[status.language] ?? null : lspSessionStates[status.language] ?? null
}

/** 这一格现在的状态（没记过 = 还没有客户端对象）。 */
export function lspLanguageState(language: string): LspServerState | undefined {
  return lspSessionStates[language]
}

/** 这个文件的语言现在是什么状态（账上没这个文件时返回 undefined，调用方按"还没开会话"处理）。 */
export function lspStateForFile(path: string): LspServerState | undefined {
  const language = languageByPath.get(path) ?? sessionDocuments.documentsInFile(path)[0]?.language
  return language ? lspSessionStates[language] : undefined
}

/**
 * 停机/重启那一轮之后把表清干净（上游 `LspClientManagerImpl` 换一批客户端对象）。
 * 不清的话 `canTransitionLspState` 的终态闸会拒掉新会话的第一份状态（`lsSessionState.ts:208`）。
 */
export function resetLspSession(language?: string): void {
  advanceLspStartRequestStamp()
  if (language) { delete lspSessionStates[language]; statusByLanguage.delete(language); return }
  for (const key of Object.keys(lspSessionStates)) delete lspSessionStates[key]
  statusByLanguage.clear()
  sessionDocuments.clear()
  sessionOpenedFiles.clear()
  languageByPath.clear()
}

/** 配置里那两项（roots / supportsFile）由宿主侧的调用方补进来（宿主不暴露 descriptor.roots）。 */
export function configureLspSessionFacts(options: LspSessionHostOptions): void {
  if (options.roots) facts.roots = options.roots
  if (options.supportsFile) facts.supportsFile = options.supportsFile
}

/** `LspOpenedFilesService.kt:94-98` 的查询面：这一批里哪些文件还该补 didOpen。 */
export function pendingDidOpen(paths: readonly string[]): string[] {
  const batch = sessionOpenedFiles.reportOpened(paths)
  if (!batch.scheduled) return []
  return filesNeedingDidOpen(batch, serverFacts())
}

/** 一台服务器对某文件的事实（`LspClientImpl.isFileOpened` / `state` / `isSupportedFile`）。 */
export function serverFacts(language?: string): ServerFileFacts {
  return {
    state: language ? lspSessionStates[language] ?? 'unconfigured' : (lspSessionStates[Object.keys(lspSessionStates)[0] ?? ''] ?? 'unconfigured'),
    isFileOpened: path => sessionDocuments.documentsInFile(path).some(doc => doc.opened),
    supportsFile: path => facts.supportsFile(path),
    roots: facts.roots,
  }
}

/**
 * 「现在能不能发这条请求」的结论 —— 上游 `LspPendingClient.kt:46-58` 的 `showLspServerNotReadyHint`：
 * 还在握手中给的是**提示**（`lsp.refactoring.server.starting`，`LspBundle.properties:61`），
 * 停机了给宿主那句原话（`native/lsp_capability_queries.cpp:144` 的 `LSP_CLOSED` 消息）。
 * 就绪或根本没建会话返回 null（照旧发请求：没有状态不代表失败，本仓的 `lsp.open` 才是权威）。
 */
export function serverHintFor(path: string): string | null {
  const language = languageByPath.get(path) ?? sessionDocuments.documentsInFile(path)[0]?.language ?? ''
  const state = language ? lspSessionStates[language] : undefined
  if (state === 'initializing') return serverNotReadyMessage(language)
  // 停机那句话**照抄宿主回包里的 error.message**（`native/lsp_capability_queries.cpp:143-144`
  // 把"进程不在了"报成 `LSP_CLOSED`），本仓不另编一句 —— 与 `serverExitedMessage` 同一契约。
  if (state === 'shutdownUnexpectedly') return serverExitedMessage(statusByLanguage.get(language))
  if (state === 'unconfigured') return `${language} 没有配置语言服务。`
  return null
}

/** 一台语言服务的状态条目（`lsWidget` 那一族；状态从表里读，其余事实由调用方补）。 */
export function lspWidgetItemFor(language: string, presentableName?: string, options: { currentFile?: string | null; content?: { isInContent: (path: string) => boolean } } = {}): LspWidgetItem {
  const widgetFacts: LspWidgetFacts = {
    language,
    presentableName: presentableName ?? language,
    state: lspSessionStates[language] ?? 'unconfigured',
    roots: facts.roots,
    supportsFile: facts.supportsFile,
  }
  return lspClientWidgetItem(widgetFacts, options)
}

/** 状态栏/面板那一行（`LspWidgetItemsProvider` 汇总出的 `itemLabel` 串）。 */
export function lspSessionLine(languages: readonly string[] = Object.keys(lspSessionStates)): string {
  return languages.map(language => lspWidgetItemFor(language).actionText).join('; ')
}

/**
 * 文档账的可见面：当前被这台服务器看着的文件。
 * `LspDocumentMapping.kt:62-64` 的 `getDocumentsInFileSync` 是**按文件**查的（1:1，要么一个要么没有）；
 * 整张表的列举在本仓由这里给（`ls/session` 判词点名的就是"前端没有查询面"）。
 */
export function syncedDocuments(): TrackedDocument[] {
  const known = new Set([...Object.keys(lspSessionStates), ...[...languageByPath.values()]])
  const out: TrackedDocument[] = []
  for (const language of known) out.push(...sessionDocuments.openedByLanguage(language))
  return out.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
}

/** 执行状态面条目动作要的两样东西。 */
export interface LspWidgetItemActionDeps {
  /**
   * 宿主那条 `lsp.stop`：它**不排队**、就地收掉可能卡死的语言服务线程并换一条新的
   * （`native/main.cpp:1079-1082` → `taocode::lsp::recover(...)`，实现与理由见
   * `native/lsp_recover.cpp` 文件头）。参数它不看（整机一条线程），传空对象与
   * `src/lspCompletionStartup.ts:72` 那一条既有恢复链一致。
   */
  request: <T>(method: 'lsp.stop', params: Record<string, unknown>) => Promise<T>
  /** 给用户的那一句话（动作文案取自 `src/lsFeaturesWidget.ts`，不是这里编的）。 */
  notify?: (message: string) => void
}

/** 连点保护：一条没收完之前不再发第二条（同 `src/codeLensExtension.ts` 的在飞守卫）。 */
let lspWidgetItemActionInFlight = false

/**
 * 语言服务状态面上那一条目上的动作 ——「重启服务器」/「根据需要停止并自动运行服务器」
 * （上游 `LspClientWidgetItem.kt:115-127` 的 `createStopOrRestartAction()`；文案
 * `RestartLspServerAction`/`StopLspServerAction` 见 `LspBundle.properties:26-27`）在本仓的执行面。
 *
 * 三条判断都在这儿，不留给 UI 自己猜：
 *   1. `stopOrRestart === null` 的那一档**一条请求都不发**（上游那一档压根不出这个按钮，
 *      `lspStopOrRestart()` 已经把它算成 null；出个点了没反应的控件是本仓红线）。
 *   2. 顺序是**先清状态表、再发 stop**，照 `src/lspCompletionStartup.ts:68-73` 那条已经在跑的
 *      恢复链抄：终态闸（`lsSessionState.ts` 的 `canTransitionLspState`）会拒掉「已终止」之后的
 *      新状态，不清表的话重启回来的第一份 `running` 会被丢掉，状态面永远停在「已终止」。
 *   3. 粒度比上游**粗**：上游那条动作只作用于它自己那个客户端对象，本仓宿主只有一条语言服务
 *      线程（`native/main.cpp:1079`），`lsp.stop` 停的是全部 ⇒ 这里清整张表。
 *      用户看到的差别是：重启一台 = 所有语言的会话都重握手一次。
 */
export async function runLspWidgetItemAction(item: LspWidgetItem, deps: LspWidgetItemActionDeps): Promise<'done' | 'noop' | 'failed'> {
  if (!item.stopOrRestart || lspWidgetItemActionInFlight) return 'noop'
  const action = item.stopOrRestart === 'restart' ? RESTART_ACTION : STOP_ACTION
  lspWidgetItemActionInFlight = true
  resetLspSession()
  try {
    await deps.request('lsp.stop', {})
    deps.notify?.(`${item.presentableName}：${action} —— 已收掉旧会话，下一次请求会重新握手。`)
    return 'done'
  } catch (error) {
    // 收不掉也照实说。此时状态表已经清了，用户看到「没有配置语言服务」是真的，
    // 不能把它报成"重启成功"。
    deps.notify?.(`${item.presentableName}：${action}失败：${error instanceof Error ? error.message : String(error)}`)
    return 'failed'
  } finally {
    lspWidgetItemActionInFlight = false
  }
}
