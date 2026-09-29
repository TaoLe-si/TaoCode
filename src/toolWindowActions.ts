// 工具窗口的隐藏/循环/关闭（WindowMenu › ActiveToolwindowGroup 的其余部分）+ 停靠判定。
// 从 App.vue 拆出（桃 2026-09-26：模块化）。
//
// 模式：`lastDockFocus` / `bottomContentUiType`（含 localStorage 持久化）由模块**自持**；
// 其余依赖注入且**全部惰性解析**（箭头包装/取值函数），与 App 的声明顺序无关。
import { computed, ref, watch } from 'vue'
import { nextContentIndex, tabNavigationCount, type TabNavigationTarget } from './activeToolWindow'
import { canCloseAllContents, canCloseOtherContents, isCloseableToolTab, tabsCloseAllWouldRemove, tabsCloseOtherWouldRemove } from './toolTabs'
import type { CloseableToolTabId, ToolTabPresence } from './toolTabs'
import { closeAllReferences, closeReferences, closeOtherReferences, hasReferences, referenceTabs,
         selectedReferences, selectReferences, togglePinReferences } from './referenceContents.ts'
import { isTabbedContentUi, toggledContentUiType } from './toolWindowContentUi'
import type { ToolWindowContentUiType } from './toolWindowContentUi'
import { BOTTOM_TABS } from './toolWindowMeta'

export { BOTTOM_TABS }

export interface ToolWindowActionsContext {
  workspace: () => { value: unknown }
  explorer: any
  bottom: any
  bottomTab: any
  references: any
  hierRoot: any
  hierTitle: any
  groups: any
  focusedPane: any
  active: any
  toolMenu: any
  lastActiveId: (...args: any[]) => any
  /** 停靠在底部的工具窗口 id（App 侧 computed：按 IDEA 的锚点分布过滤）。 */
  bottomAnchoredIds: () => any[]
  toolWindowTitle: (id: any) => string
  activeToolWindows: () => any
  toolWindowAvailable: (id: any) => boolean
  isLeftToolWindowId: (id: any) => boolean
  closeTab: (tab: any) => any
  switchTabIn: (pane: any, tab: any) => any
  showOutput: (tab: any) => any
  resetHierarchy: () => void
  toolDisabled: (id: any) => boolean
  /** 某个内容的内容条形态（`WindowInfo.contentUiType`，住在 src/toolWindowStripes.ts 的项目布局里）。 */
  contentUiType: (id: string) => ToolWindowContentUiType
  /** 改某个内容的形态（写回项目布局）。 */
  setContentUiType: (id: string, type: ToolWindowContentUiType) => void
  focusToolWindowContent: (id: any) => void
  // --- 底部 dock 标签的「移动到…」菜单（锚点菜单）---
  /** 当前锚点表：`id -> 'left' | 'right' | 'bottom'`。 */
  toolAnchors: () => Record<string, string>
  setToolAnchor: (id: any, side: any) => void
  saveToolAnchors: () => void
  showView: (id: any) => void
}

export function dockOf(element: Element | null): 'side' | 'bottom' | 'editor' {
  if (element?.closest('.output-panel')) return 'bottom'
  if (element?.closest('.explorer-panel')) return 'side'
  return 'editor'
}

export function focusedDock(): 'side' | 'bottom' | 'editor' {
  return dockOf(document.activeElement)
}

/**
 * A Swing menu does **not** take focus, so IDEA's `getActiveToolWindowId()` still answers with the
 * dock the user was in while the Window menu is open. A DOM menu button does take it, which would
 * grey out every row that needs the active tool window exactly when its own menu opens — so while
 * the focus sits in the top bar, the last dock that really held focus answers instead. Focus
 * anywhere else (the editor, the status bar) keeps the strict answer: no active tool window.
 */
export const lastDockFocus = ref<'side' | 'bottom' | 'editor'>('editor')

// `WindowInfo.contentUiType`（`ToolWindowImpl.kt:521`）是**每个窗口**的状态，跟着项目布局走 ——
// 所以它不在这里自持，而是由 `src/toolWindowStripes.ts` 的项目布局记录提供（第四十二批把
// "一个全局 ref + 一个 localStorage 键"改成每窗口一条记录，见 docs/ui-placement-audit.md §AT）。
// 这里只把它接成"当前那个内容"的读/写：上游 `ToggleContentUiTypeAction` 作用的就是活动工具窗口。

export function createToolWindowActions(ctx: ToolWindowActionsContext) {
  function noteDockFocus(event: FocusEvent) {
    lastDockFocus.value = dockOf(event.target as Element | null)
  }

  function activeToolWindowDock(): 'side' | 'bottom' | null {
    const live = focusedDock()
    if (live !== 'editor') return live
    const inTopBar = Boolean((document.activeElement as Element | null)?.closest('.topbar'))
    const dock = inTopBar ? lastDockFocus.value : 'editor'
    return dock === 'editor' ? null : dock
  }

  /** HideToolWindowAction.kt:21-29 — hide `activeToolWindowId ?: lastActiveToolWindowId`. */
  function hideActiveToolWindow() {
    const dock = focusedDock()
    if (dock === 'bottom') { ctx.bottom.value = false; return }
    if (dock === 'side') { ctx.explorer.value = false; return }
    const id = ctx.lastActiveId(ctx.activeToolWindows(), ctx.toolWindowAvailable)
    if (id === undefined) return
    if (ctx.isLeftToolWindowId(id)) ctx.explorer.value = false
    else ctx.bottom.value = false
  }

  /** HideSideWindowsAction.kt:18-25 — "Hide all windows on this side" (ActionsBundle:1136). */
  function hideSideToolWindows() { ctx.explorer.value = false }

  /** HideBottomToolWindowsAction.kt:19-24 — "Hide bottom tool windows" (ActionsBundle:1138). */
  function hideBottomToolWindows() { ctx.bottom.value = false }

  /**
   * The `v-if` on a bottom panel's own tab button is also its availability test, so a tab that cannot
   * be shown is never the target of a jump or a cycle.
   */
  function bottomTabAvailable(tab: any): boolean {
    if (tab === 'references') return hasReferences.value
    if (tab === 'hierarchy') return ctx.hierRoot.value !== null
    return true
  }

  /** The bottom dock's contents: the tab buttons' own `v-if`s are its availability test. */
  function bottomContentCount(): number {
    return BOTTOM_TABS.filter(bottomTabAvailable).length
  }

  /**
   * `TabNavigationActionBase.java:187-201`: the action is enabled only when the context it would act
   * on has more than one tab, which is why the two rows below are greyed out on a single tab.
   * 判据本身在 `src/activeToolWindow.ts` 的 `tabNavigationCount`（含"侧栏恒 1"那一支）。
   */
  function tabTargetCount(): number {
    if (!ctx.workspace().value) return 0
    return tabNavigationCount(focusedDock() as TabNavigationTarget,
      ctx.groups[ctx.focusedPane.value].tabs.length, bottomContentCount())
  }

  /**
   * `ToggleContentUiTypeMode` / `ShowContent` both ask `getActiveToolWindowId()` for the window they
   * act on, and neither falls back to a "last active" one. A side window shows one view, the bottom
   * dock holds the rest, and the editor means no tool window is active at all.
   */
  function activeContentCount(): number {
    const dock = activeToolWindowDock()
    if (!dock) return 0
    return dock === 'side' ? 1 : bottomContentCount()
  }

  function bottomTabLabel(tab: any): string {
    if (tab === 'output') return '操作输出'
    if (tab === 'run') return '运行'
    if (tab === 'problems') return '问题'
    if (tab === 'references') return selectedReferences.value?.tabName ?? '引用'
    if (tab === 'hierarchy') return ctx.hierTitle.value
    if (tab === 'terminal') return '终端'
    return '工作区说明'
  }

  /**
   * The combo form of the same list (`ContentComboLabel.java`) — the tab strip's own labels, in strip
   * order. The names are asserted against the strip's buttons in `tests/tool-window-content-ui.test.mjs`
   * so the two cannot drift apart.
   */
  // 选项 = 固定底部 tab + 停靠在底部的工具窗口（IDEA 的 combo 形式同样列出全部 content）。
  const bottomTabOptions = computed<{ id: any; label: string }[]>(() => [
    // 引用的那一格不是一个选项，而是**每条 content 一个**选项（combo 形式列得全才选得到）。
    ...BOTTOM_TABS.filter(bottomTabAvailable).flatMap(id =>
      id === 'references' ? referenceComboOptions.value : [{ id, label: bottomTabLabel(id) }]),
    ...ctx.bottomAnchoredIds().map(id => ({ id, label: ctx.toolWindowTitle(id) })),
  ])

  /** TabNavigationActionBase.java:71-78 — the editor answers when it has focus, the tool window else. */
  function selectNextTab() { cycleTab(1) }
  function selectPreviousTab() { cycleTab(-1) }

  function cycleTab(step: 1 | -1) {
    if (!ctx.workspace().value) return
    // 侧栏窗口只有一条内容（`getContentCount() > 1` 必假），所以这一支什么都不做 ——
    // 上游 `TabNavigationActionBase.actionPerformed:57-65` 只会走编辑器或"当前那个
    // ContentManager"，绝不会跳到另一个 dock 去。原先没有这一支：焦点在项目树里按 Alt+→
    // 会去切底部 dock 的标签。
    if (focusedDock() === 'side') return
    if (focusedDock() === 'editor') {
      // Editor branch (:130-147): the tabs of the *current* editor window, wrapping around.
      const pane = ctx.focusedPane.value
      const tabs = ctx.groups[pane].tabs
      const index = nextContentIndex(tabs.length, tabs.findIndex((tab: any) => tab.path === ctx.groups[pane].activePath), step)
      if (index === undefined) return
      ctx.switchTabIn(pane, tabs[index]!)
      return
    }
    // Tool-window branch (:156-171): selectNextContent / selectPreviousContent on the contents of the
    // active window, which is the bottom panel's tab strip here.
    const tabs = BOTTOM_TABS.filter(bottomTabAvailable)
    const index = nextContentIndex(tabs.length, tabs.indexOf(ctx.bottomTab.value), step)
    if (index === undefined) return
    ctx.showOutput(tabs[index]!)
  }

  /**
   * The strip's closeable contents as `Content.isCloseable()` sees them (`ContentImpl.java:237-239`):
   * references / hierarchy hold real content, the fixed tabs never do. This is the one
   * place that answers the question, so CloseActiveTab / CloseOtherTabs / CloseAllTabs cannot end up
   * disagreeing about which tabs are removable.
   */
  function toolTabPresence(): ToolTabPresence {
    return { references: hasReferences.value, hierarchy: ctx.hierRoot.value !== null }
  }

  /** `ContentManager.removeContent(cur, true)` for one content. */
  function clearToolTab(tab: CloseableToolTabId) {
    if (tab === 'references') closeAllReferences()
    else ctx.resetHierarchy()
  }

  /**
   * CloseActiveTabAction.java:39-58 — close the selected content when it is closeable, otherwise hide
   * the whole tool window. In TaoCode only references / hierarchy have content that can go
   * away, so those are the closeable ones; the fixed tabs fall through to hiding the panel.
   */
  function closeActiveTab() {
    if (!ctx.workspace().value) return
    // 侧栏只有一条不可关的内容 ⇒ 上游那一支会走到 `toolWindow.hide(null)`（`:31-37`），
    // 而那个 `toolWindow` 是从**该 ContentManager 的**上下文里取的（`:32`）⇒ 收的是**侧栏**。
    // 原先没有这一支：焦点在项目树里按 Ctrl+Shift+F4 会去收**底部**面板（跨 dock 的同一个错）。
    if (focusedDock() === 'side') { ctx.explorer.value = false; return }
    if (focusedDock() === 'bottom') {
      const current = ctx.bottomTab.value
      if (isCloseableToolTab(current) && toolTabPresence()[current]) { clearToolTab(current); return }
      ctx.bottom.value = false
      return
    }
    const tab = ctx.active.value
    if (tab) void ctx.closeTab(tab)
  }

  /**
   * ToolWindowCloseOtherTabsAction.kt:21-27 — enabled only when another content is closeable.
   * 引用那一格现在挂着多条 content：它们也算"别的内容"（本仓这条标签条是一个合并的管理器，
   * 所以判据是"别的 kind 可关 **或** 引用里还有别条"）。
   */
  function closeOtherTabsTarget(): boolean {
    return canCloseOtherContents(ctx.bottomTab.value, toolTabPresence()) || referenceTabs.value.some(tab => !tab.selected)
  }

  /**
   * `ToolWindowCloseOtherTabsAction.kt:11-19` — 选中的是引用那一格时，"关闭其他"关的是**同窗口的其它
   * content**（IDEA 那个 action 只看 `contentManager.contents`，跨窗口它管不着）；否则按 kind 收。
   */
  function closeOtherToolTabs() {
    if (ctx.bottomTab.value === 'references') { closeOtherReferences(); return }
    for (const tab of tabsCloseOtherWouldRemove(ctx.bottomTab.value, toolTabPresence())) clearToolTab(tab)
  }

  /**
   * ToolWindowCloseAllTabsAction.kt:11-18 — remove every closeable content of the tool window,
   * *including* the one on screen (the only difference from CloseOtherTabs). `PlatformActions.xml:666`
   * mounts it directly after `TW.CloseOtherTabs`; it borrows the shortcut of `CloseAllEditors`
   * (`intellij.platform.ide.impl.actions.xml:462`), which has no binding in `$default.xml`, so the
   * row has no key here either — none is invented.
   */
  function closeAllToolTabs() {
    for (const tab of tabsCloseAllWouldRemove(toolTabPresence())) clearToolTab(tab)
  }

  /** ToolWindowCloseAllTabsAction.kt:20-23 -> ContentManagerImpl.java:472-481. */
  function closeAllTabsTarget(): boolean {
    return canCloseAllContents(toolTabPresence())
  }

  // --- 引用那一格里挂着的多条 content（IDEA 的 Find 窗口）------------------------------------
  // `platform/lang-impl/src/com/intellij/usageView/impl/UsageViewContentManagerImpl.java:57`
  // 给那个窗口设了 `setToHideOnEmptyContent(true)`：内容全关光，
  // 窗口自己就收起来。本仓的"窗口"是底部那一格，所以对应动作是"关到空就跳回输出"。
  function selectReferenceTab(id: number) {
    selectReferences(id)
    ctx.showOutput('references')
  }
  function closeReferenceTab(id: number) {
    closeReferences(id)
    if (!hasReferences.value && ctx.bottomTab.value === 'references') ctx.showOutput('output')
  }
  function pinReferenceTab(id: number) { togglePinReferences(id) }

  /**
   * 内容全关光就离开那一格（上游 `setToHideOnEmptyContent(true)`，
   * `platform/lang-impl/src/com/intellij/usageView/impl/UsageViewContentManagerImpl.java:57`）。
   * 少了这条，标签条上已经没有"引用"这一格了，面板还停在"没有找到引用"上 —— 一个点不回去的空页面。
   */
  watch(hasReferences, present => {
    if (!present && ctx.bottomTab.value === 'references') ctx.showOutput('output')
  })

  /**
   * `PinActiveTabAction.update`（`:61-70`）：标题在 `action.pin.tab` / `action.unpin.tab`
   * （`IdeBundle.properties:403/401`）之间换，可用性看有没有 handler。
   * 本仓只有引用那一格挂得住多条 content，所以这一条只在选中引用内容时可用。
   */
  function canPinToolwindowTab(): boolean { return ctx.bottomTab.value === 'references' && selectedReferences.value !== null }
  function pinTabTitle(): string {
    return selectedReferences.value?.pinned ? '取消钉住标签页' : '钉住标签页'
  }
  function togglePinToolwindowTab(): void {
    if (!canPinToolwindowTab()) return
    togglePinReferences()
  }

  /**
   * 组合框形式（IDEA 的 `ContentComboLabel`）列的是**每一条 content**，不是每一种窗口 ——
   * 所以引用有几条就列几行（id 带 `references:` 前缀，`pickBottomOption` 再解回去）。
   */
  const referenceComboOptions = computed(() => referenceTabs.value.map(tab => ({
    id: `references:${tab.id}`, label: tab.label,
  })))
  const bottomSelectValue = computed(() => ctx.bottomTab.value === 'references' && selectedReferences.value
    ? `references:${selectedReferences.value.id}` : ctx.bottomTab.value)
  function pickBottomOption(value: string) {
    const match = /^references:(\d+)$/.exec(value)
    if (match) { selectReferenceTab(Number(match[1])); return }
    ctx.showOutput(value)
  }

  // The stripe button's context menu is the *tool window's* gear group (ToolWindowHeader.kt:345-368
  // `ShowOptionsAction` shows `gearProducer.get()`), so a right click must first make that window the
  // shown one — otherwise `toolMenu` would name a window whose header is not on screen.
  function openToolMenu(id: any) {
    if (ctx.toolDisabled(id)) return
    ctx.focusToolWindowContent(id)
    ctx.toolMenu.value = id
  }

  // --- 锚点菜单：把沉到底部的工具窗口搬回左/右栏 -------------------------------------------
  // 那三条「移动到…」平时挂在工具窗口自己的标题栏上（`ToolWindowHeader`）。窗口一旦停靠到底部，
  // 左/右栏就不再渲染它，那个标题栏也就没了 —— 于是「移得下去、搬不回来」。IDEA 不会这样：
  // 它的工具窗口头部（含 gear 与 View Mode / Move 组）属于**窗口本身**，跟着窗口出现在它停靠的那个 dock 里
  // （ToolWindowHeader.kt:119 起），所以底部窗口同样能改锚点。这里补的就是这个入口。
  const anchorMenu = ref<{ id: string; x: number; y: number } | null>(null)
  function openAnchorMenu(id: string, event: MouseEvent) {
    if (ctx.toolDisabled(id)) return
    anchorMenu.value = { id, x: event.clientX, y: event.clientY }
  }
  function closeAnchorMenu() { anchorMenu.value = null }
  // 齿轮按钮只对"当前这一格确实是停靠在底部的工具窗口"出现：output/run/terminal 这些原生
  // 底部 tab 不在锚点表里，它们没有"移到左侧"这回事。
  const bottomTabIsToolWindow = computed(() => (ctx.toolAnchors()[ctx.bottomTab.value] ?? 'left') === 'bottom')
  /** 菜单要知道"现在在哪一侧"才能把那一项置灰；索引放在模块里，模板不碰窄类型。 */
  const anchorMenuAnchor = computed(() => {
    const target = anchorMenu.value
    return (target ? ctx.toolAnchors()[target.id] : undefined) ?? 'left'
  })
  function moveAnchorTo(side: 'left' | 'right' | 'bottom') {
    const target = anchorMenu.value
    if (!target) return
    anchorMenu.value = null
    if ((ctx.toolAnchors()[target.id] ?? 'left') === side) return
    ctx.setToolAnchor(target.id, side)
    ctx.saveToolAnchors()
    // 换锚点后必须按**新**位置把它亮出来（`showView` 内部走 activationTarget → 按当前锚点选 dock，
    // 与 IDEA 的 ToolWindowManagerImpl.activateToolWindow 一致）。
    ctx.showView(target.id)
  }

  /** 当前内容的内容条形态（上游 `ToolWindowImpl.kt:521` 读的是活动窗口的 `windowInfo.contentUiType`）。 */
  function currentContentUiType(): ToolWindowContentUiType {
    return ctx.contentUiType(String(ctx.bottomTab.value))
  }
  /** `ToggleContentUiTypeAction.setSelected`（`:14-17`）：只翻**当前**这一个内容。 */
  function toggleContentUiType(): void {
    ctx.setContentUiType(String(ctx.bottomTab.value), toggledContentUiType(!isTabbedContentUi(currentContentUiType())))
  }

  return {
    contentUiType: currentContentUiType, toggleContentUiType,
    dockOf: (element: Element | null) => dockOf(element), focusedDock: () => focusedDock(),
    noteDockFocus, activeToolWindowDock, hideActiveToolWindow, hideSideToolWindows, hideBottomToolWindows,
    bottomTabAvailable, bottomContentCount, tabTargetCount, activeContentCount, bottomTabOptions, bottomTabLabel,
    selectNextTab, selectPreviousTab, cycleTab, toolTabPresence, clearToolTab, closeActiveTab,
    closeOtherToolTabs, closeOtherTabsTarget, closeAllToolTabs, closeAllTabsTarget, openToolMenu,
    selectReferenceTab, closeReferenceTab, pinReferenceTab, bottomSelectValue, pickBottomOption,
    canPinToolwindowTab, pinTabTitle, togglePinToolwindowTab,
    anchorMenu, anchorMenuAnchor, bottomTabIsToolWindow, openAnchorMenu, closeAnchorMenu, moveAnchorTo,
  }
}
