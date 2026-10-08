// 标签条右端那个常驻的「更多」下拉 —— IDEA 的 `EditorTabsEntryPoint`
// （`platform/platform-impl/resources/idea/PlatformActions.xml:804-816`，`popup="true" icon="AllIcons.Actions.More"`）。
//
// 它在 `EditorTabbedContainer.kt` 里跟 `EditorTabsToolbarActions` 合成 `editorActionGroup`（`:626-632`），
// 再和 `closeTab` 一起挂到每个标签上（`:554-555`）—— 也就是 IDEA 编辑器标签**右侧那组按钮**，
// 其中常驻可见的就是这个下拉（`ActionPanel.java` 负责排布与"不可用就不画"的规则，见 `src/tabEntryPoint.ts`）。
//
// 成员照上游顺序（RecentFilesFallback · RecentLocations · GotoFile | CloseAllEditors · ReopenClosedTab |
// Unsplit · UnsplitAll · ChangeSplitOrientation | ConfigureEditorTabs），但**只放本仓真接得住的**：
// 取不到的动作不渲染一行假的（其余登记在 docs/class-parity-todo.md）。
import type { TabEntryPointItem } from './tabEntryPoint'

export interface TabEntryPointContext {
  /** 当前分组里已关闭、可重新打开的标签数（`ReopenClosedTab` 的可用性）。 */
  closedCount: number
  /** 当前分组里的标签总数（`CloseAllEditors` 的可用性）。 */
  tabCount: number
  /** 有没有未固定的标签（本仓的"关闭所有未固定标签页"）。 */
  hasUnpinned: boolean
  /** 当前是不是分屏（`Unsplit` / `UnsplitAll` / `ChangeSplitOrientation` 的可用性）。 */
  split: boolean
  /** 当前标签能不能摘成独立窗口（要有一个活动标签）。 */
  canDetach: boolean
  reopenClosedTab: () => void
  closeAllTabs: () => void
  closeUnpinnedTabs: () => void
  unsplit: () => void
  unsplitAll: () => void
  changeSplitOrientation: () => void
  /** 「配置编辑器标签页…」：打开设置里那一页（上游 `ConfigureEditorTabs`）。 */
  openTabSettings: () => void
  /**
   * 「在独立窗口中打开」（上游 `EditSourceInNewWindow`，`PlatformActions.xml:919` 那一行紧跟在
   * `PinActiveEditorTab`/`KeepTabOpen` 之后；默认键位 Shift+F4 = `$default.xml:729-731`）。
   * 本仓的还原是浮层编辑器 + 浏览器档的真新窗口，规则在 `src/editorWindows.ts`。
   */
  openInNewWindow: () => void
}

/**
 * 上游那九项的**本仓投影**。`id` 用 IDEA 的动作 id，便于与上游逐条对照；
 * `label` 是本仓界面语言下的译名（与主菜单/右键菜单里同名动作保持一致，不另起一套叫法）。
 */
export function tabEntryPointItems(ctx: TabEntryPointContext): TabEntryPointItem[] {
  return [
    // RecentFilesFallback（`RecentFilesFallback`）与 RecentLocations 本仓在 Ctrl+E / Ctrl+Shift+E 上有，
    // 但它们是**全局找回弹窗**、不属于"标签这一格"的操作，放进标签下拉会与上游的位置感不符；
    // GotoFile 同理（Ctrl+Shift+N）。三条都留在各自的键位与菜单里，这里不重复挂。
    { id: 'CloseAllEditors', label: '关闭所有标签页', enabled: ctx.tabCount > 0, run: ctx.closeAllTabs },
    { id: 'ReopenClosedTab', label: '重新打开已关闭的标签页', enabled: ctx.closedCount > 0, run: ctx.reopenClosedTab },
    { id: 'CloseUnpinnedTabs', label: '关闭所有未固定标签页', enabled: ctx.hasUnpinned, run: ctx.closeUnpinnedTabs },
    // `EditSourceInNewWindow`（`PlatformActions.xml:919`，在 KeepTabOpen 之后）。`canDetach` 是
    // 宿主能力探测的结果（浮层容器在 DOM 里或浏览器档可开）—— 能力不足时 `enabled=false`，
    // 按 `ActionPanel` 的规矩整个不画，不摆一个点了没反应的假控件。
    { id: 'EditSourceInNewWindow', label: '在独立窗口中打开', enabled: ctx.canDetach && ctx.tabCount > 0, run: ctx.openInNewWindow },
    { id: 'Unsplit', label: '取消拆分', enabled: ctx.split, run: ctx.unsplit },
    { id: 'UnsplitAll', label: '全部取消拆分', enabled: ctx.split, run: ctx.unsplitAll },
    { id: 'ChangeSplitOrientation', label: '切换拆分方向', enabled: ctx.split, run: ctx.changeSplitOrientation },
    { id: 'ConfigureEditorTabs', label: '配置编辑器标签页…', enabled: true, run: ctx.openTabSettings },
  ]
}

/**
 * 宿主把"一格的当前状态 + 那几个动作"交进来，这里负责组装成分组成员。
 * 分成两步（`Context` 是纯数据、`items` 是产物）是为了让成员表能单独核 ——
 * 上游那九项里哪几项本仓真接得住，是这张表说了算。
 */
export function tabEntryPointContext(input: {
  closedCount: number
  tabCount: number
  hasUnpinned: boolean
  split: boolean
  canDetach?: boolean
  reopenClosedTab: () => void
  closeAllTabs: () => void
  closeUnpinnedTabs: () => void
  unsplit: () => void
  unsplitAll: () => void
  changeSplitOrientation: () => void
  openTabSettings: () => void
  openInNewWindow?: () => void
}): TabEntryPointContext {
  return { canDetach: false, openInNewWindow: () => {}, ...input }
}

/**
 * 宿主只调这一处（组装层不留逻辑）：把"别处的状态对象"与"那几个函数"直接注入，
 * 由此模块负责读状态、按格取成员表。读的都是宿主已有对象，不复制任何一份状态。
 */
export function createTabEntryPoint(deps: {
  groups: any
  closedTabsPerPane: any
  split: () => string
  reopenClosedTab: () => unknown
  closeAllTabsIn: (pane: number) => unknown
  closeUnpinnedTabsIn: (pane: number) => unknown
  unsplit: () => unknown
  unsplitAll: () => unknown
  changeSplitOrientation: () => unknown
  openSettings: (section?: string) => unknown
  /** 「在独立窗口中打开」那一格的注入（缺省 = 这一档不画，见 `tabEntryPointItems`）。 */
  canDetach?: () => boolean
  detachActive?: (pane: number) => unknown
}): (pane: number) => TabEntryPointItem[] {
  return pane => {
    const tabs = deps.groups[pane].tabs
    const activePath: string = deps.groups[pane].activePath ?? ''
    const canDetach = deps.canDetach?.() === true && Boolean(activePath)
    return tabEntryPointItems({
      closedCount: deps.closedTabsPerPane[pane].length,
      tabCount: tabs.length,
      hasUnpinned: tabs.some((tab: { pinned?: boolean }) => !tab.pinned),
      split: deps.split() !== 'none',
      canDetach,
      reopenClosedTab: () => void deps.reopenClosedTab(),
      closeAllTabs: () => void deps.closeAllTabsIn(pane),
      closeUnpinnedTabs: () => void deps.closeUnpinnedTabsIn(pane),
      unsplit: () => void deps.unsplit(),
      unsplitAll: () => void deps.unsplitAll(),
      changeSplitOrientation: () => void deps.changeSplitOrientation(),
      openTabSettings: () => void deps.openSettings('editor.preferences.tabs'),
      openInNewWindow: () => void deps.detachActive?.(pane),
    })
  }
}