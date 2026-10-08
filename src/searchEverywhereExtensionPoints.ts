// **Search Everywhere 的扩展点**（上游 `platform/searchEverywhere` 的 `SeItemsProviderFactory` /
// `SeLegacyItemPresentationProvider` / `SeTargetPresentationProvider` /
// `SeTargetItemSelectionProcessor` 一族在本仓的等价物）。
//
// 上游是什么：Search Everywhere 这一族有四条 EP，声明在
// `platform/searchEverywhere/shared/resources/intellij.platform.searchEverywhere.xml:37-53`，
// 限定名由 `defaultExtensionNs="com.intellij"` 前缀 + 相对 `name` 得出，逐条：
//   · `com.intellij.searchEverywhere.itemsProviderFactory` —— `:37-39`，接口
//     `SeItemsProviderFactory`（`SeItemsProviderFactory.kt:16-27` 的 `EP_NAME`），方法面
//     `val id: String`（`:20`）+ `suspend fun getItemsProvider(project, dataContext): SeItemsProvider?`（`:23`）；
//   · `com.intellij.searchEverywhere.legacyItemPresentationProvider` —— `:41-43`，接口
//     `SeLegacyItemPresentationProvider`；
//   · `com.intellij.searchEverywhere.targetPresentationProvider` —— `:45-47`，接口
//     `com.intellij.platform.searchEverywhere.providers.target.presentation.SeTargetPresentationProvider`；
//   · `com.intellij.searchEverywhere.targetItemSelectionProcessor` —— `:49-53`，接口
//     `SeTargetItemSelectionProcessor`（注释写明「Ordered：每条认领自己处理的那部分、把其余传下去」）。
//
// 本仓此前：Search Everywhere 的供给者是 `src/searchEverywhere.ts` 里**硬编的
// `SearchEverywhereSource` 联合**（`'project' | 'symbols' | 'commands' | 'runConfigs' | 'text'`），
// 各档直接读宿主响应 —— **没有插件 EP 宿主**，判词 `se/providers` 一直挂着「provider 工厂没有
// 注册面」这一条。本文件补上那一层：
//   · 四条 EP 用 `src/extensionPoints.ts` 的 `EXTENSIONS.declareExtensionPoint()` 声明；
//   · 贡献形状 = 上游接口的**可移植子集**（本仓没有 `Project`/`DataContext`/`SeParams`，
//     换成 `SeQueryContext`（工作区根 + 查询串 + 语言）与 `SeItemLike`（本仓
//     `SearchEverywhereItem` 的形状同源））；
//   · 本仓那五个内建来源 **作为五条 bundled 贡献** 挂进 `itemsProviderFactory`，使
//     `contributingSources()` 从 EP 收表、第三方挂的 provider 能被真实消费点拿到。
//
// 与上游的如实差异：① `getItemsProvider` 是 `suspend` 的，本仓返回 `Promise`（也接受同步）；
// ② `SeItemsProvider.collectItems(params, collector)` 的回调式收条目在本仓换成
// `collectItems(context)` 直接返回条目数组（本仓没有 `Collector.put` 的背压语义）；
// ③ `dataContext` 换成 `SeQueryContext`；④ `Disposable` 生命周期由 EP 的注销句柄承担。
//
// 纯数据层：不 import vue/DOM/bridge，便于单测。
//
// 判据：`tests/search-everywhere-extension-points.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'
import type { SearchEverywhereItem, SearchEverywhereSource } from './searchEverywhere.ts'

/** 四条 EP 的 id（逐字取自上游 xml 的前缀 + 相对名，见文件头逐行出处）。 */
export const SE_ITEMS_PROVIDER_FACTORY_EP = 'com.intellij.searchEverywhere.itemsProviderFactory'
export const SE_LEGACY_ITEM_PRESENTATION_PROVIDER_EP = 'com.intellij.searchEverywhere.legacyItemPresentationProvider'
export const SE_TARGET_PRESENTATION_PROVIDER_EP = 'com.intellij.searchEverywhere.targetPresentationProvider'
export const SE_TARGET_ITEM_SELECTION_PROCESSOR_EP = 'com.intellij.searchEverywhere.targetItemSelectionProcessor'

/** 一次 SE 查询的上下文（上游 `Project? + DataContext + SeParams` 的可移植替代）。 */
export interface SeQueryContext {
  /** 工作区根（本仓没有 `Project`，用根路径代表作用域）。 */
  root: string
  /** 查询串。 */
  query: string
  /** 当前 tab（`all`/`classes`/...），provider 可据此决定要不要产条目。 */
  tab: string
}

/** 一个供给者（上游 `SeItemsProvider`，`SeItemsProvider.kt:20-59` 的可移植子集）。 */
export interface SeItemsProvider {
  id: string
  /** 展示名（上游 `displayName`，`:29`）。 */
  displayName: string
  /** 本仓来源档（供 `SearchEverywhereItem.source` 填）。 */
  source: SearchEverywhereSource
  /** 收集条目（上游 `suspend collectItems(params, collector)`，本仓直接返回数组）。 */
  collectItems: (context: SeQueryContext) => Promise<readonly SearchEverywhereItem[]> | readonly SearchEverywhereItem[]
}

/**
 * 上游 `SeItemsProviderFactory`（`SeItemsProviderFactory.kt:16-27`）的可移植子集。
 * `id` 必须与它产出的 provider 的 `id` 一致（上游 `:19` 的注释同口径）。
 */
export interface SeItemsProviderFactory {
  id: string
  /** 当前上下文下给一个供给者（返回 null = 这一档不参与）。 */
  getItemsProvider: (context: SeQueryContext) => SeItemsProvider | null
}

/** 上游 `SeLegacyItemPresentationProvider`：给条目一段展示面（本仓只保留副文本一格）。 */
export interface SeLegacyItemPresentationProvider {
  id: string
  /** 返回副文本（null = 不接手）。 */
  getPresentation: (id: string, item: SearchEverywhereItem) => string | null
}

/** 上游 `SeTargetPresentationProvider`：给「转到符号/文件」目标一段展示。 */
export interface SeTargetPresentationProvider {
  id: string
  /** 认领这个目标的展示吗（返回 null = 不接手）。 */
  getPresentation: (target: string, query: string) => string | null
}

/** 上游 `SeTargetItemSelectionProcessor`：认领自己那部分选择、把其余传下去（`xml:49-53` 的有序注释）。 */
export interface SeTargetItemSelectionProcessor {
  id: string
  /** 处理这一条（返回 true = 我认领了，不再往下传）。 */
  process: (target: string, query: string) => boolean
}

/** 四条 EP 的声明（幂等）。 */
export function declareSearchEverywhereExtensionPoints(): void {
  EXTENSIONS.declareExtensionPoint({ id: SE_ITEMS_PROVIDER_FACTORY_EP, name: 'SE 条目供给工厂', scope: APPLICATION_SCOPE, dynamic: true })
  EXTENSIONS.declareExtensionPoint({ id: SE_LEGACY_ITEM_PRESENTATION_PROVIDER_EP, name: 'SE 旧展示提供方', scope: APPLICATION_SCOPE, dynamic: true })
  EXTENSIONS.declareExtensionPoint({ id: SE_TARGET_PRESENTATION_PROVIDER_EP, name: 'SE 目标展示提供方', scope: APPLICATION_SCOPE, dynamic: true })
  EXTENSIONS.declareExtensionPoint({ id: SE_TARGET_ITEM_SELECTION_PROCESSOR_EP, name: 'SE 目标选择处理器', scope: APPLICATION_SCOPE, dynamic: true })
}

declareSearchEverywhereExtensionPoints()

function register<T extends { id: string }>(ep: string, value: T, options: RegisterExtensionOptions): ExtensionHandle {
  return EXTENSIONS.registerExtension(ep, value.id, value, options)
}

export function registerSeItemsProviderFactory(value: SeItemsProviderFactory, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return register(SE_ITEMS_PROVIDER_FACTORY_EP, value, options)
}
export function registerSeLegacyItemPresentationProvider(value: SeLegacyItemPresentationProvider, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return register(SE_LEGACY_ITEM_PRESENTATION_PROVIDER_EP, value, options)
}
export function registerSeTargetPresentationProvider(value: SeTargetPresentationProvider, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return register(SE_TARGET_PRESENTATION_PROVIDER_EP, value, options)
}
export function registerSeTargetItemSelectionProcessor(value: SeTargetItemSelectionProcessor, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return register(SE_TARGET_ITEM_SELECTION_PROCESSOR_EP, value, options)
}

/* ── 消费面 ───────────────────────────────────────────────────────────────── */

/** 全部供给工厂（上游 `SeItemsProviderFactory.EP_NAME.extensionList` 的等价物）。 */
export function seItemsProviderFactories(scope: string = APPLICATION_SCOPE): SeItemsProviderFactory[] {
  return EXTENSIONS.extensionsOf<SeItemsProviderFactory>(SE_ITEMS_PROVIDER_FACTORY_EP, scope)
}

/**
 * 收全表的供给者（上游 `SeItemsProviderFactory` 逐条 `getItemsProvider`，返回 null 的跳过）。
 * 去重按 provider 的 `id`（上游要求 factory.id == provider.id，同一 id 只留先出现的那条）。
 */
export function seItemsProviders(context: SeQueryContext, scope: string = APPLICATION_SCOPE): SeItemsProvider[] {
  const seen = new Set<string>()
  const out: SeItemsProvider[] = []
  for (const factory of seItemsProviderFactories(scope)) {
    const provider = factory.getItemsProvider(context)
    if (!provider || seen.has(provider.id)) continue
    seen.add(provider.id)
    out.push(provider)
  }
  return out
}

/** 本仓来源档的集合（从 EP 收，而不是硬编的联合 —— 判词里那条缺口就闭在这里）。 */
export function contributingSources(context: SeQueryContext, scope: string = APPLICATION_SCOPE): SearchEverywhereSource[] {
  const seen = new Set<SearchEverywhereSource>()
  for (const provider of seItemsProviders(context, scope)) seen.add(provider.source)
  return [...seen]
}

/** 收集某次查询的全部条目（上游 `collectItems` 的结果并起来；异步 provider 一起 await）。 */
export async function seItemsFor(context: SeQueryContext, scope: string = APPLICATION_SCOPE): Promise<SearchEverywhereItem[]> {
  const providers = seItemsProviders(context, scope)
  const collected = await Promise.all(providers.map(provider => provider.collectItems(context)))
  return collected.flatMap(items => [...items])
}

/** 副文本（取第一个非 null 的旧展示提供方；没有就退回条目自己的 `subtitle`）。 */
export function seSubtitleOf(item: SearchEverywhereItem, scope: string = APPLICATION_SCOPE): string | null {
  for (const provider of EXTENSIONS.extensionsOf<SeLegacyItemPresentationProvider>(SE_LEGACY_ITEM_PRESENTATION_PROVIDER_EP, scope)) {
    const text = provider.getPresentation(item.id, item)
    if (text !== null) return text
  }
  return item.subtitle ?? null
}

/** 目标展示（取第一个非 null 的目标展示提供方）。 */
export function seTargetPresentation(target: string, query: string, scope: string = APPLICATION_SCOPE): string | null {
  for (const provider of EXTENSIONS.extensionsOf<SeTargetPresentationProvider>(SE_TARGET_PRESENTATION_PROVIDER_EP, scope)) {
    const text = provider.getPresentation(target, query)
    if (text !== null) return text
  }
  return null
}

/** 目标选择：按 EP 顺序交给各处理器，第一个认领即停（`xml:49-53` 的有序语义）。 */
export function processSeTargetSelection(target: string, query: string, scope: string = APPLICATION_SCOPE): string | null {
  for (const processor of EXTENSIONS.extensionsOf<SeTargetItemSelectionProcessor>(SE_TARGET_ITEM_SELECTION_PROCESSOR_EP, scope)) {
    if (processor.process(target, query)) return processor.id
  }
  return null
}

/* ── bundled：本仓五个内建来源作为五条工厂贡献 ─────────────────────────────────── */

export const SE_SOURCE_PROVIDER_IDS: Readonly<Record<SearchEverywhereSource, string>> = {
  project: 'taocode.seItemsProvider.project',
  symbols: 'taocode.seItemsProvider.symbols',
  commands: 'taocode.seItemsProvider.commands',
  runConfigs: 'taocode.seItemsProvider.runConfigs',
  text: 'taocode.seItemsProvider.text',
}

/**
 * 把一个内建来源包成一条工厂贡献：`id` 与产出的 provider 一致（上游 `:19` 的要求），
 * `tabs` 限定它只在哪些 tab 里参与（本仓 `SearchEverywhereTabDef.sources` 的等价面）。
 */
export function builtinSeItemsProviderFactory(
  source: SearchEverywhereSource,
  displayName: string,
  collect: (context: SeQueryContext) => Promise<readonly SearchEverywhereItem[]> | readonly SearchEverywhereItem[],
  tabs?: readonly string[],
): SeItemsProviderFactory {
  const id = SE_SOURCE_PROVIDER_IDS[source]
  const provider: SeItemsProvider = { id, displayName, source, collectItems: collect }
  return {
    id,
    getItemsProvider: context => (tabs && !tabs.includes(context.tab)) ? null : provider,
  }
}

/** 五个内建来源的工厂表（宿主把各档的收集函数注入进来）。 */
export interface BuiltinSeSources {
  project: (context: SeQueryContext) => Promise<readonly SearchEverywhereItem[]> | readonly SearchEverywhereItem[]
  symbols: (context: SeQueryContext) => Promise<readonly SearchEverywhereItem[]> | readonly SearchEverywhereItem[]
  commands: (context: SeQueryContext) => Promise<readonly SearchEverywhereItem[]> | readonly SearchEverywhereItem[]
  runConfigs: (context: SeQueryContext) => Promise<readonly SearchEverywhereItem[]> | readonly SearchEverywhereItem[]
  text: (context: SeQueryContext) => Promise<readonly SearchEverywhereItem[]> | readonly SearchEverywhereItem[]
}

/**
 * 把本仓五个内建来源挂成五条 bundled 贡献（返回注销函数）。宿主在拿到各档收集函数之后调一次即可。
 * `all` tab 收全部五档；专用 tab 只收自己那一档（tabs 过滤器）。
 */
export function registerBundledSeItemsProviders(sources: BuiltinSeSources): () => void {
  const options: RegisterExtensionOptions = { source: 'bundled' }
  const handles = [
    registerSeItemsProviderFactory(builtinSeItemsProviderFactory('project', '文件', sources.project, ['all', 'files']), options),
    registerSeItemsProviderFactory(builtinSeItemsProviderFactory('symbols', '符号', sources.symbols, ['all', 'classes', 'symbols']), options),
    registerSeItemsProviderFactory(builtinSeItemsProviderFactory('commands', '动作', sources.commands, ['all', 'commands']), options),
    registerSeItemsProviderFactory(builtinSeItemsProviderFactory('runConfigs', '运行配置', sources.runConfigs, ['all', 'runConfigs']), options),
    registerSeItemsProviderFactory(builtinSeItemsProviderFactory('text', '文本', sources.text, ['all', 'text']), options),
  ]
  return () => { for (const handle of handles) handle.dispose() }
}
