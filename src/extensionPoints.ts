// **扩展点宿主**（上游 `com.intellij.openapi.extensions` 一族在本仓的等价物）。
//
// 上游是什么：`ExtensionPointName`/`ExtensionPoint` 是插件贡献的**唯一入口** —— 插件在
// plugin.xml 里写 `<completion.contributor implementation="…"/>`，平台在
// `ExtensionPoint.getExtensions()` 里按 `order` 属性排好序交回消费方；`LoadingOrder`
// （`platform/extensions/src/com/intellij/openapi/extensions/LoadingOrder.kt:16-18`）
// 的取值是 `first` / `last` / `before <id>` / `after <id>`，逗号可组合（`:46-78` 的解析），
// 排序是**带约束的拓扑排序**（`:125-207` 的 `sortByLoadingOrder`，无解抛
// `SortingException("Could not satisfy sorting requirements")`）。
//
// 本仓此前的现实（判词 pf/actions / pf/plugins / se/providers 反复出现的「EP 宿主缺」）：
// 每个域各造一个私有注册表 —— `src/completionContributors.ts` 的 `ContributorRegistry`、
// `src/inlayProviderRegistry.ts` 的 `InlayProviderRegistry`、`src/actionRegistry.ts` 的
// `ActionRegistry`、`src/customFoldingProviders.ts`、`src/annotatorRegistry.ts`… 它们形状各异、
// 谁也不能被第三方按 id 挂进去，也没有作用域/顺序可言。本文件补上**那一层宿主**：
// 一个按 id 的 EP 表 + 贡献注册/注销 + 作用域过滤 + `LoadingOrder` 排序，三个既有注册表
// 改成**从它取初始集合**（内置的那几条在模块加载时作为 bundled 贡献注册进来），于是
// 「EP 宿主缺」这条判词在本仓口径下闭合。
//
// 与上游的三处如实差异：
//   ① 上游的 EP 声明写在 plugin.xml、由 `ExtensionsAreaImpl` 在启动时读；本仓没有插件
//      XML 解析器（插件只贡献声明式数据，见 `native/plugins.cpp`），所以 EP 用
//      `declareExtensionPoint()` 在代码里声明，贡献用 `registerExtension()` 注册。
//   ② 上游的 scope 是 IDEA_APPLICATION / IDEA_PROJECT 两种 area（`AreaInstance`）；本仓的
//      scope 是**字符串**（`'application'` / `'project'` / 任意工作区根），查询时按
//      「application 贡献对任何 scope 都可见，project 贡献只对该 scope 可见」过滤。
//   ③ 上游 `orderId` 由 bean 的 `id` 属性给；本仓从贡献对象自己取（对象上读 `id` 字段，
//      没有就按注册序号当身份），所以 `before <id>` 锚的是**贡献的 id** 而不是 EP 的 id。
//
// 纯数据层：不 import vue/DOM/bridge，便于单测（与 `codeVisionProviders.ts` 同一纪律）。
//
// 判据：`tests/extension-points.test.mjs`。

/** 作用域：应用级贡献对任何 scope 可见，其余按名字精确匹配。 */
export const APPLICATION_SCOPE = 'application'

/** 一条贡献（上游 `ExtensionDescriptor` 的最小形状：身份 + 顺序 + 载体）。 */
export interface ExtensionEntry<T> {
  /** 贡献 id（`before <id>` / `after <id>` 锚的就是它）。 */
  id: string
  /** 贡献的载体（上游是反序列化出来的 bean；本仓就是那个对象本身）。 */
  value: T
  /** 声明它的 EP id。 */
  extensionPoint: string
  /** 作用域（缺省 `application`）。 */
  scope: string
  /** 声明顺序（`first` / `last` / `before x, after y` / 空 = 任意）。 */
  order: string
  /** 优先级：同档位内**大的在前**（上游 plugin 的 priority 与 `ExtensionPointPriorityListener` 的等价物）。 */
  priority: number
  /** 注册序号（稳定排序的最后一档兜底，越早注册越靠前）。 */
  sequence: number
  /** 注册来源（`bundled` = 随本仓发货；`user` = 运行时挂进来的）。 */
  source: 'bundled' | 'user'
}

export interface RegisterExtensionOptions {
  scope?: string
  order?: string
  priority?: number
  source?: 'bundled' | 'user'
}

/** `LoadingOrder` 解析出来的四档（`LoadingOrder.kt:27-30` 的字段一一对应）。 */
export interface LoadingOrder {
  first: boolean
  last: boolean
  before: readonly string[]
  after: readonly string[]
}

export const ANY_ORDER: LoadingOrder = { first: false, last: false, before: [], after: [] }

const ORDER_RULE_SEPARATOR = ','
const FIRST_STR = 'first'
const LAST_STR = 'last'
const BEFORE_STR = 'before '
const BEFORE_STR_OLD = 'before:'
const AFTER_STR = 'after '
const AFTER_STR_OLD = 'after:'

/**
 * `LoadingOrder.readOrder(orderAttr)` 的等价物（`LoadingOrder.kt:44-84` 的构造循环逐条对位）：
 * 逗号分隔、逐段 trim、空段跳过；`first`/`last` 是开关，`before X`/`after X` 收进集合
 * （两种写法都认，旧写法 `before:`/`after:` 是 `:61-76` 的 `BEFORE_STR_OLD`/`AFTER_STR_OLD`）；
 * 认不出的段抛错 —— 上游是 `AssertionError("Invalid specification: …")`（`:78`），
 * 静默吃掉会造出「顺序写了但没生效」的假功能。
 */
export function parseLoadingOrder(text: string | null | undefined): LoadingOrder {
  if (!text) return ANY_ORDER
  let first = false
  let last = false
  const before = new Set<string>()
  const after = new Set<string>()
  for (const raw of String(text).split(ORDER_RULE_SEPARATOR)) {
    const rule = raw.trim()
    if (!rule) continue
    if (rule === FIRST_STR) { first = true; continue }
    if (rule === LAST_STR) { last = true; continue }
    if (rule.startsWith(BEFORE_STR)) { before.add(rule.slice(BEFORE_STR.length).trim()); continue }
    if (rule.startsWith(BEFORE_STR_OLD)) { before.add(rule.slice(BEFORE_STR_OLD.length).trim()); continue }
    if (rule.startsWith(AFTER_STR)) { after.add(rule.slice(AFTER_STR.length).trim()); continue }
    if (rule.startsWith(AFTER_STR_OLD)) { after.add(rule.slice(AFTER_STR_OLD.length).trim()); continue }
    throw new Error(`顺序声明不合法：${rule}；只能是 first / last / before <id> / after <id>（逗号可组合）。`)
  }
  return { first, last, before: [...before], after: [...after] }
}

/** 循环依赖（上游 `SortingException`）。`entries` 是卷进环的那些贡献 id。 */
export class ExtensionSortingError extends Error {
  readonly entries: readonly string[]
  constructor(entries: readonly string[]) {
    super(`扩展点的顺序要求无法满足（存在循环依赖）：${entries.join(' → ')}`)
    this.name = 'ExtensionSortingError'
    this.entries = entries
  }
}

/**
 * `LoadingOrder.sortByLoadingOrder` 的等价物（`LoadingOrder.kt:125-207`）。
 *
 * 约束语义逐条对位：
 *   · `first` 的贡献排在任何非 `first` 的**前面**（`:186-188` 给每个非 first 的节点加上
 *     「所有 first 节点」当前驱）；
 *   · `last` 的贡献排在任何非 `last` 的**后面**（`:178-184` 给 last 节点加上「所有非 last
 *     节点」当前驱）；
 *   · `after <id>`：该 id 是当前驱（`:161-166`）；
 *   · `before <id>`：**反过来**给那个 id 加上当前贡献当前驱（`:168-176`，靠扫 `hasBefore` 集合实现）。
 * 在这些硬约束之外，本仓多两档：`priority` 降序、注册序号升序（上游这两件事由插件优先级与
 * 声明顺序隐式承担）。硬约束优先于这两档 —— 它们只决定约束图里同层的相对次序。
 *
 * 用 Kahn 拓扑排序（入度 0 者优先出队，同层按 priority/序号排），因此结果**确定**且可判；
 * 有环时抛 `ExtensionSortingError`，不静默给一个半成品顺序。
 */
export function sortByLoadingOrder<T>(entries: readonly ExtensionEntry<T>[]): ExtensionEntry<T>[] {
  if (entries.length < 2) return [...entries]
  const byId = new Map<string, ExtensionEntry<T>>()
  for (const entry of entries) if (entry.id) byId.set(entry.id, entry)

  const orders = new Map<ExtensionEntry<T>, LoadingOrder>()
  const firsts: ExtensionEntry<T>[] = []
  const hasBefore = new Set<ExtensionEntry<T>>()
  let anyConstrained = false
  for (const entry of entries) {
    const order = parseLoadingOrder(entry.order)
    if (order.first || order.last || order.before.length || order.after.length) anyConstrained = true
    orders.set(entry, order)
    if (order.first) firsts.push(entry)
    if (order.before.length) hasBefore.add(entry)
  }
  if (!anyConstrained) return rank(entries)

  // 前驱表（边的方向：predecessor → entry）。
  const predecessors = new Map<ExtensionEntry<T>, Set<ExtensionEntry<T>>>()
  const successors = new Map<ExtensionEntry<T>, Set<ExtensionEntry<T>>>()
  for (const entry of entries) { predecessors.set(entry, new Set()); successors.set(entry, new Set()) }
  const addEdge = (from: ExtensionEntry<T>, to: ExtensionEntry<T>) => {
    if (from === to) throw new ExtensionSortingError([from.id])
    const froms = successors.get(from)
    const tos = predecessors.get(to)
    if (!froms || !tos || froms.has(to)) return
    froms.add(to)
    tos.add(from)
  }

  for (const entry of entries) {
    const order = orders.get(entry) ?? ANY_ORDER
    for (const id of order.after) {
      const anchor = byId.get(id)
      if (anchor) addEdge(anchor, entry)
    }
    if (entry.id) {
      for (const other of hasBefore) {
        const otherOrder = orders.get(other) ?? ANY_ORDER
        if (otherOrder.before.includes(entry.id)) addEdge(other, entry)
      }
    }
    if (order.last) {
      for (const other of entries) {
        const otherOrder = orders.get(other) ?? ANY_ORDER
        if (other !== entry && !otherOrder.last) addEdge(other, entry)
      }
    }
    if (!order.first) for (const f of firsts) if (f !== entry) addEdge(f, entry)
  }

  // Kahn：入度 0 的集合里每次取「priority 大者、再注册早者」——与上面 rank() 同一档比较。
  const remaining = new Set(entries)
  const result: ExtensionEntry<T>[] = []
  while (remaining.size) {
    const ready = [...remaining].filter(entry => (predecessors.get(entry)?.size ?? 0) === 0)
    if (!ready.length) throw new ExtensionSortingError([...remaining].map(entry => entry.id))
    ready.sort(compareEntries)
    const next = ready[0]
    result.push(next)
    remaining.delete(next)
    for (const successor of successors.get(next) ?? []) predecessors.get(successor)?.delete(next)
  }
  return result
}

/** 两档兜底：priority 降序 → 注册序号升序（`Array.sort` 在 Node 上是稳定的，但仍写全）。 */
function compareEntries<T>(left: ExtensionEntry<T>, right: ExtensionEntry<T>): number {
  return right.priority - left.priority || left.sequence - right.sequence
}

function rank<T>(entries: readonly ExtensionEntry<T>[]): ExtensionEntry<T>[] {
  return [...entries].sort(compareEntries)
}

/** 一个 EP 的声明（上游 `ExtensionPointDescriptor` 的可移植子集）。 */
export interface ExtensionPointDeclaration {
  /** EP 全名（上游 qualifiedName，如 `com.intellij.codeInsight.inlayProvider`）。 */
  id: string
  /** 默认作用域：贡献没写 scope 时用它（缺省 `application`）。 */
  scope?: string
  /** 是不是允许运行期注册（上游 `dynamic="true"`；false 的 EP 注册会抛错）。 */
  dynamic?: boolean
  /** 人类可读的名字（上游 `name` 属性；排查与断言用）。 */
  name?: string
}

export class UnknownExtensionPointError extends Error {
  constructor(id: string) {
    super(`扩展点 ${id} 未声明；先 declareExtensionPoint() 再注册贡献。`)
    this.name = 'UnknownExtensionPointError'
  }
}

/** 一条贡献的注销句柄。 */
export interface ExtensionHandle {
  readonly id: string
  readonly extensionPoint: string
  dispose: () => boolean
}

export type ExtensionPointListener = (extensionPoint: string) => void

/**
 * 扩展点宿主（上游 `ExtensionsAreaImpl` 的可移植子集）。
 *
 * 只保留本仓能兑现的那几格：
 *   · `declareExtensionPoint` ↔ plugin.xml 里的 `<extensionPoint>` 声明；
 *   · `registerExtension` ↔ `<completion.contributor implementation="…" order="first"/>` 一条；
 *   · `unregisterExtension` ↔ 上游的 `unregisterExtension`（动态 EP 才允许）；
 *   · `extensionsOf(id, scope)` ↔ `ExtensionPoint.getExtensions()` + area 过滤 + 排序；
 *   · `addListener` ↔ `ExtensionPointListener`（EP 内容变了通知消费方重建）。
 */
export class ExtensionPointHost {
  private declarations = new Map<string, ExtensionPointDeclaration>()
  private entries = new Map<string, ExtensionEntry<unknown>[]>()
  private listeners = new Set<ExtensionPointListener>()
  private sequence = 0

  declareExtensionPoint(declaration: ExtensionPointDeclaration): void {
    if (!declaration.id) throw new Error('扩展点 id 不能为空。')
    this.declarations.set(declaration.id, { dynamic: true, scope: APPLICATION_SCOPE, ...declaration })
    if (!this.entries.has(declaration.id)) this.entries.set(declaration.id, [])
  }

  hasExtensionPoint(id: string): boolean { return this.declarations.has(id) }

  extensionPointIds(): string[] { return [...this.declarations.keys()] }

  /**
   * 注册一条贡献。EP 必须已声明（上游会为未声明的 EP 抛 `UnknownExtensionPointError`），
   * 非 dynamic 的 EP 拒绝运行期注册（上游 `dynamic="false"` 的语义）。
   * 同 id 重复注册 = **覆盖**（上游 `replaceExtension` 的口径；本仓单页应用里模块可能重复装配，
   * 与 `actionRegistry.ts` 的 register 同一选择）。
   */
  registerExtension<T>(extensionPoint: string, id: string, value: T, options: RegisterExtensionOptions = {}): ExtensionHandle {
    const declaration = this.declarations.get(extensionPoint)
    if (!declaration) throw new UnknownExtensionPointError(extensionPoint)
    if (!id) throw new Error(`扩展点 ${extensionPoint} 的贡献必须有 id。`)
    if (declaration.dynamic === false) throw new Error(`扩展点 ${extensionPoint} 不是动态的，不能运行期注册。`)
    const scope = options.scope ?? declaration.scope ?? APPLICATION_SCOPE
    const entry: ExtensionEntry<T> = {
      id, value, extensionPoint, scope,
      order: options.order ?? '',
      priority: Number.isFinite(options.priority) ? (options.priority as number) : 0,
      sequence: ++this.sequence,
      source: options.source ?? 'user',
    }
    const list = this.entries.get(extensionPoint) ?? []
    const replaced = list.filter(candidate => candidate.id !== id)
    this.entries.set(extensionPoint, [...replaced, entry as ExtensionEntry<unknown>])
    this.notify(extensionPoint)
    return { id, extensionPoint, dispose: () => this.unregisterExtension(extensionPoint, id) }
  }

  /** 注销一条贡献。返回是否真的删掉了（上游 `unregisterExtension` 同口径）。 */
  unregisterExtension(extensionPoint: string, id: string): boolean {
    const list = this.entries.get(extensionPoint)
    if (!list) return false
    const next = list.filter(entry => entry.id !== id)
    if (next.length === list.length) return false
    this.entries.set(extensionPoint, next)
    this.notify(extensionPoint)
    return true
  }

  /** 某 EP 在某个作用域下的全部贡献（已排序）。scope 缺省 = 只看应用级。 */
  extensionsOf<T>(extensionPoint: string, scope: string = APPLICATION_SCOPE): T[] {
    return this.entriesFor<T>(extensionPoint, scope).map(entry => entry.value)
  }

  /** 同上的完整条目版（要读 order/priority/source 的消费方用）。 */
  entriesFor<T>(extensionPoint: string, scope: string = APPLICATION_SCOPE): ExtensionEntry<T>[] {
    const all = (this.entries.get(extensionPoint) ?? []) as ExtensionEntry<T>[]
    const visible = all.filter(entry => entry.scope === APPLICATION_SCOPE || entry.scope === scope)
    return sortByLoadingOrder(visible)
  }

  /** 不看作用域的全部贡献（排查/诊断用；消费方一律走 `extensionsOf`）。 */
  allEntries<T>(extensionPoint: string): ExtensionEntry<T>[] {
    return [...((this.entries.get(extensionPoint) ?? []) as ExtensionEntry<T>[])]
  }

  /** EP 内容变化通知（上游 `ExtensionPointListener`）。返回取消订阅。 */
  addListener(listener: ExtensionPointListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private notify(extensionPoint: string): void {
    for (const listener of this.listeners) listener(extensionPoint)
  }
}

/** 进程内唯一的宿主（与上游 `Extensions.getRootArea()` 一样是应用级单例）。 */
export const EXTENSIONS = new ExtensionPointHost()

// ── 本仓已接线的那几个 EP（id 逐字取自上游的 `qualifiedName`） ──────────────────────────
// 每个 EP 的 id 都在上游的 plugin.xml 里有对应声明，出处写在各自那一行上；消费方（三个
// 既有注册表）从这里取初始集合，第三方（或测试）可以按同一个 id 挂自己的贡献。
//
//   · `completion.contributor` —— `platform/analysis-api/resources/intellij.platform.analysis.xml:75`
//     （`beanClass="com.intellij.codeInsight.completion.CompletionContributorEP" dynamic="true"`）；
//     XML 里写的是**相对名** `completion.contributor`，上游消费方按**限定名**取：
//     `CompletionContributor.java:143` 的 `EP = new ExtensionPointName<>("com.intellij.completion.contributor")`
//     —— 插件挂载时锚的也是这个限定名，所以本仓也必须用它（写相对名插件挂不上）。
//   · `com.intellij.codeInsight.inlayProvider` —— `platform/lang-api/resources/intellij.platform.lang.xml:54`
//     （`InlayHintsProviderExtensionBean` dynamic="true"；限定名见
//     `InlayHintsProviderExtension.kt:8` 的 `EXTENSION_POINT_NAME`）；
//   · `com.intellij.action` —— 动作贡献面：上游把动作写在 `<actions>` 块里由
//     `ActionManagerImpl.registerAction` 收编（`src/actionRegistry.ts` 的 `ActionRegistry` 就是
//     那一层的等价物），本仓给它一个 EP id 让贡献者按 id 挂。
//   · `com.intellij.annotator` —— 注解器贡献面：`platform/lang-api/resources/intellij.platform.lang.xml`
//     里 `AnnotatorEP`（`beanClass="com.intellij.lang.annotation.Annotator"` dynamic="true"，
//     限定名见 `LanguageAnnotators.java:10` 的 `EP_NAME`），
//     上游 `LanguageAnnotators` 按语言取；本仓消费方是 `src/annotatorRegistry.ts` 的
//     `AnnotatorRegistry`（`adoptFromExtensions()` 收编）。第三方按同一 id 挂注解器即可被分派。
//   · `com.intellij.customFoldingProvider` —— `platform/core-api/resources/intellij.platform.core.xml:40`
//     （接口 `com.intellij.lang.folding.CustomFoldingProvider`；限定名见
//     `CustomFoldingProvider.java:18` 的 `EP_NAME`）；本仓消费方是
//     `src/customFoldingProviders.ts` 的 `CustomFoldingProviderRegistry`。
//   · `com.intellij.quoteHandler` / `com.intellij.lang.quoteHandler` —— 引号 handler 的两条 EP
//     （`platform/lang-impl/resources/intellij.platform.lang.impl.xml:405` 按 fileType、
//     `:408` 按 language；限定名见 `QuoteHandlerEP.java:18` 与 `LanguageQuoteHandling.java:15`）；
//     本仓消费方是 `src/quoteHandlerRegistry.ts` 的 `QuoteHandlerRegistry`。
//   · `com.intellij.environmentKeyProvider` —— `platform/platform-api/.../EnvironmentKeyProvider.kt:21`
//     的 `EP_NAME`；本仓消费方是 `src/environmentKeyProviders.ts` 的
//     `EnvironmentKeyProviderRegistry`。
//   · `com.intellij.fileType` —— `<fileType …>` 声明式注册的 EP
//     （`platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/FileTypeManagerImpl.java:132`
//     的 `FileTypeManagerImpl.EP_NAME`）；本仓消费方是 `src/fileTypeRegistry.ts` 的 `FileTypeManager`。
export const COMPLETION_CONTRIBUTOR_EP = 'com.intellij.completion.contributor'
export const INLAY_PROVIDER_EP = 'com.intellij.codeInsight.inlayProvider'
export const ACTION_EP = 'com.intellij.action'
export const ANNOTATOR_EP = 'com.intellij.annotator'
/** 自定义折叠 provider（`CustomFoldingProvider.java:18` 的 `EP_NAME`）。 */
export const CUSTOM_FOLDING_PROVIDER_EP = 'com.intellij.customFoldingProvider'
/** 引号 handler 的两条 EP：按 fileType / 按 language（`QuoteHandlerEP.java:18`、`LanguageQuoteHandling.java:15`）。 */
export const QUOTE_HANDLER_EP = 'com.intellij.quoteHandler'
export const LANGUAGE_QUOTE_HANDLER_EP = 'com.intellij.lang.quoteHandler'
/** 环境键提供方（`EnvironmentKeyProvider.kt:21` 的 `EP_NAME`）。 */
export const ENVIRONMENT_KEY_PROVIDER_EP = 'com.intellij.environmentKeyProvider'
/** `<fileType …>` 声明式注册（`FileTypeManagerImpl.java:132` 的 `EP_NAME`）。 */
export const FILE_TYPE_EP = 'com.intellij.fileType'
/** 插件服务面：键是上游服务的全限定名（`src/pluginServices.ts` 的消费/注册端）。 */
export const SERVICE_EP = 'com.intellij.service'
/** 文件编辑器事件主题（上游 `FileEditorManagerListener` 的 TOPIC 名）。 */
export const FILE_EDITOR_MANAGER_LISTENER_EP = 'com.intellij.openapi.fileEditor.FileEditorManagerListener'
/** 搁架变更事件主题（上游 `ShelveChangesManager.SHELF_TOPIC` 的订阅面）。 */
export const SHELVE_CHANGES_MANAGER_LISTENER_EP = 'com.intellij.openapi.vcs.changes.shelf.ShelveChangesManagerListener'
/**
 * 文件编辑器提供者（上游 `com.intellij.fileEditorProvider`，
 * `platform/analysis-api/resources/intellij.platform.analysis.xml:17`，
 * `beanClass="com.intellij.openapi.fileEditor.FileEditorProvider"` dynamic="true"）。
 * 上游 `FileEditorProviderManager.getProvider(project, file)` 按 order/priority 取**第一个接受的**
 * provider 建编辑器；本仓的等价消费端是 `src/pluginApi.ts` 的 `fileEditorProviders` /
 * `editorProviderFor`，bundled 贡献是 `src/largeFileViewer.ts`（`LargeFileEditorProvider`，
 * id 逐字取上游 `platform/platform-impl/resources/intellij.platform.ide.impl.xml:1243` 的
 * `id="LargeFileEditor"`）。第三方插件按同一 id 挂自己的 provider，即可替换默认编辑器。
 */
export const FILE_EDITOR_PROVIDER_EP = 'com.intellij.fileEditorProvider'
/** 编辑器提供者抑制器（上游 `platform/platform-impl/resources/intellij.platform.ide.impl.xml:187`）。 */
export const FILE_EDITOR_PROVIDER_SUPPRESSOR_EP = 'com.intellij.fileEditorProviderSuppressor'
/**
 * UI 侧的四条注册面（第三方插件在 plugin.xml 里能做的那四件事，本仓给同名 EP）：
 *   · `com.intellij.toolWindow` —— 工具窗口注册。`platform/platform-api/resources/intellij.platform.ide.xml:79`
 *     的 `<extensionPoint qualifiedName="com.intellij.toolWindow" beanClass="com.intellij.openapi.wm.ToolWindowEP"
 *     dynamic="true">`；上游消费方是 `ToolWindowSetInitializer`。本仓消费方是
 *     `src/toolWindowMeta.ts`（`registerToolWindowRegistration`）。
 *   · `com.intellij.statusBarWidgetFactory` —— 状态栏部件工厂。同文件 `:98`
 *     的 `<extensionPoint qualifiedName="com.intellij.statusBarWidgetFactory"
 *     interface="com.intellij.openapi.wm.StatusBarWidgetFactory" dynamic="true">`；本仓消费方是
 *     `src/statusWidgets.ts`（`registerStatusWidgetFactory`），贡献会出现在状态栏右键勾选清单里。
 *   · `com.intellij.applicationConfigurable` / `com.intellij.projectConfigurable` —— 设置页注册。
 *     `platform/ide-core/resources/intellij.platform.ide.core.xml:54`/`:60`；本仓消费方是
 *     `src/settingsTreeMeta.ts`（`registerSettingsPage` 的两个作用域版本）。
 *   · `com.intellij.editorActionHandler` —— 编辑器动作处理器。同文件 `:69`
 *     的 `<extensionPoint qualifiedName="com.intellij.editorActionHandler"
 *     beanClass="com.intellij.openapi.editor.actionSystem.EditorActionHandlerBean" dynamic="true">`；
 *     本仓消费方是 `src/editorActionHandlers.ts`（按动作 id 分派）。
 */
export const TOOL_WINDOW_EP = 'com.intellij.toolWindow'
export const STATUS_BAR_WIDGET_FACTORY_EP = 'com.intellij.statusBarWidgetFactory'
export const APPLICATION_CONFIGURABLE_EP = 'com.intellij.applicationConfigurable'
export const PROJECT_CONFIGURABLE_EP = 'com.intellij.projectConfigurable'
export const EDITOR_ACTION_HANDLER_EP = 'com.intellij.editorActionHandler'

/** 随本仓发货的全部 EP 声明（幂等：重复调用只是覆盖同名声明）。 */
export function declareBundledExtensionPoints(): void {
  EXTENSIONS.declareExtensionPoint({
    id: COMPLETION_CONTRIBUTOR_EP, name: '补全贡献者',
    scope: APPLICATION_SCOPE, dynamic: true,
  })
  EXTENSIONS.declareExtensionPoint({
    id: INLAY_PROVIDER_EP, name: '内联提示提供者',
    scope: APPLICATION_SCOPE, dynamic: true,
  })
  EXTENSIONS.declareExtensionPoint({
    id: ACTION_EP, name: '动作贡献',
    scope: APPLICATION_SCOPE, dynamic: true,
  })
  EXTENSIONS.declareExtensionPoint({
    id: ANNOTATOR_EP, name: '注解器',
    scope: APPLICATION_SCOPE, dynamic: true,
  })
  // 自定义折叠 provider（`com.intellij.customFoldingProvider`）：`NetBeans` / `VisualStudio`
  // 两条内置 provider 由 `src/customFoldingProviders.ts` 在模块加载时作为 bundled 贡献挂进来。
  EXTENSIONS.declareExtensionPoint({
    id: CUSTOM_FOLDING_PROVIDER_EP, name: '自定义折叠 provider',
    scope: APPLICATION_SCOPE, dynamic: true,
  })
  // 引号 handler 的两条 EP（上游一条按 fileType、一条按 language）：
  // `src/quoteHandlerRegistry.ts` 的 20 条内置注册分别按各自的 `via` 挂进对应那条。
  EXTENSIONS.declareExtensionPoint({
    id: QUOTE_HANDLER_EP, name: '引号 handler（按 fileType）',
    scope: APPLICATION_SCOPE, dynamic: true,
  })
  EXTENSIONS.declareExtensionPoint({
    id: LANGUAGE_QUOTE_HANDLER_EP, name: '引号 handler（按语言）',
    scope: APPLICATION_SCOPE, dynamic: true,
  })
  // 环境键提供方：两条内置 provider（Plugin/Jvm）由 `src/environmentKeyProviders.ts` 挂成 bundled。
  EXTENSIONS.declareExtensionPoint({
    id: ENVIRONMENT_KEY_PROVIDER_EP, name: '环境键提供方',
    scope: APPLICATION_SCOPE, dynamic: true,
  })
  // 文件类型声明（`<fileType …>`）：本仓 `STANDARD_FILE_TYPES` 由 `src/fileTypeRegistry.ts`
  // 在模块加载时挂成 bundled 贡献，第三方的 `FileTypeDescriptor` 按同一 id 挂即被收编。
  EXTENSIONS.declareExtensionPoint({
    id: FILE_TYPE_EP, name: '文件类型',
    scope: APPLICATION_SCOPE, dynamic: true,
  })
  // 插件服务面（`src/pluginServices.ts`）：键是上游服务的**全限定名**，值是服务对象。
  // 这是 `ApplicationManager.getService(Class)` 在本仓的等价键 —— 让按 FQN 取服务的
  // 第三方插件能拿到 `HttpVirtualFileSystem` / `FileEditorManager` / `ShelveChangesManager` /
  // `JavaPsiFacade` 这几样。声明在这里，贡献由 `registerPluginServices()` 挂。
  EXTENSIONS.declareExtensionPoint({
    id: SERVICE_EP, name: '插件服务',
    scope: APPLICATION_SCOPE, dynamic: true,
  })
  EXTENSIONS.declareExtensionPoint({
    id: FILE_EDITOR_MANAGER_LISTENER_EP, name: '文件编辑器事件',
    scope: APPLICATION_SCOPE, dynamic: true,
  })
  EXTENSIONS.declareExtensionPoint({
    id: SHELVE_CHANGES_MANAGER_LISTENER_EP, name: '搁架变更事件',
    scope: APPLICATION_SCOPE, dynamic: true,
  })
  // 文件编辑器提供者（`com.intellij.fileEditorProvider`）：本仓 bundled 贡献是
  // `src/largeFileViewer.ts` 的 `LargeFileEditorProvider`，第三方按同一 id 挂即被
  // `src/pluginApi.ts` 的 `editorProviderFor()` 选中（上游 `FileEditorProviderManager` 同口径）。
  EXTENSIONS.declareExtensionPoint({
    id: FILE_EDITOR_PROVIDER_EP, name: '文件编辑器提供者',
    scope: APPLICATION_SCOPE, dynamic: true,
  })
  EXTENSIONS.declareExtensionPoint({
    id: FILE_EDITOR_PROVIDER_SUPPRESSOR_EP, name: '文件编辑器提供者抑制器',
    scope: APPLICATION_SCOPE, dynamic: true,
  })
  // UI 侧四条注册面（见上面常量旁的出处）：工具窗口 / 状态栏部件 / 设置页（应用级与项目级）/ 编辑器动作处理器。
  EXTENSIONS.declareExtensionPoint({
    id: TOOL_WINDOW_EP, name: '工具窗口',
    scope: APPLICATION_SCOPE, dynamic: true,
  })
  EXTENSIONS.declareExtensionPoint({
    id: STATUS_BAR_WIDGET_FACTORY_EP, name: '状态栏部件工厂',
    scope: APPLICATION_SCOPE, dynamic: true,
  })
  EXTENSIONS.declareExtensionPoint({
    id: APPLICATION_CONFIGURABLE_EP, name: '设置页（应用级）',
    scope: APPLICATION_SCOPE, dynamic: true,
  })
  EXTENSIONS.declareExtensionPoint({
    id: PROJECT_CONFIGURABLE_EP, name: '设置页（项目级）',
    scope: 'project', dynamic: true,
  })
  EXTENSIONS.declareExtensionPoint({
    id: EDITOR_ACTION_HANDLER_EP, name: '编辑器动作处理器',
    scope: APPLICATION_SCOPE, dynamic: true,
  })
}

declareBundledExtensionPoints()