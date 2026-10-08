// 控制台过滤器的**注册表 + 默认过滤器链 + CompositeFilter 语义**（上游
// `com.intellij.consoleFilterProvider` 那一族的可移植面）。逐条坐标都在参考树里打开确认过。
//
//   · EP 声明 `platform/lang-api/resources/intellij.platform.lang.xml:142`（interface =
//     `com.intellij.execution.filters.ConsoleFilterProvider`，dynamic）；接口
//     `platform/lang-api/src/com/intellij/execution/filters/ConsoleFilterProvider.java:28-31`
//     —— 只有一格 `getDefaultFilters(Project)`，EP 名在 `:29`。
//   · 三个 provider 形状（`ConsoleViewUtil.computeConsoleFilters` 三分支，`:300-313`）：
//     基础 / `ConsoleFilterProviderEx`（`:23-24` 多 scope）/ `ConsoleDependentFilterProvider`
//     （`:23-28` 拿 consoleView，只带 project 的重载返回空表 `:28`）。
//   · 收集：`platform/platform-impl/src/com/intellij/execution/impl/ConsoleViewUtil.java:315-335`
//     —— 按 EP 顺序逐个取；**单个 provider 抛异常只跳过它**（CancellationException 上抛，其余记日志 `:320-332`）。
//   · 过滤语义：`platform/lang-api/src/com/intellij/execution/filters/CompositeFilter.java:54-95`
//     —— `ProcessCanceledException` 当无命中（`:72-74`）、其它 Throwable 抛 `ApplyFilterException`
//     （`:75-77`）；命中 merge（`:78-80`）；`EXIT && !forceUseAllFilters` 停（`:86-88`/`:115-117`）。
//     merge（`:119-134`）逐条收：`allowOverlapping || 无 hyperlink || 不与已收 hyperlink 相交` 且偏移合法。
//     `allowOverlapping` 取 registry `execution.filters.with.hyperlinks.allow.overlapping`，**默认 true**
//     （`:124`；键声明 `intellij.platform.lang.xml:258-261` `defaultValue="true"`）。相交 =
//     `TextRange.intersectsStrict` = `max(s1,s2) < min(e1,e2)`
//     （`platform/util/base/src/com/intellij/openapi/util/TextRange.java:247-249`）；
//     偏移非法 = `end < start || end > entireLength`（`:136-145`）。
//   · 过滤**不折叠也不隐藏行**：只产「高亮区间 + 可跳转落点」，正文一字不改；折叠是另一条 EP
//     `com.intellij.console.folding`（`ConsoleFolding.java:18`，消费
//     `platform/lang-impl/src/com/intellij/execution/impl/ConsoleViewImpl.kt:1029-1137`）。
//     对复制/搜索的影响只有一处：invisible link 不进 occurrence 导航
//     （`platform/platform-impl/src/com/intellij/execution/impl/EditorHyperlinkSupport.java:580`）
//     且要 Ctrl+点击才跳（`:67-69`/`:272`）。
//   · 结果形状：`getResultItems()` 按偏移构造时返回自己那一条（`Filter.java:77-83`）；
//     `NextAction { EXIT, CONTINUE_FILTERING }`（`:144-145`）**默认 EXIT**（`:30`）；
//     高亮层 = 有 hyperlink ? `HYPERLINK` : `CONSOLE_FILTER`（`:243-245`，值 `5900`/`5800`，
//     `platform/editor-ui-api/src/com/intellij/openapi/editor/markup/HighlighterLayer.java:35/37`）；
//     invisible link 标志 `:248-254`。
//   · 默认链：`DefaultConsoleFiltersProvider`（`java/execution/impl/src/com/intellij/execution/filters/
//     DefaultConsoleFiltersProvider.java:26`，登记 `java/execution/impl/resources/intellij.java.execution.impl.xml:90`）
//     = `ExceptionFilters.getFilters(scope)` + `YourkitFilter`（`:33-35`）；`ExceptionFilters`
//     （`java/execution/openapi/src/com/intellij/execution/filters/ExceptionFilters.java:23-30`）按
//     `com.intellij.exceptionFilter` EP（`ExceptionFilterFactory.java:27`，声明
//     `java/execution/openapi/resources/intellij.java.execution.xml:27`）各建一条 —— 内建三条：
//     `ExceptionBaseFilterFactory`（`JavaPlugin.xml:382` → `AdvancedExceptionFilter.java:18-41`）、
//     `ExceptionExFilterFactory`（`JavaPlugin.xml:383`）、`VcsContentAnnotationExceptionFilterFactory`
//     （`intellij.java.vcs.xml:54`）；另一条是 `UrlFilter$UrlFilterProvider`（`UrlFilter.java:152-161`，
//     登记 `platform/execution-impl/resources/intellij.platform.execution.impl.xml:63`）。
//     构建控制台再显式挂：`BuildOutputService.java:129-131`（`ModuleLinkFilter` +
//     `RegexpFilter(FILE_PATH:LINE:COLUMN)` + `UrlFilter`）与 `ToolRunProfile.java:126`
//     （`RegexpFilter.java:114-160` 是 `$FILE_PATH$` 宏展开）。
//
// 本仓与上游的三处如实差异（架构性，不假装等价）：
//   ① 没有 PSI/Project，上下文只有**项目根字符串**（`ConsoleFilterContext.root`）；按行调用 ⇒
//      `entireLength` 由调用方给，缺省取该行长度。
//   ② TS 没有重载，三分支拆成三个方法名（`getDefaultFilters`/`getDefaultFiltersWithScope`/
//      `getDefaultFiltersForConsole`），分派顺序与上游一致。
//   ③ 只给「区间 + 落点 + 层号」，配色由渲染层（`src/consoleAnsi.ts`/`src/consoleHyperlinks.ts`）决定。
//
// 插件贡献面**不在这里**：EP 注册与 `applyConsoleFilters` 在 `src/consoleFilterProviders.ts`；
// 本模块 import 它的 `consoleFilterProviders()` 作为链尾，第三方仍按同一个 EP 挂。
// 判据 `tests/console-filter-registry.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS } from './extensionPoints.ts'
import { CONSOLE_FILTER_PROVIDER_EP, consoleFilterProviders } from './consoleFilterProviders.ts'
import { terminalHyperlinkRanges, terminalLinkTarget } from './terminalHyperlinks.ts'
import { findRunHyperlinks } from './runHyperlinks.ts'
import { classifyJavaException } from './exceptionFilter.ts'

export { CONSOLE_FILTER_PROVIDER_EP }

/** 输入过滤器 EP（`ConsoleInputFilterProvider.java:25`，声明 `intellij.platform.lang.xml:144`）。 */
export const CONSOLE_INPUT_FILTER_PROVIDER_EP = 'com.intellij.consoleInputFilterProvider'
/** 悬停行专用过滤器 EP（`InvisibleHyperlinkFilterProvider.kt:35-36`，声明 `intellij.platform.lang.xml:143`）。 */
export const INVISIBLE_HYPERLINK_FILTER_PROVIDER_EP = 'com.intellij.invisibleHyperlinkFilterProvider'
/** 异常过滤器工厂 EP（`ExceptionFilterFactory.java:27`，声明 `intellij.java.execution.xml:27`）。 */
export const EXCEPTION_FILTER_EP = 'com.intellij.exceptionFilter'

/** `CompositeFilter.java:124` 读的那个 registry 键（`intellij.platform.lang.xml:258`，默认 true）。 */
export const ALLOW_OVERLAPPING_HYPERLINKS_REGISTRY_KEY = 'execution.filters.with.hyperlinks.allow.overlapping'

/** `Filter.java:244` 的两档高亮层（`HighlighterLayer.java:37` / `:35`）。 */
export const HYPERLINK_HIGHLIGHTER_LAYER = 5900
export const CONSOLE_FILTER_HIGHLIGHTER_LAYER = 5800

/** `NextAction`（`Filter.java:144-145`）。缺省 `exit`（`:30`）。 */
export type ConsoleNextAction = 'exit' | 'continue'

/** `ConsoleViewContentType` 的四个输出档（`ConsoleViewContentType.java:47-50`；`OUTPUT_TYPES` 就这四个，`:52`）。 */
export type ConsoleContentType = 'NORMAL_OUTPUT' | 'ERROR_OUTPUT' | 'SYSTEM_OUTPUT' | 'USER_INPUT'
export const CONSOLE_OUTPUT_TYPES: readonly ConsoleContentType[] = Object.freeze([
  'NORMAL_OUTPUT', 'ERROR_OUTPUT', 'USER_INPUT', 'SYSTEM_OUTPUT',
] as const)

/** filter 的运行上下文（上游 `Project`/`GlobalSearchScope`/`ConsoleView` 三样收成一格根路径 + 控制台 id）。 */
export interface ConsoleFilterContext {
  /** 项目根（拿它把命中路径相对化，与 `src/runHyperlinks.ts` 同口径）。 */
  root: string
  /** 控制台 id；给了才可能命中 `ConsoleDependentFilterProvider`（上游 `consoleView != null`，`:304`）。 */
  consoleId?: string
}

/** 一条命中（上游 `Filter.ResultItem` 的可移植面）。 */
export interface ConsoleFilterResultItem {
  /** 相对整个文档的高亮区间（上游 `getHighlightStartOffset/EndOffset`，`:215-221`）。 */
  highlightStartOffset: number
  highlightEndOffset: number
  /** 文件落点（上游 `FileUrlHyperlinkInfo`/`OpenFileHyperlinkInfo`）；浏览器命中与纯高亮为 null。 */
  path: string | null
  /** 1 基行号（上游 0 基；本仓跳转载荷统一 1 基，见 `src/consoleHyperlinks.ts:89-92`）。 */
  line: number
  column: number
  /** 浏览器落点（上游 `OpenUrlHyperlinkInfo`）；文件命中与纯高亮为 null。 */
  url: string | null
  /** 上游 `isInvisibleLink()`（`:248-249`）：正文看着是普通文本，Ctrl+点击才跳。 */
  invisibleLink: boolean
  /** 上游 `getHighlighterLayer()`（`:243-245`）。 */
  highlighterLayer: number
}

/** 一条 filter 的返回（上游 `Filter.Result`）。 */
export interface ConsoleFilterResult {
  items: readonly ConsoleFilterResultItem[]
  /** 上游 `getNextAction()`；默认 `exit`（`Filter.java:30`）。 */
  nextAction: ConsoleNextAction
}

/** 一条过滤器（上游 `Filter.applyFilter(line, entireLength)`，`:281-282`）。 */
export interface ConsoleFilter {
  /** 排查/异常信息里用的名字（上游 `filter.getClass().getSimpleName()`）。 */
  name?: string
  applyFilter(line: string, entireLength: number, context: ConsoleFilterContext): ConsoleFilterResult | null
}

/**
 * 本仓**既有**插件过滤器形状（`src/consoleFilterProviders.ts` 的 `ConsoleFilter`）：
 * 命中只有落点、**没有偏移**（`applyFilter(text, startOffset, context)` 返回
 * `{path, line, column?}` 或 null）。两者不是同一个类型，靠 `adaptPluginProvider` 在边界上适配。
 */
export interface PluginConsoleFilterLike {
  applyFilter(text: string, startOffset: number, context: ConsoleFilterContext): { path: string; line: number; column?: number } | null
}

/** 插件 provider 的形状（`src/consoleFilterProviders.ts` 的 `ConsoleFilterProvider`）。 */
export interface PluginConsoleFilterProvider {
  getDefaultFilters(context: ConsoleFilterContext): readonly PluginConsoleFilterLike[]
}

/**
 * 插件 provider → 本注册表的 provider（唯一一处适配）。
 * 插件 filter 只回 `{path,line,column?}`、**不报偏移**，所以偏移取整行 `[0, entireLength)`
 * —— 这是那份契约里唯一能给的区间；命中即一条可跳转的文件落点。
 */
export function adaptPluginProvider(provider: PluginConsoleFilterProvider): ConsoleFilterProviderLike {
  return {
    getDefaultFilters(context: ConsoleFilterContext): readonly ConsoleFilter[] {
      return provider.getDefaultFilters(context).map(pluginFilter => ({
        name: 'pluginConsoleFilter',
        applyFilter(line, entireLength, filterContext): ConsoleFilterResult | null {
          const hit = pluginFilter.applyFilter(line, 0, filterContext)
          if (!hit) return null
          return filterResult([filterItem({
            start: 0, end: entireLength, path: hit.path, line: hit.line, column: hit.column ?? 1,
          })])
        },
      }))
    },
  }
}

/** provider（上游 `ConsoleFilterProvider.getDefaultFilters(Project)`，`:31`）。 */
export interface ConsoleFilterProvider {
  getDefaultFilters(context: ConsoleFilterContext): readonly ConsoleFilter[]
}

/** 上游 `ConsoleFilterProviderEx`（`:23-24`）：多一个 searchScope。 */
export interface ConsoleFilterProviderEx extends ConsoleFilterProvider {
  getDefaultFiltersWithScope(context: ConsoleFilterContext): readonly ConsoleFilter[]
}

/** 上游 `ConsoleDependentFilterProvider`（`:23-24`）：拿 consoleView。 */
export interface ConsoleDependentFilterProvider extends ConsoleFilterProvider {
  getDefaultFiltersForConsole(consoleId: string, context: ConsoleFilterContext): readonly ConsoleFilter[]
}

/** 三分支分派要 duck-type 的联合形状（上游用 `instanceof`，`:304-312`）。 */
export type ConsoleFilterProviderLike = ConsoleFilterProvider
  & Partial<Pick<ConsoleFilterProviderEx, 'getDefaultFiltersWithScope'>>
  & Partial<Pick<ConsoleDependentFilterProvider, 'getDefaultFiltersForConsole'>>

/** 上游 `ProcessCanceledException` 在本仓的等价物：`AbortError` 一律上抛，其余当无命中。 */
export function isCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/** 上游 `CompositeFilter.ApplyFilterException`（`:231-232`）：某个 filter 自己炸了。 */
export class ConsoleApplyFilterError extends Error {
  readonly filterName: string
  constructor(filterName: string, line: string, cause: unknown) {
    super(`Error while applying ${filterName} to '${line}'`)
    this.name = 'ConsoleApplyFilterError'
    this.filterName = filterName
    this.cause = cause
  }
}

/** 一条命中是否算「可跳转」（上游 `getHyperlinkInfo() != null`）。 */
export function hasHyperlink(item: ConsoleFilterResultItem): boolean {
  return item.path !== null || item.url !== null
}

/** 造一条命中（层号按 `Filter.java:244` 自动定档，除非显式给）。 */
export function filterItem(input: {
  start: number
  end: number
  path?: string | null
  line?: number
  column?: number
  url?: string | null
  invisibleLink?: boolean
  highlighterLayer?: number
}): ConsoleFilterResultItem {
  const path = input.path ?? null
  const url = input.url ?? null
  return {
    highlightStartOffset: input.start,
    highlightEndOffset: input.end,
    path,
    line: input.line ?? 1,
    column: input.column ?? 1,
    url,
    invisibleLink: input.invisibleLink === true,
    highlighterLayer: input.highlighterLayer
      ?? (path !== null || url !== null ? HYPERLINK_HIGHLIGHTER_LAYER : CONSOLE_FILTER_HIGHLIGHTER_LAYER),
  }
}

/** 造一条 filter 返回；`nextAction` 缺省 `exit`（`Filter.java:30`）。 */
export function filterResult(items: readonly ConsoleFilterResultItem[], nextAction: ConsoleNextAction = 'exit'): ConsoleFilterResult {
  return { items, nextAction }
}

/**
 * `ConsoleViewUtil.computeConsoleFilters` 的 provider 分派（`:300-313`）。
 * 单个 provider 抛异常只跳过它（`:320-332`）；取消类错误上抛（`:323-325`）。
 */
export function providerFilters(provider: ConsoleFilterProviderLike, context: ConsoleFilterContext): readonly ConsoleFilter[] {
  try {
    if (context.consoleId && typeof provider.getDefaultFiltersForConsole === 'function') {
      return provider.getDefaultFiltersForConsole(context.consoleId, context)
    }
    if (typeof provider.getDefaultFiltersWithScope === 'function') {
      return provider.getDefaultFiltersWithScope(context)
    }
    return provider.getDefaultFilters(context)
  }
  catch (error) {
    if (isCancellation(error)) throw error
    return []
  }
}

/** 偏移合法性（`CompositeFilter.java:136-145`）。 */
export function filterOffsetsCorrect(item: ConsoleFilterResultItem, entireLength: number): boolean {
  const { highlightStartOffset: start, highlightEndOffset: end } = item
  if (end < start || end > entireLength) return false
  return true
}

/** `TextRange.intersectsStrict`（`TextRange.java:247-249`）。 */
export function rangesIntersectStrict(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return Math.max(aStart, bStart) < Math.min(aEnd, bEnd)
}

/** 新命中是否与**已收的 hyperlink 命中**相交（`CompositeFilter.intersects`，`:148-164`：只看有 hyperlink 的）。 */
export function intersectsAcceptedHyperlink(accepted: readonly ConsoleFilterResultItem[], item: ConsoleFilterResultItem): boolean {
  return accepted.some(other => hasHyperlink(other)
    && rangesIntersectStrict(item.highlightStartOffset, item.highlightEndOffset, other.highlightStartOffset, other.highlightEndOffset))
}

export interface ConsoleCompositeOptions {
  /**
   * 上游 `setForceUseAllFilters`（`:222-224`）。运行控制台**恒为 true**
   * —— `ConsoleViewImpl.createCompositeFilter` 建完就 `setForceUseAllFilters(true)`（`:425-428`），
   * 所以控制台里某个 filter 报 EXIT 也不会挡住后面的 filter。缺省 true 即照这一条。
   */
  forceUseAllFilters?: boolean
  /**
   * 上游 `CompositeFilter.java:124` 的 registry 键，默认 true。false 时**与已收 hyperlink 相交的
   * hyperlink 命中被丢掉**（纯高亮命中不受这条约束，`:128` 的 `item.getHyperlinkInfo() == null` 分支）。
   */
  allowOverlappingHyperlinks?: boolean
}

/**
 * `CompositeFilter.applyFilter`（`:54-95`）+ `merge`（`:119-134`）+ `createFinalResult`（`:97-113`）。
 * 返回 null 表示一条都没命中（`:91-93`）。**最终结果一律 `exit`**：`createFinalResult` 是新建的
 * `Result`，它的 `myNextAction` 回到字段缺省（`Filter.java:30`）——各 filter 报的 nextAction 只用于
 * 决定「要不要继续喂后面的 filter」，不会带到最终结果上。
 */
export function applyCompositeFilter(
  filters: readonly ConsoleFilter[],
  line: string,
  entireLength: number,
  context: ConsoleFilterContext,
  options: ConsoleCompositeOptions = {},
): ConsoleFilterResult | null {
  const forceAll = options.forceUseAllFilters !== false
  const allowOverlapping = options.allowOverlappingHyperlinks !== false
  const accepted: ConsoleFilterResultItem[] = []
  for (const filter of filters) {
    let result: ConsoleFilterResult | null
    try {
      result = filter.applyFilter(line, entireLength, context)
    }
    catch (error) {
      if (isCancellation(error)) throw error
      // 上游这里抛 ApplyFilterException（`:75-77`），由调用方（如 JediTerm 适配器 `:103-106`）兜住。
      throw new ConsoleApplyFilterError(filterNameOf(filter), line, error)
    }
    if (result === null) continue
    for (const item of result.items) {
      if ((allowOverlapping || !hasHyperlink(item) || !intersectsAcceptedHyperlink(accepted, item))
          && filterOffsetsCorrect(item, entireLength)) {
        accepted.push(item)
      }
    }
    if (result.nextAction === 'exit' && !forceAll) break
  }
  if (accepted.length === 0) return null
  return filterResult(accepted)
}

function filterNameOf(filter: ConsoleFilter): string {
  const name = (filter as { name?: unknown }).name
  return typeof name === 'string' && name ? name : filter.constructor?.name ?? 'filter'
}

/**
 * provider 注册表（上游 EP 列表 + `computeConsoleFilters` 收集链的等价物）。
 * 内建与第三方落在同一个列表里：内建按 `builtinConsoleFilterProviders()` 在前，插件 EP 的贡献在后。
 */
export class ConsoleFilterRegistry {
  private readonly providers: ConsoleFilterProviderLike[]
  private readonly ids: string[]

  constructor(providers: readonly ConsoleFilterProviderLike[] = []) {
    this.providers = [...providers]
    this.ids = this.providers.map((provider, index) => providerId(provider, index))
  }

  /** 按 id 注册；同 id 覆盖（与 `ExtensionPointHost.registerExtension` 同口径）。 */
  register(provider: ConsoleFilterProviderLike, id?: string): () => void {
    const key = id ?? `consoleFilterProvider.builtin.${this.providers.length + 1}`
    const at = this.ids.indexOf(key)
    if (at >= 0) {
      this.providers[at] = provider
      return () => { this.unregister(key) }
    }
    this.providers.push(provider)
    this.ids.push(key)
    return () => { this.unregister(key) }
  }

  unregister(id: string): boolean {
    const at = this.ids.indexOf(id)
    if (at < 0) return false
    this.providers.splice(at, 1)
    this.ids.splice(at, 1)
    return true
  }

  providerIds(): readonly string[] { return [...this.ids] }

  /** 收集全部 filter（`ConsoleViewUtil.java:315-335` 的展平）。 */
  computeFilters(context: ConsoleFilterContext): ConsoleFilter[] {
    const filters: ConsoleFilter[] = []
    for (const provider of this.providers) filters.push(...providerFilters(provider, context))
    return filters
  }

  /** 一行过整条链（CompositeFilter 语义）。 */
  applyFilter(
    line: string, context: ConsoleFilterContext, entireLength = line.length, options: ConsoleCompositeOptions = {},
  ): ConsoleFilterResult | null {
    return applyCompositeFilter(this.computeFilters(context), line, entireLength, context, options)
  }
}

function providerId(provider: ConsoleFilterProviderLike, index: number): string {
  const named = (provider as { id?: unknown }).id
  return typeof named === 'string' && named ? named : `consoleFilterProvider.${index + 1}`
}

/** 建一个注册表：内建默认链在前，插件 EP 的贡献在后（`src/consoleFilterProviders.ts` 仍是第三方入口）。 */
export function createConsoleFilterRegistry(): ConsoleFilterRegistry {
  const registry = new ConsoleFilterRegistry(builtinConsoleFilterProviders())
  // 插件那份 `ConsoleFilter` 只报落点、不报偏移 ⇒ 在这一处经 `adaptPluginProvider` 归一成富形状。
  for (const provider of consoleFilterProviders()) registry.register(adaptPluginProvider(provider))
  return registry
}

// ── 默认过滤器链（内建 provider 的可执行部分） ────────────────────────────────────────────────
//
// 上游两条内建 provider 的落点见文件头；本仓拿现成的识别函数当 filter 本体，
// 于是「一行过链」这件事在本仓只有一条实现路径（不再由面板各切一段）。

/**
 * 上游 `UrlFilter$UrlFilterProvider`（`UrlFilter.java:152-161`）的等价物：一行里的 URL 与 `file:` 命中。
 * 判定复用 `src/terminalHyperlinks.ts`（规则出自 `UrlFilter.java:54-79`/`:89-123`），
 * 落点转换与 `src/consoleHyperlinks.ts:89-92` 同口径（上游 0 基 → 本仓 1 基）。
 */
export const urlFilterProvider: ConsoleFilterProviderEx & { id: string } = {
  id: 'com.intellij.execution.filters.UrlFilter$UrlFilterProvider',
  getDefaultFilters(): readonly ConsoleFilter[] {
    return [urlFilter]
  },
  getDefaultFiltersWithScope(): readonly ConsoleFilter[] {
    return [urlFilter]
  },
}

const urlFilter: ConsoleFilter = {
  name: 'UrlFilter',
  applyFilter(line, _entireLength, _context): ConsoleFilterResult | null {
    const items: ConsoleFilterResultItem[] = []
    for (const range of terminalHyperlinkRanges(line)) {
      const target = terminalLinkTarget(range.text)
      if (target.kind === 'file') {
        items.push(filterItem({
          start: range.start, end: range.end, path: target.path,
          line: (target.line ?? 0) + 1, column: (target.column ?? 0) + 1,
        }))
      }
      else {
        items.push(filterItem({ start: range.start, end: range.end, url: target.url }))
      }
    }
    return items.length ? filterResult(items) : null
  },
}

/**
 * 上游构建控制台那条 `RegexpFilter(FILE_PATH:LINE:COLUMN)`（`BuildOutputService.java:130`、
 * `ToolRunProfile.java:126`，规则 `RegexpFilter.java:114-160`）的等价物：一行里**全部** `path:line[:col]`。
 * 判定复用 `src/runHyperlinks.ts`（`MultipleFilesHyperlinkInfo`/`FileHyperlinkRawDataFinder` 的可移植子集）。
 */
export const fileHyperlinkFilterProvider: ConsoleFilterProvider & { id: string } = {
  id: 'com.intellij.execution.filters.RegexpFilter',
  getDefaultFilters(context): readonly ConsoleFilter[] {
    return [fileHyperlinkFilter(context.root)]
  },
}

function fileHyperlinkFilter(root: string): ConsoleFilter {
  return {
    name: 'RegexpFilter',
    applyFilter(line): ConsoleFilterResult | null {
      const items = findRunHyperlinks(line, root).map(link => filterItem({
        start: link.start, end: link.end, path: link.path, line: link.line, column: link.column,
      }))
      return items.length ? filterResult(items) : null
    },
  }
}

/**
 * 上游 `DefaultConsoleFiltersProvider` → `ExceptionFilters` → `ExceptionBaseFilterFactory`
 * → `AdvancedExceptionFilter`（`DefaultConsoleFiltersProvider.java:33-35`、`ExceptionFilters.java:23-30`、
 * `ExceptionBaseFilterFactory.java:10-14`、`AdvancedExceptionFilter.java:18-41`）的等价物。
 *
 * 如实差异：上游 `getExceptionClassNameItems`（`AdvancedExceptionFilter.java:24-41`）把异常类名解析成
 * `PsiClass` 再建**可跳转到该类的** hyperlink；本仓没有 PSI/索引，所以只给异常类名区间一条
 * **纯高亮**命中（`path`/`url` 都是 null ⇒ 上游同形状：`ResultItem` 无 hyperlink 时
 * `EditorHyperlinkSupport.java:519-521` 只 addHighlighter）。分类本身复用 `src/exceptionFilter.ts`。
 */
export const exceptionClassNameFilterProvider: ConsoleFilterProvider & { id: string } = {
  id: 'com.intellij.execution.filters.ExceptionBaseFilterFactory',
  getDefaultFilters(): readonly ConsoleFilter[] {
    return [exceptionClassNameFilter]
  },
}

const exceptionClassNameFilter: ConsoleFilter = {
  name: 'AdvancedExceptionFilter',
  applyFilter(line): ConsoleFilterResult | null {
    const info = classifyJavaException(line)
    if (info === null) return null
    const at = line.indexOf(info.className)
    if (at < 0) return null
    return filterResult([filterItem({ start: at, end: at + info.className.length })])
  },
}

/** 内建默认链（顺序 = 文件头那几条登记的先后：异常族 → URL → 文件位置）。 */
export function builtinConsoleFilterProviders(): readonly ConsoleFilterProviderLike[] {
  return [exceptionClassNameFilterProvider, urlFilterProvider, fileHyperlinkFilterProvider]
}

/** 内建链 + 插件 EP 贡献（第三方按 `com.intellij.consoleFilterProvider` 挂进来即进这条链）。 */
export function consoleFilterChainProviders(): readonly ConsoleFilterProviderLike[] {
  return [...builtinConsoleFilterProviders(), ...consoleFilterProviders().map(adaptPluginProvider)]
}

/** 一行过整条链，只要**可跳转的文件落点**（与 `src/consoleFilterProviders.ts` 的 `applyConsoleFilters` 同形状）。 */
export function applyConsoleFilterChain(
  text: string, root: string, options: ConsoleCompositeOptions & { consoleId?: string; entireLength?: number } = {},
): { path: string; line: number; column: number }[] {
  const context: ConsoleFilterContext = { root, ...(options.consoleId ? { consoleId: options.consoleId } : {}) }
  const result = applyCompositeFilter(
    new ConsoleFilterRegistry(consoleFilterChainProviders()).computeFilters(context),
    text, options.entireLength ?? text.length, context, options,
  )
  if (result === null) return []
  return result.items.flatMap(item => (item.path === null
    ? []
    : [{ path: item.path, line: item.line, column: item.column }]))
}

// ── 输入过滤器（`com.intellij.consoleInputFilterProvider`） ────────────────────────────────────
//
// 与输出过滤器的差别（上游逐条）：
//   · 形状：`InputFilter.applyFilter(text, contentType)` 返回
//     `List<Pair<String, ConsoleViewContentType>>` 或 null（`InputFilter.java:33-34`）
//     —— 它**把一段文本切成若干带类型的块**，不是给区间加高亮。
//   · 合并：`CompositeInputFilter.applyFilter` **取第一个非 null 就返回**（`CompositeInputFilter.java:42-44`），
//     不像输出侧那样把各 filter 的结果并起来。
//   · 容错：坏 filter 被永久标记 `isBroken` 之后**不再调用**（`:62-74`）。
//   · 空链：一个 provider 都没有且没有自定义 filter 时，`computeInputFilter` 直接返回
//     `(text, contentType) -> null` 的空实现（`ConsoleViewUtil.java:349-351`）。
//   · 消费：`ConsoleViewImpl.print`（`:574-586`）按块用自己的类型打印；
//     `insertUserText`（`:1402-1420`）里**类型是 USER_INPUT 的块当用户输入插入**（`:1414-1417`），
//     其余块走 `print`（`:1418-1419`）。
//
// 参考树里 `<consoleInputFilterProvider implementation=...>` 的登记数 = **0**
// （`grep -rn "<consoleInputFilterProvider implementation" --include=*.xml` 全树无命中，
// 只有 `intellij.platform.lang.xml:144` 那条 EP 声明）⇒ 上游平台内也没有内建输入过滤器。

/** 一段带类型的文本（上游 `Pair<String, ConsoleViewContentType>`）。 */
export interface ConsoleInputChunk {
  text: string
  contentType: ConsoleContentType
}

/** 一条输入过滤器（上游 `InputFilter`，`InputFilter.java:26-34`）。 */
export interface ConsoleInputFilter {
  name?: string
  applyFilter(text: string, contentType: ConsoleContentType): readonly ConsoleInputChunk[] | null
}

/** 输入 provider（上游 `ConsoleInputFilterProvider.getDefaultFilters(Project)`，`:27`）。 */
export interface ConsoleInputFilterProvider {
  id?: string
  getDefaultFilters(context: ConsoleFilterContext): readonly ConsoleInputFilter[]
}

/** 输入 provider 的 consoleView 变体（上游 `ConsoleDependentInputFilterProvider`，`:11-21`）。 */
export interface ConsoleDependentInputFilterProvider extends ConsoleInputFilterProvider {
  getDefaultFiltersForConsole(consoleId: string, context: ConsoleFilterContext): readonly ConsoleInputFilter[]
}

/** 空链的等价物（`ConsoleViewUtil.java:350` 的 `(text, contentType) -> null`）。 */
export const INPUT_FILTER_NOOP: ConsoleInputFilter = {
  name: 'noop',
  applyFilter(): null { return null },
}

/**
 * `CompositeInputFilter`（`:20-76`）：按顺序问，第一个非 null 就返回；坏 filter 只炸一次之后永久跳过。
 * 返回 `{ applyFilter, brokenCount }`（broken 状态是实例级的，与上游的 `InputFilterWrapper.isBroken` 同域）。
 */
export function createCompositeInputFilter(filters: readonly ConsoleInputFilter[]): {
  applyFilter: (text: string, contentType: ConsoleContentType) => readonly ConsoleInputChunk[] | null
  brokenCount: () => number
} {
  const broken = new Set<number>()
  return {
    applyFilter(text, contentType) {
      for (let index = 0; index < filters.length; index++) {
        if (broken.has(index)) continue
        const filter = filters[index]!
        let result: readonly ConsoleInputChunk[] | null
        try {
          result = filter.applyFilter(text, contentType)
        }
        catch (error) {
          if (isCancellation(error)) throw error
          broken.add(index)
          continue
        }
        if (result !== null) return result
      }
      return null
    },
    brokenCount: () => broken.size,
  }
}

/** `ConsoleViewUtil.computeInputFilter`（`:344-363`）的 provider 展平。 */
export function consoleInputFilters(providers: readonly ConsoleInputFilterProvider[], context: ConsoleFilterContext): ConsoleInputFilter[] {
  const filters: ConsoleInputFilter[] = []
  for (const provider of providers) {
    try {
      const dependent = provider as ConsoleDependentInputFilterProvider
      if (context.consoleId && typeof dependent.getDefaultFiltersForConsole === 'function') {
        filters.push(...dependent.getDefaultFiltersForConsole(context.consoleId, context))
      }
      else {
        filters.push(...provider.getDefaultFilters(context))
      }
    }
    catch (error) {
      if (isCancellation(error)) throw error
    }
  }
  return filters
}

/** 本仓登记的输入过滤器（EP `com.intellij.consoleInputFilterProvider` 的贡献；参考树里上游也没有内建）。 */
export function registeredInputFilters(context: ConsoleFilterContext): ConsoleInputFilter[] {
  return consoleInputFilters(EXTENSIONS.extensionsOf<ConsoleInputFilterProvider>(CONSOLE_INPUT_FILTER_PROVIDER_EP), context)
}

/**
 * 输入过滤结果 → 该怎么写（`ConsoleViewImpl.insertUserText`，`:1402-1420`）：
 * 类型是 `USER_INPUT` 的块当用户输入插入（`:1414-1417`），其余块按自己的类型打印（`:1418-1419`）。
 */
export function inputFilterSplits(chunks: readonly ConsoleInputChunk[] | null): {
  userInput: string
  printed: ConsoleInputChunk[]
} {
  if (chunks === null) return { userInput: '', printed: [] }
  const printed: ConsoleInputChunk[] = []
  let userInput = ''
  for (const chunk of chunks) {
    if (chunk.contentType === 'USER_INPUT') userInput += chunk.text
    else printed.push(chunk)
  }
  return { userInput, printed }
}

/** 悬停行专用的 filter provider（上游 `InvisibleHyperlinkFilterProvider.getFilters(project, scope)`，`:31`）。 */
export interface InvisibleHyperlinkFilterProvider {
  id?: string
  getFilters(context: ConsoleFilterContext): readonly ConsoleFilter[]
}

/** 悬停行过滤器（EP `com.intellij.invisibleHyperlinkFilterProvider`；**只对鼠标下那一行**算，`:11-16`）。 */
export function invisibleHyperlinkFilters(context: ConsoleFilterContext): ConsoleFilter[] {
  const filters: ConsoleFilter[] = []
  for (const provider of EXTENSIONS.extensionsOf<InvisibleHyperlinkFilterProvider>(INVISIBLE_HYPERLINK_FILTER_PROVIDER_EP)) {
    try {
      filters.push(...provider.getFilters(context))
    }
    catch (error) {
      if (isCancellation(error)) throw error
    }
  }
  return filters
}

// ── 内置 provider 清单（`<consoleFilterProvider>` / `<exceptionFilter>` 的真实登记） ────────────
//
// 这张表是**声明面**（上游谁在哪儿挂了什么），不是可执行链；可执行的内建只有
// `builtinConsoleFilterProviders()` 那三条。`repoModule` 给非空值的那些 = 本仓已有等价物。

export interface ConsoleFilterProviderEntry {
  /** 上游实现类名（`implementation` 属性的值）。 */
  id: string
  /** 登记坐标（`文件:行号`）。 */
  registration: string
  /** 本仓承接该 provider 的模块；没有等价物就是 null。 */
  repoModule: string | null
}

/**
 * 全树 `<consoleFilterProvider implementation=...>` 的 **15 条**登记
 * （`grep -rn "<consoleFilterProvider implementation" --include=*.xml .` 逐条数出，不是抄的）。
 * 注意 `DefaultConsoleFiltersProvider` **是**这一族的（它自己实现 `ConsoleFilterProviderEx`，
 * `DefaultConsoleFiltersProvider.java:26`），它内部再经 `com.intellij.exceptionFilter` 取异常族
 * —— 那三条记在下面 `EXCEPTION_FILTER_FACTORY_INVENTORY`，不在本表里。
 */
export const CONSOLE_FILTER_PROVIDER_INVENTORY: readonly ConsoleFilterProviderEntry[] = Object.freeze([
  { id: 'com.intellij.execution.filters.DefaultConsoleFiltersProvider', registration: 'java/execution/impl/resources/intellij.java.execution.impl.xml:90', repoModule: 'src/exceptionFilter.ts' },
  { id: 'com.intellij.execution.filters.UrlFilter$UrlFilterProvider', registration: 'platform/execution-impl/resources/intellij.platform.execution.impl.xml:63', repoModule: 'src/terminalHyperlinks.ts' },
  { id: 'com.intellij.debugger.impl.attach.JavaDebuggerConsoleFilterProvider', registration: 'java/debugger/impl/resources/META-INF/java-debugger.xml:130', repoModule: null },
  { id: 'com.intellij.java.impl.nullaway.NullAwayFilterProvider', registration: 'java/java-backend/resources/META-INF/JavaPlugin.xml:1127', repoModule: null },
  { id: 'com.intellij.java.terminal.backend.NoJavaExecutableFilter', registration: 'java/terminal/backend/resources/intellij.java.terminal.backend.xml:27', repoModule: null },
  { id: 'com.intellij.analysis.customization.console.ClassLoggingConsoleFilterProvider', registration: 'jvm/jvm-analysis-impl/resources/intellij.jvm.analysis.impl.xml:230', repoModule: null },
  { id: 'org.jetbrains.idea.devkit.run.ModulePathFilterProvider', registration: 'plugins/devkit/devkit-core/resources/intellij.devkit.core.xml:1004', repoModule: null },
  { id: 'org.jetbrains.idea.devkit.gradle.GradlePluginConsoleFilterProvider', registration: 'plugins/devkit/intellij.devkit.gradle/resources/intellij.devkit.gradle.xml:44', repoModule: null },
  { id: 'org.jetbrains.plugins.gradle.execution.GradleConsoleFilterProvider', registration: 'plugins/gradle/plugin-resources/intellij.gradle.xml:159', repoModule: null },
  { id: 'org.jetbrains.plugins.groovy.execution.filters.GrCompilationErrorsFilterProvider', registration: 'plugins/groovy/resources/META-INF/plugin.xml:1416', repoModule: null },
  { id: 'org.jetbrains.kotlin.idea.run.KotlinConsoleFilterProvider', registration: 'plugins/kotlin/run-configurations/jvm/resources/intellij.kotlin.runConfigurations.jvm.xml:44', repoModule: null },
  { id: 'org.jetbrains.idea.maven.project.MavenConsoleFilterProvider', registration: 'plugins/maven/src/main/resources/intellij.maven.xml:202', repoModule: null },
  { id: 'org.jetbrains.plugins.terminal.hyperlinks.filter.TerminalGenericFileFilterProvider', registration: 'plugins/terminal/resources/META-INF/terminal.xml:84', repoModule: null },
  { id: 'com.jetbrains.python.run.PyMessageFilterProvider', registration: 'python/pluginResources/intellij.python.community.impl.xml:773', repoModule: null },
  { id: 'com.jetbrains.python.run.AstralConsoleFilterProvider', registration: 'python/pluginResources/intellij.python.community.impl.xml:774', repoModule: null },
])

/** 全树 `<exceptionFilter implementation=...>` 的 3 条登记（EP 名 `com.intellij.exceptionFilter`）。 */
export const EXCEPTION_FILTER_FACTORY_INVENTORY: readonly ConsoleFilterProviderEntry[] = Object.freeze([
  { id: 'com.intellij.execution.filters.ExceptionBaseFilterFactory', registration: 'java/java-backend/resources/META-INF/JavaPlugin.xml:382', repoModule: 'src/exceptionFilter.ts' },
  { id: 'com.intellij.execution.filters.ExceptionExFilterFactory', registration: 'java/java-backend/resources/META-INF/JavaPlugin.xml:383', repoModule: null },
  { id: 'com.intellij.openapi.vcs.contentAnnotation.VcsContentAnnotationExceptionFilterFactory', registration: 'java/vcs/resources/intellij.java.vcs.xml:54', repoModule: null },
])

/** 构建控制台在默认链之外**显式**挂的几条（不走 EP，直接 `withExecutionFilter`/`addFilter`）。 */
export const BUILD_CONSOLE_EXTRA_FILTERS: readonly ConsoleFilterProviderEntry[] = Object.freeze([
  { id: 'com.intellij.execution.filters.RegexpFilter', registration: 'java/compiler/impl/src/com/intellij/compiler/progress/BuildOutputService.java:130', repoModule: 'src/runHyperlinks.ts' },
  { id: 'com.intellij.execution.filters.UrlFilter', registration: 'java/compiler/impl/src/com/intellij/compiler/progress/BuildOutputService.java:131', repoModule: 'src/terminalHyperlinks.ts' },
  { id: 'com.intellij.execution.filters.RegexpFilter', registration: 'platform/lang-impl/src/com/intellij/tools/ToolRunProfile.java:126', repoModule: 'src/runHyperlinks.ts' },
])

/**
 * 过滤语义的答案（本模块的行为契约，逐条指上游）：
 *   · 不折叠行、不隐藏行 —— filter 只产区间（`Filter.java:273-282`）；折叠是另一条 EP（`ConsoleFolding.java:18`）；
 *   · 不改正文 ⇒ 复制/搜索不受影响；
 *   · 唯一例外：invisible link 不进 occurrence 导航（`EditorHyperlinkSupport.java:580`）且要 Ctrl+点击（`:67-69`、`:272`）。
 */
export const CONSOLE_FILTER_SEMANTICS = Object.freeze({
  foldsLines: false,
  hidesLines: false,
  affectsCopy: false,
  excludesInvisibleLinksFromOccurrenceNavigation: true,
} as const)

/** 两个 EP 的声明（幂等）。输出侧那条由 `src/consoleFilterProviders.ts` 声明，这里不重复。 */
export function declareConsoleFilterExtensionPoints(): void {
  for (const [id, name] of [
    [CONSOLE_INPUT_FILTER_PROVIDER_EP, '控制台输入过滤器'],
    [INVISIBLE_HYPERLINK_FILTER_PROVIDER_EP, '悬停行超链接过滤器'],
    [EXCEPTION_FILTER_EP, '异常过滤器工厂'],
  ] as const) {
    EXTENSIONS.declareExtensionPoint({ id, name, scope: APPLICATION_SCOPE, dynamic: true })
  }
}

declareConsoleFilterExtensionPoints()

// ── 端口监视器 / 提权（`execution/portsWatcher` + `execution/process/elevation`）已拆到
//    `src/runProcessPorts.ts`（纯函数，本文件贴 900 行上限）── 名字在这里原样再导出：
//    调用方（判据）一行没改，与 `src/runInstances.ts` → `src/runStopAction.ts` 同一拆法。
export {
  DEFAULT_PORT_LISTENING_OPTIONS, ELEVATION_AUTHORIZE_EVERY_TIME, ELEVATION_DEFAULT_GRACE_PERIOD_MS,
  ELEVATION_DEFAULT_SETTINGS, ELEVATION_KEEP_AUTH_LABEL, ELEVATION_MAX_DAEMON_ATTEMPTS,
  ELEVATION_SETTINGS_TITLE, elevationAuthLabel, elevationAvailable, elevationQuota, elevationWrappedCommand,
  listeningPortsOf, portOptionsIncludeChildren, portOptionsIncludeSelf, portWatchDelta, portWatchPids,
  portWatchStep, portWatchSupported,
  type ElevationSettingsState, type ListeningPortRecord, type PortListeningOptions, type PortWatchDelta,
} from './runProcessPorts.ts'
