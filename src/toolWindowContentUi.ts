// `ToggleContentUiTypeMode` — WindowMenu › ActiveToolwindowGroup's content-UI toggle
// (`PlatformActions.xml:680`), ported from `ide/actions/ToggleContentUiTypeAction.java`.
//
// IDEA's tool window shows its contents either as a *tab strip* (`TABBED`) or as a *combo box*
// (`ToolWindowContentUiType`, `ContentComboLabel.java` renders the combo). Which one it uses is part
// of the window's `WindowInfo` (`ToolWindowImpl.kt:521` reads `windowInfo.contentUiType`), i.e. it
// travels with the layout, and the combo is not a legacy oddity: the platform's own default layout
// gives it to Project and Notifications (`defaultToolWindowlayoutProvider.kt:238`, `:263`, and
// `ProjectViewToolWindowServiceImpl.kt:127` sets it as the Project view's default).
//
// The registered action is a `ToggleAction` whose **checked state means TABBED**
// (`ToggleContentUiTypeAction.isSelected` `:10-12`), enabled only when the window holds more than one
// content (`:19-21`). Note there is a second action carrying the same id: every `ToolWindowImpl`
// creates an inner `ToggleContentUiTypeAction` for its own gear menu
// (`ToolWindowImpl.kt:934-958`), and *that* one is selected when the type is COMBO, with a sticky
// `hadSeveralContents` visibility rule. The Window menu has the registered one, which is what is
// ported here; the gear-menu variant has no separate row in TaoCode.

export type ToolWindowContentUiType = 'tabbed' | 'combo'

/** `ToolWindowContentUiType.getInstance` (`:32-45`): an unknown name logs and falls back to TABBED. */
export function resolveContentUiType(value: unknown): ToolWindowContentUiType {
  return value === 'combo' ? 'combo' : 'tabbed'
}

/** `ToggleContentUiTypeAction.isSelected` (`:10-12`) — checked means the strip is showing. */
export function isTabbedContentUi(type: ToolWindowContentUiType): boolean {
  return type === 'tabbed'
}

/** `ToggleContentUiTypeAction.setSelected` (`:14-17`). */
export function toggledContentUiType(state: boolean): ToolWindowContentUiType {
  return state ? 'tabbed' : 'combo'
}

/** `ToggleContentUiTypeAction.update` (`:19-21`) — a single content has nothing to switch between. */
export function canToggleContentUiType(contentCount: number): boolean {
  return contentCount > 1
}

/**
 * `ShowContentAction.update` (`:37-46`) names the popup after the UI type — "Show List of Tabs" for
 * TABBED, "Show List of Views" for COMBO (`ActionsBundle.properties:1175-1177`) — which is the term
 * the content UI itself uses.
 */
export function contentCountLabel(type: ToolWindowContentUiType): string {
  return isTabbedContentUi(type) ? '标签页' : '视图'
}
