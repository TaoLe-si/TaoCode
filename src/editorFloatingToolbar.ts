// 编辑器**浮动工具条**的纯逻辑：触发条件 + 位置（含翻转/夹取）+ 内容表 + 关闭条件。
// 零 Vue、零 DOM —— 宿主（`src/components/CodeEditor.vue`）只负责把实测的 rect/尺寸喂进来、把行画出来。
//
// 上游有**两族**同名物，别混：
//   A. **选区浮条**（本模块的主体，题面「选区上方浮出的工具条」）：
//      `CodeFloatingToolbar`（`platform/platform-impl/src/com/intellij/ui/codeFloatingToolbar/
//      CodeFloatingToolbar.kt`）继承 `FloatingToolbar`（`platform/platform-impl/src/com/intellij/
//      openapi/actionSystem/impl/FloatingToolbar.kt`）。它是 `LightweightHint`（不是那个 EP），
//      位置由 `getHintPosition` 自己算 —— 浮在**选区那一段的首行**上方/下方。
//      创建点只有一处：`FloatingCodeToolbarEditorCustomizer.kt:50`。
//   B. **编辑器右上角浮条**（EP `com.intellij.editorFloatingToolbarProvider` 的宿主）：
//      `EditorFloatingToolbar`（`.../openapi/editor/toolbar/floating/EditorFloatingToolbar.kt`），
//      位置由 `EditorImpl.PanelWithFloatingToolbar.doLayout` 定死在右上角。它**与选区无关**，
//      由提供者自己 `scheduleShow()`。本模块也照抄它的几何与内容表（下文 B 段）。
//
// 与既有 popup 模块的关系（逐条判决，见文件末的 `floatingToolbarPlacementNote`）：
//   · 最终夹取**复用** `src/popupBounds.ts` 的 `clampPopupLocation` —— 它与上游 `ScreenUtil.moveToFit`
//     （`platform/util/ui/src/com/intellij/ui/ScreenUtil.java:371-393`）是同一算法（先夹 max 再夹 min）。
//   · `src/menuPlacement.ts` 的 `placeMenu` **不复用**：它按"放不放得下"在下方/上方之间**翻转**，
//     而选区浮条的这一侧是由 `shouldBeUnderSelection` 定的（见下），末尾只有夹取、没有翻转；
//     且 `placeMenu` 多一个 4px margin。复用会多出上游没有的翻转与边距。
import { clampPopupLocation } from './popupBounds.ts'

// ── 常量（逐条对上游） ────────────────────────────────────────────────────────────────

/** `Registry` 的 `floating.codeToolbar.verticalOffset`（`platform/util/resources/misc/registry.properties:1041` = 2）。 */
export const FLOATING_TOOLBAR_VERTICAL_OFFSET = 2

/** `floating.codeToolbar.showBelow`（`registry.properties:1043` = true）。 */
export const FLOATING_TOOLBAR_SHOW_BELOW_DEFAULT = true

/** `TransparentComponentAnimator.kt:94` `SHOWING_TIME_MS`。 */
export const FLOATING_TOOLBAR_SHOWING_MS = 500

/** `TransparentComponentAnimator.kt:95` `HIDING_TIME_MS`。 */
export const FLOATING_TOOLBAR_HIDING_MS = 1000

/** `TransparentComponentAnimator.kt:96` `RETENTION_TIME_MS` —— 鼠标离开后浮条还留多久。 */
export const FLOATING_TOOLBAR_RETENTION_MS = 1500

/** `FloatingToolbar.kt:85` `hintRequests.debounce(50.milliseconds)`。 */
export const FLOATING_TOOLBAR_DEBOUNCE_MS = 50

/** `EditorImpl.java:5761` 的右上角内缩 20（x 与 y 各一份）。 */
export const EDITOR_FLOATING_TOOLBAR_INSET = 20

/** `AbstractFloatingToolbarComponent.kt:45` `FlowLayout(FlowLayout.RIGHT, 20, 20)` 的两段缝。 */
export const EDITOR_FLOATING_TOOLBAR_FLOW_GAP = 20

/** `JBUI.java:1367` `DEFAULT_BACKGROUND_ALPHA = Popup.DEFAULT_HINT_OPACITY`（`JBUI.java:1633` = 0.55f）。 */
export const FLOATING_TOOLBAR_BACKGROUND_ALPHA = 0.55

/** `JBUI.java:1368` `TRANSLUCENT_BACKGROUND_ALPHA`（热重载/自动测试那两支用的档）。 */
export const FLOATING_TOOLBAR_TRANSLUCENT_ALPHA = 0.9

/** `AbstractFloatingToolbarComponent.kt:48` `minimumButtonSize = Dimension(22, 22)`。 */
export const FLOATING_TOOLBAR_BUTTON_SIZE = 22

/** `CodeFloatingToolbar.kt:21` 的默认组 id（`FloatingToolbarCustomizer.kt:21`）。 */
export const FLOATING_CODE_TOOLBAR_GROUP = 'Floating.CodeToolbar'

/** `DefaultFloatingToolbarProvider.kt:12` 的组 id（右上角浮条的默认内容）。 */
export const EDITOR_CONTEXT_BAR_MENU_GROUP = 'EditorContextBarMenu'

/** `OpenInBrowserFloatingToolbarProvider.kt:22` 的组 id。 */
export const OPEN_IN_BROWSER_CONTEXT_BAR_GROUP = 'OpenInBrowserEditorContextBarGroup'

/** `DisableCodeFloatingToolbarAction.kt:13` 写的高级设置键（`intellij.platform.ide.impl.xml:1806`，默认 false）。 */
export const FLOATING_TOOLBAR_HIDE_SETTING = 'floating.codeToolbar.hide'

/** `FloatingToolbarCustomizer.kt:79` 的 registry 键（`ide-core.impl.xml:458`，默认 false）。 */
export const FLOATING_TOOLBAR_SHOW_WITHOUT_SELECTION_KEY = 'floating.codeToolbar.show.without.selection'

// ── 触发条件 ──────────────────────────────────────────────────────────────────────────

/**
 * 宿主喂给判据的编辑器状态。每个字段的**唯一真值源**写在注释里，不在这里重算。
 */
export interface FloatingToolbarState {
  /** 有选区（`SelectionModel.hasSelection()`，`CodeFloatingToolbar.kt:234`）。 */
  hasSelection: boolean
  /** 文档可写（`document.isWritable`，`CodeFloatingToolbar.kt:107`）。 */
  documentWritable: boolean
  /** `floating.codeToolbar.hide` 高级设置已开（`CodeFloatingToolbar.kt:106`）。 */
  advancedHidden: boolean
  /** `CodeFloatingToolbar.TEMPORARILY_DISABLED`（`:71`、`:83-85`）。 */
  temporarilyDisabled: boolean
  /** 冲突弹层计数（`disabledCount`，`:99`、`:314`）。> 0 即禁用。 */
  disabledCount: number
  /** 当前文件**至少一门语言**注册了 `lang.floatingToolbar`（`FloatingCodeToolbarEditorCustomizer.kt:33`）。 */
  languageRegistered: boolean
  /** 该语言 bean 的 `minimal`（`FloatingToolbarCustomizer.kt:105`）。 */
  minimalLanguageToolbar: boolean
  /** 主 IDE 语言里**有**完整浮条（`FloatingToolbarCustomizer.kt:32-34` 的 `hasPrimaryToolbar`）。 */
  primaryLanguageHasToolbar: boolean
  /** `customizationClass` 的 `isToolbarAvailable()`（`FloatingToolbarCustomizer.kt:40-42`）。 */
  customizationAvailable: boolean
  /** 该语言 bean 的 `selectionRequired`（`:114`，默认 true）。 */
  selectionRequired: boolean
  /** PSI 已提交（`PsiDocumentManager.isCommitted`，`FloatingToolbar.kt:231-233`）。 */
  psiCommitted: boolean
  /** 选区两端的元素都可写、且没有活动模板（`hasIgnoredParent` 取反，`CodeFloatingToolbar.kt:101-103`）。 */
  elementsWritable: boolean
  /** 远端开发宿主（`AppMode.isRemoteDevHost()`，`FloatingToolbar.kt:237`）。 */
  remoteDevHost: boolean
  /** 选区上真有可包裹上下文（`findSurroundContext != null`，`SurroundWithActionBase.kt:45`）。 */
  surroundContext: boolean
  /** 有活动 lookup（`LookupManager.getActiveLookup() != null`，`BaseCodeInsightAction.java:70-75`）。 */
  lookupActive: boolean
  /** 宿主侧这些动作的通用闸门（本仓的 `active && lspReady`，见 `src/App.vue:1470`）。 */
  editorActionReady: boolean
}

/** 只关心触发条件时给的默认值：语言已注册、有选区、可写、PSI 已提交。 */
export function defaultFloatingToolbarState(): FloatingToolbarState {
  return {
    hasSelection: true,
    documentWritable: true,
    advancedHidden: false,
    temporarilyDisabled: false,
    disabledCount: 0,
    languageRegistered: true,
    minimalLanguageToolbar: false,
    primaryLanguageHasToolbar: true,
    customizationAvailable: true,
    selectionRequired: true,
    psiCommitted: true,
    elementsWritable: true,
    remoteDevHost: false,
    surroundContext: true,
    lookupActive: false,
    editorActionReady: true,
  }
}

/**
 * `isSelectionRequiredForFloatingToolbar`（`FloatingToolbarCustomizer.kt:78-85`）：
 * registry `floating.codeToolbar.show.without.selection` 关着（默认，`ide-core.impl.xml:458`）
 * ⇒ 恒 true（必须有选区）；开着才去看语言 bean 的 `selectionRequired`。
 */
export function floatingToolbarSelectionRequired(showWithoutSelection: boolean, languageSelectionRequired: boolean): boolean {
  if (!showWithoutSelection) return true
  return languageSelectionRequired
}

/** 判据不通过的原因（上游没这个枚举，是本仓为可测性加的；每条对应一个上游分支）。 */
export type FloatingToolbarBlockReason =
  | 'language-not-registered'
  | 'minimal-without-primary'
  | 'customization-unavailable'
  | 'advanced-hidden'
  | 'document-read-only'
  | 'temporarily-disabled'
  | 'popup-conflict'
  | 'psi-not-committed'
  | 'ignored-parent'
  | 'remote-dev-host'
  | 'selection-required'

export interface FloatingToolbarShowDecision {
  ok: boolean
  reason?: FloatingToolbarBlockReason
}

/**
 * 能不能建/显示浮条。顺序照上游两道门：
 * ① 建不建（`FloatingCodeToolbarEditorCustomizer.kt:24-37`，只跑一次）；
 * ② 显不显（`CodeFloatingToolbar.isEnabled` `:105-108` → `FloatingToolbar.showIfHidden` `:120-128`
 *    里的 `isEnabled` + `canBeShownAtCurrentSelection` `:225-239`）。
 */
export function canShowFloatingToolbar(state: FloatingToolbarState): FloatingToolbarShowDecision {
  // ① 创建门：没有任何语言注册 lang.floatingToolbar ⇒ 整个浮条对象都不建。
  if (!state.languageRegistered) return { ok: false, reason: 'language-not-registered' }
  // minimal 语言且主语言都没有完整浮条 ⇒ findActionGroupFor 返回 null（`:31-37`）。
  if (state.minimalLanguageToolbar && !state.primaryLanguageHasToolbar) return { ok: false, reason: 'minimal-without-primary' }
  if (!state.customizationAvailable) return { ok: false, reason: 'customization-unavailable' }
  // ② 显示门：isEnabled()（`:105-108`）。
  if (state.advancedHidden) return { ok: false, reason: 'advanced-hidden' }
  if (!state.documentWritable) return { ok: false, reason: 'document-read-only' }
  if (state.temporarilyDisabled) return { ok: false, reason: 'temporarily-disabled' }
  if (state.disabledCount > 0) return { ok: false, reason: 'popup-conflict' }
  // canBeShownAtCurrentSelection()（`FloatingToolbar.kt:225-239`）。
  if (!state.psiCommitted) return { ok: false, reason: 'psi-not-committed' }
  if (!state.elementsWritable) return { ok: false, reason: 'ignored-parent' }
  if (state.remoteDevHost) return { ok: false, reason: 'remote-dev-host' }
  // isAvailableForSelection()（`CodeFloatingToolbar.kt:233-235`）。
  if (state.selectionRequired && !state.hasSelection) return { ok: false, reason: 'selection-required' }
  return { ok: true }
}

/**
 * `FloatingToolbar.scheduleShow`（`:161-165`）的两道闸：`isEnabled()` 与
 * `preventHintFromShowing`。后者由**双击选区**置位（`CodeFloatingToolbar.kt:110`
 * `disableForDoubleClickSelection() = true` + `FloatingToolbar.kt:332-341`），
 * 鼠标移出选区才复位（`:319-321`）。
 */
export function floatingToolbarShowRequested(state: FloatingToolbarState, preventHintFromShowing: boolean): boolean {
  return canShowFloatingToolbar(state).ok && !preventHintFromShowing
}

/**
 * `updateOnProbablyChangedSelection`（`FloatingToolbar.kt:279-287`）的三支：
 * `null` ⇒ 隐藏；与 `lastSelection` 相同 ⇒ 什么都不做；变了 ⇒ 交给 `onSelectionChanged`。
 * 本函数返回"选区是否算变了"，供下面两个入口共用。
 */
export function floatingToolbarSelectionChanged(selectedText: string | null, lastSelection: string | null): boolean {
  if (selectedText === null) return false
  return selectedText !== lastSelection
}

/**
 * `MouseListener.mouseReleased`（`FloatingToolbar.kt:290-298`）的反应，逐条：
 *   · `selectedText === null` ⇒ `scheduleHide()`（`:281`）；
 *   · 与 `lastSelection` 相同 ⇒ `Unit`（什么都不做）；
 *   · 变了 ⇒ 已显示就 `updateLocationIfShown()`（只挪位置），否则 `scheduleShow()`。
 * 上游注释写死这条语义：`CodeFloatingToolbar.kt:61`
 * 「Toolbar is visible only if mouse was used for the selection.」
 */
export function floatingToolbarMouseReleasedReaction(input: {
  /** 当前选区文本（`selectedText`，没有选区是 null）。 */
  selectedText: string | null
  /** 上一次已知的选区文本。 */
  lastSelection: string | null
  /** 浮条当前是否可见（`hint?.isVisible`，`:109-111`）。 */
  shown: boolean
}): 'hide' | 'keep' | 'reposition' | 'show' {
  if (input.selectedText === null) return 'hide'
  if (input.selectedText === input.lastSelection) return 'keep'
  return input.shown ? 'reposition' : 'show'
}

/**
 * `KeyboardListener.keyReleased`（`FloatingToolbar.kt:301-311`）的反应：同样先过
 * `updateOnProbablyChangedSelection`，但**变了就 scheduleHide**（`:308`）——
 * 键盘改选区（Shift+方向键）不浮出工具条。
 */
export function floatingToolbarKeyReleasedReaction(input: {
  selectedText: string | null
  lastSelection: string | null
}): 'hide' | 'keep' {
  if (input.selectedText === null) return 'hide'
  return input.selectedText === input.lastSelection ? 'keep' : 'hide'
}

/**
 * `MouseMotionListener.mouseMoved`（`FloatingToolbar.kt:314-322`）的反应：
 * 指针在**任一 caret 的选区内部** ⇒ `scheduleShow()`；不在且当前未显示 ⇒
 * 解除"刚关过"的抑制（`preventHintFromShowing = false`，`:319-321`），
 * 下一次 hover 进选区就能立刻再显示。
 */
export function floatingToolbarMouseMovedReaction(input: { hoverSelected: boolean; shown: boolean }): 'show' | 'allow-show' | 'keep' {
  if (input.hoverSelected) return 'show'
  return input.shown ? 'keep' : 'allow-show'
}

// ── 位置计算 ──────────────────────────────────────────────────────────────────────────

/** `isOneLineSelection`（`CodeFloatingToolbar.kt:154-160`）：选区起止在**同一逻辑行**。 */
export function isOneLineSelection(startLine: number, endLine: number): boolean {
  return startLine === endLine
}

/**
 * `shouldBeUnderSelection`（`CodeFloatingToolbar.kt:144-152`）：浮在选区**下方**还是上方。
 *
 * 逐条：
 *   1. `showUnderSelection = selectionEnd == caretModel.offset || Registry("floating.codeToolbar.showBelow")`
 *      —— 光标在选区**末端**时自然想往下走；registry 默认 true（`registry.properties:1043`）⇒ 默认就往下。
 *   2. `preferredOffset` = 该侧锚点（下方看 selectionEnd、上方看 selectionStart）。
 *   3. 锚点在可见区内 ⇒ 保持该侧；**不在** ⇒ 翻到另一侧（`:147-151` 的 if/else）。
 */
export function shouldBeUnderSelection(input: {
  /** `selectionEnd == caretModel.offset`。 */
  caretAtSelectionEnd: boolean
  /** registry `floating.codeToolbar.showBelow`（默认 true）。 */
  showBelow: boolean
  /** 下方锚点（selectionEnd）是否落在可见区（`editor.offsetToXY(preferredOffset) in visibleArea`）。 */
  endAnchorVisible: boolean
  /** 上方锚点（selectionStart）是否落在可见区。 */
  startAnchorVisible: boolean
}): boolean {
  const showUnderSelection = input.caretAtSelectionEnd || input.showBelow
  // 上游只测 preferredOffset 那一个点（`:147`），另一侧没测 —— 照抄。
  return showUnderSelection ? input.endAnchorVisible : !input.startAnchorVisible
}

/**
 * `getLineByVisualStart`（`CodeFloatingToolbar.kt:172-178`）。
 *
 * `skipLineStartOffset` 为真且锚点在**视觉列 0** 时，往上退一行（`maxOf(line - 1, 0)`）——
 * 因为列 0 意味着锚点"骑"在行首，用本行会让浮条压住上一行的尾巴。
 * 上游随后做 `visualToLogicalPosition(line, 0).line`；本仓无软换行时两者相等，
 * 有软换行时由宿主传入 `visualLine` 前先换算（本模块只做这一步行号加减）。
 */
export function getLineByVisualStart(visualLine: number, visualColumn: number, skipLineStartOffset: boolean): number {
  const skipCurrentLine = skipLineStartOffset && visualColumn === 0
  return skipCurrentLine ? Math.max(visualLine - 1, 0) : visualLine
}

/**
 * `getOffsetForLine`（`CodeFloatingToolbar.kt:162-170`）：该行**第一个非空白字符**的列；
 * 整行空白就退回行首。浮条左缘因此对齐到代码而不是缩进。
 */
export function firstNonWhitespaceColumn(lineText: string): number {
  const index = lineText.search(/\S/)
  return index < 0 ? 0 : index
}

/** `anchorLineFor` 的输入：上游 `getHintPosition` 的 `when`（`CodeFloatingToolbar.kt:126-131`）要的四件事。 */
export interface FloatingToolbarAnchorLineInput {
  /** 选区起止行（`document.getLineNumber(selectionStart/End)`）。 */
  startLine: number
  endLine: number
  /** `isBelow`（`shouldBeUnderSelection` 的结果）。 */
  below: boolean
  /** `selectionStart !in range && selectionEnd !in range`（`:125`）。 */
  edgesOutsideVisibleRange: boolean
  /** 光标所在视觉行（`offsetToVisualPosition(caretModel.offset)`）。 */
  caretVisualLine: number
  /** 光标的视觉列（判 `skipCurrentLine`）。 */
  caretVisualColumn: number
  /** 选区起点的视觉行/列（`offsetToVisualPosition(selectionStart)`）。 */
  startVisualLine: number
  /** 选区终点的视觉行/列（`offsetToVisualPosition(selectionEnd)`）。 */
  endVisualLine: number
  /** 光标是否在**行首**（`visualPosition.column == 0`）。 */
  caretAtLineStart: boolean
}

/**
 * 锚点落在哪一行。上游的 `when` 四支（`CodeFloatingToolbar.kt:126-131`），顺序不能换：
 *   ① 单行选区 ⇒ 选区起点行（**不**退行）；
 *   ② 两端都在可视区外 ⇒ 光标行，且**允许退一行**（`skipLineStartOffset = true`）；
 *   ③ 浮在下方 ⇒ 选区**终点**行，允许退一行；
 *   ④ 否则 ⇒ 选区起点行，**不**退行。
 * 返回的是视觉行号（见 `getLineByVisualStart` 的说明）。
 */
export function floatingToolbarAnchorLine(input: FloatingToolbarAnchorLineInput): number {
  if (isOneLineSelection(input.startLine, input.endLine)) return input.startVisualLine
  if (input.edgesOutsideVisibleRange) {
    return getLineByVisualStart(input.caretVisualLine, input.caretVisualColumn, true)
  }
  if (input.below) return getLineByVisualStart(input.endVisualLine, 0, true)
  return getLineByVisualStart(input.startVisualLine, input.caretAtLineStart ? 0 : 1, false)
}

export interface FloatingToolbarPlacementInput {
  /**
   * `HintManagerImpl.getHintPosition(hint, editor, visualPosition, HintManager.DEFAULT)` 的返回值：
   * 锚点偏移处的视口坐标（本仓由 `view.coordsAtPos(offset)` 给）。
   * `DEFAULT = 6`（`platform-api/.../HintManager.java:26`）在 `_getHintPosition`
   * （`HintManagerImpl.java:524-563`）里是**不做行高偏移、也不做 ABOVE 上移**的那一支。
   */
  anchor: { x: number; y: number }
  /** `editor.lineHeight`。 */
  lineHeight: number
  /** 浮条首选尺寸（上游 `hint.component.preferredSize`）。 */
  width: number
  height: number
  /** 视口（本仓只有一个）。 */
  viewport: { width: number; height: number }
  /** `shouldBeUnderSelection` 的结果。 */
  below: boolean
  /** `floating.codeToolbar.verticalOffset`（默认 2）。 */
  verticalOffset: number
}

export interface FloatingToolbarPlacement {
  x: number
  y: number
  below: boolean
}

/**
 * `CodeFloatingToolbar.getHintPosition`（`:119-142`）的几何，逐行照抄：
 *   · `dy = below ? lineHeight + verticalGap : -(height + verticalGap)`（`:135-139`）；
 *   · `hintPoint.translate(0, dy)`（`:140`）—— **只动 y**，x 就是锚点 x；
 *   · 之后由 `HintManagerImpl.doShowInGivenLocation`（`:270-288`）调
 *     `adjustHintPosition`（`:291-345`）→ `ScreenUtil.moveToFit(rectangle, editorScreen, null)`
 *     （`:330`；`ScreenUtil.java:371-393`，`crop = false`）把整块夹进屏幕。
 *     这一步**没有翻转**，只有夹取 —— 所以这里复用 `clampPopupLocation`
 *     （`src/popupBounds.ts:64-70`，同为"先夹 max 再夹 min"）。
 */
export function resolveFloatingToolbarPlacement(input: FloatingToolbarPlacementInput): FloatingToolbarPlacement {
  const dy = input.below
    ? input.lineHeight + input.verticalOffset
    : -(input.height + input.verticalOffset)
  const raw = { x: input.anchor.x, y: input.anchor.y + dy }
  const clamped = clampPopupLocation(
    { x: raw.x, y: raw.y, width: input.width, height: input.height },
    input.viewport,
  )
  return { x: clamped ? clamped.x : raw.x, y: clamped ? clamped.y : raw.y, below: input.below }
}

/**
 * B 族（右上角浮条）的落点：`EditorImpl.java:5760-5762`。
 *   `rightInsets = verticalScrollBar.getWidth() + (isMirrored() ? gutter.getWidth() : 0)`
 *   `x = containerWidth - toolbarWidth - rightInsets - 20`；`y = 20`。
 * 本仓没有镜像布局（`isMirrored()` 恒 false，取 gutter 那一项为 0），
 * 但滚动条宽度是真的，所以照样作为参数。
 */
export function editorCornerToolbarPlacement(input: {
  containerWidth: number
  toolbarWidth: number
  /** 垂直滚动条宽度（`getVerticalScrollBar().getWidth()`）。 */
  scrollbarWidth: number
  /** 镜像布局时的装订线宽度（`isMirrored() ? myGutterComponent.getWidth() : 0`）。 */
  mirroredGutterWidth: number
  /** 内缩，默认 20（`EditorImpl.java:5761`）。 */
  inset: number
}): { x: number; y: number } {
  const rightInsets = input.scrollbarWidth + input.mirroredGutterWidth
  return { x: input.containerWidth - input.toolbarWidth - rightInsets - input.inset, y: input.inset }
}

/**
 * `mayShowToolbar`（`EditorImpl.java:1718-1720`）：B 族浮条的创建门 ——
 * 非单行模式、不是 diff 编辑器、而且文档绑着一个有效的 `VirtualFile`。
 */
export function mayShowEditorFloatingToolbar(input: {
  oneLineMode: boolean
  diffEditor: boolean
  hasValidVirtualFile: boolean
}): boolean {
  return !input.oneLineMode && !input.diffEditor && input.hasValidVirtualFile
}

// ── 内容表 ────────────────────────────────────────────────────────────────────────────

/**
 * 一行浮条内容。`action` 是**本仓**动作 id；`upstreamAction`/`upstreamGroup` 是上游 id
 * （注释里带出处）。本仓取不到的 id 由宿主按既有惯例**丢掉整行**
 * （`src/menus/editorPopupMenu.ts:73-91` 的 `editorPopupRows` 就是"取不到的 id 直接丢掉"）——
 * 所以这里登记 `action` 的前提是那一行在本仓**真的存在**，否则不写 `action`。
 */
export interface FloatingToolbarRow {
  id: string
  title: string
  /** 本仓动作 id（存在才写）。 */
  action?: string
  /** 上游 action id。 */
  upstreamAction?: string
  /** 上游组 id（popup 组用）。 */
  upstreamGroup?: string
  /** popup 组：成员。 */
  children?: readonly FloatingToolbarRow[]
  /** 可用性（已经算好，画的时候直接用）。 */
  enabled: boolean
  /** 包裹模板标题（Surround 那一组的三项落到 `src/surround.ts` 的模板行上）。 */
  template?: string
}

/**
 * `CodeFloatingToolbar.createActionGroup`（`:180-202`）的三段结构，顺序照抄：
 *   1. `ShowIntentionActions` —— 仅当 `!isIntentionsGroupHidden(language)`（`:188-192`）；
 *      在浮条里它被标成 popup 组（`ShowIntentionActionsAction.kt:37-39`），
 *      文案 `Show Context Actions`（`ActionsBundle.properties:12`），
 *      定义 `intellij.platform.lang.impl.actions.xml:12`。
 *   2. `findActionGroupFor(language)`（`:194`）—— 默认就是 `Floating.CodeToolbar`。
 *   3. 配置组 —— 仅当 `!isConfigurationsGroupHidden(language)`（`:196-199`），
 *      内容 = `MoreActionGroup[Customize, Disable]`（`:224-231`）。
 *
 * `Floating.CodeToolbar` 的成员（`platform/platform-impl/resources/idea/LangActions.xml:212-222`）：
 *   Extensions → **Extract** → Surround(popup) → Additional。
 *   · `Floating.CodeToolbar.Extract`（`intellij.platform.ide.impl.actions.xml:7`，
 *     `popup="true"` + `RefactorDropdownActionGroup`）：组内顺序 = 先 `ExtractMethod`
 *     （`LangActions.xml:374-376` `anchor="first"`），再 `IntroduceVariable`(`:361-363`)、
 *     `IntroduceConstant`(`:364-366`)、`IntroduceParameter`(`:367-369`)。
 *     可用性 = `!hasMinimalFloatingToolbar(language)`（`RefactorDropdownActionGroup.kt:30-34`）。
 *   · `Floating.CodeToolbar.Surround`（`LangActions.xml:215-220`，`popup="true"`）三项：
 *     `SurroundWithTryCatch` / `SurroundWithTryCatchFinally` / `SurroundWithIf`，
 *     文案 `try / catch` / `try / catch / finally` / `if`（`ActionsBundle.properties:2312-2314`），
 *     定义 `intellij.platform.lang.impl.actions.xml:109-115`。
 *     可用性 = `findSurroundContext(...) != null`（`SurroundWithActionBase.kt:45`），
 *     而且这一族**只在浮条 place 才可见**（`:36-39`：不在浮条里就 `isEnabledAndVisible = false`）。
 *   · `Floating.CodeToolbar.Additional`（`LangActions.xml:210`）的贡献点：
 *     `CommentByLineComment`（`:308-310`）→ `ReformatCode`（`:315-317`，`anchor="after"`）
 *     → `XDebugger.Code.Toolbar`（`platform/xdebugger-impl/ui/resources/
 *     intellij.platform.debugger.impl.ui.actions.xml:245-247`，`anchor="last"`）。
 *     后者是调试器代码工具栏（本仓无对应行 ⇒ 不登记）。
 */
export function floatingToolbarRows(
  state: FloatingToolbarState,
  options: {
    /** 语言 bean 的 `hideIntentionsGroup`（`FloatingToolbarCustomizer.kt:108`，默认 false）。 */
    hideIntentionsGroup?: boolean
    /** 语言 bean 的 `hideConfigurationsGroup`（`:111`，默认 false）。 */
    hideConfigurationsGroup?: boolean
  } = {},
): FloatingToolbarRow[] {
  const rows: FloatingToolbarRow[] = []
  // 意图那一行：BaseCodeInsightAction 要求有 project 且没有活动 lookup（`BaseCodeInsightAction.java:61-75`）。
  const intentionEnabled = state.editorActionReady && !state.lookupActive
  if (!options.hideIntentionsGroup) {
    rows.push({
      id: 'editorFloatingToolbar.intention',
      title: '显示上下文操作',
      action: 'codeAction',
      upstreamAction: 'ShowIntentionActions',
      enabled: intentionEnabled,
    })
  }

  // Extract（popup）：整组一个可用性（RefactorDropdownActionGroup.kt:33）。
  const extractEnabled = !state.minimalLanguageToolbar
  const extractChildren: FloatingToolbarRow[] = [
    {
      id: 'editorFloatingToolbar.extractMethod',
      title: '提取方法',
      action: 'refactor.ExtractMethod',
      upstreamAction: 'ExtractMethod',
      enabled: extractEnabled && state.editorActionReady,
    },
    {
      id: 'editorFloatingToolbar.introduceVariable',
      title: '提取变量',
      action: 'refactor.extractVariable',
      upstreamAction: 'IntroduceVariable',
      enabled: extractEnabled && state.editorActionReady,
    },
    {
      id: 'editorFloatingToolbar.introduceConstant',
      title: '提取常量',
      action: 'refactor.ExtractConstant',
      upstreamAction: 'IntroduceConstant',
      enabled: extractEnabled && state.editorActionReady,
    },
    // IntroduceParameter（LangActions.xml:367-369）本仓**没有**对应菜单行 ⇒ 不登记（不画假控件）。
  ]
  rows.push({
    id: 'editorFloatingToolbar.extract',
    title: '提取',
    upstreamGroup: 'Floating.CodeToolbar.Extract',
    enabled: extractEnabled,
    children: extractChildren,
  })

  // Surround（popup）：三项落到本仓 `src/surround.ts` 的模板行上（标题逐字取那张表）。
  const surroundChildren: FloatingToolbarRow[] = [
    { id: 'editorFloatingToolbar.tryCatch', title: 'try / catch', action: 'code.surround', template: 'try / catch', upstreamAction: 'Floating.CodeToolbar.SurroundWithTryCatch', enabled: state.surroundContext },
    { id: 'editorFloatingToolbar.tryCatchFinally', title: 'try / catch / finally', action: 'code.surround', template: 'try / catch / finally', upstreamAction: 'Floating.CodeToolbar.SurroundWithTryCatchFinally', enabled: state.surroundContext },
    { id: 'editorFloatingToolbar.surroundIf', title: 'if', action: 'code.surround', template: 'if 条件', upstreamAction: 'Floating.CodeToolbar.SurroundWithIf', enabled: state.surroundContext },
  ]
  rows.push({
    id: 'editorFloatingToolbar.surround',
    title: '包裹',
    upstreamGroup: 'Floating.CodeToolbar.Surround',
    enabled: state.surroundContext,
    children: surroundChildren,
  })

  // Additional 里本仓接得住的两项。
  rows.push({
    id: 'editorFloatingToolbar.commentLine',
    title: '行注释',
    action: 'comment.line',
    upstreamAction: 'CommentByLineComment',
    enabled: state.editorActionReady,
  })
  rows.push({
    id: 'editorFloatingToolbar.reformat',
    title: '重新格式化',
    action: 'format',
    upstreamAction: 'ReformatCode',
    enabled: state.editorActionReady,
  })

  // 配置组（MoreActionGroup，CodeFloatingToolbar.kt:224-231）。
  // 两个成员都**没有本仓落点**（`Floating.CodeToolbar.Customize` 要 `CustomizationUtil.
  // createCustomizeGroupDialog` 那套可定制动作树、`Floating.CodeToolbar.Disable` 写的是
  // 高级设置 `floating.codeToolbar.hide`）⇒ 不写 `action`，由
  // `renderableFloatingToolbarRows` 丢掉整组（不画点不动的假控件）。
  if (!options.hideConfigurationsGroup) {
    rows.push({
      id: 'editorFloatingToolbar.configure',
      title: '更多操作',
      upstreamGroup: 'MoreActionGroup',
      enabled: true,
      children: [
        {
          id: 'editorFloatingToolbar.customize',
          title: '自定义工具条…',
          upstreamAction: 'Floating.CodeToolbar.Customize',
          enabled: true,
        },
        {
          id: 'editorFloatingToolbar.disable',
          title: '不显示工具条',
          upstreamAction: 'Floating.CodeToolbar.Disable',
          enabled: true,
        },
      ],
    })
  }
  return rows
}

/**
 * 真正能画出来的行 —— 仓库既有惯例「取不到的 id 直接丢掉，不画假控件」
 * （`src/menus/editorPopupMenu.ts:73-91` 的 `editorPopupRows`）。这里把同一条规则收成一个纯函数：
 *   · 有 `action` 的行直接留（`action` 一定指向本仓真实存在的动作 id，见上面的内容表）；
 *   · 只有子行的组：子行全被丢掉 ⇒ 整组丢掉（上游 compact 组"空组不留空行"同理）；
 *   · 叶子行没有 `action` ⇒ 丢掉（本仓无落点）。
 * 内容表照源码**全量**登记（那是事实），能不能画由这个函数决定 —— 两者分开，改一处不会两处漂移。
 */
export function renderableFloatingToolbarRows(rows: readonly FloatingToolbarRow[]): FloatingToolbarRow[] {
  const out: FloatingToolbarRow[] = []
  for (const row of rows) {
    if (row.children) {
      const children = renderableFloatingToolbarRows(row.children)
      if (children.length) out.push({ ...row, children })
      continue
    }
    if (row.action) out.push(row)
  }
  return out
}

/**
 * B 族（右上角浮条）的默认内容 —— `EditorContextBarMenu`
 * （`DefaultFloatingToolbarProvider.kt:12` + `PlatformActions.xml:1136-1141`）：
 *   `EditorToggleUseSoftWrapsInPreview` → `RestoreFontPreviewTextAction`
 *   → `fontEditorPreview.ToggleBoldFont` → 分隔（定义在
 *   `intellij.platform.ide.impl.actions.xml:650-655`）。
 * 这三项都是**字体/预览编辑器**的开关（`...InPreview`），本仓没有那个预览面 ⇒ 一条都不登记。
 * 另有 `JsonPathExportEvaluateResultAction`（`plugins/jsonpath/resources/META-INF/plugin.xml:86-87`）
 * 追加进来，本仓无 JsonPath 求值 ⇒ 也不登记。**该组在本仓恒为空 ⇒ 不渲染**（不画假控件）。
 */
export const EDITOR_CONTEXT_BAR_MENU_MEMBERS: readonly { upstreamAction: string; source: string }[] = [
  { upstreamAction: 'EditorToggleUseSoftWrapsInPreview', source: 'PlatformActions.xml:1137' },
  { upstreamAction: 'RestoreFontPreviewTextAction', source: 'PlatformActions.xml:1138' },
  { upstreamAction: 'fontEditorPreview.ToggleBoldFont', source: 'PlatformActions.xml:1139' },
  { upstreamAction: 'JsonPathExportEvaluateResultAction', source: 'plugins/jsonpath/.../plugin.xml:86-87' },
]

/** `OpenInBrowserEditorContextBarGroup`（`intellij.platform.ide.impl.actions.xml:809`）的成员。 */
export const OPEN_IN_BROWSER_CONTEXT_BAR_MEMBERS: readonly { upstreamAction: string; source: string }[] = [
  { upstreamAction: 'OpenInBrowserEditorContextBarGroupAction', source: 'PlatformActions.xml:1404-1406' },
]

// ── 关闭条件 ──────────────────────────────────────────────────────────────────────────

/**
 * 浮条用 `HintManagerImpl.showEditorHint` 的 flags（`FloatingToolbar.kt:213-220`）：
 *   `HintManager.HIDE_BY_ESCAPE or HintManager.UPDATE_BY_SCROLLING or hideByOtherHintsMask`。
 *   · `HIDE_BY_ESCAPE = 0x01`（`HintManager.java:33`）⇒ Esc 关掉；
 *   · `UPDATE_BY_SCROLLING = 0x80`（`:40`）⇒ 滚动**跟着走**而不是直接关
 *     （`HintManagerImpl.updateScrollableHintPosition:147-...`，调用点
 *     `LocalHintManager.java:196-201`：移动后与旧可见区不再相交才 `hint.hide()`，`:181-187`）；
 *   · `hideByOtherHintsMask`：`CodeFloatingToolbar.hideByOtherHints() = false`（`:114`）⇒ 掩码为 0。
 */
export const FLOATING_TOOLBAR_HIDE_BY_ESCAPE = 0x01
export const FLOATING_TOOLBAR_UPDATE_BY_SCROLLING = 0x80
export const FLOATING_TOOLBAR_HIDE_BY_OTHER_HINT = 0x10

/** 触发一次浮条反应的事件。 */
export type FloatingToolbarEvent =
  | 'escape'
  | 'scroll'
  | 'selection-cleared'
  | 'key-released'
  | 'document-changed'
  | 'popup-conflict'
  | 'disabled'
  | 'double-click-selection'
  | 'mouse-left-selection'
  | 'retention-timeout'

/** 反应：`hide` 关掉 / `reposition` 只挪位置 / `keep` 不动 / `suppress-show` 抑制再显示 / `allow-show` 解除抑制。 */
export type FloatingToolbarReaction = 'hide' | 'reposition' | 'keep' | 'suppress-show' | 'allow-show'

export interface FloatingToolbarReactionResult {
  reaction: FloatingToolbarReaction
  /** 上游出处。 */
  source: string
}

/**
 * 关闭/保活条件，逐条对上游：
 *   · `escape` → `HIDE_BY_ESCAPE` 关掉（`FloatingToolbar.kt:217`）；
 *   · `scroll` → `UPDATE_BY_SCROLLING` **只挪位置**（同上；`:181-187` 才可能 hide）；
 *   · `selection-cleared` → `selectedText == null` ⇒ scheduleHide（`:281`）；
 *   · `key-released` → 内容组 keyReleased ⇒ scheduleHide（`:301-311`）；
 *   · `document-changed` → `shouldSurviveDocumentChange() = false`（`CodeFloatingToolbar.kt:112`）
 *     ⇒ scheduleHide（`FloatingToolbar.kt:344-351`）；
 *   · `popup-conflict` → `hideWhilePopupVisible` 里 `disabledCount++` + scheduleHide（`:310-322`）；
 *   · `disabled` → `isEnabled()` 为假时 `showIfHidden` 直接 return 并保持隐藏（`:120-124`）；
 *   · `double-click-selection` → `preventHintFromShowing = true`（`:332-341`，抑制**显示**，不关已显示的）；
 *   · `mouse-left-selection` → 解除抑制（`:319-321`）；
 *   · `retention-timeout` → 1500ms 计时器到点且 `!isComponentOnHold()` 才 scheduleHide
 *     （`TransparentComponentAnimator.kt:82-86`）；`isComponentOnHold` 见下。
 */
export function floatingToolbarReaction(event: FloatingToolbarEvent): FloatingToolbarReactionResult {
  switch (event) {
    case 'escape':
      return { reaction: 'hide', source: 'FloatingToolbar.kt:217（HIDE_BY_ESCAPE）+ HintManager.java:33' }
    case 'scroll':
      return { reaction: 'reposition', source: 'FloatingToolbar.kt:217（UPDATE_BY_SCROLLING）+ HintManagerImpl.java:147' }
    case 'selection-cleared':
      return { reaction: 'hide', source: 'FloatingToolbar.kt:279-287' }
    case 'key-released':
      return { reaction: 'hide', source: 'FloatingToolbar.kt:301-311' }
    case 'document-changed':
      return { reaction: 'hide', source: 'CodeFloatingToolbar.kt:112 + FloatingToolbar.kt:344-351' }
    case 'popup-conflict':
      return { reaction: 'hide', source: 'CodeFloatingToolbar.kt:310-322' }
    case 'disabled':
      return { reaction: 'hide', source: 'FloatingToolbar.kt:120-124 + CodeFloatingToolbar.kt:105-108' }
    case 'double-click-selection':
      return { reaction: 'suppress-show', source: 'CodeFloatingToolbar.kt:110 + FloatingToolbar.kt:332-341' }
    case 'mouse-left-selection':
      return { reaction: 'allow-show', source: 'FloatingToolbar.kt:319-321' }
    case 'retention-timeout':
      return { reaction: 'hide', source: 'TransparentComponentAnimator.kt:82-86（先过 isComponentOnHold）' }
  }
}

/**
 * `isComponentOnHold` —— 保活判据，两族各一份：
 *   · A 族（选区浮条，`FloatingToolbar.kt:21-23`）：`isComponentUnderMouse() || isFocusAncestor()`；
 *   · B 族（右上角，`EditorFloatingToolbar.kt:74-77`）：测的是**父容器**（`component.parent`）——
 *     因为 `FlowLayout` 把按钮排在面板里，指针/焦点落在面板上也算"手在上面"。
 * 为真时 1500ms 保留计时器到点也**不**关（`TransparentComponentAnimator.kt:82-86`）。
 */
export function isFloatingToolbarOnHold(input: {
  underMouse: boolean
  focusAncestor: boolean
  /** 是否按 B 族的父容器口径（默认 false = A 族口径）。 */
  measureParent?: boolean
}): boolean {
  // 上游 B 族测的是 `component.parent`；本仓 DOM 里"父容器"就是浮条自身的盒子，
  // 所以两族在本模块里收敛成同一个谓词，`measureParent` 只作为出处标记保留。
  void input.measureParent
  return input.underMouse || input.focusAncestor
}

/**
 * `EditorFloatingToolbar.kt:99-109` 的 Esc 分支额外做了一件事：把浮条**当前所占的屏幕矩形**
 * 记进 `ignoreMouseMotionRectangle`，于是 Esc 之后鼠标只要还在那块矩形里就不再触发
 * `mouseMoved → scheduleShow`（`:89-98`）—— 否则一按 Esc 就又冒出来。
 * 本函数就是那个矩形（视口坐标；上游用的是 `Rectangle(location, size)`）。
 */
export function escapeSuppressionRect(placement: { x: number; y: number }, size: { width: number; height: number }): {
  x: number
  y: number
  width: number
  height: number
} {
  return { x: placement.x, y: placement.y, width: size.width, height: size.height }
}

/** `ignoreMouseMotionRectangle?.contains(point)`（`EditorFloatingToolbar.kt:91`）的左闭右开判据。 */
export function escapeSuppressionContains(
  rect: { x: number; y: number; width: number; height: number } | null,
  point: { x: number; y: number },
): boolean {
  if (!rect) return false
  return point.x >= rect.x && point.x < rect.x + rect.width
    && point.y >= rect.y && point.y < rect.y + rect.height
}

// ── 与既有 popup 模块的关系（明确回答） ────────────────────────────────────────────────

/**
 * 逐条判决，避免下一位又去"复用"一个语义不同的模块：
 *   · `src/popupBounds.ts` 的 `clampPopupLocation`：**复用**（本模块已 import）。
 *     它与 `ScreenUtil.moveToFit`（`ScreenUtil.java:371-393`）同序同结果（先夹 max、再夹 min）。
 *   · `src/menuPlacement.ts` 的 `placeMenu`：**不复用**。它按"下方放不放得下"在下方/上方**翻转**
 *     （`src/menuPlacement.ts:46`），而选区浮条的这一侧由 `shouldBeUnderSelection` 定、
 *     末尾只有夹取；`placeMenu` 还多一个 `margin = 4`（`:37`）与上游无对应。
 *   · `src/popupPosition.ts` 的 `adjustBounds`/`crop`：**不复用**。它解决的是"贴着**另一个矩形**
 *     的四个候选位 + 放不下就裁小"，与"贴着选区某一行"无关。
 *   · `src/popupAnchor.ts` 的 `usePopupAnchor`：**不要用它包这一条**。它是 DOM 两拍实测壳，
 *     内部走 `placeMenu`（带翻转）。宿主应当自己量尺寸后调 `resolveFloatingToolbarPlacement`。
 *   · `src/popupPlacement.ts` 的三个命名变体（`showUnderneathOf` 等）：**不复用** —— 那是
 *     `AbstractPopup` 的入口语义（点锚点 + 2px），与浮条的"行 + lineHeight + verticalOffset"不同形。
 */
export const floatingToolbarPlacementNote = 'reuse clampPopupLocation; do not reuse placeMenu/usePopupAnchor'