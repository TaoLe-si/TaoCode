// 提交前的 TODO 扫描 —— 上游 `TodoCheckinHandler`（commit 检查里那一档「TODO」）在本仓的等价物：
// 复用项目自己的 TODO 模式（`TodoPattern`），逐条走 `Find in Files` 引擎（`search.run`），命中数求和。
//
// 单独一个模块是因为它是**异步编排**（会 await 桥接调用），与 `src/commitChecks.ts` 的纯格式化不是一类；
// 宿主（`src/components/SourceControl.vue`）只注入「按模式去搜」这一个依赖，本模块不碰桥接与 UI。
import type { SearchResult } from './bridge.ts'
import type { TodoPattern } from './settingsModel.ts'

/**
 * 逐条模式扫全工作区并求和（IDEA 的 "commit checks" 里那一步）。
 *
 * · 单条模式失败只报给 `onError`，**不中断**其余模式 —— 一条检查抛错不该让其它检查的结果消失；
 * · `search` 由宿主注入（正则/大小写/范围这些入参形状由宿主定在一处）。
 */
export async function scanTodoHits(
  search: (pattern: string) => Promise<SearchResult>,
  patterns: readonly TodoPattern[],
  onError: (caught: unknown) => void,
): Promise<number> {
  let total = 0
  for (const entry of patterns) {
    try {
      const result = await search(entry.pattern)
      total += result.matches?.length ?? 0
    } catch (caught) {
      onError(caught)
    }
  }
  return total
}
