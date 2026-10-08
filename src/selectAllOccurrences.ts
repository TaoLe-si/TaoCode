// 一次选中全部出现（IDEA `SelectAllOccurrencesAction`，键位 `Ctrl+Alt+Shift+J`）的**纯逻辑**。
//
// 本模块只做「给文本 + 选区 + 光标，算出应该选中哪些区间，或者不做事」，
// 零 Vue、零 DOM、零 CodeMirror —— 接线（`view.dispatch` 出多选区）由宿主负责。
//
// 上游坐标（判定基准只有上游源码树）：
//   · 驱动 —— `platform/lang-impl/src/com/intellij/openapi/editor/actions/SelectAllOccurrencesAction.java:40-84`
//     （`doExecute`：无选区先取词、组 `FindModel`、从 0 开始迭代 `findString`、
//     每个结果作为一条 caret/selection 交给 `FindUtil.selectSearchResultsInEditor`）。
//   · 三档语义的共同落点 —— `platform/lang-impl/src/com/intellij/openapi/editor/actions/SelectOccurrencesActionHandler.java`
//     （取词 `:64-68`、`getFindModel` `:79-85`）。
//   · 取词 —— `platform/lang-impl/src/com/intellij/codeInsight/editorActions/SelectWordUtil.java:109-142`
//     （`getWordSelectionRange` → `getWordOrLexemeSelectionRange(null, …)`，`editor == null`
//      ⇒ 只按 `JAVA_IDENTIFIER_PART_CONDITION`（`:31`）扩张，不做词素/驼峰切分）。
//   · 整词判定 —— `platform/lang-impl/src/com/intellij/find/impl/FindManagerBase.java:247-276`
//     （`isWholeWord`），消费点在 `:111` 的 `findStringLoop`。
//   · 上限保护 —— `platform/lang-impl/src/com/intellij/find/FindUtil.java:1051-1053`
//     （`caretStates.size() > getMaxCaretCount()` ⇒ **只提示、不改选区**）。
//   · 上限常量 —— `platform/util/resources/misc/registry.properties:484`
//     （`editor.max.caret.count=1000`），读取点 `CaretModelImpl.java:55` 与 `:120-121`
//     （`Math.max(1, MAX_CARET_COUNT.asInteger())`）。
//
// 复用（不重复造）：
//   · 取词用 `src/editorExtendSelection.ts` 的 `wordRange`（同一条上游取词链的既有落点，
//     见该文件 `:162-171`）—— 与上游 `editor == null` 那条路径逐条等价。
//   · 整词判定用 `src/editorSearch.ts` 的 `isWholeWordMatch`（`FindManagerBase.isWholeWord`
//     的既有逐行移植，`:70-92`）。
import type { ExtendRange } from './editorExtendSelection.ts'
import { wordRange } from './editorExtendSelection.ts'
import { isWholeWordMatch } from './editorSearch.ts'

/** 一个命中区间（半开，字符偏移）。 */
export type OccurrenceRange = ExtendRange

/**
 * `CaretModel.getMaxCaretCount()` 的缺省值 —— 上游 registry `editor.max.caret.count`
 * （`platform/util/resources/misc/registry.properties:484`），经
 * `CaretModelImpl.java:120-121` 的 `Math.max(1, …)` 出来。**不是本仓发明的数**。
 */
export const MAX_CARET_COUNT = 1000

export interface OccurrenceSelectionInput {
  /** 文档全文。 */
  text: string
  /** 选区起点，`Caret.getSelectionStart()`（无选区时等于光标）。 */
  selectionFrom: number
  /** 选区终点，`Caret.getSelectionEnd()`。 */
  selectionTo: number
  /** 光标偏移，`Caret.getOffset()`（CodeMirror 侧 = `EditorSelection.main.head`）。 */
  cursor: number
  /**
   * `CaretModel.getMaxCaretCount()` 的等价物，默认 `MAX_CARET_COUNT`。
   * 可注入只为单测能压到小上限验边界；生产不要传。
   */
  maxCarets?: number
}

/**
 * 结果：`selected` = 把 `ranges` 全部变成多选区、`carets` 是对应光标偏移；
 * `noop` = **整条不做事**（上游三种出口：取不到词、没命中、命中数超上限）。
 */
export type OccurrenceSelectionResult =
  | {
    kind: 'selected'
    /** 实际拿去搜的文本（无选区时是光标下的词）。 */
    query: string
    /** `FindModel.isWholeWordsOnly` 的取值（无选区取词时上游置 true）。 */
    wholeWords: boolean
    ranges: OccurrenceRange[]
    carets: number[]
  }
  | { kind: 'noop'; reason: 'no-query' | 'no-matches' | 'too-many-matches'; matchCount: number }

/**
 * 字面量扫描的等价物：`FindModel.isRegularExpressions` 缺省 false
 * （`platform/indexing-api/src/com/intellij/find/FindModel.kt:185`）⇒ 走
 * `StringSearcher`（`FindManagerBase.java:158,241-243`）的**逐字符字面量**比较，
 * 大小写敏感（`StringSearcher.java:46` 的 `myCaseSensitive` 分支不折叠大小写）。
 *
 * 迭代方式照抄 `SelectAllOccurrencesAction.java:63-76` 的匿名迭代器：
 * 起点 0，**下一条从上一命中结果的 `endOffset` 起**（`:74`）⇒ 命中互不重叠。
 * 整词被拒时 `findStringLoop`（`FindManagerBase.java:116`）把 offset 推 `start + 1` 重试，
 * 所以被拒的那条**允许与后续命中重叠**。
 *
 * `wholeWords` 为真时用 `isWholeWordMatch`（= `FindManagerBase.isWholeWord`）逐条过滤。
 */
export function literalOccurrences(text: string, query: string, wholeWords: boolean): OccurrenceRange[] {
  const out: OccurrenceRange[] = []
  const length = query.length
  if (length === 0) return out
  let from = 0
  while (from <= text.length - length) {
    const at = text.indexOf(query, from)
    if (at < 0) break
    if (!wholeWords || isWholeWordMatch(text, at, at + length)) {
      out.push({ from: at, to: at + length })
      from = at + length
    } else {
      // `FindManagerBase.java:116`：`offset = result.getStartOffset() + 1`。
      from = at + 1
    }
  }
  return out
}

/**
 * 光标处的词（上游 `SelectWordUtil.getWordSelectionRange`，
 * `SelectWordUtil.java:109-112` → `:114-142` 的 `editor == null` 分支）。
 *
 * 与 `wordRange`（`src/editorExtendSelection.ts:162-171`）的关系：**同一套规则**。
 * `:118-122` 的「光标在词尾右侧时先把 cursor 左移一格」在本仓是**冗余的** ——
 * `wordRange` 两头各自扩张，`head` 落在词尾右侧或文档末尾时结果与上游逐字符相同
 * （已由本模块测试覆盖）。唯一的**已知差异**是字符类：
 * `wordRange` 用 `/[\p{L}\p{N}_$]/u`（`editorExtendSelection.ts:154-156`），
 * 上游是 `Character.isJavaIdentifierPart`（`SelectWordUtil.java:31`）—— 后者还认
 * 货币符号 `Sc`（`£`/`€`）、连接标点 `Pc`（`_` 之外）、组合记号 `Mn`/`Mc`、
 * 以及标识符可忽略控制字符。ASCII 标识符、数字、`_`、`$`、CJK 两边一致。
 * 不重复造第二份字符类：复用 `wordRange`，差异如实登记在本注释里。
 */
export function occurrenceWordAt(text: string, cursor: number): OccurrenceRange | null {
  return wordRange(text, cursor)
}

/**
 * 上游 `SelectAllOccurrencesAction.Handler.doExecute`（`:40-84`）的文本等价物。
 * 三档语义逐条：
 *
 * 1. **无选区先取词 + 整词**（`:43-50`）—— `!caret.hasSelection()` 时先取光标下的词
 *    （`:45` `getSelectionRange`，即 `SelectOccurrencesActionHandler.java:64-68` →
 *    `SelectWordUtil` 的 `JAVA_IDENTIFIER_PART_CONDITION` 那条），取到就
 *    `setSelection` 并 `wholeWordsSearch = true`（`:47-48`）；取不到词 ⇒
 *    `getSelectedText()` 为 null ⇒ `:54-56` 直接 return（本模块 `noop`/`no-query`）。
 * 2. **大小写敏感恒真**（`SelectOccurrencesActionHandler.java:79-85` 的 `getFindModel`：
 *    `model.setCaseSensitive(true)` 是**硬编码**，`:80-84` 全程没有任何开关/配置入口；
 *    `SelectAllOccurrencesAction` 也不碰它）⇒ 本模块的字面量比较恒定大小写敏感，
 *    **不暴露可配项**。
 * 3. **上限保护是「整条不做」不是截断**（`FindUtil.java:1051-1053`）——
 *    `selectSearchResultsInEditor` 先把**全部**结果收进 `caretStates`（`:1038-1050` 的 while
 *    跑到底），然后 `if (caretStates.size() > getMaxCaretCount())` 只
 *    `EditorUtil.notifyMaxCarets(editor)`（`:1052`）**不动选区**；只有 `<=` 时才
 *    `setCaretsAndSelections`（`:1055`）。判据是**严格大于** ⇒ 恰好 1000 条要选，
 *    1001 条整条不做事。
 *
 * 光标位置照抄 `FindUtil.java:1040` 的 `getCaretPosition`（`:1100-1103`）：
 * `shift < 0 ? matchEnd : min(matchStart + shift, matchEnd)`，其中
 * `shift = caret.getOffset() - caret.getSelectionStart()`（`SelectAllOccurrencesAction.java:58`）。
 */
export function selectAllOccurrences(input: OccurrenceSelectionInput): OccurrenceSelectionResult {
  const text = input.text
  const hasSelection = input.selectionTo > input.selectionFrom
  let query: string
  let wholeWords: boolean
  let selectionFrom: number
  if (hasSelection) {
    // 有选区：直接用选中的文本，整词档保持关（`:43` 的 `wholeWordsSearch` 初值 false）。
    selectionFrom = input.selectionFrom
    query = text.slice(input.selectionFrom, input.selectionTo)
    wholeWords = false
  } else {
    // 无选区：先取词（`:44-50`）。取不到 ⇒ 上游 `getSelectedText()` 为 null ⇒ return。
    const word = occurrenceWordAt(text, input.cursor)
    if (!word) return { kind: 'noop', reason: 'no-query', matchCount: 0 }
    selectionFrom = word.from
    query = text.slice(word.from, word.to)
    wholeWords = true
  }
  if (query.length === 0) return { kind: 'noop', reason: 'no-query', matchCount: 0 }

  const maxCarets = Math.max(1, input.maxCarets ?? MAX_CARET_COUNT)
  const matches = literalOccurrences(text, query, wholeWords)
  if (matches.length === 0) return { kind: 'noop', reason: 'no-matches', matchCount: 0 }
  // 上游先收全部结果再判 `size() > max`（`FindUtil.java:1051`）：**整条不做**，不截断。
  if (matches.length > maxCarets) {
    return { kind: 'noop', reason: 'too-many-matches', matchCount: matches.length }
  }

  const shift = input.cursor - selectionFrom
  const ranges: OccurrenceRange[] = []
  const carets: number[] = []
  for (const match of matches) {
    ranges.push(match)
    carets.push(shift < 0 ? match.to : Math.min(match.from + shift, match.to))
  }
  return { kind: 'selected', query, wholeWords, ranges, carets }
}