// 标签条的**单行布局** —— 从 App.vue 搬出的一域（96 行，4 个依赖）。
//
// 判据：IDEA 的 `ScrollableSingleRowLayout`（JBTabsImpl.kt:766-772）名字里的 Scrollable 就是它
// 处理溢出的方式：**滚轮滚动 + 每次布局把选中项滚进可视区**，标签画到右边缘为止。算法本身在
// src/tabStripLayout.ts（纯函数，可单测），这个模块只做**测量、滚动状态与缓存**那一半：
//   · `measureTabNaturalWidth` 按 `TabLabel.getPreferredSize()` 的方式量自然宽度，
//     并且必须先清掉我们刚写上去的宽度再量（否则量到的是自己设的值），量到 0 不缓存；
//   · `recomputeTabStrip` 收集首选宽度 + 标签条宽度 + 工具条宽度 + 当前滚动偏移，喂给
//     `layoutSingleRow`，并按 `doScrollToSelectedTab` 把选中项滚进来；
//   · `onTabStripWheel`/`scrollTabStrip` 是那条滚轮监听（JBTabsImpl.kt:570-577）的对应物；
//   · `observeTabStrips` 用 ResizeObserver 跟着窗口/分栏尺寸重算。
// 拖放是另一个域（src/tabDragDrop.ts）；这里只读 `groups` 与分栏尺寸。
import { nextTick, ref, watch } from 'vue'
import type { Pane } from './editorGroups'
import { MIN_TAB_WIDTH, TAB_STRIP_ROW_HEIGHT, layoutMultiRow, layoutSingleRow, preferredTabWidth, scrollUnitsToShowTab, type MultiRowLayout, type TabStripLayout } from './tabStripLayout'
import type { Tab } from './editorTab'

export interface TabStripViewDeps {
  /** 两个分栏组（宿主自持的编辑器模型）。 */
  groups: any
  /** 分栏宽度与方向：标签条宽度变化时要重算。 */
  splitSize: { readonly value: number }
  /** 分栏方向（`splitModel.orientation`）。 */
  splitOrientation: { readonly value: string }
  /**
   * 「显示一行」（IDEA `UISettings.scrollTabLayoutInEditor`，`EditorTabbedContainer.kt:582-584`）。
   * true → `ScrollableSingleRowLayout`（裁切 + 滚动），false → `WrapMultiRowLayout`（换行、不裁切、
   * 也不能滚动）。选哪一种由**设置**决定，不是"放不下了才换行"。
   */
  singleRow: () => boolean
  /** 固定标签是否单独成排（`TabLayout.showPinnedTabsSeparately()`；宿主读设置后传进来）。 */
  separatePinnedRow: () => boolean
}

export function createTabStripView(deps: TabStripViewDeps) {
  const { groups, splitSize, splitOrientation, singleRow, separatePinnedRow } = deps
// The natural width is cached per tab key: once widths are applied, measuring the element
// again would report the width we just set, so a tab is only measured while it is still free
// to size itself (`node.style.width` cleared for the measurement and restored afterwards).
const tabNaturalWidths = new Map<string, number>()
const tabStripLayouts = ref<[TabStripLayout | null, TabStripLayout | null]>([null, null])
const tabMultiLayouts = ref<[MultiRowLayout | null, MultiRowLayout | null]>([null, null])
const tabStripNodes: [HTMLElement | null, HTMLElement | null] = [null, null]
/** 每栏的滚动偏移（像素）；上游是 `myScrollOffset`，`scroll(units)` 只是 `+= units` 再夹一次。 */
const tabScrollOffsets = ref<[number, number]>([0, 0])
/**
 * 鼠标是否在这条标签条上 —— 上游那个守卫（`doScrollToSelectedTab` :69-71 读
 * `tabs.isMouseInsideTabsArea()`）：用户正在自己滚的时候，布局不许把偏移抢回去。
 */
const tabStripHovers: [boolean, boolean] = [false, false]
function registerTabStrip(pane: Pane, element: unknown) {
  tabStripNodes[pane] = (element as HTMLElement | null) ?? null
}
function setTabStripHover(pane: Pane, inside: boolean) {
  if (tabStripHovers[pane] === inside) return
  tabStripHovers[pane] = inside
  // 手离开标签条的那一刻补一次：选中的那个可能正被裁在边缘外。
  if (!inside) recomputeTabStrip(pane)
}
function tabKeyOf(pane: Pane, path: string) { return `${pane}:${path}` }
function measureTabNaturalWidth(node: HTMLElement, key: string): number {
  const cached = tabNaturalWidths.get(key)
  if (cached !== undefined) return cached
  const previousWidth = node.style.width
  const previousMax = node.style.maxWidth
  node.style.width = 'auto'
  node.style.maxWidth = 'none'
  const width = node.getBoundingClientRect().width
  node.style.width = previousWidth
  node.style.maxWidth = previousMax
  // A dropped tab is `display: none` and reports no box; do not cache that, so the tab is
  // measured for real the next time it is on screen.
  if (width < 1) return 0
  tabNaturalWidths.set(key, width)
  return width
}
function recomputeTabStrip(pane: Pane) {
  const strip = tabStripNodes[pane]
  const tabs = groups[pane].tabs
  if (!strip || !tabs.length) { tabStripLayouts.value[pane] = null; tabMultiLayouts.value[pane] = null; return }
  const nodes = Array.from(strip.querySelectorAll<HTMLElement>('.file-tab'))
  const preferredWidths = tabs.map((tab: Tab, index: number) => {
    const node = nodes[index]
    if (!node) return MIN_TAB_WIDTH
    const natural = measureTabNaturalWidth(node, tabKeyOf(pane, tab.path))
    // 固定标签走宽度上限（`TabLabel.getPreferredSize` 的 isPinned 分支）。
    return natural < 1 ? MIN_TAB_WIDTH : preferredTabWidth(natural, true, Boolean(tab.pinned))
  })
  const box = strip.getBoundingClientRect()
  // `getToFitLength` (:132-150) subtracts the tab-side toolbar, so measure it here.
  const toolbar = strip.querySelector<HTMLElement>('.tab-toolbar')
  const sideToolbarMinWidth = toolbar ? toolbar.getBoundingClientRect().width : 0
  if (singleRow()) {
    tabMultiLayouts.value[pane] = null
    const input = {
      preferredWidths, stripWidth: box.width,
      // 「…」不留位置：溢出的那条画到右边缘为止，尾巴靠滚动（见文件头）。
      moreButtonWidth: 0, sideToolbarMinWidth, insetLeft: 0, insetRight: 0, editorTabs: true, gap: 0,
      scrollOffset: tabScrollOffsets.value[pane],
    }
    let layout = layoutSingleRow(input)
    // recomputeToLayout（:105-111）：夹一次 → 把选中项滚进来 → 再夹一次。第二次夹由下一次
    // `layoutSingleRow` 做（它内部就是 clampScrollOffsetToBounds），所以这里只补 units。
    if (!tabStripHovers[pane]) {
      const index = tabs.findIndex((tab: Tab) => tab.path === groups[pane].activePath)
      const units = index < 0 ? 0 : scrollUnitsToShowTab({
        requiredLengths: preferredWidths, index,
        scrollOffset: layout.scrollOffset, toFitLength: layout.toFitLength,
      })
      if (units !== 0) layout = layoutSingleRow({ ...input, scrollOffset: layout.scrollOffset + units })
    }
    // 上游 `scroll()` 把夹完的值写回 `myScrollOffset`，状态里因此不会留下越界的偏移
    // （关掉一批标签后 max 变小，陈旧偏移会被拉回来，下一次滚动不会从空气里起步）。
    tabScrollOffsets.value[pane] = layout.scrollOffset
    tabStripLayouts.value[pane] = layout
    return
  }
  // 多行：行高写死成一条标签的高度（上游 `rowHeight = headerFitSize.height`），标签绝对定位到
  // 自己那一行 —— 容器高度由布局给，不靠内容撑起来，量一次就稳定，不会和 ResizeObserver 互相喂。
  tabStripLayouts.value[pane] = null
  tabScrollOffsets.value[pane] = 0
  tabMultiLayouts.value[pane] = layoutMultiRow({
    preferredWidths, stripWidth: box.width, moreButtonWidth: 0,
    sideToolbarMinWidth, insetLeft: 0, insetRight: 0, editorTabs: true, gap: 0, rowHeight: TAB_STRIP_ROW_HEIGHT,
    // 固定标签单独成排（设置页那一条；上游还要高级设置 `editor.keep.pinned.tabs.on.left`，
    // 那条在 IDEA 里默认 true 且本仓没有消费者，见 settingsModel 的注释）。
    pinned: tabs.map((tab: Tab) => Boolean(tab.pinned)),
    separatePinnedRow: separatePinnedRow(),
  })
}
function placedTabFor(pane: Pane, index: number) {
  return tabStripLayouts.value[pane]?.placed.find(entry => entry.index === index) ?? null
}
function isTabDropped(pane: Pane, index: number): boolean {
  const layout = tabStripLayouts.value[pane]
  return Boolean(layout && layout.dropped.includes(index))
}
// A dropped tab is laid out at zero width, not `display: none`: the source's `layoutStopped`
// gives it an empty rect, and keeping the box (with its padding) is also what lets
// `measureTabNaturalWidth` still report its real preferred width for the next pass.
function tabWidthStyle(pane: Pane, index: number) {
  const multi = tabMultiLayouts.value[pane]
  if (multi) {
    // 多行：每个标签绝对落到自己那一行（上游 `SimpleTabsRow.layoutTabs` 按 `curX += len + gap` 推进）。
    const placed = multi.placed.find(entry => entry.index === index)
    return placed
      ? { position: 'absolute' as const, left: `${placed.position}px`, top: `${placed.row * multi.rowHeight}px`, width: `${placed.width}px`, flex: '0 0 auto' }
      : undefined
  }
  // 单行的滚动落在**第一条**的负左边距上：`SingleRowLayout.java:112` 的
  // `position = getStartPosition(data) - getScrollOffset()` 就是"整排往左移 offset"，移出左
  // 边缘的那些由 `.editor-tabs` 的 overflow 裁掉（右侧工具条有 `margin-left: auto`，不参与）。
  const offset = tabStripLayouts.value[pane]?.scrollOffset ?? 0
  const shift = index === 0 && offset > 0 ? { marginLeft: `${-offset}px` } : {}
  if (isTabDropped(pane, index)) return { width: '0px', ...shift, flex: '0 0 auto' }
  const placed = placedTabFor(pane, index)
  return placed ? { width: `${placed.width}px`, ...shift, flex: '0 0 auto' } : undefined
}
/**
 * `scroll(units)`（ScrollableSingleRowLayout.java:39-42）：偏移 += units，越界由下一次的
 * `clampScrollOffsetToBounds`（:49-66）夹回来 —— 也就是交给 `recomputeTabStrip`。
 * 多行布局不做这件事（上游 `MultiRowLayout.scroll()` 是空实现）。
 */
function scrollTabStrip(pane: Pane, units: number) {
  const layout = tabStripLayouts.value[pane]
  if (!layout || units === 0) return
  tabScrollOffsets.value[pane] = layout.scrollOffset + units
  recomputeTabStrip(pane)
}
/**
 * 滚轮落在标签条上 = 横向滚动它。上游那条监听（JBTabsImpl.kt:570-577）先给水平标签补上
 * `SHIFT_DOWN_MASK`，让**竖向**滚轮驱动横向滚动条；这里同理，竖向 delta 优先，触控板的
 * 横向滑动（只有 deltaX）接着。放不下（`maxScrollOffset` 为 0）时不拦事件，让它照原路走。
 */
function onTabStripWheel(pane: Pane, event: WheelEvent) {
  const units = event.deltaY !== 0 ? event.deltaY : event.deltaX
  if (!units) return
  const layout = tabStripLayouts.value[pane]
  if (!layout || layout.maxScrollOffset <= 0) return
  event.preventDefault()
  scrollTabStrip(pane, units)
}
/** 标签条自己的高度：多行时 = 行数 × 行高（上游 `rowCount * rowHeight`），单行交给 CSS。 */
function tabStripStyle(pane: Pane) {
  const multi = tabMultiLayouts.value[pane]
  if (!multi) return undefined
  const height = `${multi.rowCount * multi.rowHeight}px`
  return { height, minHeight: height }
}
/** 模板据此切 CSS 分支（绝对定位 + 工具条只占第一行）。 */
function tabStripWraps(pane: Pane) { return tabMultiLayouts.value[pane] !== null }
let tabStripObserver: ResizeObserver | null = null
function observeTabStrips() {
  if (typeof ResizeObserver === 'undefined' || tabStripObserver) return
  tabStripObserver = new ResizeObserver(() => { recomputeTabStrip(0); recomputeTabStrip(1) })
  for (const node of tabStripNodes) if (node) tabStripObserver.observe(node)
}
// Re-measure whenever the tab set, the **active tab**, the split size or the strip's own size
// changes. 选中项必须在里面：上游是在每次布局里滚它（recomputeToLayout），切标签不重算就滚不动。
watch(() => [groups[0].tabs.map((tab: Tab) => tab.path).join('|'), groups[1].tabs.map((tab: Tab) => tab.path).join('|'), groups[0].activePath, groups[1].activePath, splitSize.value, splitOrientation.value, singleRow()].join('~'), async () => {
  await nextTick()
  recomputeTabStrip(0)
  recomputeTabStrip(1)
  observeTabStrips()
}, { immediate: true })
  return {
    tabNaturalWidths, tabStripLayouts, tabScrollOffsets, registerTabStrip, tabKeyOf,
    measureTabNaturalWidth, recomputeTabStrip, placedTabFor, isTabDropped, tabWidthStyle, tabStripStyle, tabStripWraps,
    scrollTabStrip, onTabStripWheel, setTabStripHover, observeTabStrips,
  }
}
