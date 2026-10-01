// 补全候选的**排序**（上游 IDEA 的排序器链）—— 纯函数，零 Vue、零 DOM。
//
// 上游结构（读源码的结论）：`CompletionLookupArranger.arrange`（`platform/analysis-impl/src/com/intellij/
// codeInsight/completion/CompletionLookupArranger.java:16,25`）收一个 `CompletionSorter`，而它是
// **可扩展的档位链** —— `.../impl/CompletionSorterImpl.java:18` 的 `weighingFactory:28` 把
// `LookupElementWeigher` 折成 `ClassifierFactory`，`weighBefore:44`/`weighAfter:55` 往链里插档。
// 本仓取默认链的四档，按顺序比较（先比出来的档位说了算）：
//   ① **预选**：LSP `preselect` 的候选必须排最前（协议里它就是"默认选中的那条"）；
//   ② **相关性**：LSP `sortText`（服务器给的分组/优先级键；缺省退回 label）—— 字符串按字典序比；
//   ③ **大小写不敏感**：忽略大小写的字典序（让 `foo` 与 `Foo` 相邻，而不是被 ASCII 码拆开）；
//   ④ **长度**：短者先（IDEA 的 LengthWeigher）；
//   ⑤ **字母序**：区分大小写的最终比较，保证稳定。
// CodeMirror 只负责画：顺序在这里定，之后不再交给它的 `sortText` 排序。
export interface SortableCompletion {
  /** 可见名（服务端给的 `label`）。 */
  label: string
  /** LSP `sortText`：服务器给的排序键。 */
  sortText?: string
  /** LSP `preselect`：这一条要默认选中。 */
  preselected?: boolean
}

const key = (entry: SortableCompletion) => entry.sortText ?? entry.label

export function compareCompletions(a: SortableCompletion, b: SortableCompletion): number {
  if (Boolean(a.preselected) !== Boolean(b.preselected)) return a.preselected ? -1 : 1
  const left = key(a)
  const right = key(b)
  if (left !== right) return left < right ? -1 : 1
  const folded = left.toLowerCase().localeCompare(right.toLowerCase())
  if (folded !== 0) return folded
  if (left.length !== right.length) return left.length - right.length
  return left.localeCompare(right)
}

export function sortCompletions<T extends SortableCompletion>(list: readonly T[]): T[] {
  return [...list].sort(compareCompletions)
}
