// 补全候选的**排序与分组**（上游 IDEA 的排序器链 + 前缀匹配）—— 纯函数，零 Vue、零 DOM。
//
// 上游结构（读源码的结论）：`CompletionLookupArranger.arrange`（`platform/analysis-impl/src/com/intellij/
// codeInsight/completion/CompletionLookupArranger.java:16,25`）收一个 `CompletionSorter`，而它是
// **可扩展的档位链** —— `.../impl/CompletionSorterImpl.java:18` 的 `weighingFactory:28` 把
// `LookupElementWeigher` 折成 `ClassifierFactory`，`weighBefore:44`/`weighAfter:55` 往链里插档。
// 「打出来的那段算不算命中」由前缀匹配决定：IDEA 的 `PrefixWeigher` 把"以输入前缀开头"的
// 候选排到前面，驼峰形状交给 `com.intellij.util.text.CamelHumpMatcher`。
// 本仓按默认链比较，先比出来的档位说了算：
//   ① **预选**：LSP `preselect` 的候选必须排最前（协议里它就是"默认选中的那条"）；
//   ② **LSP 相关性**（`LspCompletionWeigher`，`platform/lsp-impl/src/impl/features/completion/
//      LspCompletionWeigher.kt:30-36`，注册在 `platform/lsp-impl/resources/intellij.platform.lsp.impl.xml:86-89`
//      的 `<weigher key="completion" order="after priority, before prefix">`）：
//      **有** `sortText` 的候选按 `ReverseComparableString`（`:38-41`，`compareTo` 取反）
//      即**降序**比；**没有** `sortText` 的这一档不参与（weigher 返回 null），
//      落进 `ComparingClassifier.classify`（`platform/analysis-impl/src/com/intellij/codeInsight/lookup/
//      ComparingClassifier.java:31-52`）的 `nulls` 桶 —— 那一桶**排在所有有 sortText 的之后**；
//   ③ **匹配形状**（`CompletionMatchKind`）：同样相关性下，"打出来的前缀正好接上"的候选排在
//      只是包含关键字的前面 —— 精确大小写前缀 > 忽略大小写前缀 > 连续子串 > 驼峰命中 > 不命中。
//      上游 `PrefixWeigher` 就是这一档；没有 `typedPrefix`（无上下文）时整档跳过；
//   ④ **大小写不敏感**：忽略大小写的字典序（让 `foo` 与 `Foo` 相邻，而不是被 ASCII 码拆开）；
//   ⑤ **长度**：短者先（IDEA 的 LengthWeigher）；
//   ⑥ **字母序**：区分大小写的最终比较，保证稳定。
// CodeMirror 只负责画：顺序在这里定，之后不再交给它的 `sortText` 排序。

/**
 * 本地贡献者条目的排序前缀。② 这一档按**降序**比（见上），所以要"排在服务端候选之后"
 * 就得用一个比所有可打印字符都小的前缀：`!`（0x21）。
 * 组号 `0`=文档词、`1`=命令条目；同组内靠后面的载荷排（出现次数 / 优先级）。
 */
export const LOCAL_SORT_PREFIX = '!'

/** 本地条目的排序键。`group` 决定它在本组里的先后（见 `LOCAL_SORT_PREFIX`）。 */
export function localSortKey(group: 0 | 1, payload: string): string {
  return `${LOCAL_SORT_PREFIX}${group}${payload}`
}

export interface SortableCompletion {
  /** 可见名（服务端给的 `label`）。 */
  label: string
  /**
   * LSP `sortText`：服务器给的排序键。**缺省（undefined）= ② 这一档不参与**
   * （`LspCompletionWeigher.kt:32-33` 对没有 sortText 的项返回 null）。
   */
  sortText?: string
  /** LSP `preselect`：这一条要默认选中。 */
  preselected?: boolean
  /**
   * 光标前**已经打出来的那段**（触发补全的词元，如 `getN`）——「匹配形状」这一档的输入。
   * 同一次结果里每条都一样；缺省（undefined）时整档跳过，排序退回四档链。
   */
  typedPrefix?: string
}

/** 候选名和已输入前缀的关系，由好到坏。 */
export type CompletionMatchKind = 'exact' | 'ignoreCase' | 'substring' | 'camel' | 'none'

const MATCH_RANK: Record<CompletionMatchKind, number> = { exact: 0, ignoreCase: 1, substring: 2, camel: 3, none: 4 }

/** 词的边界（驼峰检查用）：串首、分隔符（`_ $ . -`）之后、小写/数字 → 大写处。 */
function isHumpStart(label: string, index: number): boolean {
  if (index === 0) return true
  if (index >= label.length) return false
  const previous = label.charCodeAt(index - 1)
  const current = label.charCodeAt(index)
  const previousLowerOrDigit = (previous >= 97 && previous <= 122) || (previous >= 48 && previous <= 57)
  return (previousLowerOrDigit && current >= 65 && current <= 90)      // aB
    || previous === 95 || previous === 36 || previous === 45 || previous === 46   // _ $ - .
}

/**
 * 驼峰匹配（`CamelHumpMatcher` 的保守子集）：前缀的每个字符从左到右命中 label，
 * 命中点要么紧接上一个命中，要么落在**词的边界**上。它让 `getN` 命中 `getName`、
 * `gN` 命中 `getName`（g 在串首、N 是驼峰），而 `xyz` 不命中任何形状。
 */
export function camelHumpMatch(label: string, typed: string): boolean {
  if (!label || !typed) return false
  const lower = typed.toLowerCase()
  let hit = -1
  for (let index = 0; index < lower.length; index++) {
    let found = -1
    for (let at = hit + 1; at < label.length; at++) {
      if (label[at].toLowerCase() !== lower[index]) continue
      // 首个字符可以在任意位置；其余必须连续或落在词边界。
      if (index === 0 || at === hit + 1 || isHumpStart(label, at)) { found = at; break }
    }
    if (found < 0) return false
    hit = found
  }
  return true
}

/** 候选名与已输入前缀的匹配形状（「分组」这一档的档位值）。
 * 连续出现（子串）排在驼峰命中之前：`name` 命中 `setName` 是有据可依的连续匹配，
 * 而 `gN` 命中 `getName` 只是跳到了词边界。 */
export function completionMatchKind(label: string, typed: string): CompletionMatchKind {
  if (!label || !typed) return 'none'
  if (label.startsWith(typed)) return 'exact'
  const lowerLabel = label.toLowerCase()
  const lowerTyped = typed.toLowerCase()
  if (lowerLabel.startsWith(lowerTyped)) return 'ignoreCase'
  if (lowerLabel.includes(lowerTyped)) return 'substring'
  if (camelHumpMatch(label, typed)) return 'camel'
  return 'none'
}

/** 匹配形状的序号（越小越靠前）——排序器比较用。 */
export function completionMatchRank(label: string, typed: string): number {
  return MATCH_RANK[completionMatchKind(label, typed)]
}

/** 只有两边是同一次输入（同一个 `typedPrefix`）时，"匹配形状"这一档才可比。 */
function commonTypedPrefix(a: SortableCompletion, b: SortableCompletion): string {
  const typed = a.typedPrefix
  return typed && typed === b.typedPrefix ? typed : ''
}

/**
 * ② LSP 相关性这一档（`LspCompletionWeigher.kt:30-36` + `ComparingClassifier.java:31-52`）：
 * 两边都有 `sortText` 时按**降序**比（`ReverseComparableString` 取反）；只有一边有的话，
 * 有 `sortText` 的那半边在前（另一边落进 weigher 返回 null 的 `nulls` 桶，追加在后面）。
 */
function compareSortText(a: SortableCompletion, b: SortableCompletion): number {
  if (a.sortText === undefined && b.sortText === undefined) return 0
  if (a.sortText === undefined) return 1
  if (b.sortText === undefined) return -1
  if (a.sortText === b.sortText) return 0
  return a.sortText < b.sortText ? 1 : -1
}

export function compareCompletions(a: SortableCompletion, b: SortableCompletion): number {
  if (Boolean(a.preselected) !== Boolean(b.preselected)) return a.preselected ? -1 : 1
  const relevance = compareSortText(a, b)
  if (relevance !== 0) return relevance
  const typed = commonTypedPrefix(a, b)
  if (typed) {
    const leftRank = completionMatchRank(a.label, typed)
    const rightRank = completionMatchRank(b.label, typed)
    if (leftRank !== rightRank) return leftRank - rightRank
  }
  const left = a.label
  const right = b.label
  const folded = left.toLowerCase().localeCompare(right.toLowerCase())
  if (folded !== 0) return folded
  if (left.length !== right.length) return left.length - right.length
  return left.localeCompare(right)
}

export function sortCompletions<T extends SortableCompletion>(list: readonly T[]): T[] {
  return [...list].sort(compareCompletions)
}
