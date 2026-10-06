// 语言服务的 `$/progress`（导入 / 建索引那类后台进度）—— 状态与纯逻辑。
//
// 对照源码（本机 intellij-community 树）：
//   · 客户端**必须先声明能力**，服务器才有资格发进度：
//     `platform/lsp/src/api/LspClientCapabilities.kt:245-249` —— `window = WindowClientCapabilities().apply { … workDoneProgress = true }`。
//   · 通知入口：`platform/lsp-impl/src/impl/LspServerNotificationsHandlerImpl.kt`
//     - `createProgress`（:255）对 `window/workDoneProgress/create` 直接回 null（同意，不做别的事）；
//     - `notifyProgress`（:257-328）按 `value.kind` 分三支：
//       `begin` → `ProgressTask(text = value.title, details = value.message, fraction = percentage/100)`
//       并起一条后台任务（任务名 `LspBundle.properties:32` `progress.title.progress={0}: progress`，
//       `{0}` 是语言服务器的可读名）；`report` → **只覆盖发出来的那两个字段**
//       （`message ?: 旧值`、`percentage.toFraction() ?: 旧值`，:315-322）；`end` → 删掉这条（:323-326）；
//     - `percentage` 是 0-100 的整数，转 fraction 时 `(it / 100.0).coerceIn(0.0, 1.0)`（:263）。
//   · 显示位置：这条 fraction/text/details 进的是**状态栏的后台任务弹窗**
//     （`platform/platform-impl/src/com/intellij/openapi/wm/impl/status/ProgressComponent.kt:55`/`:66`
//     每行一条 `JProgressBar`），不是 Notifications 气球 —— 所以本仓的落点是 `progressPanel.ts` 的那些行。
//
// 本模块只做"事件 → 任务表"这一段（纯函数 + 一个 reactive 表）；聚合与取消归 progressPanel。
import { reactive } from 'vue'
import { expireLspMessageRequestsOnStop, handleLspServerMessageEvent } from './lspServerMessages.ts'

// 服务器**主动**发来的那几条消息/请求（showMessage、logMessage、showMessageRequest、
// 五条 workspace/…/refresh）的处置不在本模块：注册表、丢弃计数与回选都在
// `src/lspServerMessages.ts`（一个文件一件事：这里只管 `$/progress` 的后台任务表）。
// 下面这几个名字继续从本模块转出，`src/bridge.ts`、`src/progressNotices.ts`
// 与既有判据的 import 都不必改。
export {
  LSP_REFRESH_METHODS, lspActionTitles, lspMessageRouteOf, lspServerMessages,
  type LspMessageRoute, type LspServerMessage,
} from './lspServerMessages.ts'

export type LspProgressKind = 'begin' | 'report' | 'end'

/** 宿主 `lsp.progress` 事件（native/lsp_host_bootstrap.cpp 整形后的形状）。 */
export interface LspProgressEvent {
  language: string
  token: string
  kind: LspProgressKind
  title: string
  message: string
  /** 0-100；`-1` = 服务器没给百分比（于是这一行是不确定式的）。 */
  percent: number
  cancellable: boolean
}

/** 一条正在跑的语言服务后台任务。 */
export interface LspProgressTask {
  key: string
  language: string
  token: string
  title: string
  details: string
  percent: number
  cancellable: boolean
  /** 毫秒时间戳（begin 那一刻），用来算"已用多久"。 */
  since: number
}

/** `LspBundle.properties:32` `progress.title.progress={0}: progress` —— 服务器没发 title 时的兜底行名。 */
export function lspProgressFallbackTitle(language: string): string {
  return `${language}：进度`
}

/**
 * 宿主事件 → `LspProgressEvent`；形状不对就返回 null（调用方把这条事件当没收到）。
 * 百分比按上游那样夹进 0-100（`ScrollableTabs`… 不，是 `:263` 的 `coerceIn(0.0, 1.0)`），
 * 越界与缺失都记成"没有百分比"= 不确定式。
 */
export function parseLspProgressEvent(data: {
  language?: unknown; token?: unknown; kind?: unknown; title?: unknown; message?: unknown;
  percentage?: unknown; cancellable?: unknown
}): LspProgressEvent | null {
  const language = typeof data.language === 'string' ? data.language : ''
  const token = typeof data.token === 'string' ? data.token : ''
  const kind = data.kind === 'begin' || data.kind === 'report' || data.kind === 'end' ? data.kind : null
  if (!language || !token || !kind) return null
  const raw = typeof data.percentage === 'number' && Number.isFinite(data.percentage) ? data.percentage : -1
  return {
    language,
    token,
    kind,
    title: typeof data.title === 'string' ? data.title : '',
    message: typeof data.message === 'string' ? data.message : '',
    percent: raw < 0 || raw > 100 ? -1 : Math.round(raw),
    cancellable: data.cancellable === true,
  }
}

export function lspProgressKey(language: string, token: string): string {
  return `${language}:${token}`
}

/**
 * 把一条事件应用到任务表上（**原地改**，调用方给的是 reactive 表）。
 * begin 建条目、report 只覆盖发出来的字段、end 删条目 —— 与上游 :265-327 一一对应。
 */
export function applyLspProgressEvent(
  tasks: Record<string, LspProgressTask>,
  event: LspProgressEvent,
  now = Date.now(),
): void {
  const key = lspProgressKey(event.language, event.token)
  if (event.kind === 'end') { delete tasks[key]; return }
  if (event.kind === 'begin') {
    tasks[key] = {
      key, language: event.language, token: event.token,
      title: event.title || lspProgressFallbackTitle(event.language),
      details: event.message, percent: event.percent, cancellable: event.cancellable, since: now,
    }
    return
  }
  const current = tasks[key]
  if (!current) {
    // 没见过 begin 就收到 report：服务器可以在没建 token 的情况下直接发（`$/progress` 不要求 create），
    // 此时按 begin 处理，否则这条进度就永远看不见。
    applyLspProgressEvent(tasks, { ...event, kind: 'begin' }, now)
    return
  }
  // 上游的 `?:` 语义：没发的字段沿用旧值，不是清空。
  if (event.message) current.details = event.message
  if (event.title) current.title = event.title
  if (event.percent >= 0) current.percent = event.percent
}

/** `bridge.ts` 递过来的那条宿主消息（`lsp.progress*` 与 `lsp.message` 共用的字段袋）。 */
export interface LspProgressEventData {
  event?: string; language?: unknown; token?: unknown; kind?: unknown
  title?: unknown; message?: unknown; percentage?: unknown; cancellable?: unknown
  /** `lsp.message` 用：LSP `MessageType`（1 错误 / 2 警告 / 3 信息 / 4 日志）。 */
  severity?: unknown
  /** `lsp.message` 用：这条原来是 LSP 的哪一个方法（宿主在参数里带的，见 native/lsp_host_bootstrap.cpp）。 */
  method?: unknown
  /** `window/showMessageRequest` 用：服务器给的那一排选项（`MessageActionItem[]`）。 */
  actions?: unknown
  /** `window/showMessageRequest` 用：这条请求的 JSON-RPC id；本批宿主还没带出来（见请求文档 R2）。 */
  id?: unknown
}

/**
 * 一条 `lsp.progress` / `lsp.progressReset` / `lsp.message` 事件进状态表。`false` = 这条不属于本通道
 * （调用方继续往下的分支）—— 与 `handleGradleEvent` 同一个约定，桥接层因此只留一行转发。
 * 服务器**主动**说话那几条（`lsp.message`）整条交出去：分级、注册表、丢弃计数、showMessageRequest
 * 的回选都在 `src/lspServerMessages.ts`，本模块不再自己认方法名。
 */
export function handleLspProgressEvent(event: string | undefined, data: LspProgressEventData): boolean {
  if (event === 'lsp.message') return handleLspServerMessageEvent(data)
  if (event === 'lsp.progressReset') {
    // 服务器停了就再不会有 `end`：整条语言收掉，并交给消息窗口一句实话（不是"已完成"）。
    lspProgressInterrupted.push(...takeLspProgressForLanguage(lspProgressTasks, typeof data.language === 'string' ? data.language : ''))
    // 它还没答完的问句（`window/showMessageRequest`）同一拍按 null 收掉 —— 上游是同一个理由：
    // 客户端没法再替一个已经不存在的服务器留着这个 future（`LspServerNotificationsHandlerImpl.kt:378`）。
    expireLspMessageRequestsOnStop(typeof data.language === 'string' ? data.language : '')
    return true
  }
  if (event !== 'lsp.progress') return false
  const parsed = parseLspProgressEvent(data)
  if (!parsed) return false
  applyLspProgressEvent(lspProgressTasks, parsed)
  return true
}

/**
 * 某条语言的服务器停了（停机/换项目/服务器起失败）：把它在跑的那些行整体清掉。
 * 上游对应 `cancelAllProgress()`（同一个文件 :331-339，注释写得很直白："so its background
 * progresses don't keep running"）—— 不收的话界面里就永远留一条在转的行。
 * 返回被清掉的条目，调用方（消息窗口）可以据此补一条结论行。
 */
export function takeLspProgressForLanguage(tasks: Record<string, LspProgressTask>, language: string): LspProgressTask[] {
  const prefix = `${language}:`
  const taken = Object.values(tasks).filter(task => language === '' || task.key.startsWith(prefix))
  for (const task of taken) delete tasks[task.key]
  return taken
}

/** 面板要的那些行（按 begin 先后排序，稳定顺序 = 插入顺序）。 */
export function runningLspTasks(tasks: Record<string, LspProgressTask>): LspProgressTask[] {
  return Object.values(tasks).sort((a, b) => a.since - b.since)
}

/** 一行右侧的百分比文字；没有百分比（不确定式）时是空串。 */
export function lspProgressLabel(task: LspProgressTask): string {
  return task.percent >= 0 ? `${task.percent}%` : ''
}

/**
 * 状态表。`bridge.ts` 的 `lsp.progress` 分支喂它，`progressPanel.ts` 读它。
 * 与 `gradleSync` 同一个形状：一个 reactive 容器 + 一个事件处理函数。
 */
export const lspProgressTasks = reactive<Record<string, LspProgressTask>>({})
/**
 * 被"服务器停了"收掉的行（没等到 `end`）。消息窗口那边读它补结论；bridge 只往里放，
 * 读的人负责清空 —— 这样两边不会为同一条行抢着写。
 */
export const lspProgressInterrupted = reactive<LspProgressTask[]>([])
