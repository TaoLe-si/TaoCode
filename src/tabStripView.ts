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
import type { Pane } from './editorGroups.ts'
import { MIN_TAB_WIDTH, TAB_STRIP_ROW_HEIGHT, layoutCompressibleMultiRow, layoutMultiRow, layoutScrollableMultiRow, layoutSingleRow, preferredTabWidth, scrollUnitsToShowTab, type MultiRowLayout, type TabStripLayout } from './tabStripLayout.ts'
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
  /**
   * `UISettings.hideTabsIfNeeded`（`UISettingsState.kt:125`，默认 true）：一行放不下时
   * true = 滚动标签页面板（`ScrollableMultiRowLayout`）、false = 挤压标签页（`CompressibleMultiRowLayout`）。
   * 上游的判据在 `EditorTabbedContainer.kt:657-672` 的 `createRowLayout`（对照表在 tabStripLayout.ts 文件头）。
   */
  hideTabsIfNeeded: () => boolean
}

export function createTabStripView(deps: TabStripViewDeps) {
  const { groups, splitSize, splitOrientation, singleRow, separatePinnedRow, hideTabsIfNeeded } = deps
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
  const previous = { width: node.style.width, maxWidth: node.style.maxWidth, position: node.style.position, left: node.style.left, top: node.style.top }
  node.style.width = 'auto'
  node.style.maxWidth = 'none'
  // 多行那两族把标签写成 `position: absolute`（见 tabWidthStyle），而**绝对定位的元素
  // 用 `width:auto` 是 shrink-to-fit，可用宽度 = 包含块宽 − left** —— 在条尾的标签因此量到
  // 一丁点宽（实测：left=665、条宽 702 时量到 37，而不是它真正的 171）。这个被缩小的值
  // 一旦进缓存，之后每次重算都按"自然宽度本来就这么小"算，标签就永远回不到原宽
  // （真机现象：窗口拉宽到 1500 也不恢复）。所以测量期间连定位一起摘掉，让它按内容量。
  node.style.position = 'static'
  node.style.left = ''
  node.style.top = ''
  const width = node.getBoundingClientRect().width
  node.style.width = previous.width
  node.style.maxWidth = previous.maxWidth
  node.style.position = previous.position
  node.style.left = previous.left
  node.style.top = previous.top
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
  // 上游 `EditorTabbedContainer.kt:657-672` 的 `createRowLayout`（逐条照抄它的两个分支）：
  //   if (!isSingleRow || (isHorizontalTabs && (showPinnedTabsSeparately() || !hideTabsIfNeeded))) {
  //     !isSingleRow                          -> WrapMultiRowLayout        （多行：换行）
  //     UISettings.hideTabsIfNeeded           -> ScrollableMultiRowLayout  （一行：滚动排）
  //     else                                  -> CompressibleMultiRowLayout（一行：挤压排）
  //   } else                                  ScrollableSingleRowLayout    （一行：裁切 + 滚轮）
  // 所以**挤压与滚动两排都发生在"一行"这一侧**，`singleRow()` 为假时永远是换行排。
  const layoutInput = {
    preferredWidths, stripWidth: box.width, moreButtonWidth: 0,
    sideToolbarMinWidth, insetLeft: 0, insetRight: 0, editorTabs: true, gap: 0, rowHeight: TAB_STRIP_ROW_HEIGHT,
    // 固定标签单独成排（设置页那一条；上游还要高级设置 `editor.keep.pinned.tabs.on.left`，
    // 那条在 IDEA 里默认 true 且本仓没有消费者，见 settingsModel 的注释）。
    pinned: tabs.map((tab: Tab) => Boolean(tab.pinned)),
    separatePinnedRow: separatePinnedRow(),
  }
  if (singleRow() && (separatePinnedRow() || !hideTabsIfNeeded())) {
    // 一行，但要"挤压"或"固定标签另起一排"：走多行那两族里的其中一支。
    // 行高写死成一条标签的高度（上游 `rowHeight = headerFitSize.height`），标签绝对定位到
    // 自己那一行 —— 容器高度由布局给，不靠内容撑起来，量一次就稳定，不会和 ResizeObserver 互相喂。
    tabStripLayouts.value[pane] = null
    tabMultiLayouts.value[pane] = hideTabsIfNeeded()
      ? layoutScrollableMultiRow({ ...layoutInput, scrollOffset: tabScrollOffsets.value[pane] })
      : layoutCompressibleMultiRow(layoutInput)
    return
  }
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
  // 多行（`!singleRow`）永远是换行排 `WrapMultiRowLayout`。
  tabStripLayouts.value[pane] = null
  tabScrollOffsets.value[pane] = 0
  tabMultiLayouts.value[pane] = layoutMultiRow(layoutInput)
}
function placedTabFor(pane: Pane, index: number) {
  const multi = tabMultiLayouts.value[pane]
  if (multi) return multi.placed.find(entry => entry.index === index) ?? null
  return tabStripLayouts.value[pane]?.placed.find(entry => entry.index === index) ?? null
}
/** 单行裁切掉的、以及**滚动排**挤出可视区的那些，都算"掉出条外"（渲染给 0 宽）。 */
function isTabDropped(pane: Pane, index: number): boolean {
  const multi = tabMultiLayouts.value[pane]
  if (multi) {
    const dropped = (multi as { dropped?: number[] }).dropped
    // 滚动排用 `dropped`，换行排/挤压排没有这个概念（它们的标签全都在条内）。
    if (dropped) return dropped.includes(index)
    return !multi.placed.some(entry => entry.index === index)
  }
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
    // 滚动排挤出可视区的那些给 0 宽（`ScrollableTabsRow` 里 `effectiveLen = 0`），而不是消失 ——
    // 保住盒子才能在下一次测量里拿到它的自然宽度。
    const placed = multi.placed.find(entry => entry.index === index)
    if (!placed) return { position: 'absolute' as const, left: '0px', top: `${(multi.placed[0]?.row ?? 0) * multi.rowHeight}px`, width: '0px', flex: '0 0 auto' }
    return { position: 'absolute' as const, left: `${placed.position}px`, top: `${placed.row * multi.rowHeight}px`, width: `${placed.width}px`, flex: '0 0 auto' }
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
  const multi = tabMultiLayouts.value[pane] as { maxScrollOffset?: number; scrollOffset?: number } | null
  // 滚动排自己会滚（`ScrollableMultiRowLayout.isScrollable()=true`）；换行排与挤压排不滚
  // （`MultiRowLayout.scroll(units)` 是空实现）—— 所以先看多行布局有没有可滚的量。
  if (multi && (multi.maxScrollOffset ?? 0) > 0) {
    tabScrollOffsets.value[pane] = (multi.scrollOffset ?? 0) + units
    recomputeTabStrip(pane)
    return
  }
  if (multi) return
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
  // 上游 `MultiRowLayout.isWithScrollBar()=false` ⇒ 换行排/挤压排的 maxScrollOffset 是 0，
  // 这条守卫对它们自然成立（滚动排才有正的 maxScrollOffset）。
  const multi = tabMultiLayouts.value[pane] as { maxScrollOffset?: number } | null
  const maxScrollOffset = multi ? (multi.maxScrollOffset ?? 0) : (tabStripLayouts.value[pane]?.maxScrollOffset ?? 0)
  if (maxScrollOffset <= 0) return
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
/**
 * 每次重算完都重新登记一次观察对象。
 *
 * 早先的写法是"建过一次就不再动"（`if (tabStripObserver) return`），于是**只有第一次调用时
 * 存在的那个条**被观察：标签条元素被替换过（分栏、切工作区、模板重挂）之后，观察者盯着一个
 * 已经摘下来的节点，窗口再变宽也不会重算 —— 真机现象是"挤压过一次之后窗口拉宽也不恢复"。
 * `observe()` 对同一个元素重复调用是幂等的，所以这里直接每次都重挂。
 */
function observeTabStrips() {
  if (typeof ResizeObserver === 'undefined') return
  if (!tabStripObserver) tabStripObserver = new ResizeObserver(() => { recomputeTabStrip(0); recomputeTabStrip(1) })
  for (const node of tabStripNodes) if (node) tabStripObserver.observe(node)
}
// Re-measure whenever the tab set, the **active tab**, the split size or the strip's own size
// changes. 选中项必须在里面：上游是在每次布局里滚它（recomputeToLayout），切标签不重算就滚不动。
let lastModeSignature = ''
watch(() => [groups[0].tabs.map((tab: Tab) => tab.path).join('|'), groups[1].tabs.map((tab: Tab) => tab.path).join('|'), groups[0].activePath, groups[1].activePath, splitSize.value, splitOrientation.value, singleRow(), hideTabsIfNeeded(), separatePinnedRow()].join('~'), async () => {
  await nextTick()
  // 排法变了就把自然宽度缓存清掉：换挡会让标签的**定位**方式改变，而定位会影响测量
  // （绝对定位的 shrink-to-fit，见 measureTabNaturalWidth 的注释）。不清的话第一次换挡
  // 会按旧档量出来的值算下去，窗口再拉宽也不恢复 —— 真机上就是窗口拉宽也不恢复。
  const signature = [singleRow(), hideTabsIfNeeded(), separatePinnedRow()].join('|')
  if (signature !== lastModeSignature) { tabNaturalWidths.clear(); lastModeSignature = signature }
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
