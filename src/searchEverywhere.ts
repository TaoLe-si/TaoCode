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
// 排序：命令/符号/运行配置复用 `commandSearch.rankCommands`（IDEA Find Action 的打分：整段命中 > 词首命中 >
// 散序子序列，关键词别名权重低）；**文件来源是另一套** —— Smith-Waterman 本地对齐，见 `fuzzyMatch.ts`。
import { scoreCommand, type Searchable } from './commandSearch.ts'
import { fuzzyMatchFileName, fuzzyMatchPath, fuzzyWeight, passesFuzzyThreshold } from './fuzzyMatch.ts'

export type SearchEverywhereTab = 'all' | 'project' | 'commands' | 'runConfigs'
/** 一个供给者。`all` tab 是它们的并集。 */
export type SearchEverywhereSource = 'project' | 'symbols' | 'commands' | 'runConfigs'

export interface SearchEverywherePreviewData {
  path: string
  content: string
  origin?: 'buffer' | 'disk'
  line?: number
  character?: number
  /** 仅使用供给者真实返回的结束位置；没有时只标记行/插入点，不猜符号长度。 */
  endLine?: number
  endCharacter?: number
}

export interface SearchEverywhereItem extends Searchable {
  id: string
  title: string
  /** 副文本：路径 / 所属分组 / 快捷键。 */
  subtitle?: string
  source: SearchEverywhereSource
  /**
   * 文件来源才填：整条路径，供 Smith-Waterman 匹配（`fuzzyMatchPath`）。
   * `title` 只是文件名，路径片段（`src/main`）要靠这个字段才搜得到 —— 与上游
   * `SmithWatermanMatcher.matchWithPath` 拿 `file.path` 一个道理。
   */
  fuzzyPath?: string
  /** 只读磁盘预览；不打开编辑器、不触发导航。过期会话返回 null。 */
  preview?: () => Promise<SearchEverywherePreviewData | null>
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
  { id: 'all', label: 'All', sources: ['project', 'symbols', 'commands', 'runConfigs'] },
  // Project = 项目里的文件 + 项目里的类/符号（IDEA 的 project scope 就是这两类）。
  { id: 'project', label: 'Project', sources: ['project', 'symbols'] },
  { id: 'commands', label: 'Commands', sources: ['commands'] },
  { id: 'runConfigs', label: 'Run Configurations', sources: ['runConfigs'] },
]

/** 一次最多显示多少条（IDEA 有同样的截断；不给上限会把大项目的文件清单全铺出来）。 */
export const SEARCH_EVERYWHERE_LIMIT = 50

/**
 * `rankCommands` 的分数上限：整段命中 60 + 词首 30 + 位于开头 20（`commandSearch.ts:29`）。
 * 跨来源合并排序时用它把命令那一档换算进权重区间（见 `rankingWeight`）。
 */
const COMMAND_SCORE_MAX = 110

/**
 * 词首命中的权重（上游 `PreferStartMatchMatcherWrapper.START_MATCH_WEIGHT = 10000`）。
 * `MAX_FUZZY_WEIGHT = 9999` 是上游特意选的"刚好在词首命中之下"的值，所以两档能放在同一个数轴上比：
 * 命令的最强命中（标题整段命中且在开头）拿满 10000，模糊文件最高只能到 9999 —— 与上游注释里
 * "Start-matching file results always rank above fuzzy results" 一致。
 */
const START_MATCH_WEIGHT = 10000

/**
 * 一次查询里每个结果的排序权重（上游各 provider 都实现 `SeItem.weight()`，前端按它合流排序）。
 * 模糊那一档直接是 `normalizedScore * MAX_FUZZY_WEIGHT`；命令/符号/运行配置那一档按
 * `scoreCommand / COMMAND_SCORE_MAX * START_MATCH_WEIGHT` 线性换算到同一条数轴。
 */
function rankingWeight(item: SearchEverywhereItem, query: string, fuzzyFiles: boolean): number {
  if (fuzzyFiles && item.fuzzyPath) {
    const match = fuzzyMatchPath(query, item.fuzzyPath)
    return match && passesFuzzyThreshold(match.normalized) ? fuzzyWeight(match.normalized) : 0
  }
  return Math.min(1, scoreCommand(query, item) / COMMAND_SCORE_MAX) * START_MATCH_WEIGHT
}

/**
 * 上游的 `search.everywhere.fuzzy.files.enabled` 注册表键默认 **false**
 * （`SeFuzzyFileSearchProviderFactory.kt:28-31`：`Registry.is("search.everywhere.fuzzy.files.enabled", false)`），
 * 所以 Smith-Waterman 文件供给者默认不参与。TaoCode 用同一个默认值：不勾选时行为与现在完全一致。
 */
export const FUZZY_FILES_ENABLED_DEFAULT = false

/**
 * 一行里要加粗的字符区间（上游 `SeFuzzyFileSearchItem.indicesToFragments`，`:57-74`）：
 * 把升序下标并成连续段，再交给 presentation 的 `withPresentableTextMatchedRanges`。
 *
 * 只画**文件名那一档**的命中：列表行显示的是文件名，而退到整条路径的那一档下标落在 `subtitle` 上。
 * 判定条件与 `matchWithPath` 一致（归一分 > 0.7 才用文件名那档）。
 */
export function fuzzyTitleFragments(item: SearchEverywhereItem, query: string, fuzzyFiles = FUZZY_FILES_ENABLED_DEFAULT): [number, number][] {
  if (!fuzzyFiles || !item.fuzzyPath) return []
  const name = item.fuzzyPath.split(/[\\/]/).pop() ?? item.fuzzyPath
  const match = fuzzyMatchFileName(query, name)
  if (!match || match.normalized <= 0.7) return []
  const fragments: [number, number][] = []
  let start = match.indices[0]!
  let end = start + 1
  for (const index of match.indices.slice(1)) {
    if (index === end) { end++; continue }
    fragments.push([start, end])
    start = index
    end = index + 1
  }
  fragments.push([start, end])
  return fragments
}

/**
 * 当前 tab 下应当展示的项（已按 tab 的供给者过滤）。
 *
 * 空查询时**不过滤也不打分**：直接按来源分组原样返回前 N 条 —— 与 `rankCommands` 的空查询行为一致
 * （它 `return items.slice(0, limit)`），避免一打开就因为排序抖动而看到不同的列表。
 *
 * `fuzzyFiles` 打开时文件来源改用 Smith-Waterman（`fuzzyMatch.ts`）：文件名强命中就用文件名那一档，
 * 否则退到整条路径；归一分不到 0.65 的丢掉（上游注册表键 `search.everywhere.fuzzy.files.min.score=6500`）。
 */
export function searchEverywhereResults(
  items: readonly SearchEverywhereItem[],
  query: string,
  tab: SearchEverywhereTab,
  limit = SEARCH_EVERYWHERE_LIMIT,
  fuzzyFiles = FUZZY_FILES_ENABLED_DEFAULT,
  /** 作用域过滤（上游 `ScopeChooserAction` 选中的那一档）：null = 项目全部文件，不过滤。 */
  inScope: (item: SearchEverywhereItem) => boolean = () => true,
): SearchEverywhereItem[] {
  const def = SEARCH_EVERYWHERE_TABS.find(entry => entry.id === tab) ?? SEARCH_EVERYWHERE_TABS[0]!
  // 作用域只作用于**文件与符号**两类供给者（上游 `ScopeChooserAction` 也只挂在
  // `TextSearchContributor` 与 `AbstractGotoSEContributor` 上）；命令与运行配置与作用域无关。
  const scoped = items.filter(item => def.sources.includes(item.source) && (item.source === 'commands' || item.source === 'runConfigs' || inScope(item)))
  const needle = query.trim()
  if (!needle) return scoped.slice(0, limit)
  const scored: { item: SearchEverywhereItem; weight: number; index: number }[] = []
  scoped.forEach((item, index) => {
    const weight = rankingWeight(item, needle, fuzzyFiles)
    if (weight > 0) scored.push({ item, weight, index })
  })
  scored.sort((a, b) => b.weight - a.weight || a.index - b.index)
  return scored.slice(0, limit).map(entry => entry.item)
}

/** 有结果的 tab（空查询下恒为有结果 —— 那时列表来自各供给者的默认前 N 条）。 */
export function availableSearchEverywhereTabs(
  items: readonly SearchEverywhereItem[],
  query: string,
  fuzzyFiles = FUZZY_FILES_ENABLED_DEFAULT,
): SearchEverywhereTab[] {
  return SEARCH_EVERYWHERE_TABS
    .filter(def => searchEverywhereResults(items, query, def.id, 1, fuzzyFiles).length > 0)
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
  if (source === 'project') return 'File'
  if (source === 'symbols') return 'Symbol'
  return source === 'commands' ? 'Commands' : 'Run Configuration'
}
