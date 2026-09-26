// IDEA's single-row tab strip layout, ported from ScrollableSingleRowLayout.
//
// A tab strip that runs out of room does not simply overflow. IDEA lays the tabs out left
// to right and reserves room for the "more" button (`…`); the tab that no longer fits is
// drawn *clipped* to whatever is left, and every tab after it is dropped out of the strip
// and becomes reachable through that button. Scrolling shifts the window so the tail can be
// reached without the button.
//
// `JBTabsImpl.createRowLayout` (JBTabsImpl.kt:766-772) picks this layout whenever the tabs
// are in a single row (the default), and `WrapMultiRowLayout` otherwise.
//
// Sources, in the order the numbers appear below:
//   SingleRowLayoutStrategy.java:22       MIN_TAB_WIDTH = 50
//   SingleRowLayoutStrategy.java:132-150  getToFitLength (Horizontal)
//   SingleRowLayoutStrategy.java:152-154  getLengthIncrement — the floor applies to *editor* tabs only
//   SingleRowLayoutStrategy.java:156-159  getAdditionalLength (0 without a header-fore toolbar)
//   SingleRowLayoutStrategy.java:187-190  getStartPosition (Top: insets.left)
//   SingleRowLayoutStrategy.java:195-198  drawPartialOverflowTabs (Horizontal: true)
//   SingleRowLayoutStrategy.java:232-242  getMoreRect — the button sits at the right edge
//   SingleRowLayout.java:250-264          calculateRequiredLength / getRequiredLength
//   ScrollableSingleRowLayout.java:60-63  layoutMoreButton (required > fit => the button shows)
//   ScrollableSingleRowLayout.java:118-139 applyTabLayout (the clipping decision)
//   ScrollableSingleRowLayout.java:55-60  clampScrollOffsetToBounds
//   ScrollableSingleRowLayout.java:139-147 isTabHidden
//   TabLayout.java:73                     DEADZONE_FOR_DECLARE_TAB_HIDDEN = 10

/** SingleRowLayoutStrategy.java:22 — the floor for an *editor* tab's width. */
export const MIN_TAB_WIDTH = 50
/** TabLayout.java:73 — how far a tab may fall short before it counts as hidden. */
export const DEADZONE_FOR_TAB_HIDDEN = 10

export interface TabStripInput {
  /** Each tab's preferred width in strip order (`TabLabel.getPreferredSize().width`). */
  preferredWidths: readonly number[]
  /** `JBTabsImpl.getWidth()` — the strip's full width, chrome included. */
  stripWidth: number
  /** `getMoreToolbarPreferredSize().width` — the `…` button (:123-125). */
  moreButtonWidth: number
  /** `getWidth()` of the toolbar the selected tab shows on its right; 0 when there is none. */
  sideToolbarMinWidth?: number
  /** `getLayoutInsets()` (:251-252). */
  insetLeft?: number
  insetRight?: number
  /** `getActionsInsets()`; only `right` positions the more button (:235). */
  actionInsetLeft?: number
  actionInsetRight?: number
  /** `isEditorTabs()` — decides both the width floor (:152-154) and whether the gap is paid (:263). */
  editorTabs?: boolean
  /** `getTabHGap()`. */
  gap?: number
  /** Where the strip is scrolled to; clamped to what the content allows. */
  scrollOffset?: number
}

export interface PlacedTab {
  index: number
  /** Position along the strip axis; negative once scrolled past the front edge. */
  position: number
  /** Width actually given; smaller than the preferred one only when clipped. */
  width: number
  /** The tab did not get its preferred width and is drawn partially (:195-198). */
  clipped: boolean
  /** `isTabHidden` (:139-147). */
  hidden: boolean
}

export interface TabStripLayout {
  requiredLength: number
  /** `getToFitLength` (:132-150) — what the tabs may use. */
  toFitLength: number
  /** `requiredLength > toFitLength` — the `…` button exists exactly then (:60-63). */
  moreButtonVisible: boolean
  /** Where the `…` button starts (:232-242); meaningful only when it is visible. */
  moreButtonPosition: number
  placed: PlacedTab[]
  /** Indices that never got into the strip — they live behind the `…` button. */
  dropped: number[]
  scrollOffset: number
  /** `requiredLength - toFitLength + reserve`, floored at 0 (:55-60). */
  maxScrollOffset: number
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}

/** SingleRowLayoutStrategy.java:152-154 — `max(prefWidth, MIN_TAB_WIDTH)` for editor tabs only. */
export function preferredTabWidth(naturalWidth: number, editorTabs: boolean): number {
  const rounded = Math.round(naturalWidth)
  return editorTabs ? Math.max(rounded, MIN_TAB_WIDTH) : rounded
}

/**
 * `Horizontal.getToFitLength` (:132-150) with no entry-point button and no header-fore
 * toolbar — `length = width - insets.left - insets.right - sideToolbar + startPosition`, and
 * `startPosition` is `insets.left` in that case, so the left inset cancels out.
 */
export function toFitLength(stripWidth: number, insetLeft: number, insetRight: number, sideToolbarMinWidth = 0): number {
  return stripWidth - insetRight - sideToolbarMinWidth
}

/**
 * Layouts the tabs in a single row. Pure: the caller measures the tabs and the strip and
 * gets back the positions, the clipped tab and the ones that dropped out.
 */
export function layoutSingleRow(input: TabStripInput): TabStripLayout {
  const gap = input.gap ?? 0
  const insetLeft = input.insetLeft ?? 0
  const insetRight = input.insetRight ?? 0
  const actionInsetLeft = input.actionInsetLeft ?? 0
  const actionInsetRight = input.actionInsetRight ?? 0
  const editorTabs = input.editorTabs ?? true
  const stripWidth = Math.max(0, input.stripWidth)
  const widths = input.preferredWidths

  const fit = toFitLength(stripWidth, insetLeft, insetRight, input.sideToolbarMinWidth ?? 0)

  // calculateRequiredLength (:250-258) + getRequiredLength (:260-264): the insets, then every
  // tab, and only editor tabs pay the gap. The strategy's getAdditionalLength is 0 here.
  let requiredLength = insetLeft + insetRight
  for (const width of widths) requiredLength += width + (editorTabs ? gap : 0)

  const moreButtonVisible = requiredLength > fit
  // applyTabLayout (:118-123): the button's width, plus the action insets when there is no
  // entry-point button — TaoCode has none, so `entryPointAxisSize == 0` and they are added.
  const moreReserve = moreButtonVisible ? input.moreButtonWidth + actionInsetLeft + actionInsetRight : 0

  // clampScrollOffsetToBounds (:55-60).
  const maxScrollOffset = Math.max(0, requiredLength - fit + moreReserve)
  const scrollOffset = clamp(input.scrollOffset ?? 0, 0, maxScrollOffset)

  // SingleRowLayout.java:112 — `position = getStartPosition(data) - getScrollOffset()`, and
  // the strategy returns `insets.left` without a header-fore toolbar.
  let position = insetLeft - scrollOffset

  const placed: PlacedTab[] = []
  const dropped: number[] = []

  for (let index = 0; index < widths.length; index++) {
    const length = widths[index]
    if (moreButtonVisible && position + length > fit - moreReserve) {
      // applyTabLayout (:119-138): Horizontal.drawPartialOverflowTabs() is true (:195-198),
      // so the tab is drawn clipped to the space that is left instead of vanishing.
      const clippedLength = fit - position - moreReserve
      if (clippedLength > 0) {
        placed.push({ index, position, width: clippedLength, clipped: true, hidden: clippedLength < length - DEADZONE_FOR_TAB_HIDDEN })
      }
      // The rest are laid out at zero size by the source (`layoutStopped`).
      for (let rest = clippedLength > 0 ? index + 1 : index; rest < widths.length; rest++) dropped.push(rest)
      break
    }
    placed.push({ index, position, width: length, clipped: false, hidden: position < -DEADZONE_FOR_TAB_HIDDEN })
    // SingleRowLayout.java:213 advances by the gap regardless of the editor-tab gate.
    position += length + gap
  }

  // Top.getMoreRect (:232-242) pins the button to the right edge of the strip for editor
  // tabs: `x = layoutSize.width - actionsInsets.right - moreRectAxisSize` (entry point 0).
  const moreButtonPosition = stripWidth - actionInsetRight - input.moreButtonWidth

  return {
    requiredLength,
    toFitLength: fit,
    moreButtonVisible,
    moreButtonPosition,
    placed,
    dropped,
    scrollOffset,
    maxScrollOffset,
  }
}


/**
 * `isTabHidden` (:139-147): short by more than the deadzone of its width, or past the front
 * edge. The height half only matters for side tabs, which have no place here yet.
 */
export function isTabHidden(placed: PlacedTab, preferredWidth: number): boolean {
  return placed.hidden
    || placed.width < preferredWidth - DEADZONE_FOR_TAB_HIDDEN
    || placed.position < -DEADZONE_FOR_TAB_HIDDEN
}
