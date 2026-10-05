import { nextTick, ref, type Ref } from 'vue'
import { placeMenu } from './menuPlacement.ts'
import {
  adjustBounds,
  childStepAnchor,
  DEFAULT_GAP,
  type PopupRelativePosition,
  type Rect as PopupRect,
  type Size,
} from './popupPosition.ts'
import { showOptionsPoint, type PopupShowOptions } from './popupSteps.ts'

/** 浮层的锚点 = 右键点或触发按钮的一角，都是视口坐标。 */
export interface PopupAnchor {
  x: number
  y: number
}

export interface PopupAnchorApi {
  /** 绑到模板 `:style` 上的定位。首帧就是锚点原位，渲染后按实测尺寸纠正。 */
  style: Ref<{ left: string; top: string }>
  /** 内容高度变了（展开子段、换了一组行）就再夹一次。 */
  refresh: () => void
}

/**
 * 让一个 `position: fixed` 的浮层整块留在视口里。
 *
 * 上游 `AbstractPopup` 在 show 之前会按**可用屏幕区域**调整位置：下方放不下就翻到锚点
 * 另一侧（`Alignment`），两侧都不够才夹到视口边（`margin`）—— 顺序与理由见
 * `src/menuPlacement.ts`。纯 CSS 做不到这一步，因为弹层高度取决于行数与有没有展开的子段，
 * 只能等它渲染完量一次真实盒子 —— 与状态栏菜单（`src/notifications.ts`）用的是同一招。
 *
 * 为什么值得抽成模块：项目树右键、标签页右键、编辑器右键、齿轮弹层这四处都自己写过一遍
 * `Math.min(x, viewport.width - 216)` 这种**按行数猜高度**的夹取。编辑器那张 11 行的菜单
 * 实测 419px 高，猜的常数挡不住 —— 它直接从光标一路铺到窗口下沿以外，最后几行落到下边栏
 * 底下，看着就像"下边栏把菜单挡住了"（用户 2026-10-03 的原话）。现在四处共用这一份实测。
 */
export function usePopupAnchor(
  el: Ref<HTMLElement | null | undefined>,
  anchor: () => PopupAnchor | null | undefined,
  /**
   * 没有锚点时（例如从主菜单触发而不是从某处右键）的落位。
   * 参数是**实测到的弹层尺寸**：首次调用带 0（还没渲染，先给一个大致落点），
   * 量到真实盒子后会再调一次 —— `AbstractPopup.showInCenterOf` 的居中就靠这一手，
   * 不是按行数猜高度（`src/popupPlacement.ts` 的 `useBestPositionAnchor`）。
   */
  fallback?: (size: { width: number; height: number }) => PopupAnchor | undefined,
): PopupAnchorApi {
  const style = ref({ left: '0px', top: '0px' })
  const put = (point: PopupAnchor) => { style.value = { left: `${point.x}px`, top: `${point.y}px` } }

  function refresh() {
    const direct = anchor()
    const point = direct ?? fallback?.({ width: 0, height: 0 })
    if (!point) return
    put(point)
    void nextTick(() => {
      const box = el.value
      if (!box) return
      const rect = box.getBoundingClientRect()
      if (!rect.width && !rect.height) return
      // 实测之后重算一次落点：直接锚点原样用；居中那支换成按真实尺寸算的中心。
      const settled = direct ?? fallback?.(rect) ?? point
      put(placeMenu({
        x: settled.x, y: settled.y, width: rect.width, height: rect.height,
        viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
      }))
    })
  }

  refresh()
  return { style, refresh }
}

// ── 贴着**另一个浮层**摆（`PopupPositionManager` 那一支）──────────────────────────────────
//
// 上面那个 `usePopupAnchor` 的锚点是**一个点**（右键处 / 触发按钮一角），只有下方/上方两个
// 候选位 —— 那是 `src/menuPlacement.ts` 的 `placeMenu`，与本节无关。
// 本节的锚点是**一个矩形**（另一个弹层、一个控件），候选位有**四个**（右/左/上/下），
// 而且全都不放得下时不是"夹回去"，是把弹层**裁小**塞进最大的那块空地里。
// 几何全在 `src/popupPosition.ts`（照 `PopupPositionManager.java`），显示选项在
// `src/popupSteps.ts`（照 `PopupShowOptions.kt`）；这里只把两者接到实测尺寸上。
//
// 落点分两档，**与上游 `positionPopupInBestPosition` 的分派一致**（`:54-72`）：
//   · 给了 `showOptions` ⇒ 按那一档算请求点（`WizardPopup.java:237-238/250` 那一支：
//     请求点来自显示选项，**不是**由父弹层推出来的），再交给 `childStepAnchor` 判与父边界
//     是否相交（`:277-291`）；
//   · 不给 ⇒ 直接走 `PositionAdjuster.adjustBounds` 的四点遍历（`:220-271`）。
// 两条都要过 `PositionAdjuster` 上游那层"矩形放不下就裁小"（`:195-198` 传的是实测尺寸）。

export interface RelativeAnchorInput {
  /** 被贴着的那个矩形（视口坐标）。null = 还没有，调用方自己决定先摆哪。 */
  relative: PopupRect | null | undefined
  /** 弹层实测尺寸（上游是 `PopupImplUtil.getPopupSize(popup)`，`:56/70/192`）。 */
  size: Size
  /** 屏幕矩形（本仓只有一个视口）。 */
  viewport: PopupRect
  /** 显示选项；给了就走「请求点」那一档。 */
  showOptions?: PopupShowOptions | null
  /** 四点遍历顺序（`:35` 的 `DEFAULT_POSITION_ORDER`）。 */
  order?: readonly PopupRelativePosition[]
  /** 「上」这一位量的基线 y（`PositionAdjuster2`，`:130-133`）。 */
  topBaselineY?: number
  /** 缝（`:140` 的 `DEFAULT_GAP = 5`）。 */
  gap?: number
}

/**
 * 纯落点：不碰 DOM、不量尺寸。宿主把实测尺寸传进来，它给左上角。
 * 判据里直接测这个函数（`tests/popup-relative-anchor.test.mjs`）。
 */
export function resolveRelativeAnchor(input: RelativeAnchorInput): { x: number; y: number } | null {
  const { relative, size, viewport } = input
  if (!relative) return null
  if (input.showOptions) {
    // 「请求点」那一档：请求点由显示选项给（角点 + 相对位置 + 缝，`showOptionsPoint` 里已加缝），
    // 再判它压在父浮层上没有（`childStepAnchor` 内部先 moveToFit 再判相交，顺序照上游）。
    // 相交那一支上游换的是 `STEP_X_PADDING`（`WizardPopup.java:73`）而不是 `myGap`，
    // 所以这里传 `requested` 就够了 —— 缝不重复加。
    const requested = showOptionsPoint(input.showOptions, relative, size)
    return childStepAnchor(relative, size, viewport, input.gap ?? DEFAULT_GAP, requested)
  }
  const bounds = adjustBounds({
    relative,
    screen: viewport,
    size,
    ...(input.order ? { order: input.order } : {}),
    ...(input.topBaselineY === undefined ? {} : { topBaselineY: input.topBaselineY }),
    ...(input.gap === undefined ? {} : { gap: input.gap }),
  })
  return { x: bounds.x, y: bounds.y }
}

/**
 * 贴着某个矩形开第二层弹层的落位（`PopupPositionManager` 那一支的 DOM 侧）。
 *
 * 首帧还没有实测尺寸（给的是 0×0），所以先按"请求点原位"落一次，等渲染完量到真实盒子再
 * 用同一套几何重算 —— 与 `usePopupAnchor` 的两拍做法一致（那一份的注释解释了为什么不能
 * 按行数猜高度）。
 */
export function useRelativePopupAnchor(
  el: Ref<HTMLElement | null | undefined>,
  relative: () => PopupRect | null | undefined,
  options: Omit<RelativeAnchorInput, 'relative' | 'size' | 'viewport'> = {},
): PopupAnchorApi {
  const style = ref({ left: '0px', top: '0px' })
  const viewport = (): PopupRect => ({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight })

  function refresh() {
    const box = relative()
    if (!box) return
    const zero: Size = { width: 0, height: 0 }
    const first = resolveRelativeAnchor({ relative: box, size: zero, viewport: viewport(), ...options })
    if (!first) return
    style.value = { left: `${first.x}px`, top: `${first.y}px` }
    void nextTick(() => {
      const node = el.value
      if (!node) return
      const rect = node.getBoundingClientRect()
      if (!rect.width && !rect.height) return
      const settled = resolveRelativeAnchor({ relative: box, size: { width: rect.width, height: rect.height }, viewport: viewport(), ...options })
      if (!settled) return
      // 再过一遍 `placeMenu`：四个候选位都判完之后仍要保证整块留在视口里
      // （`PopupPositionManager` 只管相对父弹层的四个位，不管窗口边界）。
      const put = placeMenu({
        x: settled.x, y: settled.y, width: rect.width, height: rect.height,
        viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
      })
      style.value = { left: `${put.x}px`, top: `${put.y}px` }
    })
  }

  refresh()
  return { style, refresh }
}
