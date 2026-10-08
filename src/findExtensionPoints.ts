// **查找/替换与用法视图的扩展点宿主** —— 上游 `find` 域四条 EP 在本仓的等价物。
//
// 上游是什么（逐字开过参考树 `D:/Backup/Downloads/intellij-community-master/intellij-community-master`）：
//   · `com.intellij.findInProjectExtension` —— `intellij.platform.lang.impl.xml:261`
//     （`interface="com.intellij.find.impl.FindInProjectExtension" dynamic="true"`）。接口
//     `FindInProjectExtension.kt`：`initModelFromContext(model, dataContext): Boolean`（缺省 false，
//     返回 true = 它改过 `FindModel`）+ `getFilteredNamedScopes(project): List<NamedScope>`（缺省空表）。
//     上游消费点 `FindInProjectUtil`/`FindPopupPanel` 建 `FindModel` 时逐个问。
//   · `com.intellij.findInDirectoryScopeProvider` —— `intellij.platform.lang.impl.xml:208`
//     （`interface="com.intellij.find.impl.FindInDirectoryScopeProvider" dynamic="true"`）。
//     接口 `FindInDirectoryScopeProvider.kt`：`alterDirectorySearchScope(project, dir,
//     withSubdirectories, previousSearchScope): GlobalSearchScope` —— 「在目录中查找」把搜索范围
//     交出去让插件改写（例如限制到某种文件类型）。
//   · `com.intellij.lang.findUsagesProvider` —— 已由 `src/findUsagesProvider.ts` 承载
//     （按语言给 `getType`/`getDescriptiveName`/`canFindUsagesFor`），不在本文件重复。
//   · `com.intellij.findUsagesHandlerFactory` / `com.intellij.customUsageSearcher` ——
//     `platform/lang-impl/resources/intellij.platform.lang.impl.xml:272-273`
//     （`area="IDEA_PROJECT"` 的 `FindUsagesHandlerFactory`、`CustomUsageSearcher`）。
//     这两个都是 **PSI 专属**：`FindUsagesHandlerFactory.java:4` 与 `CustomUsageSearcher.java:19`
//     直接吃 `PsiElement`/`PsiReference`，本仓的 Java 走 jdtls 的 LSP `references`
//     （`src/semanticActions.ts` 那条通道），**没有 PSI 可传** ⇒ 不落（判词 `[-]` 维持）。
//
// 本仓此前：`FindInProjectExtension` / `FindInDirectoryScopeProvider` 两条判 `[-]`，理由是
// 「本仓没有插件运行时 / 没有对应承载面」。按 2026-10-06 的规约（**缺失能力要暴露成与 IDEA
// 相同的方法给第三方插件使用**）补上声明面 + 注册面 + 同名聚合问法，并把**真实消费点**接上：
//   · `initModelFromContext` 的等价物 = `applyFindModelExtensions(model)` —— 在「在文件中查找」
//     打开 / 重跑之前让插件改写这次搜索的模型（`src/components/SearchPanel.vue` 建模型那一步）；
//   · `getFilteredNamedScopes` 的等价物 = `filterNamedScopes(scopes)` —— 喂给作用域下拉
//     （`src/findScopeSelection.ts` 的 `resolveScopeSelection` 是它下游）；
//   · `alterDirectorySearchScope` 的等价物 = `alterDirectorySearchScope(scope, dir, withSubdirectories)`
//     —— 「在目录中查找」把范围交给插件改写（`src/searchExclusions.ts` 的排除规则同一处消费）。
//
// 与上游的如实差异：① `FindModel` 在本仓是 `FindModelLike`（面板那一组字段：查询串 / 大小写 /
// 整词 / 正则 / 范围名 / 目录），没有 Swing `FindModel` 的其余字段；② `DataContext` 换成
// `FindContextLike`（工作区根 + 当前文件 + 当前选区）；③ `GlobalSearchScope` 换成
// `DirectorySearchScope`（目录 + 是否含子目录 + 已解析的作用域集合）；④ provider 的 id 由贡献者给。
//
// 纯数据层：只 import `src/extensionPoints.ts` 与 `src/scopes.ts` 的类型，不 import vue/DOM/bridge，
// 便于 `node --test` 直测。
//
// 判据：`tests/find-extension-points.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'
import type { ScopeSet } from './scopes.ts'

/** 两条 EP 的 id（逐字取自上游 xml 的 qualifiedName，见文件头逐行出处）。 */
export const FIND_IN_PROJECT_EXTENSION_EP = 'com.intellij.findInProjectExtension'
export const FIND_IN_DIRECTORY_SCOPE_PROVIDER_EP = 'com.intellij.findInDirectoryScopeProvider'

/** 一次查找的模型（上游 `FindModel` 的可移植子集：面板上那几格）。 */
export interface FindModelLike {
  /** 查询串。 */
  text: string
  /** 大小写敏感（上游 `FindModel.isCaseSensitive()`）。 */
  caseSensitive: boolean
  /** 全字匹配（上游 `isWholeWordsOnly()`）。 */
  wholeWords: boolean
  /** 正则（上游 `isRegularExpressions()`）。 */
  regex: boolean
  /** 范围名（上游 `getCustomScopeName()`；空串 = 项目）。 */
  scopeName: string
  /** 「在目录中查找」的那个目录（上游 `getDirectoryName()`；空串 = 不是目录搜索）。 */
  directory: string
}

/** 一次查找的上下文（上游 `DataContext` 的可移植子集）。 */
export interface FindContextLike {
  /** 工作区根（本仓没有 `Project`）。 */
  root: string
  /** 当前打开的文件路径（没有就是空串）。 */
  path: string
  /** 当前选区的文本（没有选区就是空串）—— 上游 `FindInProjectExtension` 从 `CommonDataKeys.SELECTED_TEXT` 取。 */
  selectedText: string
}

/** 一个命名作用域（上游 `NamedScope` 的名字 + 模式）。 */
export interface NamedScopeLike {
  name: string
  pattern: string
}

/**
 * 「在目录中查找」的搜索范围（上游 `GlobalSearchScope` 的可移植子集）。
 * `set` 为 null = 不限定（项目全部文件）；`invalid` 那档（坏模式）由调用方在解析层表达。
 */
export interface DirectorySearchScope {
  /** 目录路径（空串 = 不是目录搜索）。 */
  directory: string
  /** 是否含子目录（上游 `alterDirectorySearchScope` 的第三个入参）。 */
  withSubdirectories: boolean
  /** 已解析的作用域集合；null = 不限定。 */
  set: ScopeSet | null
}

/**
 * 一条「在文件中查找」扩展（上游 `FindInProjectExtension` 的方法面，名字逐字相同）。
 * 两个方法都可选（上游是带缺省实现的接口方法）。
 */
export interface FindInProjectExtension {
  id: string
  /** 上游 `initModelFromContext(model, dataContext)`：返回 true = 它改过模型。 */
  initModelFromContext?: (model: FindModelLike, context: FindContextLike) => boolean
  /** 上游 `getFilteredNamedScopes(project)`：把不该出现在下拉里的作用域滤掉。 */
  getFilteredNamedScopes?: (context: FindContextLike) => readonly NamedScopeLike[]
}

/** 一条「在目录中查找」范围改写者（上游 `FindInDirectoryScopeProvider` 的方法面，名字逐字相同）。 */
export interface FindInDirectoryScopeProvider {
  id: string
  /** 上游 `alterDirectorySearchScope(project, dir, withSubdirectories, previousSearchScope)`。 */
  alterDirectorySearchScope: (
    scope: DirectorySearchScope,
    context: FindContextLike,
  ) => DirectorySearchScope
}

declareBundledExtensionPoints()

/** 两条 EP 的声明（模块加载即声明，第三方按同一 id 挂贡献）。 */
function declareBundledExtensionPoints(): void {
  EXTENSIONS.declareExtensionPoint({
    id: FIND_IN_PROJECT_EXTENSION_EP, name: '在文件中查找扩展',
    scope: APPLICATION_SCOPE, dynamic: true,
  })
  EXTENSIONS.declareExtensionPoint({
    id: FIND_IN_DIRECTORY_SCOPE_PROVIDER_EP, name: '在目录中查找范围改写',
    scope: APPLICATION_SCOPE, dynamic: true,
  })
}

/** 声明一条 EP（幂等；第三方独立使用本模块时可先声明）。 */
export function declareFindExtensionPoints(): void {
  if (!EXTENSIONS.hasExtensionPoint(FIND_IN_PROJECT_EXTENSION_EP)) declareBundledExtensionPoints()
  else if (!EXTENSIONS.hasExtensionPoint(FIND_IN_DIRECTORY_SCOPE_PROVIDER_EP)) declareBundledExtensionPoints()
}

/** 插件贡献一条「在文件中查找」扩展。 */
export function registerFindInProjectExtension(
  extension: FindInProjectExtension,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  declareFindExtensionPoints()
  return EXTENSIONS.registerExtension(FIND_IN_PROJECT_EXTENSION_EP, extension.id, extension, options)
}

/** 注销一条「在文件中查找」扩展。 */
export function unregisterFindInProjectExtension(id: string): boolean {
  return EXTENSIONS.unregisterExtension(FIND_IN_PROJECT_EXTENSION_EP, id)
}

/** 当前 EP 上的全部「在文件中查找」扩展（bundled + 第三方）。 */
export function findInProjectExtensions(scope: string = APPLICATION_SCOPE): FindInProjectExtension[] {
  return EXTENSIONS.extensionsOf<FindInProjectExtension>(FIND_IN_PROJECT_EXTENSION_EP, scope)
}

/** 插件贡献一条「在目录中查找」范围改写者。 */
export function registerFindInDirectoryScopeProvider(
  provider: FindInDirectoryScopeProvider,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  declareFindExtensionPoints()
  return EXTENSIONS.registerExtension(FIND_IN_DIRECTORY_SCOPE_PROVIDER_EP, provider.id, provider, options)
}

/** 注销一条「在目录中查找」范围改写者。 */
export function unregisterFindInDirectoryScopeProvider(id: string): boolean {
  return EXTENSIONS.unregisterExtension(FIND_IN_DIRECTORY_SCOPE_PROVIDER_EP, id)
}

/** 当前 EP 上的全部范围改写者（bundled + 第三方）。 */
export function findInDirectoryScopeProviders(scope: string = APPLICATION_SCOPE): FindInDirectoryScopeProvider[] {
  return EXTENSIONS.extensionsOf<FindInDirectoryScopeProvider>(FIND_IN_DIRECTORY_SCOPE_PROVIDER_EP, scope)
}

/**
 * 上游 `FindInProjectExtension.initModelFromContext` 的聚合问法：
 * 逐个问，**任一条返回 true 就认为模型被改过**（上游 `FindInProjectUtil` 的 `any { it.… }` 同口径）。
 * 没有 provider 时模型一字不动。
 */
export function applyFindModelExtensions(
  model: FindModelLike,
  context: FindContextLike,
  scope: string = APPLICATION_SCOPE,
): { model: FindModelLike; changed: boolean } {
  let current = model
  let changed = false
  for (const extension of findInProjectExtensions(scope)) {
    if (!extension.initModelFromContext) continue
    if (extension.initModelFromContext(current, context)) changed = true
  }
  return { model: current, changed }
}

/**
 * 上游 `FindInProjectExtension.getFilteredNamedScopes` 的聚合问法：
 * **每一条贡献都能再滤一层**（按顺序把上一层的输出喂给下一层，与上游"每个扩展返回自己的那份"不同 ——
 * 本仓的语义是"层层过滤"，更保守：后挂的只能收窄，不能凭空造作用域）。
 * 没有任何贡献时原样返回。
 */
export function filterNamedScopes(
  scopes: readonly NamedScopeLike[],
  context: FindContextLike,
  scope: string = APPLICATION_SCOPE,
): NamedScopeLike[] {
  let current = [...scopes]
  for (const extension of findInProjectExtensions(scope)) {
    if (!extension.getFilteredNamedScopes) continue
    const allowed = new Set(extension.getFilteredNamedScopes(context).map(entry => entry.name))
    current = current.filter(entry => allowed.has(entry.name))
  }
  return current
}

/**
 * 上游 `FindInDirectoryScopeProvider.alterDirectorySearchScope` 的聚合问法：
 * 逐个改写（前一个的输出是后一个的输入 —— 上游也是把 `previousSearchScope` 传下去），
 * 返回改写后的范围。没有 provider 时原样返回。
 */
export function alterDirectorySearchScope(
  initial: DirectorySearchScope,
  context: FindContextLike,
  scope: string = APPLICATION_SCOPE,
): DirectorySearchScope {
  let current = initial
  for (const provider of findInDirectoryScopeProviders(scope)) {
    current = provider.alterDirectorySearchScope(current, context)
  }
  return current
}
