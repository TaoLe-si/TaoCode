// Search Everywhere（IDEA `com.intellij.platform.searchEverywhere`，263 的新分屏实现）——
// 一个对话框同时搜多个供给者，而不是像以前那样一个功能一个面板。
//
// **tab 名称与集合来自源码，不是记忆**：`IdeBundle.properties` 的
// `searcheverywhere.all.elements.tab.name=All` / `.project.search.`=Project / `.ide.search.`=IDE /
// `.commands.`=Commands / `.run.configs.`=Run Configurations / `.autocompletion.`=Autocompletion。
// 旧的 `Classes / Symbols / Files / File Names / Actions` 那一套来自
// `ContributorDefinedTabsCustomizationStrategy.kt`，该类已标 `@Deprecated`
// （"the old Search Everywhere is being sunset in favor of the new (Split) Search Everywhere"）。
//
// **只渲染有真实供给者的 tab**（项目硬规则：没有真实消费链路的项不渲染）。本仓能接上的：
//   · Project           —— 工作区文件清单（`workspace.files`，宿主）+ LSP `workspace/symbol`（含类）
//   · Commands          —— 已有动作表（`menuUi` 的 actionList）
//   · Run Configurations —— 用户配置 + 打开项目时自动发现的候选（`runConfigurations`）
//   · All               —— 上面三者的并集，按来源分组
// 暂不渲染：IDE、Autocompletion（还没有对应供给者；Autocompletion 需按当前文档取词，
// 见 IDEA 的 `WordCompletionContributor`，属于另一批）。
//
// 排序复用 `commandSearch.rankCommands`（IDEA Find Action 的打分：整段命中 > 词首命中 > 散序子序列，
// 关键词别名权重低），不另写一套匹配。
import { rankCommands, type Searchable } from './commandSearch.ts'

export type SearchEverywhereTab = 'all' | 'project' | 'commands' | 'runConfigs'
/** 一个供给者。`all` tab 是它们的并集。 */
export type SearchEverywhereSource = 'project' | 'commands' | 'runConfigs'

export interface SearchEverywhereItem extends Searchable {
  id: string
  title: string
  /** 副文本：路径 / 所属分组 / 快捷键。 */
  subtitle?: string
  source: SearchEverywhereSource
  /** 打开该项（跳文件 / 执行动作 / 选中运行配置）。 */
  open: () => void
}

export interface SearchEverywhereTabDef {
  id: SearchEverywhereTab
  /** 直接取 `IdeBundle.properties` 的 tab 名称。 */
  label: string
  /** 该 tab 由哪些供给者喂数据（`all` 是并集）。 */
  sources: readonly SearchEverywhereSource[]
}

/** 有真实供给者的 tab（顺序即显示顺序：All 在最前，与 IDEA 一致）。 */
export const SEARCH_EVERYWHERE_TABS: readonly SearchEverywhereTabDef[] = [
  { id: 'all', label: 'All', sources: ['project', 'commands', 'runConfigs'] },
  { id: 'project', label: 'Project', sources: ['project'] },
  { id: 'commands', label: 'Commands', sources: ['commands'] },
  { id: 'runConfigs', label: 'Run Configurations', sources: ['runConfigs'] },
]

/** 一次最多显示多少条（IDEA 有同样的截断；不给上限会把大项目的文件清单全铺出来）。 */
export const SEARCH_EVERYWHERE_LIMIT = 50

/**
 * 当前 tab 下应当展示的项（已按 tab 的供给者过滤）。
 *
 * 空查询时**不过滤也不打分**：直接按来源分组原样返回前 N 条 —— 与 `rankCommands` 的空查询行为一致
 * （它 `return items.slice(0, limit)`），避免一打开就因为排序抖动而看到不同的列表。
 */
export function searchEverywhereResults(
  items: readonly SearchEverywhereItem[],
  query: string,
  tab: SearchEverywhereTab,
  limit = SEARCH_EVERYWHERE_LIMIT,
): SearchEverywhereItem[] {
  const def = SEARCH_EVERYWHERE_TABS.find(entry => entry.id === tab) ?? SEARCH_EVERYWHERE_TABS[0]!
  const scoped = items.filter(item => def.sources.includes(item.source))
  return rankCommands(scoped, query, limit)
}

/** 有结果的 tab（空查询下恒为有结果 —— 那时列表来自各供给者的默认前 N 条）。 */
export function availableSearchEverywhereTabs(
  items: readonly SearchEverywhereItem[],
  query: string,
): SearchEverywhereTab[] {
  return SEARCH_EVERYWHERE_TABS
    .filter(def => searchEverywhereResults(items, query, def.id, 1).length > 0)
    .map(def => def.id)
}

/**
 * Tab / Shift+Tab 在**有结果的 tab** 之间循环。
 *
 * 为什么跳过空 tab：IDEA 的 tab 是按供给者静态列出的，某个供给者没结果时它仍留在 tab 行上；
 * 但本仓的 tab 是"有供给者才渲染"（见文件头），同一条规则下再留一个空 tab 就成了放假控件。
 */
export function cycleSearchEverywhereTab(
  current: SearchEverywhereTab,
  delta: number,
  available: readonly SearchEverywhereTab[],
): SearchEverywhereTab {
  if (!available.length) return current
  const at = available.indexOf(current)
  // 当前 tab 已经没结果（比如切走后又筛没了）时，从最近的下一个开始。
  if (at < 0) return available[0]!
  return available[(at + delta + available.length) % available.length]!
}

/** 上下移动选中项，越界回绕（IDEA 的结果列表是循环的）。 */
export function moveSearchEverywhereIndex(index: number, count: number, delta: number): number {
  if (count <= 0) return 0
  return (index + delta + count) % count
}

/** 来源的中文副标签，`all` tab 里用来说明这一条是谁贡献的。 */
export function searchEverywhereSourceLabel(source: SearchEverywhereSource): string {
  return source === 'project' ? 'Project' : source === 'commands' ? 'Commands' : 'Run Configuration'
}
