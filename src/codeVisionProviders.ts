// Code Vision 的**本地提供者注册表**（上游 `platform/lang-impl/src/com/intellij/codeInsight/codeVision/`：
// `CodeVisionProvider` 挂在 EP 上（`:25`），`computeForEditor(editor, uiData)` 产条目（`:62`），
// `handleClick` 处理点击（`:76`），`isAvailableFor(project)` 决定可用性（`:35`）；社区版内置的那一组
// （usages / inheritors / problems / change.signature / vcs）在 `resources/codeVisionProviders/` 下，
// 每个都是「一行标题 + 一个点击动作 + 一个行上方锚点」。
//
// 本仓现状：条目全部来自 LSP `textDocument/codeLens`（`src/codeLens.ts` 的锚点规则 +
// `codeLensExtension.ts` 的渲染）。服务端不下发 lens 时行上方就是空的。这里补**本地提供者通道**：
// 一个注册表 + 三个内置提供者 —— `problems`（把本仓已有的诊断按作用域符号归并，在类/方法上方显示
// 「N 个错误 / M 个警告」，点击跳到该符号的第一个问题）、`references`（「N 个用法」）、
// `inheritors`（「N 个继承者 / N 个实现」）。
//
// **订正（2026-10-06，bucket3b）**：这一版注释原来写着「需要引用数与继承数的提供者走服务端通道，
// 不在这里伪造数字」。前半个判断是错的 —— 计数不需要"伪造"：本仓宿主已经有
// `textDocument/references`（`native/lsp_session_kinds.cpp:108-118`，`includeDeclaration` 为 true）
// 与 `typeHierarchy`（同文件 `:196-220`）两条通道，只是**没有人去问**。
// 现在这两个提供者读的就是逐符号问出来的真计数，抓取与缓存那一层在 `src/cvLocalVision.ts`；
// 数字拿不到的符号一律**不产条目**（`context.usages` 里没有这一项就跳过），不写假数。
//
// 纯数据层：不 import `vue`/`bridge`，结构类型入参，便于单测。

import { APPLICATION_SCOPE, EXTENSIONS } from './extensionPoints.ts'

/**
 * `CodeVisionProvider` 的扩展点 id（逐字取自上游
 * `platform/lang-impl/resources/intellij.platform.lang.impl.xml:282-283`
 * 的 `qualifiedName="com.intellij.codeInsight.codeVisionProvider"`，
 * 接口 `com.intellij.codeInsight.codeVision.CodeVisionProvider`，`dynamic="true"`）。
 * 本仓此前是私有注册表（`table.set`，第三方挂不进来）；本版把它接进
 * `src/extensionPoints.ts` 的 EP 宿主 —— 三个内置提供者按 bundled 贡献登记，
 * 注册表的 `register` 同步进 EP，`createCodeVisionRegistry()` 缺省从 EP 取初始集合。
 */
export const CODE_VISION_PROVIDER_EP = 'com.intellij.codeInsight.codeVisionProvider'

/** 声明 EP（幂等）。 */
export function declareCodeVisionExtensionPoints(): void {
  EXTENSIONS.declareExtensionPoint({ id: CODE_VISION_PROVIDER_EP, name: 'Code Vision 提供者', scope: APPLICATION_SCOPE, dynamic: true })
}

/** 某作用域下的全部提供者（已按 `LoadingOrder` 排序）—— 与上游 `CodeVisionProvider.EP_NAME` 同口径。 */
export function codeVisionProvidersFromExtensions(scope: string = APPLICATION_SCOPE): CodeVisionProvider[] {
  return EXTENSIONS.extensionsOf<CodeVisionProvider>(CODE_VISION_PROVIDER_EP, scope)
}


/** 一条 Code Vision 条目：挂在哪一行 + 显示什么 + 点击发什么命令。 */
export interface CodeVisionEntry {
  /** 锚点行（0 基）。 */
  line: number
  title: string
  command: string
  arguments?: unknown[]
  /**
   * 这条是谁产的（上游 `CodeVisionEntry.providerId`，
   * `platform/lang-api/src/com/intellij/codeInsight/codeVision/CodeVisionEntry.kt`）。
   * 右键"隐藏这一个 provider"按它收口（`ProjectCodeVisionModelImpl.kt:51` 先取 provider 的
   * `groupId` 再 `setProviderEnabled(id,false)`），所以本地条目**必须**带；
   * 服务端 lens 不带（LSP 协议里没有这一项），由 `src/codeLensSettings.ts` 统一归到
   * `LSP_CODE_VISION_GROUP_ID` 那一组。
   */
  providerId?: string
}

/** 一个符号的用法/继承者计数（键 = 符号**名字**所在的行列，与 LSP `selectionRange` 起点同一点）。 */
export interface VisionSymbolCount {
  line: number
  character: number
  count: number
}

/** 提供者算条目时能看到的上下文（与 `computeForEditor` 的入参同形）。 */
export interface CodeVisionContext {
  /** 工作区相对路径（Windows 分隔符按 `/` 归一）。 */
  path: string
  language: string
  /** 当前文档的作用域符号（一般是 `documentSymbol` 的顶层/扁平结果）。 */
  outline: readonly VisionSymbol[]
  /** 当前文件的诊断（`ProblemRow` 的最小字段集）。 */
  problems: readonly VisionProblem[]
  /**
   * 每个符号的**用法数**（上游 `UsagesCountManager.countMemberUsages`，
   * `java/java-impl/src/com/intellij/codeInsight/daemon/impl/JavaTelescope.java:45-51`）。
   * 本仓没有常驻的 usages 计数服务，这一份由 `src/cvLocalVision.ts` 按符号逐个问
   * LSP `textDocument/references` 灌进来；没灌 = 这一档不产条目（不是产 0）。
   */
  usages?: readonly VisionSymbolCount[]
  /** 每个类/接口的**继承者数**（上游 `JavaTelescope.collectInheritingClasses`，同文件 `:115-131`）。 */
  inheritors?: readonly VisionSymbolCount[]
}

/** 作用域符号：本模块只关心名字与区间（不依赖 `bridge.ts` 的完整类型）。 */
export interface VisionSymbol {
  name: string
  kind: number
  startLine: number
  endLine: number
  /**
   * 符号**名字**的起始列（LSP `DocumentSymbol.selectionRange.start.character`，
   * 本仓宿主把它落在 `startChar` 上，见 `native/lsp_support.cpp:163-176` 的 `collect_symbols`）。
   * 用法/继承者两类计数要按这个点问语言服务，所以 `src/cvLocalVision.ts` 会带上；
   * `problems` 那一档只用行号 ⇒ 这一项可选。
   */
  startChar?: number
}

/** 诊断：严重度 + 位置（同 `src/problems.ts` 的 `ProblemRow` 子集）。 */
export interface VisionProblem {
  line: number
  severity: number
}

/** 一个本地提供者：`isAvailableFor(ctx)` → `computeForDocument(ctx)`。 */
export interface CodeVisionProvider {
  id: string
  /** 适用语言（空 = 全部语言）。 */
  languages?: readonly string[]
  isAvailableFor: (context: CodeVisionContext) => boolean
  computeForDocument: (context: CodeVisionContext) => CodeVisionEntry[]
}

/** 能当锚点的符号（与 `stickyLines` 同一张通用白名单，字段/变量不是作用域）。 */
const ANCHOR_KINDS: ReadonlySet<number> = new Set([2, 3, 4, 5, 6, 9, 10, 11, 12, 23])

function symbolHasLine(symbol: VisionSymbol): boolean {
  return Number.isInteger(symbol.startLine) && Number.isInteger(symbol.endLine)
    && symbol.startLine >= 0 && symbol.endLine >= symbol.startLine
}

/** 诊断落在符号区间里吗（0 基闭区间）。 */
export function problemInsideSymbol(problem: VisionProblem, symbol: VisionSymbol): boolean {
  return Number.isInteger(problem.line) && problem.line >= symbol.startLine && problem.line <= symbol.endLine
}

/**
 * 内置 `problems` 提供者：**最内层**符号认领诊断（一个类里的方法报错时，错误记在方法上，
 * 类上只统计没被方法认领的那部分）—— 与 IDEA 把 ErrorStripe 挂在最近元素上是同一口径。
 * 只产出 count > 0 的条目；错误优先，全是警告时显示警告数。
 */
export function problemsVisionProvider(): CodeVisionProvider {
  return {
    id: 'problems',
    isAvailableFor: context => Array.isArray(context.outline) && Array.isArray(context.problems) && context.problems.length > 0,
    computeForDocument: context => {
      const anchors = context.outline.filter(symbol => ANCHOR_KINDS.has(symbol.kind) && symbolHasLine(symbol) && typeof symbol.name === 'string' && symbol.name !== '')
      // 最内层认领：每条诊断归给它所属的、区间最小的锚点。
      const owner = new Map<VisionSymbol, { errors: number; warnings: number }>()
      for (const problem of context.problems) {
        if (!Number.isInteger(problem.line)) continue
        let best: VisionSymbol | undefined
        for (const symbol of anchors) {
          if (!problemInsideSymbol(problem, symbol)) continue
          if (!best || symbol.endLine - symbol.startLine < best.endLine - best.startLine) best = symbol
        }
        if (!best) continue
        const counts = owner.get(best) ?? { errors: 0, warnings: 0 }
        if (problem.severity === 1) ++counts.errors
        else if (problem.severity === 2) ++counts.warnings
        else continue
        owner.set(best, counts)
      }
      const entries: CodeVisionEntry[] = []
      for (const [symbol, counts] of owner) {
        const parts: string[] = []
        if (counts.errors) parts.push(`${counts.errors} 个错误`)
        if (counts.warnings) parts.push(`${counts.warnings} 个警告`)
        if (!parts.length) continue
        entries.push({
          line: symbol.startLine,
          title: parts.join('，'),
          command: 'codeVision.showProblems',
          arguments: [{ path: context.path, line: symbol.startLine }],
        })
      }
      return entries
    },
  }
}

/** 注册表：按 id 覆盖注册（同名替换），计算时按语言过滤并展平条目。 */
/**
 * 本地条目的点击动作（上游是 provider 的 `handleClick`，不是 LSP 命令）：
 *   · usages → `GotoDeclarationAction.startFindUsages`（`ReferencesCodeVisionProvider.kt:12-14`）；
 *   · inheritors → 显示继承者列表（`InheritorsCodeVisionProvider` 的 `handleClick` 同一形状）；
 *   · problems → 跳到该符号的第一个问题。
 * 名字带 `codeVision.` 前缀**故意**与 LSP 命令空间区分开：这三条不是服务端命令，
 * 把 `workspace/executeCommand` 打给语言服务只会得到「未注册的命令」，
 * 所以必须在 IDE 侧路由 —— 收口函数就是下面的 `localCodeVisionAction`。
 */
export const CODE_VISION_SHOW_USAGES = 'codeVision.showUsages'
export const CODE_VISION_SHOW_INHERITORS = 'codeVision.showInheritors'
export const CODE_VISION_SHOW_PROBLEMS = 'codeVision.showProblems'

/** 一条本地点击条目要做的 IDE 动作（`none` = 这不是本地动作，交回服务端命令链）。 */
export type LocalCodeVisionAction =
  | { kind: 'findUsages'; path: string; line: number; character: number; symbol: string }
  | { kind: 'showInheritors'; path: string; line: number; character: number; symbol: string }
  | { kind: 'showProblems'; path: string; line: number }
  | { kind: 'none' }

/**
 * 把本地条目的命令与参数收成一次 IDE 动作。参数由本模块自己产（见下面两个 provider），
 * 所以这里**逐项核对**而不是假定：路径/行列/名字缺失就退回 `none`
 * （宁可点了没反应，也不带着半个坐标去跳转）。
 */
export function localCodeVisionAction(command: string, args?: readonly unknown[]): LocalCodeVisionAction {
  const arg = Array.isArray(args) ? args[0] : undefined
  const raw = arg && typeof arg === 'object' && !Array.isArray(arg) ? arg as Record<string, unknown> : undefined
  const path = typeof raw?.path === 'string' ? raw.path : ''
  const line = raw?.line
  if (!path || !Number.isInteger(line) || (line as number) < 0) return { kind: 'none' }
  if (command === CODE_VISION_SHOW_PROBLEMS) return { kind: 'showProblems', path, line: line as number }
  const character = raw?.character
  const symbol = typeof raw?.symbol === 'string' ? raw.symbol : ''
  if (!Number.isInteger(character) || (character as number) < 0 || !symbol) return { kind: 'none' }
  if (command === CODE_VISION_SHOW_USAGES) return { kind: 'findUsages', path, line: line as number, character: character as number, symbol }
  if (command === CODE_VISION_SHOW_INHERITORS) return { kind: 'showInheritors', path, line: line as number, character: character as number, symbol }
  return { kind: 'none' }
}

/**
 * 文案：逐条取自上游中文包的 choice 格式，**不是**自己拼的中文。
 *   · `usages.telescope={0,choice, 0#0 个用法|1#1 个用法|2#{0,number} 个用法}`
 *     （中文包 `localization-zh.jar messages/JavaBundle.properties`；英文同键原文
 *     `java/openapi/resources/messages/JavaBundle.properties:1805`）；
 *   · `code.vision.implementations.hint` = `N 个实现`、`code.vision.inheritors.hint` = `N 个继承者`
 *     （英文 `JavaBundle.properties:1767-1768`）。
 * choice 的 `1#` 与 `2#` 两支在中文里都是「数字 + 量词」，所以这里就是一个模板串。
 */
export function usagesHintText(count: number): string { return `${count} 个用法` }

/** 类数「继承者」，接口数「实现」（`JavaInheritorsCodeVisionProvider.kt:36-40` 的 `isInterface` 分支）。 */
export function inheritorsHintText(count: number, containerKind: number): string {
  return containerKind === 11 ? `${count} 个实现` : `${count} 个继承者`
}

/**
 * usages 的锚点符号集：上游 `PsiMember`（类/方法/字段/属性），**排除类型参数** ——
 * `java/java-impl/src/com/intellij/codeInsight/daemon/impl/JavaReferencesCodeVisionProvider.kt:22`
 * 的 `acceptsElement(element: PsiElement): Boolean = element is PsiMember && element !is PsiTypeParameter`。
 * 订正留痕（2026-10-06 hlcache300）：原写 `:21`，实开那一行是**空行**（`:20` 是 `acceptsFile`），
 * 这条判据在 `:22`。
 */
const USAGE_ANCHOR_KINDS: ReadonlySet<number> = new Set([...ANCHOR_KINDS, 7, 8, 14])
/** inheritors 的锚点符号集：`PsiClass && !PsiTypeParameter || PsiMethod`（`JavaInheritorsCodeVisionProvider.kt:31`）。 */
const INHERITOR_ANCHOR_KINDS: ReadonlySet<number> = new Set([5, 6, 10, 11, 12, 23])

/** 这一行的计数**值得去问**吗（usages 提供者会锚它）。抓取层用这两个判据决定发几条请求。 */
export function isUsageAnchorKind(kind: number): boolean { return USAGE_ANCHOR_KINDS.has(kind) }
/** 同上，继承者提供者（类/接口/方法那一层，字段不数继承者）。 */
export function isInheritorAnchorKind(kind: number): boolean { return INHERITOR_ANCHOR_KINDS.has(kind) }

/** 计数表按符号的**名字位置**建索引（同一点重复出现只认第一次）。 */
function countByPosition(counts: readonly VisionSymbolCount[] | undefined): Map<string, number> {
  const table = new Map<string, number>()
  for (const entry of counts ?? [])
    if (Number.isInteger(entry.line) && Number.isInteger(entry.character) && Number.isInteger(entry.count) && entry.count >= 0)
      if (!table.has(`${entry.line}:${entry.character}`)) table.set(`${entry.line}:${entry.character}`, entry.count)
  return table
}

/**
 * 内置 `references` 提供者（上游 `JavaReferencesCodeVisionProvider`，id `java.references`，
 * 组 id `references` = `PlatformCodeVisionIds.kt:5` 的 `USAGES`）。
 * 锚点 = 符号声明行；条目 = 「N 个用法」，**0 也显示**（出厂阈值
 * `code.vision.java.minimal.usages` 缺省 0，`java/java-backend/resources/META-INF/JavaPlugin.xml:227`）。
 * 入口点不显示（`java/java-impl/src/com/intellij/codeInsight/daemon/impl/JavaReferencesCodeVisionProvider.kt:26`
 * 的 `if (inspection.isEntryPoint(element)) return null`）
 * —— 本仓从 LSP 符号表判得到的入口点只有 `main`；测试方法、带框架注解的入口要靠 PSI 与注解，
 * 判不到就不装判（已登记进报告的「做不到」）。
 * 订正留痕（2026-10-06 hlcache300）：原写 `:25`，实开那一行取的是 `findUnusedDeclarationInspection(element)`
 * （赋值语句），`return null` 那条判据在 `:26`。
 */
export function usagesVisionProvider(): CodeVisionProvider {
  return {
    id: 'references',
    isAvailableFor: context => Array.isArray(context.usages) && context.usages.length > 0,
    computeForDocument: context => {
      const table = countByPosition(context.usages)
      const entries: CodeVisionEntry[] = []
      for (const symbol of context.outline) {
        if (!USAGE_ANCHOR_KINDS.has(symbol.kind) || !symbolHasLine(symbol)) continue
        if (symbol.kind === 6 && symbol.name === 'main') continue
        const count = table.get(`${symbol.startLine}:${symbol.startChar}`)
        if (count === undefined) continue
        entries.push({
          line: symbol.startLine,
          title: usagesHintText(count),
          command: CODE_VISION_SHOW_USAGES,
          arguments: [{ path: context.path, line: symbol.startLine, character: symbol.startChar, symbol: symbol.name }],
        })
      }
      return entries
    },
  }
}

/**
 * 内置 `inheritors` 提供者（上游 `JavaInheritorsCodeVisionProvider.kt:33-44`）：
 * **只在计数 > 0 时**产条目（`:37` 与 `:43` 那两个 `> 0`），类与接口分文案。
 */
export function inheritorsVisionProvider(): CodeVisionProvider {
  return {
    id: 'inheritors',
    isAvailableFor: context => Array.isArray(context.inheritors) && context.inheritors.length > 0,
    computeForDocument: context => {
      const table = countByPosition(context.inheritors)
      const entries: CodeVisionEntry[] = []
      for (const symbol of context.outline) {
        if (!INHERITOR_ANCHOR_KINDS.has(symbol.kind) || !symbolHasLine(symbol)) continue
        const count = table.get(`${symbol.startLine}:${symbol.startChar}`)
        if (!count) continue
        entries.push({
          line: symbol.startLine,
          title: inheritorsHintText(count, symbol.kind),
          command: CODE_VISION_SHOW_INHERITORS,
          arguments: [{ path: context.path, line: symbol.startLine, character: symbol.startChar, symbol: symbol.name }],
        })
      }
      return entries
    },
  }
}

export interface CodeVisionRegistry {
  register: (provider: CodeVisionProvider) => void
  providers: () => readonly CodeVisionProvider[]
  compute: (context: CodeVisionContext) => CodeVisionEntry[]
}

export function candidateProviders(providers: readonly CodeVisionProvider[], context: CodeVisionContext): CodeVisionProvider[] {
  return providers.filter(provider => {
    if (provider.languages && provider.languages.length && !provider.languages.includes(context.language)) return false
    return provider.isAvailableFor(context)
  })
}

export function createCodeVisionRegistry(initial?: readonly CodeVisionProvider[]): CodeVisionRegistry {
  const table = new Map<string, CodeVisionProvider>()
  // 缺省初始集合从 EP 取（与 `src/inlayProviderRegistry.ts` 同一条纪律）：三个内置提供者
  // 作为 bundled 贡献登记进 `com.intellij.codeInsight.codeVisionProvider`，第三方也能按同一个
  // id 挂进来。显式传 `initial` 的调用方（测试/定制宿主）仍以它为准。
  for (const provider of initial ?? codeVisionProvidersFromExtensions()) table.set(provider.id, provider)
  return {
    register: provider => {
      // 只进本注册表（与上游 `CodeVisionProvider.EP_NAME` 的静态贡献面区分开）：要挂进 EP 让
      // 别的消费方看见，走 `src/extensionPoints.ts` 的 `EXTENSIONS.registerExtension(CODE_VISION_PROVIDER_EP, …)`
      // —— 这里不镜像，是因为 `register` 常被用来「顶掉内置那一条做定制」，镜像会污染全局 EP
      //（同一个进程里后续 `createCodeVisionRegistry()` 会拿到定制版，判据会假绿）。
      table.set(provider.id, provider)
    },
    providers: () => [...table.values()],
    compute: context => {
      const entries: CodeVisionEntry[] = []
      for (const provider of candidateProviders([...table.values()], context))
        for (const entry of provider.computeForDocument(context))
          if (Number.isInteger(entry.line) && entry.line >= 0 && typeof entry.title === 'string' && entry.title !== '' && typeof entry.command === 'string' && entry.command !== '')
            // provider id 在这一层补上（provider 自己产条目时不必重复声明自己是谁），
            // 右键隐藏那一组才找得到归属（见 `CodeVisionEntry.providerId`）。
            entries.push({ ...entry, providerId: entry.providerId ?? provider.id })
      return entries
    },
  }
}

// 三个内置提供者作为 bundled 贡献挂进 EP（幂等：模块加载时一次）。
declareCodeVisionExtensionPoints()
for (const provider of [problemsVisionProvider(), usagesVisionProvider(), inheritorsVisionProvider()])
  EXTENSIONS.registerExtension(CODE_VISION_PROVIDER_EP, provider.id, provider, { source: 'bundled' })

/** 与服务端 lens 合流：**同一行同标题去重**（本地优先），再按行升序、同行保持本地在前。 */
export function mergeCodeVisionEntries(local: readonly CodeVisionEntry[], server: readonly CodeVisionEntry[]): CodeVisionEntry[] {
  const seen = new Set(local.map(entry => `${entry.line}:${entry.title}`))
  const merged = [...local]
  for (const entry of server) {
    const key = `${entry.line}:${entry.title}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(entry)
  }
  return merged.map((entry, index) => ({ entry, index }))
    .sort((left, right) => left.entry.line - right.entry.line || left.index - right.index)
    .map(({ entry }) => entry)
}

/**
 * 渲染通道那一侧的形状：与 `src/codeLens.ts` 的 `AnchoredLens` **结构同形**（这里另起一个名字是
 * 为了本模块继续不 import 渲染层，见文件头「纯数据层」那条）。`codeLensExtension.ts` 直接把它
 * 当 `AnchoredLens[]` 用。
 */
export interface AnchoredCodeVisionEntry {
  line: number
  item: {
    title: string
    command: string
    arguments?: unknown[]
    providerId?: string
    /** 零宽区间，锚在行首。 */
    range: { startLine: number; startChar: number; endLine: number; endChar: number }
  }
}

/**
 * 本地条目 → 渲染通道的锚点。
 *
 * 区间是**零宽且在行首**（`startChar = endChar = 0`），这不是编造：上游 `CodeVisionProvider`
 * 的条目只声明「挂在哪一行」（EP 条目自己带 `place`,见 `CodeVisionProvider` 的
 * `computeForEditor` 返回的 `CodeVisionEntry`），列号在本地通道里**没有数据来源**，
 * 所以给 0 而不是猜一个。渲染侧（`groupAnchoredLenses`）只用区间做同锚点归并，
 * 零宽区间与「这一行只有一个本地条目」是同一件事。
 */
export function anchorCodeVisionEntries(entries: readonly CodeVisionEntry[]): AnchoredCodeVisionEntry[] {
  const out: AnchoredCodeVisionEntry[] = []
  for (const entry of entries) {
    if (!Number.isInteger(entry.line) || entry.line < 0) continue
    if (typeof entry.title !== 'string' || entry.title === '') continue
    if (typeof entry.command !== 'string' || entry.command === '') continue
    out.push({
      line: entry.line,
      item: { title: entry.title, command: entry.command, arguments: entry.arguments,
              providerId: entry.providerId,
              range: { startLine: entry.line, startChar: 0, endLine: entry.line, endChar: 0 } },
    })
  }
  return out
}
