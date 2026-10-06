// 语言服务**输出**（上游 `platform/lsp-impl/src/impl/logging/LanguageServiceLogger.kt` +
// `LspServiceViewSupport.kt`/`LspClientConsole.kt`：把每个 LSP 客户端的消息/进度/生命周期写进
// 「语言服务」输出窗口，`LspTrafficPayloadPopup` 看单条流量）。
//
// 本仓现状：LSP 会话在宿主 `native/lsp_worker.cpp`/`lsp_session.cpp`，宿主日志只落文件（`app.logPaths`）；
// 前端能收到的事件只有 `lsp.diagnostics`/`lsp.progress*`/`lsp.message`/`lsp.edited`（见 src/bridge.ts，
// 本批冻结）。这个模块把这些**已经在流的事件**汇成一份按语言分组的日志（环形、有上限），
// 并给出输出窗口的呈现模型（级别过滤、格式化、导出文本、尾部几行）。
//
// 消费点：`src/progressNotices.ts` 的 watcher —— 语言服务停止/报错时在「消息」窗口留一行
// 「语言服务（jdt.ls）日志」通知（detail 是日志尾部，动作「复制日志」把 `exportLspLogText`
// 写进剪贴板）。IDEA 那个独立的 Services 输出窗口（`LspClientConsole`）本仓没有宿主（要改
// App.vue 的工具窗口装配，本批冻结），所以落在通知窗口 —— 判词里如实写明这一层差异。
//
// 明确不做：流量级请求/响应记录（`LspTrafficPayloadPopup` —— 宿主不转发每一条 JSON-RPC，
// 前端也就无从记录）、按客户端的日志文件（`LanguageServiceLogger` 往 log 目录写文件）。
import { ref } from 'vue'

/** 日志行的来源类别（对应上游几处写入点：服务器通知、进度、会话生命周期、服务端编辑、
 * 服务器要求重取（`workspace/…/refresh`，上游同样只写日志不弹通知：
 * `LspServerNotificationsHandlerImpl.kt:341-368`））。
 * `dropped` = 前端没有登记这条方法的处理器（`src/lspServerMessages.ts` 的注册表拦下来的那些）：
 * 「声明了 capability 却没处理器」这一类缺陷在本仓唯一可观察的痕迹就是它，不记就等于无声丢弃。 */
export type LspLogKind = 'message' | 'progress' | 'session' | 'edit' | 'refresh' | 'dropped'

/** 严重级与 LSP `MessageType` 同口径：1 错误 / 2 警告 / 3 信息 / 4 日志。 */
export type LspLogLevel = 1 | 2 | 3 | 4

export interface LspLogEntry {
  /** 毫秒时间戳。 */
  at: number
  /** 语言（服务器可读名的来源，如 `java`/`typescript`）。 */
  language: string
  kind: LspLogKind
  level: LspLogLevel
  text: string
}

/** 环形日志的上限（`LanguageServiceLogger` 同样有上限，避免一次索引刷满内存）。 */
export const LSP_LOG_LIMIT = 500

/** 追加一条并裁到上限（纯函数，返回新数组 —— 测试直接跑）。 */
export function appendLspLogEntry(entries: readonly LspLogEntry[], entry: LspLogEntry, limit = LSP_LOG_LIMIT): LspLogEntry[] {
  const next = [...entries, entry]
  return next.length > limit ? next.slice(next.length - limit) : next
}

export interface LspLogFilter {
  language?: string
  /** 只要 ≥ 这一级的行（1 最严重）。 */
  minLevel?: LspLogLevel
  kind?: LspLogKind
}

export function filterLspLog(entries: readonly LspLogEntry[], filter: LspLogFilter = {}): LspLogEntry[] {
  return entries.filter(entry => {
    // `language: ''` 是**有效的过滤条件**（服务器没报语言名的那几条），不是"不过滤"。
    if (filter.language !== undefined && entry.language !== filter.language) return false
    if (filter.minLevel && entry.level > filter.minLevel) return false
    if (filter.kind && entry.kind !== filter.kind) return false
    return true
  })
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0')
}

/** 一行日志的文本形状（`[hh:mm:ss] [jdt.ls] message: 文本`；级别前缀只在错误/警告时加）。 */
export function formatLspLogEntry(entry: LspLogEntry): string {
  const time = new Date(entry.at)
  const stamp = `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`
  const level = entry.level === 1 ? '错误 ' : entry.level === 2 ? '警告 ' : ''
  return `[${stamp}] [${entry.language || '语言服务'}] ${level}${entry.kind}: ${entry.text}`
}

/** 整份日志（或过滤后）的导出文本 —— 「复制日志」动作与判据都用它。 */
export function exportLspLogText(entries: readonly LspLogEntry[], filter: LspLogFilter = {}): string {
  return filterLspLog(entries, filter).map(formatLspLogEntry).join('\n')
}

/** 某语言的最近 n 行（通知的 detail；不足 n 行就全给）。 */
export function lspLogTail(entries: readonly LspLogEntry[], language: string, count = 8): string[] {
  const lines = filterLspLog(entries, { language }).map(formatLspLogEntry)
  return count > 0 ? lines.slice(Math.max(0, lines.length - count)) : lines
}

/** 一行摘要（通知标题用）：`jdt.ls：12 行（错误 1）`。 */
export function lspLogSummary(entries: readonly LspLogEntry[], language: string): string {
  const own = filterLspLog(entries, { language })
  const errors = own.filter(entry => entry.level === 1).length
  const name = language || '语言服务'
  return errors ? `${name}：${own.length} 行（错误 ${errors}）` : `${name}：${own.length} 行`
}

/** 日志里出现过的语言（稳定顺序 = 首次出现顺序）。 */
export function lspLogLanguages(entries: readonly LspLogEntry[]): string[] {
  const seen: string[] = []
  for (const entry of entries) if (!seen.includes(entry.language)) seen.push(entry.language)
  return seen
}

// ── 主机侧的日志表（`src/progressNotices.ts` 的 watcher 写；同族读者只有通知窗口）─────────────

/** 语言服务日志（reactive；`appendLspLog` 追加，`lspLogEntries` 是唯一事实来源）。 */
export const lspLogEntries = ref<LspLogEntry[]>([])

export function appendLspLog(entry: Omit<LspLogEntry, 'at'> & { at?: number }): void {
  lspLogEntries.value = appendLspLogEntry(lspLogEntries.value, { ...entry, at: entry.at ?? Date.now() })
}

/** LSP `MessageType` → 本日志的级别；认不出的值按信息（3）记，不凭空升级为错误。 */
export function lspLogLevelOf(severity: number): LspLogLevel {
  return severity === 1 || severity === 2 ? severity : severity === 4 ? 4 : 3
}

/** 服务器自己发的消息（`window/showMessage`，bridge 整形成 `{language, severity, message}` 后进表）。 */
export function logLspServerMessage(message: { language: string; severity: number; message: string }): void {
  appendLspLog({ language: message.language, kind: 'message', level: lspLogLevelOf(message.severity), text: message.message })
}

/** 进度三态（begin/report/end）与会话停止 —— 只记**状态变化**，report 不逐拍刷屏。 */
export function logLspProgress(kind: 'begin' | 'end', task: { language: string; title: string }): void {
  appendLspLog({
    language: task.language, kind: 'progress', level: kind === 'end' ? 3 : 4,
    text: kind === 'end' ? `${task.title} 完成` : `${task.title} 开始`,
  })
}

export function logLspServerStopped(task: { language: string; title: string }): void {
  appendLspLog({ language: task.language, kind: 'session', level: 2, text: `语言服务已停止：${task.title} 未收到结束通知` })
}

/** 清空（「清空日志」动作；当前没有窗口按钮，留给后续接独立窗口时用）。 */
export function clearLspLog(language?: string): void {
  lspLogEntries.value = language ? lspLogEntries.value.filter(entry => entry.language !== language) : []
}
