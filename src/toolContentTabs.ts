// 工具窗口**内容标签条**的溢出与滚动（IDEA `TabContentLayout.java` 的 layout() 那一半）。
//
// 上游算法（`:172-290`）：算出全部标签的自然宽 `requiredWidth` 与可用宽 `toFitWidth`
// （`bounds.width - toolbarWidth - eachX`），放不下就**从两端丢标签**直到放得下 ——
// 前端先丢除非它是选中项（`:222-240`），后端同理；被丢的标签宽度归零（`:277-283`），
// 并因此把 `morePopupOffset` 置上（`:284-287`），那个「…」按钮点开就是
// `showMorePopup()`（`:157-170`）：列出**宽度为 0 的标签**，选中一条即切内容。
// 常量：`TAB_LAYOUT_START = 4`（`:59`）、`MORE_ICON_BORDER = 6`（`:58`）。
//
// 本仓的产品选择（同编辑器标签条，见 docs/inventory/verdict-ui-tabs-popup.md §E）：
// 用**滚动**而不是"丢弃 + more popup"保证可达 —— 所以这里落的是同一套几何的滚动等价物：
//   · `tabsOutsideView`：此刻哪些标签在可视区外（上游 `getWidth() == 0` 的等价物），
//     列进「…」下拉；
//   · `scrollOffsetFor`：选中项必须完整可见（上游靠"绝不丢选中项"保证，本仓靠滚过去）；
//   · `jumpToTab`：从「…」里点一条 = 让那条标签自己 `click()`（上游 more popup 是选中该内容）。
import { nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

/** `TabContentLayout.java:59` 的条首留白。 */
export const TAB_LAYOUT_START = 4
/** `TabContentLayout.java:58` 的「…」按钮与最后一格的距离。 */
export const MORE_ICON_BORDER = 6

export interface TabBox {
  /** 相对条内容原点的左边缘（`offsetLeft`）。 */
  left: number
  width: number
  /** 标签文字（「…」下拉里的行名）。 */
  label: string
}

export interface HiddenTab {
  /** 在条的子元素里的下标（`jumpToTab` 用它找回元素）。 */
  index: number
  label: string
}

/**
 * 可视区之外的标签（上游 `showMorePopup` 过滤 `getWidth() == 0` 的等价物）：
 * 右边缘越过可视区右边、或左边缘落在可视区左边之外（横向滚动时后者会出现）。
 */
export function tabsOutsideView(items: readonly TabBox[], scrollLeft: number, viewWidth: number): HiddenTab[] {
  const out: HiddenTab[] = []
  for (let index = 0; index < items.length; index++) {
    const item = items[index]!
    if (item.width <= 0) { out.push({ index, label: item.label }); continue }
    const right = item.left + item.width
    if (right > scrollLeft + viewWidth || item.left < scrollLeft - TAB_LAYOUT_START) out.push({ index, label: item.label })
  }
  return out
}

/**
 * 选中项要完整可见所需的 `scrollLeft`：
 *   · 左边被压住 → 滚到它前面留 `TAB_LAYOUT_START`；
 *   · 右边超出 → 滚到它右边缘贴住可视区右边；
 *   · 已经完整可见 → 原样（别动不动就动滚动条）。
 */
export function scrollOffsetFor(selected: TabBox | null, scrollLeft: number, viewWidth: number, maxScroll: number): number {
  if (!selected || selected.width <= 0) return scrollLeft
  const clamp = (value: number) => Math.max(0, Math.min(value, Math.max(0, maxScroll)))
  const right = selected.left + selected.width
  if (selected.left < scrollLeft + TAB_LAYOUT_START) return clamp(selected.left - TAB_LAYOUT_START)
  if (right > scrollLeft + viewWidth) return clamp(right - viewWidth)
  return scrollLeft
}

export interface ToolContentTabs {
  /** 此刻在可视区外的标签（含被 CSS 藏起来的）；模板的「…」按钮与菜单用它。 */
  hidden: Ref<HiddenTab[]>
  /** 从「…」里选一条：让那条标签自己 click（= 选中该内容，照上游 more popup）。 */
  jumpToTab: (tab: HiddenTab) => void
  /** 手动重算（内容增删后调用；内部也监听滚动与尺寸变化）。 */
  measure: () => void
}

/** 量一次、并在滚动/尺寸/选中变化时重算的薄壳；条目本身仍由模板渲染。 */
export function useToolContentTabs(row: Ref<HTMLElement | null | undefined>, selectedKey?: () => string): ToolContentTabs {
  const hidden = ref<HiddenTab[]>([])
  let observer: ResizeObserver | null = null

  function children(): HTMLElement[] {
    const el = row.value
    if (!el) return []
    // 「…」容器自己不是内容标签，跳过（它由 v-if 挂在我们测的这一条里）。
    return (Array.from(el.children) as HTMLElement[]).filter(child => !child.classList.contains('output-tabs-more'))
  }
  function measure() {
    const el = row.value
    if (!el) return
    const boxes: TabBox[] = children().map(child => ({
      left: child.offsetLeft,
      width: child.offsetWidth,
      label: (child.textContent ?? '').trim(),
    }))
    hidden.value = tabsOutsideView(boxes, el.scrollLeft, el.clientWidth)
  }
  function revealSelected() {
    const el = row.value
    if (!el) return
    const list = children()
    const index = list.findIndex(child => child.classList.contains('selected'))
    if (index < 0) return
    const child = list[index]!
    if (!child.offsetWidth) return
    const next = scrollOffsetFor(
      { left: child.offsetLeft, width: child.offsetWidth, label: '' },
      el.scrollLeft, el.clientWidth, el.scrollWidth - el.clientWidth,
    )
    if (next !== el.scrollLeft) el.scrollLeft = next
    measure()
  }
  function jumpToTab(tab: HiddenTab) {
    const child = children()[tab.index]
    // 引用那种标签是「标签 + 钉住 + 关闭」的组合，点它里面的第一个按钮才是选中内容。
    const target = child?.querySelector('button') ?? child
    target?.click()
    void nextTick(revealSelected)
  }

  onMounted(() => {
    measure()
    row.value?.addEventListener('scroll', measure, { passive: true })
    if (typeof ResizeObserver !== 'undefined' && row.value) {
      observer = new ResizeObserver(() => { measure(); revealSelected() })
      observer.observe(row.value)
    }
  })
  onBeforeUnmount(() => {
    row.value?.removeEventListener('scroll', measure)
    observer?.disconnect()
    observer = null
  })
  if (selectedKey) watch(selectedKey, () => { void nextTick(() => { revealSelected(); measure() }) })
  return { hidden, jumpToTab, measure }
}
