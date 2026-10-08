// Search Everywhere 的**结果去重扩展点** —— IDEA
// `com.intellij.searchEverywhereResultsEqualityProvider` 在本仓的等价物。
//
// 上游是什么（逐字开过参考树 `D:/Backup/Downloads/intellij-community-master/intellij-community-master`）：
//   · EP 声明：`platform/lang-impl/resources/intellij.platform.lang.impl.xml:237`
//     的 `<extensionPoint qualifiedName="com.intellij.searchEverywhereResultsEqualityProvider"
//     interface="com.intellij.ide.actions.searcheverywhere.SEResultsEqualityProvider" dynamic="true"/>`；
//   · 接口 `SEResultsEqualityProvider.kt`：`compareItems(newItem, alreadyFoundItems)`
//     返回三档 `SEEqualElementsActionType` —— `DoNothing`（照常收下）/ `Skip`（已有更好的展示，
//     这条丢掉）/ `Replace(toBeReplaced)`（用新的替换掉旧的）；`combine` 把多档结果合成
//     （`Skip.combine(Replace) = Replace`、`Replace.combine(Replace)` 合并替换集），
//     `composite(providers)` 取**第一个不等于 `DoNothing`** 的答案（`:71-82`）；
//   · 内置实现与注册（同 xml `:1565-1568`）：`TrivialElementsEqualityProvider` /
//     `PsiElementsEqualityProvider` / `ActionsEqualityProvider` / `OptionEqualityProvider`；
//     Java 插件另有 `JavaClassAndFileEqualityProvider`（`JavaPlugin.xml:1048`，把类与它的 .java 文件
//     合成一条）。
//
// 本仓此前：`searchEverywhereResults` 按 `item.id` 去重（`Set` 那一步），判词
// `docs/inventory/verdict-actions.md` 的 `SEResultsEqualityProvider` 行记的是
// 「无 provider 类」。按 2026-10-06 的规约（**缺失能力要暴露成与 IDEA 相同的方法给第三方插件使用**）
// 补上声明面 + 注册面 + 与上游同名的聚合问法，并把**真实消费点**接上：
// `searchEverywhereResults` 在打分排序之后逐条过一遍 provider（上游
// `MixedSearchListModel` 的 `addToSameGroup`/`replaceItems` 同一条语义：新条目问已收下的那批，
// 返回 `Skip` 就不收，返回 `Replace` 就把旧的那几条换成新的）。
//
// 与上游的如实差异：① 入参 `SearchEverywhereFoundElementInfo` 在本仓换成
// `SearchEverywhereItem`（本仓没有 `Contributor`/`Presentation` 的包装层）；
// ② 本仓 provider 的 id 由贡献者自己给（上游从 EP 描述里取）；
// ③ 没有 provider 时行为**一字不变**（本仓既有的 id 去重仍在，且是最后一刀）。
//
// 纯数据层：只 import `src/extensionPoints.ts` 与 `src/searchEverywhere.ts` 的类型，
// 不 import vue/DOM/bridge，便于 `node --test` 直测。
//
// 判据：`tests/search-everywhere-equality.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'
import type { SearchEverywhereItem } from './searchEverywhere.ts'

/**
 * EP id（逐字取自上游 `intellij.platform.lang.impl.xml:237` 的 qualifiedName）。
 */
export const SE_RESULTS_EQUALITY_PROVIDER_EP = 'com.intellij.searchEverywhereResultsEqualityProvider'

/** 三档动作（上游 `SEEqualElementsActionType` 的 `DoNothing`/`Skip`/`Replace` 逐字同名）。 */
export type SEEqualElementsActionType =
  | { kind: 'doNothing' }
  | { kind: 'skip' }
  | { kind: 'replace'; toBeReplaced: readonly SearchEverywhereItem[] }

/** `DoNothing`（上游 `object DoNothing`）。 */
export const SE_DO_NOTHING: SEEqualElementsActionType = { kind: 'doNothing' }
/** `Skip`（上游 `object Skip`）。 */
export const SE_SKIP: SEEqualElementsActionType = { kind: 'skip' }
/** `Replace`（上游 `data class Replace(val toBeReplaced: List<…>)`）。 */
export function seReplace(toBeReplaced: SearchEverywhereItem | readonly SearchEverywhereItem[]): SEEqualElementsActionType {
  return { kind: 'replace', toBeReplaced: Array.isArray(toBeReplaced) ? toBeReplaced : [toBeReplaced as SearchEverywhereItem] }
}

/**
 * 两档动作合成（上游 `SEEqualElementsActionType.combine` 逐条对位）：
 *   · `DoNothing.combine(another) = another`；
 *   · `Skip.combine(another) = if (another is Replace) another else this`；
 *   · `Replace.combine(another) = if (another is Replace) Replace(toBeReplaced + another.toBeReplaced) else this`。
 * 本仓用 `{kind}` 判别式表达，语义逐条相同。
 */
export function combineSEActions(a: SEEqualElementsActionType, b: SEEqualElementsActionType): SEEqualElementsActionType {
  if (a.kind === 'doNothing') return b
  if (a.kind === 'skip') return b.kind === 'replace' ? b : a
  // a.kind === 'replace'
  if (b.kind === 'replace') return { kind: 'replace', toBeReplaced: [...a.toBeReplaced, ...b.toBeReplaced] }
  return a
}

/**
 * 一条去重贡献（上游 `SEResultsEqualityProvider` 的方法面，名字逐字相同）。
 */
export interface SEResultsEqualityProvider {
  /** 贡献 id（本仓给，便于注销与诊断；上游从 EP 描述取）。 */
  id: string
  /**
   * 上游 `compareItems(newItem, alreadyFoundItems)`；`compareItemsCollection` 是它的
   * `Collection` 重载（本仓两者同形，只留这一个 —— 本仓的已收下那批本来就是数组）。
   */
  compareItems: (
    newItem: SearchEverywhereItem,
    alreadyFoundItems: readonly SearchEverywhereItem[],
  ) => SEEqualElementsActionType
}

/** 声明 EP（幂等：重复调用只是覆盖同名声明）。 */
export function declareSearchEverywhereEqualityExtensionPoint(): void {
  EXTENSIONS.declareExtensionPoint({
    id: SE_RESULTS_EQUALITY_PROVIDER_EP,
    name: 'SE 结果去重提供者',
    scope: APPLICATION_SCOPE,
    dynamic: true,
  })
}

/** 插件贡献一条去重提供者（等价于 plugin.xml 里的一条 `<searchEverywhereResultsEqualityProvider/>`）。 */
export function registerSearchEverywhereEqualityProvider(
  provider: SEResultsEqualityProvider,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  if (!EXTENSIONS.hasExtensionPoint(SE_RESULTS_EQUALITY_PROVIDER_EP)) declareSearchEverywhereEqualityExtensionPoint()
  return EXTENSIONS.registerExtension(SE_RESULTS_EQUALITY_PROVIDER_EP, provider.id, provider, options)
}

/** 注销一条去重贡献。返回是否真的删掉了。 */
export function unregisterSearchEverywhereEqualityProvider(id: string): boolean {
  return EXTENSIONS.unregisterExtension(SE_RESULTS_EQUALITY_PROVIDER_EP, id)
}

/** 当前 EP 上的全部去重贡献（bundled + 第三方）。 */
export function searchEverywhereEqualityProviders(scope: string = APPLICATION_SCOPE): SEResultsEqualityProvider[] {
  return EXTENSIONS.extensionsOf<SEResultsEqualityProvider>(SE_RESULTS_EQUALITY_PROVIDER_EP, scope)
}

/**
 * 聚合问法（上游 `SEResultsEqualityProvider.composite(providers)` 的 `firstOrNull { != DoNothing }`）：
 * 逐个问，**第一个不等于 `DoNothing` 的就是答案**（上游 `:71-82` 逐字如此 —— 不做合并，
 * 因为每个 provider 的判定是独立的、顺序即优先级）。没有 provider 时返回 `DoNothing`。
 */
export function compareSearchEverywhereItems(
  newItem: SearchEverywhereItem,
  alreadyFoundItems: readonly SearchEverywhereItem[],
  scope: string = APPLICATION_SCOPE,
): SEEqualElementsActionType {
  for (const provider of searchEverywhereEqualityProviders(scope)) {
    const action = provider.compareItems(newItem, alreadyFoundItems)
    if (action.kind !== 'doNothing') return action
  }
  return SE_DO_NOTHING
}

/**
 * 把一批**已排好序**的条目过一遍去重 provider（上游 `MixedSearchListModel.addToSameGroup` 的等价物：
 * 新条目问已收下的那批，`Skip` 就丢、`Replace` 就把旧的那几条摘掉）。
 * 返回去重后的列表（顺序保持；`Replace` 不会把新条目挪到被替换者的位置 —— 上游也是追加）。
 */
export function dedupeSearchEverywhereItems(
  ordered: readonly SearchEverywhereItem[],
  scope: string = APPLICATION_SCOPE,
): SearchEverywhereItem[] {
  const providers = searchEverywhereEqualityProviders(scope)
  if (!providers.length) return [...ordered]
  const kept: SearchEverywhereItem[] = []
  for (const item of ordered) {
    const action = compareSearchEverywhereItems(item, kept, scope)
    if (action.kind === 'skip') continue
    if (action.kind === 'replace') {
      const doomed = new Set(action.toBeReplaced.map(entry => entry.id))
      for (let index = kept.length - 1; index >= 0; index -= 1) {
        if (doomed.has(kept[index]!.id)) kept.splice(index, 1)
      }
    }
    kept.push(item)
  }
  return kept
}

// 模块加载即声明（与 `src/findUsagesProvider.ts` / `src/projectWidgetActionsFilter.ts` 同一约定）。
declareSearchEverywhereEqualityExtensionPoint()
