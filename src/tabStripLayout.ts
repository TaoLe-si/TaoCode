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
// TaoCode 取的是这条布局**本来就有的**另一半：滚轮滚动。上游给标签条装了滚轮监听
// （`JBTabsImpl.kt:570-577`：水平标签补上 SHIFT_DOWN_MASK 后转给那条隐藏滚动条，
// `isWithScrollBar` 在编辑器标签这里是 false，见 :24-26/:703-705），并在每次布局里把选中项
// 滚进可视区（`recomputeToLayout` → `doScrollToSelectedTab`，:105-111）。因此这里给「…」
// **预留 0 宽**（上游同一件事：`getMoreRectAxisSize()` 在 New UI 侧边标签就是 0，:167-172），
// 溢出的标签画到右边缘为止，尾巴靠滚动取回。
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
/**
 * 多行布局里一行的高度。上游是 `MultiRowPassInfo.rowHeight = tabs.headerFitSize.height`
 * （每行同高），本仓的对应物就是 `.editor-tabs` 的单行高度（style.css 的 34px）——
 * 放在这里是为了让"条总高 = rowCount × 行高"这条能机检，而不是让 CSS 与 JS 各写一个数。
 */
export const TAB_STRIP_ROW_HEIGHT = 34

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

/**
 * `ide.editor.max.pinned.tab.width`（`platform/util/resources/misc/registry.properties:169` = 2000）：
 * 固定标签的**宽度上限**（`TabLabel.getPreferredSize`，`TabLabel.kt:298-304`：`if (isPinned)
 * size.width = min(getMaxPinnedTabWidth(), size.width)`；`TableLayout.java:242` 同样夹一次）。
 * 没有这条，一个长路径的固定标签会独占整条。
 */
export const MAX_PINNED_TAB_WIDTH = 2000

/** SingleRowLayoutStrategy.java:152-154 — `max(prefWidth, MIN_TAB_WIDTH)` for editor tabs only. */
export function preferredTabWidth(naturalWidth: number, editorTabs: boolean, pinned = false): number {
  const rounded = Math.round(naturalWidth)
  const floored = editorTabs ? Math.max(rounded, MIN_TAB_WIDTH) : rounded
  return pinned ? Math.min(MAX_PINNED_TAB_WIDTH, floored) : floored
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

/**
 * `doScrollToSelectedTab`（ScrollableSingleRowLayout.java:68-103）：选中项落在可视窗口之外时，
 * 返回该交给 `scroll(units)`（:39-42）的那个 `units`；0 = 已经完整可见，不用动。
 *
 * 三条都照源码，包括两个容易自己发明出来的地方：
 *   · 累加的是 `getRequiredLength(info)`（SingleRowLayout.java:260-264：编辑器标签要**再算上
 *     标签间距**），不是纯宽度；
 *   · 右侧的界是 `toFitLength - moreRectAxisSize`（:80-81），没有入口按钮时再减动作内缩（:82-85），
 *     本仓两者都是 0；
 *   · 选中项**自己比整条还宽**时不把它右对齐出去，而是把它的左沿贴到左边缘（:91-96 的 else 分支）。
 * 上游还有第四点：鼠标在标签条上、或正在拖滚动条、或刚滚过（:69-71）时**什么都不做**，
 * 那是调用方的守卫，不在这条纯函数里。
 */
export function scrollUnitsToShowTab(input: {
  /** 与布局同一份的首选宽度（`preferredWidths`）；`gap` 非 0 时按 `getRequiredLength` 加上。 */
  requiredLengths: readonly number[]
  /** 选中项在其中的下标。 */
  index: number
  scrollOffset: number
  toFitLength: number
  /** `getMoreRectAxisSize()`；本仓不给「…」留位，所以是 0。 */
  moreReserve?: number
}): number {
  let offset = -input.scrollOffset
  for (let i = 0; i < input.index; i++) offset += input.requiredLengths[i] ?? 0
  const length = input.requiredLengths[input.index] ?? 0
  if (offset < 0) return offset
  const maxLength = input.toFitLength - (input.moreReserve ?? 0)
  if (offset + length > maxLength) return length < maxLength ? offset + length - maxLength : offset
  return 0
}

// ---------------------------------------------------------------------------
// 多行（wrap）布局：`multiRow.WrapMultiRowLayout.kt` + `SimpleTabsRow.kt` + `TabsRow.kt`
//
// 上游选哪一种是**设置驱动**的，不是"放不下了才换行"：
//   `JBTabsImpl.createRowLayout`（platform-api/.../tabs/impl/JBTabsImpl.kt:766-773）
//     `tabListOptions.singleRow` ⇒ `ScrollableSingleRowLayout`，否则 ⇒ `WrapMultiRowLayout`；
//   `EditorTabbedContainer.kt:582-584` 把它绑到 `UISettings.scrollTabLayoutInEditor`
//   （`UISettingsState.kt:123` 默认 **true**），设置页那一行的文案是
//   `checkbox.editor.tabs.in.single.row=Show tabs in one row`（ApplicationBundle.properties:316）。
//
// 与单行的三点本质差别，逐条照源码：
//   · 标签**永远按自然宽度画**，不裁切（`SimpleTabsRow.layoutTabs` 直接用 `data.lengths` 的 len）；
//   · 没有 `…`、也不能滚动（`MultiRowLayout.isWithScrollBar()=false`、`getScrollOffset()=0`、
//     `scroll(units)` 是空实现）；
//   · 只有**第一行**为左侧标题与右侧工具条让位（`WrapMultiRowLayout.splitToRows`：
//     `firstRowWidth = rightmostX - leftmostX`，其余行是整块宽 `data.toFitRec.width`；
//     `TabsRow.layoutTitleAndEntryPoint` 的 `withTitle/withEntryPointToolbar` 又只在 `isFirst` 为真）。
// ---------------------------------------------------------------------------

/** 一个放进第 `row` 行、从 `position` 起画的标签。 */
export interface PlacedRowTab {
  index: number
  row: number
  position: number
  width: number
}

export interface MultiRowLayout {
  placed: PlacedRowTab[]
  rowCount: number
  /** 每行一条标签的高度；条总高 = `rowCount * rowHeight`（上游 `rowHeight = headerFitSize.height`）。 */
  rowHeight: number
  /** 多行布局没有"更多"按钮，也永远不滚动。 */
  moreButtonVisible: false
  scrollOffset: 0
}

/**
 * 换行装箱：逐行照 `WrapMultiRowLayout.doSplitToRows` 写，包括两个容易写错的地方 ——
 * ① 换行时新行的 `curLen` 归零后**仍要加上本标签的宽度与间距**（源码就是 `curLen = 0` 之后
 *   统一 `curLen += len + tabHGap`）；② 单个标签比整行还宽时不会裁切，它独占一行照原宽画
 *   （源码的 else 分支无条件把它开进新行）。
 */
/**
 * `MultiRowLayout.splitToPinnedUnpinned`（`MultiRowLayout.kt:105-120`）：固定标签全部在最前面，
 * 找到**最后一个**固定标签的位置，它（含）之前是固定排、之后是未固定排；一个固定的都没有时返回空的第一排。
 *
 * 上游还有一条特例：若紧跟在最后一个固定标签后面的那一项是**拖放占位**（`tabs.isDropTarget(it)`），
 * 把它一并划进固定排（`:111-114`）。本仓的多行布局没有拖放占位模型（拖拽只在单行布局里做），
 * 所以这一支如实不做 —— 硬凑一个"占位"只会是假逻辑。
 */
export function splitPinnedRow(pinned: readonly boolean[]): { pinnedCount: number; hasPinned: boolean } {
  let last = -1
  for (let index = 0; index < pinned.length; index++) if (pinned[index]) last = index
  return { pinnedCount: last + 1, hasPinned: last >= 0 }
}

/**
 * `TabLayout.showPinnedTabsSeparately()`（`TabLayout.java:75-78`）：**两个**开关同时为真才分行 ——
 * 设置页的 `showPinnedTabsInASeparateRow`（`UISettingsState.kt:127`，默认 false）
 * 与高级设置 `editor.keep.pinned.tabs.on.left`（`intellij.platform.ide.impl.xml:1514`，默认 true）。
 */
export function showsPinnedTabsSeparately(showPinnedTabsInASeparateRow: boolean, keepPinnedTabsOnLeft: boolean): boolean {
  return showPinnedTabsInASeparateRow && keepPinnedTabsOnLeft
}

export function layoutMultiRow(input: TabStripInput & { rowHeight?: number; pinned?: readonly boolean[]; separatePinnedRow?: boolean }): MultiRowLayout {
  const gap = input.gap ?? 0
  const insetLeft = input.insetLeft ?? 0
  const insetRight = input.insetRight ?? 0
  const stripWidth = Math.max(0, input.stripWidth)
  const sideToolbar = input.sideToolbarMinWidth ?? 0
  const rowHeight = Math.max(1, input.rowHeight ?? TAB_STRIP_ROW_HEIGHT)
  const fullRowWidth = Math.max(0, stripWidth - insetLeft - insetRight)
  // 第一行右侧要留给标签条上的工具条（对应上游只在 `isFirst` 时保留 entryPointToolbar）。
  const firstRowWidth = Math.max(0, fullRowWidth - sideToolbar)
  const rowCapacity = (row: number) => (row === 0 ? firstRowWidth : fullRowWidth)

  // 固定标签单独成排（`WrapMultiRowLayout.splitToRows:24-45`）：固定那一排**先**加进 rows，
  // 未固定的从新的一排开始排；不开启时就是一条连续序列（本仓原来的行为）。
  const split = input.separatePinnedRow ? splitPinnedRow(input.pinned ?? []) : { pinnedCount: 0, hasPinned: false }
  const placed: PlacedRowTab[] = []
  let row = 0
  let rowLengths: number[] = [0]
  for (let index = 0; index < input.preferredWidths.length; index++) {
    const width = input.preferredWidths[index]!
    // 固定排与未固定排的分界：未固定项的第一项另起一排（固定排自己也要付 gap，与上游同一处累加）。
    if (split.hasPinned && index === split.pinnedCount) { row++; rowLengths[row] = 0 }
    else if (index > 0 && rowLengths[row] !== 0) rowLengths[row] = (rowLengths[row] ?? 0) + gap
    if ((rowLengths[row] ?? 0) + width > rowCapacity(row) && (rowLengths[row] ?? 0) > 0) {
      row++
      rowLengths[row] = 0
    }
    const position = insetLeft + (rowLengths[row] ?? 0)
    placed.push({ index, row, position, width })
    rowLengths[row] = (rowLengths[row] ?? 0) + width
  }
  return { placed, rowCount: row + (input.preferredWidths.length ? 1 : 0), rowHeight, moreButtonVisible: false, scrollOffset: 0 }
}

