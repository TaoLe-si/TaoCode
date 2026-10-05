// 分步列表弹层的模型 —— 上游 `com.intellij.openapi.ui.popup.ListPopupStep` +
// `ListSeparator` + `core-ui/.../PopupStep`，以及 `platform-impl/.../ui/popup/WizardPopup.java`
// 里那一层「一层弹层 = 一个 step」的行为。判决表 `ic/dialogs` 缺口 ⑤ 就是这一条：
// 「`ListPopup`/`ListPopupStep`/`ListSeparator`/`PopupShowOptions` 的步骤式列表弹层与显示选项模型
//   （本仓各弹层自己写列表渲染与定位）」。
//
// 抄下来的规则（逐条带坐标）：
//   · `ListPopupStep.getValues()/isSelectable(value)/getTextFor(value)/getSeparatorAbove(value)/
//     getDefaultOptionIndex()`（`ListPopupStep.java:21/29/62/70/75`）—— 列表内容、不可选项、
//     行首分隔行、初始选中项；
//   · `isClosableOnExecute(value) { return !hasSubstep(value) }`（`:38`）——
//     **有子步骤的行按下去不关弹层**，只换内容；没有的才关。这条是分步弹层的定义性行为；
//   · `isFinal(value) { return !hasSubstep(value) }`（`:40-42`）—— 同一个判据，第二个名字；
//   · `onChosen(value, finalChoice)` 返回子步骤；返回 `PopupStep.FINAL_CHOICE`（`PopupStep.java:15`
//     那个 `null`）就关弹层（`PopupStep.java:26-31`）；
//   · `ListSeparator` 只有 text + icon 两个字段（`ListSeparator.java:22-46`），
//     且**没有分隔行的类型** —— 弹层自己画那一行；
//   · `WizardPopup.shouldBeShowing(value)`（`WizardPopup.java:561-570`）的速度搜索可见性：
//     关掉速度搜索 ⇒ 全显示；没有 filter ⇒ 全显示；`filter.canBeHidden(value)` 为假 ⇒ **永远显示**
//     （这一条最容易被漏 —— 不可隐藏的项不参与过滤）；否则按 `getIndexedString(value)` 过滤；
//   · `WizardPopup` 的 Esc/Shift+Esc 两段（`:113-122`）：**Shift+Esc 关整条链**（`disposeAll`），
//     普通 Esc 先清速度搜索字（这一步本仓 `src/popupCancel.ts` 已有）。
//   · `ide.popup.auto.delay` 默认 500ms 的自动选中计时器（`:83-84`、`:537-542`）——
//     挂成纯函数（`autoSelectionDelay`），定时器由调用方开；
//   · **显示选项模型** `PopupShowOptions`（判决表 `ic/dialogs` 缺口 ⑤ 点名的第四个类，
//     原文「`ListPopup`/`ListPopupStep`/`ListSeparator`/`PopupShowOptions` 的步骤式列表弹层
//     与显示选项模型」）。抄的是 `PopupShowOptions.kt` 的**不可变数据**那一面：
//     两个角点（`AnchoredPoint.Anchor`）+ `PopupRelativePosition` + 未缩放缝 + 最小高度，
//     加上 `companion object` 里那四个工厂（`:56-104`）与 `atScreenLocation`（`:110-115`）。
//     Swing 的 `Component`/`JComponent`/`ComponentUtil` 那一层不抄，宿主给矩形就行。
//
// 不可移植的：JBPopup 生命周期、AWT 事件队列、每层一个 `JBPopup` 的窗口栈。

import { speedSearchMatches } from './speedSearch.ts'
import { DEFAULT_GAP, type PopupRelativePosition, type Rect, type Size } from './popupPosition.ts'

export type { PopupRelativePosition, Rect, Size }

/** `WizardPopup.java:84` 之外那一档：`ide.popup.auto.delay` 的默认值，单位毫秒。 */
export const POPUP_AUTO_DELAY_REGISTRY_KEY = 'ide.popup.auto.delay'

/** 上游 `ListSeparator`（`ListSeparator.java:22-46`）：只有文字 + 图标。 */
export interface ListSeparator {
  text: string
  /** lucide 组件名（上游是 `javax.swing.Icon`，本仓没有 `Icon` 对象 —— 见 `TabInfoIconHolder.kt` 那一行的同因）。 */
  icon?: string
}

/** 上游 `ListSeparator()` 的无参构造给的是**空串**（`:27-29`）。 */
export function listSeparator(text = '', icon?: string): ListSeparator {
  return icon === undefined ? { text } : { text, icon }
}

export interface ListPopupStepLike<T> {
  /** `getTitle()`（`PopupStep.java:20`）。 */
  title?(): string | null
  /** `getValues()`（`ListPopupStep.java:21`）。 */
  values(): readonly T[]
  /** `getTextFor(value)`（`:62`）。 */
  text(value: T): string
  /** `isSelectable(value)`（`:29`）；不给就是全可选。 */
  isSelectable?(value: T): boolean
  /** `getSeparatorAbove(value)`（`:70`）；不给就是没有分隔行。 */
  separatorAbove?(value: T): ListSeparator | null
  /** `hasSubstep(value)`（`PopupStep.java:39`）；有子步骤的行按下不关弹层。 */
  hasSubstep?(value: T): boolean
  /**
   * 速度搜索的索引串（`SpeedSearchFilter.getIndexedString`，`WizardPopup.java:568`）。
   * 不给就用 `text(value)`。**只有它返回的串参与过滤** —— 行尾那些附属内容不进搜索。
   */
  indexedString?(value: T): string
  /** `canBeHidden(value)`（`WizardPopup.java:566`）：false = **过滤时也永远显示**。 */
  canBeHidden?(value: T): boolean
  /** `getDefaultOptionIndex()`（`ListPopupStep.java:75`）；越界/不给时调用方退回 0。 */
  defaultOptionIndex?(): number
}

export type ListStepRow<T> =
  | { kind: 'separator'; id: string; text: string; icon?: string }
  | { kind: 'item'; id: string; value: T; text: string; selectable: boolean; hasSubstep: boolean; closesOnExecute: boolean; isFinal: boolean }

let separatorSeq = 0

/** 行 id：项用值的稳定键（调用方给），分隔行用自增序号。 */
export type ListStepIdOf<T> = (value: T, index: number) => string

export interface ListStepRowsOptions<T> {
  /** 速度搜索框里的字（`mySpeedSearch.isHoldingFilter()` 的那一串）。 */
  query?: string
  idOf?: ListStepIdOf<T>
}

/** `isClosableOnExecute`（`ListPopupStep.java:38`）：`!hasSubstep(value)`。 */
export function isClosableOnExecute<T>(step: ListPopupStepLike<T>, value: T): boolean {
  return !hasSubstep(step, value)
}

/** `isFinal`（`ListPopupStep.java:40-42`）：同一个判据，第二个名字。 */
export function isFinalStepValue<T>(step: ListPopupStepLike<T>, value: T): boolean {
  return !hasSubstep(step, value)
}

function hasSubstep<T>(step: ListPopupStepLike<T>, value: T): boolean {
  return step.hasSubstep?.(value) === true
}

/** `shouldBeShowing`（`WizardPopup.java:561-570`）的逐条判据。 */
export function shouldBeShowing<T>(step: ListPopupStepLike<T>, value: T, query: string): boolean {
  if (!query.trim()) return true
  // :566 —— canBeHidden 为假 ⇒ 永远显示（不参与过滤）。
  if (step.canBeHidden?.(value) === false) return true
  const text = step.indexedString?.(value) ?? step.text(value)
  return speedSearchMatches(query, text)
}

/**
 * 列表弹层一层的内容：按 `values()` 顺序展开成分隔行 + 选项行，并按速度搜索过滤。
 *
 * 分隔行插在**它所属的项上面**（`getSeparatorAbove`），且**跟着那一项一起被过滤** ——
 * 上游 `ListPopupImpl` 的行就是 `getValues()` 的一一映射，分隔行是行模型的一部分
 * （`ListPopupModel.java` 那一族），不是过滤之后补的。
 */
export function listStepRows<T>(step: ListPopupStepLike<T>, options: ListStepRowsOptions<T> = {}): ListStepRow<T>[] {
  const { query = '', idOf } = options
  const values = step.values()
  const rows: ListStepRow<T>[] = []
  for (const [index, value] of values.entries()) {
    if (!shouldBeShowing(step, value, query)) continue
    const separator = step.separatorAbove?.(value) ?? null
    if (separator) {
      rows.push({ kind: 'separator', id: `separator:${separatorSeq++}`, text: separator.text, ...(separator.icon ? { icon: separator.icon } : {}) })
    }
    const hasSub = hasSubstep(step, value)
    rows.push({
      kind: 'item',
      id: idOf ? idOf(value, index) : `${index}:${step.text(value)}`,
      value,
      text: step.text(value),
      selectable: step.isSelectable?.(value) !== false,
      hasSubstep: hasSub,
      // :38 —— 有子步骤的行按下不关弹层。
      closesOnExecute: !hasSub,
      isFinal: !hasSub,
    })
  }
  return rows
}

/** 上下键走的是**项**行，分隔行不算（上游 `ListPopupImpl` 的 `JList` 里分隔行不是可选项）。 */
export function nextSelectableRow<T>(rows: readonly ListStepRow<T>[], from: number, delta: 1 | -1): number {
  if (!rows.length) return -1
  let index = from
  for (let guard = 0; guard < rows.length; guard++) {
    index = (index + delta + rows.length) % rows.length
    const row = rows[index]
    if (row.kind === 'item' && row.selectable) return index
  }
  return -1
}

/** 第一个可选行；`getDefaultOptionIndex()` 落在不可选项/越界时退回它（`:75` 只是"初始选中项"）。 */
export function initialRowIndex<T>(step: ListPopupStepLike<T>, rows: readonly ListStepRow<T>[]): number {
  const preferred = step.defaultOptionIndex?.() ?? 0
  const target = rows[preferred]
  if (target && target.kind === 'item' && target.selectable) return preferred
  const first = rows.findIndex(row => row.kind === 'item' && row.selectable)
  return first >= 0 ? first : -1
}

/** `ide.popup.auto.delay` 的默认值（`WizardPopup.java:84`）。 */
export const AUTO_SELECTION_DELAY_MS = 500

/**
 * 自动选中（`WizardPopup` 的 `myAutoSelectionTimer` + `isAutoSelectionEnabled`，
 *   `:83-84` / `:537-542`）：鼠标悬停计时满就当"按下了这一行"。
 * 纯判据，定时器由调用方开 —— 判据里不开真定时器。
 */
export function autoSelectionFired<T>(
  step: ListPopupStepLike<T>,
  rows: readonly ListStepRow<T>[],
  index: number,
  elapsedMs: number,
  delayMs: number = AUTO_SELECTION_DELAY_MS,
): boolean {
  if (elapsedMs < delayMs) return false
  const row = rows[index]
  // 计时器只对**有子步骤**的行有意义：没有子步骤的那行自动选中等于直接关弹层。
  return Boolean(row && row.kind === 'item' && row.selectable && row.hasSubstep)
}

/** `onChosen` 的结果（`PopupStep.java:26-31` + `FINAL_CHOICE` = `null`，`:15`）。 */
export type ChosenOutcome<T> = { kind: 'final'; value: T } | { kind: 'substep'; value: T; next: ListPopupStepLike<unknown> }

/**
 * `onChosen(value, finalChoice)`（`PopupStep.java:26-31`）：
 * 选了有子步骤的行 ⇒ 返回下一层，弹层**留着**（换内容）；否则 ⇒ `FINAL_CHOICE`，弹层关上。
 * `getNextStep` 不给就按 `isClosableOnExecute` 那条判据退回（`:38`）。
 */
export function chosenOutcome<T>(
  step: ListPopupStepLike<T> & { onChosen?(value: T, finalChoice: boolean): ListPopupStepLike<unknown> | null },
  value: T,
): ChosenOutcome<T> {
  const next = step.onChosen?.(value, false) ?? null
  if (next) return { kind: 'substep', value, next }
  if (!hasSubstep(step, value)) return { kind: 'final', value }
  // 有子步骤但 onChosen 没给内容：上游这层会留在原层等下一次选择，弹层不关。
  return { kind: 'substep', value, next: step as unknown as ListPopupStepLike<unknown> }
}

// ── `PopupShowOptions`：显示选项（`PopupShowOptions.kt`）──────────────────────────────────
//
// 这一段抄的是**数据**那一面。锚点用 `AnchoredPoint.Anchor` 的九个字面量，
// 换算成点的公式照 `AnchoredPoint.kt:14-52`（注意 LEFT/RIGHT/TOP/BOTTOM 都是**取中线**，
// 不是取那条边 —— 最容易被写成"贴左边"而丢掉 height/2 那一项）。
// `PopupRelativePosition` 直接复用 `src/popupPosition.ts` 的那一份枚举，两边不允许各写一套。

/** `AnchoredPoint.Anchor`（`AnchoredPoint.kt:14-50`）的九个锚点。 */
export type PopupAnchorCorner =
  | 'center' | 'left' | 'right' | 'top' | 'bottom'
  | 'top-left' | 'bottom-left' | 'top-right' | 'bottom-right'

/** 组件角点的名字 → `AnchoredPoint.Anchor` 的枚举名（`AnchoredPoint.kt:15/19/23/27/31/35/39/43/47`）。 */
const CORNER_TO_ANCHOR: Record<PopupAnchorCorner, string> = {
  center: 'CENTER',
  left: 'LEFT',
  right: 'RIGHT',
  top: 'TOP',
  bottom: 'BOTTOM',
  'top-left': 'TOP_LEFT',
  'bottom-left': 'BOTTOM_LEFT',
  'top-right': 'TOP_RIGHT',
  'bottom-right': 'BOTTOM_RIGHT',
}

export function anchorNameOf(corner: PopupAnchorCorner): string {
  return CORNER_TO_ANCHOR[corner]
}

/**
 * 角点在矩形上的位置（`AnchoredPoint.kt:15-52` 九个分支的公式逐条照抄）：
 *
 * ```
 * CENTER       (x + w/2, y + h/2)      LEFT   (x,     y + h/2)
 * RIGHT        (x + w,   y + h/2)      TOP    (x + w/2, y)
 * BOTTOM       (x + w/2, y + h)        TOP_LEFT     (x,     y)
 * BOTTOM_LEFT  (x,       y + h)        TOP_RIGHT    (x + w, y)
 * BOTTOM_RIGHT (x + w,   y + h)
 * ```
 *
 * 上游量的是 `visibleRect`（`AnchoredPoint.kt:55-57`）；本仓的宿主只给一个矩形，
 * 滚动裁剪那一层由渲染层自己处理。
 */
export function anchorPointOn(rect: Rect, corner: PopupAnchorCorner): { x: number; y: number } {
  switch (corner) {
    case 'center': return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    case 'left': return { x: rect.x, y: rect.y + rect.height / 2 }
    case 'right': return { x: rect.x + rect.width, y: rect.y + rect.height / 2 }
    case 'top': return { x: rect.x + rect.width / 2, y: rect.y }
    case 'bottom': return { x: rect.x + rect.width / 2, y: rect.y + rect.height }
    case 'top-left': return { x: rect.x, y: rect.y }
    case 'bottom-left': return { x: rect.x, y: rect.y + rect.height }
    case 'top-right': return { x: rect.x + rect.width, y: rect.y }
    case 'bottom-right': return { x: rect.x + rect.width, y: rect.y + rect.height }
  }
}

/**
 * `PopupShowOptions` 的可移植数据面（`PopupShowOptions.kt:194-205` 的
 * `PopupShowOptionsImpl` 那一组字段 + `:14-19` 的 `screenX/screenY/popupComponentGap`）。
 *
 * `screenX`/`screenY` 没有屏幕点时是 **-1**（`:130-131` `screenPoint?.x ?: -1`），
 * 这个默认值有语义：`:146` 的 `withScreenXY` 把 (-1,-1) 解释成"清掉屏幕点"。
 */
export interface PopupShowOptions {
  /** 请求的屏幕 x；-1 = 没有屏幕点（`:130`、`:204`）。 */
  screenX: number
  /** 请求的屏幕 y；-1 = 没有屏幕点（`:131`、`:205`）。 */
  screenY: number
  /** 请求的坐标是不是强制的（`:122` 的 `considerForcedXY` 默认 false；`:44` 的 `withForcedXY`）。 */
  considerForcedXY: boolean
  /** 挂靠组件的那个角；null = 没给组件（`:123`）。 */
  ownerAnchor: PopupAnchorCorner | null
  /** 弹层自己的那个角（决定它从请求点往哪边长；`:125`）。 */
  popupAnchor: PopupAnchorCorner | null
  /** 相对组件的位置（`:126`、`:48`）；null = 由落位层自己挑。 */
  relativePosition: PopupRelativePosition | null
  /** 未缩放的缝（`:127`）；null ⇒ 0（`:134` `JBUI.scale(popupComponentUnscaledGap ?: 0)`）。 */
  popupComponentUnscaledGap: number | null
  /** 最小高度（`:128`、`:36`）；null = 不给。 */
  minimumHeight: number | null
}

/** `PopupShowOptionsBuilder` 的初值（`:121-128` 全是 null / false）。 */
export const DEFAULT_SHOW_OPTIONS: PopupShowOptions = {
  screenX: -1,
  screenY: -1,
  considerForcedXY: false,
  ownerAnchor: null,
  popupAnchor: null,
  relativePosition: null,
  popupComponentUnscaledGap: null,
  minimumHeight: null,
}

/** `popupComponentGap`（`:133-134`）：没给缝就是 0，不是 5。 */
export function popupComponentGapOf(options: PopupShowOptions): number {
  return options.popupComponentUnscaledGap ?? 0
}

function withGap(options: PopupShowOptions, gap: number | null): PopupShowOptions {
  return { ...options, popupComponentUnscaledGap: gap }
}

/**
 * `aboveComponent`（`:56-64`）：组件 **TOP_LEFT** 角 + `PopupRelativePosition.TOP` +
 * 弹层 **BOTTOM_LEFT** 角 + 缝 **4**。
 * 缝 4 是 `:63` 的 `withDefaultPopupComponentUnscaledGap(4)`；下面那支
 * （`belowComponent`，`:84-91`）**没有**这一行，所以它的缝是 0 —— 这个不对称是真的，
 * 别顺手给补上。
 */
export function aboveComponent(options: PopupShowOptions = DEFAULT_SHOW_OPTIONS): PopupShowOptions {
  return withGap({ ...options, ownerAnchor: 'top-left', relativePosition: 'top', popupAnchor: 'bottom-left' }, 4)
}

/** `aboveComponentRightAligned`（`:70-78`）：TOP_RIGHT + TOP + BOTTOM_RIGHT + 缝 4。 */
export function aboveComponentRightAligned(options: PopupShowOptions = DEFAULT_SHOW_OPTIONS): PopupShowOptions {
  return withGap({ ...options, ownerAnchor: 'top-right', relativePosition: 'top', popupAnchor: 'bottom-right' }, 4)
}

/** `belowComponent`（`:84-91`）：BOTTOM_LEFT + BOTTOM + TOP_LEFT，**缝 0**。 */
export function belowComponent(options: PopupShowOptions = DEFAULT_SHOW_OPTIONS): PopupShowOptions {
  return { ...options, ownerAnchor: 'bottom-left', relativePosition: 'bottom', popupAnchor: 'top-left' }
}

/** `belowComponentRightAligned`（`:97-104`）：BOTTOM_RIGHT + BOTTOM + TOP_RIGHT，**缝 0**。 */
export function belowComponentRightAligned(options: PopupShowOptions = DEFAULT_SHOW_OPTIONS): PopupShowOptions {
  return { ...options, ownerAnchor: 'bottom-right', relativePosition: 'bottom', popupAnchor: 'top-right' }
}

/**
 * `atScreenLocation`（`:110-115`）：只有 owner + 屏幕点 + 强制位，两个角与相对位置都不给。
 * `withScreenXY` 对 (-1,-1) 的处理（`:146`）在纯数据面上表现为"调用方自己不给这一对"。
 */
export function atScreenLocation(x: number, y: number, forced: boolean, options: PopupShowOptions = DEFAULT_SHOW_OPTIONS): PopupShowOptions {
  return { ...options, screenX: x, screenY: y, considerForcedXY: forced }
}

/** `withScreenXY`（`:145-147`）：(-1,-1) 清掉屏幕点。 */
export function withScreenXY(options: PopupShowOptions, x: number, y: number): PopupShowOptions {
  return { ...options, screenX: x, screenY: y }
}

/** `withDefaultPopupComponentUnscaledGap`（`:38`）/`withPopupComponentUnscaledGap`（`:28`）。 */
export function withPopupComponentGap(options: PopupShowOptions, gap: number | null): PopupShowOptions {
  return withGap(options, gap)
}

/** `withMinimumHeight`（`:36`）。 */
export function withMinimumHeight(options: PopupShowOptions, height: number | null): PopupShowOptions {
  return { ...options, minimumHeight: height }
}

/** `withRelativePosition`（`:48`）。 */
export function withRelativePosition(options: PopupShowOptions, position: PopupRelativePosition): PopupShowOptions {
  return { ...options, relativePosition: position }
}

/** 有没有屏幕点（`:130-131` 的两个 getter 都不是 -1 才算有）。 */
export function hasScreenPoint(options: PopupShowOptions): boolean {
  return options.screenX !== -1 || options.screenY !== -1
}

/**
 * 把显示选项解成**请求的屏幕点**（`WizardPopup.java:237-238` 取 `getScreenX()/getScreenY()`，
 * `:250` 用它建 `targetBounds` 那一条的上游等价物）。
 *
 * 有屏幕点就用它（`:111-114` 的 `forced` 只影响弹层层怎么处理，不影响这里算出来的点）；
 * 否则取组件角点，按 `relativePosition` 与缝把它推出去 —— 与 `src/popupPosition.ts` 的
 * `positionRight`/`positionUnder` 同一口径，所以缝的默认档也用 `DEFAULT_GAP`（5）。
 *
 * 组件矩形、弹层尺寸都由宿主给（上游是 `Component` 与 `getPreferredSize()`）。
 */
export function showOptionsPoint(options: PopupShowOptions, owner: Rect | null, size: Size): { x: number; y: number } {
  if (hasScreenPoint(options)) return { x: options.screenX, y: options.screenY }
  if (!owner || !options.ownerAnchor) return { x: 0, y: 0 }
  const point = anchorPointOn(owner, options.ownerAnchor)
  const gap = popupComponentGapOf(options)
  switch (options.relativePosition) {
    // 组件角点已经贴到组件那一侧的边缘了，所以只有「反向」的两支还要加/减缝。
    case 'top': return { x: point.x, y: point.y - gap - size.height }
    case 'bottom': return { x: point.x, y: point.y + gap }
    case 'left': return { x: point.x - gap - size.width, y: point.y }
    case 'right': return { x: point.x + gap, y: point.y }
    default: return point
  }
}

/** `PopupPositionManager` 的默认缝档（`PopupPositionManager.java:140`），供落位层对齐用。 */
export const SHOW_OPTIONS_FALLBACK_GAP = DEFAULT_GAP
