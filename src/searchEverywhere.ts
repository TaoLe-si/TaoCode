// Search Everywhere（IDEA `com.intellij.platform.searchEverywhere`，263 的新分屏实现）——
// 一个对话框同时搜多个供给者，而不是像以前那样一个功能一个面板。
//
// **tab 集合来自注册表，不是记忆**：新 SE 的 tab 由扩展点 `searchEverywhere.tabFactory` 列出，
// 本树里 `platform/searchEverywhere/frontend/resources/intellij.platform.searchEverywhere.frontend.xml:64-69`
// 正好注册了六个 factory —— All / Classes / Files / Symbols / Actions / Text。
// 显示顺序按各自 tab 的 `priority` 降序（`SeTabVm` 依此排序）：
//   All `SeAllTab.kt:89` Integer.MAX_VALUE · Classes `SeClassesTab.kt:50` 950 ·
//   Files `SeFilesTab.kt:52` 900 · Symbols `SeSymbolsTab.kt:50` 850 ·
//   Actions `SeActionsTab.kt:56` 800 · Text `SeTextTab.kt:56` 250。
//
// **tab 名称各取各的键，别混用一批**（2026-10-05 逐个核过）：
//   · All   = `IdeBundle.properties:1115` `searcheverywhere.all.elements.tab.name=All`（`SeAllTab.kt:86`）
//   · Classes = `GotoClassPresentationUpdater.getTabTitlePluralized()`（`SeClassesTab.kt:47`，复数标题，不是 bundle 键）
//   · Files / Symbols / Actions = `IdeBundle.properties:1812/1814/1811`
//     `search.everywhere.group.name.{files,symbols,actions}`（`SeFilesTab.kt:49` / `SeSymbolsTab.kt:47` / `SeActionsTab.kt:54`）
// **更正上一版记错的**：`IdeBundle.properties:1116-1120` 那批 `searcheverywhere.*.tab.name`
// （Project / IDE / Commands / Run Configurations / Autocompletion）**不是新 SE 的 tab 名** ——
// `Project` 与 `IDE` 两个键全树无代码引用；`Commands` 只被**旧** SE 用（`SearchEverywhereUI.java:2042`），
// 新 SE 这一档叫 **Actions**；`Autocompletion` 只被已废弃的 `AutoCompletionProvider.java:63` 用。
// 旧的 `Classes / Symbols / Files / File Names / Actions` 那一套来自
// `ContributorDefinedTabsCustomizationStrategy.kt`，该类已标 `@Deprecated`
// （"the old Search Everywhere is being sunset in favor of the new (Split) Search Everywhere"）。
//
// **只渲染有真实供给者的 tab**（项目硬规则：没有真实消费链路的项不渲染）。本仓能接上的：
//   · Classes           —— 同一批符号里只留语言服务标成类型的那些（`SeClassesTab`），
//                          查 `Foo#bar` 时打开类的直接成员（`ClassSearchEverywhereNavigationHandler`）
//   · Project           —— **本仓的合成档**，上游没有这一 tab（见上）。取 Files 那一档的位次，
//                          收工作区文件清单（`workspace.files`，宿主）+ LSP `workspace/symbol`
//   · Symbols           —— 上游 850 那一档，本仓就是 LSP `workspace/symbol` 那一批（含类）
//   · Actions           —— 已有动作表（`menuUi` 的 actionList）
//   · Run Configurations —— 用户配置 + 打开项目时自动发现的候选（`runConfigurations`）。上游这一档不是 tab：
//                          `RunConfigurationsSEContributor.java:76-83` 只给 `getGroupName()` 与
//                          `getSortWeight() = 350`、`showInFindResults() = false` —— 即它只出现在 All 里。
//                          本仓把它单列一档是为了直接可用，**这是有意偏离**，不是漏抄。
//   · All               —— 上面几者的并集，按来源分组
// 不渲染：IDE 与 Autocompletion（上游那两档在本树里没有真实供给者，见下）。
// **订正 2026-10-06（桶 9b）**：上一版这里写着"不渲染 Text（本仓的全文搜索是独立面板）"，
// 现在 Text 档已接上宿主 `search.run`（`native/search.cpp`）这条真实通道 —— 见
// `src/searchEverywhereText.ts` 与 `src/searchEverywhereHost.ts` 的 `refreshText()`。
// **不做**：IDE / Autocompletion 两档不是缺口 —— `AutoCompletionProvider.java:27-29` 整个类标了
// `@Deprecated`（"The functionality is redundant."）且包级私有，全树零引用；`IDE` 只有资源串。
//
// 排序：命令/符号/运行配置复用 `commandSearch.rankCommands`（IDEA Find Action 的打分：整段命中 > 词首命中 >
// 散序子序列，关键词别名权重低）；**文件来源是另一套** —— Smith-Waterman 本地对齐，见 `fuzzyMatch.ts`。
import { scoreCommand, type Searchable } from './commandSearch.ts'
import { fuzzyMatchFileName, fuzzyMatchPath, fuzzyWeight, passesFuzzyThreshold } from './fuzzyMatch.ts'
import { classSearchPattern, isSearchEverywhereClass } from './searchEverywhereClasses.ts'
// 跨供给者配额（上游 `SeResultsCountBalancer`）与 Text 档的常量：两者都是**生产链路**，
// 本文件是它们的第一个消费者（配平在 `searchEverywhereResults` 里，Text 档在 tab 表里）。
import { RESULTS_DIFFERENCE_LIMIT, balanceResults, type BalanceTier } from './searchEverywhereBalancer.ts'
import { SE_TEXT_TAB_NAME, SE_TEXT_TAB_PRIORITY } from './searchEverywhereText.ts'

export type SearchEverywhereTab = 'all' | 'classes' | 'project' | 'symbols' | 'commands' | 'runConfigs' | 'text'
/** 一个供给者。`all` tab 是它们的并集。 */
export type SearchEverywhereSource = 'project' | 'symbols' | 'commands' | 'runConfigs' | 'text'

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
  /** 文件/符号的真实路径用于作用域；符号路径不能占用 fuzzyPath（后者会启用文件打分）。 */
  path?: string
  /** 语言服务返回的 SymbolKind；未提供时不能归类成 Class。 */
  symbolKind?: number
  /**
   * 标题里要加粗的字符区间（供给者**自己**算出来的命中位置）。
   *
   * Text 档用它：宿主的 `column` + `length` 就是命中段本身（`native/search.cpp:408-410`），
   * 换算在 `src/searchEverywhereText.ts` 的 `textHitFragments`。
   * 文件档不走这条路（那边的区间来自 Smith-Waterman 的下标，见 `fuzzyTitleFragments`）。
   */
  hitRanges?: [number, number][]
  /** 只读磁盘预览；不打开编辑器、不触发导航。过期会话返回 null。 */
  preview?: () => Promise<SearchEverywherePreviewData | null>
  /** 打开该项（跳文件 / 执行动作 / 选中运行配置）。 */
  open: (query?: string) => unknown
}

export interface SearchEverywhereTabDef {
  id: SearchEverywhereTab
  /** 直接取 `IdeBundle.properties` 的 tab 名称（Classes 档取 `GotoClassPresentationUpdater` 的复数标题）。 */
  label: string
  /**
   * 上游 `SeTabInfo.priority`（`SeTabsCustomizer.kt:29` 的第二个字段）：0..1000 量级，
   * **越大越靠左**（`SeTab.kt:31-34`）。以前本仓靠数组顺序表达同一件事，
   * 现在交给 `visibleEverywhereTabs()` 排序（`src/searchEverywhereTabs.ts`）——
   * 因为 tab 表要能被 `SeTabsCustomizer` 的等价物改位次/摘档，顺序必须是数据。
   */
  priority: number
  /** 该 tab 由哪些供给者喂数据（`all` 是并集）。 */
  sources: readonly SearchEverywhereSource[]
  /**
   * Classes 档（上游 `SeClassesTab`，id = `ClassSearchEverywhereContributor`，priority 950）：
   * 只留语言服务标成 Class/Interface/Enum/Struct 的符号 —— 判 kind 不看名字。
   */
  classesOnly?: boolean
}

/**
 * 有真实供给者的 tab，**顺序 = 上游 tab priority 降序**（`SeTabVm` 的排法）。
 * 每条后面注的是它对应的那一档上游 tab 与 priority，便于复核而不是凭记忆：
 *   All `SeAllTab.kt:89` MAX · Classes `SeClassesTab.kt:50` 950 · Files `SeFilesTab.kt:52` 900
 *   （本仓的 Project 合成档取这一位）· Symbols `SeSymbolsTab.kt:50` 850
 *   · Actions `SeActionsTab.kt:56` 800 ·（Run Configurations 350，`RunConfigurationsSEContributor.java:82`）
 */
export const SEARCH_EVERYWHERE_TABS: readonly SearchEverywhereTabDef[] = [
  { id: 'all', label: 'All', priority: Number.MAX_SAFE_INTEGER, sources: ['project', 'symbols', 'commands', 'runConfigs', 'text'] },
  // Classes：`SeClassesTab.kt:47` 的标题 = `GotoClassPresentationUpdater` 的复数标题，priority 950。
  { id: 'classes', label: 'Classes', priority: 950, sources: ['symbols'], classesOnly: true },
  // Project：**上游没有这一 tab**（`frontend.xml:64-69` 只注册了 All/Classes/Files/Symbols/Actions/Text）。
  // 本仓把「项目里的文件 + 项目里的类/符号」合成一档，取 Files(900) 的位次。
  { id: 'project', label: 'Project', priority: 900, sources: ['project', 'symbols'] },
  // Symbols：上游 850 那一档（`SeSymbolsTab.kt:47,50`），名字取 `IdeBundle.properties:1814`。
  { id: 'symbols', label: 'Symbols', priority: 850, sources: ['symbols'] },
  // Actions：新 SE 这一档叫 Actions（`SeActionsTab.kt:54` → `IdeBundle.properties:1811`），
  // priority 800。上一版写 Commands 是抄了**旧** SE 的键（`SearchEverywhereUI.java:2042`），已更正。
  { id: 'commands', label: 'Actions', priority: 800, sources: ['commands'] },
  // Run Configurations：有意偏离 —— 上游它不是 tab，只是 All 里的一个贡献者（sortWeight 350）。
  { id: 'runConfigs', label: 'Run Configurations', priority: 350, sources: ['runConfigs'] },
  // Text：上游 `SeTextTab.kt:52-56`（id = `TextSearchContributor`、priority 250 —— 六档里最低，排最右）。
  // 供给者是宿主 `native/search.cpp` 的工程内扫描（`src/searchEverywhereText.ts`），
  // 上一版注释里写的"不渲染 Text"已经不成立：宿主侧 `search.run` 是真实通道。
  { id: 'text', label: SE_TEXT_TAB_NAME, priority: SE_TEXT_TAB_PRIORITY, sources: ['text'] },
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
 * 每个供给者在**跨供给者配额**里的层归属（上游 `SeResultsCountBalancer` 的三层）。
 *
 * 上游的层是这么定的（`platform/searchEverywhere/frontend/src/resultsProcessing/SeTabDelegate.kt:106-109`）：
 *   nonBlocked = remoteEssentialProviders · high = localEssentialProviders · low = localNonEssentialProviders。
 * 本仓没有跨进程供给者 ⇒ nonBlocked 恒空（与后端那份一致：
 * `platform/searchEverywhere/backend/src/impl/SeBackendService.kt:97` 就传了 `emptyList()`）。
 * "essential" 的判据是实现 `EssentialContributor`：本树里只有
 * `ClassSearchEverywhereContributor.kt` 与 `FileSearchEverywhereContributor.kt`
 * （`SymbolSearchEverywhereContributor.java:29-31` 已 `@Deprecated` 且没实现它）——
 * 换算到本仓就是「文件」与「符号」两类；动作、运行配置、文本命中落 low。
 */
export const SE_PROVIDER_TIERS: Readonly<Record<SearchEverywhereSource, BalanceTier>> = {
  project: 'high',
  symbols: 'high',
  commands: 'low',
  runConfigs: 'low',
  text: 'low',
}

/**
 * 跨供给者配平（上游 `SeResultsCountBalancer.add()` 的同步等价物）。
 *
 * `ordered` 必须是**已经按权重排好**的那一批（本仓 = `scored` 降序），于是每个供给者的队列
 * 就是它自己的最优在前。上游的三层许可决定"谁进列表"（拿不到许可就挂起等补额度），
 * `SeItem.weight()` 决定"进来之后坐哪儿" —— 本仓一次算完，所以：
 *   · 先按 balancer 的**轮转到达序**取前 `limit` 条（这一刀就是"不让某一档占满整张列表"）；
 *   · 再按权重把选中的这批排回显示序。
 * 命令条目走 `command` 直通（上游 `:63-69` 的 `if (newItem.isCommand) return newItem`）。
 */
function balanceAcrossProviders<T extends { item: SearchEverywhereItem; weight: number }>(
  ordered: readonly T[],
  limit: number,
): T[] {
  if (ordered.length < 2) return [...ordered]
  const balanced = balanceResults(
    ordered.map(entry => ({ ...entry.item, provider: entry.item.source, command: entry.item.source === 'commands' })),
    SE_PROVIDER_TIERS,
    RESULTS_DIFFERENCE_LIMIT,
  )
  const picked = new Set(balanced.taken.slice(0, limit).map(item => item.id))
  return ordered.filter(entry => picked.has(entry.item.id))
}

/**
 * 当前 tab 下应当展示的项（已按 tab 的供给者过滤）。
 *
 * 空查询时**不过滤也不打分**：直接按来源分组原样返回前 N 条 —— 与 `rankCommands` 的空查询行为一致
 * （它 `return items.slice(0, limit)`），避免一打开就因为排序抖动而看到不同的列表。
 *
 * `fuzzyFiles` 打开时文件来源改用 Smith-Waterman（`fuzzyMatch.ts`）：文件名强命中就用文件名那一档，
 * 否则退到整条路径；归一分不到 0.65 的丢掉（上游注册表键 `search.everywhere.fuzzy.files.min.score=6500`）。
 *
 * 跨供给者配平只在 **All 档**生效（`balanceAll = true`）：上游的 balancer 就是"一个弹层同时问
 * 多个供给者"时才有意义（`SeResultsCountBalancer.kt:20-30`），单档 tab 本来就只有一批来源。
 */
export function searchEverywhereResults(
  items: readonly SearchEverywhereItem[],
  query: string,
  tab: SearchEverywhereTab,
  limit = SEARCH_EVERYWHERE_LIMIT,
  fuzzyFiles = FUZZY_FILES_ENABLED_DEFAULT,
  /** 作用域过滤（上游 `ScopeChooserAction` 选中的那一档）：null = 项目全部文件，不过滤。 */
  inScope: (item: SearchEverywhereItem) => boolean = () => true,
  classesOnly = false,
  /** 类型漏斗（上游 `SeTargetsFilter.hiddenTypes`）：命中被关掉的类型的行不进列表。 */
  inTypes: (item: SearchEverywhereItem) => boolean = () => true,
  balanceAll = true,
): SearchEverywhereItem[] {
  const def = SEARCH_EVERYWHERE_TABS.find(entry => entry.id === tab) ?? SEARCH_EVERYWHERE_TABS[0]!
  // Classes 档：语言服务给的 kind 判定（`SeClassesTab`，不按名字猜）。显式参数与 tab 定义任一为真即生效。
  const onlyClasses = classesOnly || def.classesOnly === true
  // 作用域只作用于**文件与符号**两类供给者（上游 `ScopeChooserAction` 也只挂在
  // `TextSearchContributor` 与 `AbstractGotoSEContributor` 上）；命令与运行配置与作用域无关。
  const scoped = items.filter(item => def.sources.includes(item.source)
    && (!onlyClasses || isSearchEverywhereClass(item.symbolKind))
    && (item.source === 'commands' || item.source === 'runConfigs' || inScope(item))
    && inTypes(item))
  const needle = query.trim()
  if (!needle) return scoped.slice(0, limit)
  // `Foo#bar`：与符号名比对的是 `#` 前的类名那一段（`ClassSearchEverywhereContributor` 用去掉
  // member 的模式搜类；`#bar` 只在打开时用来定位成员，见 `searchEverywhereClasses.ts`）。
  const symbolNeedle = classSearchPattern(needle).owner || needle
  const scored: { item: SearchEverywhereItem; weight: number; index: number }[] = []
  scoped.forEach((item, index) => {
    const weight = rankingWeight(item, item.symbolKind === undefined ? needle : symbolNeedle, fuzzyFiles)
    if (weight > 0) scored.push({ item, weight, index })
  })
  scored.sort((a, b) => b.weight - a.weight || a.index - b.index)
  const balanced = balanceAll && tab === 'all' ? balanceAcrossProviders(scored, limit) : scored
  return balanced.slice(0, limit).map(entry => entry.item)
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

/**
 * 来源的中文副标签，`all` tab 里用来说明这一条是谁贡献的。
 * 动作那一档的标签与 tab 名同源（`SeActionsTab.kt:54` → `IdeBundle.properties:1811` = Actions），
 * 别一处叫 Actions 一处叫 Commands。
 * Text 档同理与 tab 名同源（`SeTextTab.kt:54` → `FindBundle."search.everywhere.group.name"`）。
 */
export function searchEverywhereSourceLabel(source: SearchEverywhereSource): string {
  if (source === 'project') return 'File'
  if (source === 'symbols') return 'Symbol'
  if (source === 'text') return 'Text'
  return source === 'commands' ? 'Actions' : 'Run Configuration'
}
