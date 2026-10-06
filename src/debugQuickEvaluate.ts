// 快速求值 / 值提示的可移植规则 —— 上游 `QuickEvaluateHandler` + `XDebuggerTextPopup`
//
// 上游坐标：
//   · `platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/evaluate/quick/common/QuickEvaluateHandler.java:17-31`
//     —— 四个口：`isEnabled(project)` / `createValueHint(project, editor, point, type)` /
//        `canShowHint(project)` / `getValueLookupDelay(project)`；
//   · `platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/evaluate/quick/common/XDebuggerTextPopup.java:62-66`
//     —— 弹层尺寸常量（MAX/MIN 宽高 + 工具条余量）；
//     `:229` / `:233` —— 实际尺寸 = `max(工具条, 文本) + TOOLBAR_MARGIN` / 文本高 + 工具条高；
//     `:292-306` —— 夹在「屏幕的一半」与「屏幕的 1/5（宽）/ 1/7（高）」之间；
//     `:127-140` —— 同一次展示里**值文本相同就不重复渲染**（`preventDoubleExecution`）；
//     `:122` / `:154-157` —— 求值期间可以被判 `obsolete`，过期结果直接丢掉；
//     `:249-256` / `:346-351` / `:391-395` / `:414-419` —— 工具条动作与快捷键。
//   · `platform/xdebugger-api/src/com/intellij/xdebugger/settings/XDebuggerSettingsManager.java:21`
//     —— `DEFAULT_VALUE_TOOLTIP_DELAY = 700`（ms）。
//   · `platform/xdebugger-impl/src/com/intellij/xdebugger/impl/settings/XDebuggerDataViewSettings.java:25`
//     —— `autoExpressions` 默认 **开**。
//
// 本仓的现状与这个模块的关系（写清楚，不冒充）：`dbg/evaluate` 判词里「悬停快速求值」
// 这一项的卡点是**编辑器悬停通道**（`src/components/CodeEditor.vue` 本轮归别的 agent），
// 而「什么时候值得发一次 evaluate、结果怎么合并、弹层多大」这几条规则是纯函数，
// 就在这里；CodeEditor 一接上 `quickEvaluateHint` 就直接可用。
//
// 与上游的一处如实差异：上游 `createValueHint` 拿的是 PSI 元素
// （`com.intellij.xdebugger.impl.evaluate.quick.common` 各语言实现自己判断可不可求值），
// 本仓没有 PSI，所以入参是**调用方取好的那条表达式**（装配层 `src/quickEvaluateHint.ts` 的
// `expressionRangeAtPosition` 按访问链取，见其模块头「订正 1」；再早的版本只取光标下那个标识符词，
// 成员访问链会退化成链尾那半截 ⇒ 求值必失败），本模块不判断语义。

/** 上游 `DEFAULT_VALUE_TOOLTIP_DELAY`（`XDebuggerSettingsManager.java:21`），单位 ms。 */
export const DEFAULT_VALUE_LOOKUP_DELAY = 700

/** 上游 `XDebuggerTextPopup` 的尺寸常量（`XDebuggerTextPopup.java:62-66`）。 */
export const POPUP_MAX_WIDTH = 650
export const POPUP_MAX_HEIGHT = 400
export const POPUP_MIN_WIDTH = 170
export const POPUP_MIN_HEIGHT = 100
export const POPUP_TOOLBAR_MARGIN = 30

export interface QuickEvaluateOptions {
  /** 「悬停时显示值提示」总开关（上游 `DEBUGGER_VALUE_TOOLTIP_AUTO_SHOW_KEY`，见 `DataViewsConfigurableUi.kt:47-51`）。 */
  showTooltip?: boolean
  /** 查值延迟（ms，上游 `getValueLookupDelay`）。负数/非数退回默认 700。 */
  valueLookupDelay?: number
  /** 弹层工具条高度（px）。上游 `resizePopup` 把它加在文本高度下面（`:233`）。 */
  toolbarHeight?: number
  /** 弹层工具条宽度（px）。上游取 `max(工具条宽, 文本宽) + TOOLBAR_MARGIN`（`:229`）。 */
  toolbarWidth?: number
  /**
   * 适配器报没报 DAP 的 `supportsEvaluateForHovers`。上游的悬停求值要会话有求值器
   * （`XQuickEvaluateHandler.kt:41-44` 的 `isEnabled` = `currentSession?.currentEvaluator != null`），
   * 本仓对应的能力位就是这条。明确报 false ⇒ 不发请求、不弹提示。
   */
  evaluateForHovers?: boolean
}

/**
 * 该不该为这次光标位置发一次 `evaluate`。
 * 上游对应的是「`isEnabled` + `canShowHint` + PSI 能不能求值」三道门；本仓没有 PSI，
 * 只保留前两道 + 「词非空」这一道，语义写在返回原因里，调用方能把它显示出来。
 */
export function quickEvaluateDecision(
  word: string, options: QuickEvaluateOptions = {},
): { evaluate: boolean; delay: number; reason: string } {
  const delay = quickEvaluateDelay(options.valueLookupDelay)
  if (options.showTooltip === false) return { evaluate: false, delay, reason: '值提示已关闭' }
  if (!dapSessionUsable()) return { evaluate: false, delay, reason: '没有暂停的调试会话' }
  if (options.evaluateForHovers === false) return { evaluate: false, delay, reason: '该调试器不支持悬停求值' }
  const text = word.trim()
  if (!text) return { evaluate: false, delay, reason: '光标处没有可求值的词' }
  return { evaluate: true, delay, reason: '' }
}

/** 求值延迟：非有限/负数退回上游默认 700（`XDebuggerDataViewSettings.java:26` 的初始化）。 */
export function quickEvaluateDelay(valueLookupDelay?: number): number {
  if (valueLookupDelay === undefined) return DEFAULT_VALUE_LOOKUP_DELAY
  return Number.isFinite(valueLookupDelay) && valueLookupDelay >= 0
    ? Math.floor(valueLookupDelay)
    : DEFAULT_VALUE_LOOKUP_DELAY
}

/**
 * 一次展示的最终尺寸（`XDebuggerTextPopup.resizePopup`，`:218-241`）：
 *   宽 = clamp(max(工具条宽, 文本宽) + 工具条余量, 屏幕宽/5, min(屏幕宽/2, 650))
 *   高 = clamp(文本高 + 工具条高,        屏幕高/7, min(屏幕高/2, 400))
 * 上下限都带常量兜底：屏幕很小时 `屏幕宽/5` 可能小于 170，所以外层再取一次
 * max/min（与上游 `:296-306` 的 `Math.max(屏幕/5, MIN)` 同一口径）。
 */
export function quickEvaluatePopupSize(
  textWidth: number, textHeight: number, screenWidth: number, screenHeight: number,
  options: QuickEvaluateOptions = {},
): { width: number; height: number } {
  const margin = POPUP_TOOLBAR_MARGIN
  const toolbarWidth = options.toolbarWidth ?? 0
  const toolbarHeight = options.toolbarHeight ?? 0
  const width = clamp(
    Math.max(toolbarWidth, textWidth) + margin,
    Math.max(screenWidth / 5, POPUP_MIN_WIDTH),
    Math.min(screenWidth / 2, POPUP_MAX_WIDTH),
  )
  const height = clamp(
    textHeight + toolbarHeight,
    Math.max(screenHeight / 7, POPUP_MIN_HEIGHT),
    Math.min(screenHeight / 2, POPUP_MAX_HEIGHT),
  )
  return { width, height }
}

function clamp(value: number, low: number, high: number): number {
  // 上游 `updatePopupBounds` 的顺序是「先按屏幕比例取 min，再对 min 兜底」；
  // 屏幕极端小时 low 可能 > high，此时以 low 为准（宁可超出屏幕也不缩成 0）。
  if (low > high) return low
  return Math.min(Math.max(value, low), high)
}

/**
 * 同一次展示里去重（上游 `preventDoubleExecution`，`:127-140`）：值文本一样就不重画。
 * 上游用 `String.hashCode()` 比，这里比字符串本身 —— 语义一样且不依赖 JVM 的 hash。
 */
export function shouldRepaintValue(previousValue: string | undefined, nextValue: string): boolean {
  return previousValue !== nextValue
}

/**
 * 过期结果丢弃（上游 `evaluationObsolete` + `isObsolete`，`:122` / `:154-157`）：
 * 求值发起时记一个 nonce，回来时 nonce 不是最新的就丢掉。
 */
export function acceptQuickEvaluateResult(
  issued: number, latest: number, response: { value?: string; error?: string } | null,
): { value: string; error: string } | null {
  if (issued !== latest) return null
  if (!response) return null
  return { value: response.value ?? '', error: response.error ?? '' }
}

/** 工具条动作与快捷键（上游 `:249-256`；F2 = `:394`，Ctrl+Enter = `:350`，Esc = `:418`）。 */
export const QUICK_EVALUATE_TOOLBAR = [
  { mode: 'show-as-object', label: '显示为对象', shortcut: '' },
  { mode: 'set-value-mode', label: '进入改值', shortcut: 'F2' },
  { mode: 'set-text-value', label: '设置文本值', shortcut: 'Ctrl+Enter' },
  { mode: 'cancel-set-value', label: '取消改值', shortcut: 'Esc' },
] as const

/**
 * 有没有可用的调试会话。没有接口可问（面板的 `dapState` 是它的私有状态），
 * 所以宿主注入；默认 false —— **不猜**。
 */
let sessionProbe: () => boolean = () => false
export function setQuickEvaluateSessionProbe(probe: () => boolean): void {
  sessionProbe = probe
}
function dapSessionUsable(): boolean {
  try { return sessionProbe() } catch { return false }
}

// ── 悬停通道的三条上游规则（`ValueLookupManager` + `XQuickEvaluateHandler`）──────────────
//
//   · `platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/evaluate/quick/common/AbstractValueHint.java:460-469`
//     —— `getHintType(EditorMouseEvent)`：修饰符为 0 ⇒ `MOUSE_OVER_HINT`；Alt（Quick Evaluate 的
//        鼠标修饰）⇒ `MOUSE_ALT_OVER_HINT`；**其它修饰符返回 null ⇒ 根本不出提示**；
//   · `platform/xdebugger-impl/ui/src/com/intellij/platform/debugger/impl/ui/evaluate/quick/common/ValueLookupManager.java:143-149`
//     —— `getDelay()`：`delay = handler.getValueLookupDelay(project)`，而**已经有提示在显示时**
//        `delay = max(100, delay)`（注释点了 IDEA-141464）；
//   · 同文件 `:127-141` —— 悬停提示是「排一个延时的请求」，请求到点时先比
//        `area.equals(editor.getScrollingModel().getVisibleArea())`：**可视区域变了就不弹**；
//        Alt 悬停/点击这一类不走延时，直接 `showHint`；
//   · 同文件 `:97-102` —— 上一次是「点击提示」时，普通悬停不再顶掉它；
//   · `platform/xdebugger-impl/frontend/src/com/intellij/platform/debugger/impl/frontend/evaluate/quick/XQuickEvaluateHandler.kt:74-84`
//     —— `sideEffectsAllowed = type == MOUSE_CLICK_HINT || MOUSE_ALT_OVER_HINT`，
//        普通悬停把 `sideEffectsAllowed=false` 交给求值器 ⇒ **悬停不求值有副作用的表达式**；
//   · 同文件 `:70-73` —— 有手动选区且允许副作用时，求的是**选区**而不是光标处的词；
//   · `platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/evaluate/quick/XValueHint.java:421-427`
//     —— 求值**失败**时：`MOUSE_OVER_HINT` 收起自己的提示、让位给普通信息提示（文档），
//        只有点击类提示才把错误文本画出来（`:416-418`）。

/**
 * 上游 `ValueHintType`
 * （`platform/xdebugger-impl/rpc/src/com/intellij/xdebugger/impl/evaluate/quick/common/ValueHintType.kt:8-10`
 * 的三档：`MOUSE_OVER_HINT` / `MOUSE_ALT_OVER_HINT` / `MOUSE_CLICK_HINT`）里，
 * 本仓悬停通道能区分出来的两档。
 */
export type QuickEvaluateHintKind = 'hover' | 'altHover'

/** `AbstractValueHint.java:460-469`：只有「无修饰」与「Alt」两种悬停会出提示。 */
export function hoverHintKind(event: { altKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean }): QuickEvaluateHintKind | null {
  if (event.altKey) return 'altHover'
  if (event.ctrlKey || event.shiftKey || event.metaKey) return null
  return 'hover'
}

/** `XQuickEvaluateHandler.kt:74`：只有 Alt 悬停（与点击提示）允许有副作用的表达式。 */
export function allowsSideEffects(kind: QuickEvaluateHintKind): boolean {
  return kind === 'altHover'
}

/**
 * 本仓没有 PSI，所以「有没有副作用」按词形判：**只有纯取值的访问链**（标识符 + `.` / `->` /
 * `::` / `[下标]`）算无副作用；出现 `(`（调用）就算有副作用 ⇒ 普通悬停不求值。
 * 上游是各语言求值器判的（`getExpressionInfoAtOffset(..., sideEffectsAllowed)`），
 * 这里是同一个用户可见规则的无 PSI 版本 —— 差异如实写在模块头部。
 */
export function isSideEffectFree(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (trimmed.includes('(') || trimmed.includes('{') || trimmed.includes('=')) return false
  return /^[A-Za-z_$][A-Za-z0-9_$]*(\s*(\.|->|::)\s*[A-Za-z_$][A-Za-z0-9_$]*|\s*\[[^\][\n]*\])*$/.test(trimmed)
}

/** `ValueLookupManager.java:146-148`：已有提示在显示时的最小重弹延时（上游写死 100ms）。 */
export const MIN_RESHOW_LOOKUP_DELAY = 100

/** 上游 `getDelay()`：`max(100, delay)` 只在「当前正显示着提示」时生效。 */
export function lookupDelayFor(configured: number, hintShowing: boolean): number {
  const delay = quickEvaluateDelay(configured)
  return hintShowing ? Math.max(MIN_RESHOW_LOOKUP_DELAY, delay) : delay
}

/**
 * 延时到点后还要不要弹（`ValueLookupManager.java:129-135` 的可视区域判据）。
 * 本仓的「可视区域」用编辑器滚动位置代替：任何一处变了 ⇒ 放弃这次提示。
 */
export function viewportUnchanged(before: { top: number; left: number }, after: { top: number; left: number }): boolean {
  return before.top === after.top && before.left === after.left
}

// ── 弹层工具条（上游 `XDebuggerTextPopup` 的四个动作）───────────────────────────────
//
//   · `:249-256` —— 顺序：ShowAsObject / EnableSetValueMode / SetTextValueAction / CancelSetValue；
//   · `:285-290` —— `shouldBeVisible`：改值那两个只在**改值态**可见，另外两个只在**非改值态**可见；
//   · `:308-321` —— `canSetTextValue(node)`：值要「以文本形态显示」并且**有 modifier**（可写），
//     `:354-357` / `:398-401` 据此 `setEnabledAndVisible` ⇒ 不满足时这两条根本不出现在工具条上；
//   · `:329-344` —— ShowAsObject 把弹层换成**树弹层**（`showTreePopup`，`:266-268`）；
//     本仓的判据换成 DAP 的 `variablesReference`（>0 才有孩子可画）；
//   · `:378-381` —— 提交 = 把编辑后的文本转成字符串字面量再写值（`DebuggerUIUtil.setTreeNodeValue`），
//     DAP 的对应物是 `setExpression`；
//   · `:383-388` —— 写失败：收起弹层 + 弹错误对话框（本仓把错误写进弹层自己那行，见装配层的差异说明）。

/** 工具条形态：非改值 / 改值（上游 `mySetValueModeEnabled`，`:80`）。 */
export type QuickEvaluatePopupMode = 'value' | 'editing'

export interface QuickEvaluateToolbarFlags {
  /** 有没有可展开的孩子（上游 ShowAsObject 依赖的树；本仓 = `variablesReference > 0`）。 */
  hasChildren: boolean
  /** 这个值能不能按文本改（上游 `canSetTextValue`：文本形态 + 有 modifier）。 */
  canSetText: boolean
}

/**
 * 这一次工具条上要画的条目（顺序照 `:249-256`，可见性照 `:285-290` + `:354-357`）。
 * 返回的是 `QUICK_EVALUATE_TOOLBAR` 里的 mode 子集 —— 画出来的一定是点得动的：
 * 「显示为对象」要真的有孩子，改值那两条要真的可写。
 */
export function visibleToolbarModes(mode: QuickEvaluatePopupMode, flags: QuickEvaluateToolbarFlags): string[] {
  if (mode === 'editing') return flags.canSetText ? ['set-text-value', 'cancel-set-value'] : []
  const modes = flags.hasChildren ? ['show-as-object'] : []
  if (flags.canSetText) modes.push('set-value-mode')
  return modes
}

/** 工具条条目的显示文案与快捷键（取自 `QUICK_EVALUATE_TOOLBAR`，避免装配层各写一份）。 */
export function toolbarItem(mode: string): { label: string; shortcut: string } {
  const item = QUICK_EVALUATE_TOOLBAR.find(entry => entry.mode === mode)
  return { label: item?.label ?? mode, shortcut: item?.shortcut ?? '' }
}

/**
 * 值文本是不是「以文本形态显示的字符串」—— 上游 `XValueTextProvider.shouldShowTextValue()`
 * 的判据在 DAP 里没有对应字段，本仓用适配器回显的形态判：被双引号包住的就是字符串值。
 * （与 `:312-321` 同一条规则的另一半：另一半「有 modifier」= `supportsSetExpression`。）
 */
export function looksLikeTextValue(value: string): boolean {
  const text = value.trim()
  return text.length >= 2 && text.startsWith('"') && text.endsWith('"')
}

/** 上游 `canSetTextValue`（`:308-321`）在本仓的两个条件：字符串形态 + 适配器支持 setExpression。 */
export function canSetTextValue(value: string, setExpressionSupported: boolean): boolean {
  return setExpressionSupported && looksLikeTextValue(value)
}

/**
 * `java/debugger/shared/src/com/intellij/java/debugger/impl/shared/engine/JavaValueTextModificationPreparator.kt:14-16`
 * 的 `convertToJavaStringLiteral`（上游函数名就是这个，本仓不分 Java/Kotlin）
 * = `StringUtil.wrapWithDoubleQuote(SharedDebuggerUtils.translateStringValue(text))`，
 * 而 `translateStringValue`（`java/debugger/shared/src/com/intellij/java/debugger/impl/shared/SharedDebuggerUtils.java:29-34`）
 * 就是 `StringUtil.escapeStringCharacters(length, str, buffer)`
 * （`platform/util/src/com/intellij/openapi/util/text/StringUtil.java:527-600`）：
 * `\b \t \n \f \r` 走短转义，`\` 加倍，`"` 前加反斜杠，不可打印字符转 `\uXXXX`（大写、补足 4 位）；
 * `wrapWithDoubleQuote`（同文件 `:2129-2131`）再前后加一双引号。
 */
export function convertToStringLiteral(text: string): string {
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    switch (ch) {
      case '\b': out += '\\b'; break
      case '\t': out += '\\t'; break
      case '\n': out += '\\n'; break
      case '\f': out += '\\f'; break
      case '\r': out += '\\r'; break
      case '\\': out += '\\\\'; break
      case '"': out += '\\"'; break
      default:
        if (code < 0x20 || code === 0x7f) out += `\\u${code.toString(16).toUpperCase().padStart(4, '0')}`
        else out += ch
    }
  }
  return `"${out}"`
}

/**
 * 编辑态的初值：把适配器回显的 `"abc"` 还原成可编辑的 `abc`（上游
 * `SharedDebuggerUtils.translateStringValue` 的入参就是显示形态，`DebuggerUtils.java:140`
 * 同一条路；本仓取的是「剥掉外层引号 + 反转义」这一眼可见的部分）。
 */
export function editableTextOf(value: string): string {
  const text = value.trim()
  if (!looksLikeTextValue(text)) return text
  return text.slice(1, -1).replace(/\\(["\\nrtbf]|u[0-9A-Fa-f]{4})/g, (match, group: string) => {
    if (group === 'n') return '\n'
    if (group === 'r') return '\r'
    if (group === 't') return '\t'
    if (group === 'b') return '\b'
    if (group === 'f') return '\f'
    if (group === '\\' || group === '"') return group
    return String.fromCharCode(parseInt(group.slice(1), 16))
  })
}

/**
 * 工具条/快捷键的一次动作怎么改形态（上游：F2 ⇒ `tryEnableSetValueMode()` `:271-276`；
 * Ctrl+Enter ⇒ `disableSetValueMode(true)` + 写值 `:365-376`；Esc ⇒ `disableSetValueMode(false)` `:421-424`）。
 * 返回值里 `commit` 才是「要把新值发给适配器」的那一条。
 */
export function toolbarTransition(mode: QuickEvaluatePopupMode, action: string): { mode: QuickEvaluatePopupMode; commit: boolean } {
  if (action === 'set-value-mode') return { mode: mode === 'editing' ? mode : 'editing', commit: false }
  if (action === 'cancel-set-value') return { mode: 'value', commit: false }
  if (action === 'set-text-value') return mode === 'editing' ? { mode: 'value', commit: true } : { mode, commit: false }
  return { mode, commit: false }
}

