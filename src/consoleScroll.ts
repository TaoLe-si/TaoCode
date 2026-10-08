// 运行控制台「滚动到末尾」这一族规则的唯一真源：贴底判定 + 回底目标位。
// 纯函数、DOM 无关，可在 Node 里直接测（判据 tests/console-scroll.test.mjs）。
//
// 上游（本批逐条在参考树里打开核实）：
//   · 一条工具条动作 `ScrollToTheEndToolbarAction`：建在
//     `platform/lang-impl/src/com/intellij/execution/impl/ConsoleViewImpl.kt:1360-1361`、
//     加进 `createConsoleActions()` 的动作表 `:1367`；类本体
//     `platform/platform-impl/src/com/intellij/openapi/editor/actions/ScrollToTheEndToolbarAction.java:17-39`
//     —— 它是普通 `AnAction`（**不是** ToggleAction），一次点击 = `EditorUtil.scrollToTheEnd`（`:35-39`）；
//     文案键 `platform/platform-resources-en/src/messages/ActionsBundle.properties:205`
//     `action.EditorConsoleScrollToTheEnd.text=Scroll to End`；图标 `AllIcons.RunConfigurations.Scroll_down`。
//   · 「贴底跟随输出」（stick-to-end）：`ConsoleViewImpl.kt` 的 `flushDeferredTextImpl`（`:666-668`）每次追加前算
//     `shouldStickToEnd = !myCancelStickToEnd && isStickingToEnd(editor)`；`isStickingToEnd`（`:1684-1686`）
//     = `isCaretAtTheLastLine || isVScrollAtTheBottom`；`isVScrollAtTheBottom`（`:1708-1711`）是
//     `scrollBarPosition == maximum - visibleAmount` 的**整数精确相等**；`updateStickToEndState`（`:481-487`）
//     在「已离开底部但光标还在末行」时把 `myCancelStickToEnd` 置真 ⇒ 用户往上滚就停跟。
//
// 本仓不等价的两处（如实登记，不写成等价）：
//   · 上游是 Swing 编辑器（有 caret、ScrollBar 是整数坐标）；本仓输出区是 DOM 的 `overflow:auto` 容器，
//     没有 caret 概念 ⇒ `isStickingToEnd` 的 `||` 只用「视口贴底」这一支（更稳的一档）。
//   · DOM 的 `scrollTop/scrollHeight/clientHeight` 在分数设备像素比下会带小数，上游那句精确相等在这里
//     几乎永远不成立 ⇒ 用 `CONSOLE_BOTTOM_TOLERANCE`（1px）作容差；这是本模块唯一的非上游数值，
//     理由就是子像素取整，不是自定的设计参数。
//   · 上游按钮是图标（`Scroll_down`），本仓这条控制台工具条一水儿文字按钮（暂停/栈帧/清空），故这里也用
//     文字「滚动到末尾」，与同栏一致；图标↔文字这档呈现差异如实登记。

/** 输出滚动容器的三格读数（DOM 的 `HTMLElement` 结构上即满足，组件直接把元素传进来）。 */
export interface ConsoleScrollMetrics {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

/** 贴底容差（px）：见文件头「不等价」第二条；上游 `isVScrollAtTheBottom` 用整数精确相等。 */
export const CONSOLE_BOTTOM_TOLERANCE = 1

/**
 * 视口是否贴底（上游 `ConsoleViewImpl.kt:1708-1711` 的等价物，带 1px 容差）。
 * 内容不足一屏（没有可滚动的溢出）⇒ 判「贴底」，这样首屏/短输出仍保持跟随，不会莫名停跟。
 */
export function consoleViewAtBottom(m: ConsoleScrollMetrics, tolerance = CONSOLE_BOTTOM_TOLERANCE): boolean {
  const bottom = m.scrollHeight - m.clientHeight
  if (bottom <= tolerance) return true
  return m.scrollTop >= bottom - tolerance
}

/**
 * 回到底部时该把 `scrollTop` 设成多少（上游 `EditorUtil.scrollToTheEnd` 的等价落点）。
 * 没有溢出就是 0；负数被夹到 0，绝不把容器推到非法位。
 */
export function consoleScrollToEndPosition(m: ConsoleScrollMetrics): number {
  return Math.max(0, m.scrollHeight - m.clientHeight)
}
