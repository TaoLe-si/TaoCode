// 查找用法的**按语言 provider 层** —— 上游 `platform/indexing-api/src/com/intellij/lang/findUsages/`
// 一族在本仓的等价物（`FindUsagesProvider`/`LanguageFindUsages`/`DescriptiveNameUtil`/
// `EmptyFindUsagesProvider`）。
//
// 上游是什么（逐条核过）：
//   · `FindUsagesProvider.java:22-86` 六个问法：`getWordsScanner`（词索引扫描器）、
//     `canFindUsagesFor`（这个元素值不值得搜）、`getHelpId`、`getType`（用户可见的**元素类型标签**，
//     如 "class"/"method"，不上首字母大写）、`getDescriptiveName`（展开名，类给全限定名、
//     方法给带参数的签名）、`getNodeText(element, useFullName)`（用法树里那一行的文本）。
//   · `LanguageFindUsages.java:11-31`：按语言取 provider 列表，**一个都没有时退
//     `EmptyFindUsagesProvider`**（`:21-27` 的 `allForLanguage`）；`:33-95` 的五个静态问法是
//     「遍历 provider，取第一个不等于默认值的答案」（`getFromProviders`，`:88-99`）。
//   · `EmptyFindUsagesProvider.java:20-40`：`canFindUsagesFor` 恒 false、`getType` 空串、
//     `getNodeText` 取 `PsiNamedElement.getName()`、`getDescriptiveName` = `getNodeText(element, true)`。
//   · `DescriptiveNameUtil.java:14-33`：描述名先问 `PsiMetaData`（`:18-22`）、再判 `PsiFile`（`:25-27`）、
//     最后才落 `LanguageFindUsages.getDescriptiveName`（`:31`）。
//   · `UsageSearchContext.java:19-48` 五个位：IN_CODE 0x1 / IN_COMMENTS 0x2 / IN_STRINGS 0x4 /
//     IN_FOREIGN_LANGUAGES 0x8 / IN_PLAIN_TEXT 0x10 / ANY 0xFF。
//
// **本仓的等价交换**：没有 PSI，元素的种类来自 LSP —— 声明处的 `documentSymbol` 给出
// `SymbolKind`（编号 → 名字见 `src/lspSymbolBridge.ts:50-56`），容器名来自符号的
// `containerName`。所以 `getType` 取那个 kind 的中文类型名，`getNodeText` 取名字，
// `getDescriptiveName` 在容器名非空时给 `Container.name`（上游类给全限定名同一方向），
// 否则就是名字本身。**没有**语言专属的签名拼装（上游方法给带参数的签名 —— LSP 的 `detail`
// 是服务端自定义的，只有以 `(` 开头那一串才是参数表，见 `src/usageViewGrouping.ts:176-180`）。
//
// 消费链路：`src/semanticActions.ts` 的引用搜索用 `usageViewTarget()` 算出的描述名与类型标签
// 上标签/面板标题（上游 `FindUsagesManager.createPresentation` 的 `{0} of {1}` 与 `{0} in {1}`
// 两处文案里那个 `{1}` 就是这里的描述名）；`getWordsScanner` 的等价物是宿主
// `file.usages` 的整工作区文本扫描（`native/file_queries.cpp`）。
//
// 判据：`tests/find-usages-provider.test.mjs`。

import { SYMBOL_KIND_NAMES } from './lspSymbolBridge.ts'
import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'

/**
 * EP id（逐字取自上游 `platform/indexing-api/resources/intellij.platform.indexing.xml:18` 的
 * `qualifiedName="com.intellij.lang.findUsagesProvider"`，`beanClass=LanguageExtensionPoint` `dynamic="true"`）。
 * 上游 `LanguageFindUsages` 就是从这个 EP 按语言取 provider 列表；插件的
 * `<com.intellij.lang.findUsagesProvider language="…" implementation="…"/>` 在这里是
 * `registerFindUsagesProvider()` / `registerFindUsagesProviderExtension()`。
 */
export const FIND_USAGES_PROVIDER_EP = 'com.intellij.lang.findUsagesProvider'

/** 声明 EP（幂等）。 */
export function declareFindUsagesProviderExtensionPoint(): void {
  EXTENSIONS.declareExtensionPoint({ id: FIND_USAGES_PROVIDER_EP, name: '查找用法 provider', scope: APPLICATION_SCOPE, dynamic: true })
}

/** 插件贡献一个按语言的查找用法 provider（等价于上游 plugin.xml 的一条 EP 贡献）。 */
export function registerFindUsagesProviderExtension(provider: FindUsagesProvider, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return EXTENSIONS.registerExtension(FIND_USAGES_PROVIDER_EP, provider.id, provider, options)
}

/** 注销一条 provider 贡献。 */
export function unregisterFindUsagesProviderExtension(id: string): boolean {
  return EXTENSIONS.unregisterExtension(FIND_USAGES_PROVIDER_EP, id)
}

/** 当前 EP 上的全部 provider（bundled + 第三方）。 */
export function findUsagesProvidersFromExtensions(scope: string = APPLICATION_SCOPE): FindUsagesProvider[] {
  return EXTENSIONS.extensionsOf<FindUsagesProvider>(FIND_USAGES_PROVIDER_EP, scope)
}

/** `UsageSearchContext.java:19-48` 的五个位（数值逐字照抄）。 */
export const USAGE_SEARCH_CONTEXT = {
  IN_CODE: 0x1,
  IN_COMMENTS: 0x2,
  IN_STRINGS: 0x4,
  IN_FOREIGN_LANGUAGES: 0x8,
  IN_PLAIN_TEXT: 0x10,
  ANY: 0xff,
} as const

/** 这个元素值不值得搜（上游 `canFindUsagesFor`）。 */
export interface FindUsagesElement {
  /** 元素名（`PsiNamedElement.getName()` 的等价物）。 */
  name: string
  /** 元素类型标签（本仓是 LSP `SymbolKind`；缺省 0 = 认不出）。 */
  kind?: number
  /** 所在容器名（类/模块），上游描述名里那一截。 */
  containerName?: string
  /** 语言 id（本仓的编辑器语言档，如 `typescript`/`java`）。 */
  language?: string
  /** 这个元素是一个文件吗（`DescriptiveNameUtil:25-27` 的 `PsiFile` 那一档）。 */
  isFile?: boolean
}

export interface FindUsagesProvider {
  id: string
  /** 适用语言（空 = 全部）。 */
  languages?: readonly string[]
  canFindUsagesFor?: (element: FindUsagesElement) => boolean
  getType?: (element: FindUsagesElement) => string
  getDescriptiveName?: (element: FindUsagesElement) => string
  getNodeText?: (element: FindUsagesElement, useFullName: boolean) => string
  getHelpId?: (element: FindUsagesElement) => string | null
  /** 这个词法扫描位（`getWordsScanner` 的等价物：本仓按 `UsageSearchContext` 报可搜的区）。 */
  searchContext?: number
}

/** LSP `SymbolKind` 编号 → 中文类型标签（上游 `getType` 给的就是这类词，不上首字母大写）。 */
export const SYMBOL_KIND_TYPE_LABELS: Record<number, string> = {
  1: '文件', 2: '模块', 3: '命名空间', 4: '包', 5: '类', 6: '方法', 7: '属性',
  8: '字段', 9: '构造器', 10: '枚举', 11: '接口', 12: '函数', 13: '变量',
  14: '常量', 15: '字符串', 16: '数字', 17: '布尔', 18: '数组', 19: '对象', 20: '键',
  21: '空', 22: '枚举成员', 23: '结构体', 24: '事件', 25: '运算符', 26: '类型参数',
}

/** `EmptyFindUsagesProvider.getNodeText`（`:36-43`）：有名字给名字，`useFullName` 时带容器名。 */
function defaultNodeText(element: FindUsagesElement, useFullName: boolean): string {
  if (!element.name) return ''
  // 上游方法给的是带参数的签名；LSP 的 `detail` 只有以 `(` 开头那一串才是参数表，
  // 本仓这里拿不到 `detail`（描述名在搜索开始时算），所以只给 `Container.name`。
  return useFullName && element.containerName ? `${element.containerName}.${element.name}` : element.name
}

/** `EmptyFindUsagesProvider`（`EmptyFindUsagesProvider.java:16-40`）：找不到语言 provider 时兜底。 */
export const EMPTY_FIND_USAGES_PROVIDER: FindUsagesProvider = {
  id: 'empty',
  canFindUsagesFor: () => false,
  getType: () => '',
  getDescriptiveName: element => defaultNodeText(element, true),
  getNodeText: defaultNodeText,
  getHelpId: () => null,
  searchContext: USAGE_SEARCH_CONTEXT.IN_CODE | USAGE_SEARCH_CONTEXT.IN_COMMENTS | USAGE_SEARCH_CONTEXT.IN_STRINGS,
}

/** 通用 provider（本仓所有语言的等价物）：种类来自 LSP `SymbolKind`，描述名带容器名。 */
export const DEFAULT_FIND_USAGES_PROVIDER: FindUsagesProvider = {
  id: 'lsp',
  canFindUsagesFor: element => Boolean(element.name),
  getType: element => SYMBOL_KIND_TYPE_LABELS[element.kind ?? 0] ?? '',
  getDescriptiveName: element => defaultNodeText(element, true),
  getNodeText: defaultNodeText,
  getHelpId: () => null,
  searchContext: USAGE_SEARCH_CONTEXT.IN_CODE | USAGE_SEARCH_CONTEXT.IN_COMMENTS | USAGE_SEARCH_CONTEXT.IN_STRINGS,
}

const registry = new Map<string, FindUsagesProvider>()
const byLanguage = new Map<string, FindUsagesProvider[]>()

/**
 * `LanguageFindUsages` 的注册面（上游挂 `com.intellij.lang.findUsagesProvider` EP）。
 * 同时写进本地按语言表**和** EP（EP 是第三方可见面：`providersForLanguage` 会合并 EP 贡献）。
 */
export function registerFindUsagesProvider(provider: FindUsagesProvider): void {
  registry.set(provider.id, provider)
  for (const language of provider.languages ?? []) {
    const list = byLanguage.get(language) ?? []
    if (!list.some(entry => entry.id === provider.id)) list.push(provider)
    byLanguage.set(language, list)
  }
  // 声明后再挂：本模块在 import 时声明 EP（见文件尾），这里若 EP 未声明则跳过（避免抛错）。
  if (EXTENSIONS.hasExtensionPoint(FIND_USAGES_PROVIDER_EP))
    EXTENSIONS.registerExtension(FIND_USAGES_PROVIDER_EP, provider.id, provider, { source: 'bundled' })
}

export function registeredFindUsagesProviders(): FindUsagesProvider[] {
  return [...registry.values()]
}

/**
 * `LanguageFindUsages.allForLanguage`（`:17-29`）：语言专属的 provider 在前，
 * **一个都没有时退 `EmptyFindUsagesProvider`**；总是把通用 provider 排在最后兜底。
 * 语言专属那一档 = 本地按语言表 + EP 上 `languages` 命中该语言的第三方贡献（按 id 去重）。
 */
export function providersForLanguage(language: string | undefined): FindUsagesProvider[] {
  const specific: FindUsagesProvider[] = language ? [...(byLanguage.get(language) ?? [])] : []
  for (const provider of findUsagesProvidersFromExtensions()) {
    if (provider.id === DEFAULT_FIND_USAGES_PROVIDER.id) continue
    if (!provider.languages) continue
    if (!language || !provider.languages.includes(language)) continue
    if (!specific.some(entry => entry.id === provider.id)) specific.push(provider)
  }
  return specific.length ? [...specific, DEFAULT_FIND_USAGES_PROVIDER] : [DEFAULT_FIND_USAGES_PROVIDER]
}

/** `LanguageFindUsages.getFromProviders`（`:88-99`）：遍历取第一个不等于默认值的答案。 */
function fromProviders<T>(language: string | undefined, fallback: T, getter: (provider: FindUsagesProvider) => T | null | undefined): T {
  for (const provider of providersForLanguage(language)) {
    const result = getter(provider)
    if (result !== null && result !== undefined && result !== fallback) return result
  }
  return fallback
}

/** `LanguageFindUsages.canFindUsagesFor`（`:34-36`）。 */
export function canFindUsagesFor(element: FindUsagesElement): boolean {
  return fromProviders(element.language, false, provider => provider.canFindUsagesFor?.(element))
}

/** `LanguageFindUsages.getType`（`:64-66`）。 */
export function findUsagesType(element: FindUsagesElement): string {
  return fromProviders(element.language, '', provider => provider.getType?.(element))
}

/** `LanguageFindUsages.getDescriptiveName`（`:57-59`）。 */
export function providerDescriptiveName(element: FindUsagesElement): string {
  return fromProviders(element.language, '', provider => provider.getDescriptiveName?.(element))
}

/** `LanguageFindUsages.getNodeText`（`:71-73`）。 */
export function findUsagesNodeText(element: FindUsagesElement, useFullName: boolean): string {
  return fromProviders(element.language, '', provider => provider.getNodeText?.(element, useFullName))
}

/** `LanguageFindUsages.getHelpId`（`:78-80`）。 */
export function findUsagesHelpId(element: FindUsagesElement): string | null {
  return fromProviders(element.language, null, provider => provider.getHelpId?.(element))
}

/**
 * `DescriptiveNameUtil.getDescriptiveName`（`:18-33`）：
 * 元数据名 → 文件名 → provider 描述名。本仓没有 `PsiMetaData`，但**文件名那一档在**：
 * 元素是文件时直接给文件名（`:25-27` 的 `PsiFile.getName()`），其余落 provider。
 */
export function descriptiveNameFor(element: FindUsagesElement): string {
  if (element.isFile) return element.name
  return providerDescriptiveName(element)
}

/**
 * `FindUsagesProvider.getWordsScanner` 的等价物：这个词在哪些区里可搜。
 * 本仓的文本扫描（宿主 `file.usages`）按 `src/nonCodeUsages.ts` 的注释/字符串分类，
 * 所以这一位只决定**要不要把注释/字符串里的出现算进结果**（上游 `FindUsagesOptions` 的两个开关同源）。
 */
export function usageSearchContextFor(element: FindUsagesElement): number {
  return fromProviders(element.language, USAGE_SEARCH_CONTEXT.ANY, provider => provider.searchContext)
}

/** 用法视图两处标题要的那一对（上游 `FindUsagesManager.createPresentation` 的 `{1}`）。 */
export interface UsageViewTarget {
  /** 标签上的短名（`{0} of {1}` 的 `{1}`）。 */
  shortName: string
  /** 面板标题里的长名（`{0} in {1}` 的 `{0}`，上游是描述名）。 */
  longName: string
  /** 元素类型标签（空串 = 认不出种类，标题里就不带它）。 */
  typeLabel: string
}

/**
 * 算一次搜索的标题两段：短名 = `getNodeText(element, false)`，长名 = 描述名，
 * 类型标签 = `getType`。上游那两处文案的 `{1}`/`{0}` 就是这两个值。
 */
export function usageViewTarget(element: FindUsagesElement): UsageViewTarget {
  const shortName = findUsagesNodeText(element, false) || element.name
  const longName = descriptiveNameFor(element) || shortName
  return { shortName, longName, typeLabel: findUsagesType(element) }
}

// 内置注册：通用 provider 挂在所有语言上（上游每个语言插件各挂一份，本仓语言智能走 LSP，一份通用即可）。
// 先声明 EP，再登记 bundled（第三方按同一 EP id 挂的 provider 由 `providersForLanguage` 合并）。
declareFindUsagesProviderExtensionPoint()
registerFindUsagesProvider(DEFAULT_FIND_USAGES_PROVIDER)

/** `SymbolKind` 编号 → 名字（诊断/判据用，与 `src/lspSymbolBridge.ts` 同表）。 */
export function symbolKindLabel(kind: number): string {
  return SYMBOL_KIND_NAMES[kind] ?? ''
}

// ---------------------------------------------------------------- 从 LSP 符号算元素

/** 本仓用到的符号最小形状（`LspDocumentSymbol` 的子集）。 */
export interface SymbolLike {
  name: string
  kind: number
  startLine: number
  startChar: number
  endLine?: number
  endChar?: number
}

const containsPosition = (symbol: SymbolLike, line: number, character: number): boolean => {
  const endLine = symbol.endLine ?? symbol.startLine
  if (line < symbol.startLine || line > endLine) return false
  if (line === symbol.startLine && character < symbol.startChar) return false
  if (line === endLine && symbol.endChar !== undefined && character > symbol.endChar) return false
  return true
}

/**
 * 从一份文档符号清单里取**包住该位置**的最内层符号，并把祖先名串成容器名
 * （上游 `DescriptiveNameUtil` 的 `PsiMetaData`/`PsiFile` 那一档本仓没有 PSI 可问，
 * 所以容器名按符号区间一层层往内下算 —— 与 `src/usageViewGrouping.ts` 的
 * `usageMemberPathFor` 同一口径）。
 * 没有符号包住该位置时退到「同名同起点的符号」，再退 null。
 */
export function findUsagesElementAt(
  symbols: readonly SymbolLike[],
  line: number,
  character: number,
  language?: string,
): FindUsagesElement | null {
  const ancestors: SymbolLike[] = []
  for (const symbol of symbols) if (containsPosition(symbol, line, character)) ancestors.push(symbol)
  // 由外到内（起点升序、终点降序）就是包含链；最内层 = 最后一个。
  ancestors.sort((left, right) => left.startLine - right.startLine
    || left.startChar - right.startChar
    || (right.endLine ?? right.startLine) - (left.endLine ?? left.startLine)
    || (right.endChar ?? 0) - (left.endChar ?? 0))
  const innermost = ancestors[ancestors.length - 1]
  if (!innermost) return null
  const containers = ancestors.slice(0, -1).map(symbol => symbol.name)
  return { name: innermost.name, kind: innermost.kind, containerName: containers.join('.'), language }
}