// 「引用」这条工具窗口内容的**存储**：一个 ContentManager 的响应式版本。
//
// 判据（为什么不是以前那个 `references = ref<LspLocation[]>([])`）：IDEA 的 Find 窗口每次搜索是
// 一条 Content（`platform/lang-impl/src/com/intellij/usageView/impl/UsageViewContentManagerImpl.java:149-192`），
// 顶替规则、钉住、"正在搜索的那条不能被顶替"都在**条目**上；单一数组把这些全压成"最后一次结果覆盖上一次"，
// 于是标签条上永远只有一行，`关闭所有标签页` 也无从谈起。列表语义在 src/toolContents.ts，这里只是它的宿主。
//
// 模块级状态与 src/gradleEvents.ts 同一形状：这份内容由 bridge/编辑器动作/工具窗口三处共写，
// 挂到 App.vue 上只会把那 2737 行再撑胖。
import { computed, ref, watch } from 'vue'
import type { LspLocation } from './bridge'
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

function readStoredFlag(key: string): boolean {
  try { return localStorage.getItem(key) === 'true' } catch { return false }
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

/**
 * 开始一次搜索 = `addContent`：先占一条"正在搜索"的内容（上游 `:171-172` 就是靠这个标志
 * 不让一条还没跑完的结果被下一次搜索顶替掉）。`shortName` 上标签，`longName` 上面板标题。
 */
export function startReferences(shortName: string, longName: string): ReferenceSearch {
  const id = ++sequence
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
  if (contents.value.some(content => content.id === id)) selectedId.value = id
}

/** `ContentManager.removeContent(content, true)` + 选中邻居。 */
export function closeReferences(id: number): void {
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
  return ids
}

export function closeOtherReferences(): number[] {
  const ids = toolContentsToCloseOthers(contents.value, selectedId.value)
  // 收的就是报出去的那几条 —— 反过来写（只留选中的）在选中为 null 时会把列表清空。
  contents.value = contents.value.filter(content => !ids.includes(content.id))
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
}
