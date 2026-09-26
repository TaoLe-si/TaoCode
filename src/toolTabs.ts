// The *contents* of the tool window tab strip, modelled the way IDEA's `ContentManager` models
// them, for the three WindowMenu actions that remove contents (`PlatformActions.xml:664-666`):
// CloseActiveTab, TW.CloseOtherTabs, TW.CloseAllTabs.
//
// IDEA's strip is a `ContentManager` holding `Content` objects. `Content.isCloseable()`
// (`Content.java:105` -> `ContentImpl.java:237-239` returns the flag `setCloseable` wrote) decides
// which of them may be removed; every content in TaoCode's strip that is *not* closeable is a
// permanent one — `CloseActiveTabAction.java:39-58` falls through to hiding the whole tool window
// for those, which is what App.vue's `closeActiveTab` does.
//
// The three removal actions are then three tiny loops over that set, and the predicates they use
// are the two-factor shape IDEA actually implements:
//   `canCloseAllContents()` (`ContentManagerImpl.java:472-481`)
//     = canCloseContents() && any content isCloseable()
//   `ToolWindowCloseOtherTabsAction.update` (`:21-27`)
//     = content != null && canCloseContents() && any *other* content isCloseable()
//   `ToolWindowCloseAllTabsAction.update` (`:20-23`)
//     = content != null && canCloseAllContents()
//
// `canCloseContents()` (`ContentManagerImpl.java:140-142`) just returns the flag the manager was
// built with. The real tool-window strip is built with `true` (`ContentFactoryImpl.java:21` ->
// `ContentFactoryImpl.createContentManager(ui, canCloseContents, project)`, called by
// `ToolWindowContentUi` with `canCloseContents = true`), unlike the headless manager which hard
// returns false (`ToolWindowHeadlessManagerImpl.java:474-481`). TaoCode has exactly one strip and
// it does hold closeable contents (that is why CloseActiveTab can clear them at all), so the flag
// is a constant `true` here — kept named so the predicate keeps the source's two-factor shape
// instead of quietly collapsing it.
//
// Both actions iterate `contentManager.contents`, i.e. **strip order**, not "whatever order the
// caller happens to hold them in", so the lists returned below are always in that order.

/**
 * The contents of the strip that are closeable, **in strip order** (`BOTTOM_TABS` in App.vue
 * filtered by `isCloseable()`); `tests/tool-tabs.test.mjs` re-derives the order from the App.vue
 * literal so the two cannot drift apart.
 */
export const CLOSEABLE_TOOL_TABS = ['references', 'hierarchy', 'blame'] as const

export type CloseableToolTabId = (typeof CLOSEABLE_TOOL_TABS)[number]

/** Which closeable contents are currently in the strip ("in `contentManager.contents`"). */
export type ToolTabPresence = Readonly<Record<CloseableToolTabId, boolean>>

/** `ContentManagerImpl.canCloseContents()` (`:140-142`) for TaoCode's single, closeable strip. */
export const CAN_CLOSE_CONTENTS = true

/** `Content.isCloseable()` as a narrowing test for a tab id that may be a permanent one. */
export function isCloseableToolTab(id: string): id is CloseableToolTabId {
  return (CLOSEABLE_TOOL_TABS as readonly string[]).includes(id)
}

/** The closeable contents that are actually present, in strip order. */
export function presentCloseableTabs(presence: ToolTabPresence): CloseableToolTabId[] {
  return CLOSEABLE_TOOL_TABS.filter(tab => presence[tab])
}

/** `ContentManagerImpl.canCloseAllContents()` (`:472-481`). */
export function canCloseAllContents(presence: ToolTabPresence): boolean {
  return CAN_CLOSE_CONTENTS && presentCloseableTabs(presence).length > 0
}

/**
 * `ToolWindowCloseOtherTabsAction.update` (`:21-27`). `active` is the strip's selected content and
 * is deliberately *not* narrowed to a closeable id: the source compares against whatever content
 * the action was invoked on (a permanent content such as Output is a valid one), and `cur !== content`
 * then matches every closeable content.
 */
export function canCloseOtherContents(active: string, presence: ToolTabPresence): boolean {
  return CAN_CLOSE_CONTENTS && presentCloseableTabs(presence).some(tab => tab !== active)
}

/**
 * `ToolWindowCloseAllTabsAction.actionPerformed` (`:11-18`): remove every closeable content —
 * including the selected one, which is the only difference from CloseOtherTabs. Returns them
 * instead of performing the removal so the caller can clear its own state.
 */
export function tabsCloseAllWouldRemove(presence: ToolTabPresence): CloseableToolTabId[] {
  return presentCloseableTabs(presence)
}

/**
 * `ToolWindowCloseOtherTabsAction.actionPerformed` (`:11-19`): every closeable content but `active`.
 * A non-closeable `active` (Output, Problems, …) therefore removes all of them, which is the
 * source's behaviour too — it only ever skips the one content the action was invoked on.
 */
export function tabsCloseOtherWouldRemove(active: string, presence: ToolTabPresence): CloseableToolTabId[] {
  return presentCloseableTabs(presence).filter(tab => tab !== active)
}

// --- WindowMenu › HideAllWindows (`HideAllToolWindowsAction.kt`) ------------------------------
//
// `HideAllWindows` is not a plain hide: it is a *toggle* with two texts, and the two texts are what
// tell the user which way it will go (`update`, :34-49):
//   - some window is still visible  -> text `action.hide.all.windows` = "Hide All _Windows"
//     (`IdeBundle.properties:384`), and the action saves the current layout to
//     `layoutToRestoreLater` before hiding everything (:24-29).
//   - nothing left to hide but a saved layout exists -> text `action.restore.windows` =
//     "Restore _Windows" (`IdeBundle.properties:385`), and the action puts that layout back and
//     clears the field (:17-22).
//   - neither -> `isEnabled = false` (:36, :48), i.e. the row is greyed out.
//
// "Which windows would be hidden" is `HideToolWindowAction.Manager.shouldBeHiddenByShortCut`
// (`:56`), i.e. the *visible* tool windows; the three docks are what that maps to in TaoCode.

/** The saved layout `layoutToRestoreLater` holds when HideAllWindows has hidden everything. */
export interface ToolWindowChrome {
  explorer: boolean
  activity: boolean
  bottom: boolean
}

/** `getIdsToHide(...)` (`:54-58`) reduced to a boolean — "is there anything left to hide". */
export function hasVisibleToolWindow(chrome: ToolWindowChrome): boolean {
  return chrome.explorer || chrome.activity || chrome.bottom
}

/** `HideAllToolWindowsAction.update` (`:36, :38-39, :43-44, :48`) — the enable test. */
export function canHideAllToolWindows(chrome: ToolWindowChrome, saved: ToolWindowChrome | null): boolean {
  return hasVisibleToolWindow(chrome) || saved !== null
}

/**
 * The label the row shows. Unlike the enable test this one is strict: with nothing to hide and
 * nothing saved the source leaves the presentation untouched (:48), so the "hide" text stays.
 */
export function hideAllToolWindowsTitle(chrome: ToolWindowChrome, saved: ToolWindowChrome | null): string {
  if (hasVisibleToolWindow(chrome)) return '隐藏所有工具窗口'
  return saved !== null ? '恢复窗口' : '隐藏所有工具窗口'
}
