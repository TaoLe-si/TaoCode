// 语言服务会话在**前端这一侧**的状态模型 —— 上游
// `platform/lsp/src/api/LspServerState.kt` + `platform/lsp-impl/src/impl/features/LspPendingClient.kt`
// 在本仓的等价物（判决：`docs/inventory/verdict-platform_rest.md` 的 `ls/session` / `ls/platform`）。
//
// 上游逐条（每条都有坐标）：
//   · `LspServerState.kt:7-25` 四个状态：`Initializing`（初始态，收到 initialize 回包才变 `Running`）、
//     `Running`（可以处理请求）、`ShutdownNormally`、`ShutdownUnexpectedly`。
//     本仓的宿主不推状态变化事件，状态由 `lsp.open` 的**回包**算出来 ——
//     `native/lsp_capability_queries.cpp:134-146`（`Session::language_status`）给的是
//     `{running, ready, configured, language, error?}`，其中
//     `running = alive && 无启动错误`、`ready = alive && 无启动错误 && initialize 已握手`（`:139-141`）。
//     同一个方法还保证 **`!running` 一定带 `error`**（`:143-144` 把"进程不在了"报成 `LSP_CLOSED`），
//     所以本模块的分类不需要额外判据。
//   · `LspPendingClient.kt:20-27` `findPendingLspClient`：在**所有**客户端里找
//     `state == Initializing` 且"认领"这个文件的那一个。`optsIn` 是调用方给的额外条件。
//   · `LspPendingClient.kt:33-39` `isExpectedToHandleFile` 的三道闸：
//     文件在本机文件系统上 → 在工程内容里 → 客户端的 roots 覆盖它且 descriptor 支持它。
//     注释点明"roots must cover the file, so an unrelated client cannot claim it"（`:18`）。
//   · `LspPendingClient.kt:46-58` `showLspServerNotReadyHint`：找不到客户端时给的是**提示**，
//     不是静默失败。文案取 `platform/lsp/resources/messages/LspBundle.properties:61`
//     `lsp.refactoring.server.starting={0} is starting. Try again in a few seconds.`
//
// 与上游的差异（如实）：本仓一个语言只有**一台**服务器（`native/lsp_config.cpp` 的合成表），
// 而上游一个文件可能有多个客户端，所以"找哪一个"在本仓退化成"唯一那台"；
// `descriptor.roots` / `isSupportedFile` 宿主没有查询面（`lsp.open` 的回包不带这两项），
// 所以这两条判据由调用方以谓词形式给出 —— 本模块不替调用方编造。
import { reactive } from 'vue'

/**
 * 上游 `LspServerState` 的四个状态 + 本仓多出来的 `unconfigured`：
 * 没有为这个语言配服务器（`configured === false`）。上游没有这一格，因为
 * 「没有 provider」时根本不会创建客户端；本仓按语言选服务器，必须显式记下这一格。
 */
export type LspServerState = 'unconfigured' | 'initializing' | 'running' | 'shutdownUnexpectedly'

/** `Session::language_status` 的回包形状（`native/lsp_capability_queries.cpp:139-144`）。 */
export interface LspLanguageStatus {
  running: boolean
  ready: boolean
  configured: boolean
  language: string
  /** 有则是 `{ code, message }`；`LSP_CLOSED` = 进程已退出（`:144`）。 */
  error?: { code?: string; message?: string } | null
}

/**
 * 宿主回包 → 上游那一格状态。逐条照抄 `lsp_capability_queries.cpp:139-144` 的三个布尔：
 * `!configured` 先判（没有服务器就谈不上"关掉了"）；`!running` 一律是异常停机
 * （该方法保证这条路上一定有 `error`）；`running && !ready` 是握手中。
 */
export function lspServerState(status: LspLanguageStatus | null | undefined): LspServerState {
  if (!status || !status.configured) return 'unconfigured'
  if (!status.running) return 'shutdownUnexpectedly'
  return status.ready ? 'running' : 'initializing'
}

/** 一次 `LspLanguageStatus` 回包（`lsp.open` / `lsp.request status` 都给这个形状）。 */
export function parseLspLanguageStatus(data: unknown): LspLanguageStatus | null {
  if (typeof data !== 'object' || data === null) return null
  const raw = data as Record<string, unknown>
  if (typeof raw.language !== 'string' || !raw.language) return null
  const error = typeof raw.error === 'object' && raw.error !== null
    ? raw.error as { code?: unknown; message?: unknown }
    : null
  return {
    language: raw.language,
    running: raw.running === true,
    ready: raw.ready === true,
    configured: raw.configured === true,
    error: error
      ? {
        code: typeof error.code === 'string' ? error.code : undefined,
        message: typeof error.message === 'string' ? error.message : undefined,
      }
      : null,
  }
}

/** 一个客户端（上游 `LspClientImpl`）在本仓需要的**那几项**事实。 */
export interface LspClientFacts {
  /** 上游 `descriptor.presentableName`（提示文案里 `{0}` 填它）。 */
  presentableName: string
  state: LspServerState
  /**
   * 上游 `descriptor.roots`（工作区相对路径，`/` 分隔）。
   * 本仓把它声明成 `Session::ServerConfig.workspace_folders`（`native/lsp_session.hpp:38`）：
   * 空 = 工作区根，非空 = 只这些子目录。宿主不向前端暴露它，所以由调用方给。
   */
  roots: readonly string[]
  /** 上游 `descriptor.isSupportedFile(file)` 的等价物（按扩展名/语言判断）。 */
  supportsFile: (path: string) => boolean
}

/** `isInLocalFileSystem`：本仓的路径全是工作区相对路径，带协议前缀的不是本机文件。 */
export function isLocalWorkspacePath(path: string): boolean {
  return path !== '' && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)
}

/**
 * `VfsUtilCore.isAncestor(root, file, false)`：root 是 file 的祖先**或就是它**。
 * 两边都按工作区相对路径比较（`/` 分隔，忽略开头的 `./`）；root 为空 = 工作区根，覆盖一切。
 */
export function rootCoversFile(root: string, path: string): boolean {
  const base = root.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
  const file = path.replace(/\\/g, '/').replace(/^\.\//, '')
  if (base === '') return true
  return file === base || file.startsWith(`${base}/`)
}

/** `isExpectedToHandleFile`（`LspPendingClient.kt:33-39`）的另外两道闸所需的外部事实。 */
export interface ProjectFileFacts {
  /** `ProjectFileIndex.isInContent(file)` 的等价物（本仓单根工作区 = 在工作区里）。 */
  isInContent: (path: string) => boolean
}

/**
 * `isExpectedToHandleFile`（`LspPendingClient.kt:33-39`）：本地文件 → 在工程内容里 →
 * 某个 root 覆盖它且 descriptor 支持它。`roots` 为空 = 工作区根（`rootCoversFile` 那一条）。
 */
export function isExpectedToHandleFile(client: LspClientFacts, project: ProjectFileFacts, path: string): boolean {
  if (!isLocalWorkspacePath(path)) return false
  if (!project.isInContent(path)) return false
  // `roots` 为空 = 工作区根（见 `LspClientFacts.roots` 与 `rootCoversFile` 的注释）。
  // 上游这里是 `descriptor.roots.any { … }`，而上游的 `roots` 对工程内客户端一定非空
  // （`LspClientWidgetItem.kt:87-89` 就是靠 `size >= 2` 判"多客户端"的），所以上游不需要
  // 空表这一支；本仓的 `Session::ServerConfig.workspace_folders` 用空表表示工作区根
  // （`native/lsp_session.hpp:38`），所以**必须**先把空表放行，否则每个未限定根的服务器
  // 都认领不到任何文件（`.some` 在空数组上恒 false）。
  if (client.roots.length > 0 && !client.roots.some(root => rootCoversFile(root, path))) return false
  return client.supportsFile(path)
}

/**
 * `findPendingLspClient`（`LspPendingClient.kt:20-27`）：状态仍是 `Initializing`、
 * `optsIn` 成立、且认领这个文件。上游是"在所有客户端里 find"，本仓按语言只有一台，
 * 于是 `optsIn` 收窄成"这个文件属于这台客户端的语言"——由调用方用 `supportsFile` 表达。
 * 找不到返回 null，调用方据此给"服务器正在启动"的提示（`LspExtractRefactoringHandler.kt:22-23`）。
 */
export function findPendingLspClient(
  clients: readonly LspClientFacts[],
  project: ProjectFileFacts,
  path: string,
): LspClientFacts | null {
  return clients.find(client =>
    client.state === 'initializing' && isExpectedToHandleFile(client, project, path)) ?? null
}

/**
 * `showLspServerNotReadyHint` 的文案（`LspPendingClient.kt:47` 取
 * `LspBundle.properties:61` `lsp.refactoring.server.starting={0} is starting. Try again in a few seconds.`）。
 */
export function serverNotReadyMessage(presentableName: string): string {
  return `${presentableName} 语言服务正在启动，请过几秒重试。`
}

/**
 * 进程自己走了之后给用户的那句话。上游对应 `LspClientManagerImpl` 收到进程退出后把状态置成
 * `ShutdownUnexpectedly` 的那条路径；本仓的文字来自宿主
 * （`native/lsp_capability_queries.cpp:144` 的 `LSP_CLOSED` 消息），所以这里只是把它如实转出来，
 * 不另编一句。没有 `error` 时（理论上不该发生）给一句不承诺具体原因的说明。
 */
export function serverExitedMessage(status: LspLanguageStatus | null | undefined): string {
  const text = status?.error?.message
  if (text) return text
  return '语言服务器已退出，语言相关功能暂不可用。重新打开该文件或检查语言服务配置。'
}

/**
 * 每种语言一格状态表。宿主没有"状态变化"事件（`src/bridge.ts` 的 lsp 事件只有
 * `lsp.diagnostics` / `lsp.progress` / `lsp.progressReset` / `lsp.message` / `lsp.edited`），
 * 所以这张表由**每次 `lsp.open` 的回包**更新 —— 那正是上游"收到 initialize 回包才变 Running"的时点
 * （`LspServerState.kt:10-12`）。
 */
export const lspSessionStates = reactive<Record<string, LspServerState>>({})

/**
 * 状态机本身 —— `LspClientImpl.state` 的私有 setter（`lsp-impl/.../LspClientImpl.kt:80-90`）。
 *
 * 上游那四行 `if` 是一道**闸**：不合法的迁移被 `logger.error("Incorrect state change: …")`
 * 记下并**原样返回**，表不动、`serverStateChanged` 也不广播（`:89` 在闸的后面）。
 * 注意闸是**无条件**的 —— `value == Initializing` 那条（`:81`）不排除 `field` 已经是
 * Initializing 的情形，所以「同状态重放」在上游同样算一次非法迁移（`:82` 对 Running 也一样）。
 * 逐条照抄：
 *   · `value == Initializing`（`:81`）—— 没有任何迁移能回到握手中；新的一次握手是**新客户端对象**。
 *   · `field != Initializing && value == Running`（`:82`）—— 只有握手中能直接进就绪；
 *     已停机的客户端不会自己活过来（要重启就是重启出一个新对象）。
 *   · `field == ShutdownNormally` / `field == ShutdownUnexpectedly`（`:83-84`）—— 两个停机态都是**终态**。
 *
 * 本仓与上游的差异（如实，两条都影响下面的判据）：
 *   1. 上游的 `ShutdownNormally` 在本仓**不存在**：`Session::language_status` 只给
 *      `{running, ready, configured, error?}`，停机时 `running=false` 且一定带 `error`
 *      （`native/lsp_capability_queries.cpp:143-144` 把"进程不在了"报成 `LSP_CLOSED`），
 *      所以 `lspServerState` 把两种停机都归到 `shutdownUnexpectedly`
 *      —— 上游的四态在本仓退化成三态。终态因此只剩一个。
 *   2. `unconfigured` 是本仓多出来的一格（上游"没有 provider"时根本不建客户端）。
 *      它等价于**客户端对象还不存在**，所以从它出发任何迁移都合法；
 *      迁到它也合法（宿主的服务器配置表是每次 `lsp.open` 现读的，配置被摘掉就会回到这一格）。
 *   3. 上游非法迁移落 `logger.error`；本仓这一格没有前端日志通道
 *      （宿主日志在前端不可达），所以只**拒绝迁移**、不留痕 —— 详见
 *      `docs/inventory/verdict-platform_rest.md` 的 `ls/platform` 缺口。
 */
export function canTransitionLspState(from: LspServerState | undefined, to: LspServerState): boolean {
  if (from === undefined) return true // 首次上报
  // 「还没有客户端」优先于后面所有闸：上游"新客户端对象"天生从 Initializing 起步（`:79`），
  // 本仓那一格是"还没配服务器"，配上之后的第一份状态**必须**能是握手中，否则配好了也起不来。
  if (from === 'unconfigured') return true
  if (to === 'initializing') return false // `:81`
  if (from === 'shutdownUnexpectedly') return false // `:83-84` 的终态（`ShutdownNormally` 那半边见头注第 1 条）
  if (to === 'running') return from === 'initializing' // `:82`
  return true // initializing|running → 停机
}

/** 这一格是不是终态（停机后再也不会自己变；重启会换成新的一格）。 */
export function isTerminalLspState(state: LspServerState | undefined): boolean {
  return state === 'shutdownUnexpectedly'
}

/**
 * 一条 `lsp.open`（或 `status`）回包进状态表；形状不对返回 false（调用方继续往下的分支）。
 *
 * 闸装在写表之前（上游 `LspClientImpl.kt:81-87` 的位置）：不合法的迁移**不改表**。
 * 上游那条 `logger.error` 在本仓无处可落（宿主日志前端读不到），所以这里静默拒绝；
 * 调用方从返回值分辨不出「形状不对」与「迁移不合法」—— 两者都表示"这条没生效"，
 * 而两者都不该让调用方改走别的分支。
 */
export function applyLspLanguageStatus(data: unknown): boolean {
  const status = parseLspLanguageStatus(data)
  if (!status) return false
  const next = lspServerState(status)
  if (!canTransitionLspState(lspSessionStates[status.language], next)) return false
  lspSessionStates[status.language] = next
  return true
}

/** 这台服务器现在能不能接请求（上游只有 `Running` 能）。 */
export function isLspLanguageReady(state: LspServerState | undefined): boolean {
  return state === 'running'
}

/**
 * 这一格该不该按"服务器起不来"处理。`initializing` **不算**失败 —— 那是握手中，
 * 上游对这个状态给的是提示而不是错误（`LspExtractRefactoringHandler.kt:20-25` 的两分支）。
 */
export function isLspLanguageFailed(state: LspServerState | undefined): boolean {
  return state === 'shutdownUnexpectedly' || state === 'unconfigured'
}
