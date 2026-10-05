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

/**
 * 这个语言适用哪些提供者：**语言专属优先**，只有一条专属都没命中时才退回通用兜底。
 * （不是「专属 ∪ 通用」：通用表里有 `struct`，对 Java 取并集会多出一层 `struct`；上游的
 * EP 注册也是按语言查表，语言自己有 provider 时不落到默认那一份。）
 */
export function stickyProvidersFor(language: string): readonly StickyLineProvider[] {
  const specific = STICKY_LINE_PROVIDERS.filter(provider => provider.languages.length > 0 && provider.languages.includes(language))
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
