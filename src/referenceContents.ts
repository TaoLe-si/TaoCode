// 「引用」这条工具窗口内容的**存储**：一个 ContentManager 的响应式版本。
//
// 判据（为什么不是以前那个 `references = ref<LspLocation[]>([])`）：IDEA 的 Find 窗口每次搜索是
// 一条 Content（`platform/lang-impl/src/com/intellij/usageView/impl/UsageViewContentManagerImpl.java:149-192`），
// 顶替规则、钉住、"正在搜索的那条不能被顶替"都在**条目**上；单一数组把这些全压成"最后一次结果覆盖上一次"，
// 于是标签条上永远只有一行，`关闭所有标签页` 也无从谈起。列表语义在 src/toolContents.ts，这里只是它的宿主。
//
// 模块级状态与 src/gradleEvents.ts 同一形状：这份内容由 bridge/编辑器动作/工具窗口三处共写，
// 挂到 App.vue 上只会把那 2737 行再撑胖。
import { computed, ref, shallowRef, watch } from 'vue'
import type { LspLocation } from './bridge.ts'
// 用法树的分摊平、成员层与速度搜索过滤（判词 `lp/usage-view` 的分组那一半）。
import {
  allUsageGroupKeys, buildUsageTree, exportUsageTreeText, usageRowsForQuery,
  type UsageMemberSymbol, type UsageTreeRow,
} from './usageViewGrouping.ts'
import { addToolContent, removeToolContent, togglePinned, toolContentsToCloseAll,
         toolContentsToCloseOthers, usagesPanelTitle, usagesTabName, type ToolContent } from './toolContents.ts'

/** 一次搜索的凭据：`startReferences` 给，`finishReferences` / `failReferences` 收。 */
export interface ReferenceSearch { id: number }

const contents = ref<ToolContent<LspLocation[]>[]>([])
const selectedId = ref<number | null>(null)
let sequence = 0

// 面板标题的第二个槽（`{0} in {1}`）：本仓的引用一律由语言服务在**整个工程**里查，
// 对应 IDEA 的 `psi.search.scope.project` = `Project Files`
// （`platform/core-api/resources/messages/CoreBundle.properties:24`）。
const PROJECT_SCOPE = '项目文件'

// `find.open.in.new.tab.action`（`platform/analysis-impl/resources/messages/FindBundle.properties:23`
// "Open Results in New Ta&b"）绑的是 `FindUsagesSettings.showResultsInSeparateView`
// （`UsageViewContentManagerImpl.java:59-74`）—— 它是**持久化**设置，不是一次会话里的开关。
// 读法照本仓那条"缺键就取默认"的纪律：只认 'true'，其余（缺键/旧值/写坏）一律按默认 false 走，
// 于是旧磁盘上的 localStorage 不会被判成损坏。
// 这一组的**两条**（Find 窗口齿轮的「视图选项」，`UsageViewContentManagerImpl.java:114-116`）：
// 「在新标签页中打开结果」（`find.open.in.new.tab.action`）与「按字母顺序排列成员」
// （`UsageViewBundle.properties` 的 `sort.alphabetically.action.text`）。第三条
// 「一键导航」（`UIBundle.properties:23` "Navigate with Single Click" = 单击即导航）**没接**：
// 本仓的结果行本来就是单击即导航，那个开关要的是"单击选中 / 双击导航"的选择模型，
// 结果列表还没有选择态 —— 做一个点了没反应的勾选项就是假控件，逐条登记在 docs/source-todo.md §10。
// 组标题 `group.view.options` = 视图选项（IdeBundle）。
export const USAGE_VIEW_OPTIONS_TITLE = '视图选项'
export const USAGE_OPEN_IN_NEW_TAB_TITLE = '在新标签页中打开结果'
export const USAGE_SORT_TITLE = '按字母顺序排列成员'

function readStoredFlag(key: string, fallback = false): boolean {
  // **缺键取 `fallback`**（旧存档不会因为多了一个键被判损坏）；存过的值只认真写的 'true'/'false'，
  // 写坏了照样退回 `fallback`，不猜。
  try {
    const stored = localStorage.getItem(key)
    if (stored === 'true') return true
    if (stored === 'false') return false
    return fallback
  } catch { return fallback }
}
function persistFlag(key: string, value: boolean) {
  try { localStorage.setItem(key, String(value)) } catch { /* storage unavailable: session-only */ }
}

const NEW_TAB_KEY = 'taocode.referencesInNewTab'
export const referencesInNewTab = ref(readStoredFlag(NEW_TAB_KEY))
watch(referencesInNewTab, value => persistFlag(NEW_TAB_KEY, value))

// `UsageViewSettings.isSortAlphabetically`（键 `SORT_ALPHABETICALLY`，默认 false）。
const SORT_KEY = 'taocode.usagesSortAlphabetically'
export const referencesSortAlphabetically = ref(readStoredFlag(SORT_KEY))
watch(referencesSortAlphabetically, value => persistFlag(SORT_KEY, value))

/**
 * 字母序：路径（大小写不敏感）→ 行 → 列。
 * 上游排的是**用法树**（`UsageViewTreeModelBuilder` 按节点呈现文本比较），本仓的结果是一条平表，
 * 所以最接近的映射就是"先文件后位置"。大小写不敏感由 `CASE_INSENSITIVE_ORDER` 那一档决定
 * （`UsageViewSettings.isSortAlphabetically` 走的就是它），同级再比位置保证稳定。
 */
export function sortUsages(locations: readonly LspLocation[]): LspLocation[] {
  return [...locations].sort((left, right) => {
    const a = left.path.toLowerCase()
    const b = right.path.toLowerCase()
    if (a !== b) return a < b ? -1 : 1
    if (left.line !== right.line) return left.line - right.line
    return left.character - right.character
  })
}

/** 选中的那条的地点；没选中就是空数组（面板据此显示"没有找到引用"，不猜别条的内容）。 */
export const references = computed<LspLocation[]>(() => {
  const payload = contents.value.find(content => content.id === selectedId.value)?.payload ?? []
  return referencesSortAlphabetically.value ? sortUsages(payload) : payload
})
export const selectedReferences = computed<ToolContent<LspLocation[]> | null>(() =>
  contents.value.find(content => content.id === selectedId.value) ?? null)
/** 标签条上的一行（`Content.getTabName()` = tabName，`ContentImpl.java:135-137`）。 */
export const referenceTabs = computed(() => contents.value.map(content => ({
  id: content.id,
  label: content.tabName,
  tooltip: content.panelTitle,
  count: content.payload.length,
  pinned: content.pinned,
  searching: content.searching,
  selected: content.id === selectedId.value,
})))
export const hasReferences = computed(() => contents.value.length > 0)

// ——— 用法树（判词 `lp/usage-view` 的「把分组树接进引用面板」那一半的**模块侧**）———
//
// 上游的这一棵树：`platform/usageView-impl/src/com/intellij/usages/impl/rules/`
//   · 层级次序 = `UsageGroupingRulesDefaultRanks.java:26-32`（DIRECTORY_STRUCTURE=400 在
//     FILE_STRUCTURE=500 之前），两档的呈现文本与折叠/计数规则、以及「根节点不可见」「默认展开」
//     都逐条写在 `src/usageViewGrouping.ts` 的模块头；
//   · 目录那一档的开关是 Find 窗口工具条上的 Group By 弹出组（`UsageViewImpl.java:1089-1098`）里的
//     `GroupByDirectoryStructureAction`（`actions/GroupByDirectoryStructureAction.java:10-26`，
//     文本 = `UsageViewBundle.properties:21` "Directory Structure"），
//     状态存在 `UsageViewSettings.kt:102-103`，**默认 false**（`:26`）—— 本仓同档、同一个持久化口径；
//   · 导出 = `UsageViewImpl.java:2260` 递出去的 `PlatformDataKeys.EXPORTER_TO_TEXT_FILE`
//     （实现在 `usages/impl/ExporterToTextFile.java`），所以面板上那个「导出到文本文件」是真动作。
//
// 面板模板（App.vue，冻结）只需要一次 `v-for="row in referenceRows"` + 三个事件；见
// `docs/wiring-requests-2026-10-06-navigation2.md` N-1。在此之前这里只是**规则 + 状态**，
// 界面上仍是那张平表（`references`），不出现半接的控件。

/** 齿轮/工具条上那一档的名字（`action.group.by.directory.structure` 直译）。 */
export const USAGE_GROUP_BY_DIRECTORY_TITLE = '目录结构'

/** 成员层那一档的名字（`action.group.by.file.structure` = "File Structure"，`UsageViewBundle.properties:20` 直译）。 */
export const USAGE_GROUP_BY_FILE_STRUCTURE_TITLE = '文件结构'

// 与上面两条视图选项同一个持久化口径：**缺键取默认**（旧磁盘上的存档不会被判损坏）。
// 目录那一档默认 **false**（`UsageViewSettings.kt:26`）；成员层那一档默认 **true**
// （`UsageViewSettings.kt:21` 的 `isGroupByFileStructure: Boolean = true`）—— 两档的默认值
// 不是一条，别顺手抄成同一个。
const GROUP_DIRECTORY_KEY = 'taocode.usagesGroupByDirectory'
export const referencesGroupByDirectory = ref(readStoredFlag(GROUP_DIRECTORY_KEY, false))
watch(referencesGroupByDirectory, value => persistFlag(GROUP_DIRECTORY_KEY, value))

const GROUP_FILE_STRUCTURE_KEY = 'taocode.usagesGroupByFileStructure'
export const referencesGroupByFileStructure = ref(readStoredFlag(GROUP_FILE_STRUCTURE_KEY, true))
watch(referencesGroupByFileStructure, value => persistFlag(GROUP_FILE_STRUCTURE_KEY, value))

/**
 * 成员层（类 / 方法）的符号从哪儿来：上游是 PSI（`ClassGroupingRule.java:44-62`），本仓只有
 * 宿主手里那份 LSP `documentSymbol`。所以这里留一个**注入点**而不是自己去要数据 ——
 * 宿主在拿到某个文件的符号时把它交进来（接线见
 * `docs/wiring-requests-2026-10-06-usage3.md` 的 R-1/R-2）。
 * 没接上时 `usageSymbolsAvailable()` 为 false：树退回「文件 → 行」，齿轮里也**不给**
 * 「文件结构」那一行（一个切了没反应的勾选项就是假控件）。
 */
const symbolProviderRef = shallowRef<((path: string) => readonly UsageMemberSymbol[] | undefined) | undefined>(undefined)
export function provideUsageSymbols(provider?: ((path: string) => readonly UsageMemberSymbol[] | undefined) | null): void {
  // 必须是**响应式**的一份：宿主可能在结果回来之后才把符号取到（LSP 是异步的），
  // 用一个普通 `let` 时 `referenceUsageTree` 不会重算，那一层就永远画不出来。
  symbolProviderRef.value = provider ?? undefined
}
export function usageSymbolsAvailable(): boolean {
  return symbolProviderRef.value !== undefined
}

/**
 * 面板的速度搜索串（`src/components/SpeedSearchBar.vue` 那一条输入框的值）。
 * 语义差异写在 `src/usageViewGrouping.ts` 的 `filterUsageTree` 头上：上游那一串是**跳转**
 * （`UsageViewImpl.java:978-983`），本仓这张列表是**过滤 + 按可见行重算计数**。
 * 换一条内容 / 起一次新搜索时清空：这一串属于"正在看的这一份结果"，
 * 让它漏到下一份结果上会莫名其妙（上游每条 Content 各一棵 model 树，
 * `UsageViewContentManagerImpl.java:149-192`；**speed search 串本身在换 Content 时是否重置
 * 无法核实** —— 参考树里没找到显式清串的调用，这一条按本仓的"一份内容一份状态"定）。
 */
export const referencesSpeedSearch = ref('')

/**
 * 折叠掉的组键，**按内容 id 分档**（上游每个 Content 带着自己那棵 model 树，折叠状态跟着它走；
 * `UsageViewContentManagerImpl.java:149-192` 一条搜索一条内容）。
 * 默认空 = 全展开（对应上游"模型重建后 expandTree(2)、根下一层一律展开"，
 * `UsageViewImpl.java:1317-1319`/`:1293-1302`）。
 */
const collapsedUsageGroups = ref<Record<number, string[]>>({})

function collapsedKeys(): string[] {
  return collapsedUsageGroups.value[selectedId.value ?? -1] ?? []
}

/** 当前选中那条内容的分组树（规则全在 `src/usageViewGrouping.ts`）。 */
export const referenceUsageTree = computed(() => buildUsageTree(references.value, '工作区', {
  symbolProvider: symbolProviderRef.value,
  groupByFileStructure: referencesGroupByFileStructure.value,
}))

/**
 * 面板的行（深度优先、目录在前、带折叠态；搜索串非空时**只留可见行，组行计数按可见行算**）。
 */
export const referenceRows = computed<UsageTreeRow[]>(() => usageRowsForQuery(referenceUsageTree.value, referencesSpeedSearch.value, {
  collapsed: new Set(collapsedKeys()),
  showDirectories: referencesGroupByDirectory.value,
}))

export function toggleUsageGroup(key: string): void {
  const id = selectedId.value ?? -1
  const current = collapsedUsageGroups.value[id] ?? []
  const at = current.indexOf(key)
  collapsedUsageGroups.value = {
    ...collapsedUsageGroups.value,
    [id]: at >= 0 ? [...current.slice(0, at), ...current.slice(at + 1)] : [...current, key],
  }
}

/**
 * 全部折叠（上游 `collapseAllAction`，`UsageViewImpl.java:1082` → `:1338-1343` 的
 * `TreeUtil.collapseAll(tree, keepSelectionLevel)` 再 `expandRow(0)` —— 收整棵树、只留根那一行展开，
 * 本仓的"根"在树里不可见，所以收起全部组键、组行自己仍画着）。
 */
export function collapseAllUsageGroups(): void {
  const id = selectedId.value ?? -1
  collapsedUsageGroups.value = {
    ...collapsedUsageGroups.value,
    [id]: allUsageGroupKeys(referenceUsageTree.value, { showDirectories: referencesGroupByDirectory.value }),
  }
}

/** 全部展开（上游 `expandAllAction`，`UsageViewImpl.java:1081`）。 */
export function expandAllUsageGroups(): void {
  const id = selectedId.value ?? -1
  collapsedUsageGroups.value = { ...collapsedUsageGroups.value, [id]: [] }
}

/** 导出文本（树形，`ExporterToTextFile.java:31-71` 的形状）。 */
export function exportReferencesText(header: string): string {
  return exportUsageTreeText(referenceUsageTree.value, { header, showDirectories: referencesGroupByDirectory.value })
}

/** 一条内容被关掉/换工程时，把它那份折叠状态一起丢掉（不留垃圾键）。 */
function forgetUsageGroups(ids: readonly number[]): void {
  if (!ids.length) return
  const next = { ...collapsedUsageGroups.value }
  for (const id of ids) delete next[id]
  collapsedUsageGroups.value = next
}

/** 换一份结果看时就清掉那一串（过滤串属于"正在看的这一份"，见 `referencesSpeedSearch` 的头注）。 */
function forgetSpeedSearch(): void {
  if (referencesSpeedSearch.value) referencesSpeedSearch.value = ''
}

/**
 * 开始一次搜索 = `addContent`：先占一条"正在搜索"的内容（上游 `:171-172` 就是靠这个标志
 * 不让一条还没跑完的结果被下一次搜索顶替掉）。`shortName` 上标签，`longName` 上面板标题。
 */
export function startReferences(shortName: string, longName: string): ReferenceSearch {
  const id = ++sequence
  forgetSpeedSearch()
  const added = addToolContent(contents.value, selectedId.value, id, {
    tabName: usagesTabName(shortName),
    panelTitle: usagesPanelTitle(longName, PROJECT_SCOPE),
    pinned: false,
    searching: true,
    // 搜索类内容全部可复用（上游传 `reusable = true`，`:156` 那条 key 就是它）。
    reusable: true,
    payload: [],
  }, referencesInNewTab.value)
  contents.value = added.contents
  selectedId.value = added.selectedId
  return { id }
}

/** 结果回来：填进那一条。空结果不留标签（界面已经会弹"没有找到引用"，留一条空 tab 是噪声）。 */
export function finishReferences(search: ReferenceSearch, locations: LspLocation[]): boolean {
  const target = contents.value.find(content => content.id === search.id)
  if (!target) return false
  if (!locations.length) { failReferences(search); return false }
  contents.value = contents.value.map(content =>
    content.id === search.id ? { ...content, payload: locations, searching: false } : content)
  selectedId.value = search.id
  return true
}

/** 搜索失败/空结果：把那条"正在搜索"的内容撤掉；选中它时退回别条或收起。 */
export function failReferences(search: ReferenceSearch): void {
  if (selectedId.value === search.id) {
    const rest = removeToolContent(contents.value, search.id)
    contents.value = rest
    selectedId.value = rest.length ? rest[rest.length - 1]!.id : null
    return
  }
  contents.value = removeToolContent(contents.value, search.id)
}

export function selectReferences(id: number): void {
  if (!contents.value.some(content => content.id === id)) return
  if (selectedId.value !== id) forgetSpeedSearch()
  selectedId.value = id
}

/** `ContentManager.removeContent(content, true)` + 选中邻居。 */
export function closeReferences(id: number): void {
  forgetUsageGroups([id])
  forgetSpeedSearch()
  if (selectedId.value !== id) { contents.value = removeToolContent(contents.value, id); return }
  const index = contents.value.findIndex(content => content.id === id)
  const rest = removeToolContent(contents.value, id)
  const next = rest[index] ?? rest[index - 1] ?? null
  contents.value = rest
  selectedId.value = next ? next.id : null
}

export function closeAllReferences(): number[] {
  const ids = toolContentsToCloseAll(contents.value)
  contents.value = []
  selectedId.value = null
  forgetUsageGroups(ids)
  forgetSpeedSearch()
  return ids
}

export function closeOtherReferences(): number[] {
  const ids = toolContentsToCloseOthers(contents.value, selectedId.value)
  // 收的就是报出去的那几条 —— 反过来写（只留选中的）在选中为 null 时会把列表清空。
  contents.value = contents.value.filter(content => !ids.includes(content.id))
  forgetUsageGroups(ids)
  return ids
}

/** `PinActiveTabAction`（`:52-59`）：取反的就是选中的那条。 */
export function togglePinReferences(id: number = selectedId.value ?? -1): void {
  contents.value = togglePinned(contents.value, id)
}

/** 换项目/关工程时清空（内容属于上一次会话）。 */
export function resetReferences(): void {
  contents.value = []
  selectedId.value = null
  collapsedUsageGroups.value = {}
  forgetSpeedSearch()
}
