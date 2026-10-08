// **转到 类/符号/文件 的扩展点**（上游 `com.intellij.navigation.ChooseByNameContributor` 一族
// 在本仓的等价物）。
//
// 上游是什么：三个 EP —— `com.intellij.gotoClassContributor` / `com.intellij.gotoSymbolContributor` /
// `com.intellij.gotoFileContributor`（`platform/lang-api/resources/intellij.platform.lang.xml:121-123`，
// 接口 `ChooseByNameContributor`，`dynamic="true"`）。`ChooseByNameContributor.java:26-42` 声明
// `CLASS_EP_NAME`/`SYMBOL_EP_NAME`/`FILE_EP_NAME` 三条；贡献者实现
// `isAvailableNow(project)` + `getNames(project, includeNonProject)` + `getItemsByName(name, pattern, …)`
// （`:45-70`）。LSP 侧那两条就是按这个挂进去的：
// `platform/lsp-impl/resources/intellij.platform.lsp.impl.xml:112-113` 把
// `LspGoToSymbolContributor`（不过滤 kind，`LspGoToSymbolContributor.kt:7-9`）挂 `gotoSymbolContributor`、
// 把 `LspGoToClassContributor`（只收 Class/Interface/Enum/Struct = 5/10/11/23，`:7-12`）挂
// `gotoClassContributor`；基类 `LspWorkspaceSymbolContributor.kt:52-89` 从
// `getWorkspaceSymbolsCaching(query)` 取缓存、逐条 `shouldAcceptSymbolKind`。
//
// 本仓此前：工作区符号导航直接写在 `src/lspNavigation.ts` 的 `globalSymbolEntries`/`visibleSymbols`，
// **没有插件 EP 宿主** —— 第三方（或测试）无法按 id 挂一个符号/类/文件贡献者，LSP 那条通道也不是
// 「一条贡献」，判词里这条一直挂着。本文件补上那一层：
//   · 三个 EP 用 `src/extensionPoints.ts` 的 `EXTENSIONS.declareExtensionPoint()` 声明（id 逐字
//     取自上游 qualifiedName）；
//   · 贡献者形状 = 上游 `ChooseByNameContributor` 的可移植子集（`isAvailableNow` / `getNames` /
//     `getItemsByName`），`getItemsByName` 返回的条目就是本仓的符号形状 `LspSymbolLike`；
//   · LSP 那两条 **作为 bundled 贡献注册**（`registerLspGotoContributors`），数据源是本仓的单槽
//     缓存 `src/navWorkspaceSymbolCache.ts` 的 `snapshot()` —— 与上游「先取 `getWorkspaceSymbolsCaching`
//     再 `shouldAcceptSymbolKind`」的顺序一致；因此 LSP 通道在 EP 里看得见，不是私有表。
//
// 与上游的如实差异：本仓的 `getItemsByName` 是**同步**的（数据来自本地缓存/本地表），没有
// `Processor`/`FindSymbolParameters`/`IdFilter` 那套平台回调（那是平台 ChooseByName 的载体）；
// `includeNonProjectItems` 也收成缺省（本仓没有库与工程的搜索范围对象）。
//
// 判据：`tests/goto-by-name-contributors.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'
import { dedupeSymbols, isClassLikeSymbol, type LspSymbolLike } from './lspSymbolBridge.ts'
// 转到文件的自定义器（`com.intellij.gotoFileCustomizer`）：声明与出处见
// `src/ideShellExtensionPoints.ts`，`gotoByNameContributions` 的 `file` 那一档是它的消费点。
import { filterGotoFileItems } from './ideShellExtensionPoints.ts'

/** 三个 EP 的 id（逐字取自上游 `ChooseByNameContributor.java:26-28` 的 `ExtensionPointName.create`）。 */
export const GOTO_CLASS_EP = 'com.intellij.gotoClassContributor'
export const GOTO_SYMBOL_EP = 'com.intellij.gotoSymbolContributor'
export const GOTO_FILE_EP = 'com.intellij.gotoFileContributor'

/** 一次导航查询落在哪张表（与三个 EP、与调用方的 `mode` 一一对应）。 */
export type GotoByNameModel = 'class' | 'symbol' | 'file'

const MODEL_EP: Record<GotoByNameModel, string> = {
  class: GOTO_CLASS_EP,
  symbol: GOTO_SYMBOL_EP,
  file: GOTO_FILE_EP,
}

/** 模型 → EP id（未知模型按符号档，与 `mergeWorkspaceSymbols` 的缺省 `mode: 'symbol'` 同口径）。 */
export function gotoByNameExtensionPoint(model: GotoByNameModel): string {
  return MODEL_EP[model] ?? GOTO_SYMBOL_EP
}

/**
 * 一条贡献（上游 `ChooseByNameContributor` 的可移植子集）。
 *   · `isAvailableNow` ↔ 上游同名方法（`:45-50`）—— 平台据此决定要不要显示那一档；
 *   · `getNames` ↔ `getNames(project, includeNonProjectItems)`（`:56`），本仓可选
 *     （只有需要预取名字的消费方会读它，`visibleSymbols` 不读）；
 *   · `getItemsByName` ↔ `getItemsByName(name, pattern, …)`（`:68`），**必有**：无它这条贡献产不出条目。
 */
export interface GotoByNameContributor {
  id: string
  model: GotoByNameModel
  isAvailableNow?: () => boolean
  getNames?: () => readonly string[]
  getItemsByName: (name: string, pattern: string) => readonly LspSymbolLike[]
}

/** 三个 EP 的声明（幂等：重复调用只覆盖同名声明）。 */
export function declareGotoByNameExtensionPoints(): void {
  EXTENSIONS.declareExtensionPoint({ id: GOTO_CLASS_EP, name: '转到类贡献者', scope: APPLICATION_SCOPE, dynamic: true })
  EXTENSIONS.declareExtensionPoint({ id: GOTO_SYMBOL_EP, name: '转到符号贡献者', scope: APPLICATION_SCOPE, dynamic: true })
  EXTENSIONS.declareExtensionPoint({ id: GOTO_FILE_EP, name: '转到文件贡献者', scope: APPLICATION_SCOPE, dynamic: true })
}

declareGotoByNameExtensionPoints()

/** 按 id 注册一条贡献（同 id 覆盖，与 `ExtensionPointHost.registerExtension` 同口径）。 */
export function registerGotoByNameContributor(
  contributor: GotoByNameContributor,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return EXTENSIONS.registerExtension(gotoByNameExtensionPoint(contributor.model), contributor.id, contributor, options)
}

/** 注销一条贡献（返回是否真的删掉了）。 */
export function unregisterGotoByNameContributor(model: GotoByNameModel, id: string): boolean {
  return EXTENSIONS.unregisterExtension(gotoByNameExtensionPoint(model), id)
}

/**
 * 某张表在当前作用域下的全部贡献（已按 `LoadingOrder` 排好）。
 * 按 `model` 再滤一次：EP 本身已分表，但贡献者自己声明的 `model` 与所挂 EP 不一致时以它为准，
 * 免得一条误挂的贡献污染另一张表。
 */
export function gotoByNameContributors(model: GotoByNameModel, scope: string = APPLICATION_SCOPE): GotoByNameContributor[] {
  return EXTENSIONS.extensionsOf<GotoByNameContributor>(gotoByNameExtensionPoint(model), scope)
    .filter(contributor => contributor.model === model)
}

/**
 * 把某张表全部贡献的条目合成一份（去掉不可用贡献、去重）。
 * 上游把各贡献者的 `getItemsByName` 结果逐个交给平台再统一去重；本仓在合并处用
 * `dedupeSymbols`（同一位置 + 同名 + 同 kind 视为一条，见 `src/lspSymbolBridge.ts`）。
 * `isAvailableNow` 为假或没给（缺省可用，照上游 `:47-49` `return true`）的贡献都参与。
 */
export function gotoByNameContributions(
  model: GotoByNameModel,
  name: string,
  pattern: string,
  scope: string = APPLICATION_SCOPE,
): LspSymbolLike[] {
  const out: LspSymbolLike[] = []
  for (const contributor of gotoByNameContributors(model, scope)) {
    if (contributor.isAvailableNow && !contributor.isAvailableNow()) continue
    out.push(...contributor.getItemsByName(name, pattern))
  }
  const merged = dedupeSymbols(out)
  if (model !== 'file') return merged
  // `com.intellij.gotoFileCustomizer`（声明与出处见 `src/ideShellExtensionPoints.ts`）：
  // 「转到文件」这一档再过一遍 `isAccepted(project, item)`（上游 `GotoFileModel` 取条目时逐个问，
  // `GotoFileCustomizer.java:40` 缺省 true）。本仓的符号条目没有 `isDirectory` 那一格，
  // 按「不是目录」喂进去（「转到文件」这一档的条目本来就是文件）。没有贡献时
  // `filterGotoFileItems` 原样返回 ⇒ 既有条目一条不少。
  const accepted = new Set(filterGotoFileItems({
    path: '', language: '',
    items: merged.map(symbol => ({ path: symbol.path, name: symbol.name, directory: false })),
  }).map(item => `${item.path}\u0000${item.name}`))
  return merged.filter(symbol => accepted.has(`${symbol.path}\u0000${symbol.name}`))
}

/* ── bundled：LSP 的 workspace/symbol 通道作为两条贡献 ─────────────────────────── */

/** LSP 贡献者的数据源：就是本仓的单槽工作区符号缓存（`src/navWorkspaceSymbolCache.ts`）。 */
export interface WorkspaceSymbolSource {
  /** 当前缓存里的符号（空数组 = 没查过/已清）。 */
  snapshot(): readonly LspSymbolLike[]
}

/** 两条 LSP 贡献的 id（上游按类名，本仓按 `模型.来源` 的短名）。 */
export const LSP_GOTO_SYMBOL_ID = 'lsp.gotoSymbol'
export const LSP_GOTO_CLASS_ID = 'lsp.gotoClass'

/**
 * `LspGoToSymbolContributor` 的等价物：不过滤 kind（`LspGoToSymbolContributor.kt:7-9`）。
 * `getItemsByName` 忽略 `name`/`pattern` 直接交回缓存快照 —— 与上游基类「`processElementsWithName`
 * 里用 `name` 当查询再 `getWorkspaceSymbolsCaching(name)`」同效，因为本仓缓存的**键就是查询串**
 * （单槽），调用方拿到的快照已经是按当前查询算好的那一份。
 */
export function lspGotoSymbolContributor(source: WorkspaceSymbolSource): GotoByNameContributor {
  return {
    id: LSP_GOTO_SYMBOL_ID,
    model: 'symbol',
    isAvailableNow: () => source.snapshot().length > 0,
    getItemsByName: () => source.snapshot(),
  }
}

/**
 * `LspGoToClassContributor` 的等价物：只收四类（`LspGoToClassContributor.kt:7-12`，
 * 与 `src/lspSymbolBridge.ts` 的 `CLASS_LIKE_SYMBOL_KINDS` 同源）。缓存里存的是**原始应答**，
 * 收窄在缓存之后 —— 逐条对上 `LspWorkspaceSymbolContributor.kt:73` 先取缓存、`:86` 再过滤。
 */
export function lspGotoClassContributor(source: WorkspaceSymbolSource): GotoByNameContributor {
  return {
    id: LSP_GOTO_CLASS_ID,
    model: 'class',
    isAvailableNow: () => source.snapshot().some(isClassLikeSymbol),
    getItemsByName: () => source.snapshot().filter(isClassLikeSymbol),
  }
}

/**
 * 把 LSP 那两条按 bundled 贡献挂进 EP（返回注销句柄）。宿主在持有缓存之后调用一次即可；
 * 重复调用只是覆盖同 id 的旧贡献（`registerExtension` 的口径）。
 */
export function registerLspGotoContributors(source: WorkspaceSymbolSource, scope?: string): () => void {
  const options: RegisterExtensionOptions = { source: 'bundled', ...(scope ? { scope } : {}) }
  const symbol = registerGotoByNameContributor(lspGotoSymbolContributor(source), options)
  const klass = registerGotoByNameContributor(lspGotoClassContributor(source), options)
  return () => { symbol.dispose(); klass.dispose() }
}
