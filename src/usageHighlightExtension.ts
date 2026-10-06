// 「高亮用法」的 CodeMirror 层（上游 `HighlightUsagesAction` / `HighlightManagerImpl` /
// `BackgroundHighlighter` 的临时高亮 + `EscapeHandler.java:41` 的 Esc 清除）。
//
// 纯规则在 src/usageHighlight.ts；这里只做四件事：
//   ① 一个 StateField 存当前高亮的词与出现区间（带读/写分类），并把它提供成装饰；
//   ② 命令 `highlightUsagesCommand`：光标在词上 → 高亮全部出现；再执行一次 / Esc → 清除；
//   ③ **编辑后不在同一拍收起** —— 改成上游 `BackgroundHighlighter` 的后台重算：
//      `alarm.cancelAllRequests()`（:139/:160/:230）对应"取消上一次还没跑的重算"，
//      `isEditorUpToDate`（:322-337：光标没动 + 文档 stamp 没变 + 还是我这个 job）
//      对应"结果陈旧就丢掉"，`identPass.doAdditionalCodeBlockHighlighting`（:303）
//      对应"顺带把块内的那一份也画上"；
//   ④ 注册进编辑器：CodeEditor.vue 贴着机检上限，扩展只能从它**已经调用**的入口挂进去，
//      所以 `src/editorSearchExtension.ts` 把本扩展与查找高亮层一并返回（同属光标驱动的
//      高亮层，见那边的说明）；
//   ⑤ 高亮开/关时的**状态栏提示**（`HighlightUsagesHandler.setStatusText`，:393-409 的三档，
//      最后一行 `getStatusBar(project).setInfo(message)`）—— 通道是 `src/statusBarText.ts`，
//      文字规则在 `src/usageHighlight.ts` 的 `highlightUsagesStatusText`。
//
// 两条**故意没有接线**的东西（写了就得有人解释，免得下批又当"缺项"重做）：
//   · `highlightUsagesInCodeBlockCommand`：上游 `CodeBlockSupportHandler` 的 `getCodeBlockRange`
//     服务的是结构标记高亮（`IdentifierHighlightingComputer.kt:152`）、缩进参考线
//     （`IndentGuideCalculator.java:93`）、`MatchBraceAction.java:60` 与智能选区
//     （`CodeBlockUtil.java:110/:178`）—— **没有**一条"只在当前代码块内高亮用法"的用户动作，
//     注册它等于造一条 IDEA 没有的菜单行（规矩：不放假控件）。块范围规则本身留在
//     `src/usageHighlight.ts` 的 `codeBlockRange`，谁要接结构标记就接它。
//   · `src/usageHighlight.ts` 的 `CHOOSE_ALL_ENTRY`：上游 `ChooseOneOrAllRunnable.run()`（:38-40）
//     在**只有一个元素**时直接选中、不进弹层；本仓的目标恒是光标处那一个标识符，弹层永远不会出现，
//     所以这一档只有规则、没有消费点（多条候选要 PSI 的 `PsiElement` 列表才有）。
import { StateEffect, StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, keymap, type Command, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { commentStyleFromState } from './commentToggle.ts'
// 状态栏中段文字通道（IDEA 的 `StatusBar.Info.set`），高亮用法的三档提示就走它。
import { setStatusText } from './statusBarText.ts'
import {
  classifyUsage, codeBlockRange, commentRanges, highlightTargetAt, highlightUsagesStatusText, isHighlightableWord,
  stringRanges, usageKinds, type TypedUsageOccurrence, type UsageKind,
} from './usageHighlight.ts'

export interface UsageHighlight {
  word: string
  occurrences: TypedUsageOccurrence[]
  /** 只看当前代码块（`CodeBlockSupportHandler` / `AbstractCodeBlockSupportHandler.getCodeBlockRange`）。 */
  codeBlockOnly: boolean
}

export const setUsageHighlight = StateEffect.define<UsageHighlight | null>()

/** 注释 + 字符串的字面量区间：出现在这里的同名词不是引用（`ReferencesSearch` 的等价物）。 */
function nonCodeRanges(text: string, style: ReturnType<typeof commentStyleFromState>): { from: number; to: number }[] {
  return [...commentRanges(text, style), ...stringRanges(text)]
}

/**
 * 光标处元素在文件里的用法。`codeBlockOnly` 走 `AbstractCodeBlockSupportHandler.getCodeBlockRange`
 * 的最内层花括号块；没有块（顶层）时返回 null，调用方据此不做块内收窄。
 */
function usagesOf(state: EditorState, from: number, to: number, codeBlockOnly: boolean): UsageHighlight | null {
  const text = state.doc.toString()
  const target = highlightTargetAt(text, from, to)
  if (!target || !isHighlightableWord(target.word)) return null
  const block = codeBlockOnly ? codeBlockRange(text, from) : null
  if (codeBlockOnly && !block) return null
  const occurrences = usageKinds(text, target.word, {
    skip: nonCodeRanges(text, commentStyleFromState(state, target.from)),
    within: block ?? undefined,
    caret: from,
    classify: classifyUsage,
  })
  return occurrences.length ? { word: target.word, occurrences, codeBlockOnly } : null
}

export const usageHighlightField = StateField.define<UsageHighlight | null>({
  create: () => null,
  update(value, tr) {
    let next = value
    for (const effect of tr.effects) if (effect.is(setUsageHighlight)) next = effect.value
    return next
  },
  provide: field => EditorView.decorations.from(field, value => decorationsOf(value)),
})

const usageMark = Decoration.mark({ class: 'cm-usageHighlight' })
const currentMark = Decoration.mark({ class: 'cm-usageHighlight cm-usageHighlight-current' })
/**
 * 写用法（`HighlightUsagesHandlerBase.java:53-56`：读画 `SEARCH_RESULT_ATTRIBUTES`、
 * 写画 `WRITE_SEARCH_RESULT_ATTRIBUTES`，两套属性不同，所以本仓也分两个 class）。
 * 配色是本仓的：读沿用上一批已定的 `--symbol-highlight` 那一档，写换 `--warning-bg` 那一族。
 */
const writeMark = Decoration.mark({ class: 'cm-usageHighlight cm-usageHighlight-write' })
const writeCurrentMark = Decoration.mark({ class: 'cm-usageHighlight cm-usageHighlight-write cm-usageHighlight-current' })

function markFor(occurrence: TypedUsageOccurrence): Range<Decoration> {
  const write = occurrence.kind === 'write' || occurrence.kind === 'writeDeclaration'
  const mark = write ? (occurrence.current ? writeCurrentMark : writeMark) : (occurrence.current ? currentMark : usageMark)
  return mark.range(occurrence.from, occurrence.to)
}

function decorationsOf(value: UsageHighlight | null): DecorationSet {
  if (!value || !value.occurrences.length) return Decoration.none
  return Decoration.set(value.occurrences.map(markFor))
}

/** 计算光标处元素在文件里的用法（注释与字符串里的出现不算；规则见 src/usageHighlight.ts）。 */
export function usagesAt(state: EditorState, from: number, to: number, codeBlockOnly = false): UsageHighlight | null {
  return usagesOf(state, from, to, codeBlockOnly)
}

// ---------------------------------------------------------------- 后台重算（BackgroundHighlighter）

/**
 * 一次编辑后多久重算标识符高亮。上游没把这个数写成常量（`Alarm.addRequest` 的实参散在
 * `BraceHighlightingHandler` 那一带），本仓取与查找高亮（`editorSymbolHighlight.ts` 的 160ms）
 * 同量级 —— **这是本仓的值，不是上游的**，改它只改这里一处。
 */
export const BACKGROUND_RECOMPUTE_MS = 160

/** 读/写两桶的条数（`UsageRanges.kt:8-13` 四个集合的计数视图，供状态栏/提示用）。 */
export function countByKind(occurrences: readonly TypedUsageOccurrence[]): Record<UsageKind, number> {
  const counts: Record<UsageKind, number> = { read: 0, write: 0, readDeclaration: 0, writeDeclaration: 0 }
  for (const occurrence of occurrences) ++counts[occurrence.kind]
  return counts
}

/**
 * 这一次重算的结果**还能不能画**（`BackgroundHighlighter.isEditorUpToDate`，:322-337）。
 * 能搬过来的是前两项：`scheduled` 是**排这一下时**（也就是那次编辑刚落地时）的光标与内容
 * 签名，`now` 是重算真正开跑时的同两项 —— 静默窗口里又改了内容、或光标又动了，就整份丢掉。
 * 第三项"还是我这个 job"就是代数比较（上游 :336 的 `BACKGROUND_TASK_KEY == job`）。
 *
 * 纯函数，判据在测试里直接跑；定时器那一层留给 `usageBackgroundRecompute`。
 */
export function backgroundResultIsFresh(
  scheduled: { caret: number; stamp: number },
  now: { caret: number; stamp: number },
  latestJob: number,
  myJob: number,
): boolean {
  return latestJob === myJob && scheduled.caret === now.caret && scheduled.stamp === now.stamp
}

/** 文档内容签名（复用 LSP 高亮缓存那一支的同一个口径：FNV-1a + 长度）。 */
function docStamp(state: EditorState): number {
  const text = state.doc.toString()
  let hash = 2166136261
  for (let index = 0; index < text.length; ++index) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (Math.imul(hash >>> 0, 31) ^ text.length) >>> 0
}

/**
 * 编辑后后台重算的调度器（`BackgroundHighlighter.registerListeners` 里那几个
 * `alarm.cancelAllRequests()` + `updateHighlighted` 的等价物）。
 *
 * 触发条件只有"当前有高亮 + 文档变了"；排下这一下时记下光标与内容签名，回来逐项对
 * （`backgroundResultIsFresh`）—— 对不上就整份丢掉，不画错位置。
 */
export function usageBackgroundRecompute(): Extension {
  return ViewPlugin.fromClass(class {
    private timer: ReturnType<typeof setTimeout> | undefined
    private job = 0

    update(update: ViewUpdate) {
      const highlight = update.state.field(usageHighlightField, false)
      if (!highlight) { this.cancel(); return }
      if (!update.docChanged) return
      // 有高亮、内容变了：取消上一次还没跑的重算（上游 :160 `alarm.cancelAllRequests()`）再排一个。
      // 代数 +1 就是上游 :309-318 那个 `getAndUpdateUserData(BACKGROUND_TASK_KEY)` 的取代关系 ——
      // 旧 job 的结果回来时代数对不上，整份丢弃。
      this.cancel()
      const myJob = ++this.job
      const scheduled = { caret: update.state.selection.main.head, stamp: docStamp(update.state) }
      const codeBlockOnly = highlight.codeBlockOnly
      this.timer = setTimeout(() => {
        this.timer = undefined
        const state = update.view.state
        const now = { caret: state.selection.main.head, stamp: docStamp(state) }
        if (!backgroundResultIsFresh(scheduled, now, this.job, myJob)) return
        const caret = state.selection.main
        const next = usagesOf(state, caret.from, caret.to, codeBlockOnly)
        if (!next) return
        update.view.dispatch({ effects: setUsageHighlight.of(next) })
      }, BACKGROUND_RECOMPUTE_MS)
    }

    private cancel(): void {
      if (this.timer !== undefined) clearTimeout(this.timer)
      this.timer = undefined
    }

    destroy(): void { this.cancel() }
  })
}

// ---------------------------------------------------------------- 命令与键位

/**
 * 上游 `HighlightUsagesHandler.getShortcutText()`（:415-423）读的是
 * `ACTION_HIGHLIGHT_USAGES_IN_FILE` 的第一条快捷键（没绑就回 `<no key assigned>`）。
 * 本仓的键位表是保留文件（`src/keymapBindings.ts` 归主代理），这里给的是与下面
 * `Ctrl-Shift-F7` 那条绑定同一个动作的呈现文本。
 */
export const USAGE_HIGHLIGHT_SHORTCUT_TEXT = 'Ctrl+Shift+F7'

/** 状态栏的说话人（`StatusBar.Info.set(text, project, requestor)` 的第三参，`HighlightUsagesHandler.java:408`）。 */
export const USAGE_HIGHLIGHT_REQUESTOR = 'highlightUsages'

/**
 * `HighlightUsagesHandler.setStatusText`（:393-409）的三档，一次调用落完：
 *   · 清除高亮 → 空文字（`:395-397` 的 `message = ""`，通道只允许当前说话人擦自己）；
 *   · 找到 n 条 → 「n 处用法…」（`:398-402`，带快捷键提示）；
 *   · 一条都没有 → 「没有找到用法」（`:403-407`）。
 * 三档最后都写状态栏（`:408`）。文字本身在 `src/usageHighlight.ts`（`CodeInsightBundle.properties:64-67` 的直译）。
 */
export function reportUsageHighlightStatus(count: number, elementName: string | null, clearing = false): void {
  setStatusText(clearing ? '' : highlightUsagesStatusText(count, elementName, USAGE_HIGHLIGHT_SHORTCUT_TEXT), USAGE_HIGHLIGHT_REQUESTOR)
}

/**
 * 两条命令共用的那一半（上游 `HighlightUsagesHandler.java:189` 把 `refCount` 与
 * `myClearHighlights` 一起交给 `setStatusText`，所以"关掉"与"0 条"都要说话）。
 * 返回 false = 光标处根本没有可高亮的元素（不吞键，菜单据此提示）。
 */
function toggleUsageHighlight(view: EditorView, codeBlockOnly: boolean): boolean {
  const current = view.state.field(usageHighlightField, false)
  if (current) {
    view.dispatch({ effects: setUsageHighlight.of(null) })
    reportUsageHighlightStatus(0, current.word, true)
    return true
  }
  const range = view.state.selection.main
  const target = highlightTargetAt(view.state.doc.toString(), range.from, range.to)
  if (!target || !isHighlightableWord(target.word)) return false
  const highlight = usagesOf(view.state, range.from, range.to, codeBlockOnly)
  if (highlight) view.dispatch({ effects: setUsageHighlight.of(highlight) })
  reportUsageHighlightStatus(highlight?.occurrences.length ?? 0, target.word)
  return Boolean(highlight)
}

/**
 * 高亮光标处的用法；已有高亮时（无论在不在同一个词上）先清除 —— 与上游动作的
 * 开关语义一致，按键不悬空。光标处没有元素时返回 false（菜单据此提示）。
 */
export const highlightUsagesCommand: Command = view => toggleUsageHighlight(view, false)

/**
 * 块内版：只看光标所在最内层花括号块（规则在 `src/usageHighlight.ts` 的 `codeBlockRange`）。
 * **没有注册进菜单/键位**：上游没有这条用户动作，理由见文件头。
 */
export const highlightUsagesInCodeBlockCommand: Command = view => toggleUsageHighlight(view, true)

/** Esc 收起（`EscapeHandler` 清临时高亮的等价物）：没有高亮时返回 false，把键让给别人。 */
const clearOnEscape: Command = view => {
  if (!view.state.field(usageHighlightField, false)) return false
  view.dispatch({ effects: setUsageHighlight.of(null) })
  return true
}

export function usageHighlightExtension(): Extension {
  return [
    usageHighlightField,
    usageBackgroundRecompute(),
    // 写用法那一档的配色随本扩展走（`src/editorTheme.ts` 只负责查找高亮与读用法），
    // 用的全是 `src/tokens.css` 里的既有令牌，没有裸色值。
    EditorView.theme({
      '.cm-usageHighlight-write': { backgroundColor: 'var(--warning-bg)' },
    }),
    keymap.of([
      { key: 'Escape', run: clearOnEscape },
      // HighlightUsagesInFile = Ctrl+Shift+F7（`$default.xml:362-364`）。键位与扩展同处：本仓的
      // 编辑器键位表在 CodeEditor.vue 里，只能从这个入口挂（菜单行展示的是同一个键）。
      { key: 'Ctrl-Shift-F7', preventDefault: true, run: highlightUsagesCommand },
    ]),
  ]
}
