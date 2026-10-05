// 「贴着**另一个浮层**摆位」的几何 —— 上游 `platform/lang-impl/src/com/intellij/ui/popup/
// PopupPositionManager.java`（判决表里 `ui/popup` 补判节族三的第一条）。
//
// 判决表对这一条的判词是「『贴着锚点摆、越界就翻转』这段行为可移植且 Web 下由 CSS 定位承担」。
// 核对原文后要更正一半：**点锚点**的那一支本仓早就在 `src/menuPlacement.ts` 的 `placeMenu`
// 里（两个候选位：下方/上方，翻不过就夹），`src/popupPlacement.ts` 又补了三个命名变体。
// `PopupPositionManager` 真正独有、且**和 `placeMenu` 不同形**的是它的另一半：
// 锚点是**一个矩形**（另一个弹层/一个控件）而不是一个点，于是有**四个**候选位
// （右/左/上/下），而且全都不放得下时不是"夹回去"，是**把弹层裁小**塞进最大的那块空地里。
//
// 上游坐标（逐条照抄，数字不改）：
//   · `Position` 枚举与默认遍历顺序 `{RIGHT, LEFT, TOP, BOTTOM}`（`:35`、`:40-42`）；
//   · `PositionAdjuster.DEFAULT_GAP = 5`（`:140`）——两个弹层之间的默认缝；
//   · `positionRight/positionLeft/positionAbove/positionUnder`（`:158-173`）四个候选矩形；
//   · `getYForTopPositioning()` 默认取 `myRelativeOnScreen.y`（`:175-177`），
//     `PositionAdjuster2` 改成最上层那个弹层的 y（`:130-133`）——
//     也就是"上"这一位是相对**栈顶**弹层量的，不是相对当前层；
//   · `adjustBounds`（`:220-271`）：按遍历顺序逐个试，`screenRect.contains(r)` 就用它；
//     都不行就按 `width` 再 `height` 升序排 `boxes`、**取最大的一块**（`:261-263`），
//     并在空地起点落在锚点**之前**时把弹层推到空地的另一端贴边（`:264-269`）；
//   · `crop`（`:273-294`）：把矩形裁进 source；注意 Java 的 `Rectangle` 允许负宽高，
//     而 `crop` 在 `toCrop` 整块落在 source 外时**真的会算出负宽**（`:285-291`）——
//     这个"负宽"不是 bug：它正是"这块地一块都放不下"的度量，排序时自然垫底。
//     本仓照抄这个语义，判据里钉住它。
//
// 本仓的等价物：纯几何函数。DOM 侧把它接到 `usePopupAnchor` 的 `fallback` 上，
// 就能让"贴着某个浮层打开的第二层"（子菜单、分步弹层的下一步）用上这一整套遍历。

export type PopupRelativePosition = 'right' | 'left' | 'top' | 'bottom'

/** `PopupPositionManager.java:35` 的 `DEFAULT_POSITION_ORDER`。 */
export const DEFAULT_POSITION_ORDER: readonly PopupRelativePosition[] = ['right', 'left', 'top', 'bottom']

/** `PositionAdjuster.DEFAULT_GAP`（`:140`）—— 两个弹层之间的默认缝。 */
export const DEFAULT_GAP = 5

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

/**
 * 落点在矩形内（左闭右开）。上游用的是 `java.awt.Rectangle.contains(Point)`
 * （`StackingPopupDispatcherImpl.java:130` 的 `bounds.contains(point)`、
 * `ToolWindowButtonManager.kt` 的 `getStripeFor(devicePoint)` 同一族）。
 */
export function pointInside(rect: Rect, point: { x: number; y: number }): boolean {
  return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height
}

/** 上游 `adjustBounds` 的输入：锚点矩形（`myRelativeTo.getLocationOnScreen()` + 宽高）与所在屏幕矩形。 */
export interface AdjustPositionInput {
  /** `myRelativeTo`：被贴着的那个矩形（本仓是另一个浮层或一个控件）。 */
  relative: Rect
  /** `myScreenRect`：`ScreenUtil.getScreenRectangle(relative.x, relative.y)`。本仓只有一个视口。 */
  screen: Rect
  /** 弹层自身尺寸（`PopupImplUtil.getPopupSize(popup)`）。 */
  size: Size
  /** 遍历顺序；空数组等价于 `DEFAULT_POSITION_ORDER`（`:221`）。 */
  order?: readonly PopupRelativePosition[]
  /** 缝；`PositionAdjuster2` 那种非默认构造才给。 */
  gap?: number
  /**
   * 「上」这一位量的基线 y。默认取 `relative.y`（`:175-177`）；
   * `PositionAdjuster2`（`:130-133`）给的是栈顶那个弹层的 y —— 上层浮层叠着下层时
   * 「上」要让开整个栈顶，于是这一支要显式传。
   */
  topBaselineY?: number
}

/** `positionRight`（`:158-161`）：锚点右缘 + 缝。 */
export function positionRight(relative: Rect, size: Size, gap = DEFAULT_GAP): Rect {
  return { x: relative.x + relative.width + gap, y: relative.y, width: size.width, height: size.height }
}

/** `positionLeft`（`:163-165`）：锚点左缘 − 缝 − 弹层宽。 */
export function positionLeft(relative: Rect, size: Size, gap = DEFAULT_GAP): Rect {
  return { x: relative.x - gap - size.width, y: relative.y, width: size.width, height: size.height }
}

/** `positionAbove`（`:167-169`）：基线 y − 缝 − 弹层高。 */
export function positionAbove(relative: Rect, size: Size, gap = DEFAULT_GAP, topBaselineY = relative.y): Rect {
  return { x: relative.x, y: topBaselineY - gap - size.height, width: size.width, height: size.height }
}

/** `positionUnder`（`:171-173`）：锚点下缘 + 缝。 */
export function positionUnder(relative: Rect, size: Size, gap = DEFAULT_GAP): Rect {
  return { x: relative.x, y: relative.y + gap + relative.height, width: size.width, height: size.height }
}

/**
 * `crop`（`:273-294`）：把 `toCrop` 裁进 `source`。
 *
 * 逐条照抄，包括**允许负宽高**这一条：Java `Rectangle` 的宽高可以是负数，
 * 而 `crop` 在 `toCrop` 整块落在 `source` 外时（`:285-291`）会算出负的宽或高。
 * 上游没有夹到 0，本仓也不夹 —— 夹了就丢掉"这块地一块都放不下"这个度量，
 * 而 `adjustBounds` 正是靠它给四块地排序（负的那块自然垫底）。
 */
export function crop(source: Rect, toCrop: Rect): Rect {
  const result = { ...toCrop }
  if (toCrop.x < source.x) {
    result.width -= source.x - toCrop.x
    result.x = source.x
  }
  if (toCrop.y < source.y) {
    result.height -= source.y - toCrop.y
    result.y = source.y
  }
  if (result.x + result.width > source.x + source.width) result.width = source.x + source.width - result.x
  if (result.y + result.height > source.y + source.height) result.height = source.y + source.height - result.y
  return result
}

/** `Rectangle.contains(Rectangle)`：左上角在 screen 内、右下角也在 screen 内。 */
function containsRect(screen: Rect, r: Rect): boolean {
  return r.x >= screen.x && r.y >= screen.y
    && r.x + r.width <= screen.x + screen.width
    && r.y + r.height <= screen.y + screen.height
}

/**
 * `adjustBounds`（`:220-271`）：先按顺序试四个位，第一个整块放得下的就赢；
 * 都放不下就取**面积最大**的那块空地（按宽再按高排序取最后一个，`:261-263`），
 * 在空地起点落在锚点之前时把弹层推到空地另一端贴边（`:264-269`），再 `crop` 一次。
 *
 * 返回的 `width`/`height` 可能比传入的 `size` 小（这就是"裁小塞进去"），
 * 也可能是 0 或负数（空地不足；`crop` 的原样语义）。
 */
export function adjustBounds(input: AdjustPositionInput): Rect {
  const { relative, screen, size } = input
  const gap = input.gap ?? DEFAULT_GAP
  const order = input.order && input.order.length ? input.order : DEFAULT_POSITION_ORDER
  const topBaselineY = input.topBaselineY ?? relative.y

  const boxes: Rect[] = []
  let candidate: Rect | null = null
  for (const position of order) {
    switch (position) {
      // 每个分支都记两笔：r 是弹层要落的矩形，boxes 里是这一侧**可用的空地**。
      case 'top':
        candidate = positionAbove(relative, size, gap, topBaselineY)
        boxes.push(crop(screen, {
          x: relative.x, y: screen.y,
          width: screen.width, height: topBaselineY - screen.y - gap,
        }))
        break
      case 'bottom':
        candidate = positionUnder(relative, size, gap)
        boxes.push(crop(screen, {
          x: relative.x, y: relative.y + relative.height + gap,
          width: screen.width, height: screen.height,
        }))
        break
      case 'left':
        candidate = positionLeft(relative, size, gap)
        boxes.push(crop(screen, {
          x: screen.x, y: relative.y,
          width: relative.x - screen.x - gap, height: screen.height,
        }))
        break
      case 'right':
        candidate = positionRight(relative, size, gap)
        boxes.push(crop(screen, {
          x: relative.x + relative.width + gap, y: relative.y,
          width: screen.width, height: screen.height,
        }))
        break
    }
    if (candidate && containsRect(screen, candidate)) return candidate
  }

  // 一块都放不下：按宽再按高升序排，取最后一块（上游的 `Comparator.comparingInt(w).thenComparingInt(h)`
  // 是稳定排序，所以同宽同高时保留遍历顺序里的先来者 —— ArrayList.sort 是稳定的）。
  const sorted = boxes
    .map((box, index) => ({ box, index }))
    .sort((a, b) => (a.box.width - b.box.width) || (a.box.height - b.box.height) || (a.index - b.index))
  const suitable = sorted[sorted.length - 1].box
  return crop(suitable, {
    x: suitable.x < relative.x ? suitable.x + suitable.width - size.width : suitable.x,
    y: suitable.y < relative.y ? suitable.y + suitable.height - size.height : suitable.y,
    width: size.width,
    height: size.height,
  })
}

/**
 * 分步弹层的**下一层落点**（`WizardPopup.showChildPopupComponent` 那一支的对偶）。
 *
 * 上游 `WizardPopup.java:256-291`：子弹层先按自身尺寸算 target bounds，
 * 然后 —— 父弹层存在且 `alignByParentBounds` 时 ——
 * ① 父弹层边界先各内缩 `STEP_X_PADDING = 2`（`:73`、`:261-262`）；
 * ② target 与父边界**相交**就说明"这一侧被父弹层占着"，于是改摆到父弹层的**左边**
 *    `x = parent.x − 弹层宽 − STEP_X_PADDING`（`:277-278`）；
 * ③ 摆过去后 x < 屏幕左缘就夹回屏幕左缘（`:282-284`，注释写明是为了不跑到另一块屏上）。
 *
 * `childStepAnchor(relative, size, viewport, gap)` 是上面三步的纯函数版。
 * 第三个判据（intersects）用 `overlaps()` 单列出来，判据里能直接断言。
 */
export const STEP_X_PADDING = 2

/** 矩形是否相交（边贴边不算相交 —— 上游 `Rectangle.intersects` 的判据是两边都有正交叠）。 */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width
    && a.y < b.y + b.height && b.y < a.y + a.height
}

/** 父浮层按 `STEP_X_PADDING` 内缩后的边界（`WizardPopup.java:261-262`）。 */
export function paddedParentBounds(relative: Rect): Rect {
  return {
    x: relative.x + STEP_X_PADDING,
    y: relative.y,
    width: relative.width - STEP_X_PADDING * 2,
    height: relative.height,
  }
}

/**
 * 下一层浮层相对父浮层的落点。`viewport` = `screenRectangle`（`:266-269`）。
 *
 * `requested` 是**请求的屏幕坐标**（上游 `WizardPopup.java:237-238` 从 `PopupShowOptions`
 * 取的 `getScreenX()/getScreenY()`，`:250` 用它建 `targetBounds`）—— 它**不是**由父弹层
 * 推出来的。顺序照上游：先 `moveToFit` 夹进屏幕矩形（`:273`），**再**谈与父边界是否相交
 * （`:277`）；两者换序就换语义。不给 `requested` 时退到"摆在父弹层右边"这个默认请求位。
 */
export function childStepAnchor(
  relative: Rect,
  size: Size,
  viewport: Rect,
  gap = DEFAULT_GAP,
  requested?: { x: number; y: number },
): { x: number; y: number } {
  const parent = paddedParentBounds(relative)
  const wanted = requested ?? positionRight(relative, size, gap)
  // :273 `ScreenUtil.moveToFit(targetBounds, screenRectangle, null)` —— 本仓的等价物是 crop。
  const target = crop(viewport, { x: wanted.x, y: wanted.y, width: size.width, height: size.height })
  // :289-291 的 "No intersection with the parent bounds"：不相交就用夹好后的落位。
  if (!overlaps(target, parent)) return { x: target.x, y: target.y }
  // 相交 ⇒ 这一侧被父弹层占着，改摆到父弹层左侧（`:277-278`）。
  const x = relative.x - size.width - STEP_X_PADDING
  // 摆过去后不许出屏幕左缘（`:282-284`：防止子弹层跑到另一块屏上）。
  return { x: Math.max(viewport.x, x), y: target.y }
}
