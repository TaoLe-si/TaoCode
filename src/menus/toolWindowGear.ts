// 工具窗口标题栏齿轮菜单（IDEA `ToolWindowImpl.createPopupGroup(true)` + `GearActionGroup`）
// 在 TaoCode 里还差的那几项 —— 与编辑器右键菜单同一招：**只登记引用，不复制文案**。
//
// 上游内容（`platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowImpl.kt`）：
//   `createPopupGroup`（:801-817）= `GearActionGroup` + (分隔) HideAction + (分隔) HelpAction
//   `GearActionGroup.getChildren`（:857-891）顺序：
//     additionalGearActions(该工具窗口自己的) · 分隔 · SpeedSearchAction · 分隔 ·
//     TabbedContentAction.CloseAllAction · ToggleToolbarAction 组（非 Preview 时再加
//     ToggleContentUiTypeAction，:874-879）· TW.ViewModeGroup（:880）·
//     移动组（新 UI 是 SquareStripeButton.createMoveGroup，:882；旧 UI 是 ToolWindowMoveAction.Group，:885）·
//     ResizeActionGroup（:887）· 分隔 · RemoveStripeButtonAction（:889）
//
// 本仓真能接住的几条（其余逐条登记在 docs/class-parity-todo.md，不渲染假控件）：
//   · `window.speedSearch`         = SpeedSearchAction（`ToolWindowImpl.kt:869`；**宿主给行**，不在菜单索引里）
//   · `window.closeAllTabs`        = TabbedContentAction.CloseAllAction（`:872`）
//   · `window.toggleContentUiType` = ToggleContentUiTypeAction（标签形态：平铺 ⇄ 合并，:874-879）
//   · `window.resizeToolWindow`    = ResizeActionGroup（四个方向的"拉伸"，自带子项，:887）
// 标题栏自己那几条（隐藏 / 最大化 / 移动到…）留在 `ToolWindowHeader.vue`：它们属于头部工具条
// （`ToolWindowHeader.kt:119` 的 `DockToolWindowAction, ShowOptionsAction, HideAction`），
// 不在齿轮组里，所以不进这份引用表。
import type { MenuRow } from './types'
import { canCloseContents } from '../toolWindowManager.ts'

/**
 * 齿轮菜单要追加的引用（顺序即上游顺序）。
 *
 * `hideWhenDisabled` 抄的是各行自己的 `update()` 到底用了哪一种写法：
 *   · CloseAllAction 用的是 `setEnabledAndVisible(...)`（`TabbedContentAction.java:144-150`：
 *     `contentCount > 1 || 上下文不是标签` 且 `canCloseAllContents()`）⇒ 不适用时**整行不见**；
 *   · ToggleContentUiTypeAction 用的是 `setEnabled(...)`（`ToggleContentUiTypeAction.java:19-21`）
 *     ⇒ 灰着但留在原位。两种都得照下来，不能一律灰成一排。
 */
export interface ToolWindowGearEntry {
  action: string
  hideWhenDisabled?: boolean
  /**
   * 这一条动的是**工具窗口的内容**（Close All / 标签形态），不是窗口本身。
   * 只有"内容确实挂在这个窗口上"的调用方才该拿到它 —— 本仓的内容条（引用 / 层次）住在底部 dock，
   * 侧栏那个齿轮里没有可关的内容，给一行点了会去清空底部标签的行就是骗人。
   */
  contentsScoped?: boolean
  /**
   * 这一行要先问**注册表**：`ToolWindow.canCloseContents()` 答 false 的窗口，
   * 上游这条动作根本不可见（`TabbedContentAction.java:87`/`:114` 的
   * `setEnabledAndVisible(myManager.canCloseContents() && …)`、`ContentManagerImpl.java:473` 的
   * `canCloseAllContents()` 第一句就是 `if (!canCloseContents()) return false`）。
   * 与 `hideWhenDisabled` 不同：那一条问的是"此刻有没有两条以上可关的内容"，这一条问的是
   * "**这个窗口的内容到底能不能关**"，是注册期就定的另一道闸。
   */
  requiresClosableContents?: boolean
  /**
   * 这一行不在菜单索引里，由宿主按当前焦点提供（`SpeedSearch` 就是这种：上游也只把它加进齿轮组）。
   * 取不到就整行不出现 —— 与"引用一个不存在的动作"同样处理。
   */
  fromHost?: boolean
}

export const TOOL_WINDOW_GEAR_SPEC: readonly ToolWindowGearEntry[] = [
  // `additionalGearActions`（该工具窗口自己的那一组）在 `GearActionGroup.getChildren` 里是**第一条**
  // （`ToolWindowImpl.kt:859-868`，`addSorted` 之后仍在最前）。本仓两处落点：项目视图的「行为」组
  // 在它自己的树头部（`ToolWindowView.vue`），用法视图（引用）的「视图选项」组在这里 ——
  // 后者属于"挂着内容的那个窗口"，所以标 `contentsScoped`，侧栏齿轮拿不到它。
  { action: 'usage.viewOptions', fromHost: true, contentsScoped: true },
  // 「分组」那一组（上游 `UsageViewImpl.java:1089-1098` 的 popup group +
  // `GroupByDirectoryStructureAction.java:10-26`；文本 `UsageViewBundle.properties:19` "Group By" /
  // `:21` "Directory Structure"）。上游它在工具条，本仓引用面板没有工具条那一层 ⇒ 进齿轮，理由见 `src/usageViewGear.ts`。
  { action: 'usage.groupBy', fromHost: true, contentsScoped: true },
  // `group.add(ActionManager.getInstance().getAction(SpeedSearchAction.ID))`（`ToolWindowImpl.kt:869`）：
  // 齿轮的**第一条**，在 CloseAll 之前。它不在任何菜单组里 —— `PlatformActions.xml:146` 是顶层
  // `<reference>`（只登记引用、不加进菜单），所以本仓也不给它编一个菜单位置，行由宿主按
  // "当前焦点处有没有可搜的列表"提供（上游 `SpeedSearchAction.update`：`isVisible = 有 handler`，`:29-32`）。
  { action: 'window.speedSearch', fromHost: true },
  { action: 'window.closeAllTabs', hideWhenDisabled: true, contentsScoped: true, requiresClosableContents: true },
  { action: 'window.toggleContentUiType', contentsScoped: true },
  // `PinToolwindowTab`（`intellij.platform.ide.impl.actions.xml:455`）不在齿轮组里 —— 它在
  // `PlatformActions.xml:657` 的 ActiveToolwindowGroup 里。齿轮这边**不抄一份**：
  // 引用那条 content 自己身上就有钉住按钮（见 App.vue 的 output-tab-close 那一行），
  // 而 `window.pinToolwindowTab` 已在 Window 菜单里可搜可点。
  { action: 'window.resizeToolWindow' },
  // `RemoveStripeButtonAction`（`ToolWindowImpl.kt:889` 挂在齿轮组的**最后**）。
  // 它同样不在任何主菜单里（`:914-925` 是个私有 internal 类），所以也由宿主给行：
  // 侧条上有这个按钮（`isEnabledAndVisible = isShowStripeButton`，`:918`）才给。
  { action: 'window.removeStripeButton', fromHost: true },
]

// --- 注册表那道闸（`ToolWindow.canCloseContents()`）的公共部分 ---------------------------------
// 行表与组件用的是**同一条**判据，所以这里只留一份：`toolWindowGearRows()` 在**造行**时过它，
// 齿轮组件在**渲染**时过它（调用方拿到的是宿主统一算好的行表，"当前挂在哪个窗口上"只有组件知道）。
// 要拦哪些行从上面那张引用表**派生**，不再手抄一份 id 清单（两处登记迟早漂成两个答案）。
export const GEAR_CLOSE_CONTENTS_ROWS: ReadonlySet<string> = new Set(
  TOOL_WINDOW_GEAR_SPEC.filter(entry => entry.requiresClosableContents).map(entry => entry.action))

// 只有注册表**答 false** 时才拦：`canCloseContents()` 是注册期就定的布尔
// （`ToolWindowImpl.kt:647`，值来自 EP 的 `canCloseContents`，`ToolWindowSetInitializer.kt:369`）；
// 答不出（`null`：底部那几格固定内容在本仓没有 `<toolWindow>` 注册记录）保持现状，
// 没给 id 同样保持现状 —— 替窗口猜一个 false 会把既有能用的行关掉（假闸）。
function blockedByRegistry(action: string, closable: boolean | null): boolean {
  return closable === false && GEAR_CLOSE_CONTENTS_ROWS.has(action)
}

/**
 * 组件侧那条闸：一张**已经算好**的齿轮行表，按「这个齿轮当前挂在哪个工具窗口上」再滤一次。
 *
 * 为什么落在组件而不是只落在行表里：上游那份齿轮组不是宿主统一算一份再发给两边的 ——
 * `platform/platform-impl/src/com/intellij/toolWindow/InternalDecoratorImpl.kt:290`
 * 给每个标题栏的是 `gearProducer = { toolWindow.createPopupGroup(true) }`，
 * 也就是按**这个头部自己那一份 `ToolWindow`**（同文件 `ToolWindowHeader.kt:68` 的构造参数）现取的；
 * 本仓的行表由 `src/menuUi.ts` 统一算、`ToolWindowHeader.vue` / `ToolWindowGear.vue` 只渲染，
 * 所以"当前是哪个窗口"这一位要由**拿着 id 的那一层**补上（底部那一格的 id 在宿主，接线请求见
 * `docs/wiring-requests-2026-10-06-tw3.md`）。
 * 摘行的写法照上游：`TabbedContentAction.java:145-149` 是 `setEnabledAndVisible(...)`，
 * 而它的第一道闸 `ContentManagerImpl.java:472-475` 就是 `canCloseContents()` ⇒ 不适用时**整行不见**，
 * 不是留一行灰着的。
 */
export function gearRowsForWindow(rows: readonly MenuRow[], toolWindowId?: string | null): MenuRow[] {
  const closable = toolWindowId ? canCloseContents(toolWindowId) : null
  if (closable !== false) return [...rows]
  return rows.filter(row => !blockedByRegistry(row.id, closable))
}

/**
 * 按引用取行；取不到的丢掉（该动作不存在就不该有一行假的）。
 * `contents` = 这个齿轮管的是**挂着内容的那个窗口**（底部 dock），默认 false = 侧栏窗口。
 * `toolWindowId` = 这个齿轮当前挂在哪个工具窗口上（上游 `ToolWindowHeader.kt` 拿的就是自己那一份
 * `ToolWindow`）；给了就按注册表那条 `canCloseContents` 再过一道 `requiresClosableContents` 的闸。
 * **不给**（本仓现有调用方 `src/menuUi.ts:333` 还没传）= 这一位答不出，沿用既有行为，不替窗口猜一个值 ——
 * 底部那几格固定内容在本仓没有 `<toolWindow>` 注册记录，同一档返回 null，理由见
 * `src/toolWindowManager.ts` 的 `canCloseContents`。
 */
export function toolWindowGearRows(find: (id: string) => MenuRow | undefined,
                                   spec: readonly ToolWindowGearEntry[] = TOOL_WINDOW_GEAR_SPEC,
                                   contents = false,
                                   hostRows: Readonly<Record<string, MenuRow>> = {},
                                   toolWindowId?: string): MenuRow[] {
  const closable = toolWindowId === undefined ? null : canCloseContents(toolWindowId)
  const rows: MenuRow[] = []
  for (const entry of spec) {
    if (entry.contentsScoped && !contents) continue
    // 注册表说这个窗口的内容关不掉 ⇒ 这条整行不见（判据与 `gearRowsForWindow` 同一份）。
    if (blockedByRegistry(entry.action, closable)) continue
    // 宿主行**只**从宿主拿：`SpeedSearch` 不在菜单索引里（上游也只把它加进齿轮组），
    // 回退去 find 会把它当成主菜单动作 —— 那样"取不到的引用"这条判据就形同虚设。
    const row = entry.fromHost ? hostRows[entry.action] : find(entry.action)
    if (!row) continue
    // 可用性用的是行自己的谓词（主菜单那条 `enabled: closeAllTabsTarget`，
    // 也就是 `ContentManagerImpl.canCloseAllContents()`，:472-481）。
    if (entry.hideWhenDisabled && row.enabled && !row.enabled()) continue
    rows.push(row)
  }
  return rows
}
