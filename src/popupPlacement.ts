// `AbstractPopup` 的三条**命名定位变体**（`ui/popup/AbstractPopup.java`）。
//
// 判决表里 `AbstractPopup` 的 `[~]` 一直挂着"缺 showUnderneathOf / showInCenterOf /
// showInBestPositionFor 那组定位变体"：夹取（`placeMenu`）与实测（`usePopupAnchor`）早已落地，
// 缺的是这三个**入口语义**本身 —— 于是每张弹层各写一遍 `Math.min(y, innerHeight - 行数*26)`
// 这种"按行数猜高度"的近似（SelectIn / 选择目标 / 快速定义三家都犯同一遍）。
// 这里把上游三条几何逐条搬成纯函数：
//   · `showUnderneathOf(component)`（`:732-737`）→ `pointUnderneathOf`
//     `defaultPointUnderneathOf`（`:770-773`）是 `BOTTOM_LEFT` 锚点 + `(2, 0)` 偏移
//     （`JBUIScale.scale(2)`；新 UI 的横向对齐要看 `ide.popup.align.by.content` 与
//     `PopupAlignableComponent`，本仓没有那层自绘渲染，取默认支）。
//   · `showInCenterOf(component)`（`:724-727`）→ `centerOf`
//     `getCenterOf`（`:668-678`）取容器**可见区**的中心再减半个弹层尺寸
//     （`UIUtil.getCenterPoint`：`rect.x + (rect.width - size.width) / 2`）。
//   · `showInBestPositionFor(editor)`（`:974-993`）→ `bestPositionFor`
//     编辑器有光标就用光标（`getBestPositionFor`，`:894-897`：有 `EDITOR_EVEN_IF_INACTIVE`
//     就走编辑器分支）；没有编辑器时上游用 "quick search" 的定位，本仓的 DOM 等价物是
//     **焦点容器居中**（`showInFocusCenter`，`:900-905`）。
//
// 纯几何（rect/size 对象）可单测；`useBestPositionAnchor` 是接给弹层组件的那层薄壳。
import { type Ref } from 'vue'
import { placeMenu } from './menuPlacement.ts'
import { usePopupAnchor, type PopupAnchor, type PopupAnchorApi } from './popupAnchor.ts'

export interface Rect { x: number; y: number; width: number; height: number }
export interface Size { width: number; height: number }

/** `defaultPointUnderneathOf`（`:770-773`）的 2px 偏移。 */
export const UNDERNEATH_OFFSET_X = 2

/** 视口矩形。SSR/浏览器预览与弹层组件原先的兜底尺寸一致（1280×800）。 */
export function viewportRect(): Rect {
  const width = typeof window === 'undefined' ? 1280 : window.innerWidth
  const height = typeof window === 'undefined' ? 800 : window.innerHeight
  return { x: 0, y: 0, width, height }
}

/** `showUnderneathOf(component)`：贴着组件**底边左角**下方，横向偏移 2px。 */
export function pointUnderneathOf(rect: Rect): PopupAnchor {
  return { x: rect.x + UNDERNEATH_OFFSET_X, y: rect.y + rect.height }
}

/** `showInCenterOf(component)`：容器中心的左角（弹层以自身中心对齐容器中心）。 */
export function centerOf(container: Rect, size: Size): PopupAnchor {
  return {
    x: container.x + (container.width - size.width) / 2,
    y: container.y + (container.height - size.height) / 2,
  }
}

export interface BestPositionInput {
  /** 编辑器光标矩形（`EDITOR_EVEN_IF_INACTIVE` 的那一支）；没有就给 null。 */
  caret?: Rect | null
  /** 拿不到光标时的落点容器（上游是焦点组件 / `showInFocusCenter` 的父组件）。 */
  container: Rect
}

/**
 * `showInBestPositionFor` 的落点选择：光标优先，否则容器居中。
 * `size` 只在居中那一支用得到（光标支是锚点，尺寸由夹取阶段实测）。
 */
export function bestPositionFor(input: BestPositionInput, size: Size): PopupAnchor {
  if (input.caret) return { x: input.caret.x, y: input.caret.y + input.caret.height }
  return centerOf(input.container, size)
}

/**
 * 弹层组件用的定位壳：光标锚点优先；没有坐标时**按实测尺寸居中**（`usePopupAnchor` 的
 * `fallback` 会在量到盒子后带上真实尺寸再调一次，所以居中不是按行数猜的）。
 */
export function useBestPositionAnchor(
  el: Ref<HTMLElement | null | undefined>,
  caret: () => PopupAnchor | null | undefined,
): PopupAnchorApi {
  return usePopupAnchor(el, caret, size => centerOf(viewportRect(), size))
}

/** 一次到位：按变体算出锚点后交给 `placeMenu` 夹进视口（给非响应式调用点用）。 */
export function placeUnderneath(rect: Rect, size: Size, viewport: Rect = viewportRect()): PopupAnchor {
  return placeMenu({
    ...pointUnderneathOf(rect), ...size,
    viewportWidth: viewport.x + viewport.width, viewportHeight: viewport.y + viewport.height,
  })
}

/** 同上，`showInCenterOf` 版（居中后再夹一次，容器比弹层小时仍不越界）。 */
export function placeCenteredIn(container: Rect, size: Size, viewport: Rect = viewportRect()): PopupAnchor {
  return placeMenu({
    ...centerOf(container, size), ...size,
    viewportWidth: viewport.x + viewport.width, viewportHeight: viewport.y + viewport.height,
  })
}
