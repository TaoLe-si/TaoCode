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
  /**
   * 多行布局里**换行排**没有"更多"按钮、也永远不滚动（`MultiRowLayout.isWithScrollBar()=false`、
   * `getScrollOffset()=0`）；滚动排（`layoutScrollableMultiRow`）两样都有，所以这里放宽成
   * 普通类型，由各自的返回类型收窄。
   */
  moreButtonVisible: boolean
  scrollOffset: number
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


// ---------------------------------------------------------------------------
// 多行的另外两种排法：**挤压**（`CompressibleMultiRowLayout` / `CompressibleTabsRow`）与
// **滚动**（`ScrollableMultiRowLayout` / `ScrollableTabsRow`）。
//
// 选哪一种由设置决定（`EditorTabbedContainer.kt:657-672` 的 `createRowLayout`）：
//
//   if (!isSingleRow || (isHorizontalTabs && (showPinnedTabsSeparately() || !hideTabsIfNeeded))) {
//     !isSingleRow                        -> WrapMultiRowLayout          ← 本仓的 layoutMultiRow
//     UISettings.hideTabsIfNeeded         -> ScrollableMultiRowLayout    ← layoutScrollableMultiRow
//     else                                -> CompressibleMultiRowLayout  ← layoutCompressibleMultiRow
//   } else                                 ScrollableSingleRowLayout      ← 本仓的 layoutSingleRow
//
// `UISettingsState.kt:125` `var hideTabsIfNeeded: Boolean by property(true)` ⇒ **默认 true**，
// 设置页那两组单选的文案（`ApplicationBundle.properties:681-685`，中文取随 IDE 发货的语言包）：
//   一行，如果标签页不适合：→ 滚动标签页面板（hideTabsIfNeeded=true）/ 挤压标签页（=false） / 多行
//
// 两者共同的**分行**规则是 `splitToPinnedUnpinned`（`MultiRowLayout.kt:105-120`，本仓的
// `splitPinnedRow`）：固定排那一行永远是**挤压**的（`ScrollableMultiRowLayout.splitToRows`
// 里固定排也用 `CompressibleTabsRow`），未固定排才是滚动的那一行。
// ---------------------------------------------------------------------------

/**
 * 挤压时每个标签的下限。
 *
 * 上游的下限来自 `minTabInsets`（`CompressibleTabsRow.calculateDecreasedInsets` 的最后一支：
 * 缩到"最小装饰"为止），那是 Swing 侧 insets 的和 —— 本仓标签的装饰是 CSS padding 加一个
 * 关闭按钮，量不出 insets 这个中间量。取一个能让图标与关闭按钮都还在的常量，并在
 * `tests/tab-strip-layout.test.mjs` 里钉住"挤压后不会小于它"。
 */
export const MIN_COMPRESSED_TAB_WIDTH = 32

/**
 * `CompressibleTabsRow.decreaseMaxLengths`（`CompressibleTabsRow.kt:127-166`）：把总长降到
 * `maxLength`，**从最长的开始降**，因此最短的那几条最后才动。
 *
 * 上游的推导写得很绕（先算前缀和的"全都降到第 i 档"序列，再 `indexOfFirst { it >= maxLength }`
 * 找分界），这里照抄同一套：分界之前的长度**原样保留**，分界及之后的全部取平均并分配余数。
 * 这样得到的性质与上游一致 —— ① 总和（尽量）等于上限；② 短的不会被压得比长的还窄。
 */
export function decreaseMaxLengths(lengths: readonly number[], maxLength: number, floor = MIN_COMPRESSED_TAB_WIDTH): number[] {
  const count = lengths.length
  if (!count) return []
  const sorted = lengths.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value)
  const indexes = sorted.map(entry => entry.index)
  const values = sorted.map(entry => entry.value)

  // sums[i] = 把"下标 i 及之后的全降到 values[i]"之后的总长（上游同一套前缀和）。
  const sums: number[] = new Array(count).fill(0)
  sums[0] = values[0]! * count
  for (let i = 1; i < count; i++) sums[i] = sums[i - 1]! + (values[i]! - values[i - 1]!) * (count - i)

  // 从哪一档开始降：分界之前原样保留，分界及之后平摊剩下的额度。
  const cut = sums.findIndex(sum => sum >= maxLength)
  const result: number[] = new Array(count).fill(0)
  // 预算比"一个都不压"还宽裕（`maxLength >= 自然总长`）：没有要压的东西，原样返回。
  // 上游不会走到这里（调用点已经保证 required > maxLength），但不能靠调用点活着。
  if (cut < 0) return [...lengths]
  for (let i = 0; i < cut; i++) result[indexes[i]!] = values[i]!
  const kept = values.slice(0, cut).reduce((sum, value) => sum + value, 0)
  const budget = Math.max(0, maxLength - kept)
  const share = Math.floor(budget / (count - cut))
  let remainder = budget - share * (count - cut)
  for (let i = cut; i < count; i++) {
    const computed = share + (remainder-- > 0 ? 1 : 0)
    // 下限是"还能认出这是个标签"的宽度；**但绝不把本来就更窄的标签抬高** ——
    // 上游的下限来自 `minTabInsets`（恒 ≤ 当前长度），抬高了反而会让总长超过预算。
    result[indexes[i]!] = Math.min(values[i]!, Math.max(floor, computed))
  }
  return result
}

/** 挤压排（`CompressibleTabsRow`）：不超就按自然宽，超了就把最长的先压下去。 */
export function compressRowWidths(preferredWidths: readonly number[], maxLength: number, gap = 0): number[] {
  const gaps = gap * Math.max(0, preferredWidths.length - 1)
  const required = preferredWidths.reduce((sum, width) => sum + width, 0) + gaps
  if (required <= maxLength) return [...preferredWidths]
  return decreaseMaxLengths(preferredWidths, Math.max(0, maxLength - gaps))
}

export interface CompressibleRowLayout extends MultiRowLayout {
  /** 每一行分到多宽（`rowCapacity`），供渲染层与判据核。 */
  rowWidths: number[]
}

/**
 * `CompressibleMultiRowLayout`（`CompressibleMultiRowLayout.kt:20-36`）：**一行**时就是一条挤压排；
 * `showPinnedTabsSeparately` 时固定一条 + 未固定一条。注意它**不换行** —— 挤不下就继续压，
 * 这是它与 `WrapMultiRowLayout` 的本质差别（上游的 `splitToRows` 只产出 1～2 条 row）。
 */
export function layoutCompressibleMultiRow(input: TabStripInput & { rowHeight?: number; pinned?: readonly boolean[]; separatePinnedRow?: boolean }): CompressibleRowLayout {
  const gap = input.gap ?? 0
  const insetLeft = input.insetLeft ?? 0
  const insetRight = input.insetRight ?? 0
  const stripWidth = Math.max(0, input.stripWidth)
  const sideToolbar = input.sideToolbarMinWidth ?? 0
  const rowHeight = Math.max(1, input.rowHeight ?? TAB_STRIP_ROW_HEIGHT)
  const fullRowWidth = Math.max(0, stripWidth - insetLeft - insetRight)
  const firstRowWidth = Math.max(0, fullRowWidth - sideToolbar)
  const split = input.separatePinnedRow ? splitPinnedRow(input.pinned ?? []) : { pinnedCount: 0, hasPinned: false }

  const pinnedWidths = split.hasPinned ? input.preferredWidths.slice(0, split.pinnedCount) : []
  const restWidths = split.hasPinned ? input.preferredWidths.slice(split.pinnedCount) : [...input.preferredWidths]
  const rows: { widths: number[]; base: number; capacity: number }[] = []
  if (split.hasPinned) {
    rows.push({ widths: compressRowWidths(pinnedWidths, firstRowWidth, gap), base: 0, capacity: firstRowWidth })
    if (restWidths.length) rows.push({ widths: compressRowWidths(restWidths, fullRowWidth, gap), base: split.pinnedCount, capacity: fullRowWidth })
  } else {
    rows.push({ widths: compressRowWidths(restWidths, firstRowWidth, gap), base: 0, capacity: firstRowWidth })
  }

  const placed: PlacedRowTab[] = []
  rows.forEach((row, rowIndex) => {
    let position = insetLeft
    row.widths.forEach((width, offset) => {
      placed.push({ index: row.base + offset, row: rowIndex, position, width })
      position += width + gap
    })
  })
  return {
    placed, rowCount: rows.length, rowHeight,
    moreButtonVisible: false, scrollOffset: 0,
    rowWidths: rows.map(row => row.capacity),
  }
}

export interface ScrollableRowLayout extends MultiRowLayout {
  /** 「…」按钮的左边（相对标签条），`ScrollableTabsRow.layoutTabs` 的 `moreRect.x`。 */
  moreButtonPosition: number
  /** 当前滚动偏移（夹过）。 */
  scrollOffset: number
  maxScrollOffset: number
  /** 被挤出可视区的标签下标（渲染层给它们 0 宽）。 */
  dropped: number[]
}

/**
 * `ScrollableTabsRow.layoutTabs`（`ScrollableTabsRow.kt:22-49`）：自然宽度之和超出行宽时，
 * 右边留给「…」按钮，标签**从右边缘裁掉**（`len = max(0, x + tabsLength - curX)`），
 * 其余靠 `scrollOffset` 往左推。
 *
 * 固定排沿用上游的选择：`ScrollableMultiRowLayout.splitToRows` 里固定那一排是
 * **CompressibleTabsRow**（`ScrollableMultiRowLayout.kt:22-29`），所以这里第一行按挤压排、
 * 第二行才是可滚动的。
 */
export function layoutScrollableMultiRow(input: TabStripInput & { rowHeight?: number; pinned?: readonly boolean[]; separatePinnedRow?: boolean }): ScrollableRowLayout {
  const gap = input.gap ?? 0
  const insetLeft = input.insetLeft ?? 0
  const insetRight = input.insetRight ?? 0
  const stripWidth = Math.max(0, input.stripWidth)
  const sideToolbar = input.sideToolbarMinWidth ?? 0
  const rowHeight = Math.max(1, input.rowHeight ?? TAB_STRIP_ROW_HEIGHT)
  const fullRowWidth = Math.max(0, stripWidth - insetLeft - insetRight)
  const firstRowWidth = Math.max(0, fullRowWidth - sideToolbar)
  const split = input.separatePinnedRow ? splitPinnedRow(input.pinned ?? []) : { pinnedCount: 0, hasPinned: false }
  const moreWidth = Math.max(0, input.moreButtonWidth)

  // 无固定排时只有一条可滚动的 row（`ScrollableMultiRowLayout.splitToRows` 的最后一支）。
  if (!split.hasPinned) {
    return scrollableRow(input.preferredWidths, 0, 0, firstRowWidth, { gap, insetLeft, rowHeight, moreWidth, scrollOffset: input.scrollOffset ?? 0 })
  }
  const pinned = compressRowWidths(input.preferredWidths.slice(0, split.pinnedCount), firstRowWidth, gap)
  const rest = input.preferredWidths.slice(split.pinnedCount)
  const placed: PlacedRowTab[] = []
  let position = insetLeft
  pinned.forEach((width, offset) => { placed.push({ index: offset, row: 0, position, width }); position += width + gap })
  // `splitToRows` 只在**真有未固定标签**时才建第二条 row：全部都是固定标签时只有固定那一排，
  // 不能再给一条恒空的可滚动行（那会让条高多出一整行、也给不出任何标签）。
  if (!rest.length) {
    return {
      placed, rowCount: 1, rowHeight,
      moreButtonVisible: false, scrollOffset: 0, maxScrollOffset: 0, dropped: [],
      moreButtonPosition: insetLeft + firstRowWidth - moreWidth,
    }
  }
  const scroll = scrollableRow(rest, 1, split.pinnedCount, fullRowWidth, { gap, insetLeft, rowHeight, moreWidth, scrollOffset: input.scrollOffset ?? 0 })
  return { ...scroll, placed: [...placed, ...scroll.placed], rowCount: 2 }
}

function scrollableRow(
  widths: readonly number[], row: number, base: number, capacity: number,
  options: { gap: number; insetLeft: number; rowHeight: number; moreWidth: number; scrollOffset: number },
): ScrollableRowLayout {
  const { gap, insetLeft, rowHeight, moreWidth } = options
  const requiredLength = widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, widths.length - 1)
  // `ScrollableTabsRow.kt:31-36`：放不下才给「…」留位置，放得下时按钮不占宽。
  const overflows = requiredLength > capacity
  const tabsLength = overflows ? Math.max(0, capacity - moreWidth) : capacity
  const maxScrollOffset = Math.max(0, requiredLength - tabsLength)
  const scrollOffset = clamp(options.scrollOffset, 0, maxScrollOffset)

  const placed: PlacedRowTab[] = []
  const dropped: number[] = []
  let cursor = insetLeft - scrollOffset
  for (let index = 0; index < widths.length; index++) {
    const length = widths[index]!
    // 右边缘裁切：`len = max(0, x + tabsLength - curX)`，`<= |gap|` 的直接给 0 宽（上游那一行）。
    const clipped = cursor + length > insetLeft + tabsLength ? Math.max(0, insetLeft + tabsLength - cursor) : length
    const effective = clipped <= Math.abs(gap) ? 0 : clipped
    // `dropped` 与 `placed` 一样用**条内全局下标**（`base + index`）：`isTabDropped` 拿它跟
    // 标签的真实下标比，固定排开着时若记局部下标，会把固定排里同样下标的标签误判成"掉出条外"
    // （真机上就是"明明在条的左端，宽度却被写成 0"）。
    if (effective <= 0) dropped.push(base + index)
    else placed.push({ index: base + index, row, position: cursor, width: effective })
    cursor += length + gap
  }
  return {
    placed, rowCount: 1, rowHeight,
    moreButtonVisible: false,
    scrollOffset, maxScrollOffset, dropped,
    // `Top.getMoreRect`（SingleRowLayoutStrategy.java:232-242）：按钮贴在右边缘。
    moreButtonPosition: insetLeft + capacity - moreWidth,
  }
}