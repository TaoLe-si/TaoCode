import { acceptCompletion, autocompletion, closeCompletion, completionStatus, currentCompletions, pickedCompletion, startCompletion, type Completion, type CompletionSource } from '@codemirror/autocomplete'
import { Prec, EditorSelection, type EditorState } from '@codemirror/state'
import { EditorView, ViewPlugin, getTooltip, keymap, repositionTooltips, showTooltip, tooltips, type TooltipView, type ViewUpdate } from '@codemirror/view'
import { completionIcon } from './completionIcons.ts'
import { completionPresentation, type PresentedCompletion } from './completionPresentation.ts'
import { beginCompletion, completionModeForEvent, endCompletion, type CompletionMode } from './completionModes.ts'
import { hippieStep, type HippieState } from './cyclicWordCompletion.ts'
import { otherOpenEditorTexts } from './completionOpenEditors.ts'
// 弹层侧的四条 EP（声明与出处见 `src/completionExtensionPoints.ts` 的「第二批」段）：
//   · `com.intellij.lookup.charFilter` → 下面的 `lookupCharFilter`（输入到来时逐个问）；
//   · `com.intellij.lookup.actionProvider` → `handleLookupActionKey`（Alt+Enter 的上下文动作）；
//   · `com.intellij.lookup.usageDetails` → `recordLookupUsage`（一轮结束时的用量记录）。
import {
  charFilterDecision, lookupActionProviders, lookupActionsFor, lookupCharFilters, lookupUsageDescriptors,
  lookupUsageRecord, type LookupActionContext,
} from './completionExtensionPoints.ts'

// 三条补全键位（`platform/platform-resources/src/keymaps/$default.xml`）：
//   · `CodeCompletion` = Ctrl+Space —— `:732-734`（`CodeCompletionAction.java:12-17`，BASIC）；
//   · `SmartTypeCompletion` = Ctrl+Shift+Space —— `:909-911`（`SmartCodeCompletionAction.java:11-17`，SMART）；
//   · `ClassNameCompletion` = Ctrl+Alt+Space —— `:843-845`（`ClassNameCompletionAction.java:11-17`，
//     **BASIC + 第二次调用**，`CompletionParameters.java:113-115`）。
// 模式与「第几次调用」记在 `completionModes.ts` 那份**按 EditorView 存**的状态上（上游那份挂在
// `CompletionServiceImpl` 的 `CompletionPhase` 上，`CodeCompletionHandlerBase.java:210-213`：
// 同一个键再按一次才递增 `invocationCount`，弹层关掉就是新一轮）。
// 三条不能互相冒充：BASIC 只认裸 Ctrl+Space（`!shiftKey && !altKey`），Shift/Alt 各自走自己的模式；
// 那张判定表在只读参考 `completionModes.ts:57-65` 的 `completionModeForEvent`（它对三条键位
// 逐条对上游，含输入法合成码 229/`Process` 的排除）。以前这里另有一份只认 BASIC 的
// `isBasicCompletionKey`/`handleBasicCompletionKey`，三条键位因此只落了 1 条 —— 已由
// `handleCompletionModeKey` 取代（判据 `tests/completion-mode-keys.test.mjs`）。

/** 正在"关-开"重查的编辑器（见 `handleCompletionModeKey`）：那一次中间状态不算一轮结束。 */
const reopeningViews = new WeakSet<EditorView>()

/**
 * 这一台编辑器现在有没有补全弹层（上游那份状态挂在 `CompletionPhase` 上，
 * `CodeCompletionHandlerBase.java:210-213`：开着再按 = 第 N 次调用，关了就是新一轮）。
 * 本仓那份在 `completionModes.ts` 的 WeakMap 里，所以「弹层关了要把状态清掉」这件事
 * 由 `completionLayout` 那个 ViewPlugin 在每次 state 更新时代做（`endCompletionIfRoundOver`）。
 */
export function completionRoundActive(view: EditorView): boolean {
  return completionStatus(view.state) === 'active'
}

function endCompletionIfRoundOver(view: EditorView): void {
  if (!completionRoundActive(view) && !reopeningViews.has(view)) endCompletion(view)
}

/**
 * 按模式起一次补全 —— **键位与菜单共用的唯一入口**。
 * 弹层已经开着时同一档再按 = 放宽一档（上游 `CodeCompletionHandlerBase.java:210-213` 在补全还开着时
 * 把 `invocationCount` 往上加，`phase.newCompletionStarted(...)`），表跟着重新算一次。
 * CodeMirror 的 `startCompletion` 在弹层开着时是 no-op（它只负责"起"），所以这里用「关-开」两次
 * dispatch 逼它重新查询；中间那一次不能被收尾判定当成"这一轮结束了" —— 那是 `reopeningViews` 的作用。
 * 弹层没开 = 新一轮：先把上一次的状态作废，否则上次的模式会跟着这次的查询。
 *
 * 菜单 / Find Action 那一侧（`Code > 代码补全`，见接线请求 W2）也走这里：
 * `LookupImpl.java:248` 的 lookup 不抢焦点，所以先 `view.focus()` 把键权还给编辑器。
 */
export function startCompletionAs(view: EditorView, mode: CompletionMode): boolean {
  const active = completionRoundActive(view)
  if (!active) endCompletion(view)
  beginCompletion(view, mode)
  view.focus()
  if (active) {
    reopeningViews.add(view)
    try {
      closeCompletion(view)
      startCompletion(view)
    } finally {
      reopeningViews.delete(view)
    }
    return true
  }
  const started = startCompletion(view)
  // 没起弹层就别把这次的模式留在状态上（下一次查询会是别人的一轮）。
  if (!started) endCompletion(view)
  return started
}

/** `CodeCompletion`（`$default.xml:732-734`，`CodeCompletionAction.java:12-17` 的 BASIC）。 */
export function startBasicCompletion(view: EditorView): boolean {
  return startCompletionAs(view, 'basic')
}

/**
 * 弹层侧三条 EP 共用的上下文（`Lookup` + `LookupElement` 的可移植替代，形状见
 * `src/completionExtensionPoints.ts` 的 `LookupActionContext`）。
 * **如实的两处缺**：① 路径与语言在这一层拿不到（弹层是编辑器侧的 CodeMirror 扩展，宿主的
 * 文件路径/语言注入点在禁改的 `src/components/CodeEditor.vue` 里）⇒ 两条 EP 的语言收窄不生效
 * （`completionAcceptsLanguage` 的「未知不收窄」），其余字段齐；② 前缀按光标前的标识符算
 * （CodeMirror 只把 `from` 交给 `inputHandler`，不暴露 `prefixLength`），候选项取 `currentCompletions`
 * 的第一条 —— 上游那一格是「当前选中项」，CM 的公开 API 不暴露选中索引，取首条是最近似的那一档。
 */
export function lookupContext(view: EditorView, outcome: LookupActionContext['outcome']): LookupActionContext {
  const head = view.state.selection.main.head
  const line = view.state.doc.lineAt(head)
  const word = /[\p{L}\p{N}_$]+$/u.exec(view.state.sliceDoc(line.from, head))?.[0] ?? ''
  const current = currentCompletions(view.state)[0]
  return {
    path: '', language: '',
    prefix: word,
    lookupString: current ? String(current.displayLabel ?? current.label) : '',
    itemKind: current?.type,
    outcome,
  }
}

/**
 * `com.intellij.lookup.charFilter` 的**唯一消费点**：输入到来时逐个问登记表
 * （上游 `CharFilter.acceptChar(c, prefixLength, lookup)`，`CharFilter.java:69`）。
 * 没有贡献者（`lookupCharFilters` 空）或没人认这个字符（返回 null）时**返回 false**，
 * CodeMirror 的原行为照旧 —— 弹层开着时打字仍然照常过滤。
 * `HIDE_LOOKUP` = 取消这一轮、字符照插；`SELECT_ITEM_AND_FINISH_LOOKUP` = 接受当前项、吃掉这一键。
 */
const lookupCharFilter = Prec.highest(EditorView.inputHandler.of((view, _from, _to, text) => {
  if (!text || text.length !== 1) return false
  if (!completionRoundActive(view)) return false
  if (lookupCharFilters('').length === 0) return false
  const context = lookupContext(view, 'replaced')
  const decision = charFilterDecision(text, context.prefix.length, context)
  if (decision === 'HIDE_LOOKUP') { closeCompletion(view); return false }
  if (decision === 'SELECT_ITEM_AND_FINISH_LOOKUP') return acceptCompletion(view)
  return false
}))

/**
 * `com.intellij.lookup.actionProvider` 的**唯一消费点**：弹层里按 Alt+Enter 时收集上下文动作
 * （上游 `LookupActionProvider.fillActions`，`LookupActionProvider.java:36`）。
 * 有动作就吃掉这一键并跑**第一条** —— 上游是弹一个动作菜单，本仓的自绘弹层里没有二级菜单位，
 * 如实收成「第一条即执行」（登记在报告里）。没有贡献者/没有动作时返回 false，Alt+Enter 原行为照旧。
 */
export function handleLookupActionKey(event: KeyboardEvent, view: EditorView): boolean {
  if (event.key !== 'Enter' || !event.altKey || event.ctrlKey || event.metaKey) return false
  if (!completionRoundActive(view)) return false
  if (lookupActionProviders('').length === 0) return false
  const context = lookupContext(view, 'accepted')
  const actions = lookupActionsFor(context)
  if (!actions.length) return false
  event.preventDefault()
  try { actions[0]!.run(context) } catch { /* 坏动作不外泄到键位层。 */ }
  return true
}

/** 一轮补全结束时把用量交给宿主（缺省空操作：本仓没有远端统计通道，见 `recordLookupUsage`）。 */
let lookupUsageSink: (records: { key: string; data: [string, unknown][] }[], context: LookupActionContext) => void = () => {}

/** 宿主接走用量记录（`com.intellij.lookup.usageDetails` 的出口；返回取消订阅）。 */
export function setLookupUsageSink(
  sink: (records: { key: string; data: [string, unknown][] }[], context: LookupActionContext) => void,
): () => void {
  const previous = lookupUsageSink
  lookupUsageSink = sink
  return () => { lookupUsageSink = previous }
}

/**
 * 一轮补全结束时收集用量（上游 `LookupUsageTracker` 在 `completion.finished` 上收这一批，
 * `LookupUsageDescriptor.getExtensionKey` + `getAdditionalUsageData`）。
 * **没有描述符贡献者时一条都不构造** —— 零开销、行为不变。
 */
function recordLookupUsage(view: EditorView, outcome: 'accepted' | 'cancelled'): void {
  if (lookupUsageDescriptors().length === 0) return
  const context = lookupContext(view, outcome)
  try { lookupUsageSink(lookupUsageRecord(context), context) } catch { /* 坏接收器不外泄。 */ }
}

/** Ctrl+Space / Ctrl+Shift+Space / Ctrl+Alt+Space 三条都从这里落（判定表 `completionModes.ts:57-65`）。 */
export function handleCompletionModeKey(event: KeyboardEvent, view: EditorView): boolean {
  const mode = completionModeForEvent(event)
  return mode ? startCompletionAs(view, mode) : false
}

export const basicCompletionKeys = [
  // 这里是**唯一**的三条补全键位入口：以前只挂了 Ctrl+Space 一条，
  // 于是 Smart / 类名两档在模型里齐了、在界面上按不出来。
  Prec.highest(EditorView.domEventHandlers({ keydown: handleLookupActionKey })),
  Prec.highest(EditorView.domEventHandlers({ keydown: handleCompletionModeKey })),
  // EditorChooseLookupItemReplace is Tab ($default.xml:111-113). Without this,
  // CodeEditor's indentation consumes Tab even when a lookup is open.
  Prec.high(keymap.of([{ key: 'Tab', run: acceptCompletion }])),
  // `com.intellij.lookup.charFilter`：输入到来时先问一遍登记表（见上面那个 inputHandler）。
  lookupCharFilter,
]

// 循环词补全（上游 `HippieCompletionAction`：Alt+/ 向前、Alt+Shift+/ 向后，`$default.xml:735-739`）。
// 算法在 `src/cyclicWordCompletion.ts`；这里只做编辑器侧的按键与替换。状态按编辑器存放 ——
// 上游挂在 Editor 的 `KEY_STATE` 上，连续按从同一前缀往后循环，一轮走完恢复原前缀。
// 「其他打开文档」那一档的正文来自 `src/completionOpenEditors.ts`（上游 `getAllEditors()`，
// `HippieWordCompletionHandler.java:271-278`）；表是空的就没换档，退回只搜当前文档。
const hippieStates = new WeakMap<EditorView, HippieState>()
function runHippieCompletion(view: EditorView, direction: 1 | -1): boolean {
  if (view.state.readOnly) return false
  const ranges = view.state.selection.ranges
  if (ranges.some(range => !range.empty)) return false
  const text = view.state.sliceDoc()
  const step = hippieStep(text, view.state.selection.main.head, hippieStates.get(view) ?? null, direction, {
    carets: ranges.map(range => range.head),
    // 上游比的是 `document.getModificationStamp()`（`HippieWordCompletionHandler.java:74`、`:107`）。
    // CodeMirror 的 `EditorState.doc` 是**不可变**的 `Text`：任何一次文档编辑都换一个新对象，
    // 所以对象身份就是那份改动号（`EditorState` 上没有公开的 changeCount/seq 可用）。
    revision: view.state.doc,
    otherDocuments: otherOpenEditorTexts(text),
  })
  if (!step) return false
  view.dispatch({
    // 上游对每个 caret 各替换一次（`insertStringForEachCaret:115-122`），本仓一次 dispatch 做完。
    changes: step.spans.map(span => ({ from: span.from, to: span.to, insert: step.word })),
    selection: EditorSelection.create(
      step.spans.map(span => EditorSelection.cursor(span.from + step.word.length))),
    scrollIntoView: true,
    userEvent: 'input.complete',
  })
  if (step.state && !step.exhausted) {
    // 上游把 `lastModCount` 记在插入**之后**（`:107`），所以改动号要等 dispatch 落地再盖进状态。
    hippieStates.set(view, { ...step.state, revision: view.state.doc })
  } else hippieStates.delete(view)
  return true
}
/** 上游快捷键表那两条（`$default.xml:735-739`，按物理 SLASH 判，避开 Shift+/ 在部分布局是 `?`）。 */
export const hippieCompletionKeys = [
  Prec.highest(EditorView.domEventHandlers({
    keydown: (event, view) => {
      if (!event.altKey || event.code !== 'Slash' || event.ctrlKey || event.metaKey) return false
      if (!runHippieCompletion(view, event.shiftKey ? -1 : 1)) return false
      event.preventDefault()
      return true
    },
  })),
]

function presentationOf(completion: Completion) {
  return (completion as PresentedCompletion).presentation
    ?? completionPresentation({ kind: completion.type ?? 'text', detail: completion.detail })
}

// The runtime passes a 4th `match` argument (the matched ranges inside the label):
// @codemirror/autocomplete/dist/index.js `optionContent` calls
// `render(completion, _s, _v, match)` for every entry, including its own built-in
// label renderer. The bundled .d.ts declares only three parameters and simply omits
// it, so `match` is optional here — that keeps this assignable to the narrower
// declared type while still receiving the real argument at runtime.
type OptionRender = (
  completion: Completion,
  state: EditorState,
  view: EditorView,
  match?: readonly number[],
) => HTMLElement

export function renderCompletionRow(
  completion: Completion,
  _state: EditorState,
  view: EditorView,
  match: readonly number[] = [],
): HTMLElement {
  const doc = view.dom.ownerDocument
  const row = doc.createElement('span')
  row.className = 'tc-completion-row'
  const icon = row.appendChild(doc.createElement('span'))
  icon.className = 'tc-completion-icon'
  icon.setAttribute('aria-hidden', 'true')
  const name = row.appendChild(doc.createElement('span'))
  name.className = 'tc-completion-name'
  const label = completion.displayLabel ?? completion.label
  let end = 0
  for (let i = 0; i + 1 < match.length; i += 2) {
    const from = match[i]!, to = match[i + 1]!
    if (from < end || to > label.length || to <= from) continue
    name.appendChild(doc.createTextNode(label.slice(end, from)))
    const marked = name.appendChild(doc.createElement('span'))
    marked.className = 'cm-completionMatchedText'
    marked.textContent = label.slice(from, to)
    end = to
  }
  name.appendChild(doc.createTextNode(label.slice(end)))
  const tail = row.appendChild(doc.createElement('span'))
  tail.className = 'tc-completion-tail'
  const type = row.appendChild(doc.createElement('span'))
  type.className = 'tc-completion-type'
  const refresh = () => {
    const presentation = presentationOf(completion)
    row.classList.toggle('tc-completion-bold', presentation.bold)
    row.classList.toggle('tc-completion-deprecated', presentation.strikeout)
    tail.textContent = presentation.tail
    type.textContent = presentation.typeText ? ` ${presentation.typeText}` : ''
    const source = completionIcon(presentation.icon, view.state.facet(EditorView.darkTheme))
    icon.style.backgroundImage = source ? `url("${source}")` : 'none'
  }
  refresh()
  // Theme (dark/light) can change while the popup is open; the icon variant follows it.
  // This must NOT schedule another measure — that recursed through completionLayout.
  ;(completion as PresentedCompletion).refreshPresentation = refresh
  return row
}

// 颜色一律读 tokens.css 的 `--completion-*` / `--popup-*`（月相层，随 data-theme 换面）：
// 这里**不再写死十六进制**，也不再按 CM 的 light/dark 类各发一份 —— 那会让补全弹窗与
// 菜单浮层在换主题时各走各的。**注意那些值不是上游调色板的原样抄写**（上游 `LOOKUP_COLOR`
// 与 `CompletionPopup.foreground`/`matchForeground` 的逐条核对写在 tokens.css `--m-pop-bg` 旁）。
// 度量（行高、条数、inset、右留白）才是这个文件管的事，每一条后面注了上游的类与行号；
// 2026-10-05 复核过一遍，这些行号仍然准确。
export const completionThemeRules = {
  // 月相浮层规格：圆角 + 1px 描边 + 与菜单弹层同一档阴影（--popup-shadow）。
  // **不能写 overflow: hidden** —— CM 把右侧文档面板（.cm-completionInfo）绝对定位在
  // tooltip 之内、列表之外，一裁就没了。圆角靠行本身的外缩与圆角达成，不靠裁切。
  '.cm-tooltip.tc-completion': {
    backgroundColor: 'var(--completion-background)', color: 'var(--completion-foreground)',
    border: 'var(--popup-border)', borderRadius: 'var(--popup-radius)',
    boxShadow: 'var(--popup-shadow)',
    fontFamily: 'var(--font-mono)', lineHeight: 'normal',
    width: 'max-content', maxWidth: 'min(500px, 100vw)',
  },
  // UISettingsState.kt:197,199: max width 500, max 11 visible items.
  // LookupCellRenderer.kt:718 + UIUtil.java:3079-3081: MINIMUM row height
  // (`Math.max(size.height, UIManager.getInt("List.rowHeight"))`), not a fixed row height.
  // New UI `List.rowHeight` = 24 (expUI_light.theme.json:376 / expUI_dark.theme.json:378);
  // large editor fonts grow the row.
  '.cm-tooltip.tc-completion > ul': {
    fontFamily: 'inherit', minWidth: '0', maxWidth: '100%', height: 'auto',
    maxHeight: `calc(11 * max(var(--popup-row-h), 1lh + 4px) + 2 * var(--popup-pad))`,
    overflowX: 'hidden', overflowY: 'auto',
    padding: 'var(--popup-pad) 0',
  },
  // LookupCellRenderer: bodyInsets=4 (:209), selectionInnerInsets=2 (JBUI:1456),
  // name icon inset=6 (:958), icon/text gap=4 (:105), tail/type right inset=10 (:113,119).
  '.cm-tooltip.tc-completion > ul > li': {
    minHeight: 'var(--popup-row-h)', padding: '2px 6px', lineHeight: 'normal', cursor: 'default',
    margin: `0 var(--popup-selection-inset)`, borderRadius: 'var(--radius-sm)',
    position: 'relative', transition: `background-color var(--dur-1) var(--ease), color var(--dur-1) var(--ease)`,
  },
  // 选中行的左缘一道"月光"标记条：IDEA 的 lookup 用整条反色，我们这层加一道 2px 的定位标记，
  // 让"当前项"在只靠底色区分之外还有一条明确的边（长列表里扫一眼就能定位）。
  '.cm-tooltip.tc-completion > ul > li[aria-selected]::before': {
    content: '""', position: 'absolute', left: '0', top: '3px', bottom: '3px',
    width: 'var(--popup-mark-width)', borderRadius: 'var(--popup-mark-width)',
    backgroundColor: 'var(--popup-mark-color)',
  },
  '.cm-tooltip.tc-completion > ul > li[aria-selected]': {
    backgroundColor: 'var(--completion-selection)', color: 'var(--completion-foreground)',
  },
  '.cm-tooltip.tc-completion.cm-tooltip-autocomplete-disabled > ul > li[aria-selected]': {
    backgroundColor: 'var(--completion-inactive)',
  },
  '.cm-tooltip.tc-completion > ul > li[aria-selected]::after': { content: 'none' },
  // The custom renderer supplies all three text columns. CM's built-in label/detail
  // must not render a duplicate, and its generic glyph icons are disabled below.
  '.tc-completion > ul > li > .cm-completionLabel, .tc-completion > ul > li > .cm-completionDetail': { display: 'none' },
  '.tc-completion-row': { display: 'flex', alignItems: 'center', whiteSpace: 'pre', minWidth: '0' },
  '.tc-completion-icon': { flex: '0 0 16px', height: '16px', marginLeft: '6px', marginRight: '4px', backgroundSize: 'contain', backgroundRepeat: 'no-repeat' },
  '.tc-completion-no-icons .tc-completion-icon': { flexBasis: '0', marginLeft: '1px' },
  '.tc-completion-name': { flex: '0 1 auto', overflow: 'hidden', textOverflow: 'ellipsis' },
  '.tc-completion-tail': { flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: '10px', color: 'var(--completion-info)' },
  '.tc-completion-type': { flex: '0 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: '10px', color: 'var(--completion-info)' },
  '.tc-completion-bold .tc-completion-name': { fontWeight: 'bold' },
  '.tc-completion-deprecated .tc-completion-name, .tc-completion-deprecated .tc-completion-tail': { textDecoration: 'line-through' },
  // 命中的字符：上色 + 加粗，但不划线（划线留给"已弃用"，两种语义不能共用一种笔法）。
  '.tc-completion .cm-completionMatchedText': { color: 'var(--completion-match)', fontWeight: '600', textDecoration: 'none' },
  // 右侧文档面板（`completionItem/resolve` 回来的内容）= 同一套浮层规格，
  // 而不是 CM 默认的"贴一张白底方块"。
  '.tc-completion .cm-completionInfo': {
    maxHeight: '100vh', overflow: 'auto', color: 'var(--text)',
    backgroundColor: 'var(--elevated)', border: 'var(--popup-border)',
    borderRadius: 'var(--popup-radius)', boxShadow: 'var(--shadow-2)',
    padding: '6px 8px', lineHeight: '1.55',
  },
  '.tc-completion .cm-completionInfo.cm-completionInfo-left': { marginRight: '4px' },
  '.tc-completion .cm-completionInfo.cm-completionInfo-right': { marginLeft: '4px' },
  '.tc-completion .completion-info': { font: 'inherit', maxWidth: '100%', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
}

const completionLayout = ViewPlugin.fromClass(class {
  // 显式字段，不写参数属性（`constructor(readonly view: …)` 是类型扩展语法，Node 22 直跑
  // `.ts` 的 strip-only 擦除不支持它，会让 import 到本文件的用例**整个文件**加载失败）。
  private readonly view: EditorView
  /** 上一拍弹层开着吗 —— 「这一轮结束了」那一拍要拿它判（见 `update`）。 */
  private wasOpen: boolean
  constructor(view: EditorView) { this.view = view; this.wasOpen = completionRoundActive(view); this.schedule() }
  update(update: ViewUpdate) {
    // `com.intellij.lookup.usageDetails`：弹层从「开着」落到「关了」的那一拍收一次用量
    // （上游 `LookupUsageTracker` 在 `completion.finished` 上收）。接受的判据是事务上的
    // `pickedCompletion` 标注（CM 只在真正插入了某个候选时打它）。
    const open = completionRoundActive(update.view) || reopeningViews.has(update.view)
    if (this.wasOpen && !open) {
      const accepted = update.transactions.some(transaction => transaction.annotation(pickedCompletion) != null)
      recordLookupUsage(update.view, accepted ? 'accepted' : 'cancelled')
    }
    this.wasOpen = open
    // 弹层一关就把这一轮的模式与调用次数作废（上游那份状态随 `CompletionPhase` 一起结束，
    // `CodeCompletionHandlerBase.java:210-213`）；打字收层、Esc、接受条目、切焦点都走到这里。
    endCompletionIfRoundOver(this.view)
    this.schedule()
  }
  schedule() { this.view.requestMeasure(this.measure) }
  measure = {
    read: () => {
      const tooltip = this.view.state.facet(showTooltip).map(t => t && getTooltip(this.view, t))
        .find(t => t?.dom.classList.contains('tc-completion'))
      const name = tooltip?.dom.querySelector<HTMLElement>('.tc-completion-name')
      if (!tooltip || !name) return null
      return { tooltip, indent: name.getBoundingClientRect().left - tooltip.dom.getBoundingClientRect().left }
    },
    write: (value: { tooltip: TooltipView; indent: number } | null) => {
      if (!value) return
      // LookupUi.java:345-356 aligns item text, not the icon, to lookupStart.
      // Let CM keep ownership of screen clipping and the above/below decision.
      if (value.tooltip.offset?.x !== -value.indent) {
        value.tooltip.offset = { x: -value.indent, y: 0 }
        repositionTooltips(this.view)
      }
    },
  }
})

export function completionUi(sources: CompletionSource[]) {
  return [
    ...basicCompletionKeys,
    // Alt+/ 的循环词补全（与补全弹层无关：不弹层，直接就地替换前缀）。
    ...hippieCompletionKeys,
    // The CM tooltip container carries view.themeClasses and tracks theme changes.
    // Body hosting removes editor overflow/transform containing-block constraints.
    tooltips({ parent: document.body }),
    autocompletion({ override: sources, icons: false,
      tooltipClass: state => `tc-completion${currentCompletions(state).some(item => presentationOf(item).icon) ? '' : ' tc-completion-no-icons'}`,
      addToOptions: [{ render: renderCompletionRow as OptionRender, position: 10 }],
    }),
    EditorView.baseTheme(completionThemeRules),
    completionLayout,
  ]
}
