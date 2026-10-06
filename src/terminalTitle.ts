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

// ---------------------------------------------------------------------------
// 标签的**行模型**：新建会话的默认名（去重）与「按设置决定要不要用 shell 标题」那一档。
//
// 上游坐标（逐个文件开过）：
//   · 新建会话时默认标题的来源 `platform/execution-impl/.../TerminalToolWindowManager.java:315-323`
//     —— `state.getDefaultTitle() == null` 时才填，填的是
//     `Objects.requireNonNullElse(terminalRunner.getDefaultTabTitle(), TerminalOptionsProvider.getInstance().getTabName())`
//     （`:317-320`）再交给 `TerminalTitleUtils.createDefaultTabName`（`:321`），最后 `state.setDefaultTitle(uniqueName)`（`:322`）。
//   · 默认名本尊 `plugins/terminal/src/org/jetbrains/plugins/terminal/TerminalOptionsProvider.kt:73` 的
//     `myTabName = defaultTabName()`，`defaultTabName()` 在 `:325` = bundle 的
//     `local.terminal.default.name`（`plugins/terminal/resources/messages/TerminalBundle.properties:96` = **`Local`**；
//     远程那一档 `:97` = `Remote`）。**上游的标签基础名不是 "Terminal"。**
//   · 去重 `plugins/terminal/src/org/jetbrains/plugins/terminal/util/TerminalTitleUtils.kt:61-88`
//     —— existing = `toolWindow.contentManager.contentsRecursively` 每条 content 的 `displayName`（`:68-70`），
//     生成走 `UniqueNameGenerator.generateUniqueName(defaultName, "", "", " (", ")", 条件)`（`:80-87`）。
//   · 编号几何 `platform/util/src/com/intellij/util/text/UniqueNameGenerator.java:102-124`
//     —— 先试原名（`:105-108`）；然后用 `Pattern.compile("(.+?)" + quote(" (") + "(\\d{1,9})")` 配 **`matches()`**
//     整串匹配（`:111-117`）⇒ 结尾那个 `)` **不在模式里**，所以 `Local (2)` 自身不算「已编号的名字」，
//     只有像 `Local (2` 这种缺右括号的才会被认出并把计数接到后面；起点是 2（`:99` 传 2，`:113`）。
//     之后 `while(true)` 逐个试 `base + " (" + index + ")"`（`:118-123`）。
//   · 设置感知 `TerminalTitleUtils.kt:37-39`（`buildSettingsAwareTitle` = `buildTitle(ignoreAppTitle = !shouldShowAppTitle(...))`）
//     与 `:50-52`（`buildSettingsAwareFullTitle` = `buildFullTitle(...)`，同一个门）；
//     `shouldShowAppTitle`（`:54-59`）= `showApplicationTitle && (mode == WHEN_COMMAND_RUNNING && isCommandRunning || mode == ALWAYS)`。
//     两个设置项的默认值：`TerminalOptionsProvider.kt:68` = `showApplicationTitle: Boolean = true`、
//     `:71` = `applicationTitleShowingMode = WHEN_COMMAND_RUNNING`；枚举两条在
//     `plugins/terminal/src/org/jetbrains/plugins/terminal/settings/TerminalApplicationTitleShowingMode.kt:8-9`。
//   · 重命名弹窗的**初值** `plugins/terminal/src/org/jetbrains/plugins/terminal/action/RenameTerminalSessionAction.kt:20-23`
//     —— `getContentDisplayNameToEdit` 返回的是 `widget.terminalTitle.buildSettingsAwareFullTitle()`，
//     **不是标签上那条截断过的文字**；提交走 `:25-29` 的 `change { userDefinedTitle = newContentName }`。
//     弹窗文案 `TerminalBundle.properties:35` = `action.RenameSession.newSessionName.label` = "Session name:"，
//     动作名 `:10` = "Rename Session"。
//
// 本仓落点：`src/components/TerminalPanel.vue` 新建窗格时用 `nextTerminalTabName` 取名、
// 重命名输入框的初值用 `terminalRenameInitialValue`、标签文字与 tooltip 用下面那两条设置感知的包装。
// 判据：tests/terminal-title.test.mjs。
// ---------------------------------------------------------------------------

/** `TerminalBundle.properties:96` 的 `local.terminal.default.name=Local`（本仓界面无中文包 ⇒ 英文原文直译）。 */
export const TERMINAL_TAB_BASE_NAME = '本地'

/** `TerminalOptionsProvider.kt:68` 的默认值。 */
export const TERMINAL_SHOW_APP_TITLE_DEFAULT = true

/** `TerminalOptionsProvider.kt:71` + `TerminalApplicationTitleShowingMode.kt:8-9` 的两档与默认值。 */
export type TerminalAppTitleMode = 'whenCommandRunning' | 'always'

export interface TerminalTitleSettings {
  /** `TerminalOptionsProvider.showApplicationTitle`。 */
  showApplicationTitle: boolean
  /** `TerminalOptionsProvider.applicationTitleShowingMode`。 */
  applicationTitleShowingMode: TerminalAppTitleMode
}

/** `TerminalTitleUtils.kt:54-59` 的 `shouldShowAppTitle`（逐条对照，四个分支都要各自成立）。 */
export function shouldShowApplicationTitle(settings: TerminalTitleSettings, isCommandRunning: boolean): boolean {
  if (!settings.showApplicationTitle) return false
  if (settings.applicationTitleShowingMode === 'always') return true
  return settings.applicationTitleShowingMode === 'whenCommandRunning' && isCommandRunning
}

/** `TerminalTitleUtils.kt:37-39`：标签上那条（截断过 shell 标题、带 tag），按设置决定是否采纳 shell 标题。 */
export function buildSettingsAwareTitle(state: TerminalTitleState, settings: TerminalTitleSettings, isCommandRunning = false): string {
  return buildTerminalTitle(state, { ignoreAppTitle: !shouldShowApplicationTitle(settings, isCommandRunning) })
}

/** `TerminalTitleUtils.kt:50-52`：tooltip 那条（不截断、不拼 tag），同一个门。 */
export function buildSettingsAwareFullTitle(state: TerminalTitleState, settings: TerminalTitleSettings, isCommandRunning = false): string {
  return buildTerminalFullTitle(state, { ignoreAppTitle: !shouldShowApplicationTitle(settings, isCommandRunning) })
}

/** `RenameTerminalSessionAction.kt:20-23`：重命名输入框里预填的就是这条全标题。 */
export function terminalRenameInitialValue(state: TerminalTitleState, settings: TerminalTitleSettings, isCommandRunning = false): string {
  return buildSettingsAwareFullTitle(state, settings, isCommandRunning)
}

/** `UniqueNameGenerator.java:111` 的那条正则：`beforeNumber` = `" ("`，`matches()` ⇒ 整串匹配（结尾的 `)` 匹配不上）。 */
const NUMBERED_TAB_NAME = /^(.+?) \((\d{1,9})$/

/**
 * `TerminalTitleUtils.kt:61-88` + `UniqueNameGenerator.java:102-124`：
 * 基础名没被占用就用基础名，否则从 **2** 起拼 `基础名 (n)`。
 * 上游的 `prefix`/`suffix` 在 `createDefaultTabName` 里都是空串（`:81-82`），所以这里不拼。
 */
export function nextTerminalTabName(baseName: string = TERMINAL_TAB_BASE_NAME, existingNames: readonly string[] = []): string {
  const taken = new Set(existingNames)
  const defaultFullName = baseName.trim()
  if (defaultFullName !== '' && !taken.has(defaultFullName)) return defaultFullName
  let base = baseName
  let index = 2
  const numbered = NUMBERED_TAB_NAME.exec(base)
  if (numbered) {
    base = numbered[1]
    index = Number(numbered[2]) + 1
  }
  for (;;) {
    const candidate = `${base} (${index})`.trim()
    if (!taken.has(candidate)) return candidate
    index += 1
  }
}
