// 调试器悬停快速求值的**装配层** —— 上游 `QuickEvaluateHandler` + `ValueLookupManager` +
// `XDebuggerTextPopup`。
//
// 规则层（该不该求值、延迟多少、结果怎么合并、弹层多大、工具条有哪些条目、字符串怎么写回）
// 全在 `src/debugQuickEvaluate.ts`，那里是纯函数、带单测（`tests/debug-quick-evaluate.test.mjs`
// 与 `tests/dbg-hover-value-edit.test.mjs`）。本模块只把它们接到编辑器悬停通道与 DAP 上：
//   1. 悬停通道：`EditorView.domEventHandlers` 记最后一次鼠标修饰符 ⇒ `hoverHintKind`
//      （上游 `AbstractValueHint.java:460-469` 的 `getHintType`：只有「无修饰」与「Alt」出提示）；
//   2. 节流：`lookupDelayFor`（上游 `ValueLookupManager.java:143-149`）+ 到点时比可视区域
//      （同文件 `:127-141`）+ nonce 丢过期（`XDebuggerTextPopup.java:122`/`:154-157`）；
//   3. 弹层：值文本 + **真能用的工具条**（`QUICK_EVALUATE_TOOLBAR` 的四条，按
//      `XDebuggerTextPopup.java:285-290`/`:354-357` 的可见性规则只画点得动的那几条）；
//   4. 「显示为对象」= 把弹层就地换成树形态（上游 `:266-268` 的 `showTreePopup`，
//      本仓用 DAP `variables` 逐层懒加载，不新开窗口）；
//   5. 「进入改值 F2 / 设置文本值 Ctrl+Enter / 取消改值 Esc」= 就地编辑 + `setExpression`
//      （上游 `:271-276` / `:365-381` / `:421-424`）。
//
// 与上游的三处如实差异（都写在这里，不改判词口径）：
//   · 上游 `createValueHint` 拿 PSI 元素自己判断可不可求值，本仓没有 PSI ⇒ 入参是光标所在的
//     **整条访问链**（Alt 悬停且有选区时用选区，同 `XQuickEvaluateHandler.kt:69`+`:74`），
//     「有没有副作用」按词形判（`isSideEffectFree`）；
//   · 上游写值失败是「收起弹层 + 弹错误对话框」（`XDebuggerTextPopup.java:383-388`），
//     本仓弹层是 CodeMirror 的 hoverTooltip，没有独立对话框宿主 ⇒ 错误写在弹层自己那一行；
//   · 上游弹层是 `JBPopup` 且**自己抢焦点**（`XDebuggerTextPopup.java:172` `setRequestFocus(true)`），
//     三条快捷键由 popup 的 ActionManager 派发；本仓弹层是 CodeMirror 的 hover tooltip，
//     没有独立焦点宿主也不该从编辑器手里抢焦点（抢了会在鼠标移开时把焦点丢给 body）
//     ⇒ 快捷键挂在**编辑器根节点的捕获阶段**上，只在弹层显示期间存在（`buildPanel` 里挂、`destroy` 里摘）。
//     后果：焦点在编辑器里（悬停时的常态）三条键都好使；焦点在调试面板等别处时这几条不生效。
//     另外输入器仍在弹层里，鼠标移出弹层会随悬停销毁 —— 与
//     `XDebuggerTextPopup.java:160-165` 的 `cancelCallback`（收起即取消这次求值）同一后果；
//   · Esc 在**非改值态**于上游是「收起弹层」（`XDebuggerTextPopup.java:173-184` 的 keyEventHandler：
//     `mySetValueModeEnabled` 为 false 时 `isCloseRequest(event)` ⇒ `myPopup.cancel()`），
//     本仓用 `closeHoverTooltips` 实现同一条（CodeMirror 6.43 有这条通道：
//     `@codemirror/view/dist/index.d.ts:2123`，`dist/index.js:10963-10965` 把它落到每个 hover 状态场上）。
//
// 本轮（bucket12c）订正 4 条**上一版装配层写错/漏掉**的环节，都带机检判据
// （`tests/dbg-hover-value-edit.test.mjs`、`tests/debug-quick-evaluate.test.mjs`）：
//   1. **取词**（端到端断掉的主环）：上游拿的是**整个表达式**的 range，不是光标下那个标识符词
//      （`XQuickEvaluateHandler.kt:78` `getExpressionInfoAtOffset(...)` ⇒ `:82` `expressionInfo.textRange`
//      ⇒ `XValueHint.java:138` 把那个 range 交给 `AbstractValueHint`）。本仓原来只取「词」，
//      于是悬停 `order.total` 的 `total` 半截时发给适配器的是 `total` —— 单独不构成可求值表达式，
//      求值失败 ⇒ 普通悬停按 `XValueHint.java:421-427` 收起自己的提示 ⇒
//      **最常见的成员访问链永远不出提示**。现在按访问链（`.` / `->` / `::` / `[下标]`）整条取；
//      普通悬停在调用处截断（副作用门，同文件 `:73`），Alt 悬停把调用的实参括号并进表达式。
//      ⚠️ 无法核实：各语言求值器**具体**怎么截 —— `ExpressionTextUtil.java` / `JavaValueEvaluator.java`
//      在基准树里按文件名与 `find` 两条路都搜不到，所以这里实现的是语言无关的那条契约
//      （「range = 表达式」+「普通悬停不做有副作用的表达式」）。
//   2. **弹层范围**：原来只给 `pos` 不给 `end` ⇒ CodeMirror 按零宽点判「鼠标还在不在范围内」
//      （`@codemirror/view/dist/index.js:10853-10861`），鼠标在表达式里挪一格弹层就收起，
//      工具条那几条**点不到**。上游的自动隐藏条件是 `!isInsideCurrentRange(...)`
//      （`AbstractValueHint.java:304-311`，range 存于 `:117`/`:128-133`）= 「整条表达式内不隐藏」。
//   3. **延迟**：上一版写 `hoverTime: 0` 想把唯一那段等待留在规则层，但 CodeMirror 的实现是
//      `options.hoverTime || 300`（`@codemirror/view/dist/index.js:10974`）⇒ 0 被当成没给，
//      用户实等 300+700=**1000 ms**，比上游的**单段** 700 ms（`ValueLookupManager.java:135` + `:143-144`）
//      慢 300 ms。改成 1（CM 不吃 0），唯一一段真等待回到规则层。
//      同文件 `:129-140` 还有一条上一版漏掉的分支：**只有 MOUSE_OVER_HINT 走延时**，
//      Alt 悬停/点击落 `else` ⇒ **立即** `showHint` ⇒ 本仓 Alt 悬停不再白等 700 ms。
//   4. **Esc / 文本变更 / 方位**：非改值态的 Esc 收起弹层（见上）；弹层按 `HIDE_BY_TEXT_CHANGE`
//      随文本变更收起（`AbstractValueHint.java:328-332`）⇒ 补 `hideOnChange`；
//      提示方位是 `HintManager.UNDER`（同文件 `:324-331`）⇒ 弹层画在表达式**下方**（`above: false`）。
//
// 帧 id 从哪来（上游 `createValueHint` 拿的是当前挂起帧）：`dapState` 里**没有** frameId
// （`bridge.ts:497` 的形状是 running/paused/threadId/…），DebugPanel 的 `selectedFrame` 是它的私有状态。
// 所以这里走 `dap.stackTrace` 取**栈顶帧** —— 与 `src/editorInlineValues.ts:4` 记的同一条路。
import { EditorView, closeHoverTooltips, hoverTooltip } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import type { EditorState } from '@codemirror/state'
import {
  dapCapability, dapEvaluate, dapSetExpression, dapStackTrace, dapState, dapVariables, type DapVariable,
} from './bridge.ts'
import {
  acceptQuickEvaluateResult, canSetTextValue, convertToStringLiteral, editableTextOf, hoverHintKind,
  isSideEffectFree, lookupDelayFor, quickEvaluateDecision, quickEvaluatePopupSize,
  setQuickEvaluateSessionProbe, shouldRepaintValue, toolbarItem, toolbarTransition, viewportUnchanged,
  visibleToolbarModes, type QuickEvaluateHintKind, type QuickEvaluatePopupMode,
} from './debugQuickEvaluate.ts'
import { valueTooltipOptions } from './debugSettingsStore.ts'

/** 会话可用性：上游 `isEnabled(project)` 的等价物（`XQuickEvaluateHandler.kt:41-44`：当前会话有求值器）。 */
setQuickEvaluateSessionProbe(() => dapState.paused)

/**
 * 悬停通道的两个度量：
 *   · `IDLE_PROBE_MS` 是 CodeMirror「鼠标静止多久才问一次悬停源」，取 1 而**不是 0**：
 *     实现里写的是 `options.hoverTime || 300`（`@codemirror/view/dist/index.js:10974`），
 *     给 0 等于没给 ⇒ 会白等 300ms。求值本身的延迟只有规则层那一段 `lookupDelayFor`
 *     （上游也只有一个延时：`getValueLookupDelay()`，`ValueLookupManager.java:144`）；
 *   · 编辑器字符宽度的兜底值只在量不到时用（上游量 `myTextPanel.getPreferredSize()`）。
 */
const CHAR_WIDTH_FALLBACK = 7
const LINE_HEIGHT_FALLBACK = 18

export interface QuickEvaluateHintPorts {
  /**
   * 当前文件路径 —— **本装配层不用它**（DAP 的 `evaluate` 只吃 `expression + frameId`，
   * 上游 `createValueHint(editor, point, type)` 要的也是 PSI 元素而不是路径）。
   * 留着这一格只因为调用点 `src/components/CodeEditor.vue:63`（保留文件）已经传了
   * `path: () => props.path`；声明成可选，以后真要按文件加门（比如只在暂停文件里提示）再启用。
   */
  path?: () => string
  /** 查值延迟（ms）与「悬停显示值提示」开关；默认读 `src/debugSettingsStore.ts` 的那一份。 */
  valueLookupDelay?: () => number | undefined
  showTooltip?: () => boolean
  /** 拿栈顶帧 id。默认走 `dap.stackTrace` 的第一帧。 */
  frameId?: () => Promise<number>
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 光标下的**标识符词**范围（不含访问链）。`end` 是「词后一个字符」的偏移（半开区间）。
 * 切不出合法标识符 ⇒ `from === end` ⇒ 文本空串 ⇒ `quickEvaluateDecision` 判「光标处没有可求值的词」。
 */
export function wordRangeAtPosition(state: EditorState, pos: number): { from: number; end: number; text: string } {
  const line = state.doc.lineAt(pos)
  const column = pos - line.from
  const isWord = (char: string) => /[A-Za-z0-9_$]/.test(char)
  let start = column
  let end = column
  while (start > 0 && isWord(line.text[start - 1] ?? '')) start--
  while (end < line.text.length && isWord(line.text[end] ?? '')) end++
  if (end <= start) return { from: pos, end: pos, text: '' }
  const from = line.from + start
  const to = line.from + end
  return { from, end: to, text: state.sliceDoc(from, to) }
}

/** 光标处的词（**只到标识符边界**，规则层的判据与既有判据测试用它；装配层取表达式用 `expressionRangeAtPosition`）。 */
export function wordAtPosition(state: EditorState, pos: number): string {
  return wordRangeAtPosition(state, pos).text
}

const isWordChar = (char: string) => /[A-Za-z0-9_$]/.test(char)

/** 分隔符长度：`.`（Java/C++ 成员）、`::`（静态限定）、`->`（C++ 指针成员）。 */
function separatorLength(text: string, index: number): number {
  const char = text[index] ?? ''
  if (char === '.') return 1
  if (char === ':' && text[index + 1] === ':') return 2
  if (char === '-' && text[index + 1] === '>') return 2
  return 0
}

/** `[下标]` 段长度：单层、不嵌套、不跨行（与规则层 `isSideEffectFree` 的 `[^\][\n]*` 同一条口径）。 */
function bracketLength(text: string, index: number): number {
  if (text[index] !== '[') return 0
  const close = text.indexOf(']', index + 1)
  return close < 0 ? 0 : close - index + 1
}

/** 从 `index` 处的 `(` 找到配对 `)`（同行、嵌套计数）；找不到给 -1。 */
function matchingParen(text: string, index: number): number {
  let depth = 0
  for (let i = index; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') { depth--; if (depth === 0) return i }
  }
  return -1
}

export interface AccessChainSpan {
  start: number
  end: number
  /** 各**标识符段**的行内区间；普通悬停在调用处截断时丢掉最后一段用它。 */
  segments: { start: number; end: number }[]
}

/**
 * 一行里所有**极大访问链**（`order.total`、`node->next`、`Map.Entry`、`list[0].name`、`a[0][1]`）。
 * `includeCalls`（= Alt 悬停，上游允许副作用，`XQuickEvaluateHandler.kt:73`）把紧跟的实参括号组
 * 并进同一条链；否则链在 `(` 前结束，此时**最后一段就是「调用的方法名」**，由调用方截掉。
 * 分隔符（`.`/`::`/`->`）后面必须跟标识符才算同一条链，下标段（`[…]`）可以就是链尾。
 */
export function accessChainSpans(text: string, includeCalls: boolean): AccessChainSpan[] {
  const spans: AccessChainSpan[] = []
  let index = 0
  while (index < text.length) {
    if (!isWordChar(text[index] ?? '')) { index++; continue }
    const start = index
    const segments: { start: number; end: number }[] = []
    let end = index
    while (end < text.length && isWordChar(text[end] ?? '')) end++
    segments.push({ start, end })
    for (;;) {
      if (includeCalls && text[end] === '(') {
        const close = matchingParen(text, end)
        if (close < 0) break
        end = close + 1
        continue
      }
      let probe = end
      let brackets = 0
      for (;;) {
        const bracket = bracketLength(text, probe)
        if (!bracket) break
        probe += bracket
        brackets += bracket
      }
      const separator = separatorLength(text, probe)
      const head = probe + separator
      if (separator && isWordChar(text[head] ?? '')) {
        let stop = head
        while (stop < text.length && isWordChar(text[stop] ?? '')) stop++
        segments.push({ start: head, end: stop })
        end = stop
        continue
      }
      // 只有下标段（`list[0]`、`m[1][2]`）时它本身就是链尾。
      if (brackets) end = probe
      break
    }
    spans.push({ start, end, segments })
    index = end
  }
  return spans
}

/**
 * 光标所在的**整条访问链**（上游 `expressionInfo.textRange` 的无 PSI 等价物，
 * `XQuickEvaluateHandler.kt:78-82` + `XValueHint.java:138`）：
 *   · 光标落在那条链的任何一段里都取**整条**（`order.total` 悬停 `total` ⇒ 求 `order.total`，
 *     这正是上一版「只取标识符词」导致成员访问链永远出不了提示的那一环）；
 *   · **普通悬停**在调用处截断并丢掉方法段（`order.getTotal()` ⇒ `order`；裸 `foo()` ⇒ 空串不弹），
 *     因为普通悬停不允许副作用（`XQuickEvaluateHandler.kt:73` + 规则层 `allowsSideEffects`）；
 *   · **Alt 悬停**把实参括号组并进表达式（`order.getTotal()`）。
 * 返回的 range 同时是**弹层的范围**（订正 2），所以它必须与文本严格对齐。
 */
export function expressionRangeAtPosition(
  state: EditorState, pos: number, kind: QuickEvaluateHintKind,
): { from: number; end: number; text: string } {
  const word = wordRangeAtPosition(state, pos)
  if (!word.text) return word
  const line = state.doc.lineAt(pos)
  const column = word.from - line.from
  const chain = accessChainSpans(line.text, kind === 'altHover')
    .find(span => span.start <= column && column < span.end)
  if (!chain) return word
  let end = chain.end
  if (kind !== 'altHover' && line.text[end] === '(') {
    // 丢最后一个段（方法名）连同它前面的连接符。
    const last = chain.segments[chain.segments.length - 1]
    if (!last || last.start <= chain.start) return { from: word.end, end: word.end, text: '' }
    end = last.start
    while (end > chain.start && !isWordChar(line.text[end - 1] ?? '')) end--
    if (end <= chain.start) return { from: word.end, end: word.end, text: '' }
  }
  const from = line.from + chain.start
  const to = line.from + end
  return { from, end: to, text: state.sliceDoc(from, to) }
}

/**
 * 求值的表达式：Alt 悬停且光标落在**手动选区**里时取选区（上游 `XQuickEvaluateHandler.kt:69`+`:74`
 * 的 `selectionRange` ⇒ `ExpressionInfo(selectionRange, isManualSelection = true)`），
 * 否则取光标所在的那条访问链。
 */
export function expressionAtPosition(state: EditorState, pos: number, kind: QuickEvaluateHintKind): string {
  return expressionRangeForHint(state, pos, kind).text
}

/** 表达式与其范围：选区优先（与 `expressionAtPosition` 同一条判据），否则用访问链的 range。 */
export function expressionRangeForHint(
  state: EditorState, pos: number, kind: QuickEvaluateHintKind,
): { from: number; end: number; text: string } {
  if (kind === 'altHover') {
    const { from, to, empty } = state.selection.main
    if (!empty && pos >= from && pos <= to) {
      const text = state.sliceDoc(from, to)
      // 选区两端的首尾空白不属于表达式：上游拿的是 `selectionStart/End`（`XQuickEvaluateHandler.kt:69`），
      // 这里为对齐求值文本把空白剥掉，range 随之收缩，弹层不会盖住空格。
      const lead = text.length - text.trimStart().length
      const tail = text.length - text.trimEnd().length
      return { from: from + lead, end: to - tail, text: text.trim() }
    }
  }
  return expressionRangeAtPosition(state, pos, kind)
}

/** 栈顶帧 id：`dap.stackTrace` 的第一帧（与 `src/editorInlineValues.ts:4` 同一条路）。 */
async function topFrameId(): Promise<number> {
  const trace = await dapStackTrace(dapState.threadId)
  return trace.frames[0]?.id ?? 0
}

/** 一次悬停的私有状态（模块级：本仓只有一个调试会话，与 `XDebuggerTextPopup` 的一次展示同生命周期）。 */
let nonce = 0

/** 「同一次展示已经画出来的那一个表达式的值文本」—— 上游 `lastFullValueHashCode` 的等价物。 */
interface QuickEvaluateDisplay { expression: string; text: string }

/**
 * 「上一次已经画出来的值」—— 上游 `preventDoubleExecution` 比的是 **同一次展示里、同一个表达式**
 * 的值文本（`XDebuggerTextPopup.java:127-140`：`lastFullValueHashCode` 随每次 `show()` 新建一个
 * `AtomicReference`）。本仓把「弹层收起（`destroy`）」当作一次展示的结束，
 * 换表达式也当另一次比对：否则连着悬停两个值都是 `0` 的变量时，第二个永远不弹（真实缺陷）。
 */
let shown: QuickEvaluateDisplay | null = null
/** 上游 `myCurrentHint != null && !isHintHidden()` 的等价物 —— 决定 `max(100, delay)` 那一档。 */
let popupShowing = false

/**
 * 同值不重画的比较边界（纯函数，`tests/dbg-hover-value-edit.test.mjs` 直接测它）：
 * 只有「同一个表达式 + 同一次展示」才复用上一次的文本；否则返回 `undefined` ⇒ 一定重画。
 */
export function lastShownText(last: QuickEvaluateDisplay | null, expression: string): string | undefined {
  return last && last.expression === expression ? last.text : undefined
}

/**
 * 弹层显示期间的快捷键 ⇒ 工具条动作（纯函数）。
 * 上游：弹层 `setRequestFocus(true)`（`XDebuggerTextPopup.java:172`）后由 ActionManager 按 shortcutSet 派发
 * —— F2 `:394`、Ctrl+Enter `:349`、Esc `:418`；而 `shouldBeVisible`（`:286-290`）规定
 * 「进入改值/取消改值」两档互斥可见 ⇒ 改值态按 F2 无事发生、非改值态按 Ctrl+Enter 也无事发生。
 * 这里就是那条互斥规则的等价物。
 * 非改值态的 Esc 派 `hide-hint`：上游 `keyEventHandler`（`:173-184`）在 `mySetValueModeEnabled` 为 false
 * 时把 close request（Esc）交给 `myPopup.cancel()` ⇒ 收起整个弹层；本仓用 `closeHoverTooltips`
 * 落到同一条（`@codemirror/view/dist/index.js:10963-10965` 会把它应用到每个 hover 状态场上，
 * 所以一起收掉的还有语言服务的悬停提示 —— 与上游 `HintManager` 一次只显示一个提示槽位的后果一致）。
 */
export function quickEvaluateKeyAction(
  event: { key: string; ctrlKey?: boolean; metaKey?: boolean }, mode: QuickEvaluatePopupMode,
): string | null {
  if (event.key === 'F2') return mode === 'editing' ? null : 'set-value-mode'
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) return mode === 'editing' ? 'set-text-value' : null
  if (event.key === 'Escape') return mode === 'editing' ? 'cancel-set-value' : 'hide-hint'
  return null
}

/**
 * 悬停通道**同步**那半边的判据（修饰符 + 取词 + 会话 + 能力位 + 设置）：装配层的 `source` 用它，
 * 也导出来给宿主用 —— 上游一次只显示一个悬停提示（`AbstractValueHint.java:295` 先 `hideCurrentHint()`
 * 再展示，`HintManager` 是一个槽位），本仓的 CodeMirror 却会把多个 hover 源并排画出来
 * ⇒ 语言服务那条悬停要在「值提示会接管这个位置」时让路（见接线请求）。
 * 注意：它**不含**求值成败（要发请求才知道），所以调用方只在「值提示确实可能弹出」时让路。
 */
export function quickEvaluateCoversPosition(
  state: EditorState, pos: number, options: QuickEvaluateHintPorts = {},
): boolean {
  const kind = hoverHintKind(lastMouse)
  if (!kind) return false
  const expression = expressionRangeForHint(state, pos, kind).text
  if (kind !== 'altHover' && !isSideEffectFree(expression)) return false
  const settings = valueTooltipOptions()
  return quickEvaluateDecision(expression, {
    showTooltip: options.showTooltip ? options.showTooltip() : settings.showTooltip,
    valueLookupDelay: options.valueLookupDelay ? options.valueLookupDelay() : settings.valueLookupDelay,
    evaluateForHovers: hoverContextSupported(),
  }).evaluate
}

/** 可视区域判据（`ValueLookupManager.java:129-135` 比的是 `getVisibleArea()`）。 */
function viewportOf(view: EditorView): { top: number; left: number } {
  return { top: Math.round(view.scrollDOM.scrollTop), left: Math.round(view.scrollDOM.scrollLeft) }
}

/** 屏幕矩形（上游 `ScreenUtil.getScreenRectangle(toolbar)` `:235`：量弹层所在那块屏）。 */
function screenRectangle(): { width: number; height: number } {
  const screen = typeof window !== 'undefined' ? window.screen : undefined
  return {
    width: screen?.width || (typeof window !== 'undefined' ? window.innerWidth : 800),
    height: screen?.height || (typeof window !== 'undefined' ? window.innerHeight : 600),
  }
}

/** 鼠标修饰符：hoverTooltip 的 source 拿不到事件，所以由同一条扩展链上的 domEventHandlers 记下来。 */
let lastMouse: { altKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean } = {}

const mouseModifierTracker: Extension = EditorView.domEventHandlers({
  mousemove(event) { lastMouse = { altKey: event.altKey, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, metaKey: event.metaKey } },
})

// 弹层里工具条/输入器/树的样式：`src/style.css` 是保留文件，而这三块是**本扩展自己**的 DOM
// （CodeMirror 把 tooltip 挂在编辑器 DOM 里），所以按 CodeMirror 的 baseTheme 机制自带，
// 颜色/间距全部取 `src/tokens.css` 的令牌，不写裸色值、不写动效。
const hoverValueTheme: Extension = EditorView.baseTheme({
  '& .quick-eval-toolbar': {
    display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)',
    paddingTop: 'var(--space-1)', borderTop: '1px solid var(--line)',
  },
  '& .quick-eval-tool': {
    padding: '1px var(--space-1)', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-xs)',
    background: 'var(--elevated)', color: 'var(--text)', fontSize: '11px', cursor: 'pointer',
  },
  '& .quick-eval-tool:hover': { background: 'var(--hover)', color: 'var(--bright)' },
  '& .quick-eval-edit': {
    width: '100%', minWidth: '120px', color: 'var(--text)', background: 'var(--editor)',
    border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-xs)',
    font: '12px var(--font-mono)', padding: '1px var(--space-1)',
  },
  '& .quick-eval-tree': { display: 'flex', flexDirection: 'column', gap: '1px' },
  '& .quick-eval-tree-nested': { paddingLeft: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: '1px' },
  '& .quick-eval-tree-row': { display: 'flex', alignItems: 'center', gap: 'var(--space-1)', font: '11px/1.5 var(--font-mono)' },
})

export function createQuickEvaluateHint(ports: QuickEvaluateHintPorts) {
  const source = async (view: EditorView, pos: number) => {
    const settings = valueTooltipOptions()
    const options = {
      showTooltip: ports.showTooltip ? ports.showTooltip() : settings.showTooltip,
      valueLookupDelay: ports.valueLookupDelay ? ports.valueLookupDelay() : settings.valueLookupDelay,
    }
    // 悬停类型：其它修饰符在上游直接不出提示（`AbstractValueHint.java:460-469`）。
    const kind = hoverHintKind(lastMouse)
    if (!kind) return null
    // 取的是**整条访问链**而不是光标下那个词，range 同时用作弹层范围（订正 1、2）。
    const target = expressionRangeForHint(view.state, pos, kind)
    const expression = target.text
    // 普通悬停不允许有副作用的表达式（`XQuickEvaluateHandler.kt:74-84`）。
    if (!isSideEffectFree(expression) && !(kind === 'altHover')) return null
    const decision = quickEvaluateDecision(expression, { ...options, evaluateForHovers: hoverContextSupported() })
    if (!decision.evaluate) return null
    // 只有普通悬停走延时：上游 `ValueLookupManager.java:129-140` 把 MOUSE_OVER_HINT 排进 alarm，
    // Alt 悬停/点击落 `else` 分支 ⇒ 立即 showHint。唯一的等待就是规则层那一段 `getValueLookupDelay`
    // （`debugQuickEvaluate.ts:DEFAULT_VALUE_LOOKUP_DELAY` = 上游 700ms）。
    if (kind === 'hover') {
      const area = viewportOf(view)
      await sleep(lookupDelayFor(decision.delay, popupShowing))
      // 等待期间滚了屏 ⇒ 这次不弹（上游到点时比 `getVisibleArea()`，同文件 `:132`）。
      if (!viewportUnchanged(area, viewportOf(view))) return null
    }
    const issued = ++nonce
    try {
      const frameId = ports.frameId ? await ports.frameId() : await topFrameId()
      const result = await dapEvaluate(expression, 'hover', frameId)
      const accepted = acceptQuickEvaluateResult(issued, nonce, { value: result.result })
      if (!accepted) return null
      const value = `${accepted.value}${result.type ? ` : ${result.type}` : ''}`
      // 同一次展示里同一个表达式的值没变 ⇒ 不重画（上游 :127-140）；换表达式/收起过弹层 ⇒ 重画。
      if (!shouldRepaintValue(lastShownText(shown, expression), value)) return null
      shown = { expression, text: value }
      return tooltipSpec(view, target, {
        expression, frameId, value: accepted.value, displayText: value,
        reference: result.variablesReference ?? 0, kind, options,
      })
    }
    catch (caught) {
      // 失败：普通悬停收起自己的提示、让位给信息提示（`XValueHint.java:421-427`）；
      // Alt 悬停把错误文本画出来（同文件 `:416-418` 的点击档形态）。
      // 「让位」在本仓的落点：这一次不画弹层，比对基准作废，鼠标停在原地时下一次 hover 由
      // 语言服务那条悬停通道出文档提示（本模块自己不抢那个槽位；两道的先后见接线请求）。
      if (kind !== 'altHover') { shown = null; return null }
      const message = caught instanceof Error ? caught.message : String(caught)
      return tooltipSpec(view, target, {
        expression, frameId: 0, value: '', displayText: message, reference: 0, kind, options, failed: true,
      })
    }
  }
  // `hoverTime` 是 CodeMirror 自己的「鼠标静止多久才问一次源」，实现里写的是 `options.hoverTime || 300`
  // （`@codemirror/view/dist/index.js:10974`）⇒ **给 0 会被当成没给而退回 300**（上一版就踩了这个），
  // 于是用户实等 300+700=1000ms。取 1（CM 能接受的最小有效值）把唯一一段真等待留在规则层。
  // `hideOnChange`：上游提示按 `HIDE_BY_TEXT_CHANGE` 随文本变更收起（`AbstractValueHint.java:328-332`）。
  return [mouseModifierTracker, hoverValueTheme,
    hoverTooltip(source, { hoverTime: IDLE_PROBE_MS, hideOnChange: true })]
}

/** CodeMirror 的「鼠标静止多久才问悬停源」；见上面那条 `|| 300` 的说明，0 是无效值。 */
const IDLE_PROBE_MS = 1

/**
 * 适配器认不认 hover 上下文（DAP `supportsEvaluateForHovers` —— `Evaluate` 的 hover 上下文
 * 就是这条能力位控制的）。`dapCapability` 给的是严格布尔（`src/bridge.ts:835`），而能力表只在
 * `dapStart` 拿到 `initialize` 响应后被灌进去（`src/bridge.ts:715`）⇒ **没声明就是 false**：
 * 不给它发注定失败的请求，也不画点不动的提示（本仓自带的假适配器就明确报 false，
 * `native/dap_fake_adapter.cpp:302`，所以那条会话下悬停求值整体不出现，这是预期行为）。
 */
function hoverContextSupported(): boolean {
  return dapCapability('supportsEvaluateForHovers') === true
}

interface PanelInput {
  expression: string
  frameId: number
  /** 适配器的原始值文本（改值时判「是不是字符串形态」用它）。 */
  value: string
  /** 弹层上显示的那一行（含 `: type` 后缀）。 */
  displayText: string
  /** DAP `variablesReference`：>0 才有「显示为对象」可点。 */
  reference: number
  kind: QuickEvaluateHintKind
  options: { showTooltip?: boolean; valueLookupDelay?: number }
  /** 求值失败的展示（只有 Alt 悬停会走到这里）。 */
  failed?: boolean
}

/**
 * 弹层规格：范围 = 整条表达式（订正 2，上游 `XValueHint.java:138` 把 `expressionInfo.getTextRange()`
 * 交给 `AbstractValueHint`，自动隐藏条件是同文件 `:304-311` 的 `!isInsideCurrentRange`）；
 * 方位 = 表达式**下方**（`AbstractValueHint.java:324-331` 用的是 `HintManager.UNDER`）。
 */
function tooltipSpec(view: EditorView, target: { from: number; end: number }, input: PanelInput) {
  const length = view.state.doc.length
  const pos = Math.max(0, Math.min(length, target.from))
  const end = Math.max(pos, Math.min(length, target.end))
  return {
    pos,
    end: end > pos ? end : undefined,
    above: false,
    create: () => buildPanel(view, input),
  }
}

/** 建弹层 DOM 并接好三条真动作；返回 CodeMirror 的 TooltipView。 */
function buildPanel(view: EditorView, input: PanelInput) {
  const dom = document.createElement('div')
  dom.className = 'quick-eval-hint'
  let mode: QuickEvaluatePopupMode = 'value'
  let treeError = ''

  const textRow = document.createElement('div')
  textRow.className = 'quick-eval-value'
  const toolbarRow = document.createElement('div')
  toolbarRow.className = 'quick-eval-toolbar'
  dom.append(textRow, toolbarRow)

  const settable = canSetTextValue(input.value, dapCapability('supportsSetExpression') === true)
  const flags = { hasChildren: input.reference > 0 && !input.failed, canSetText: settable && !input.failed }
  /** 上游 `shouldBeVisible` + `update()`：形态换了就重算一遍条目。 */
  function renderToolbar() {
    toolbarRow.replaceChildren()
    for (const item of visibleToolbarModes(mode, flags)) {
      const meta = toolbarItem(item)
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'quick-eval-tool'
      button.textContent = meta.shortcut ? `${meta.label} (${meta.shortcut})` : meta.label
      button.title = meta.label
      button.setAttribute('aria-label', meta.label)
      button.addEventListener('click', () => run(item))
      toolbarRow.append(button)
    }
  }

  function renderValue() {
    textRow.textContent = input.displayText
  }

  /** 树形态（上游 `showTreePopup` → `XDebuggerTreePopup`；本仓就地换内容，不新开窗口）。 */
  function renderTree() {
    textRow.textContent = ''
    const list = document.createElement('div')
    list.className = 'quick-eval-tree'
    textRow.append(list)
    void fillTree(list, input.reference)
  }

  const input2 = document.createElement('input')
  input2.className = 'quick-eval-edit'
  input2.spellcheck = false
  input2.setAttribute('aria-label', '新的值')

  function renderEditing() {
    textRow.textContent = ''
    input2.value = editableTextOf(input.value)
    textRow.append(input2)
    input2.focus()
    input2.select()
  }

  async function fillTree(list: HTMLElement, reference: number) {
    try {
      const children = (await dapVariables(reference)).variables ?? []
      for (const child of children) list.append(treeRow(child))
      if (!children.length) list.textContent = treeError || '这个值没有子节点。'
    }
    catch (caught) {
      list.textContent = caught instanceof Error ? caught.message : String(caught)
    }
  }

  function treeRow(child: DapVariable): HTMLElement {
    const row = document.createElement('div')
    row.className = 'quick-eval-tree-row'
    row.textContent = `${child.name} = ${child.value}${child.type ? ` : ${child.type}` : ''}`
    if (child.reference > 0) {
      const more = document.createElement('button')
      more.type = 'button'
      more.className = 'quick-eval-tool'
      more.textContent = '展开'
      more.title = `展开 ${child.name}`
      more.setAttribute('aria-label', `展开 ${child.name}`)
      more.addEventListener('click', () => {
        const kids = document.createElement('div')
        kids.className = 'quick-eval-tree-nested'
        row.append(kids)
        void fillTree(kids, child.reference)
      })
      row.append(more)
    }
    return row
  }

  /** 提交改值（上游 `SetTextValueAction.actionPerformed` `:365-376`）。 */
  async function commit() {
    const transition = toolbarTransition(mode, 'set-text-value')
    mode = transition.mode
    if (!transition.commit) return
    const literal = convertToStringLiteral(input2.value)
    try {
      await dapSetExpression(input.expression, literal, input.frameId)
      input.value = literal
      input.displayText = literal
      // 写回之后这次展示的值已经是旧的：清掉比对基准，下一次悬停同一个表达式要重新求值重新画。
      shown = null
      renderValue()
    }
    catch (caught) {
      // 上游这里收起弹层并弹错误对话框（`:383-388`）；本仓把消息写在同一行（模块头记的差异）。
      treeError = caught instanceof Error ? caught.message : String(caught)
      textRow.textContent = treeError
    }
    renderToolbar()
  }

  function run(action: string) {
    const transition = toolbarTransition(mode, action)
    if (action === 'show-as-object') { renderTree(); renderToolbar(); return }
    mode = transition.mode
    if (action === 'set-value-mode') { renderEditing(); renderToolbar(); return }
    if (action === 'cancel-set-value') { renderValue(); renderToolbar(); return }
    if (transition.commit) void commit()
  }

  function onKeyDown(event: KeyboardEvent) {
    // 快捷键：F2 进改值（`:391-395`）、Ctrl+Enter 提交（`:346-351`）、Esc 取消改值（`:414-419`）、
    // 非改值态的 Esc 收起弹层（`:173-184`），形态互斥的可见性由 `quickEvaluateKeyAction` 判（`:286-290`）。
    const action = quickEvaluateKeyAction(event, mode)
    if (!action) return
    event.preventDefault()
    // 捕获阶段拦下：CodeMirror 自己也在编辑器根节点上听 keydown（Ctrl+Enter 在默认键位表里是换行），
    // 冒泡阶段的 stopPropagation 拦不住同一节点上的另一个监听器。
    event.stopPropagation()
    if (action === 'set-text-value') void commit()
    else if (action === 'hide-hint') view.dispatch({ effects: closeHoverTooltips })
    else run(action)
  }
  // 上游弹层自己抢焦点（`:172` setRequestFocus）；本仓的 hover tooltip 没有焦点宿主，
  // 所以这三条键挂两处，且**只在弹层显示期间存在**（收起时摘掉）：
  //   · 编辑器根节点的**捕获**阶段 —— 覆盖「焦点还在编辑器里」（悬停的常态）按 F2 进改值；
  //     用捕获是因为 CodeMirror 自己也在同一个节点上听 keydown（Ctrl+Enter 在默认键位表里是换行），
  //     冒泡阶段的 stopPropagation 拦不住同一节点上的另一个监听器；
  //   · 弹层自己 —— 覆盖「焦点已经进了改值输入器」。补全 UI 开着时 tooltip 挂在 `document.body`
  //     （`src/completionUi.ts:239` 的 `tooltips({ parent: document.body })`，那条链在
  //     `lspExtensions()` 里 ⇒ 只在有语言服务时生效），那种形态下键事件根本不路过编辑器根节点。
  // 两处不会重复触发：弹层在编辑器里时捕获阶段先 `stopPropagation`，事件到不了输入器；
  // 弹层在 body 上时只有弹层这一条听得到。
  view.dom.addEventListener('keydown', onKeyDown, true)
  dom.addEventListener('keydown', onKeyDown)


  if (input.kind === 'altHover' && !input.failed && flags.hasChildren) renderTree()
  else renderValue()
  renderToolbar()
  popupShowing = true

  // 尺寸（上游 `resizePopup` `:218-241`）：先把 DOM 挂到屏幕外量一次，再按规则夹。
  const probe = document.createElement('div')
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  probe.append(dom)
  document.body.append(probe)
  const textWidth = textRow.scrollWidth || input.displayText.length * CHAR_WIDTH_FALLBACK
  const textHeight = textRow.scrollHeight || LINE_HEIGHT_FALLBACK
  const toolbarWidth = toolbarRow.scrollWidth
  const toolbarHeight = toolbarRow.scrollHeight
  probe.remove()
  const screen = screenRectangle()
  const size = quickEvaluatePopupSize(textWidth, textHeight, screen.width, screen.height,
    { ...input.options, toolbarWidth, toolbarHeight })
  dom.style.width = `${size.width}px`
  return {
    dom,
    // 输入器/工具条/树里的交互归弹层自己：别让编辑器的键位与选区把它们吃掉。
    stopEvent: (event: Event) => {
      const target = event.target
      return target instanceof Element && Boolean(target.closest('.quick-eval-tool, .quick-eval-edit, .quick-eval-tree'))
    },
    destroy: () => {
      view.dom.removeEventListener('keydown', onKeyDown, true)
      dom.removeEventListener('keydown', onKeyDown)
      popupShowing = false
      // 一次展示结束（上游 popup 的 cancelCallback，`:160-165`）：比对基准随之作废。
      shown = null
    },
  }
}
