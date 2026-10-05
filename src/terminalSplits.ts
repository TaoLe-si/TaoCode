// 终端窗格的**分屏模型**（上游工具窗口分屏那一族；终端只是它的调用方）。
//
// 上游坐标（已核源码）：
//   · 终端侧的动作 `plugins/terminal/src/org/jetbrains/plugins/terminal/action/TerminalSplitAction.kt:12-35`
//     —— 一个类同时管两个方向：`create(vertically, listener)`，
//     文案 = `ActionsBundle` 的 `action.SplitVertically.text` / `action.SplitHorizontally.text`
//     （`platform/platform-resources-en/src/messages/ActionsBundle.properties:1257` = "Split Right"、
//     `:1261` = "Split Down"；同义名在 `:1259`/`:1263` = "Split Vertically"/"Split Horizontally"）；
//     键位取 `TW.SplitRight` / `TW.SplitDown`（`:31-32`）；
//     `isEnabled` = `listener.canSplit(vertically)`（`:20-22`），`actionPerformed` = `listener.split(vertically)`（`:15-18`）。
//   · `canSplit/split` 的实现 `plugins/terminal/src/org/jetbrains/plugins/terminal/TerminalToolWindowManager.java:430-439`
//     —— 就是「`TW.SplitRight`/`TW.SplitDown` 这条动作当前可用吗 / 执行它」，**没有任何"最多两个"的上限**。
//   · 动作登记 `platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:463-472`
//     —— `TW.SplitRight`（`:463-466`，`use-shortcut-of="SplitVertically"`，图标 SplitVertically）、
//     `TW.SplitDown`（`:469-472`，`use-shortcut-of="SplitHorizontally"`）、`TW.Unsplit`（`:474`，
//     `use-shortcut-of="Unsplit"`）、`TW.MoveToNextSplitter` / `TW.MoveToPreviousSplitter`（`:475-478`，
//     `use-shortcut-of="NextSplitter"`/`"PrevSplitter"`；文案 `ActionsBundle.properties:1285` =
//     "Go to Next Splitter"、`:1287` = "Go to Previous Splitter"）。
//     `$default.xml` 里这几条**没有**键盘绑定（grep 无命中），所以本仓不自己编键位，只做菜单/工具条条目。
//   · 真正干活的地方 `platform/platform-impl/src/com/intellij/ide/actions/ToolWindowSplitActions.kt:15-31`
//     —— `splitWithContent(新建的内容副本, SwingConstants.RIGHT 或 BOTTOM, -1)`；
//     启用 = `toolWindow.canSplitTabs()` **且** 该工具窗口注册了 split provider（`:24-27`）。
//   · 格子的形成 `platform/platform-impl/src/com/intellij/toolWindow/InternalDecoratorImpl.kt:376-410`
//     —— `splitWithContent` 造两个 decorator、按 `dropSide` 把内容分到两边、
//     `dropSide` 是 TOP/BOTTOM 时整块 `Mode.VERTICAL_SPLIT`，LEFT/RIGHT 时 `Mode.HORIZONTAL_SPLIT`。
//     每个格子自己还能再分（`raise` `:413+` 管嵌套的还原），所以**窗格数不止两个**。
//   · 窗格间跳转 `platform/platform-impl/src/com/intellij/toolWindow/InternalDecoratorImpl.kt:516-534`
//     —— `getNextPrevCellImpl`：不在分屏态直接 null；把 `getOrderedCells()` 展平后按顺序 +1/-1，
//     `(newIndex + cells.size) % cells.size` ⇒ **首尾循环**；
//     动作侧的启用判定 `ToolWindowMoveToSplitterActions.kt:24-29`（`topDecorator?.mode?.isSplit == true`）。
//
// 本仓落点（2026-10-06 已接上，判据 tests/terminal-splits.test.mjs 的「消费链」那条）：
// `src/components/TerminalPanel.vue` 的窗格容器按 `terminalGridSize(rights, downs)` 排成 CSS 网格，
// 新格子的落点问 `paneIndexAfterSplit`，跳转问 `nextTerminalPaneCell`，三处启用分别问
// `canTerminalSplit` / `canUnsplitTerminalPane` / `canGotoTerminalPane`；
// `src/terminalActions.ts` 那十二动作表里新增的 split/unsplit/goto 三条也走这三个门
// （上游是嵌套 JSplitPane，本仓是网格 —— 架构不等价，取的是同一件用户可见的事：
// 右侧/下侧各开一格、窗格数不限、可在窗格间来回跳、可取消分屏）。
// 原先面板写死的「每个标签最多两个」（terminalActions 里的 MAX_PANES_PER_GROUP）已删除，
// 依据是 `TerminalToolWindowManager.java:431-434` 的 `canSplit` 只转动作可用性。
// 判据：tests/terminal-splits.test.mjs + tests/terminal-actions.test.mjs。

/** 分屏方向：`true` = 右侧（`TW.SplitRight`），`false` = 下侧（`TW.SplitDown`）。 */
export type TerminalSplitOrientation = 'right' | 'down'

/** 一个窗格在分屏树里的位置（上游的一个 decorator cell）。 */
export interface TerminalPaneCell {
  id: number
  /** 同一组（同一个标签）里的窗格共用 origin。 */
  origin: number
}

export interface TerminalSplitOptions {
  /** 宿主可用（浏览器预览不能起终端 ⇒ 分屏也不能出现）。 */
  desktop: boolean
  /** 正在创建/销毁窗格时让路（本仓既有口径，与 `terminal.split` 的既有理由一致）。 */
  busy: boolean
  /** 当前组里的窗格数。 */
  count: number
}

/** 文案：上游 `ActionsBundle.properties:1257/1261/1281/1285/1287`（去掉助记符下划线）。 */
export const TERMINAL_SPLIT_LABELS = {
  right: '右侧分屏',
  down: '下侧分屏',
  unsplit: '取消分屏',
  next: '跳到下一个窗格',
  previous: '跳到上一个窗格',
} as const

/**
 * `ToolWindowSplitActions.kt:24-27` 的启用判定 + 本仓的宿主前提：
 * 上游只要求「这个工具窗口可以分屏」，**没有窗格数上限**（`TerminalToolWindowManager.java:430-434`
 * 的 `canSplit` 就是把动作可用性原样转出来）。本仓的宿主能力（浏览器预览起不了终端、
 * 正在创建时让路）是真实的额外条件，写进 reason。
 */
export function canTerminalSplit(orientation: TerminalSplitOrientation, options: TerminalSplitOptions): { enabled: boolean; reason: string } {
  if (!options.desktop) return { enabled: false, reason: '浏览器预览不能开本地终端，请运行桌面端。' }
  if (options.busy) return { enabled: false, reason: '正在创建终端，请稍候。' }
  void orientation
  return { enabled: true, reason: '' }
}

/**
 * 「跳到下一个 / 上一个窗格」的启用（`ToolWindowMoveToSplitterActions.kt:24-29` 的
 * `mode.isSplit` —— 本仓等价物：当前组多于一个窗格）。
 */
export function canGotoTerminalPane(options: TerminalSplitOptions): { enabled: boolean; reason: string } {
  if (!options.desktop) return { enabled: false, reason: '浏览器预览不能开本地终端，请运行桌面端。' }
  if (options.count <= 1) return { enabled: false, reason: '这个标签没有分屏，只有一个窗格。' }
  return { enabled: true, reason: '' }
}

/** 「取消分屏」（`TW.Unsplit`）：关掉当前窗格，回到组里剩下的那一个；只剩一个就没有可取消的分屏。 */
export function canUnsplitTerminalPane(options: TerminalSplitOptions): { enabled: boolean; reason: string } {
  if (!options.desktop) return { enabled: false, reason: '浏览器预览不能开本地终端，请运行桌面端。' }
  if (options.count <= 1) return { enabled: false, reason: '这个标签没有分屏，不需要取消。' }
  return { enabled: true, reason: '' }
}

/**
 * `getNextPrevCellImpl`（`InternalDecoratorImpl.kt:525-534`）：顺序表 + 首尾循环。
 * 不在分屏态（一个窗格）时返回 null（上游 `if (!mode.isSplit) return null`）。
 */
export function nextTerminalPaneCell<T>(cells: readonly T[], current: T | null, forward: boolean): T | null {
  if (cells.length <= 1) return null
  const index = current === null ? -1 : cells.indexOf(current)
  // 上游找不到当前格时返回 null；本仓把 -1 当作「从头开始」，因为面板可能在换标签后被跳。
  const from = index === -1 ? (forward ? -1 : 0) : index
  const next = (((from + (forward ? 1 : -1)) % cells.length) + cells.length) % cells.length
  return cells[next] ?? null
}

/**
 * 网格布局：一组窗格排成几行几列。
 *
 * 上游是**递归**的 splitter 树（`splitWithContent` 每次把一块分成两块），所以形状取决于分屏顺序；
 * 本仓把同一件事压成网格，规则跟着上游的两条约束：
 *   · 只往右（列 +1）与只往下（行 +1）分；
 *   · 每多一格就多占一块。
 * 取 `ceil(sqrt(n))` 作为列数上限的近似会让「右侧分屏两次」变成 2×2，与上游不符，
 * 所以这里记住**每次分屏实际发生在哪个方向**（`splitHistory`），按它推：
 * 列数 = 1 + 右侧次数，行数 = 1 + 下侧次数（上游同样是"每分一次多一块"）。
 */
export function terminalGridSize(rights: number, downs: number): { columns: number; rows: number } {
  return { columns: Math.max(1, 1 + Math.max(0, rights)), rows: Math.max(1, 1 + Math.max(0, downs)) }
}

/**
 * 一次分屏后新格子的位置（面板据此把新窗格插进正确的槽）。
 * `right` ⇒ 排在被分的那个窗格之后（同一行）；`down` ⇒ 排在整行之后（下一行）。
 */
export function paneIndexAfterSplit(panes: readonly TerminalPaneCell[], anchorIndex: number,
                                    orientation: TerminalSplitOrientation, columns: number): number {
  if (orientation === 'right') return Math.min(panes.length, anchorIndex + 1)
  const rowEnd = (Math.floor(anchorIndex / columns) + 1) * columns
  return Math.min(panes.length, rowEnd)
}
