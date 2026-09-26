// Pure logic behind IDEA's status bar keyboard navigation and focus handling.
// Source: platform/platform-impl/src/com/intellij/openapi/wm/impl/status/IdeStatusBarImpl.kt

/** The traversal only walks widgets that are both shown and enabled (`:901-902`). */
export interface FocusableWidget {
  /** `component.isShowing` — a widget inside a collapsed popup is not in the cycle. */
  hidden: boolean
  /** `component.isEnabled` — a disabled widget is skipped, not just rejected on activation. */
  disabled: boolean
}

/**
 * `getFocusableAndEnabledWidgets()` (`:901-902`) = `getFocusableWidgetComponents()` (`:874-880`) minus
 * the hidden and the disabled. `:874-880` builds the order as left panel → info&progress → right
 * panel sorted by `gridx`, i.e. the visual left-to-right order — which is exactly DOM order, so the
 * DOM query that feeds this function needs no extra sorting.
 */
export function focusableWidgets<T extends FocusableWidget>(widgets: readonly T[]): T[] {
  return widgets.filter(widget => !widget.hidden && !widget.disabled)
}

export type NavDirection = 'next' | 'previous'

/**
 * `StatusBarFocusTraversalPolicy` (`:952-962`): `getComponentAfter` falls back to
 * `getFirstComponent` (`:955-956`) and `getComponentBefore` to `getLastComponent` (`:958-959`), so
 * the cycle **wraps around** in both directions. The arrow keys are part of the traversal because
 * `:317-322` adds RIGHT to the forward traversal keys and LEFT to the backward ones.
 * Returns -1 when there is nothing to focus.
 */
export function navigateWidget(index: number, count: number, direction: NavDirection): number {
  if (count <= 0) return -1
  if (index < 0) return direction === 'next' ? 0 : count - 1
  const step = direction === 'next' ? 1 : -1
  return (index + step + count) % count
}

/**
 * `FocusStatusBarAction` (`status/FocusStatusBarAction.kt:10-21`) calls `focusFirstWidget()`
 * (`:863-872`), which returns immediately when the focus owner is already the status bar or one of
 * its descendants (`:864-866`) — the action focuses *in*, it never walks out.
 */
export function shouldFocusFirstWidget(focusInsideStatusBar: boolean, widgetCount: number): boolean {
  return !focusInsideStatusBar && widgetCount > 0
}

export type RestoreTarget = 'previous' | 'editor'

/**
 * `restoreFocusToPreviousComponent()` (`:579-596`): the saved focus owner wins only while it is
 * still shown and enabled; otherwise the focus goes back to the editor component, with the tool
 * window fallback coming after that (`:588-596`).
 */
export function resolveRestoreTarget(hasSavedFocus: boolean, savedFocusUsable: boolean): RestoreTarget {
  return hasSavedFocus && savedFocusUsable ? 'previous' : 'editor'
}

/**
 * `:573-576` puts SPACE **and** ENTER on `STATUS_BAR_WIDGET_ACTIVATE` for every widget, guarded by
 * `component.isShowing && component.isEnabled` (`:566`). Plain `<button>` elements already fire a
 * click on both keys and never on a disabled button, so the DOM needs no extra binding — recorded
 * here so the equivalence is explicit rather than implied.
 */
export const ACTIVATION_KEYS = ['Space', 'Enter'] as const
