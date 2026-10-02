import { nextTick, ref, type Ref } from 'vue'
import { placeMenu } from './menuPlacement'

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
  /** 没有锚点时（例如从主菜单触发而不是从某处右键）的落位。 */
  fallback?: () => PopupAnchor,
): PopupAnchorApi {
  const style = ref({ left: '0px', top: '0px' })
  const put = (point: PopupAnchor) => { style.value = { left: `${point.x}px`, top: `${point.y}px` } }

  function refresh() {
    const point = anchor() ?? fallback?.()
    if (!point) return
    put(point)
    void nextTick(() => {
      const box = el.value
      if (!box) return
      const rect = box.getBoundingClientRect()
      if (!rect.width && !rect.height) return
      put(placeMenu({
        x: point.x, y: point.y, width: rect.width, height: rect.height,
        viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
      }))
    })
  }

  refresh()
  return { style, refresh }
}
