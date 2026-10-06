// 粘性行的**语言提供者**（上游 `platform/lang-impl/src/com/intellij/codeInsight/stickyLines/`：
// `StickyLinesProvider` 挂在 EP 上，由每种语言自己声明「哪些节点算作用域、按什么顺序叠」；
// 通用那一份在 `editor.stickyLines` 的基础实现里，语言侧只做增补）。
//
// 本仓现状（`src/stickyLines.ts`）：一张**通用**白名单（Module/Namespace/Package/Class/Method/
// Constructor/Enum/Interface/Function/Struct）对四种编辑器语言一视同仁。IDEA 的差别在于：
//   · Java：作用域 = 类型 → 方法/构造器；**字段与局部变量不进**（一屏字段名会把方法挤没）；
//   · C/C++：`struct`/`union`（LSP kind 23）与命名空间要算一层，`enum` 也算；
//   · TypeScript：接口/枚举/命名空间都算，函数与方法同权；
//   · 其它语言（Python/Go/Rust…）：`package`/`module` 这种**整文件层**不算 —— 它会在每一行都
//     占着第一格，把真正的类名/函数名往下挤（IDEA 的 Python provider 也不把模块当粘性层）。
//
// 这里把差别落成「语言 → 可接受的 SymbolKind 集合」的纯表 + 一个族级兜底；`stickyLines.ts`
// 的 `stickyScopes` 在接线时先过这一层（`filterStickySymbols`），再去重、排序、截断。
//
// LSP `SymbolKind` 编号（规范 3.17）：1 File / 2 Module / 3 Namespace / 4 Package / 5 Class /
// 6 Method / 7 Property / 8 Field / 9 Constructor / 10 Enum / 11 Interface / 12 Function /
// 13 Variable / 14 Constant / 22 EnumMember / 23 Struct / 26 TypeParameter。

/** 一条提供者：语言集合 + 可当作用域的 kind + 展示名（IDEA 的 provider 也有 id 与适用语言）。 */
export interface StickyLineProvider {
  id: string
  /** 适用的编辑器语言（与 `src/languages.ts` 的 `EDITOR_LANGUAGES` 同一套；空 = 全部）。 */
  languages: readonly string[]
  /** 能当作用域的 LSP `SymbolKind`。 */
  scopeKinds: readonly number[]
}

/** 通用兜底：四种语言都算，但**不含** `Package`/`Module` 这两个整文件层。 */
export const COMMON_SCOPE_KINDS: readonly number[] = [3, 5, 6, 9, 10, 11, 12, 23]

/** 提供者表（顺序 = 匹配优先级；一条语言可命中多条时取**并集**）。 */
export const STICKY_LINE_PROVIDERS: readonly StickyLineProvider[] = [
  // Java：类型 → 方法/构造器。字段/变量/常量不进（上游 `JavaStickyLinesProvider` 的口径）。
  { id: 'java', languages: ['java'], scopeKinds: [5, 6, 9, 10, 11] },
  // C/C++：namespace 与 struct/union 也要算（`class` 与 `struct` 都可能是一个翻译单元的作用域）。
  { id: 'cpp', languages: ['cpp'], scopeKinds: [3, 5, 6, 9, 10, 11, 12, 23] },
  // TypeScript：接口/枚举/命名空间都算，函数与方法同权。
  { id: 'typescript', languages: ['typescript'], scopeKinds: [2, 3, 5, 6, 9, 10, 11, 12] },
  // 其余语言走通用兜底（`module` 那种一层包住整文件的种类去掉）。
  { id: 'common', languages: [], scopeKinds: COMMON_SCOPE_KINDS },
]

/** 兜底那一条（`languages` 为空 = 适用全部）不算一门语言，见 `stickySupportedLanguageIds`。 */
const FALLBACK_PROVIDER = 'common'

/**
 * 同族写法 → 规范语言 id。**这就是上游那条 baseLanguage 链在本仓的形态**：
 * `StickyLinesLanguageSupport.kt:31-43` 的 `supportedLang(lang)` 拿着编辑器给的语言
 * `while (supported != null) { if (supported in supportedLanguages) return supported; supported = supported.baseLanguage }`
 * （`:34-40`），`:32` 的注释原文举例 `// example: ECMAScript6 -> JavaScript`；
 * 本仓没有 `Language` 对象图，只有字符串 id（`src/languages.ts:8` 的规范档全小写）⇒ 链落成这张表。
 * 每条都对得上**本仓已有**的等价类（`src/appLanguageLabels.ts:25-28`：`.c|.cpp|.h|.hpp|.cc|.cxx`
 * 都显示成 C++、`.tsx?` 显示成 TypeScript、`.[cm]?jsx?` 显示成 JavaScript），
 * 所以这不是上游那张表的逐字移植，是架构不等价下的本仓形态（留痕）。
 * 为什么值得补这一道：宿主交给粘性行的语言写法来自项目设置里的**关联表**
 * （`src/fileTypeDetection.ts:266-267` 把 `associations[extension]` 原样返回，不过白名单），
 * 用户写 `Java` / `TSX` / `C++` 时精确比对会一路掉到通用兜底表 —— Java 因此误收 `struct`(23)、
 * TypeScript 因此丢掉 `module`(2)。
 */
export const STICKY_BASE_LANGUAGES: Readonly<Record<string, string>> = {
  c: 'cpp', cc: 'cpp', cxx: 'cpp', 'c++': 'cpp', h: 'cpp', hpp: 'cpp',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ecmascript: 'javascript', ecmascript6: 'javascript',
}

/** 写法归一（本仓规范 id 全小写，`src/languages.ts:8`；关联值是用户手输的，可能带空白/大写）。 */
function normalizeStickyLanguage(language: string): string {
  return language.trim().toLowerCase()
}

/**
 * provider 表**注册过**哪些语言 —— 上游那份注册面是 `StickyLinesLanguageSupport.kt:45-52`
 * 遍历 `BreadcrumbsProvider.EP_NAME.extensionList` 取的并集（EP 一变就重算，`:54-59`；
 * 文件类型变了也重算，`:61-68`）。本仓的 EP 等价物就是 `STICKY_LINE_PROVIDERS`，
 * 所以注册面由它推导，而不是再手抄一份语言清单（抄第二份就会有不一致的那一步）。
 * 顺序 = 表的顺序、去重；`languages` 为空的兜底项**不算**一门语言。
 */
export function stickySupportedLanguageIds(): string[] {
  const ids: string[] = []
  for (const provider of STICKY_LINE_PROVIDERS) {
    if (provider.languages.length === 0 && provider.id === FALLBACK_PROVIDER) continue
    for (const language of provider.languages) if (!ids.includes(language)) ids.push(language)
  }
  return ids
}

/**
 * 把编辑器给的**语言写法**解析成这一层真正认的那一门（上游 `supportedLang:31-43`）：
 * 归一 → 沿 `STICKY_BASE_LANGUAGES` 往上走，返回第一个被 provider 注册过的语言；
 * 整条链都没注册就**原样返回归一后的那一个**（`:41 return lang`），不硬塞成某个相近的档
 * —— 上游 javascript 一族没注册 provider 时也是原样返回，本仓同形状（于是走通用兜底表）。
 * `undefined` 原样给回 `undefined`：语言还没定时由全局那条 `showStickyLines` 闸管
 * （上游 `EditorSettingsState.kt:217-224` 的 `?: true`，注释原文
 * "Return true to avoid the late appearance of the sticky panel"）。
 */
export function resolveStickyLanguage(language: string | undefined): string | undefined {
  if (language === undefined) return undefined
  const start = normalizeStickyLanguage(language)
  const supported = new Set(stickySupportedLanguageIds())
  const walked = new Set<string>()
  let current: string | undefined = start
  while (current !== undefined && !walked.has(current)) {
    if (supported.has(current)) return current
    walked.add(current)
    current = STICKY_BASE_LANGUAGES[current]
  }
  return start
}

/**
 * 这个语言适用哪些提供者：**语言专属优先**，只有一条专属都没命中时才退回通用兜底。
 * （不是「专属 ∪ 通用」：通用表里有 `struct`，对 Java 取并集会多出一层 `struct`；上游的
 * EP 注册也是按语言查表，语言自己有 provider 时不落到默认那一份。）
 * 匹配之前先过 `resolveStickyLanguage` —— 与 `stickyLinesShownForLanguage` 用的是**同一个**解析结果，
 * 不会出现「kind 表认了 java、开关表没认」那种两边各认各的。
 */
export function stickyProvidersFor(language: string): readonly StickyLineProvider[] {
  const resolved = resolveStickyLanguage(language) ?? ''
  const specific = STICKY_LINE_PROVIDERS.filter(provider => provider.languages.length > 0 && provider.languages.includes(resolved))
  if (specific.length) return specific
  // 表里总有 `common`（languages 为空），所以这里不会返回空数组。
  return STICKY_LINE_PROVIDERS.filter(provider => provider.languages.length === 0)
}

/**
 * 该语言的可当作用域的 kind 集合（多条提供者命中时取并集）。
 * 未知语言 = 通用集合；`undefined`/空串按未知处理（编辑器还没判出语言时的默认档）。
 */
export function stickyScopeKindsFor(language: string | undefined): ReadonlySet<number> {
  const providers = stickyProvidersFor(typeof language === 'string' ? language : '')
  const kinds = new Set<number>()
  for (const provider of providers) for (const kind of provider.scopeKinds) kinds.add(kind)
  return kinds
}

/** 文档符号能不能当这个语言的粘性层：kind 在提供者表里、行号合法、名字非空。 */
export function stickySymbolAccepted(symbol: { kind: number; name: string; startLine: number; endLine: number }, language: string | undefined): boolean {
  if (!stickyScopeKindsFor(language).has(symbol.kind)) return false
  return Number.isInteger(symbol.startLine) && Number.isInteger(symbol.endLine)
    && symbol.startLine >= 0 && symbol.endLine >= symbol.startLine
    && typeof symbol.name === 'string' && symbol.name !== ''
}

/**
 * 按语言过滤一份 documentSymbol（接线层在 `stickyScopes` 之前调用）。
 * 结构类型入参，避免这个纯表反向依赖 `bridge.ts`。
 */
export function filterStickySymbols<T extends { kind: number; name: string; startLine: number; endLine: number }>(
  symbols: readonly T[], language: string | undefined,
): T[] {
  return symbols.filter(symbol => stickySymbolAccepted(symbol, language))
}

/**
 * 这一语言的粘性行还显示吗 —— 上游 `EditorSettingsExternalizable.areStickyLinesShownFor:520-526`：
 * 表里**没记**的语言一律显示（`if (visible == null) return true`，注释原文
 * "enabled for all languages by default"），只有显式记成 false 的那一项才关。
 * 语言还没定（`undefined`）时同「没记」处理 —— 全局那条 `showStickyLines` 才是总闸。
 *
 * 写这一项的入口上游有两处：弹层动作 `actions/StickyLinesDisableForLangAction.kt:24-29`
 * （`setStickyLinesShownFor(language.id, false)`）与设置页的语言复选框
 * （`configurable/StickyLinesConfigurableUI.kt:52-62`）；两者都要一个新的持久化键
 * （`PropNames.PROP_SHOW_STICKY_LINES_PER_LANGUAGE = "showStickyLinesPerLanguage"`，
 * `EditorSettingsExternalizable.java:1232`）—— 本仓的设置键表在冻结文件里 ⇒ 交接线请求。
 */
export function stickyLinesShownForLanguage(
  shownPerLanguage: Record<string, boolean> | undefined, language: string | undefined,
): boolean {
  if (!shownPerLanguage || language === undefined) return true
  // 读的那一侧先过一遍解析（上游同一顺序：`supportedLang(it)` 之后才 `areStickyLinesShownFor(lang.id)`），
  // 表里存的键就是解析后的规范 id —— 两侧不过同一道，会出现 kind 表认了、开关表没认。
  const resolved = resolveStickyLanguage(language) ?? ''
  return shownPerLanguage[resolved] ?? true
}
