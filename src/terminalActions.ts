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
// 2026-10-06（termact 这一轮，ex/terminal-actions 里**用户可见但本仓没有**的那一条动作）：
//   · 翻页滚动终端输出 `Terminal.PageUp` / `Terminal.PageDown`
//     （`plugins/terminal/frontend/resources/intellij.terminal.frontend.xml:205-208` 与 `:209-212`：
//     `$default` 键位是 **shift PAGE_UP** / **shift PAGE_DOWN**，全树里终端插件只有这两条占着这两个键
//     —— grep `PAGE_UP|PAGE_DOWN` 在这两个 xml 里就 2 处命中）；
//     文案 `plugins/terminal/resources/messages/TerminalBundle.properties:83-86`（Page Up / Page Down）与
//     旧引擎那一份 `platform/platform-api/resources/messages/IdeBundle.properties:1977-1978`；
//     实现 `plugins/terminal/frontend/src/com/intellij/terminal/frontend/action/TerminalScrollingActions.kt:16` 与 `:18`
//     （两个动作类）→ 同文件 `:37` 与 `:39`（`PageUpHandler` = `Unit.PAGE, -1`、`PageDownHandler` = `Unit.PAGE, +1`）→
//     `TerminalOutputScrollingModel.kt:33-38`（「一页 = 视口里整行的行数，负数向上」）→
//     `TerminalOutputScrollingModelImpl.kt:143-172`（`coerceIn` 夹住两端：越界不报错、原地不动）。
//     本仓等价物是 xterm 的 `scrollPages(±1)`（内部就是 `scrollLines(±(rows-1))`，同一档「整页 + 夹住」）。
//     同两把键在平台 keymap 里归 `EditorPageUpWithSelection` / `EditorPageDownWithSelection`
//     （`platform/platform-resources/src/keymaps/$default.xml:39-40` 与 `:661-662`）—— 那是**编辑器内**的作用域，
//     与终端窗格不相干 ⇒ 本仓 `src/components/CodeEditor.vue` 的 Shift+PageUp 选择扩展不受这条影响。
//   · 启用条件 `TerminalScrollingActions.kt:27-29` —— `isEnabled = terminalEditor?.isOutputModelEditor == true`。
//     这一档在 `TerminalDataContextUtils.kt:42-47` 里是**单独的一格**（同文件 `:44` 另有
//     `isAlternateBufferModelEditor`，`isReworkedTerminalEditor` 就是这两格的 `||`）⇒ 备用屏（vim / less 那类
//     全屏程序）不是输出那一格，这两条在那儿**不启用**，键位交回那个程序。本仓的映射：`alternateBuffer`
//     为真时整条置灰，且面板把那两次按键原样放行（门在 `src/terminalScrolling.ts` 的
//     `terminalScrollingApplies`；留痕：teampage 这一轮之前它叫 `terminalPageScrollApplies`、挂在本文件，
//     逐行两条进来以后它是四条共用的，就搬出去了）。
//   · 右键菜单里它们的位置：同文件 `:256-274` 的 `Terminal.ReworkedTerminalContextMenu`
//     把 `Terminal.ClearBuffer`(:266) → `Terminal.PageUp`(:267) → `Terminal.PageDown`(:268) 排在一起
//     （宿主是 `TerminalEditorFactory.kt:116` 的 `contextMenuGroupId`）⇒ 本仓那三条菜单项同序。
//   · ~~`Terminal.LineUp` / `Terminal.LineDown`（同文件 `:197-204`，键位 control UP / control DOWN）**没跟着做**~~
//     —— 留痕订正（2026-10-06 teampage 这一轮）：这一句在本批**已作废**，两条已落地（见下面那一段）。
//     当时给的拦路理由仍然成立，只是本批找到了能核实的那条代理：那两把键在上游还被
//     `Terminal.SelectLastBlock` / `Terminal.SelectPrompt`（plugin.xml，提示符区那两条）按
//     「光标在提示符里 / 在输出里」分给不同的动作，而本仓一个窗格只有一层表面，分不出这个区。
//
// 2026-10-06（teampage 这一轮，termact 明确留给下一批的那两条）：
//   · 逐行滚动 `Terminal.LineUp` / `Terminal.LineDown`
//     （`plugins/terminal/frontend/resources/intellij.terminal.frontend.xml:197-200` 与 `:201-204`：
//     `$default` 键位是 **control UP**（`:199`）/ **control DOWN**（`:203`）—— 跟翻页那两条**不是一档键**，
//     翻页是 shift PAGE_UP/PAGE_DOWN（`:207`/`:211`），这里没有 Shift；
//     文案 `plugins/terminal/resources/messages/TerminalBundle.properties:79`（Line Up）与 `:81`（Line Down））。
//     实现与翻页四条共用同一个基类与**同一道门**（`TerminalScrollingActions.kt:12`/`:14` 两个类、
//     `:41`/`:43` 的 `LineUpHandler`/`LineDownHandler` = `Unit.LINE, ∓1`、`:48-49` 的
//     `Unit.LINE -> scrollingModel.scrollByLines(direction)`、门在同一文件 `:27-29`）
//     ⇒ 本仓的门与档位一律走 `src/terminalScrolling.ts`（那四条动作现在都问那一个真源）。
//     菜单里多一段：`intellij.terminal.frontend.xml:269-271` 在 PageDown 之后**另起一段**放 LineUp/LineDown
//     （前面翻页那两条紧跟 ClearBuffer，`:266-268`）⇒ 本仓菜单同序，且中间隔一条分隔符。
//     与翻页唯一不一样的地方是**按键归属**：Ctrl+↑ 贴着命令行时属于 shell（PSReadLine 的历史检索），
//     上游靠「焦点在提示符还是在输出」区分（本仓没有那一格，OSC 133 无产生者），改用
//     「视口是否贴底」这条能核实的代理 ⇒ 贴底不抢键、滚离底部才接手（`terminalLineScrollKeyApplies`）。
//     上游把同一件事交给 `SendShortcutToTerminalAction`（`.../action/SendShortcutToTerminalAction.kt:60-80`
//     的 `update()`：同 shortcut 的动作全部禁用时才启用自己，把键原样发给终端；类注释
//     `.../view/impl/TerminalEventDispatcher.kt:42-57`），所以「动作没启用 ⇒ 键归 shell」这条**不是**本仓的发明。
//   · `Terminal.SwitchFocusToEditor`（`plugins/terminal/resources/META-INF/plugin.xml:127`，
//     类 `plugins/terminal/src/org/jetbrains/plugins/terminal/action/TerminalMoveFocusToEditorAction.kt:15-26`：
//     `actionPerformed` 就一句 `ToolWindowManager...activateEditorComponent()`（`:18`），
//     `update()`（`:21-25`）是 `isEnabledAndVisible = project != null && isReworkedTerminalEditor && TOOL_WINDOW != null`
//     —— 注意这里用的是 `isReworkedTerminalEditor`（`TerminalDataContextUtils.kt:46-47` = 输出区 `||` 备用屏），
//     **比滚动那四条的门宽一档**：备用屏里这条仍然启用）。文案 `TerminalBundle.properties:6`
//     （`Switch Focus To Editor`）。
//     **上游默认没有键**：`:127` 那一行没有 `<keyboard-shortcut>`，全树 `--include=*.xml` 的 grep 里
//     `Terminal.SwitchFocusToEditor` 只命中这一条注册行（键表 `$default.xml` 也没有它）；
//     键是用户在设置里给的 —— `.../settings/TerminalOptionsConfigurable.kt:401-405` 那一行
//     `actionShortcutComboboxWithEnabledCheckbox(labelText = "settings.move.focus.to.editor.with",
//     presets = listOf(ESCAPE_SHORTCUT_PRESET), actionId = "Terminal.SwitchFocusToEditor")`，
//     预设就是 Escape（同文件 `:869-872`），而那个勾选框的初值 = 「当前键表里有没有这条键」
//     （同文件 `:778-787` 的 `initialCheckboxState = curShortcuts.isNotEmpty()`）⇒ 默认**不勾**。
//     上游还为这件事专门弹一条通知：`platform/execution-impl/src/com/intellij/terminal/TerminalEscapeKeyListener.java:42-60`
//     在终端工具窗里「只有匹配上那条 shortcut 才交回编辑器」（`:51-53`），配合
//     `.../frontend/action/TerminalEscapeAction.kt:163-173` 里那句原文注释
//     "In alternate mode, escape action should be sent to the terminal process, so disable the action in this case"
//     ⇒ 备用屏里绝不抢 Esc。本仓同一档：新设置键 `moveFocusToEditorWithEscape` **缺省 false**（与上游默认一致），
//     开着以后 Esc 才走这条动作，且 `focusActiveEditor()` 真的把焦点交出去了才吃掉按键，否则原样给 shell。

//
// 本仓的等价物：`TerminalActionContext` 是那份 DataContext，`createTerminalActions` 里那一次
// `enabledWhen` 求值是那份 `update()`，`TERMINAL_ACTIONS` 是那份登记表。面板（`src/components/TerminalPanel.vue`）
// 只渲染返回的结果，不再各自写 `:disabled` 表达式。
// （留痕订正：这句原先写作 `updateTerminalAction`，全仓没有这个函数 —— 求值入口是 `createTerminalActions`。）
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
//
// 2026-10-06（term3 这一轮，ex/terminal-actions 的「可用性判定」补全 + 键位如实）：
//   · 新增标签左右移动两条 `Terminal.MoveToolWindowTabLeft` / `Terminal.MoveToolWindowTabRight`
//     （`plugins/terminal/resources/META-INF/plugin.xml:125-126`）。启用规则是
//     `plugins/terminal/src/org/jetbrains/plugins/terminal/action/MoveTerminalToolwindowTabLeftRightAction.kt:21-32`
//     —— 可见 = 有项目 + 是终端工具窗 + **选中了某个 content**；
//     启用 = `isAvailable`：向左要求 `index > 0`（`:31`），向右要求 `index >= 0 && index < contentCount - 1`（`:31`）。
//     文案取 `platform/platform-api/resources/messages/IdeBundle.properties:1983`（`Move Right`）与
//     `:1984`（`Move Left`），本仓无中文包 ⇒ 英文原文直译（「向右移动标签」/「向左移动标签」）。
//     `plugin.xml:125-126` 这两条**没有** `<keyboard-shortcut>`，`$default.xml` 里也没有它们的绑定
//     ⇒ 登记成没有键位的条目（`JBTerminalSystemSettingsProviderBase.java:203-211` 只是把键位转给 jediterm）。
//   · 三条键位如实（原先这张表里钉的是本仓/上游都没有的键）：
//     `terminal.new` 原写 `Alt+F12`、实际 `Alt+F12` 是 `ActivateTerminalToolWindow`
//     （`platform/platform-resources/src/keymaps/$default.xml:368-369`，本仓的实装在 `src/keymap.ts:338`），
//     上游「新建一个终端标签」是 `Terminal.NewTab` = **Ctrl+Shift+T**
//     （`plugins/terminal/frontend/resources/intellij.terminal.frontend.xml:242-243`）；
//     `terminal.search` 原写 `Ctrl+Shift+F`、实际 `Terminal.Find` 是 `use-shortcut-of="Find"`
//     （同文件 `:158`）而 `Find` 在 `$default.xml:565-566` 配的是 **Ctrl+F**；
//     `terminal.split` 原写 `Ctrl+Shift+D`、实际 `TW.SplitRight` 只是 `use-shortcut-of="SplitVertically"`
//     （`platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:463-466`），
//     而 `SplitVertically` 在 `$default.xml` 里**没有任何键**（grep 无命中）⇒ 这条不再有键位。
//     上面三个键本仓都由面板自己实现（`terminalActionKeyFor`），所以展示出来的键是真的按得动的；
//     全局那一份要挂在 `src/keymap.ts`（保留文件）⇒ 写进 docs/wiring-requests-2026-10-06-term3.md。

import { canGotoTerminalPane, canTerminalSplit, canUnsplitTerminalPane, TERMINAL_SPLIT_LABELS } from './terminalSplits.ts'
import { terminalFontSizeReason } from './terminalFontSize.ts'
import { terminalScrollingApplies } from './terminalScrolling.ts'

/** 一条键位按下后该走哪个终端动作（`terminalActionKeyFor` 的结果）。 */
export type TerminalActionKey = 'search' | 'newTab' | 'pageUp' | 'pageDown' | 'lineUp' | 'lineDown' | 'focusEditor'

/**
 * 终端窗口里按下的键该被面板吃掉哪几条。
 *
 * 上游这几条都是**终端自己的**快捷键（由 jediterm 的 `TerminalActionWrapper`/keymap 派发，
 * `TerminalActionWrapper.kt:27-30` 把 `presentation.keyStrokes` 直接转成 `CustomShortcutSet`）：
 *   · `Terminal.Find` = `use-shortcut-of="Find"`（`intellij.terminal.frontend.xml:158`），
 *     `Find` 在 `$default.xml:565-566` 是 `control F` ⇒ **Ctrl+F 开查找条**；
 *   · `Terminal.NewTab` = `control shift T`（`intellij.terminal.frontend.xml:242-243`）⇒ **Ctrl+Shift+T 新建标签**；
 *   · `Terminal.PageUp` = `shift PAGE_UP`（同文件 `:205-208`）、`Terminal.PageDown` = `shift PAGE_DOWN`
 *     （`:209-212`）⇒ **Shift+PageUp / Shift+PageDown 滚一整页输出**。
 *     这两把键在终端插件的 xml 里只被这两条动作占着（grep `PAGE_UP|PAGE_DOWN` 只有 2 处命中），
 *     不带 Shift 的 PageUp/PageDown **不在**这份表里 —— 那是留给 `less` / `man` 这类程序吃的。
 *   · `Terminal.LineUp` = `control UP`（同文件 `:197-200` 里的 `:199`）、`Terminal.LineDown` = `control DOWN`
 *     （`:201-204` 里的 `:203`）⇒ **Ctrl+↑ / Ctrl+↓ 滚一行输出**。这两把键**带 Ctrl 不带 Shift**，
 *     跟翻页那两条不是一档；裸 ↑/↓ 一律不拦（那是 shell 的命令历史）。面板抢不抢这两把键还要问
 *     `terminalLineScrollKeyApplies`（贴底时归 shell），所以这里只回答「这一下按的是哪条动作」；
 *   · `Terminal.SwitchFocusToEditor` = **Escape**，但**只在设置开着的时候**（上游默认无键，
 *     见文件头那一段与 `TerminalOptionsConfigurable.kt:401-405`/`:778-787`/`:869-872`）⇒
 *     只有 `options.moveFocusToEditorWithEscape` 为真才认这把键。
 * 只认 keydown：keyup 再触发一次会开出两个查找条/两个会话、或多滚一页/一行、或多回一次焦点。
 */
export function terminalActionKeyFor(
  event: { type: string; code?: string; key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean },
  options?: { moveFocusToEditorWithEscape?: boolean },
): TerminalActionKey | null {
  if (event.type !== 'keydown') return null
  if (event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'f') return 'search'
  if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && (event.code === 'KeyT' || event.key.toLowerCase() === 't')) return 'newTab'
  if (event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'pageup') return 'pageUp'
  if (event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'pagedown') return 'pageDown'
  if (event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && event.key === 'ArrowUp') return 'lineUp'
  if (event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && event.key === 'ArrowDown') return 'lineDown'
  if (options?.moveFocusToEditorWithEscape === true && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey
    && (event.code === 'Escape' || event.key === 'Escape')) return 'focusEditor'
  return null
}


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
  /**
   * 选中的窗格是否处在**备用屏**（alternate buffer，vim / less 这类全屏程序）。
   * 上游那一条门是 `TerminalScrollingActions.kt:27-29` 的 `isOutputModelEditor`（滚动那**四条**共用它，
   * 门与档位都在 `src/terminalScrolling.ts`），而备用屏在
   * `TerminalDataContextUtils.kt:44` 里是**另一格**（`:31` 的 `IS_OUTPUT_MODEL_EDITOR_KEY` 与
   * `:34` 的 `IS_ALTERNATE_BUFFER_MODEL_EDITOR_KEY` 是两个各创各的 Key）⇒ 备用屏里翻页两条不启用。
   * 本仓读的是 xterm 的 `buffer.active.type === 'alternate'`（`@xterm/xterm` typings 的 `BufferType`）。
   */
  alternateBuffer: boolean
  /**
   * 设置里那一格「Move focus to the Editor with: Escape」有没有勾上
   * （上游 `TerminalOptionsConfigurable.kt:401-405` + `:778-787`，**默认没勾** ⇒ 本仓缺省 false）。
   * 它决定的是 Esc **这把键归谁**，不是动作本身可不可用（上游 `TerminalMoveFocusToEditorAction.kt:21-25`
   * 的 `update()` 也只看 project / editor / TOOL_WINDOW 三格）；本仓把它并进 `enabledWhen` 是因为
   * 这张表的用途就是回答「用户现在点得动吗、按得到吗」，键没绑上时这条动作在本仓按不到。
   */
  moveFocusToEditorWithEscape: boolean
  /** 当下有没有「真的在显示」的那个编辑器可以接焦点（`src/editorFocus.ts` 的那一组选择器）。 */
  editorVisible: boolean

  /** 选中的标签在整排标签里的下标（`MoveTerminalToolwindowTabLeftRightAction.kt:30` 的 `getIndexOfContent`）。 */
  tabIndex: number
  /** 标签总数（同文件 `:31` 的 `manager.contentCount`）。 */
  tabCount: number
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
  | 'terminal.page.up'
  | 'terminal.page.down'
  | 'terminal.line.up'
  | 'terminal.line.down'
  | 'terminal.focus.editor'
  | 'terminal.rename'
  | 'terminal.tab.left'
  | 'terminal.tab.right'
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

const alternateBufferReason = { enabled: false, reason: '这个终端在全屏程序里（备用屏），翻页交回该程序。' } as const

const lineAlternateBufferReason = { enabled: false, reason: '这个终端在全屏程序里（备用屏），逐行滚动交回该程序。' } as const

const focusEditorShortcutOffReason = {
  enabled: false,
  reason: '上游这条默认没有键：要在设置里勾「Move focus to the Editor with: Escape」才交得出焦点。',
} as const

const noEditorReason = { enabled: false, reason: '当下没有可见的编辑器可以接焦点。' } as const

/**
 * 滚动那四条动作的门与档位都不在这里了 —— 抽到 `src/terminalScrolling.ts`
 * （`terminalScrollingApplies` = 上游 `TerminalScrollingActions.kt:27-29` 那句
 * `isEnabled = terminalEditor?.isOutputModelEditor == true`；原先挂在本文件的
 * `terminalPageScrollApplies` 就是这个函数，逐行两条进来以后它是四条共用的了）。
 * 本文件只做登记与展示：面板的按键派发（`TerminalPanel.vue` 的 attachCustomKeyEventHandler）
 * 与下面这几条 `enabledWhen` 问的都是**同一个**真源，不会出现「菜单里是灰的、键却把事件吃掉」。
 */

/** 面板上真实存在的终端动作（与 `TerminalPanel.vue` 工具栏一一对应）。 */
export const TERMINAL_ACTIONS: readonly TerminalActionDefinition[] = [
  {
    id: 'terminal.new',
    name: '新建终端',
    scope: 'global',
    // 上游 Terminal.NewTab 的键（intellij.terminal.frontend.xml:242-243）；Alt+F12 是
    // ActivateTerminalToolWindow（$default.xml:368-369），那一档在 src/keymap.ts:338，不在这条动作上。
    keyStrokes: ['Ctrl+Shift+T'],
    enabledWhen: context => (context.desktop ? (context.busy ? { enabled: false, reason: '正在创建终端，请稍候。' } : true) : desktopOnly),
  },
  {
    id: 'terminal.split',
    name: TERMINAL_SPLIT_LABELS.right,
    scope: 'context',
    // TW.SplitRight 只是 use-shortcut-of="SplitVertically"（intellij.platform.ide.impl.actions.xml:463-466），
    // 而 $default.xml 里没有 SplitVertically 的任何绑定 ⇒ 这条不写键位（原先钉的 Ctrl+Shift+D 上游与本仓都不存在）。
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
    id: 'terminal.page.up',
    name: '向上翻页',
    scope: 'context',
    keyStrokes: ['Shift+PageUp'],
    hint: '上游 Terminal.PageUp（intellij.terminal.frontend.xml:205-208 的 shift PAGE_UP，'
      + 'TerminalBundle.properties:83 = Page Up）：一页 = 视口里整行的行数、负数向上'
      + '（TerminalOutputScrollingModel.kt:33-38），两端夹住不再动（Impl.kt:143-172 的 coerceIn）⇒ 本仓用 xterm 的 scrollPages(-1)。'
      + '备用屏里不启用（TerminalScrollingActions.kt:27-29 的 isOutputModelEditor）。',
    enabledWhen: context => (terminalScrollingApplies(context.alternateBuffer) ? true : alternateBufferReason),
  },
  {
    id: 'terminal.page.down',
    name: '向下翻页',
    scope: 'context',
    keyStrokes: ['Shift+PageDown'],
    hint: '上游 Terminal.PageDown（同文件 `:209-212` 的 shift PAGE_DOWN，`TerminalBundle.properties:85` = Page Down）：'
      + '与上一条成对，正数向下。右键菜单里这两条紧跟 Terminal.ClearBuffer'
      + '（`intellij.terminal.frontend.xml:266-268`，宿主 `TerminalEditorFactory.kt:116`）。',
    enabledWhen: context => (terminalScrollingApplies(context.alternateBuffer) ? true : alternateBufferReason),
  },
  {
    // 逐行两条与翻页两条共用上游那一个基类那一道门（`TerminalScrollingActions.kt:24-35`），
    // 差别只在档位（`:48-49` 的 `Unit.LINE -> scrollByLines`）与**键位**（control UP/DOWN，不是 shift PAGE_*）。
    id: 'terminal.line.up',
    name: '向上滚动一行',
    scope: 'context',
    keyStrokes: ['Ctrl+↑'],
    hint: '上游 Terminal.LineUp（intellij.terminal.frontend.xml:197-200 的 control UP，'
      + 'TerminalBundle.properties:79 = Line Up）：整行对齐、负数向历史（TerminalOutputScrollingModel.kt:23-31），'
      + '两端夹住（Impl.kt:143-166）⇒ 本仓用 xterm 的 scrollLines(-1)。备用屏里不启用；'
      + '贴底（正在敲命令）时这把键交回 shell —— 见 terminalLineScrollKeyApplies。'
      + '菜单里它在 PageDown 之后另起一段（frontend.xml:269-271）。',
    enabledWhen: context => (terminalScrollingApplies(context.alternateBuffer) ? true : lineAlternateBufferReason),
  },
  {
    id: 'terminal.line.down',
    name: '向下滚动一行',
    scope: 'context',
    keyStrokes: ['Ctrl+↓'],
    hint: '上游 Terminal.LineDown（同文件 `:201-204` 的 control DOWN，`TerminalBundle.properties:81` = Line Down）：'
      + '与上一条成对，正数向最新输出；`Terminal.ScrollingAction` 那道门一样（`:27-29`）。'
      + '裸 ↓ 在上游是 `Terminal.SelectBlockBelow`（plugin.xml:167-169），本仓不拦。',
    enabledWhen: context => (terminalScrollingApplies(context.alternateBuffer) ? true : lineAlternateBufferReason),
  },
  {
    // 上游这条**没有菜单条目**（全树 grep 只有 plugin.xml:127 那一条注册行，`Terminal.ReworkedTerminalContextMenu`
    // frontend.xml:256-274 里也没有它）⇒ 本仓不往右键菜单里摆，只做键上那一路。
    id: 'terminal.focus.editor',
    name: '把焦点切回编辑器',
    scope: 'context',
    hidden: true,
    keyStrokes: ['Escape'],
    hint: '上游 Terminal.SwitchFocusToEditor（plugin.xml:127，TerminalBundle.properties:6 = Switch Focus To Editor）'
      + '= TerminalMoveFocusToEditorAction.kt:18 的 activateEditorComponent()，本仓落点是 src/editorFocus.ts 的 focusActiveEditor()。'
      + '启用门同文件 `:21-25` 用的是 isReworkedTerminalEditor（备用屏里也启用，比滚动那四条宽一档）；'
      + '默认**无键**（TerminalOptionsConfigurable.kt:778-787 的勾 = 当前键表有没有它），勾上以后预设是 Escape（:869-872）。',
    enabledWhen: context => (!context.moveFocusToEditorWithEscape ? focusEditorShortcutOffReason
      : (context.editorVisible ? true : noEditorReason)),
  },
  {
    id: 'terminal.rename',
    name: '重命名终端',
    scope: 'context',
    enabledWhen: context => (context.busy ? { enabled: false, reason: '正在创建终端，请稍候。' } : true),
  },
  {
    id: 'terminal.tab.left',
    name: '向左移动标签',
    scope: 'context',
    hint: '上游 Terminal.MoveToolWindowTabLeft（plugin.xml:125）；启用 = getIndexOfContent > 0'
      + '（MoveTerminalToolwindowTabLeftRightAction.kt:28-32）。plugin.xml:125-126 与 $default.xml 都没有给它配键。',
    // MoveTerminalToolwindowTabLeftRightAction.kt:31 —— `moveLeft` 时 `ind > 0`。
    enabledWhen: context => (context.tabIndex > 0 ? true : { enabled: false, reason: '这个标签已经在最左边，左边没有标签可换。' }),
  },
  {
    id: 'terminal.tab.right',
    name: '向右移动标签',
    scope: 'context',
    hint: '上游 Terminal.MoveToolWindowTabRight（plugin.xml:126）；启用 = ind < contentCount - 1（同文件 :31）。',
    enabledWhen: context => (context.tabIndex >= 0 && context.tabIndex < context.tabCount - 1
      ? true : { enabled: false, reason: '这个标签已经在最右边，右边没有标签可换。' }),
  },
  {
    id: 'terminal.search',
    name: '在终端中查找',
    scope: 'context',
    // Terminal.Find 是 use-shortcut-of="Find"（intellij.terminal.frontend.xml:158），
    // Find 在 $default.xml:565-566 配的是 control F ⇒ 面板按 Ctrl+F 开查找条。
    keyStrokes: ['Ctrl+F'],
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
