// 终端**输出滚动**这一族规则的唯一真源。
//
// 为什么单独一个模块：上游这四条动作（`Terminal.LineUp` / `Terminal.LineDown` /
// `Terminal.PageUp` / `Terminal.PageDown`）本来就共用一个基类与一道门 ——
// `plugins/terminal/frontend/src/com/intellij/terminal/frontend/action/TerminalScrollingActions.kt:24-35`
// 的 `TerminalScrollingAction`，四个类在同一文件 `:12` / `:14` / `:16` / `:18` 各自只是把
// handler 传进去；启用条件是同文件 `:27-29` 的一句
// `e.presentation.isEnabled = e.terminalEditor?.isOutputModelEditor == true`
// （**只 `isEnabled`，不是 `isEnabledAndVisible`** ⇒ 门挡住时条目还在，只是灰的）；
// 「怎么滚」也在同一张表里：`:41` `LineUpHandler` = `Unit.LINE, -1`、`:43` `LineDownHandler` =
// `Unit.LINE, +1`、`:37` `PageUpHandler` = `Unit.PAGE, -1`、`:39` `PageDownHandler` = `Unit.PAGE, +1`，
// 落到 `:48-51` 的 `when (unit)` 两个分支（`Unit` 本身是 `:55-58` 的那个 enum）。
// 本仓原先只有翻页两条，那道门挂在 `src/terminalActions.ts` 的 `terminalPageScrollApplies`；
// 逐行两条进来以后这一族是四条 ⇒ 门、档位、读数抽到这一个模块，四条都问**同一个**真源，
// 面板的按键派发与右键菜单的启用态也就不会再各写一遍表达式。
//
// 键位（本轮逐行打开过，别按翻页那两条的写法猜）：
//   · `Terminal.LineUp` = `plugins/terminal/frontend/resources/intellij.terminal.frontend.xml:197-200`，
//     `$default` 键位是 **control UP**（`:199`）；`Terminal.LineDown` = `:201-204`，**control DOWN**（`:203`）；
//   · `Terminal.PageUp` = 同文件 `:205-208`，**shift PAGE_UP**（`:207`）；`Terminal.PageDown` = `:209-212`，
//     **shift PAGE_DOWN**（`:211`）。两组键**不同一档**，不带 Shift 的 PageUp/PageDown 上游也不占（留给 less/man）。
//   · 文案 `plugins/terminal/resources/messages/TerminalBundle.properties:79`（`Line Up`）/
//     `:81`（`Line Down`）/ `:83`（`Page Up`）/ `:85`（`Page Down`）；这四条都写了
//     `<override-text place="GoToAction"/>`（frontend.xml `:198`/`:202`/`:206`/`:210`），
//     对应 bundle `:80`/`:82`/`:84`/`:86` 那四条「… (Terminal)」的重名覆盖（本仓没有「查找操作」那一份
//     终端动作表 ⇒ 这一档覆盖在这里没有消费方，不搬）。
//   · 右键菜单里四条纹的位置：同文件 `:256-274` 的 `Terminal.ReworkedTerminalContextMenu`
//     —— ClearBuffer(`:266`) → PageUp(`:267`) → PageDown(`:268`) → 分隔符(`:269`) → LineUp(`:270`) →
//     LineDown(`:271`) → 分隔符(`:272`)；宿主是 `.../view/impl/TerminalEditorFactory.kt:116` 的
//     `editor.contextMenuGroupId = "Terminal.ReworkedTerminalContextMenu"`。
//
// 语义（两边都按磁盘核过，不凭印象）：
//   · 上游：`TerminalOutputScrollingModel.kt:23-31` 的 `scrollByLines` 注释原文 =
//     "by the given number of whole grid lines, keeping the resting position aligned to a line boundary"、
//     "Negative lines scrolls up (towards the history)"；`:33-38` 的 `scrollByPages` =
//     "a page is the number of whole lines that fit into the viewport"。实现
//     `TerminalOutputScrollingModelImpl.kt:143-166`：`coerceIn(0, lastTopLine)` 夹两端（`:147-148`），
//     到界就是一次原地不动（`:143` 那档「越界不报错」）；`:168-172` 的 `scrollByPages` =
//     `floor(视口高 / 行高)` 行（`coerceAtLeast(1)`）再转给 `scrollByLines`。
//   · 本仓（xterm.js 5.5.0，读的是包内自带的 `src`，不是猜 lib 的行为）：
//     `src/common/CoreTerminal.ts:203-205` 的 `scrollLines` 直接转 `BufferService.scrollLines`，
//     `:207-209` 的 `scrollPages(n)` = `scrollLines(n * (rows - 1))` ⇒ **一页比上游少 1 行**（如实记）；
//     `src/common/services/BufferService.ts:140` 的
//     `buffer.ydisp = Math.max(Math.min(buffer.ydisp + disp, buffer.ybase), 0)` 就是上游那句 `coerceIn`，
//     同文件 `:143-145`「没动就直接 return」= 到顶/到底不报错也不提示；
//     `:130-137` 往上滚记 `isUserScrolling = true`、目标碰到底就复位 `false`，
//     `:94-96` 与 `:112-116`「只有没被用户往上翻过才跟着新输出走」⇒ 与上游 `:162` 的
//     `updateFollowState` 同一件事：滚起来就停跟、滚回底就恢复跟。
//
// 不等价的那一档（逐行确认过上游，本仓做不到，如实写在这儿）：
// 上游把 Ctrl+↑/↓ 这一组键按**焦点在哪个 editor** 分给三条互斥的动作 ——
// `intellij.terminal.frontend.xml:199`（LineUp，门 `isOutputModelEditor`）、
// `plugins/terminal/resources/META-INF/plugin.xml:152`（`Terminal.SelectLastBlock`，
// 门 = `.../block/prompt/TerminalBlockSelectionActions.kt:19-21` 的 `isPromptEditor`）、
// 同文件 `:163`（`Terminal.SelectBlockAbove`，门 = 同文件 `:27-30` 的 `isOutputEditor && primarySelection != null`）；
// Ctrl+↓ 同理分给 `:203`（LineDown）与 `plugin.xml:157`（`Terminal.SelectPrompt`）。
// 那三个标记是**三个各创各的 Key**（`.../block/util/TerminalDataContextUtils.kt:26`/`:27`/`:31`，
// 造 editor 的地方是 `TerminalEditorFactory.kt:48` 与 `:63`、`.../block/prompt/TerminalPromptController.kt:46`、
// `.../block/output/TerminalOutputController.kt:75`）⇒ 上游能问「现在焦点在提示符还是在输出」，
// 本仓一个窗格只有 xterm 那一层表面，**没有这个区分**（提示符/输出区的边界要 OSC 133，宿主是裸 ConPTY，
// 见 `src/components/TerminalPanel.vue` 的 `isCommandRunning` 那段与 `src/terminalClipboard.ts` 里 CopyBlock 那条卡点）。
// 本仓取的那条**能核实的**代理是「视口是否贴底」：贴底 = 正在命令行上敲（Ctrl+↑ 归 shell，
// PowerShell PSReadLine 的历史检索照常能用），已滚离底部 = 在读输出（Ctrl+↑/↓ 归这两条动作）。
// 键交回 shell 这件事上游自己也做：`TerminalEventDispatcher.kt:42-57` 的类注释写明「同一个 shortcut 的
// 动作都没启用时，由 `SendShortcutToTerminalAction` 把这个 shortcut 原样发给终端进程」，
// 实现是 `.../action/SendShortcutToTerminalAction.kt:60-80` 的 `update()`（只在同 shortcut 的动作**全部**
// 禁用时才启用自己）。⇒ 我们做的是「同一句归属规则」，但**分区依据不同**（焦点区 → 视口位置），
// 这一条差异如实登记，不写成等价。
/** 滚动单位（上游 `TerminalScrollingActions.kt:55-58` 那个 `private enum class Unit { LINE, PAGE }`）。 */
export type TerminalScrollUnit = 'line' | 'page'

/**
 * xterm 的 `IBuffer` 里这一族要读的三格（`@xterm/xterm` 5.5.0 `typings/xterm.d.ts:1465` 的
 * `readonly type: 'normal' | 'alternate'`、`:1483` 的 `viewportY`「the line within the buffer where
 * the top of the viewport is」、`:1489` 的 `baseY`「where the top of the bottom page is (when fully
 * scrolled down)」）。声明成结构类型，模块因此可以在 Node 里直接测。
 */
export interface TerminalScrollBuffer {
  type: string
  viewportY: number
  baseY: number
}

/** 能滚的那个最小面（xterm 的 `Terminal` 实例满足它；`scrollLines` 见 typings `:1179`、`scrollPages` 见 `:1185`）。 */
export interface TerminalScrollTarget {
  scrollLines(amount: number): void
  scrollPages(pageCount: number): void
}

/** 这个窗格是不是处在**备用屏**（vim / less 这类全屏程序）。上游为此另造一个 editor（`TerminalEditorFactory.kt:63`）。 */
export function terminalAlternateBuffer(buffer: TerminalScrollBuffer | null | undefined): boolean {
  return buffer?.type === 'alternate'
}

/**
 * 视口是否贴底 = `viewportY === baseY`（两格的定义见上）。
 * 没有 buffer（还没建窗格）时按「贴底」答 —— 也就是**不**抢键，让 shell 拿到 Ctrl+↑/↓。
 */
export function terminalViewportAtBottom(buffer: TerminalScrollBuffer | null | undefined): boolean {
  if (!buffer) return true
  return buffer.viewportY === buffer.baseY
}

/**
 * 四条滚动动作的共用启用门（上游 `TerminalScrollingActions.kt:27-29` 的 `isOutputModelEditor`）。
 * 备用屏在 `TerminalDataContextUtils.kt:31` 与 `:34` 是**两个各创各的 Key**，
 * `isReworkedTerminalEditor`（同文件 `:46-47`）是这两格的 `||` ⇒ 备用屏不是输出区那一格，
 * 这四条在那儿都不启用，按键交回那个全屏程序。
 */
export function terminalScrollingApplies(alternateBuffer: boolean): boolean {
  return !alternateBuffer
}

/**
 * Ctrl+↑/↓ 这两把键当下归谁（见文件头「不等价的那一档」）：
 * 备用屏里交回程序；贴底（正在敲命令）时交回 shell；只有已经滚离底部、用户在读输出时才归这两条动作。
 * 翻页那两条**没有**这第二道条件 —— 上游的 Shift+PageUp/Down 在输出区一直可用，
 * 而 xterm 的贴底再往上滚本来就会被 `BufferService.ts:140` 夹住，不会越界。
 */
export function terminalLineScrollKeyApplies(alternateBuffer: boolean, viewportAtBottom: boolean): boolean {
  return terminalScrollingApplies(alternateBuffer) && !viewportAtBottom
}

/**
 * 落地一次滚动：档位与方向的对应关系抄上游 `TerminalScrollingActions.kt:48-51`
 * （`Unit.LINE -> scrollByLines(direction)`、`Unit.PAGE -> scrollByPages(direction)`），
 * 方向取 -1（向上/历史）或 +1（向下/最新输出），夹两端由 xterm 自己做（见文件头）。
 */
export function terminalScrollBy(
  target: TerminalScrollTarget,
  unit: TerminalScrollUnit,
  direction: number,
): void {
  if (unit === 'page') target.scrollPages(direction)
  else target.scrollLines(direction)
}
