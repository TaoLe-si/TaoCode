// 语言服务**输出窗口**的呈现模型 —— 上游 `platform/lsp-impl/src/impl/serviceView/` 那一族的纯逻辑等价物。
//
// 三件事（都与这个窗口同族，上游也写在同一批文件里）：
//   ① 控制台那一行长什么样：`LspClientConsole.kt` 的五个打印出口、标签列宽、内容类型、生命周期文案、
//      客户端身份（`LspServiceViewSupport.kt` / `LspClientServiceViewDescriptor.kt`）；
//   ② 一个文件命中**多个** LSP 客户端时各特性怎么合并结果（`LspClientManagerImpl.kt` 的两个
//      getClients* 与每个特性的调用点）；
//   ③ 补全路径上的 `completionItem/resolve` 缓存（`LspCompletionObject.kt`）。
//
// 与 `src/lspServerLog.ts` 的分工（**复用，不重造**）：那个模块是环形日志（按语言分组、级别/类别过滤、
// 尾部、导出），落点是「消息」窗口；本模块只管"控制台那一行的形状"与上面两张规则表。
// 上游坐标一律「相对路径:行号」，全部开参考树逐行核过。
//
// 未接生产消费方（本批授权面：只准新建这两个文件）：独立输出窗口要改禁改的 `src/App.vue`
// 工具窗口装配，`src/lspCompletion.ts` 的 resolve 要换成这里那份缓存 —— 两处都在回复里写成接线请求。
// 在此之前本文件由 `tests/lsp-output-model.test.mjs` 驱动，当库代码看。
//
// 零运行时依赖（不 import vue、不碰 DOM），`node --test` 可直接驱动。

// ── 一、五个打印出口（上游 `LspClientConsole.kt`）────────────────────────────────────────
//
// `LspClientConsole.kt` 只有五个写出口，每个带自己的标签与内容类型（`ConsoleViewContentType` 那一档）：
//   · `:47-48` printLogMessage(type, message)      —— `window/logMessage`
//   · `:50-51` printShowMessage(type, message)     —— `window/showMessage`（正文前缀 `window/showMessage: `）
//   · `:53-54` printTrace(message)                 —— `$/logTrace`（标签固定 `TRACE`）
//   · `:56-57` printLifecycle(message, error)      —— 会话生命周期（**没有标签**）
//   · `:59-79` printTraffic(outbound, message, json) —— 每一条 JSON-RPC（标签 `OUT`/`IN`）
//
// 调用点（谁写进这个控制台）：
//   · `LspServerNotificationsHandlerImpl.kt:381` showMessageRequest → printShowMessage
//   · `:389` showMessage → printShowMessage；`:397` logMessage → printLogMessage；`:412` logTrace → printTrace
//   · `LspServiceViewSupport.kt:49` clientAdded → printLifecycle(starting)
//     `:62` Running → printLifecycle(initialized)、`:65` ShutdownNormally → printLifecycle(stopped)、
//     `:67` ShutdownUnexpectedly → printLifecycle(terminated, error = true)
//   · `Lsp4jServerConnector.kt:201` serialize → printTraffic(outbound = true)、
//     `:211` parseMessage → printTraffic(outbound = false)

/** 控制台一行的类别 = 上游那五个打印出口。 */
export type LspConsoleCategory = 'logMessage' | 'showMessage' | 'trace' | 'lifecycle' | 'traffic'

/** 上游 `MessageType`（lsp4j）：1 错误 / 2 警告 / 3 信息 / 4 日志 / 5 调试。 */
export type LspMessageType = 1 | 2 | 3 | 4 | 5

/**
 * LSP 服务器消息方法 → 控制台类别。只有上游真写进控制台的那几个方法有类别；
 * `workspace/…/refresh`、`client/registerCapability` 这类**不打印**（`LspServerNotificationsHandlerImpl.kt`
 * 里它们只改缓存/记账，没有 printXxx 调用）⇒ 归 `lifecycle`（生命周期那一族里也没有标签）。
 */
export function lspConsoleCategoryOfMethod(method: string | undefined): LspConsoleCategory {
  if (method === 'window/logMessage') return 'logMessage'
  if (method === 'window/showMessage' || method === 'window/showMessageRequest') return 'showMessage'
  if (method === '$/logTrace') return 'trace'
  return 'lifecycle'
}

// ── 二、标签与内容类型 ──────────────────────────────────────────────────────────────────

/** 标签列宽：`LspClientConsole.kt:72`/`:92` 的 `tag.padEnd(5)`。 */
export const LSP_CONSOLE_TAG_WIDTH = 5

/**
 * `MessageType.levelTag()`（`LspClientConsole.kt:144-150`）：Error→`ERROR`、Warning→`WARN`、
 * Info→`INFO`、Log→`LOG`、Debug→`DEBUG`。认不出的值不凭空造一档（返回空串 = 没有标签列）。
 */
export function lspConsoleLevelTag(type: number | undefined): string {
  if (type === 1) return 'ERROR'
  if (type === 2) return 'WARN'
  if (type === 3) return 'INFO'
  if (type === 4) return 'LOG'
  if (type === 5) return 'DEBUG'
  return ''
}

/**
 * 一行的标签（`print` 的第一个实参）。逐条照抄上游五个出口：
 *   · logMessage / showMessage → `type.levelTag()`（`:48`、`:51`）
 *   · trace → 字面量 `TRACE`（`:54`）
 *   · lifecycle → `null`（`:57` 第一个实参就是 null ⇒ 整行没有标签列）
 *   · traffic → `OUT` / `IN`（`:69` 的 `if (outbound) "OUT" else "IN"`）
 */
export function lspConsoleTag(category: LspConsoleCategory, options: { type?: number; outbound?: boolean } = {}): string {
  if (category === 'trace') return 'TRACE'
  if (category === 'lifecycle') return ''
  if (category === 'traffic') return options.outbound ? 'OUT' : 'IN'
  return lspConsoleLevelTag(options.type)
}

/** 上游 `ConsoleViewContentType` 里这个控制台用得上的那六档（`ConsoleViewContentType.java:42-50`）。 */
export type LspConsoleContentType =
  | 'LOG_ERROR_OUTPUT' | 'LOG_WARNING_OUTPUT' | 'LOG_INFO_OUTPUT'
  | 'LOG_DEBUG_OUTPUT' | 'LOG_VERBOSE_OUTPUT' | 'SYSTEM_OUTPUT'

/**
 * 一行的内容类型（颜色档）。逐条照抄：
 *   · `MessageType.contentType()`（`LspClientConsole.kt:152-157`）：Error→ERROR、Warning→WARNING、
 *     Info→INFO、Log/Debug→DEBUG（`:156` 这两档**同色**）
 *   · trace → `LOG_VERBOSE_OUTPUT`（`:54`）
 *   · lifecycle → 出错时 `LOG_ERROR_OUTPUT`，否则 `SYSTEM_OUTPUT`（`:57`）
 *   · traffic → 出站 `LOG_DEBUG_OUTPUT`、入站 `LOG_VERBOSE_OUTPUT`（`:68`）
 * 认不出的 MessageType 按 Info 档（`:155`），不升级成错误色。
 */
export function lspConsoleContentType(
  category: LspConsoleCategory,
  options: { type?: number; outbound?: boolean; error?: boolean } = {},
): LspConsoleContentType {
  if (category === 'trace') return 'LOG_VERBOSE_OUTPUT'
  if (category === 'lifecycle') return options.error ? 'LOG_ERROR_OUTPUT' : 'SYSTEM_OUTPUT'
  if (category === 'traffic') return options.outbound ? 'LOG_DEBUG_OUTPUT' : 'LOG_VERBOSE_OUTPUT'
  if (options.type === 1) return 'LOG_ERROR_OUTPUT'
  if (options.type === 2) return 'LOG_WARNING_OUTPUT'
  if (options.type === 4 || options.type === 5) return 'LOG_DEBUG_OUTPUT'
  return 'LOG_INFO_OUTPUT'
}

// ── 三、一行的文本形状 ──────────────────────────────────────────────────────────────────

/** `LspClientConsole.kt:30` 的 `DateTimeFormatter.ofPattern("HH:mm:ss")`。 */
export function formatLspConsoleTime(at: number): string {
  const time = new Date(at)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`
}

/**
 * `print` 拼行的那一段（`LspClientConsole.kt:90-95`）：
 * `时间戳 + ' ' + (标签 ? 标签.padEnd(5) + ' ' : '') + 正文.trimEnd()`。
 * 标签为空（生命周期那一档）时**整列都不在**（`:92` 的 `if (tag != null)`）—— 不是补空格。
 */
export function formatLspConsoleLine(input: { at: number; tag?: string; message: string }): string {
  const tag = input.tag ?? ''
  const head = tag ? `${tag.padEnd(LSP_CONSOLE_TAG_WIDTH)} ` : ''
  return `${formatLspConsoleTime(input.at)} ${head}${input.message.trimEnd()}`
}

/** showMessage 的正文前缀（`LspClientConsole.kt:51` 的 `"window/showMessage: $message"`）。 */
export function lspShowMessageText(message: string): string {
  return `window/showMessage: ${message}`
}

/** 一条控制台行（本模块的呈现单元；`contentType` 由颜色档那一层用）。 */
export interface LspConsoleEntry {
  /** 毫秒时间戳。 */
  at: number
  /** 哪一台服务器（本仓一种语言一台；见 `lspConsoleClientId` 那一节）。 */
  language: string
  category: LspConsoleCategory
  /** `''` = 这一档没有标签列。 */
  tag: string
  contentType: LspConsoleContentType
  /** 已经整形好的正文（showMessage 那一档已带前缀）。 */
  text: string
}

/**
 * 一条服务器消息 → 一行控制台条目。分类用 `lspConsoleCategoryOfMethod`，
 * 标签/内容类型用上面那两张表；showMessage 那一档按上游补前缀（`:51`）。
 * 没给 `method` 的按 `lifecycle`（那是"不是服务器消息"的那一档，与上游一致）。
 */
export function lspConsoleEntryOf(input: {
  at: number
  language: string
  method?: string
  type?: number
  message: string
}): LspConsoleEntry {
  const category = lspConsoleCategoryOfMethod(input.method)
  return {
    at: input.at,
    language: input.language,
    category,
    tag: lspConsoleTag(category, { type: input.type }),
    contentType: lspConsoleContentType(category, { type: input.type }),
    text: category === 'showMessage' ? lspShowMessageText(input.message) : input.message,
  }
}

// ── 四、流量行（`printTraffic`）────────────────────────────────────────────────────────
//
// 本仓**没有**这一档的数据源（宿主不逐条转发 JSON-RPC，`src/bridge.ts` 本批冻结）⇒ 这里只有
// "行该怎么拼"的纯函数，没有生产写入方；不放假控件、也不假造流量。
// 上游事实（`LspClientConsole.kt:59-79`）：头部按消息类型四分支（`:61-66`）、出站/入站决定标签与
// 箭头（`:69-70`）、正文预览截断（`:67` 调 `trafficPayloadPreview`，`:135-142` 实现）。

/** `LspClientConsole.kt:31`。 */
export const MAX_TRAFFIC_PAYLOAD_LENGTH = 10_000
/** `LspClientConsole.kt:32`（存给弹窗的那一份，比预览宽十倍）。 */
export const MAX_STORED_PAYLOAD_LENGTH = 100_000

/** 流量头部四分支（`LspClientConsole.kt:61-66`）。`id` 缺失时按上游的插值原样给空。 */
export function lspTrafficHeader(message: {
  kind: 'request' | 'response' | 'notification' | 'other'
  method?: string
  id?: string | number
}): string {
  if (message.kind === 'request') return `request '${message.method ?? ''}' (id=${message.id ?? ''})`
  if (message.kind === 'response') return `response (id=${message.id ?? ''})`
  if (message.kind === 'notification') return `notification '${message.method ?? ''}'`
  return 'message'
}

/** 出站 `→` / 入站 `←`（`LspClientConsole.kt:70`）—— 弹窗标题用（`LspTrafficPayloadPopup.kt:74` 的 `"$arrow $header"`）。 */
export function lspTrafficArrow(outbound: boolean): string {
  return outbound ? '→' : '←'
}

/**
 * `StringUtil.collapseWhiteSpace`（`platform/util/src/com/intellij/openapi/util/text/StringUtil.java:2749`）
 * 的等价物：把非空白字符之间的空白（含换行）压成一个空格，并去掉首尾空白。
 * 上游先 `convertLineSeparators`（`StringUtil.java:2910`，把 `\r\n`/`\r` 归一成 `\n`）再压 ——
 * 因为 `collapseWhiteSpace` 不把 `\r` 当空白（`LspClientConsole.kt:136` 的注释原文）。
 * 空白类按 Java `Character.isWhitespace` 的口径（不含 `\u00a0`，那个是 `isSpaceChar`）。
 */
export function collapseWhiteSpace(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n')
  const isSpace = (ch: string) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\f' || ch === '\u000b'
  let out = ''
  let pendingSpace = false
  for (const ch of normalized) {
    if (isSpace(ch)) { pendingSpace = out !== ''; continue }
    if (pendingSpace) { out += ' '; pendingSpace = false }
    out += ch
  }
  return out
}

/**
 * 一行流量的正文预览（`LspClientConsole.kt:135-142`）：压成单行，超过
 * `MAX_TRAFFIC_PAYLOAD_LENGTH` 就截断并附 `… (N more characters)`（`:139`）。
 */
export function lspTrafficPayloadPreview(json: string): string {
  const singleLine = collapseWhiteSpace(json)
  if (singleLine.length <= MAX_TRAFFIC_PAYLOAD_LENGTH) return singleLine
  return `${singleLine.slice(0, MAX_TRAFFIC_PAYLOAD_LENGTH)}… (${singleLine.length - MAX_TRAFFIC_PAYLOAD_LENGTH} more characters)`
}

/** 存给弹窗的那一份（`LspClientConsole.kt:75-76`：`json.take(MAX_STORED_PAYLOAD_LENGTH)` + truncated 标记）。 */
export function lspTrafficStoredPayload(json: string): { json: string; truncated: boolean } {
  return { json: json.slice(0, MAX_STORED_PAYLOAD_LENGTH), truncated: json.length > MAX_STORED_PAYLOAD_LENGTH }
}

/** 弹窗里被截断时的尾行（`LspBundle.properties:22` `services.lsp.traffic.popup.payload.truncated=[payload truncated]`）。 */
export const TRAFFIC_PAYLOAD_TRUNCATED = '[payload truncated]'

// ── 五、生命周期行（`LspServiceViewSupport.kt` + `LspBundle.properties`）─────────────────
//
// 文案逐条取上游（`platform/lsp/resources/messages/LspBundle.properties`）：
//   · `:18` services.lsp.console.server.starting=Starting {0}…
//   · `:19` services.lsp.console.server.initialized=Server initialized: {0}
//   · `:20` services.lsp.console.server.stopped=Server stopped
//   · `:21` services.lsp.console.server.terminated=Server terminated unexpectedly
// 触发时点（`LspServiceViewSupport.kt`）：`:47-52` clientAdded、`:54-72` serverStateChanged 的四分支。

/** `LspBundle.properties:18`。 */
export function lspLifecycleStarting(presentableName: string): string {
  return `Starting ${presentableName}…`
}

/**
 * `LspBundle.properties:19`。`{0}` 是 `nameAndVersion` ——
 * `LspServiceViewSupport.kt:60-61` 的 `listOfNotNull(serverInfo?.name ?: presentableName, serverInfo?.version).joinToString(" ")`。
 */
export function lspLifecycleNameAndVersion(serverInfo: { name?: string; version?: string } | undefined, presentableName: string): string {
  const name = serverInfo?.name || presentableName
  return serverInfo?.version ? `${name} ${serverInfo.version}` : name
}

/** `LspBundle.properties:19`。 */
export function lspLifecycleInitialized(nameAndVersion: string): string {
  return `Server initialized: ${nameAndVersion}`
}

/** `LspBundle.properties:20`（`LspServiceViewSupport.kt:65`）。 */
export const LIFECYCLE_STOPPED = 'Server stopped'
/** `LspBundle.properties:21`（`LspServiceViewSupport.kt:67`，`error = true` ⇒ `LOG_ERROR_OUTPUT`）。 */
export const LIFECYCLE_TERMINATED = 'Server terminated unexpectedly'

/** 本仓的会话状态（`src/lsSessionState.ts` 的三态 + `unconfigured`）。 */
export type LspLifecycleState = 'unconfigured' | 'initializing' | 'running' | 'shutdownUnexpectedly'

/**
 * 状态变化 → 生命周期行（`LspServiceViewSupport.kt:56-68` 的四分支）。
 * 上游 `Initializing` 那一档**什么都不打**（`:57` 空分支）—— 起服务器那一行已经由
 * `clientAdded` 打过（`:49`），再打一遍就是同一件事两行。
 * 上游的 `ShutdownNormally`（`:64-65`）在本仓不存在（`src/lsSessionState.ts` 头注第 1 条），
 * 两种停机都落 `shutdownUnexpectedly`，所以本仓只出「异常终止」这一句。
 */
export function lspLifecycleLineFor(
  state: LspLifecycleState,
  facts: { presentableName: string; serverInfo?: { name?: string; version?: string } },
): { text: string; error: boolean } | null {
  if (state === 'initializing') return null
  if (state === 'running') return { text: lspLifecycleInitialized(lspLifecycleNameAndVersion(facts.serverInfo, facts.presentableName)), error: false }
  if (state === 'shutdownUnexpectedly') return { text: LIFECYCLE_TERMINATED, error: true }
  // `unconfigured` = 本仓多出来的一格（没有客户端对象）：上游那一格连控制台都不存在 ⇒ 不打行。
  return null
}

// ── 六、客户端身份与分组 ───────────────────────────────────────────────────────────────
//
// 上游**每台客户端一个控制台**（`LspServiceViewSupport.kt:42` 的 `ConcurrentHashMap<LspClient, LspClientConsole>`
// + `:91-108` getOrCreateConsole），Services 树里那一行的 id 由 `LspClientServiceViewDescriptor.kt:32-35` 算：
// `providerClass.name + "/" + descriptor.presentableName + "/" + roots.joinToString(",") { it.path }`。
// 根节点文案 `LspBundle.properties:13` `services.lsp.root.node=Language Servers (LSP)`
// （挂载点 `LspServiceViewContributor.kt:24`）。
//
// 控制台的生命周期（`:22-28` 的类注释）：**异常停机后仍在**（那一行继续显示 `terminated`），
// 只有显式停止/重启或关工程才 dispose（`:74-78` clientRemoved）。

/** `LspServiceViewContributor.kt:24` + `LspBundle.properties:13`。 */
export const LSP_SERVICES_ROOT_NODE = 'Language Servers (LSP)'

/**
 * 客户端身份（`LspClientServiceViewDescriptor.kt:32-35`）。
 * 本仓一种语言一台服务器，所以调用方给的是那一台的事实；`roots` 为空时尾部仍是空的第三段
 * （上游对工程内客户端 roots 一定非空，本仓的空表表示工作区根）。
 */
export function lspConsoleClientId(client: { providerClass: string; presentableName: string; roots?: readonly string[] }): string {
  return `${client.providerClass}/${client.presentableName}/${(client.roots ?? []).join(',')}`
}

/** Services 树里那一行的详情后缀（`LspClientServiceViewDescriptor.kt:78-82`）：多客户端且单根时给 `…/子目录`。 */
export function lspConsoleRootPostfix(roots: readonly string[], siblingCount: number): string {
  if (siblingCount >= 2 && roots.length === 1) return `…/${roots[0]}`
  return ''
}

/** 控制台列表（上游 `LspServiceViewContributor.kt:16-17` 的 `getAllClients`）：一台一个，按身份去重。 */
export function lspConsoleGrouping(clients: readonly { providerClass: string; presentableName: string; roots?: readonly string[]; language: string }[]): { id: string; language: string; title: string }[] {
  const seen = new Map<string, { id: string; language: string; title: string }>()
  for (const client of clients) {
    const id = lspConsoleClientId(client)
    if (!seen.has(id)) seen.set(id, { id, language: client.language, title: client.presentableName })
  }
  return [...seen.values()]
}

// ── 七、多客户端结果合并（上游 `LspClientManagerImpl` + 每个特性的调用点）─────────────────
//
// 一个文件命中多个客户端时，**合并规则不是一条**，而是每个特性自己选的。上游 30 余处调用点归纳出四种：
//   · `first`      —— `firstOrNull { 认领 }`：只问第一台，**不合并**（结构视图/面包屑/重命名/on-type 格式化）
//   · `concat`     —— `flatMap { … }`：逐台结果**首尾相接，不去重**（折叠/inlayHint/codeLens/高亮三族/补全）
//   · `collect`    —— `mapNotNull { … }`：逐台都收（hover 文档目标/隐式引用）
//   · `earlyStop`  —— `for` 循环里 `if (!consumer.process(x)) return`：**第一台拒绝就整轮停**
//                    （转到实现/查找用法/参数提示）
//
// 去重的真相：跨客户端**没有**去重。`distinct()` 只出现在**单台客户端一次应答之内**
// （`LspRequestExecutor.kt:118`/`:139`/`:151` 对 definition/typeDefinition/implementation 的
// locationLinks），因为它可能返回同一个目标的重复项。inlayHint 的复用身份 `LspInlayHintIdentity`
// （`LspInlayHintRendering.kt:74-78`）按 `descriptor + label + maxChars` 判，**故意不含位置**
// （`:67-73`：只挪动位置的编辑必须复用同一个 inlay）——那是渲染复用，不是结果合并。

/** 合并策略四档。 */
export type LspMergePolicy = 'first' | 'concat' | 'collect' | 'earlyStop'

/** 一行合并规则。`callSite` 是上游那条调用点的坐标。 */
export interface LspMergeRule {
  /** 特性名（上游类名去掉 `Lsp`/`Feature` 后缀的写法，便于对照本仓 `lspFeatureMatrix`）。 */
  feature: string
  /** 上游调用点（相对路径:行号）。 */
  callSite: string
  policy: LspMergePolicy
  /** 为什么是这一档（上游那句代码的要点）。 */
  note: string
}

/**
 * 表本体。每一行的 `callSite` 都是开参考树逐行核过的调用点。
 * 与本仓的关系：本仓一种语言一台服务器（`native/lsp_config.cpp` 的合成表），所以这张表**目前只有
 * `first` 与 `concat` 两档会在真机上出现**；`collect`/`earlyStop` 是上游多客户端才分得出的行为，
 * 表里留着是为了让"多服务合并"这件事有一个可核对的契约，而不是一句"本仓只有一台"就抹掉。
 */
export const LSP_MERGE_RULES: readonly LspMergeRule[] = [
  { feature: 'structureView', callSite: 'platform/lsp-impl/src/impl/features/documentSymbol/LspStructureViewSupport.kt:30-33', policy: 'first',
    note: 'getClientsWithThisFileOpen(file).firstOrNull { structureViewSupport && supportsDocumentSymbol } —— 只取第一台' },
  { feature: 'breadcrumbs', callSite: 'platform/lsp-impl/src/impl/features/documentSymbol/LspFileBreadcrumbsCollector.kt:67-70', policy: 'first',
    note: 'firstOrNull { breadcrumbsSupport && supportsDocumentSymbol }' },
  { feature: 'rename', callSite: 'platform/lsp-impl/src/impl/features/rename/LspRenameHandler.kt:89-94', policy: 'first',
    note: 'getClientsWithThisFileOpen(file).find { renameCustomizer && supportsRename && shouldRunRename }' },
  { feature: 'onTypeFormatting', callSite: 'platform/lsp-impl/src/impl/features/formatter/LspOnTypeFormatting.kt:82-83', policy: 'first',
    note: 'firstOrNull { isClientApplicable(it, virtualFile, charTyped) }' },
  { feature: 'parameterInfo', callSite: 'platform/lsp-impl/src/impl/features/parameterInfo/LspParameterInfoHandler.kt:22-31', policy: 'earlyStop',
    note: 'for(client){ … if (signatureHelp.signatures.isNotEmpty()) { setItemsToShow; return } } —— 第一台给出签名就停' },
  { feature: 'gotoImplementation', callSite: 'platform/lsp-impl/src/impl/features/navigation/LspGotoImplementation.kt:161-177', policy: 'earlyStop',
    note: 'for(lspClient){ … if (!consumer.process(targetElement)) return } —— 消费方拒收就整轮停' },
  { feature: 'findUsages', callSite: 'platform/lsp-impl/src/impl/features/usages/LspUsageSearcher.kt:35-65', policy: 'concat',
    note: 'for(lspClient in searchTarget.lspClients){ … for(resultLocation){ consumer.process(PsiUsage…) } } —— 逐台都收，末尾 `:67` 恒 return true' },
  { feature: 'foldingRange', callSite: 'platform/lsp-impl/src/impl/features/folding/LspFoldingBuilder.kt:26-28', policy: 'concat',
    note: 'getClientsWithThisFileOpen(file).flatMap { it.getFoldingRangeInfos(file) } —— 首尾相接，不去重' },
  { feature: 'inlayHint', callSite: 'platform/lsp-impl/src/impl/features/inlayHint/LspInlayHintRendering.kt:35-48', policy: 'concat',
    note: 'clients.flatMap { client -> … getInlayHints(file).filter{ shouldDisplay }.map{ LspInlayHintItem } }' },
  { feature: 'codeLens', callSite: 'platform/lsp-impl/src/impl/features/codeLens/LspCodeVisionProvider.kt:34-38', policy: 'concat',
    note: 'clients.flatMap { client -> client.getCodeLens(virtualFile).map { it to client } }' },
  { feature: 'highlighting', callSite: 'platform/lsp-impl/src/impl/features/highlighting/LspHighlightingApplier.kt:152-163', policy: 'concat',
    note: 'for(client in clients){ collectDiagnostic + collectSemanticToken + collectDocumentLink } —— 三族各追加进同一个 result' },
  { feature: 'completion', callSite: 'platform/lsp-impl/src/impl/features/completion/LspCompletionContributor.kt:37-62', policy: 'concat',
    note: 'for(client){ … processCompletionItemsImpl(…, originalResultSet, items) } —— 每台都往同一个 resultSet 加条目' },
  { feature: 'documentationTargets', callSite: 'platform/lsp-impl/src/impl/features/documentation/LspDocumentationTargetProvider.kt:29-31', policy: 'collect',
    note: 'getClientsForFileRequests(file).mapNotNull { lspClient -> … } —— 逐台都收' },
  { feature: 'implicitReference', callSite: 'platform/lsp-impl/src/impl/features/navigation/LspImplicitReferenceProvider.kt:105-116', policy: 'collect',
    note: 'lspClients.mapNotNull { … }，再 partition 成 selfDefinitions/navigations' },
]

const MERGE_BY_FEATURE = new Map(LSP_MERGE_RULES.map(rule => [rule.feature, rule]))

/** 查一条合并规则；没登记返回 null（调用方按"未知特性不合并"处理，不凭空造一档）。 */
export function lspMergeRuleFor(feature: string): LspMergeRule | null {
  return MERGE_BY_FEATURE.get(feature) ?? null
}

/**
 * 这一档策略下，多台客户端的**逐台结果**怎么变成一份。
 * `perClient` 是一台客户端一条结果（`null` = 这一台没给）。
 *   · first     —— 第一台非 null 的结果（`firstOrNull` 的等价物）
 *   · concat    —— 全部首尾相接（**不去重**，与上游 flatMap 一致）
 *   · collect   —— 与 concat 同形，差别在调用方（`mapNotNull` 也保留顺序）
 *   · earlyStop —— 第一台给出结果就停（模拟上游 `consumer.process` 拒收后的 return）
 */
export function mergeLspClientResults<T>(policy: LspMergePolicy, perClient: readonly (T | null | undefined)[]): T[] {
  if (policy === 'first' || policy === 'earlyStop') {
    for (const result of perClient) if (result !== null && result !== undefined) return [result]
    return []
  }
  const out: T[] = []
  for (const result of perClient) if (result !== null && result !== undefined) out.push(result)
  return out
}

/**
 * `getClientsForFileRequests` 的选择顺序（`LspClientManagerImpl.kt:113-120`），
 * 与 `getClientsWithThisFileOpen`（`:100-101`，`isFileOpened`）是两个不同的面：
 *   ① 已打开这个文件的客户端（`clientsWithFileOpen.isNotEmpty()` 就**直接返回**，不再往下看）；
 *   ② 否则，产出这个动态文件的那些客户端（`dynamicFiles.contains(file)`）；
 *   ③ 否则，按 URI 认领这个动态文件的运行中客户端（`dynamicFiles.adopt`）。
 * 本仓没有动态文件那一族（`native` 无此链）⇒ ②③ 恒空，`lspClientsForFileRequests` 只走 ①。
 */
export const LSP_FILE_REQUEST_ORDER = ['fileOpen', 'producingClient', 'adopt'] as const

/** 这一台客户端该不该被 `getClientsForFileRequests` 选中（上游那三步；本仓只有第一步有数据）。 */
export function lspClientForFileRequests(stage: typeof LSP_FILE_REQUEST_ORDER[number], facts: { fileOpened: boolean; producedFile?: boolean; adopted?: boolean }): boolean {
  if (stage === 'fileOpen') return facts.fileOpened
  if (stage === 'producingClient') return facts.producedFile === true
  return facts.adopted === true
}

/** `LspClientManagerImpl.kt:50`：一个工程最多这么多台，超了整条启动请求被丢（`:217-221`）。 */
export const MAX_LSP_CLIENTS = 10

// ── 八、补全 resolve 缓存（上游 `LspCompletionObject`）─────────────────────────────────
//
// 上游在补全路径上**缓存什么**：`LspCompletionObject.kt:38` 的 `private var resolvedCompletionItem`
// —— 每个 `LspCompletionObject` 一个格子（`LspLookupElementDecorator.kt:27` 每个候选建一个），
// 存的是**这一条候选解析后的 `CompletionItem`**。
//   · 缓存键：`LspCompletionObject` 实例本身 = 一台客户端 × 一条 `CompletionItem`
//     （`LspLookupElementDecorator.kt:27`；`LspCompletionContributor.kt:101` 每条条目一个 decorator）。
//   · 命中判据：`resolvedCompletionItem != null`（`:49`）—— **只判有没有值**，不比较任何 stamp。
//   · 什么时候发请求：只有服务器声明了 `completionProvider.resolveProvider == true`（`:51`）才发；
//     否则把 `initialCompletionItem` 自己填进格子（`:52-53`，等于"没有更多信息"）。
//   · 并发闸：`Semaphore(2)`（`LspCompletionContributor.kt:87`），每台客户端一个，
//     注释 `:84-86` 原文说不能拿 resolve 把服务器淹了（resolve 会挡住别的命令）。
//   · 服务端回包后 `:62` 把 `label` 复位成**初始** label（协议禁止用新 label）。
//   · 失效：没有失效逻辑 —— 候选一关就随 lookup element 一起没了（`clearCache` 那一族缓存都不管它，
//     `LspRequestExecutor.kt:48-56` 登记的五个缓存里没有 resolve）。
//   · 跨请求**不缓存**：下一次补全弹层是新的 `LspCompletionObject`。
// 自定义闸：`LspCompletionCustomizer.kt:66` `shouldResolveCompletionItem(item) = true`（缺省解析）。

/** `LspCompletionContributor.kt:87` 的 `Semaphore(2)`。 */
export const LSP_RESOLVE_MAX_CONCURRENT = 2

/** 计数信号量（上游 `kotlinx.coroutines.sync.Semaphore` 的等价物，纯 Promise 版）。 */
export interface LspResolveSemaphore {
  /** 拿一个许可跑任务；跑完释放。 */
  run<T>(task: () => Promise<T>): Promise<T>
  /** 现在几个在跑。 */
  active(): number
  /** 现在几个在等。 */
  waiting(): number
}

/** 造一个信号量。`permits <= 0` 按 1 处理（0 许可会让所有 resolve 永远挂着，那不是上游行为）。 */
export function createLspResolveSemaphore(permits: number = LSP_RESOLVE_MAX_CONCURRENT): LspResolveSemaphore {
  const limit = permits > 0 ? permits : 1
  let active = 0
  const queue: (() => void)[] = []
  const acquire = (): Promise<void> => {
    if (active < limit) { active++; return Promise.resolve() }
    return new Promise<void>(resolve => { queue.push(() => { active++; resolve() }) })
  }
  const release = (): void => {
    active--
    const next = queue.shift()
    if (next) next()
  }
  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      await acquire()
      try { return await task() } finally { release() }
    },
    active: () => active,
    waiting: () => queue.length,
  }
}

/** 一条候选的 resolve 结果格子。 */
export interface LspResolveCache<T> {
  /**
   * 解析这一条（命中就回同一个 promise，与上游 `:49` 的"有值就 return"同效）。
   * 服务器没声明 `resolveProvider` 时**不发请求**、直接把这条自己当答案（上游 `:52-53`）。
   */
  resolve(item: T, compute: () => Promise<T | null>): Promise<T | null>
  has(item: T): boolean
  size(): number
  /** 一次补全会话结束：整格丢掉（上游随 `LspCompletionObject` 一起消失）。 */
  clear(): void
}

/**
 * 造一份 resolve 缓存。**每个补全会话一份**（不是全局），与上游"每个候选一个对象"同寿命。
 * `options.resolveProvider` 就是 `serverCapabilities.completionProvider.resolveProvider`（`:51` 的闸）。
 */
export function createLspResolveCache<T>(options: { resolveProvider?: boolean; semaphore?: LspResolveSemaphore } = {}): LspResolveCache<T> {
  const resolveProvider = options.resolveProvider === true
  const semaphore = options.semaphore ?? createLspResolveSemaphore()
  const slots = new Map<T, Promise<T | null>>()
  return {
    resolve(item: T, compute: () => Promise<T | null>): Promise<T | null> {
      const hit = slots.get(item)
      if (hit) return hit
      const pending = resolveProvider
        ? semaphore.run(compute).then(value => value ?? item).catch(() => item)
        : Promise.resolve<T | null>(item)
      slots.set(item, pending)
      return pending
    },
    has: item => slots.has(item),
    size: () => slots.size,
    clear: () => { slots.clear() },
  }
}

// ── 九、输出窗口的过滤与分组（纯函数）──────────────────────────────────────────────────
//
// 上游过滤/清空走的是控制台自己的工具条（`ConsoleViewImpl.createConsoleActions`，
// `platform/lang-impl/src/com/intellij/execution/impl/ConsoleViewImpl.kt:1346-1377`：
// prev/next occurrence、soft wraps、scroll-to-end、Print、Clear 六个）。
// 本仓那一层在 `src/consoleScroll.ts` 等模块；这里只给"按类别/语言/级别筛"的纯数据面。

/** 过滤条件。`language: ''` 是**有效条件**（服务器没报语言名的那几条），不是"不过滤"。 */
export interface LspConsoleFilter {
  language?: string
  category?: LspConsoleCategory
  /** 只要 ≥ 这一级的行（1 最严重）；traffic/lifecycle 没有 MessageType ⇒ 不受它影响。 */
  minLevel?: number
}

/** 这一行的 MessageType（只对 logMessage/showMessage 有意义；其余返回 undefined）。 */
export function lspConsoleEntryLevel(entry: LspConsoleEntry): number | undefined {
  if (entry.category !== 'logMessage' && entry.category !== 'showMessage') return undefined
  const level = entry.tag === 'ERROR' ? 1 : entry.tag === 'WARN' ? 2 : entry.tag === 'INFO' ? 3 : entry.tag === 'LOG' ? 4 : entry.tag === 'DEBUG' ? 5 : undefined
  return level
}

export function filterLspConsoleEntries(entries: readonly LspConsoleEntry[], filter: LspConsoleFilter = {}): LspConsoleEntry[] {
  return entries.filter(entry => {
    if (filter.language !== undefined && entry.language !== filter.language) return false
    if (filter.category && entry.category !== filter.category) return false
    if (filter.minLevel !== undefined) {
      const level = lspConsoleEntryLevel(entry)
      if (level !== undefined && level > filter.minLevel) return false
    }
    return true
  })
}

/** 按语言分组（稳定顺序 = 首次出现顺序）；本仓一种语言一台控制台。 */
export function groupLspConsoleEntries(entries: readonly LspConsoleEntry[]): { language: string; entries: LspConsoleEntry[] }[] {
  const groups: { language: string; entries: LspConsoleEntry[] }[] = []
  const byLanguage = new Map<string, { language: string; entries: LspConsoleEntry[] }>()
  for (const entry of entries) {
    let group = byLanguage.get(entry.language)
    if (!group) { group = { language: entry.language, entries: [] }; byLanguage.set(entry.language, group); groups.push(group) }
    group.entries.push(entry)
  }
  return groups
}

/** 整份（或过滤后）控制台文本（导出/复制用）。 */
export function exportLspConsoleText(entries: readonly LspConsoleEntry[], filter: LspConsoleFilter = {}): string {
  return filterLspConsoleEntries(entries, filter)
    .map(entry => formatLspConsoleLine({ at: entry.at, tag: entry.tag, message: entry.text }))
    .join('\n')
}