// The four `ResizeToolWindowLeft/Right/Up/Down` actions of WindowMenu ›
// ActiveToolwindowGroup › ResizeToolWindowGroup (`PlatformActions.xml:678-683`), ported from
// `ide/actions/ResizeToolWindowAction.java`.
//
// Two rules come straight out of the source, and they are all this module needs to encode:
//
// 1. `update` (`:127-131`, `:144-148`, `:161-165`, `:178-182`):
//      Left / Right  -> enabled iff `!window.getAnchor().isHorizontal()`
//      Up   / Down   -> enabled iff  `window.getAnchor().isHorizontal()`
//    and `ToolWindowAnchor.isHorizontal()` is true for TOP and BOTTOM only
//    (`ToolWindowAnchor.java:49-51`). So the horizontal pair acts on a side-docked window and the
//    vertical pair on a top/bottom-docked one; the other pair of each is greyed out.
//    On top of that the whole action is hidden whenever an editor holds the focus (`:52-56`:
//    `isActiveEditorPresented` -> `setEnabledAndVisible(false)`) or the window is unavailable,
//    invisible, floating or windowed (`:67-80`).
//
// 2. The direction is where the *divider* goes, not where the window grows. The sign is the
//    source's arithmetic in `stretch` (`:107-121`):
//      Left  = stretch(true,  isIncrementAction = false): positive = (anchor == LEFT) == false
//      Right = stretch(true,  isIncrementAction = true):  positive = (anchor == LEFT) == true
//      Up    = stretch(false, isIncrementAction = true):  positive = (anchor == TOP)  != true
//      Down  = stretch(false, isIncrementAction = false): positive = (anchor == TOP)  != false
//    which works out to: a LEFT/TOP dock shrinks when the divider moves away from the screen edge
//    and grows when it moves towards it, while a RIGHT/BOTTOM dock is the mirror image. `stretch`
//    also ignores a direction whose axis does not match the anchor (`:110`, `:114`), so a
//    mismatched pair is a no-op rather than a surprise resize.
//
// The step is IDEA's too: `WindowAction.getPreferredDelta()` (`WindowAction.java:113-118`) is the
// preferred size of a `JLabel("W")` — the UI font's own metrics — times the registry value
// `ide.windowSystem.hScrollChars` / `vScrollChars` (`:96-98`), both 5 by default
// (`registry.properties:205-208`). The caller measures the font; `RESIZE_CHARS` carries the
// multiplier so the number itself is not invented here.
//
// `top` is part of the anchor set because the source has it and the arithmetic differs for it;
// TaoCode has no top dock, so callers never pass it. Keeping it makes this port checkable against
// all four anchors instead of three.

export type ToolWindowAnchor = 'top' | 'left' | 'bottom' | 'right'
export type ResizeDirection = 'left' | 'right' | 'up' | 'down'

/** `registry.properties:205-208` — `ide.windowSystem.hScrollChars` / `vScrollChars`. */
export const RESIZE_CHARS = 5

/** `ToolWindowAnchor.isHorizontal()` (`ToolWindowAnchor.java:49-51`): TOP and BOTTOM only. */
export function anchorIsHorizontal(anchor: ToolWindowAnchor): boolean {
  return anchor === 'top' || anchor === 'bottom'
}

/** Which of the four actions the anchor enables (`ResizeToolWindowAction.java:127-131, 161-165`). */
export function resizeDirectionEnabled(anchor: ToolWindowAnchor, direction: ResizeDirection): boolean {
  const horizontalDirection = direction === 'left' || direction === 'right'
  return horizontalDirection !== anchorIsHorizontal(anchor)
}

/** `stretch`'s direction of travel: `-1` shrink, `+1` grow, `0` when the axis does not match. */
export function stretchSign(anchor: ToolWindowAnchor, direction: ResizeDirection): -1 | 0 | 1 {
  if (!resizeDirectionEnabled(anchor, direction)) return 0
  if (direction === 'left' || direction === 'right') {
    // stretch(window, isHorizontalStretching = true, isIncrementAction = direction == right)
    return (anchor === 'left') === (direction === 'right') ? 1 : -1
  }
  // stretch(window, isHorizontalStretching = false, isIncrementAction = direction == up)
  return (anchor === 'top') !== (direction === 'up') ? 1 : -1
}

/** The signed change to apply to the dock's size. */
export function stretchDelta(anchor: ToolWindowAnchor, direction: ResizeDirection, step: number): number {
  return stretchSign(anchor, direction) * step
}
