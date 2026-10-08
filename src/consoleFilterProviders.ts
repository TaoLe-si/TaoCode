// 控制台过滤器的**插件贡献面**（上游 `com.intellij.consoleFilterProvider` 一族）。
//
// 上游是什么：`platform/lang-api/resources/intellij.platform.lang.xml:142` 声明
// `<extensionPoint qualifiedName="com.intellij.consoleFilterProvider" interface="com.intellij.execution.filters.ConsoleFilterProvider"/>`
// —— 插件贡献 `ConsoleFilterProvider`（`getDefaultFilters(Project)` 返回一串 `Filter`），
// 控制台把每一行输出喂给这些 filter，命中就折成可跳转的 `HyperlinkInfo`/问题行
// （消费链 `ConsoleViewImpl` → `CompositeFilter` → 各 provider 的 filter）。
//
// 本仓现状（判词 exec/filters 的「缺」）：内置的识别（`file:line` 问题、异常行、多文件超链接）
// 在 `src/buildOutput.ts`/`src/exceptionFilter.ts`/`src/runHyperlinks.ts` 里有等价物，
// 但**没有插件可挂的宿主**。本模块补上那一层：EP id 逐字取上游，
// `ConsoleFilter.applyFilter(text, startOffset)` 的形状也照上游（返回可跳转位置或 null），
// 于是按上游接口写的 filter provider 代码可以原样挂进来。
//
// 与上游的如实差异：上游 filter 活在 PSI/项目模型上（`Filter.applyFilter` 拿 `Project`）；
// 本仓没有 PSI，filter 的上下文只有**项目根字符串**（拿它做路径相对化），所以
// `ConsoleFilterContext` 只带 root 一格。内置识别不动（仍走 runIssues 的既有链路），
// 本 EP 的贡献是**追加**在这些内置识别之后 —— 没插件时行为与之前逐字相同。
//
// 判据 `tests/console-filter-providers.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS } from './extensionPoints.ts'

/** EP id（逐字取上游 `intellij.platform.lang.xml:142` 的 qualifiedName）。 */
export const CONSOLE_FILTER_PROVIDER_EP = 'com.intellij.consoleFilterProvider'

/** filter 的运行上下文（上游是 `Project`；本仓只有项目根，见文件头差异）。 */
export interface ConsoleFilterContext {
  root: string
}

/** 一条命中（上游 `HyperlinkInfo` 的可移植子集：跳到某个文件的某行某列）。 */
export interface ConsoleFilterResult {
  path: string
  line: number
  column?: number
}

/** 一条过滤器（上游 `Filter.applyFilter(text, startOffset)` 的等价物）。 */
export interface ConsoleFilter {
  /** 命中返回可跳转位置，不命中返回 null（上游 `HyperlinkInfo`/`null` 二选一）。 */
  applyFilter(text: string, startOffset: number, context: ConsoleFilterContext): ConsoleFilterResult | null
}

/** provider（上游 `ConsoleFilterProvider.getDefaultFilters(project)`）。 */
export interface ConsoleFilterProvider {
  getDefaultFilters(context: ConsoleFilterContext): ConsoleFilter[]
}

/** 插件注册一个 provider（等价于 plugin.xml 的 `<com.intellij.consoleFilterProvider implementation="..."/>`）。 */
export function registerConsoleFilterProvider(provider: ConsoleFilterProvider, id?: string): () => void {
  const handle = EXTENSIONS.registerExtension<ConsoleFilterProvider>(
    CONSOLE_FILTER_PROVIDER_EP, id ?? `consoleFilterProvider.${++providerSequence}`, provider, { source: 'user' },
  )
  return () => { handle.dispose() }
}
let providerSequence = 0

/** 全部 provider（内建清单为空 —— 本仓内置识别走 runIssues 既有链路，本 EP 只收插件贡献）。 */
export function consoleFilterProviders(): ConsoleFilterProvider[] {
  return EXTENSIONS.extensionsOf<ConsoleFilterProvider>(CONSOLE_FILTER_PROVIDER_EP)
}

/**
 * 把一行输出喂给全部插件 filter，按注册顺序收命中（一条 filter 一路，命中即收；
 * 与上游 `CompositeFilter` 遍历各 filter 的「全部命中都收」同口径）。
 */
export function applyConsoleFilters(text: string, root: string): ConsoleFilterResult[] {
  const context: ConsoleFilterContext = { root }
  const results: ConsoleFilterResult[] = []
  for (const provider of consoleFilterProviders()) {
    for (const filter of provider.getDefaultFilters(context)) {
      try {
        const hit = filter.applyFilter(text, 0, context)
        if (hit) results.push(hit)
      } catch { /* 一个坏 filter 不该打断控制台渲染（等价于上游 ConsoleView 的容错） */ }
    }
  }
  return results
}

// 声明 EP（幂等）。上游这条 EP 是给插件挂控制台过滤器的入口。
EXTENSIONS.declareExtensionPoint({
  id: CONSOLE_FILTER_PROVIDER_EP, name: '控制台过滤器', scope: APPLICATION_SCOPE, dynamic: true,
})
