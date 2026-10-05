// 终端动作的**统一上下文层**（上游 `platform/execution-impl/src/com/intellij/terminal/actions/`：
// `TerminalActionUtil` + `TerminalBaseContextAction`）。
//
// 上游这两个类解决的问题正是本仓判词里 ex/terminal-actions 缺的那一条：终端动作以前是
// 「面板内按钮 + 菜单项」，每处自己写一遍启用条件，没有一个能回答「现在有没有终端可作用」的
// 统一对象。这里把那套语义落成纯函数：
//
//   · `TerminalBaseContextAction.java:18-21` —— `update()` 把**启用与可见**一起从数据上下文
//     取：`e.getPresentation().setEnabledAndVisible(terminal != null)`，没有终端就两者都 false
//     （不是灰掉，是根本不出现）。`getTerminalWidget`（`:23-25`）读的是 `TERMINAL_DATA_KEY`，
//     所以「有没有终端」是**数据**而不是组件内部状态。
//   · `TerminalActionUtil.java:36-40` —— 登记规则：`keyStrokes` 为空**且**标了 hidden 的动作
//     直接返回 null（不登记）；
//   · `TerminalActionUtil.java:45-48` —— 非 hidden 的动作必须有模板文本，否则上游抛
//     AssertionError（`Action has unknown name`）；
//   · `TerminalActionUtil.java:49` —— 名字取不到时展示回落成 `unknown`；
//   · `TerminalActionUtil.java:68-78` —— 走 `withEnabledSupplier(() -> widget.getListener() != null)`，
//     即启用与否跟着终端有没有活着的监听器走。
//
// 本仓的等价物：`TerminalActionContext` 是那份 DataContext，`updateTerminalAction` 是那份
// `update()`，`createTerminalActions` 是那份登记表。面板（`src/components/TerminalPanel.vue`）
// 只渲染返回的结果，不再各自写 `:disabled` 表达式。
//
// 2026-10-06（桶 10b）：这张表接上了 `src/terminalSplits.ts` 与 `src/terminalFontSize.ts` 那两个
// 原先零消费方的模块 —— 分屏（右/下/取消/窗格间跳转）与字号（放大/缩小/复位）的启用条件
// 一律由那两个模块算，这张表只做登记与展示：
//   · 分屏 `TW.SplitRight` / `TW.SplitDown`（`platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:463-470`）
//     = `ToolWindowSplitActions.kt:15-31` 的 `splitWithContent(..., SwingConstants.RIGHT | BOTTOM, -1)`，
//     启用 = `toolWindow.canSplitTabs()` + 有 split provider；
//     `plugins/terminal/src/org/jetbrains/plugins/terminal/TerminalToolWindowManager.java:431-434`
//     的 `canSplit` 只是把动作可用性原样转出来，**没有任何「最多两格」的上限** ——
//     原先这张表的 `MAX_PANES_PER_GROUP = 2` 是面板自己的布局简化（两个窗格时 flex 两列刚好够排），
//     不是上游规则；布局换成 `src/terminalSplits.ts` 的网格后这条人为上限一并去掉
//     （判据 `tests/terminal-splits.test.mjs` + `tests/terminal-actions.test.mjs`）。
//   · 取消分屏 `TW.Unsplit`、窗格跳转 `TW.MoveToNextSplitter` / `TW.MoveToPreviousSplitter`
//     （同文件 `:473-478`；`$default.xml` 里这几条没有键盘绑定，所以这里也不自编键位）。
//   · 字号 `TerminalIncreaseFontSize` / `TerminalDecreaseFontSize` / `TerminalResetFontSize`
//     （`platform/execution-impl/resources/intellij.platform.execution.impl.actions.xml:34-45`，
//     `use-shortcut-of` 编辑器那三条；`$default.xml` 没给编辑器字号动作配键
//     ⇒ 这里登记成**没有键位的工具条动作**，键盘入口留给 Ctrl+滚轮那条真实存在的链路，
//     见 `src/terminalFontSize.ts` 头部的 `JBTerminalPanel.java:381-390`）。

import { canGotoTerminalPane, canTerminalSplit, canUnsplitTerminalPane, TERMINAL_SPLIT_LABELS } from './terminalSplits.ts'
import { terminalFontSizeReason } from './terminalFontSize.ts'

/** 终端动作的数据上下文（上游 `TERMINAL_DATA_KEY` 那一层）。 */
export interface TerminalActionContext {
  /** 有没有终端可作用 —— `TerminalBaseContextAction.java:20` 的 `terminal != null`。 */
  hasTerminal: boolean
  /** 选中会话的进程是否还活着（`TerminalActionUtil.java:77` 的 `getListener() != null`）。 */
  running: boolean
  /** 桌面宿主：浏览器预览开不了本地终端。 */
  desktop: boolean
  /** 正在创建/销毁会话。 */
  busy: boolean
  /** 当前标签并排了几个窗格（`TW.SplitRight` 的 canSplit 上下文；**没有上限**，见文件头）。 */
  groupSize: number
  /** 选中窗格里有没有选中的文字（上游 `editor.selectionModel.hasSelection()`，`TerminalCopyTextAction.kt:37`）。 */
  hasSelection: boolean
  /** 剪贴板历史里可列的条目数（0 ⇒ 「从历史粘贴…」整条不出现，`frontend.xml:144-147`）。 */
  historyCount: number
  /** 选中窗格当下的字号（`src/terminalFontSize.ts` 的临时缩放档）。 */
  fontSize: number
  /** 基准字号 = 设置里那一档（上游 `resetFontSize()` 的靶子）。 */
  baseFontSize: number
  /** 查找条是否开着。 */
  searchOpen: boolean
  /** 查找词非空。 */
  searchHasText: boolean
  /** 面板里一共几个窗格。 */
  paneCount: number
  /** 选中的窗格是否已退出（退出的会话才显示重启）。 */
  exited: boolean
}

/** `{ enabled, reason }`（`terminalSplits` / `terminalFontSize` 的返回）折成登记表的判定形状。 */
function gate(verdict: { enabled: boolean; reason: string }): true | { enabled: false; reason: string } {
  return verdict.enabled ? true : { enabled: false, reason: verdict.reason }
}

/** 动作的可见性类别。 */
export type TerminalActionScope =
  /** `TerminalBaseContextAction` 子类：没有终端就整个不出现。 */
  | 'context'
  /** 普通 AnAction（工具栏常驻项）：永远出现，只看自己的启用条件。 */
  | 'global'

export type TerminalActionId =
  | 'terminal.new'
  | 'terminal.split'
  | 'terminal.split.down'
  | 'terminal.unsplit'
  | 'terminal.pane.next'
  | 'terminal.pane.previous'
  | 'terminal.font.increase'
  | 'terminal.font.decrease'
  | 'terminal.font.reset'
  | 'terminal.select.all'
  | 'terminal.clear.buffer'
  | 'terminal.rename'
  | 'terminal.search'
  | 'terminal.search.next'
  | 'terminal.search.previous'
  | 'terminal.search.clear'
  | 'terminal.reap'
  | 'terminal.close'
  | 'terminal.restart'

export interface TerminalActionDefinition {
  id: TerminalActionId
  /** 模板文本（上游 `getTemplateText()`；非 hidden 动作必填）。 */
  name: string
  scope: TerminalActionScope
  /** 是否是「隐藏动作」：只有键位、没有菜单项的那种。 */
  hidden?: boolean
  /** 键位（上游 `JBTerminalSystemSettingsProviderBase.getKeyStrokesByActionId`）。 */
  keyStrokes?: readonly string[]
  /** 工具栏/菜单的说明（`TerminalActionPresentation` 之外的提示文案）。 */
  hint?: string
  /** 启用判定。返回 false 时给一句用户能看懂的原因。 */
  enabledWhen: (context: TerminalActionContext) => true | { enabled: false; reason: string }
}

const desktopOnly = { enabled: false, reason: '浏览器预览不能开本地终端，请运行桌面端。' } as const

/** 面板上真实存在的终端动作（与 `TerminalPanel.vue` 工具栏一一对应）。 */
export const TERMINAL_ACTIONS: readonly TerminalActionDefinition[] = [
  {
    id: 'terminal.new',
    name: '新建终端',
    scope: 'global',
    keyStrokes: ['Alt+F12'],
    enabledWhen: context => (context.desktop ? (context.busy ? { enabled: false, reason: '正在创建终端，请稍候。' } : true) : desktopOnly),
  },
  {
    id: 'terminal.split',
    name: TERMINAL_SPLIT_LABELS.right,
    scope: 'context',
    keyStrokes: ['Ctrl+Shift+D'],
    hint: '上游 TW.SplitRight 没有窗格数上限（TerminalToolWindowManager.java:431-434）。',
    enabledWhen: context => gate(canTerminalSplit('right', {
      desktop: context.desktop, busy: context.busy, count: context.groupSize,
    })),
  },
  {
    id: 'terminal.split.down',
    name: TERMINAL_SPLIT_LABELS.down,
    scope: 'context',
    hint: '上游 TW.SplitDown（`intellij.platform.ide.impl.actions.xml:469-472`）；`$default.xml` 没配键。',
    enabledWhen: context => gate(canTerminalSplit('down', {
      desktop: context.desktop, busy: context.busy, count: context.groupSize,
    })),
  },
  {
    id: 'terminal.unsplit',
    name: TERMINAL_SPLIT_LABELS.unsplit,
    scope: 'context',
    hint: '上游 TW.Unsplit（同文件 `:474`）：关掉当前窗格，回到同组剩下的那一个。',
    enabledWhen: context => gate(canUnsplitTerminalPane({
      desktop: context.desktop, busy: context.busy, count: context.groupSize,
    })),
  },
  {
    id: 'terminal.pane.next',
    name: TERMINAL_SPLIT_LABELS.next,
    scope: 'context',
    hint: '上游 TW.MoveToNextSplitter（`:475-476`）：格子顺序 +1 且首尾循环（InternalDecoratorImpl.kt:525-534）。',
    enabledWhen: context => gate(canGotoTerminalPane({
      desktop: context.desktop, busy: context.busy, count: context.groupSize,
    })),
  },
  {
    id: 'terminal.pane.previous',
    name: TERMINAL_SPLIT_LABELS.previous,
    scope: 'context',
    hint: '上游 TW.MoveToPreviousSplitter（`:477-478`）。',
    enabledWhen: context => gate(canGotoTerminalPane({
      desktop: context.desktop, busy: context.busy, count: context.groupSize,
    })),
  },
  {
    id: 'terminal.font.increase',
    name: '放大终端字号',
    scope: 'context',
    hint: '上游 TerminalIncreaseFontSize（`intellij.platform.execution.impl.actions.xml:34-37`）；越界保持原值。',
    enabledWhen: context => gate({ enabled: terminalFontSizeReason(context.fontSize).canIncrease, reason: `已经是最大字号（${context.fontSize}px）。` }),
  },
  {
    id: 'terminal.font.decrease',
    name: '缩小终端字号',
    scope: 'context',
    hint: '上游 TerminalDecreaseFontSize（同文件 `:38-41`）。',
    enabledWhen: context => gate({ enabled: terminalFontSizeReason(context.fontSize).canDecrease, reason: `已经是最小字号（${context.fontSize}px）。` }),
  },
  {
    id: 'terminal.font.reset',
    name: '复位终端字号',
    scope: 'context',
    hint: '上游 TerminalResetFontSize（同文件 `:42-45`）：临时缩放交回提供者，也就是设置里那一档。',
    enabledWhen: context => gate(context.fontSize === context.baseFontSize
      ? { enabled: false, reason: `字号没有缩放（${context.fontSize}px 就是设置里的基准）。` }
      : { enabled: true, reason: '' }),
  },
  {
    id: 'terminal.select.all',
    name: '全选',
    scope: 'context',
    hint: '上游 Terminal.SelectAll（`plugins/terminal/resources/META-INF/plugin.xml:137-141`，'
      + '只有 mac 键映射配了 meta A；`$default` 没配键，Ctrl+A 仍归 shell 的行首）；'
      + '右键菜单那条组在 `intellij.terminal.frontend.xml:256-273`。',
    enabledWhen: () => true,
  },
  {
    id: 'terminal.clear.buffer',
    name: '清空终端缓冲区',
    scope: 'context',
    hint: '上游 Terminal.ClearBuffer（`intellij.terminal.frontend.xml:132-135`）与它 `:266` 的菜单条目。'
      + '它的 `update()`（`TerminalClearAction.kt:27-31`）还要求「命令没在跑」，那个信号是 OSC 133 的 '
      + 'isCommandRunning —— 本仓宿主是裸 ConPTY，没有产生者（同 `src/terminalClipboard.ts` 里 CopyBlock 那条卡点），'
      + '所以这里只按「有终端就可用」，清屏本身照样是真的。',
    enabledWhen: () => true,
  },
  {
    id: 'terminal.rename',
    name: '重命名终端',
    scope: 'context',
    enabledWhen: context => (context.busy ? { enabled: false, reason: '正在创建终端，请稍候。' } : true),
  },
  {
    id: 'terminal.search',
    name: '在终端中查找',
    scope: 'context',
    keyStrokes: ['Ctrl+Shift+F'],
    enabledWhen: () => true,
  },
  {
    id: 'terminal.search.next',
    name: '查找下一个',
    scope: 'context',
    hidden: true,
    keyStrokes: ['Enter'],
    enabledWhen: context => (context.searchHasText ? true : { enabled: false, reason: '先输入要查找的内容。' }),
  },
  {
    id: 'terminal.search.previous',
    name: '查找上一个',
    scope: 'context',
    hidden: true,
    keyStrokes: ['Shift+Enter'],
    enabledWhen: context => (context.searchHasText ? true : { enabled: false, reason: '先输入要查找的内容。' }),
  },
  {
    id: 'terminal.search.clear',
    name: '清除查找',
    scope: 'context',
    hidden: true,
    keyStrokes: ['Escape'],
    enabledWhen: context => (context.searchOpen ? true : { enabled: false, reason: '查找条没有打开。' }),
  },
  {
    id: 'terminal.reap',
    name: '回收已退出的终端',
    scope: 'context',
    enabledWhen: context => {
      if (!context.desktop) return desktopOnly
      if (context.paneCount === 0) return { enabled: false, reason: '面板里没有终端。' }
      return true
    },
  },
  {
    id: 'terminal.restart',
    name: '重启终端',
    scope: 'context',
    enabledWhen: context => {
      if (!context.desktop) return desktopOnly
      if (context.busy) return { enabled: false, reason: '正在创建终端，请稍候。' }
      if (!context.exited) return { enabled: false, reason: '这个终端还在运行，不需要重启。' }
      return true
    },
  },
  {
    id: 'terminal.close',
    name: '关闭终端',
    scope: 'context',
    keyStrokes: ['Ctrl+F4'],
    enabledWhen: () => true,
  },
]

/** 登记后的一条动作：带上展示名与当下的启用结论。 */
export interface TerminalAction {
  id: TerminalActionId
  /** 展示名；取不到时回落成 `unknown`（`TerminalActionUtil.java:49` 的 `notNullize`）。 */
  name: string
  scope: TerminalActionScope
  hidden: boolean
  keyStrokes: readonly string[]
  hint?: string
  visible: boolean
  enabled: boolean
  /** 不可用时的原因（直接可以当 title/aria-label 的一部分）。 */
  reason: string
}

/**
 * 登记问题（上游对应的是 AssertionError —— 本仓不当场崩，收集起来给调用方看）。
 * `TerminalActionUtil.java:45-48` 对非 hidden 动作要求模板文本。
 */
export interface TerminalActionProblem {
  id: TerminalActionId
  message: string
}

/** 登记结果：留下能用的动作 + 指出登记不进来的那些。 */
export interface TerminalActionRegistry {
  actions: TerminalAction[]
  problems: TerminalActionProblem[]
}

function evaluate(context: TerminalActionContext, definition: TerminalActionDefinition): { enabled: boolean; reason: string } {
  const verdict = definition.enabledWhen(context)
  if (verdict === true) return { enabled: true, reason: '' }
  return { enabled: false, reason: verdict.reason }
}

/**
 * 登记表 + 一次 `update()`。
 * 规则照抄 `TerminalActionUtil.createTerminalAction`：
 *   1. `hidden` 且没有键位 ⇒ 不登记（`:36-40`）；
 *   2. 非 `hidden` 的动作必须有名字，否则记一条问题（`:45-48`）；
 *   3. 可见性按 `TerminalBaseContextAction.java:20` 的 `setEnabledAndVisible(terminal != null)`。
 */
export function createTerminalActions(
  context: TerminalActionContext,
  definitions: readonly TerminalActionDefinition[] = TERMINAL_ACTIONS,
): TerminalActionRegistry {
  const actions: TerminalAction[] = []
  const problems: TerminalActionProblem[] = []
  for (const definition of definitions) {
    const keyStrokes = definition.keyStrokes ?? []
    if (definition.hidden && keyStrokes.length === 0) continue
    const name = definition.name.trim() || 'unknown'
    if (!definition.hidden && name === 'unknown') {
      problems.push({ id: definition.id, message: `Action has unknown name: ${definition.id}` })
      continue
    }
    // TerminalBaseContextAction.java:20 —— context 动作没有终端时**可见与启用一起**为 false。
    const visible = definition.scope === 'global' ? true : context.hasTerminal
    const verdict = visible ? evaluate(context, definition) : { enabled: false, reason: '没有可作用的终端。' }
    actions.push({
      id: definition.id,
      name,
      scope: definition.scope,
      hidden: Boolean(definition.hidden),
      keyStrokes,
      hint: definition.hint,
      visible,
      enabled: verdict.enabled,
      reason: verdict.reason,
    })
  }
  return { actions, problems }
}

/** 按 id 取一条动作；没登记成功时返回 undefined（面板据此回落到自己的判断）。 */
export function terminalAction(registry: TerminalActionRegistry, id: TerminalActionId): TerminalAction | undefined {
  return registry.actions.find(action => action.id === id)
}

/** 面板按钮的 title：可用时是名字 + 键位，不可用时把原因说清楚（不给「点不动的按钮」留白）。 */
export function terminalActionTitle(action: TerminalAction | undefined, fallback: string): string {
  if (!action) return fallback
  const keys = action.keyStrokes.length ? `（${action.keyStrokes.join('、')}）` : ''
  return action.enabled ? `${action.name}${keys}` : `${action.name}：${action.reason}`
}
