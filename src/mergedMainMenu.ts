// `MERGED_WITH_MAIN_TOOLBAR` 档的**顶层菜单溢出折叠** —— IDEA `MainMenuWithButton` 的对应物。
//
// 上游那一格（`ToolbarFrameHeader.kt:446-452` 的 toolbarPnl 第一格）是
// 「横向顶层菜单（`MergedMainMenu`）+ 一个溢出按钮」，宽度不够时从**尾部**把菜单项折进按钮：
//   · 预算   MainMenuWithButton.kt:88 `availableWidth = 父格宽 - 可见菜单宽和 - 按钮宽(可见时) - 工具栏首选宽 - scale(20)`
//   · 藏项   :92-103 预算为负 → 从末尾逐个 `addInvisibleItem` + `remove`，`rootMenuItems.size <= 1` 就停（**至少留一项**）
//   · 回补   :104-117 预算有余 → 从头把藏项 `add` 回来，`availableWidth - itemWidth < widthLimit` 就停
//   · 按钮   :67/:119 `menuButton.isVisible = toolbarMainMenu.hasInvisibleItems(...)`；:142 图标换成 `AllIcons.General.ChevronRight`
//   · 宽度缓存 MergedMainMenu.kt:171-176 注释原文 "Cache the item's width as its real size cannot be
//              obtained when it is not painted" —— 与本仓 `display:none` 之后 offsetWidth 归零是同一个问题，
//              所以这里同样按项缓存最后一次量到的宽度（:199-212 `addInvisibleItem`）。
// 上游每次宽度事件只走一步（:104/:152/:352 各触发一次 `recalculateWidth`），本模块一次算到它要收敛的那个不动点。
import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

/** 溢出按钮宽度 = IDEA 的工具栏按钮尺寸 30×30（JBUI.java:1276 `defaultExperimentalToolbarButtonSize`；
 *  本仓同一个值已经写在 style.css 的 `.icon-button.hamburger-button` 上）。 */
export const MAIN_MENU_BUTTON_WIDTH = 30
/** 上游 MainMenuWithButton.kt:59 `private val toolbarInsetsConst = 20`。 */
export const MAIN_MENU_INSETS = 20

export interface MergedMenuBudget {
  /** 整行宽度（上游 :84 `menuButton.parent?.parent?.width`）。 */
  rowWidth: number
  /** 主工具栏占掉的宽度（上游 :82 `toolbar?.calculatePreferredWidth()`）。 */
  toolbarWidth: number
  /** 每个顶层菜单项的宽度，按声明顺序；**含该项后面的一份菜单间距**（HorizontalLayout.kt:186 `x += width + gap`）。 */
  itemWidths: number[]
  /** 溢出按钮宽度与余量：默认取上游常量，测试里要分别控制才传。 */
  buttonWidth?: number
  insets?: number
}

export interface MergedMenuPlan {
  /** 还留在行面上的项数。 */
  visibleCount: number
  /** 是否有被折起来的项 —— 只决定溢出按钮的可见性（:119）。 */
  showOverflow: boolean
}

/** 一次算到位：能放下的**最长前缀**；放不满时还要给溢出按钮留位置。 */
export function planMergedMenu(budget: MergedMenuBudget): MergedMenuPlan {
  const buttonWidth = budget.buttonWidth ?? MAIN_MENU_BUTTON_WIDTH
  const insets = budget.insets ?? MAIN_MENU_INSETS
  const items = budget.itemWidths
  const total = items.length
  if (total === 0) return { visibleCount: 0, showOverflow: false }
  const sum = (count: number) => items.reduce((acc, width, index) => acc + (index < count ? width : 0), 0)
  // 全放得下 → 没有隐藏项 → 按钮也不出现（:119）。
  if (sum(total) + budget.toolbarWidth + insets <= budget.rowWidth) return { visibleCount: total, showOverflow: false }
  for (let count = total - 1; count >= 2; count--) {
    if (sum(count) + buttonWidth + budget.toolbarWidth + insets <= budget.rowWidth) return { visibleCount: count, showOverflow: true }
  }
  // 一项都放不下也要留一项（:95 `rootMenuItems.size <= 1` 就 break）；按钮只在确实还有第二项可折时才出现。
  return { visibleCount: 1, showOverflow: total > 1 }
}

/** 还没量到之前把全部项都摆出来：折叠是**优化**，不是初始状态。 */
const ALL = Number.MAX_SAFE_INTEGER

/**
 * 量一次顶栏，把 merged 档该折掉的顶层菜单算出来。
 *
 * class 名就是本模块与 CSS 的契约（`.topbar` 行 / `.menubar` 顶层菜单 / `.topbar-toolbar` 主工具栏）。
 * 用 class 查询而不是模板 ref：App.vue 正贴着机检行数上限，每多一个 `const x = ref()` 都要再拆一处才换得来。
 */
export function useMergedMainMenu(options: {
  /** `mainMenuDisplayMode` 的当前值。 */
  mode: () => string
  /** 菜单弹层是否展开着（`ExpandableMenu.isShowing`）。 */
  expanded: () => boolean
  /** 顶栏在不在（没有工作区时整条顶栏不渲染，量不到也不需要量）。 */
  mounted: () => boolean
}): { visibleCount: Ref<number>; overflow: Ref<boolean>; menuButtonVisible: Ref<boolean>; remeasure: () => void } {
  const visibleCount = ref(ALL)
  const overflow = ref(false)
  const menuButtonVisible = ref(false)
  /** 每个顶层菜单项最后一次量到的宽度（藏起来之后 offsetWidth 是 0，见文件头 MergedMainMenu.kt:171-176）。 */
  const widths: number[] = []
  let observer: ResizeObserver | null = null
  let bound: HTMLElement[] = []
  let queued = 0

  /** 一帧内合并多次触发：折叠本身会改变 `.menubar` 的宽度，那又会招来一次观察回调。 */
  function schedule() {
    if (queued) return
    if (typeof requestAnimationFrame !== 'function') { measure(); return }
    queued = requestAnimationFrame(() => measure())
  }

  function measure() {
    queued = 0
    const mode = options.mode()
    const row = document.querySelector<HTMLElement>('.topbar')
    const bar = document.querySelector<HTMLElement>('.menubar')
    const toolbar = document.querySelector<HTMLElement>('.topbar-toolbar')
    // 溢出按钮：hamburger 档恒在（:67 `!isMergedMenu ||`）；merged 档看下面算出来的结果。
    menuButtonVisible.value = mode === 'hamburger'
    // 只有 merged 档要折：hamburger 档的菜单本来就在弹层里，separate 档菜单栏独占一行、不与工具栏抢宽度。
    if (mode !== 'merged' || !row || !bar || !toolbar || !options.mounted() || options.expanded()) {
      visibleCount.value = ALL
      overflow.value = false
      bind([row, toolbar].filter((el): el is HTMLElement => !!el))
      return
    }
    const items = Array.from(bar.children) as HTMLElement[]
    const menuGap = parseFloat(getComputedStyle(bar).columnGap) || 0
    items.forEach((item, index) => { if (item.offsetWidth) widths[index] = item.offsetWidth })
    const plan = planMergedMenu({
      rowWidth: row.clientWidth,
      toolbarWidth: inFlowWidth(toolbar),
      itemWidths: items.map((_, index) => (widths[index] ?? 0) + menuGap),
    })
    visibleCount.value = plan.visibleCount
    overflow.value = plan.showOverflow
    menuButtonVisible.value = plan.showOverflow
    bind([row, toolbar, ...items, ...inFlowChildren(toolbar)])
  }

  /** 主工具栏在**流内**占的宽度：只有 `.topbar-spacer` 会吸收剩余空间，其余子项都是自然宽度；
   *  绝对定位的中段（文件名 widget）不在流内，也就不与顶层菜单抢同一格宽度。 */
  function inFlowChildren(toolbar: HTMLElement) {
    return Array.from(toolbar.children).filter(el => getComputedStyle(el).position !== 'absolute') as HTMLElement[]
  }
  function inFlowWidth(toolbar: HTMLElement) {
    const style = getComputedStyle(toolbar)
    const gap = parseFloat(style.columnGap) || 0
    const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
    const children = inFlowChildren(toolbar)
    return children.reduce((acc, el) => acc + el.offsetWidth, 0) + padding + gap * Math.max(0, children.length - 1)
  }

  /** 观察对象换了一批才重挂：`observe` 会对每个新元素立刻回调一次，重挂 = 自己触发自己。 */
  function bind(next: HTMLElement[]) {
    if (typeof ResizeObserver !== 'function') return
    if (next.length === bound.length && next.every((el, index) => el === bound[index])) return
    bound = next
    observer ??= new ResizeObserver(schedule)
    observer.disconnect()
    for (const el of next) observer.observe(el)
  }

  watch(() => [options.mode(), options.expanded(), options.mounted()], () => measure(), { immediate: true })
  onBeforeUnmount(() => {
    if (queued && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(queued)
    observer?.disconnect()
    observer = null
  })
  return { visibleCount, overflow, menuButtonVisible, remeasure: schedule }
}
