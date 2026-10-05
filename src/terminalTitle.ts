// 终端标签的**标题链路**（上游 `platform/execution-impl/src/com/intellij/terminal/TerminalTitle.kt`）。
//
// 上游行为逐条（已核源码）：
//   · `TerminalTitle.kt:112-117` 标题由四份数据拼成：`userDefinedTitle`（用户重命名）、
//     `applicationTitle`（shell 自己用 OSC 0/2 设的标题）、`tag`、`defaultTitle`。
//   · `:125-137` `bindApplicationTitle`：终端的 application-title 监听器把新标题写回
//     `applicationTitle`，但**只有 `trackTerminalApplicationTitleChanges` 为真时**才写。
//   · `:78-86` `buildTitle(ignoreAppTitle)`：shell 标题为空（或被忽略）⇒ `userDefined ?? default ?? "Unnamed"`；
//     否则 ⇒ `userDefined ?? shortenApplicationTitle() ?? default ?? "Unnamed"`
//     —— **重命名永远压过 shell 标题**，shell 标题压过默认标题；有 tag 时尾巴拼成 `"$title ($tag)"`。
//   · `:100-102` `shortenApplicationTitle = StringUtil.trimMiddle(applicationTitle, 30)`，
//     `trimMiddle` 的几何在 `platform/util/src/com/intellij/openapi/util/text/StringUtil.java:2817-2838`：
//     后缀 = `maxLength >> 1`、前缀 = `maxLength - 后缀 - 省略号长度`、省略号是单个字符 `…`。
//     30 ⇒ 前 14 + `…` + 后 15。
//   · `:26-41` `change {}` 先复制再比较，**内容没变就不通知监听器**（同一个标题反复上报不重绘）。
//   · `:93-98` `buildFullTitle` 与 `buildTitle` 同一条优先级，唯一区别是**不截断** shell 标题，
//     而且**不拼 tag**（tooltip 用的就是这一条）。
//   · 兜底文案 `terminal.default.title=Unnamed`（`platform/execution/resources/messages/ExecutionBundle.properties:728`）。
//
// 本仓落点：xterm.js 的 `onTitleChange` 就是上游的 `TerminalApplicationTitleListener`，
// `src/components/TerminalPanel.vue` 的标签文字取 `buildTerminalTitle`、tooltip 取
// `buildTerminalFullTitle`、重命名走 `renameTerminal`（= 上游的 userDefinedTitle）。
// 判据：tests/terminal-title.test.mjs。

/** `TerminalTitle.kt:101` 的 `trimMiddle(applicationTitle, 30)`。 */
export const TERMINAL_TITLE_MAX_LENGTH = 30

/** `ExecutionBundle.properties:728` 的 `terminal.default.title`。 */
export const TERMINAL_DEFAULT_TITLE = 'Unnamed'

/** `StringUtil.java:2822-2838` 的 `shortenTextWithEllipsis`，`trimMiddle` 就是 suffixLength = max >> 1 的那一档。 */
export function trimMiddle(text: string, maxLength: number): string {
  if (maxLength <= 0 || text.length <= maxLength) return text
  const suffix = maxLength >> 1
  const prefix = maxLength - suffix - 1
  if (prefix < 0) return text.slice(0, maxLength)
  return `${text.slice(0, prefix)}\u2026${text.slice(text.length - suffix)}`
}

/** 四份标题数据（`TerminalTitle.kt:112-117` 的 `State`）。空串按「没有」处理（上游 `isNullOrBlank`）。 */
export interface TerminalTitleState {
  /** 用户重命名（上游 `userDefinedTitle`，压过一切）。 */
  userDefined?: string
  /** shell 自己设的标题（上游 `applicationTitle`，来自 OSC 0/2）。 */
  application?: string
  /** 后缀标签，拼成 `标题 (tag)`（上游 `tag`）。 */
  tag?: string
  /** 面板给的默认标题（上游 `defaultTitle`；本仓是「终端 N」）。 */
  defaultTitle?: string
  /** `trackTerminalApplicationTitleChanges`（`:117`，默认 true）：关掉就不收 shell 标题。 */
  trackApplicationTitle?: boolean
}

/** 上游的 `isNullOrBlank`：全空白也算没有。 */
function present(value: string | undefined): string | null {
  return value === undefined || value.trim() === '' ? null : value.trim()
}

/** `TerminalTitle.kt:100-102`：截断过的 shell 标题；没有就 null。 */
export function shortenApplicationTitle(state: TerminalTitleState): string | null {
  const application = present(state.application)
  return application === null ? null : trimMiddle(application, TERMINAL_TITLE_MAX_LENGTH)
}

/** `buildTitle(ignoreAppTitle)`（`:78-86`）：标签上显示的那一条（tag 拼在括号里）。 */
export function buildTerminalTitle(state: TerminalTitleState, options: { ignoreAppTitle?: boolean } = {}): string {
  const userDefined = present(state.userDefined)
  const application = options.ignoreAppTitle === true ? null : shortenApplicationTitle(state)
  const defaultTitle = present(state.defaultTitle)
  const title = userDefined
    ?? application
    ?? defaultTitle
    ?? TERMINAL_DEFAULT_TITLE
  const tag = present(state.tag)
  return tag === null ? title : `${title} (${tag})`
}

/**
 * `buildFullTitle(ignoreAppTitle)`（`:93-98`）：同一条优先级，但 shell 标题**不截断**，
 * 并且不拼 tag（`:94-98` 的返回里没有 tag）。
 */
export function buildTerminalFullTitle(state: TerminalTitleState, options: { ignoreAppTitle?: boolean } = {}): string {
  const userDefined = present(state.userDefined)
  const application = options.ignoreAppTitle === true ? null : present(state.application)
  const defaultTitle = present(state.defaultTitle)
  return userDefined ?? application ?? defaultTitle ?? TERMINAL_DEFAULT_TITLE
}

/** `:127-131` —— `trackTerminalApplicationTitleChanges` 为假时不采纳 shell 上报的标题。 */
export function setApplicationTitle(state: TerminalTitleState, title: string): TerminalTitleState {
  if (state.trackApplicationTitle === false) return state
  return { ...state, application: title }
}

/**
 * `change {}`（`:26-41`）里「值没变就不通知」那一步：逐字段比较（上游比较的是整份 `State`）。
 * 调用方据此决定要不要重画标签/重排工具条。
 */
export function titleChanged(before: TerminalTitleState, after: TerminalTitleState): boolean {
  return before.userDefined !== after.userDefined
    || before.application !== after.application
    || before.tag !== after.tag
    || before.defaultTitle !== after.defaultTitle
    || (before.trackApplicationTitle ?? true) !== (after.trackApplicationTitle ?? true)
}

/**
 * 重命名（写 `userDefinedTitle`，`:80`/`:83` 让它压过 shell 标题）。
 * 空标题 = 取消重命名，回到 shell 标题 / 默认标题（上游 `isNullOrBlank` 同义）。
 * `limit` 是本仓重命名输入框的 `maxlength`（面板既有口径 40）。
 */
export function renameTerminal(state: TerminalTitleState, name: string, limit = 40): TerminalTitleState {
  const trimmed = name.trim().slice(0, limit)
  return { ...state, userDefined: trimmed === '' ? undefined : trimmed }
}
