// Pure logic behind IDEA's tool window header and the Maximize Tool Window action.
// Every rule below is copied from the platform sources; the component and App.vue only translate
// DOM events into these calls, so the behaviour can be unit tested without a browser.

/**
 * IDEA's `ToolWindowAnchor` only has LEFT/RIGHT (the "bottom" area is a separate pane);
 * TaoCode's docks mirror that: a tool window lives on one of the two vertical stripes.
 */
export type ToolWindowSide = 'left' | 'right'

/**
 * The gestures `ToolWindowHeader.kt:212-256` reacts to. `null` means "the header does nothing",
 * which is how IDEA treats every other mouse button.
 */
export type HeaderAction = 'activate' | 'maximize' | 'hide' | 'menu' | null

/**
 * `$default.xml:885-887` binds `MaximizeToolWindow` to `control shift QUOTE`; the macOS keymap
 * (`macOS System Shortcuts.xml:394-396`) keeps `ctrl shift QUOTE` — it is *not* a ⌘ shortcut, so the
 * label does not change per platform. The physical key is stored, hence `code === 'Quote'`.
 */
export const MAXIMIZE_SHORTCUT_CODE = 'Quote'
export const MAXIMIZE_SHORTCUT_LABEL = "Ctrl Shift '"

export interface HeaderEvent {
  kind: 'click' | 'dblclick' | 'aux' | 'contextmenu' | 'mousedown'
  /** `MouseEvent.button`: 0 left, 1 middle, 2 right — the DOM numbering. */
  button?: number
  shiftKey?: boolean
}

/**
 * `ToolWindowHeader.kt:212-256`, in the source order:
 *   1. `e.isPopupTrigger` returns first — the context menu never also activates (:215-217).
 *   2. `UIUtil.isCloseClick` (:219) is `BUTTON2 || BUTTON1 && shift` (`UIUtil.java:1843-1846`), i.e.
 *      middle click or shift+left click; it hides the window — the alt variant (:220-225) hides the
 *      whole window instead of the side, which in TaoCode is the same flag, so both collapse here.
 *   3. every other release activates the window (:227-232).
 *   4. `DoubleClickListener.onDoubleClick` (:242-248) toggles maximize.
 */
export function headerAction(event: HeaderEvent): HeaderAction {
  if (event.kind === 'contextmenu') return 'menu'
  if (event.kind === 'dblclick') return 'maximize'
  if (event.kind === 'mousedown') return null
  if (event.kind === 'aux') return event.button === 1 ? 'hide' : null
  if (event.kind !== 'click') return null
  const button = event.button ?? 0
  if (button === 1 || (button === 0 && event.shiftKey)) return 'hide'
  return button === 0 ? 'activate' : null
}

/**
 * `ToolWindowPane.kt:544-553` (`setMaximized`): maximizing stores the current size in
 * `maximizedProportion` and stretches the window; the action itself is a toggle
 * (`MaximizeToolWindowAction.java:36`), so asking for the already-maximized side restores it.
 */
export function toggleMaximized(current: ToolWindowSide | null, side: ToolWindowSide): ToolWindowSide | null {
  return current === side ? null : side
}

/**
 * `stretch` only ever touches the window it was called for; the pane gives the component the full
 * width, so a *different* window becoming active (or the window being hidden) ends the stretch.
 * `activeSide` is `null` when the shown tool window is not in a vertical dock at all (TaoCode's
 * bottom area is the output pane), which also ends the stretch. Without this the workbench would
 * stay collapsed with no way back.
 */
export function reconcileMaximized(
  current: ToolWindowSide | null,
  activeSide: ToolWindowSide | null,
  visible: boolean,
): ToolWindowSide | null {
  if (!current) return null
  if (!visible || current !== activeSide) return null
  return current
}

/**
 * `MaximizeToolWindowAction.update` (:45-63) disables the action without a tool window in the
 * context, so the shortcut must be inert when there is nothing to maximize.
 */
export function canMaximize(hasWorkspace: boolean, visible: boolean): boolean {
  return hasWorkspace && visible
}
