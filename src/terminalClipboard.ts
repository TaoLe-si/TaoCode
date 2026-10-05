// 终端的**复制 / 粘贴 / 从历史粘贴**规则（上游 `IdeTerminalCopyPasteHandler` 与那三条动作的启用与键位）。
//
// 上游坐标（已核源码）：
//   · 剪贴板交接 `platform/execution-impl/src/com/intellij/terminal/IdeTerminalCopyPasteHandler.java:12-18`
//     —— 这个类只做一件事：`setSystemClipboardContents(text)` ⇒ `CopyPasteManager.setContents(new StringSelection(text))`，
//     即「终端选中的文字进系统剪贴板」。它继承 jediterm 的 `DefaultTerminalCopyPasteHandler`，
//     那个基类是 `com.jediterm` 外部依赖、**不在本棵源码树里** ⇒ 基类内部的选区/换行处理规则无法核实，
//     本仓只实现源码里能核实的这一层（选区 → 系统剪贴板、剪贴板 → 会话输入）。
//   · 挂载点 `platform/execution-impl/src/com/intellij/terminal/JBTerminalPanel.java:245-247`
//     —— `createCopyPasteHandler()` 返回 `new IdeTerminalCopyPasteHandler()`。
//   · 复制动作 `plugins/terminal/src/org/jetbrains/plugins/terminal/action/TerminalCopyTextAction.kt:29-40`
//     —— `update()`：可见 = 有终端编辑器；**可用 = `editor.selectionModel.hasSelection()`**（没选中就点不动）；
//     `:23-27` 执行 = 把选区交给 `CopyAction.copyToClipboard`。
//   · Ctrl+C 的归属 `plugins/terminal/src/org/jetbrains/plugins/terminal/action/TerminalCtrlCActionsPromoter.kt:8-18`
//     —— 注释写得很明白：Windows/Linux 上「复制」与「中断命令」是**同一个 Ctrl+C**，所以要 ActionPromoter 排序；
//     排出来的顺序是 copyText → copyBlock → clearPrompt → interrupt。前两条没选区时被 `update()` 禁用
//     （`TerminalCopyTextAction.kt:37`），于是轮到中断命令。**本仓那条链路照这条规则走**：
//     有选区 Ctrl+C 复制，没选区 Ctrl+C 原样送进 PTY（shell 收到 ^C 自己中断）。
//   · 键位 `plugins/terminal/resources/META-INF/plugin.xml:128-135` —— `Terminal.CopySelectedText`
//     在 `$default` 上是 `control C` 与 `control INSERT`（XWin 另加 `control shift C`）。
//   · 键位 `plugins/terminal/frontend/resources/intellij.terminal.frontend.xml:136-143` —— `Terminal.Paste`
//     在 `$default` 上是 `control V` 与 `shift INSERT`；`:52-57` 可见/可用只看有没有终端编辑器；
//     `:30-50` 执行：输出区且命令在跑 ⇒ 送进会话的 `terminalOutputStream`，否则送进输入行。
//   · 历史粘贴 `plugins/terminal/frontend/resources/intellij.terminal.frontend.xml:144-147`
//     —— `Terminal.PasteFromHistory`，文案 `action.Terminal.PasteFromHistory.text=Past_e from History…`、
//     `…description=Paste from recent clipboards`（`plugins/terminal/resources/messages/TerminalBundle.properties:22-23`）。
//   · 右键菜单组 `plugins/terminal/frontend/resources/intellij.terminal.frontend.xml:225-230`
//     —— `Terminal.OutputContextMenu` = CopyBlock / CopySelectedText / Paste / PasteFromHistory。
//
// 本仓落点：`src/components/TerminalPanel.vue` 的窗格右键菜单 + `attachCustomKeyEventHandler`
// 拦上游那四组键；候选清单来自 `src/clipboard.ts` 的 `readClipboardHistory()`
// （IDEA `CopyPasteManagerWithHistory.getAllContents` 的等价物）。
// 没有后端的 `Terminal.CopyBlock` **不渲染**，理由见 TERMINAL_CLIPBOARD_ACTIONS_NOT_PORTED。
// 判据：tests/terminal-clipboard.test.mjs。

/** `TerminalBundle.properties:18` 的 `action.Terminal.CopySelectedText.text`。 */
export const TERMINAL_COPY_LABEL = '复制'

/** `TerminalBundle.properties:20` 的 `action.Terminal.Paste.text`。 */
export const TERMINAL_PASTE_LABEL = '粘贴'

/** `TerminalBundle.properties:22` 的 `action.Terminal.PasteFromHistory.text`（去掉助记符下划线）。 */
export const TERMINAL_PASTE_FROM_HISTORY_LABEL = '从历史粘贴…'

/** 上游 `$default` 给复制/粘贴的那两组键位（plugin.xml:133-134、frontend.xml:141-142）。 */
export const TERMINAL_COPY_KEYS = ['Ctrl+C', 'Ctrl+Insert'] as const
export const TERMINAL_PASTE_KEYS = ['Ctrl+V', 'Shift+Insert'] as const

/** 键盘事件里要用到的那几项（便于测试传桩，也便于组件直接传 KeyboardEvent）。 */
export interface TerminalKeyLike {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
}

/** 复制/粘贴要的作用对象（上游 `update()` 里的「有终端编辑器 + 有没有选区」）。 */
export interface TerminalClipboardContext {
  /** 面板里有没有可作用的终端（上游 `terminalEditor != null`，与 `TerminalBaseContextAction.java:20` 同义）。 */
  hasTerminal: boolean
  /** 有没有选中的文字（上游 `editor.selectionModel.hasSelection()`）。 */
  hasSelection: boolean
  /** 选中窗格的进程还在跑（粘进已退出的 ConPTY 没人读 ⇒ 那是点不动的假控件）。 */
  running: boolean
  /** 剪贴板历史里可列的条目数（0 ⇒ 「从历史粘贴…」整条不出现）。 */
  historyCount?: number
}

export type TerminalClipboardActionId = 'terminal.copy' | 'terminal.paste' | 'terminal.paste.fromHistory'

export interface TerminalClipboardAction {
  id: TerminalClipboardActionId
  label: string
  keys: readonly string[]
  visible: boolean
  enabled: boolean
  /** 不可用时写给用户看的原因（右键菜单/title 直接用）。 */
  reason: string
}

/** 历史条目（`src/clipboard.ts` 的 `ClipboardEntry` 形状，这里只取需要的两项，便于测试传桩）。 */
export interface TerminalHistoryEntry {
  text: string
  /** 上游 `clipboard.history.purged.item` 那一档：文本已被占位符替换。 */
  purged?: boolean
}

/**
 * 复制：可见 = 有终端；可用 = 有选区
 * （`TerminalCopyTextAction.kt:31-39` 把 `isVisible` 与 `isEnabled` 分得很清楚 —— 本仓照分）。
 */
export function terminalCopyAction(context: TerminalClipboardContext): TerminalClipboardAction {
  const visible = context.hasTerminal
  const enabled = visible && context.hasSelection
  return {
    id: 'terminal.copy',
    label: TERMINAL_COPY_LABEL,
    keys: TERMINAL_COPY_KEYS,
    visible,
    enabled,
    reason: enabled ? '' : (visible ? '先选中要复制的文字；没有选区时 Ctrl+C 交给终端中断命令。' : '没有可作用的终端。'),
  }
}

/**
 * 粘贴：可见/可用 = 有终端（`TerminalPasteAction.kt:52-57` 的判定只看有没有终端编辑器，不看选区）。
 * 本仓额外要求进程还在跑 —— 已退出的 ConPTY 收到输入没有接收方，那才是假控件，所以如实禁用并写明原因。
 */
export function terminalPasteAction(context: TerminalClipboardContext): TerminalClipboardAction {
  const visible = context.hasTerminal
  const enabled = visible && context.running
  return {
    id: 'terminal.paste',
    label: TERMINAL_PASTE_LABEL,
    keys: TERMINAL_PASTE_KEYS,
    visible,
    enabled,
    reason: enabled ? '' : (visible ? '这个终端的进程已经退出，粘贴没有接收方；先重启终端。' : '没有可作用的终端。'),
  }
}

/** 「从历史粘贴…」：有终端**且**历史里有条目才出现（`frontend.xml:144-147`）。 */
export function terminalPasteFromHistoryAction(context: TerminalClipboardContext): TerminalClipboardAction {
  const visible = context.hasTerminal && (context.historyCount ?? 0) > 0
  const enabled = visible && context.running
  return {
    id: 'terminal.paste.fromHistory',
    label: TERMINAL_PASTE_FROM_HISTORY_LABEL,
    keys: [],
    visible,
    enabled,
    reason: enabled ? '' : (visible ? '这个终端的进程已经退出，粘贴没有接收方；先重启终端。' : '剪贴板历史里没有可粘的条目。'),
  }
}

/**
 * 右键菜单 `Terminal.OutputContextMenu`（`frontend.xml:225-230`）在本仓能落地的那几条，
 * 顺序照上游（CopySelectedText → Paste → PasteFromHistory；CopyBlock 见下面的不渲染清单）。
 */
export function terminalClipboardActions(context: TerminalClipboardContext): TerminalClipboardAction[] {
  return [terminalCopyAction(context), terminalPasteAction(context), terminalPasteFromHistoryAction(context)]
    .filter(action => action.visible)
}

/**
 * Ctrl+C 该归谁（`TerminalCtrlCActionsPromoter.kt:8-18` + `TerminalCopyTextAction.kt:37`）：
 * 有选区 ⇒ 复制；没选区 ⇒ 交回终端（中断命令）。
 */
export function terminalCopyOnCtrlC(hasSelection: boolean): boolean {
  return hasSelection
}

/**
 * 按键 → 该做哪件事（面板的 `attachCustomKeyEventHandler` 用它决定要不要吃掉这个键）。
 * 只认上游 `$default` 那几组组合键；其它一律 null（交回 xterm/PTY）。
 * `Ctrl+C` 的归属由 `terminalCopyOnCtrlC` 决定，这里只负责「这个组合键是复制的意思」。
 */
export function terminalClipboardKeyFor(event: TerminalKeyLike): 'copy' | 'paste' | null {
  const ctrl = event.ctrlKey === true || event.metaKey === true
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  if (ctrl && (key === 'c' || key === 'Insert')) return 'copy'
  if (ctrl && key === 'v') return 'paste'
  if (!ctrl && event.shiftKey === true && key === 'Insert') return 'paste'
  return null
}

/**
 * 历史子菜单列出的条目。上游列 `getAllContents()` 整张表；本仓按 `limit` 截断，
 * 并且**不列已清除的占位项**（`<已清除>` 粘进终端是有害的，不是忠实）。
 */
export function terminalHistoryEntries(entries: readonly TerminalHistoryEntry[], limit = 8): TerminalHistoryEntry[] {
  return entries.filter(entry => entry.purged !== true && entry.text !== '').slice(0, Math.max(0, limit))
}

/**
 * 登记但**不渲染**的一条，带上游坐标与具体卡点（不放假控件）。
 * 导出成常量是为了让「为什么不渲染」可被门禁核对，而不是只写在注释里。
 */
export const TERMINAL_CLIPBOARD_ACTIONS_NOT_PORTED = [
  {
    id: 'Terminal.CopyBlock',
    reason: '`plugins/terminal/resources/META-INF/plugin.xml:176-178` 登记的「复制整个命令块」。'
      + '命令块的边界来自 shell integration 上报的 OSC 133 提示符/命令序列 —— 上游那批注入脚本在'
      + ' `plugins/terminal/resources/shell-integrations/`（实测四个目录：bash / fish / powershell / zsh）。'
      + '本仓宿主是裸 ConPTY（`native/terminal.hpp` 的注释：「Bytes are carried untouched in both directions」，'
      + '起的是 `%COMSPEC%`，不注入任何 rc/profile 钩子），没有任何 OSC 133 的产生者'
      + ' ⇒ 块边界无从判定，「整块」这个对象不存在。要先补宿主侧 shell integration 才谈得上这条。',
  },
] as const
