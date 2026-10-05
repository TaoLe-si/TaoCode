// **符号型文档 target** —— 上游 `platform/lang-impl/src/com/intellij/lang/documentation/symbol/impl/
// DefaultTargetSymbolDocumentationTargetProvider.kt:18-20` 的等价物。
//
// 上游那一条链（判决 `docs/inventory/verdict-platform_rest.md` 的 `lp/documentation`，
// 「缺：符号型 target」那一行点名的就是它）：
//   · `documentationTargets(file, offset)` → `targetSymbols(file, offset)`（PSI 引用解析出 `Symbol`）
//     → `symbolDocumentationTargets(project, symbols)`（`:27-41`）：先问 `SymbolDocumentationTargetProvider`
//     扩展点，再退到 `DocumentationSymbol.documentationTarget`（`:34-36`），最后 `DocumentationTarget` 本身。
//   · 拿到 target 之后 `DocumentationManager.getTargetDocumentation` 才去取 HTML。
// 也就是说上游的"文档"入口是**一个符号**，不是"光标下的文本"。用户看到的效果是：
// javadoc 里的 `{@link Foo#bar(int)}` 点下去 → 换一页，显示 `Foo#bar` 的文档
// （`DocumentationBrowserHistory.nextPage()` 就是被这一次点击压进历史的，`:43-47`）。
//
// 本仓没有 PSI，但有同一条链的两半，而且都是服务器提供的真数据：
//   ① 「符号名 → 声明位置」：LSP `workspace/symbol`（上游 `LspWorkspaceSymbolContributor.kt:44-89`）
//      + `documentSymbol`（上游 `LspStructureViewSupport.kt`）。本仓的转换/去重/排序已经在
//      `src/lspSymbolBridge.ts`，这里直接复用，不再抄第二份。
//   ② 「位置 → 文档」：LSP `textDocument/hover`（`src/quickDocHost.ts` 走的那一条，带 hover 缓存）。
// 所以这里只做上游那半件事：**把一个 javadoc 引用名拆成"容器 + 成员"，按上游的两步解析顺序落成
// 一个可取文档的位置**。拆不出来就返回 null（调用方如实说"解析不出这个符号"），**不猜位置**。
//
// 拆法逐条照 javadoc 的引用语法（`DocCommentReferenceParser` 认的那四种形态）：
//   · `#bar(int)`        —— 当前类的成员（`selfReference`）；
//   · `Foo` / `pkg.Foo`  —— 一个类型；
//   · `Foo#bar(int)` / `Foo.bar` —— `Foo` 里的成员 `bar`；
//   · 尾部 `(int, String)` 是**参数表**，不参与名字匹配（上游 `DocCommentLineDataBuilder.java:81-89`
//     取参数名时也是"跳过一个词"，括号里的东西从不进符号名）。
// 与上游的差异（如实）：上游解析出来的 `Symbol` 可以带多个候选（重载、协变覆盖），
// `symbolDocumentationTargets` 用 `LinkedHashSet` 去重后**全部**交给文档面（`:28-31`）；
// 本仓一次点击只落一个位置（`workspace/symbol` 的结果本身就可能有多条同名，取排序后的第一条，
// 排序口径来自 `mergeWorkspaceSymbols`），并把**用的是哪一条**写进页面的 `origin`，
// 免得用户以为看到的是"所有重载"的文档。

/** 一次解析能拿到的符号事实（`LspSymbolsResult.symbols` 的子集，两种请求都给得出）。 */
export interface DocSymbolFact {
  name: string
  kind: number
  path: string
  line: number
  character: number
}

/** 一条文档引用拆出来的两半。 */
export interface DocReference {
  /** 容器（类/接口）名；`#bar` 这种自引用时为空串。 */
  container: string
  /** 成员名；纯类型引用时为空串。 */
  member: string
  /** 参数表原文（`(int, String)`），只用于显示，不参与匹配。 */
  parameters: string
}

/** 解析结果：位置 + 用到的符号 + 给用户看的"这是哪个符号"。 */
export interface DocSymbolTarget {
  path: string
  line: number
  character: number
  /** 命中的符号名（`Foo` 或 `bar`）。 */
  symbol: string
  /** 这一页是从哪条引用跳来的（弹层标题栏那行）。 */
  origin: string
}

/** 拆引用需要的两次查询：文件内符号 / 工作区符号。由调用方注入（本模块不 import bridge）。 */
export interface DocSymbolQueries {
  /** 某个文件的 `documentSymbol` 扁平结果。没有该文件时返回空数组。 */
  symbolsInFile: (path: string) => Promise<DocSymbolFact[]>
  /** `workspace/symbol`（query 是符号名）。没有结果时返回空数组。 */
  workspaceSymbols: (query: string) => Promise<DocSymbolFact[]>
}

const PARAM_LIST = /\(([^)]*)\)/

/**
 * 一条 javadoc 引用 → 容器 + 成员 + 参数表。
 * `Foo#bar(int)` / `Foo.bar` / `#bar` / `pkg.sub.Foo` / `Foo` 都吃得下；
 * 空串或纯参数表（`()`）返回 null —— 那时**没有名字可查**，不是"查不到"。
 */
export function parseDocReference(raw: string): DocReference | null {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return null
  const parameters = PARAM_LIST.exec(trimmed)?.[0] ?? ''
  const body = (PARAM_LIST.test(trimmed) ? trimmed.replace(PARAM_LIST, '') : trimmed).trim()
  if (!body) return null
  // `#bar` 是当前类的自引用；`Foo#new` / `new` 是构造器引用，`new` 不是成员名 ⇒ 只查容器。
  if (body === 'new') return { container: '', member: 'new', parameters }
  const self = body.startsWith('#')
  const head = self ? body.slice(1) : body
  const separator = Math.max(head.lastIndexOf('#'), head.lastIndexOf('.'))
  if (separator <= 0) return self ? { container: '', member: head, parameters } : { container: head, member: '', parameters }
  const container = head.slice(0, separator)
  const member = head.slice(separator + 1)
  return member === 'new' ? { container, member: '', parameters } : { container, member, parameters }
}

/** 名字匹配档：精确 > 忽略大小写精确 > 末段精确 > 前缀 > 包含。都不中时 -1（不要拿它当命中）。 */
function nameRank(name: string, wanted: string): number {
  if (!wanted) return -1
  if (name === wanted) return 0
  if (name.toLocaleLowerCase() === wanted.toLocaleLowerCase()) return 1
  // `pkg.sub.Foo` 这类带包名的结果：末段相等就算同一个类型（`workspace/symbol` 常返回全限定名）。
  if (lastSegment(name) === wanted) return 2
  if (name.startsWith(wanted)) return 3
  if (name.includes(wanted)) return 4
  return -1
}

/** 限定名的最后一段（`.` 与 `#` 都算分隔符，javadoc 两种都用）。 */
function lastSegment(name: string): string {
  const dot = name.lastIndexOf('.')
  const hash = name.lastIndexOf('#')
  return name.slice(Math.max(dot, hash) + 1)
}

/** 档内稳定取第一条（`mergeWorkspaceSymbols` 已经排过序，这里不能再打乱它）。 */
function bestMatch(candidates: readonly DocSymbolFact[], wanted: string): DocSymbolFact | null {
  let chosen: DocSymbolFact | null = null
  let chosenRank = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    if (!candidate?.name || !candidate.path || !Number.isFinite(candidate.line)) continue
    const rank = nameRank(candidate.name, wanted)
    if (rank < 0) continue
    if (rank < chosenRank) { chosen = candidate; chosenRank = rank }
  }
  return chosen
}

/**
 * 一条文档引用 → 可取文档的位置。
 *
 * 两步解析，顺序与上游一致（先定位**容器**，再在容器所在文件里找**成员**）：
 *   · `Foo#bar` → `workspace/symbol(Foo)` 找到 `Foo` 的声明文件 → 那个文件的 `documentSymbol` 里找 `bar`；
 *   · `#bar`（自引用）→ 只在**当前文件**的 `documentSymbol` 里找；
 *   · 单个名字 `bar` → 先当前文件（`{@link bar}` 多数指同类成员），查不着再走 `workspace/symbol`。
 * 每一步都只在"名字真的对上"时才返回；全部落空返回 null。
 */
export async function resolveDocSymbolTarget(
  raw: string,
  currentPath: string,
  queries: DocSymbolQueries,
): Promise<DocSymbolTarget | null> {
  const reference = parseDocReference(raw)
  if (!reference) return null
  const origin = `${reference.container ? `${reference.container}#` : ''}${reference.member || reference.container}`
  if (reference.container && reference.member) {
    const container = bestMatch(await queries.workspaceSymbols(reference.container), reference.container)
    if (!container) return null
    const member = bestMatch(await queries.symbolsInFile(container.path), reference.member)
    if (member) return { path: member.path, line: member.line, character: member.character, symbol: member.name, origin }
    // 容器找到了但成员不在那个文件里：上游这时会沿继承图往上找（PSI 解析），本仓没有继承图。
    // ⇒ 落回**容器**的文档，并把 origin 写成容器名：显示的是 `Foo` 的文档就照实标 `Foo`，
    //   不假装是 `Foo#bar` 的（宁可少给一页，也不给一页对不上号的）。
    return { path: container.path, line: container.line, character: container.character, symbol: container.name, origin: container.name }
  }
  const wanted = reference.member || reference.container
  if (!wanted) return null
  const inFile = bestMatch(await queries.symbolsInFile(currentPath), wanted)
  if (inFile) return { path: currentPath, line: inFile.line, character: inFile.character, symbol: inFile.name, origin: inFile.name }
  if (reference.member && !reference.container) return null
  const global = bestMatch(await queries.workspaceSymbols(wanted), wanted)
  if (!global) return null
  return { path: global.path, line: global.line, character: global.character, symbol: global.name, origin: global.name }
}

/**
 * `DocLink` 里能当符号引用的那一条：内部链接（`{@link Foo#bar}`）。
 * `#锚点` 与外部链接不是符号，直接排除（上游也一样：`symbolDocumentationTargets` 只吃 `Symbol`）；
 * **带路径分隔符的也不是** —— `file:` 与相对路径链接走的是导航那条路
 * （`src/quickDocHost.ts` 的 `followInternalDocLink`），拿 `src/Foo.java` 去当符号查会得到一个
 * 叫 `java` 的"成员"，那是假命中。
 */
export function isSymbolDocReference(link: { kind: string; target: string } | undefined | null): boolean {
  if (!link) return false
  if (link.kind !== 'internal') return false
  if (/[/\\]/.test(link.target)) return false
  if (/^file:/i.test(link.target)) return false
  const reference = parseDocReference(link.target)
  return Boolean(reference && (reference.member || reference.container))
}
