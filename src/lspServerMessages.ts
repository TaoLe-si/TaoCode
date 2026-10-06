// 语言服务**服务器主动**发来的那几条消息与请求，前端这一侧的响应面。
//
// 为什么从 `src/lspProgress.ts` 里拆出来（2026-10-06）：那个模块原本同时管两件不相干的事 ——
// `$/progress` 的后台任务表，和服务器主动消息的处置。后半截这轮长成了「处理器注册表 +
// 丢弃计数 + showMessageRequest 的回选」，再堆进进度模块就没人说得清一条消息归谁管。
//
// 上游坐标（本机 intellij-community 树，逐条打开核过；lsp4j 的 `LanguageClient` 接口本体
// **不在本机树里** —— `libraries/lsp4j/` 只有 jar 声明
// `libraries/lsp4j/resources/intellij.libraries.eclipse.lsp4j.xml`，
// 所以取上游那个唯一实现它的类当坐标）：
//   · 声明面 `platform/lsp/src/api/Lsp4jClient.kt`：`:59-60` showMessage、`:62-63`
//     showMessageRequest（`CompletableFuture<MessageActionItem>`）、`:68-69` logMessage、
//     `:86-99` 五条 refresh（`CompletableFuture<Void>`）、`:47-51` register/unregisterCapability、
//     `:83-84` logTrace。`:39-41` 的类注释还写明：服务器发的**未文档化**方法要靠插件自己
//     子类化 `Lsp4jClient` 才能接住 —— 认不得的就没有处置口。
//   · 处置面 `platform/lsp-impl/src/impl/LspServerNotificationsHandlerImpl.kt`：
//     - `:377-382` showMessageRequest —— 项目已 disposed 时**直接 `completedFuture(null)`**；
//       否则 `logInfo` 把消息与 `actions` 的标题一起写进日志，再 `doNotify(..., params.actions)`。
//     - `:424-456` doNotify —— 每个 `MessageActionItem` 变成通知上的一个动作（`:443-451`），
//       **只有点了才** `result.complete(actionItem)`；没人点就没有值。本仓的通知面还没有那一排
//       按钮 ⇒ 按上游 disposed 那一支同值的答复：null（协议允许 `MessageActionItem | null`）。
//     - `:385-390` showMessage（日志 + 通知）；`:393-404` logMessage（Error/Warning 走
//       LOG_ERRORS_WARNINGS 组，Info/Log 走 LOG_INFO_TRACE 组，注释原文
//       `Do not spam user with all the logs from the server`）；`:407-414` logTrace。
//     - `:341-371` 五条 refresh 全部 `completedFuture(null)`，并让对应缓存作废重取。
//   · 三个通知组的 id：同文件 `:464`、`:470`、`:476`。本仓的注册表已在 `src/notificationGroups.ts`
//     （那三条逐字对上），本模块只**复用**它，不再自己造一套组名或第二套通道。
//   · 客户端能力：`platform/lsp/src/api/LspClientCapabilities.kt:246-249`
//     `window { showMessage = WindowShowMessageRequestCapabilities(); showDocument; workDoneProgress = true }`。
//
// 「声明了能力却没有处理器」在这一层是可观察的：注册表里没有对应方法的处置 ⇒ 这条消息进
// `lspServerMessageDrops`（丢弃计数）并留一行「语言服务」日志，**不再**被当成 showMessage 弹出去。
// 本模块只认宿主 `lsp.message` 事件里带了 `method` 的那些；不带 method 的按改动之前的行为走
// showMessage（旧宿主 / 预览通道的形状，`tests/lsp-progress.test.mjs` 钉着这条）。
import { reactive } from 'vue'
import { noticeGroupId, notificationGroup } from './notificationGroups.ts'
import { appendLspLog, lspLogLevelOf, logLspServerMessage } from './lspServerLog.ts'
import { clearAllLspCaches } from './lspPerFileCache.ts'

// ── 一、方法 → 处置类别 ──────────────────────────────────────────────────────────────

/** 服务器**主动**发来的那几条，本仓的四种处置（上游是四个分开写的方法，见文件头的坐标）。 */
export type LspMessageRoute = 'notify' | 'log' | 'ask' | 'refresh'

/** LSP 里服务器可以强制要求客户端重取的那几个方法（返回类型是 void）。 */
export const LSP_REFRESH_METHODS: readonly string[] = [
  'workspace/semanticTokens/refresh',
  'workspace/codeLens/refresh',
  'workspace/inlayHint/refresh',
  'workspace/diagnostic/refresh',
  'workspace/inlineValue/refresh',
]

/**
 * 这条消息**属于**哪一类（分类，不等于「有没有人处理」—— 后者看下面的注册表）。
 * 旧宿主不带 `method` ⇒ 一律按 `notify`（就是本模块拆分之时的行为，`tests/lsp-progress.test.mjs` 钉住）。
 */
export function lspMessageRouteOf(method: unknown): LspMessageRoute {
  if (typeof method !== 'string' || !method) return 'notify'
  if (method === 'window/logMessage') return 'log'
  if (method === 'window/showMessageRequest') return 'ask'
  if (LSP_REFRESH_METHODS.includes(method)) return 'refresh'
  return 'notify'
}

/** 服务器给的选项标题（形状不对/缺省都是空表，绝不凭空造一个标题出来）。 */
export function lspActionTitles(actions: unknown): string[] {
  if (!Array.isArray(actions)) return []
  return actions
    .filter(action => action && typeof action === 'object' && typeof (action as { title?: unknown }).title === 'string')
    .map(action => (action as { title: string }).title)
}

/** LSP `MessageActionItem`：本模块只认 `title`（上游 doNotify 也只拿 title 当动作标签）。 */
export interface LspMessageActionItem {
  title: string
}

// ── 二、三个上游通知组（复用 src/notificationGroups.ts 的注册表，不另造一套名字）────────

/** `LspServerNotificationsHandlerImpl.kt:464`。 */
export const LSP_SHOW_MESSAGE_GROUP = 'LSP window/showMessage'
/** `LspServerNotificationsHandlerImpl.kt:470`。 */
export const LSP_LOG_ERRORS_GROUP = 'LSP window/logMessage: errors, warnings'
/** `LspServerNotificationsHandlerImpl.kt:476`（`$/logTrace` 与 Info/Log 级同组）。 */
export const LSP_LOG_INFO_TRACE_GROUP = 'LSP window/logMessage: info, log; $/logTrace'

/** 这个组在本仓的注册表里有没有登记（没登记 = 我们报了一个上游没有的组，属于编造）。 */
export function lspMessageGroupRegistered(groupId: string): boolean {
  return notificationGroup(groupId) !== undefined
}

/**
 * 一条服务器消息该进哪个通知组 —— 按上游的**分级**决定，不是按「弹不弹」决定：
 *   · showMessage / showMessageRequest → SHOW_MESSAGE 组（BALLOON，弹）
 *   · logMessage 的 Error/Warning      → LOG_ERRORS_WARNINGS 组（NONE，不弹气球、只进通知中心）
 *   · logMessage 的 Info/Log           → LOG_INFO_TRACE 组（NONE 且 isLogByDefault=false）
 */
export function lspMessageGroupIdOf(route: LspMessageRoute, severity: number): string {
  if (route === 'log') return severity <= 2 ? LSP_LOG_ERRORS_GROUP : LSP_LOG_INFO_TRACE_GROUP
  return LSP_SHOW_MESSAGE_GROUP
}

/**
 * 组 → 本仓的 displayId 前缀（`src/notificationGroups.ts:164-170` 那张表的前缀）。
 * `lsp:log:` 前缀已被「该语言的日志摘要」那条占用（`progressNotices.ts` 的 `lspLogNoticeOf`），
 * 所以 logMessage 弹出来的那一条要另起一个前缀，否则两条会互相顶掉 —— 前缀表在别人的文件里，
 * 本轮只能先把**意图**算出来并落进队列条目，接线见 docs/wiring-requests-2026-10-06-lspmsg.md（R1）。
 */
export function lspMessageDisplayIdOf(language: string, groupId: string): string {
  if (groupId === LSP_LOG_INFO_TRACE_GROUP) return `lsp:log:info:${language}`
  if (groupId === LSP_LOG_ERRORS_GROUP) return `lsp:log:message:${language}`
  return `lsp:message:${language}`
}

// ── 三、待决的 showMessageRequest（回选）──────────────────────────────────────────────

/** 一条服务器问出来的请求（表里存的是「还没答复」的那些；答完即从表里除名）。 */
export interface LspPendingMessageRequest {
  key: string
  language: string
  message: string
  severity: number
  /** 服务器给的那一排，原样（只保证 `title` 是字符串，其余字段不加工）。 */
  actions: LspMessageActionItem[]
  /** 已经选定的那一项；null = 还没选（答复时按协议回 null）。 */
  chosen: LspMessageActionItem | null
  /** 毫秒时间戳（收到那一刻）。 */
  since: number
}

export const lspPendingMessageRequests = reactive<Record<string, LspPendingMessageRequest>>({})

/**
 * 通知面到底能不能把这一排选项变成**可点**的按钮。本批是 false：`progressNotices.ts` 里
 * 还没有读 `lspServerMessages` 上选项的那一行（要它翻 true 见请求文档 R1）。
 * 之所以留着这个开关而不是直接写死 false：`chooseLspMessageAction` 的「点了哪一项」只有在
 * 可点的时候才有意义，判据要能同时测「点不到 ⇒ null」与「点得到 ⇒ 那一项」两支。
 */
let messageActionsClickable = false

export function setLspMessageActionsClickable(on: boolean): void {
  messageActionsClickable = on
}

export function lspMessageActionsClickable(): boolean {
  return messageActionsClickable
}

/** 一条待决请求的键：服务器带 id 就用 id（同一条请求只能答一次），否则按语言+正文归并。 */
export function lspMessageRequestKey(language: string, id: unknown, message: string): string {
  const raw = typeof id === 'number' || typeof id === 'string' ? String(id) : ''
  return raw ? `${language}#${raw}` : `${language}$${message}`
}

/**
 * 这一条现在该答给服务器什么（`MessageActionItem | null`）。
 * 上游 `:378`：客户端没法给出答案（项目已 disposed）就是 `completedFuture(null)`；
 * `:443-451`：按钮没被点，future 就没有值 ⇒ 客户端**不能**替用户编一个选择。
 * 本仓点不到动作 ⇒ 一律 null；等通知面接上按钮，选中的那一项从这里出去。
 */
export function resolveLspMessageRequestAnswer(request: LspPendingMessageRequest): LspMessageActionItem | null {
  if (!messageActionsClickable) return null
  return request.chosen
}

/**
 * 用户在通知上点了某个选项（只有选项真能点时才有这一步）。
 * 只认**服务器给过的那些标题**：认不到就返回 null，绝不凭空造一项回给用户没见过的按钮。
 */
export function chooseLspMessageAction(key: string, title: string): LspMessageActionItem | null {
  const pending = lspPendingMessageRequests[key]
  if (!pending) return null
  const item = pending.actions.find(action => action.title === title) ?? null
  if (item) pending.chosen = item
  return item
}

/** 气球被关掉（或服务器那台停了）：这条就答 null 并除名 —— 上游关掉通知也是 null。 */
export function expireLspMessageRequest(key: string): LspMessageActionItem | null {
  const pending = lspPendingMessageRequests[key]
  if (!pending) return null
  const chosen = resolveLspMessageRequestAnswer(pending)
  delete lspPendingMessageRequests[key]
  return chosen
}

/** 某台服务器停了：它在途的那些问句全部按 null 收掉（上游 `:378` 的同一答复）。返回收掉几条。 */
export function expireLspMessageRequestsForLanguage(language: string): number {
  const keys = Object.keys(lspPendingMessageRequests).filter(key => key === `${language}#` || key.startsWith(`${language}#`) || key.startsWith(`${language}$`))
  for (const key of keys) delete lspPendingMessageRequests[key]
  return keys.length
}

export function pendingLspMessageRequestCount(): number {
  return Object.keys(lspPendingMessageRequests).length
}

// ── 四、处理器注册表 + 丢弃计数 ────────────────────────────────────────────────────────

/** 宿主 `lsp.message` 事件里那条字段袋（`native/lsp_host_bootstrap.cpp` 拼的，桥不改）。 */
export interface LspServerMessageInput {
  language?: unknown
  severity?: unknown
  message?: unknown
  method?: unknown
  actions?: unknown
  /** 服务器这条**请求**的 JSON-RPC id；本批宿主还没带出来（见请求文档 R2）。 */
  id?: unknown
}

/** 整条待显示的消息（`progressNotices.ts` 的 watcher 读走 `lspServerMessages`）。 */
export interface LspServerMessage {
  language: string
  severity: number
  message: string
  /** 这条原来是 LSP 的哪一个方法（分级映射要用它，弹不弹由组决定）。 */
  method: string
  /** 上游那条通知落在哪个通知组（`LspServerNotificationsHandlerImpl.kt:464/470/476`）。 */
  group: string
  /** 本仓该用的 displayId（前缀→组的约定在 `src/notificationGroups.ts:164-170`）。 */
  displayId: string
  /**
   * 只有 `window/showMessageRequest` 那条有值：它对应 `lspPendingMessageRequests` 里的哪一个键。
   * 通知面要画那一排按钮就得拿这个键去 `chooseLspMessageAction` / `expireLspMessageRequest`
   * （接线见 docs/wiring-requests-2026-10-06-lspmsg.md 的 R1b）；别条消息是空串。
   */
  requestKey: string
}

/** 通知队列：与拆分前同一个数组，条目上多了四个分派字段（消费方按老字段读即可，新字段是给归组与回选用的）。 */
export const lspServerMessages: LspServerMessage[] = []

/** 已经整理过形状的一条消息（处理器拿到的都是这个，不会再出现 undefined）。 */
export interface LspServerMessageEnvelope extends LspServerMessage {
  actions: unknown
  id: unknown
}

export type LspServerMessageHandler = (message: LspServerMessageEnvelope) => void

const handlers = new Map<string, LspServerMessageHandler>()

/** 注册一条方法的处置；返回注销函数（判据用它做「没注册 ⇒ 落进丢弃计数」的反向验证）。 */
export function registerLspServerMessageHandler(method: string, handler: LspServerMessageHandler): () => void {
  handlers.set(method, handler)
  return () => {
    if (handlers.get(method) === handler) handlers.delete(method)
  }
}

/** 当前注册了哪些方法（状态栏/诊断面板可以据此说「这条消息有没有人接」）。 */
export function lspServerMessageHandlerMethods(): string[] {
  return [...handlers.keys()]
}

/** 丢弃计数（可观察的那一半）：总数 + 按方法各丢了几条。 */
export const lspServerMessageDrops = reactive<{ total: number; byMethod: Record<string, number> }>({ total: 0, byMethod: {} })

/** 某个方法被丢了几条；不传则给总数。 */
export function droppedLspServerMessages(method?: string): number {
  return method === undefined ? lspServerMessageDrops.total : lspServerMessageDrops.byMethod[method] ?? 0
}

export function resetLspServerMessageDrops(): void {
  lspServerMessageDrops.total = 0
  for (const method of Object.keys(lspServerMessageDrops.byMethod)) delete lspServerMessageDrops.byMethod[method]
}

/**
 * 记一次丢弃：计数总是加，但**只有该方法第一次**才往「语言服务」日志写一行
 * （一次索引能让同一个没接的方法刷几百条，日志跟着刷就没法看了）。
 */
function noteDroppedServerMessage(method: string, language: string): void {
  lspServerMessageDrops.total++
  const seen = (lspServerMessageDrops.byMethod[method] ?? 0) + 1
  lspServerMessageDrops.byMethod[method] = seen
  if (seen === 1) {
    appendLspLog({
      language, kind: 'dropped', level: 3,
      text: `${method}：前端没有登记这一条的处理器，已丢弃（本条方法累计 ${seen} 次）`,
    })
  }
}

// ── 五、四条内置处置（与上游四个方法一一对应）────────────────────────────────────────

/** showMessage / showMessageRequest：整条进通知队列（上游 `:385-390`、`:377-382` 都走 doNotify）。 */
function queueServerMessage(message: LspServerMessageEnvelope, requestKey = ''): void {
  lspServerMessages.push({
    language: message.language, severity: message.severity, message: message.message,
    method: message.method, group: message.group, displayId: message.displayId, requestKey,
  })
}

function handleShowMessage(message: LspServerMessageEnvelope): void {
  queueServerMessage(message)
}

/**
 * logMessage（上游 `:393-404`）：Error/Warning 进通知队列，Info/Log 只进「语言服务」日志。
 * 与上游的一处如实差异：上游 Info/Log 也 doNotify，只是落到 `LOG_INFO_TRACE` 那个
 * displayType=NONE、isLogByDefault=false 的组（用户看不见，除非自己打开通知中心）；
 * 本仓的通知面没有「静默组」这一档，所以那一条只写日志 —— 分档（谁可见）是一样的。
 */
function handleLogMessage(message: LspServerMessageEnvelope): void {
  if (message.severity <= 2) {
    queueServerMessage(message)
    return
  }
  logLspServerMessage({ language: message.language, severity: message.severity, message: message.message })
}

/**
 * showMessageRequest（上游 `:377-382` + `:424-456`）：消息本身照 showMessage 显示，选项写进日志，
 * 然后定答复 —— 只有**真能点**的时候才把这条留在表里等用户（上游 `doNotify` 的 future 也是
 * 「按钮被点才 complete」，`:449`）；点不到（本批的真实状态）或服务器没给选项，就当场按 null 收掉，
 * 不让一条永远没人能答的请求挂在表上。
 */
function handleShowMessageRequest(message: LspServerMessageEnvelope): void {
  const items: LspMessageActionItem[] = Array.isArray(message.actions)
    ? message.actions.filter((action): action is LspMessageActionItem =>
        Boolean(action) && typeof action === 'object' && typeof (action as { title?: unknown }).title === 'string')
    : []
  const key = lspMessageRequestKey(message.language, message.id, message.message)
  // 队列里那条带上键：通知面画按钮时要拿它去 `chooseLspMessageAction` / `expireLspMessageRequest`，
  // 没有键就只能显示问题、显示不了答案。
  queueServerMessage(message, key)
  const pending: LspPendingMessageRequest = {
    key, language: message.language, message: message.message, severity: message.severity,
    actions: items, chosen: null, since: Date.now(),
  }
  lspPendingMessageRequests[key] = pending
  const waits = messageActionsClickable && items.length > 0
  if (!waits) delete lspPendingMessageRequests[key]
  appendLspLog({
    language: message.language, kind: 'message', level: lspLogLevelOf(message.severity),
    text: `${items.length ? `选项：${items.map(item => item.title).join(' / ')}` : '选项：（服务器没给）'}`
      + ` —— 本端答复：${waits ? '待用户选择' : 'null'}`
      + (waits ? '' : items.length === 0 ? '' : '（通知面上点不到动作）'),
  })
}

/** 五条 refresh（上游 `:341-371`）：答 null 之外还要让这一族 LSP 缓存作废。 */
function handleRefresh(message: LspServerMessageEnvelope): void {
  const cleared = clearAllLspCaches()
  appendLspLog({
    language: message.language, kind: 'refresh', level: 4,
    text: `${message.method}：已作废 ${cleared} 份缓存，下一次读重新请求`,
  })
}

/** 内置那八条（showMessage / logMessage / showMessageRequest + 五条 refresh）。幂等。 */
export function registerDefaultLspServerMessageHandlers(): number {
  registerLspServerMessageHandler('window/showMessage', handleShowMessage)
  registerLspServerMessageHandler('window/logMessage', handleLogMessage)
  registerLspServerMessageHandler('window/showMessageRequest', handleShowMessageRequest)
  for (const method of LSP_REFRESH_METHODS) registerLspServerMessageHandler(method, handleRefresh)
  return handlers.size
}

registerDefaultLspServerMessageHandlers()

/**
 * 一条宿主 `lsp.message` 事件的处置。返回 `false` = 这条不属于本通道（调用方继续往下的分支），
 * 与 `handleGradleEvent` 同一个约定。
 * 带 `method` 却注册表里没人接的 ⇒ **丢弃计数**，不再冒充 showMessage 弹给用户。
 */
export function handleLspServerMessageEvent(data: LspServerMessageInput): boolean {
  const language = typeof data.language === 'string' ? data.language : ''
  const severity = typeof data.severity === 'number' ? data.severity : 3
  const text = typeof data.message === 'string' ? data.message : ''
  const method = typeof data.method === 'string' ? data.method : ''
  const route = lspMessageRouteOf(method)
  const handler = method ? handlers.get(method) : handleShowMessage
  if (!handler) {
    noteDroppedServerMessage(method, language)
    return true
  }
  // 空正文不弹空气球（refresh 例外：那一族本来就没有正文）。
  if (!text && route !== 'refresh') return true
  const groupId = lspMessageGroupIdOf(route, severity)
  handler({
    language, severity, message: text, method,
    group: groupId, displayId: lspMessageDisplayIdOf(language, groupId), requestKey: '',
    actions: data.actions, id: data.id,
  })
  return true
}

/** 服务器停了（`lsp.progressReset`）：它在途的问句按 null 收掉，返回收掉几条。 */
export function expireLspMessageRequestsOnStop(language: string): number {
  return expireLspMessageRequestsForLanguage(language)
}

/** displayId 有没有按前缀表落到预期的那个组（接线之后消息窗口那侧就是这么归组的）。 */
export function lspMessageGroupForDisplayId(displayId: string): string | undefined {
  return noticeGroupId({ displayId })
}
