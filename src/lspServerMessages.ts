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
//     - `:341-368` 五条 refresh 全部 `completedFuture(null)`，并让对应缓存作废重取
//       （`:341` semanticTokens、`:348` codeLenses、`:353` inlayHints、`:360` inlineValues、`:362` diagnostics）。
//       同文件 `:369-374` 还有**第六条** `refreshTextDocumentContent`（IntelliJ 扩展、不在 LSP 那五条里），
//       本仓没有「服务器代管虚拟文件」那条链 ⇒ 不接（理由见报告的 `[-]` 行）。
//       原写 `:341-371`，收尾时重新逐条数过（`:371` 落在第六条的体内，指不到五条的结尾）。
//       2026-10-06 codevision2 补上"重取"那一半：作废缓存只是第一步，上游紧接着就**重新问一次**
//       （`LspClientImpl.kt:247-252` refreshInlayHints 的 `scheduleRefresh(file)`、
//       `:222-233` invalidateServerResults 的 `refreshCodeLenses(project)`）⇒ 见下面「二b」那一段
//       与 `addLspRefreshListener`；本仓只有 codeLens / inlayHint 两族有非保留文件的补刷落点。
//   · 三个通知组的 id：同文件 `:464`、`:470`、`:476`。本仓的注册表已在 `src/notificationGroups.ts`
//     （那三条逐字对上），本模块只**复用**它，不再自己造一套组名或第二套通道。
//   · 客户端能力：`platform/lsp/src/api/LspClientCapabilities.kt:246-249`
//     `window { showMessage = WindowShowMessageRequestCapabilities(); showDocument; workDoneProgress = true }`。
//
// 「声明了能力却没有处理器」在这一层是可观察的：注册表里没有对应方法的处置 ⇒ 这条消息进
// `lspServerMessageDrops`（丢弃计数）并留一行「语言服务」日志，**不再**被当成 showMessage 弹出去。
// 同一层的第二道检查是队列本身：`lspServerMessages` 是 reactive 的，否则唯一消费方
// （`src/progressNotices.ts`）那个 `watch(() => length)` 永远不会醒 —— 消息堆在队列里静默消失，
// 而丢弃计数抓不到它（这一条 2026-10-06 收尾时实测并修掉，判据在
// `tests/lsp-server-messages.test.mjs` 的端到端那条）。
// 本模块只认宿主 `lsp.message` 事件里带了 `method` 的那些；不带 method 的按改动之前的行为走
// showMessage（旧宿主 / 预览通道的形状，`tests/lsp-progress.test.mjs` 钉着这条）。
//
// ── 服务器**主动发起的请求**（要客户端回包的那六条）在本仓的响应面（2026-10-06 本轮逐条 grep 定）──
// 六条的**回包**都在宿主那一头（`native/lsp.cpp` 的 `Client::receive` 服务器请求分派，判据
// `native/lsp_test.cpp` 的「服务器主动发起的六条请求逐条有回包」一族）：本模块拿不到 JSON-RPC 的 id，
// 也就无法替 native 答；这里管的是「内容看得见 + 该记的账记下来」。逐条：
//   · `client/registerCapability` —— 回包 `null`（协议的返回类型是 void）+ **转出来**：本模块登记
//     `lspDynamicRegistrations` 并按注册的方法作废那一族 LSP 缓存（上游 `:119-123` 存进
//     `LspDynamicCapabilities`（`:117`）再 `restartHighlightingIfNeeded(...)`（`:130-182`））。
//   · `client/unregisterCapability` —— 同上，从表里摘掉那一条（上游 `:125-128`）。
//   · `window/workDoneProgress/create` —— 回包 `null`（有 token 时）/ `-32602`（没有 token），
//     并转出来留一行；**不**在这里凭空造一条进度（上游 `:255` 就一行 completedFuture(null)，
//     行是之后 `$/progress` 的 begin 才建的：`:266-314`，本仓那一半在 `src/lspProgress.ts`）。
//   · `workspace/configuration` —— native 就地按 items 逐条回值（上游 `:249-253`）；不转出来：
//     这条会被服务器按每次读设置来问，转出来就是刷屏，而上游对它也只做「回值」这一件事。
//   · `workspace/applyEdit` —— native 走真实的工作区写手并回**真实**的 applied（上游 `:84-117`）；
//     用户可见那一半已经有了：写完文件宿主发 `lsp.edited` 事件，`src/progressNotices.ts` 把它变成一行日志。
//   · `workspace/workspaceFolders` —— 本轮补的**真缺陷**：客户端能力表里 `workspace.workspaceFolders`
//     是 true（`native/lsp_host_bootstrap.cpp` 的 workspace 段），而分派表里没有这一支 ⇒ 以前问到就回
//     `-32601`（"声明了能力却没有处理器"的字面形状）。现在回 initialize 时发给服务器的那一份
//     （上游 `:241-247` 回的是每个根一份 `WorkspaceFolder(uri, name)`）；不需要转出来 —— 它是数据，不是消息。
import { reactive } from 'vue'
import { createConsoleAnsiDecoder } from './consoleAnsi.ts'
import { noticeGroupId, notificationGroup } from './notificationGroups.ts'
import { appendLspLog, lspLogLevelOf, logLspServerMessage } from './lspServerLog.ts'
import { clearAllLspCaches } from './lspPerFileCache.ts'
import { clearDynamicCapabilityRules, lspRegistrationRules, setDynamicCapabilityRules } from './lspDynamicCapabilities.ts'

// ── 一、方法 → 处置类别 ──────────────────────────────────────────────────────────────

/** 服务器**主动**发来的那几条，本仓的五种处置（上游是五个分开写的方法，见文件头的坐标）。
 * `record` = 服务器**主动发起的请求**里内容要记账的那三条：回包由宿主给，这一头只登记 + 留一行日志，
 * 不弹任何东西（本仓的 UI 面没有「动态注册表」这个窗口，画它就是放假控件）。 */
export type LspMessageRoute = 'notify' | 'log' | 'ask' | 'refresh' | 'record'

/** LSP 里服务器可以强制要求客户端重取的那几个方法（返回类型是 void）。 */
export const LSP_REFRESH_METHODS: readonly string[] = [
  'workspace/semanticTokens/refresh',
  'workspace/codeLens/refresh',
  'workspace/inlayHint/refresh',
  'workspace/diagnostic/refresh',
  'workspace/inlineValue/refresh',
]

/**
 * 宿主**转出来记账**的那三条服务器请求（回包已在 `native/lsp.cpp` 给掉，转的是内容本体）。
 * 与 `native/lsp_host_bootstrap.cpp` 的 `set_server_message` 里那三个透传键一一对应：
 * 宿主只转这三条 ⇒ 本模块也只登记这三条；多登记一条就是「注册了一条没人转过来的方法」那种死出口。
 */
export const LSP_DYNAMIC_REQUEST_METHODS: readonly string[] = [
  'client/registerCapability',
  'client/unregisterCapability',
  'window/workDoneProgress/create',
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
  if (LSP_DYNAMIC_REQUEST_METHODS.includes(method)) return 'record'
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
 *   · `record`（动态注册/进度申请）      → **空串**：它不属于任何通知组，一条都不弹，只写「语言服务」日志。
 *     上游那三条没有对应的通知（`LspServerNotificationsHandlerImpl.kt:119-123`、`:125-128`、`:255`
 *     都只做记账/答应，不 doNotify）⇒ 本仓给它们编一个通知组就是比上游多画一层 UI。
 */
export function lspMessageGroupIdOf(route: LspMessageRoute, severity: number): string {
  if (route === 'record') return ''
  if (route === 'log') return severity <= 2 ? LSP_LOG_ERRORS_GROUP : LSP_LOG_INFO_TRACE_GROUP
  return LSP_SHOW_MESSAGE_GROUP
}

/**
 * 组 → 本仓的 displayId 前缀（`src/notificationGroups.ts:164-173` 那张表的前缀）。
 * `lsp:log:` 前缀已被「该语言的日志摘要」那条占用（`progressNotices.ts` 的 `lspLogNoticeOf`），
 * 所以 logMessage 弹出来的那一条要另起一个前缀，否则两条会互相顶掉。
 * （**留痕 · msgpanel 2026-10-06**：这里原先写"前缀表在别人的文件里，本轮只能先把意图算出来，
 * 接线见 wiring-requests…（R1）"。实际状态：前缀表已经在 `src/notificationGroups.ts:168-169`
 * 落了 `lsp:log:info:` 与 `lsp:log:` 两行，`src/progressNotices.ts:120` 也已改成读
 * `message.displayId` ⇒ R1 已到位，旧措辞挡的是一条已经不存在的门。）
 */
export function lspMessageDisplayIdOf(language: string, groupId: string): string {
  // `record` 那一档的组是空串（它不落任何通知组）⇒ displayId 也必须是空串：
  // 给它算一个 `lsp:message:<语言>` 就等于替一条协议记账预约了一个气球，接线那侧一读到就会弹。
  if (!groupId) return ''
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

// ── 三b、服务器动态注册上来的能力（`client/registerCapability` / `client/unregisterCapability`）─────

/** 一条动态注册（LSP 的 `Registration` / `Unregistration`：`{id, method}`；`registerOptions` 本仓不解释）。 */
export interface LspDynamicRegistration {
  /** 服务器给的那把把手（`unregisterCapability` 就按它摘）。 */
  id: string
  method: string
  /** 哪一台服务器登记的（那台停了就整台清掉，见 `expireLspDynamicRegistrationsOnStop`）。 */
  language: string
  /** 毫秒时间戳（登记那一刻）。 */
  since: number
}

/**
 * 本端登记的动态能力表，键 = 服务器给的 `id`。
 *
 * 为什么前端要留这张表（宿主那一头只校验+回包，不记账）：上游把它存在客户端实例上
 * （`platform/lsp-impl/src/impl/LspDynamicCapabilities.kt:117` 的
 * `capabilityToInfo.putValue(registration.method, CapabilityInfo(registration.id, …))`），
 * 于是「注销一条没登记过的 id」与「重注册同一个 id」这两种形状在**行为**上是有区别的
 * （`:126-130` 的 unregister 就是按 method 找到那一族再按 id 摘）。本仓的这张表就是那个区别的记录处，
 * 生产读者是同下面的注销处置器（它要先在表里找得到那一条）与登记处置器的日志行（它报"现在共几项"）。
 */
export const lspDynamicRegistrations = reactive<Record<string, LspDynamicRegistration>>({})

/**
 * 注册/注销的条目：只认 `id` 与 `method` 都是字符串的那些。
 * 形状不对的条目**不登记**（宁可少记，也不替服务器造一个它没给过的把手）；
 * 条数差由调用方写进日志，看得见。
 */
export function lspRegistrationEntries(value: unknown): { id: string; method: string }[] {
  if (!Array.isArray(value)) return []
  const entries: { id: string; method: string }[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const id = (raw as { id?: unknown }).id
    const method = (raw as { method?: unknown }).method
    if (typeof id === 'string' && typeof method === 'string') entries.push({ id, method })
  }
  return entries
}

/**
 * 动态注册里会动到本仓那一族 LSP 缓存的方法。判据来自上游 `restartHighlightingIfNeeded`
 * （`LspServerNotificationsHandlerImpl.kt:130-182`）：注册了 inlayHint / documentColor /
 * documentLink / diagnostic / documentHighlight / foldingRange / codeLens 就要让对应的结果重取，
 * 它上面的注释（`:146-148`）写得很直白 —— 「服务器换了注册，手里那份结果就是过期的」。
 * 再加 `semanticTokens` / `documentSymbol`：本仓那两个缓存（高亮快照与结构视图）吃的就是这两族
 * （`src/lspNavigation.ts` 的 `OUTLINE_REQUEST = 'documentSymbol'`）。
 * 作废动作与 `handleRefresh` 同一口径：`clearAllLspCaches()` 整批清（差异写在
 * `src/lspPerFileCache.ts:37-38`：代价只是下一次读重新请求一次，不会留下旧结果）。
 */
const LSP_CACHE_AFFECTING_REGISTRATIONS = new Set([
  'textDocument/semanticTokens',
  'textDocument/inlayHint',
  'textDocument/documentColor',
  'textDocument/diagnostic',
  'textDocument/codeLens',
  'textDocument/documentLink',
  'textDocument/documentHighlight',
  'textDocument/foldingRange',
  'textDocument/documentSymbol',
])

/**
 * 规则面（method + documentSelector）按 id 攒的那张表 —— 与上面那张 reactive 的**账**分开：
 * 账给注销/停机用（按 id 摘、按语言清），规则给文件级闸用（`src/lspPerFileCapabilities.ts`
 * 问「这条注册管不管这个文件」）。上游两者同住 `LspDynamicCapabilities` 的 `CapabilityInfo`
 * （`LspDynamicCapabilities.kt:52-57`），本仓拆开是因为账要用 `vue` 的 reactive、
 * 规则要保持零运行时依赖（`src/lspDynamicCapabilities.ts` 能被 `node --test` 直接驱动）。
 */
const lspRegistrationRuleById = new Map<string, { id: string; method: string; documentSelector?: readonly { language?: string; scheme?: string; pattern?: string }[] | null }>()

/** 把攒下来的规则整表推给规则层（每次登记/注销后调一次）。 */
function publishDynamicCapabilityRules(): void {
  setDynamicCapabilityRules([...lspRegistrationRuleById.values()])
}

/** 服务器注册了几项就登记几项，并按注册的方法作废那一族缓存；一条都不弹（`record` 那一档）。 */
function handleRegisterCapability(message: LspServerMessageEnvelope): void {
  const given = Array.isArray(message.registrations) ? message.registrations.length : 0
  const entries = lspRegistrationEntries(message.registrations)
  const rules = lspRegistrationRules(message.registrations)
  let invalidated = 0
  for (const entry of entries) {
    // 同一个 id 再来一次 = 覆盖（协议的 `id` 是这条登记的唯一把手，服务器重注册同一个 id 就是换选项）。
    lspDynamicRegistrations[entry.id] = { ...entry, language: message.language, since: Date.now() }
    if (LSP_CACHE_AFFECTING_REGISTRATIONS.has(entry.method)) invalidated = clearAllLspCaches()
  }
  // 规则面按 id 覆盖（同一条 id 重注册 = 换 documentSelector）。
  for (const rule of rules) lspRegistrationRuleById.set(rule.id, rule)
  if (rules.length) publishDynamicCapabilityRules()
  appendLspLog({
    language: message.language, kind: 'request', level: 3,
    text: `client/registerCapability：已登记 ${entries.length} 项（本端现共 ${lspDynamicRegistrationCount()} 项）`
      + (entries.length ? `：${entries.map(entry => `${entry.method}#${entry.id}`).join(' / ')}` : '：（服务器没给可登记的条目）')
      + (given > entries.length ? ` —— 另有 ${given - entries.length} 条形状不对（缺 id 或 method），没登记` : '')
      + (invalidated ? ` —— 已作废 ${invalidated} 份缓存，下一次读重取` : ''),
  })
}

/** 注销：按服务器给的那个 id 从表里摘；摘不到的那几条如实写，但回包照旧给过（native 那一头已经给了）。 */
function handleUnregisterCapability(message: LspServerMessageEnvelope): void {
  const entries = lspRegistrationEntries(message.unregisterations)
  let unknown = 0
  for (const entry of entries) {
    if (lspDynamicRegistrations[entry.id]) delete lspDynamicRegistrations[entry.id]
    else unknown++
    lspRegistrationRuleById.delete(entry.id)
  }
  if (entries.length) publishDynamicCapabilityRules()
  appendLspLog({
    language: message.language, kind: 'request', level: unknown ? 2 : 3,
    text: `client/unregisterCapability：已摘除 ${entries.length - unknown} 项（本端现共 ${lspDynamicRegistrationCount()} 项）`
      + (entries.length ? `：${entries.map(entry => `${entry.method}#${entry.id}`).join(' / ')}` : '：（服务器没给要撤的条目）')
      + (unknown ? ` —— 另有 ${unknown} 项本端没有登记过（服务器自己已经忘了的那些，也照样回了包，没有挂着）` : ''),
  })
}

/**
 * `window/workDoneProgress/create`：回包（同意 / InvalidParams）在 `native/lsp.cpp` 那一头，
 * 这一行只把「谁在什么时候申请了哪个 token」记进「语言服务」日志。
 * **不在这里造进度行**：上游 `LspServerNotificationsHandlerImpl.kt:255` 就是一行 completedFuture(null)，
 * 行是之后 `$/progress` 的 begin 才建的（`:266-314`，本仓那一半在 `src/lspProgress.ts`）。
 * 没 token 的那一条按警告记 —— 它意味着服务器要报的那条进度永远不会有下文。
 */
function handleWorkDoneProgressCreate(message: LspServerMessageEnvelope): void {
  const token = typeof message.token === 'string' || typeof message.token === 'number' ? String(message.token) : ''
  appendLspLog({
    language: message.language, kind: 'request', level: token ? 4 : 2,
    text: token
      ? `window/workDoneProgress/create：已同意（token=${token}）—— 进度行要等 $/progress 的 begin，这里不凭空造一条`
      : 'window/workDoneProgress/create：参数里没有 token ⇒ 本端按 InvalidParams 拒绝（服务器要报的那条进度不会有下文）',
  })
}

/** 某台服务器停了：它登记的动态能力全部作废（上游那张表是挂在客户端实例上的，客户端没了表就没了）。 */
export function expireLspDynamicRegistrationsOnStop(language: string): number {
  const ids = Object.keys(lspDynamicRegistrations)
    .filter(id => lspDynamicRegistrations[id].language === language)
  for (const id of ids) { delete lspDynamicRegistrations[id]; lspRegistrationRuleById.delete(id) }
  if (ids.length) publishDynamicCapabilityRules()
  return ids.length
}

/** 现在登记着几项（可选按语言过滤）；判据与接线方读的是同一份事实。 */
export function lspDynamicRegistrationCount(language?: string): number {
  return Object.keys(lspDynamicRegistrations)
    .filter(id => language === undefined || lspDynamicRegistrations[id].language === language).length
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
  /** `client/registerCapability` 带出来的那一批（宿主原样透传，不做形状加工）。 */
  registrations?: unknown
  /** `client/unregisterCapability` 带出来的那一批。 */
  unregisterations?: unknown
  /** `window/workDoneProgress/create` 要的那个 token（协议里是 string | number 的联合类型）。 */
  token?: unknown
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

/**
 * 通知队列：与拆分前同一个数组，条目上多了四个分派字段（消费方按老字段读即可，新字段是给归组与回选用的）。
 *
 * **必须是 reactive 的数组**：唯一的消费方（`src/progressNotices.ts` 的 `wireLspProgressNotices`）用的是
 * `watch(() => lspServerMessages.length, …)`。Vue 的 `watch` 只跟踪**响应式**依赖，普通数组的 `push`
 * 不登记任何依赖 ⇒ 那个 watcher 一次也不会醒：消息照旧进队列，通知面一行都不显示，连 watcher 循环体里
 * 那句 `logLspServerMessage(message)` 也不会执行 —— Error/Warning 级的 showMessage/logMessage 于是
 * 既没有气球也没有日志行。这是「声明了 capability 却没处理器」的**第二种**形状：处理器在、通道是死的，
 * 而且丢弃发生在队列这一头，`lspServerMessageDrops` 抓不到它（那条只抓「方法没人接」）。
 * 判据：`tests/lsp-server-messages.test.mjs` 的端到端那条（真跑 watcher，量到 `notifyProgress` 被叫几次）。
 */
export const lspServerMessages = reactive<LspServerMessage[]>([])

/** 已经整理过形状的一条消息（处理器拿到的都是这个，不会再出现 undefined）。 */
export interface LspServerMessageEnvelope extends LspServerMessage {
  actions: unknown
  id: unknown
  /** 三条 `record` 那族的参数本体（宿主原样透传，形状由各自处置器自己判）。 */
  registrations: unknown
  unregisterations: unknown
  token: unknown
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

/** `AnsiStreamingLexer.java:15` 的 `ESCAPE = '\u001b'`（`src/consoleAnsi.ts` 里那台词法器有同一个常量，但没导出）。 */
const ANSI_ESCAPE = String.fromCharCode(0x1b)

/**
 * 服务器消息正文里那些 ANSI 转义，**给用户看的那一份必须剥掉**。
 * 上游两条出口都这么做（逐行开参考树核过）：
 *   · 通知那一半：`platform/lsp-impl/src/impl/LspServerNotificationsHandlerImpl.kt:432-436`
 *     —— `doNotify`（`:424`）里 `ansiDecoder.escapeText(message, ProcessOutputTypes.STDOUT) { text, _ -> cleanedMessage += text }`，
 *     `:438` 用 cleanedMessage 拼正文、`:441` 才 `createNotification(...)`；那台解码器是同文件 `:75` 的字段。
 *   · 语言服务输出那一半：`platform/lsp-impl/src/impl/serviceView/LspClientConsole.kt:82-97`
 *     —— `print(..., decodeAnsi = true)`（默认就是解），同一台 `AnsiEscapeDecoder`（`:40`）解完再 `console.print(line, contentType)`。
 * 本仓这两条出口读的是**同一个** `envelope.message`（`src/progressNotices.ts` 的通知行 +
 * `src/lspServerLog.ts` 的日志行），所以在**入口那一处**剥一次，净效果与上游两处各解一遍相同；
 * 只有 `lspClient.logInfo(...)`（上游写进 IDE 日志文件、不进界面）那一处上游保留原文，本仓没有那条通道。
 * 解码器**复用** `src/consoleAnsi.ts`（上游 `AnsiEscapeDecoder` 一族的既有移植，这里不再写第二台词法器）：
 * SGR 只改状态、CONTROL 被忽略、而 **OSC 上游根本不当它是转义序列**
 * （`AnsiStreamingLexer.java:15` 的 ESCAPE 与 `:132` 的 `SGR_SUFFIX`；default 分支返回 false 的那段见
 * `src/consoleAnsi.ts` 文件头对同一处的留痕）⇒ 这里也原样留着，不"顺手多清一层"。
 * 按行喂的理由：`\n` 不是 CSI 的终结字节（终结字节是 0x40-0x7E，见 `src/consoleAnsi.ts` 对
 * `AnsiStreamingLexer.java:112-142` 的记录），所以按行切不会把一个序列劈成两段；
 * 状态跨行延续与上游"一条消息一台机器、按块喂"一致。
 */
export function lspMessageVisibleText(raw: string): string {
  if (raw.indexOf(ANSI_ESCAPE) === -1) return raw
  const decoder = createConsoleAnsiDecoder()
  return raw.split('\n').map(line => decoder.line(line).text).join('\n')
}

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
 *
 * 分级为什么是现在这个样子（2026-10-06 msgpanel 逐行重数参考树后的**订正**，原文见下面的留痕）：
 *   · Error/Warning ⇒ 上游落 `LOG_ERRORS_WARNINGS_NOTIFICATION_GROUP`（同文件 `:470`，
 *     它上面 `:467-469` 的注释原文 "Default behavior: no balloon, only write to the Notifications tool window"）。
 *     本仓同档：队列条目带出的 displayId 是 `lsp:log:message:<语言>`，按
 *     `src/notificationGroups.ts:169` 的前缀表归进那个组，而该组 displayType=NONE
 *     ⇒ `src/notifications.ts:78` 的 `showsBalloon(NONE)` 为 false ⇒ **不占气球、只进通知中心**，与上游一致。
 *   · Info/Log ⇒ 上游 `:401-403` 也 doNotify，但落的是 `:476` 那个组：displayType=NONE
 *     **且 `isLogByDefault=false`**（注释原文 "Default behavior: no notification. For development purposes,
 *     plugin developers may enable printing to the Notifications tool window"，`:473-475`）
 *     ⇒ 默认既没有气球、通知中心里也没有，只有设置里把那一组打开才看得见。
 *     本仓没有"按通知组开关通知中心"的那一层（注册表里那个 `isLogByDefault` 目前**零消费者**，
 *     已单列成接线请求），所以等价做法就是只写「语言服务」日志 —— 谁看得见这一档仍与上游相同。
 *
 * 留痕（原写 Y、实际 Z）：这一段此前声明「`src/progressNotices.ts` 把 displayId 写死成
 * `lsp:message:<语言>` ⇒ Error/Warning 级的 logMessage 会多弹一个气球，接线见 …lspmsg.md 的 R1a」。
 * 现在打开 `src/progressNotices.ts:120` 看到的是 `displayId: message.displayId || lsp:message:<语言>`，
 * 前缀表两行也在 `src/notificationGroups.ts:168-169` —— R1a 已落地，那条"还没到位"已经不成立了；
 * 同一文件里"本仓的通知面没有「静默组」这一档"那句也跟着改掉（NONE 组由 `showsBalloon` 兑现）。
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

/** 五条 refresh（上游 `:341-368`）：答 null 之外还要让这一族 LSP 缓存作废，并**踢渲染通道补刷一拍**。 */
function handleRefresh(message: LspServerMessageEnvelope): void {
  const cleared = clearAllLspCaches()
  const kicked = notifyLspRefreshListeners(message)
  appendLspLog({
    language: message.language, kind: 'refresh', level: 4,
    text: `${message.method}：已作废 ${cleared} 份缓存，下一次读重新请求`
      + `；本轮直接补刷 ${kicked} 处渲染通道`,
  })
}

// ── 二b、refresh 之后**渲染侧**的那一拍（2026-10-06 codevision2）────────────────
// 上游对一句 `workspace/…/refresh` 做的是**两件事**，不是一件：
//   · 作废缓存 —— 本仓早就有（上面的 `clearAllLspCaches()`）；
//   · **立刻重新问一次** —— `LspClientImpl.kt:247-252` 的 `refreshInlayHints()` 在 `invalidate(file)`
//     之后紧跟 `LspInlayApplier…scheduleRefresh(file)`，`:222-233` 的 `invalidateServerResults()` 在
//     清完缓存之后 `LspFeaturesRefreshing.refreshCodeLenses(project)`（`:31-38` →
//     `CodeVisionHost.invalidateProvider(LensInvalidateSignal(null, listOf(LSP_CODE_VISION_PROVIDER_ID)))`）。
// 只做第一件的效果是具体的：编辑器里已经画出来的那些行上方提示 / 内联提示**一直停在旧值**，
// 直到用户敲下一个字或切一次焦点才更新 —— 而服务器发这一句的意思恰恰是"你手里那份过期了，现在就重取"。
// 所以这里开一个**监听表**给渲染通道自登记（每个编辑器一个控制器，`dispose()` 里注销）：
// 只有真会"当场重画"的能力才登记（codeLens / inlayHint 两个在本仓有非保留文件的落点）；
// 语义着色、pull 诊断、内联调试值那三族的重新拉取由保留文件 `src/components/CodeEditor.vue` 的调度器发起，
// 本模块不替它们吹牛说"补刷了"—— 那三族仍然只走 `clearAllLspCaches()` 那一步。
export type LspRefreshListener = (message: LspServerMessageEnvelope) => void

const refreshListeners = new Map<string, Set<LspRefreshListener>>()

/**
 * 给某一条 refresh 方法挂一个渲染侧的补刷回调，返回注销函数。
 * 与 `registerLspServerMessageHandler` 的区别：那条是**每方法一个处置**（会互相覆盖），
 * 这一条是**每方法一组回调**（N 个编辑器各踢自己那一拍）。
 */
export function addLspRefreshListener(method: string, listener: LspRefreshListener): () => void {
  let set = refreshListeners.get(method)
  if (!set) { set = new Set(); refreshListeners.set(method, set) }
  set.add(listener)
  return () => {
    const current = refreshListeners.get(method)
    if (!current) return
    current.delete(listener)
    if (!current.size) refreshListeners.delete(method)
  }
}

/** 这一条方法现在挂了几处补刷（判据用；也是"有没有人接"的可观察口）。 */
export function lspRefreshListenerCount(method: string): number {
  return refreshListeners.get(method)?.size ?? 0
}

/** 逐个通知；一处抛错不能把其余编辑器一起吞掉（上游每个 applier 各自 schedule，同理）。 */
function notifyLspRefreshListeners(message: LspServerMessageEnvelope): number {
  const set = refreshListeners.get(message.method)
  if (!set?.size) return 0
  let notified = 0
  for (const listener of [...set]) {
    try { listener(message); notified++ } catch { /* 一处坏掉不牵连其余 */ }
  }
  return notified
}

/**
 * 内置那十一条：三条消息（showMessage / logMessage / showMessageRequest）+ 五条 refresh
 * + 三条**服务器主动发起的请求**（`client/registerCapability` / `client/unregisterCapability` /
 * `window/workDoneProgress/create`，见上面「三b」那一段）。幂等。
 * 后三条只登记**宿主真转发出来的**那些方法 —— 六条服务器请求里另外三条
 * （`workspace/configuration`、`workspace/applyEdit`、`workspace/workspaceFolders`）的回包与内容
 * 都留在 `native/lsp.cpp` 那一头，前端接一条没人转的处置就是造只过自己测试的死出口。
 */
export function registerDefaultLspServerMessageHandlers(): number {
  registerLspServerMessageHandler('window/showMessage', handleShowMessage)
  registerLspServerMessageHandler('window/logMessage', handleLogMessage)
  registerLspServerMessageHandler('window/showMessageRequest', handleShowMessageRequest)
  for (const method of LSP_REFRESH_METHODS) registerLspServerMessageHandler(method, handleRefresh)
  registerLspServerMessageHandler('client/registerCapability', handleRegisterCapability)
  registerLspServerMessageHandler('client/unregisterCapability', handleUnregisterCapability)
  registerLspServerMessageHandler('window/workDoneProgress/create', handleWorkDoneProgressCreate)
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
  // 正文在**进入任何用户可见出口之前**剥掉 ANSI（等价上游 `doNotify` 的 `:432-436` 与
  // `LspClientConsole.kt:82-97` 那两处；理由与边界见上面 `lspMessageVisibleText`）。
  const text = typeof data.message === 'string' ? lspMessageVisibleText(data.message) : ''
  const method = typeof data.method === 'string' ? data.method : ''
  const route = lspMessageRouteOf(method)
  const handler = method ? handlers.get(method) : handleShowMessage
  if (!handler) {
    noteDroppedServerMessage(method, language)
    return true
  }
  // 空正文不弹空气球（refresh 与 record 例外：refresh 那一族本来就没有正文，
  // record 那三条的参数是 registrations / unregisterations / token，正文由处置器自己拼）。
  if (!text && route !== 'refresh' && route !== 'record') return true
  const groupId = lspMessageGroupIdOf(route, severity)
  handler({
    language, severity, message: text, method,
    group: groupId, displayId: lspMessageDisplayIdOf(language, groupId), requestKey: '',
    actions: data.actions, id: data.id,
    registrations: data.registrations, unregisterations: data.unregisterations, token: data.token,
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
