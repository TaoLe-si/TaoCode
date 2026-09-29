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
   * 这一行不在菜单索引里，由宿主按当前焦点提供（`SpeedSearch` 就是这种：上游也只把它加进齿轮组）。
   * 取不到就整行不出现 —— 与"引用一个不存在的动作"同样处理。
   */
  fromHost?: boolean
}

export const TOOL_WINDOW_GEAR_SPEC: readonly ToolWindowGearEntry[] = [
  // `group.add(ActionManager.getInstance().getAction(SpeedSearchAction.ID))`（`ToolWindowImpl.kt:869`）：
  // 齿轮的**第一条**，在 CloseAll 之前。它不在任何菜单组里 —— `PlatformActions.xml:146` 是顶层
  // `<reference>`（只登记引用、不加进菜单），所以本仓也不给它编一个菜单位置，行由宿主按
  // "当前焦点处有没有可搜的列表"提供（上游 `SpeedSearchAction.update`：`isVisible = 有 handler`，`:29-32`）。
  { action: 'window.speedSearch', fromHost: true },
  { action: 'window.closeAllTabs', hideWhenDisabled: true, contentsScoped: true },
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

/**
 * 按引用取行；取不到的丢掉（该动作不存在就不该有一行假的）。
 * `contents` = 这个齿轮管的是**挂着内容的那个窗口**（底部 dock），默认 false = 侧栏窗口。
 */
export function toolWindowGearRows(find: (id: string) => MenuRow | undefined,
                                   spec: readonly ToolWindowGearEntry[] = TOOL_WINDOW_GEAR_SPEC,
                                   contents = false,
                                   hostRows: Readonly<Record<string, MenuRow>> = {}): MenuRow[] {
  const rows: MenuRow[] = []
  for (const entry of spec) {
    if (entry.contentsScoped && !contents) continue
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
