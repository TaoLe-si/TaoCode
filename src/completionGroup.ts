// 补全候选的**分组**（上游 IDEA 的排序器堆）—— 纯函数，零 Vue、零 DOM。
//
// 上游结论：分组不是独立开关，而是**排序链的副产物** ——
// `platform/analysis-impl/src/com/intellij/codeInsight/completion/BaseCompletionLookupArranger.java:95`
// 的 `groupItemsBySorter` 把候选归成 `MultiMap<CompletionSorterImpl, LookupElement>`，
// `:121`/`:402` 在**堆与堆之间插分隔符**，`:537-542` 也是"先分组、组内再按相关性排"。
//
// 本仓的组键 = **排序链第一档能区分开的键**：LSP 侧的 `sortText` 就是服务器给的分组键
// （常见形状是同一类别共用一个前缀，例如 `09…`/`10…`），所以取它的**首字符**当组键；
// 没有 `sortText` 的候选落进一个默认组（键为 `''`）。组内顺序交给 `sortCompletions()` 的其余档。
export interface GroupableCompletion {
  label: string
  /** LSP `sortText`：服务器给的排序/分组键。 */
  sortText?: string
}

export interface CompletionGroup<T> {
  /** 组键（`sortText` 的首字符；`''` = 没有 sortText 的默认组）。 */
  key: string
  items: T[]
}

/** 第一档能区分开的键（见文件头注释）。 */
export const groupKeyOf = (entry: GroupableCompletion): string => (entry.sortText ?? '').slice(0, 1)

/**
 * 按组键切堆，**保持候选进来的顺序**（组内顺序由调用方先 `sortCompletions()` 定好）：
 * 分组只负责"哪几条挨在一起 + 什么时候画分隔行"，不改变组内先后。
 */
export function groupCompletions<T extends GroupableCompletion>(list: readonly T[]): CompletionGroup<T>[] {
  const groups: CompletionGroup<T>[] = []
  const index = new Map<string, CompletionGroup<T>>()
  for (const entry of list) {
    const key = groupKeyOf(entry)
    let bucket = index.get(key)
    if (!bucket) { bucket = { key, items: [] }; index.set(key, bucket); groups.push(bucket) }
    bucket.items.push(entry)
  }
  return groups
}

/** 组与组之间要不要画分隔行：只有一组时不画（IDEA 也不会给单组加分隔）。 */
export const separatorBefore = (groups: readonly CompletionGroup<unknown>[], index: number): boolean =>
  index > 0 && groups.length > 1
