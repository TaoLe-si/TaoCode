// 侧条（工具窗口停靠条）的**宽度** —— IDEA `ResizeStripeManager` 的那一半职责。
//
// 上游 `platform/platform-impl/src/com/intellij/toolWindow/ResizeStripeManager.kt`：
//   · 它实现 `Splittable`：侧条内沿挂一条 1px 的分隔线（`mySplitter`，`paint()` 是空实现 ⇒ 平时看不见），
//     **拖它改宽度**。左侧条的分隔线在 `target.width - 1`、右侧条在 `0`（`createLayout:79-86`）。
//   · 拖拽增量：`setProportion`（`:113-136`）先按比例算宽度，`anchor == RIGHT` 时取反（`:121-123`），再 clamp。
//   · 上下限 `checkMinMax`（`:138-150`）：下限 compact 33 / 常规 40，上限 100（三者都是 `JBUI.scale` 后的逻辑像素）。
//   · 名称：`updateView`（`:173-182`）对每个按钮调 `setOrUpdateShowName(myCustomWidth > 0)`
//     —— 宽度 > 0 才有名字，所以"名字"是宽度的函数，不是独立开关。
//   · 开关名称 = 重置宽度：`applyShowNames()`（`:215-228`）开时两侧都设 `JBUI.scale(59)`、关时设 0。
//   · 缩放：`updateNamedState`（`:152-171`）在 IDE scale 变化时按比例换算已存的宽度。
//
// 2026.2 的实测（本机 `D:\IntelliJ IDEA 2026.2\lib\intellij.platform.ide.impl.jar`，`javap -c -p`）：
//   `ResizeStripeManager$Companion.enabled()` 是 `iconst_1; ireturn`，`isShowNames() = enabled() &&
//   UISettings.showToolWindowsNames`；老版里由 `ToolWindowStripeExtension.isStripeResizable()` 提供的
//   那道闸随该接口一起在 2026.2 消失（`ToolWindowStripeExtension` 类在整包 jar 里已查不到）。
//   所以"能不能拖侧条"就等于"显示工具窗口名称是不是开着" —— 本文件照此实现。
//
// 两处刻意偏差（都写在 docs/ui-placement-audit.md §AN）：
//   1. 默认宽度取 66 而不是 59。59 是 IDEA 在自己的字体度量下量出的按钮宽度；本仓名称态按钮盒是
//      60px + 两侧 3px 内边距（`src/style.css` 的 `html[data-tool-names='on']` 那两条），
//      照搬 59 会把按钮挤出去。拖动范围仍是上游的 [40,100]（compact 33）。
//   2. 不做 IDE scale 乘法。本仓整条侧条都是未缩放的 px（连 `--space-*` 都是 px），只把宽度缩放
//      会让图标/文字与轨道错位；缩放见 `src/appearanceActions.ts` 的 rem 方案。

/** IDEA 侧条只有左右两条能拖（bottom/top 没有自定义宽度，见 `getSideCustomWidth:230-238`）。 */
export type StripeSide = 'left' | 'right'

/**
 * `applyShowNames()`（`:215-228`）打开名称时给两侧的宽度。
 * 上游是 `JBUI.scale(59)`；本仓用 66（名称态按钮盒 60px + 轨道两侧内边距），见文件头偏差 1。
 */
export const STRIPE_NAMES_DEFAULT_WIDTH = 66

/** `checkMinMax`（`:138-150`）：compact 33 / 常规 40 为下限，100 为上限。 */
export function stripeWidthLimits(compact: boolean): { min: number; max: number } {
  return { min: compact ? 33 : 40, max: 100 }
}

/** 同一条 `checkMinMax`：先压下限再压上限（上游就是这个顺序，所以 NaN/负值都落到下限）。 */
export function clampStripeWidth(width: number, compact: boolean): number {
  const { min, max } = stripeWidthLimits(compact)
  if (!Number.isFinite(width)) return min
  const rounded = Math.round(width)
  if (rounded < min) return min
  if (rounded > max) return max
  return rounded
}

/**
 * 拖拽中的新宽度。左侧条的分隔线在轨道右沿 ⇒ 指针右移 = 变宽；右侧条的分隔线在左沿
 * （`createLayout:79-86`）⇒ 指针右移 = 变窄。上游 `setProportion` 里那句
 * `if (myComponent.anchor == ToolWindowAnchor.RIGHT) width = fullWidth - width`（`:120-123`）就是这个取反。
 */
export function stripeWidthAfterDrag(side: StripeSide, startWidth: number, dx: number, compact: boolean): number {
  return clampStripeWidth(startWidth + (side === 'right' ? -dx : dx), compact)
}

/** `updateView`（`:173-182`）：名字只跟 `myCustomWidth > 0` 走。 */
export function stripeShowsName(width: number): boolean {
  return width > 0
}

/** `applyShowNames()`（`:215-228`）：开 = 两侧都回到默认宽度，关 = 两侧都回 0（0 = 没设自定义宽度）。 */
export function stripeWidthsAfterShowNames(showNames: boolean): Record<StripeSide, number> {
  const width = showNames ? STRIPE_NAMES_DEFAULT_WIDTH : 0
  return { left: width, right: width }
}

/** 侧条不设自定义宽度时的轨道宽度（`src/style.css` 的 `.activity-bar`）。 */
export const STRIPE_BASE_WIDTH = 31

/** 轨道宽度：0 表示"没设自定义宽度" ⇒ 用 CSS 的基准宽度（`myCustomWidth == 0` 那一支，`:96-100`）。 */
export function stripeRailWidth(width: number): number {
  return stripeShowsName(width) ? width : STRIPE_BASE_WIDTH
}

export interface StripeResizeHost {
  /** 拖拽起点：这一侧当前的宽度（`myCustomWidth = getSideCustomWidth(anchor)`，`:93`）。 */
  width: () => number
  /** 每一帧的新宽度（上游 `setSideCustomWidth` 也是在拖动中就地写盘，`:134`）。 */
  apply: (width: number) => void
  /** 紧凑模式（`UISettings.compactMode`，决定下限 33/40）。 */
  compact: () => boolean
  /** 拖拽状态：模板据此给分隔线上高亮、并关掉过渡动画。 */
  setResizing?: (value: boolean) => void
}

/**
 * 分隔线的指针拖拽。形状照 `src/panelResize.ts` 的 `startResize`：
 * 指针捕获 + 抬起/取消/lostpointercapture 三个出口都收，避免留下半截监听。
 */
export function startStripeResize(event: PointerEvent, side: StripeSide, host: StripeResizeHost): void {
  if (event.button !== 0) return
  event.preventDefault()
  const target = event.currentTarget as HTMLElement
  const origin = event.clientX
  const startWidth = host.width()
  const move = (next: PointerEvent) => {
    if (next.pointerId !== event.pointerId) return
    host.apply(stripeWidthAfterDrag(side, startWidth, next.clientX - origin, host.compact()))
  }
  const stop = () => {
    target.removeEventListener('pointermove', move)
    target.removeEventListener('pointerup', stop)
    target.removeEventListener('pointercancel', stop)
    target.removeEventListener('lostpointercapture', stop)
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
    host.setResizing?.(false)
  }
  target.setPointerCapture(event.pointerId)
  target.addEventListener('pointermove', move)
  target.addEventListener('pointerup', stop)
  target.addEventListener('pointercancel', stop)
  target.addEventListener('lostpointercapture', stop)
  host.setResizing?.(true)
}
