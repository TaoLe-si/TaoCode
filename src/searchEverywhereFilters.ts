// Search Everywhere **每一档自己的**筛选器（上游 `platform/searchEverywhere/frontend/src/tabs/`
// 的 `SeTargetsFilterEditor.kt` 一族）。
//
// 判词里那条「本仓只有一个全局作用域选择器」说的就是这里。上游的形状（逐个照抄）：
//   · 每档一个 editor：`SeTab.kt:51` `suspend fun getFilterEditor(): SeFilterEditor?`，
//     Actions / All / Classes / Files / Symbols / Text 六档全部实现
//     （`tabs/actions/SeActionsTab.kt:32`、`tabs/all/SeAllTab.kt:56`、
//      `tabs/classes/SeClassesTab.kt:32`、`tabs/files/SeFilesTab.kt:33`、
//      `tabs/symbols/SeSymbolsTab.kt:32`、`tabs/text/SeTextTab.kt:24`），
//     只有 mock 档返回 null（`tabs/mocks/SeTabMock.kt:29`）。
//   · editor 的初值（`SeTargetsFilterEditor.kt:30-45`）三件：
//       1. **作用域按档存档**：`SeScopePersistentStorage` 的键是
//          `"SearchEverywhere.PersistedScope.$tabId"`（`:95`），存的值是**作用域名字**
//          （`:102` `setValue(persistedScopeKey, scopeName)`），读回来按名字查回 scopeId
//          （`:106-112`）；只有 `persistScopeIfAvailable` 为真才存（`:58-59`），
//          Classes / Files / Symbols 三档传的就是 `true`（`SeClassesTab.kt:29` 等）。
//       2. **自动切换档**：`selectedScopeId != scopesInfo.everywhereScopeId`
//          （`:43`）—— 选的不是"所有位置"那一档时，`AutoToggleAction.autoToggle(everywhere)`
//          才允许按输入长度在"项目 ↔ 所有位置"之间自动切（`SeFilterEditor.kt:27-37`）。
//       3. **隐藏类型表**：`hiddenTypes(all) = all?.filter { !it.isEnabled }?.map { it.name }`
//          （`:91`）—— 存的是"被关掉的那些"，不是白名单本身；而且只有
//          `SeTabsCustomizer.isTypeFilterEnabled(tabId)` 为真才读，否则**强制空表**
//          （`:34-40`，注释明确写了"关掉用户可见的筛选器时必须把状态归到干净档"）。
//   · 头部动作的**顺序**：`getHeaderActions() = [作用域, 预览, 类型]`（`:72-74`）。
//   · 类型勾选那一档只在 `states` 非空 **且** 允许时才建（`:53-56`）——
//     没有可选类型时连漏斗图标都不出现（同一条"不画空控件"的规矩，上游也是这样）。
//   · 勾上/取消一条（`SeTypeVisibilityStateHolder.setVisible`，
//     `tabs/utils/SeTypeVisibilityStateHolder.kt:13-19`）：按 `name` 找到**第一个**
//     `isEnabled != value` 的项，`cloneWithEnabled` 换掉它（`:16`），然后重算筛选值；
//     找不到就什么都不做（`:15` 的 `?: return`）。
//   · 可见性判定（`isVisible(type) = type?.isEnabled ?: false`，`:21`）：
//     **查不到这一档就不显示**（默认拒绝）。
//   · 白名单语义（`backend/src/providers/files/SeFilesProvider.kt:69-73` 的注释）：
//     "An empty set rejects every file, and an unset filter accepts every file."
//     —— 空集合是全拒，"没设过"才是全收，两者不是一回事。
//
// 本仓的承接方式：对话框按当前档取一份 `TargetsFilter`，作用域**按 tabId 存档**，
// 预览开关**按 tabId 存档**，类型漏斗的候选**从当前结果里真实长出来**（文件那一档按扩展名，
// 没有文件结果时整条漏斗不渲染）。类型判定作用在 `SearchEverywhereItem` 的真实路径上。

import type { SearchEverywhereTab } from './searchEverywhere.ts'

/** 上游 `SeTypeVisibilityStatePresentation(name, iconId, isEnabled)`（`providers/target/…:11`）。 */
export interface TypeVisibilityState {
  name: string
  /** 本仓存 lucide 图标名（渲染侧取 `iconSize.*` 定尺寸）；null = 空图标。 */
  icon: string | null
  enabled: boolean
}

/** 上游 `SeTargetsFilter(scopeId, autoToggleEnabled, hiddenTypes)`（`providers/target/SeTargetsFilter`）。 */
export interface TargetsFilter {
  scopeId: string | null
  /** `selectedScopeId != everywhereScopeId`（`SeTargetsFilterEditor.kt:43`）。 */
  autoToggleEnabled: boolean
  /** 被关掉的类型名（`:91` 的 `hiddenTypes`）。 */
  hiddenTypes: string[]
}

export interface FilterEditorCaps {
  tabId: SearchEverywhereTab
  /** `scopesInfo`：本仓 = 该档能不能选作用域（Actions 档不参与作用域过滤）。 */
  scopesInfo?: { selectedScopeId: string | null; everywhereScopeId: string | null; scopeNames: readonly string[] } | null
  typeVisibilityStates?: readonly TypeVisibilityState[] | null
  hasPreviewAction: boolean
  persistScopeIfAvailable?: boolean
  /** `SeTabsCustomizer.isTypeFilterEnabled(tabId)`。 */
  typeFilterEnabled?: boolean
  /** 已存档的作用域名（调用方从存储里读，纯函数不碰 localStorage）。 */
  persistedScopeName?: string | null
}

/** 头部动作的固定顺序（`SeTargetsFilterEditor.kt:72-74`）。 */
export const FILTER_HEADER_ACTIONS: readonly ['scope', 'preview', 'type'] = ['scope', 'preview', 'type']

/** `hiddenTypes(all)`（`:91`）：把"没开着"的那些名字挑出来。 */
export function hiddenTypesOf(states: readonly TypeVisibilityState[] | null | undefined): string[] {
  if (!states) return []
  return states.filter(state => !state.enabled).map(state => state.name)
}

/**
 * editor 的初值（`SeTargetsFilterEditor.kt:30-45` 那段 run 块）。
 *
 * 作用域名的回落链与上游一致：存档里的名字查得到 → 用它；查不到 → `scopesInfo.selectedScopeId`。
 * 类型表在 `typeFilterEnabled` 为假时**强制空**（`:37-40`），哪怕存储里留着关掉的类型。
 */
export function initialTargetsFilter(caps: FilterEditorCaps): TargetsFilter {
  const scopesInfo = caps.scopesInfo ?? null
  const restored = scopesInfo && caps.persistedScopeName
    ? (scopesInfo.scopeNames.includes(caps.persistedScopeName) ? caps.persistedScopeName : null)
    : null
  const scopeId = restored ?? scopesInfo?.selectedScopeId ?? null
  const hidden = caps.typeFilterEnabled === false ? [] : hiddenTypesOf(caps.typeVisibilityStates)
  return { scopeId, autoToggleEnabled: scopeId !== (scopesInfo?.everywhereScopeId ?? null), hiddenTypes: hidden }
}

/** `SeTypeVisibilityStateHolder.setVisible`（`SeTypeVisibilityStateHolder.kt:13-19`）。 */
export function setTypeVisibility(
  states: readonly TypeVisibilityState[],
  name: string | null,
  value: boolean,
): TypeVisibilityState[] {
  if (!name) return [...states]
  const index = states.findIndex(state => state.name === name && state.enabled !== value)
  if (index < 0) return [...states]
  const next = [...states]
  next[index] = { ...states[index]!, enabled: value }
  return next
}

/** `isVisible(type) = type?.isEnabled ?: false`（`:21`）—— 查不到就不显示。 */
export function isTypeVisible(states: readonly TypeVisibilityState[], name: string | null): boolean {
  if (name === null) return false
  return states.find(state => state.name === name)?.enabled ?? false
}

/**
 * 一批次搜索的类型表（上游 `SeFilesProvider.kt:74` 的 `getAllFileTypes()`）。
 *
 * 候选**只从真实结果里长出来**：结果里有几种扩展名就出几行，一种都没有就返回空表 ——
 * 空表时 `SeTargetsFilterEditor.kt:53-56` 的 `takeIf { it.isNotEmpty() }` 让漏斗图标
 * 整个不出现，本仓照做（不给一个点开是空的控件）。
 * 已经关掉的类型要留在表里，否则用户关完一种就再也找不回来（上游的持久化表同理）。
 */
export function typeVisibilityStates(
  presentTypes: readonly string[],
  previous: readonly TypeVisibilityState[] = [],
): TypeVisibilityState[] {
  const out: TypeVisibilityState[] = [...previous]
  for (const name of presentTypes) {
    if (out.some(state => state.name === name)) continue
    out.push({ name, icon: iconForType(name), enabled: true })
  }
  return out
}

/** 类型 → lucide 图标名。`Directory` 那一档的文案见 `IdeBundle.properties:1830`（中文 `:2304`「目录」）。 */
function iconForType(name: string): string | null {
  if (name === DIRECTORY_TYPE_NAME) return 'Folder'
  return name ? 'File' : null
}

/** 目录不是文件类型，但在 Files 那一档的列表里占一行（上游给它单独的类型名）。 */
export const DIRECTORY_TYPE_NAME = '目录'

/** `FileSearchEverywhereContributor` 按虚拟文件的名字取类型：本仓 = 取扩展名，无扩展名归到「(无)」。 */
export const NO_EXTENSION_TYPE_NAME = '(无扩展名)'
export function fileTypeNameOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path
  if (!name) return DIRECTORY_TYPE_NAME
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return NO_EXTENSION_TYPE_NAME
  return name.slice(dot + 1).toLowerCase()
}

/**
 * 类型漏斗的最终判定：一条结果的文件类型有没有被关掉。
 *
 * `hiddenTypes` 是"被关掉的"那一批（`:91`），所以这里语义上是黑名单；
 * 但上游交给 `GotoModel.setFilterItems` 的是它的**补集**（`SeFilesProvider.kt:74`），
 * 那条路上"空集合 = 全拒、没设 = 全收"（`:69-72` 的注释）。两种写法在
 * "没有任何类型被关掉"这一档上结果一致，本仓按黑名单这条走（editor 存的就是它）。
 */
export function acceptsByHiddenTypes(hiddenTypes: readonly string[], typeName: string): boolean {
  return !hiddenTypes.includes(typeName)
}

// ── 存储（键名照上游）──────────────────────────────────────────────────────────────

/** `SeScopePersistentStorage.persistedScopeKey`（`SeTargetsFilterEditor.kt:95`）。 */
export function persistedScopeKey(tabId: string): string {
  return `SearchEverywhere.PersistedScope.${tabId}`
}

const PREVIEW_KEY_PREFIX = 'SearchEverywhere.Preview.'

/** 读存档（读不到 / 无 localStorage 时给 null，让调用方走回落链）。 */
export function readPersistedScope(tabId: string): string | null {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(persistedScopeKey(tabId))
    return raw === null || raw === '' ? null : raw
  } catch { return null }
}

/** 写存档：`setValue(key, scopeName)`（`:102`），存的是**名字**。 */
export function writePersistedScope(tabId: string, scopeName: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (scopeName === null) localStorage.removeItem(persistedScopeKey(tabId))
    else localStorage.setItem(persistedScopeKey(tabId), scopeName)
  } catch { /* 存不下只影响下次打开时的默认作用域。 */ }
}

/**
 * 预览开关那一档（`PreviewAction`，`SeTargetsFilterEditor.kt:73`）。
 * 上游把它持久化在 contributor 的 filter 状态里；本仓沿用同一族键名。
 */
export function readPersistedPreview(tabId: string, fallback: boolean): boolean {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(`${PREVIEW_KEY_PREFIX}${tabId}`)
    return raw === null ? fallback : raw === '1'
  } catch { return fallback }
}

export function writePersistedPreview(tabId: string, on: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(`${PREVIEW_KEY_PREFIX}${tabId}`, on ? '1' : '0')
  } catch { /* 同上。 */ }
}

