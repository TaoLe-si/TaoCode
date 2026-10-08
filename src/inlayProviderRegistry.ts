// 内联提示的**本地提供者注册表**（上游 `platform/lang-api/src/com/intellij/codeInsight/hints/`：
// `InlayHintsProvider` 挂在 `com.intellij.codeInsight.inlayProvider` EP 上
// （`platform/lang-api/resources/intellij.platform.lang.xml:54-56`），`InlayHintsProviderFactory`
// 挂在 `com.intellij.codeInsight.inlayProviderFactory`（同文件 `:155-163`），多语言由 factory
// 一次给多个 `ProviderInfo`（`InlayHintsProviderFactory.kt:18-44`）。
// 本仓的提示**全来自语言服务**（LSP `textDocument/inlayHint`，`src/editorInlayHints.ts`），
// 服务器不认这个能力时行内一条都没有 —— 这正是「本地 provider 扩展点」这一条缺口。
//
// 本文件补：一个注册表 + 三个**纯文本可算**的内置提供者，产出的条目与服务端条目**同一形状**
// （`InlayHintLike`），所以归位/去重/渲染那条链（`src/inlayHintLayout.ts` + `editorInlayHints.ts`）
// 一行都不用改。三个内置提供者的口径都取自上游真有的 provider：
//   · `urlPath`（`UrlPathInlayHintsProviderFactory`，注册在 `intellij.platform.lang.impl.xml:1759`
//     的 `codeInsight.inlayProviderFactory`）—— 在 URL 字面量后面补它的**路径**提示；
//   · `parameterName`（`InlayParameterHintsProvider` 那一族）—— 在调用点的实参前补**形参名**。
//     本仓没有 PSI 与签名解析，所以只在**同文件里能读到声明**的那种调用上产条目（见下）；
//   · `lineAuthor`（`VcsCodeVisionProvider` 的 blame 面 / `CODE_AUTHOR_GROUP`）—— 在行尾补作者。
//
// 与语言服务的合流口径照 `src/codeVisionProviders.ts` 的 `mergeCodeVisionEntries`：**同位置同文本
// 去重、本地优先**；不同文本的同位置条目交给 `layoutInlayHints` 的同位置优先级（参数名 > 类型 > 其它）。
//
// 纯数据层：不 import vue/bridge，结构类型入参，便于单测（与 `codeVisionProviders.ts` 同一纪律）。

import type { InlayHintLike } from './inlayHints.ts'
import { EXTENSIONS, INLAY_PROVIDER_EP } from './extensionPoints.ts'
// 内联提示工厂（`com.intellij.codeInsight.inlayProviderFactory`）：第三方用一个工厂一次给多个
// 语言登记提供者，`collectAll` 按语言把工厂给的提供者并进候选集（`factoryInlayProvidersFor`）。
import {
  factoryInlayProvidersFor, registerInlayHintsProviderFactory, type InlayFactoryContext,
} from './inlayHintsExtensionPoints.ts'

/** 一个本地提供者能看到的上下文（结构类型，不依赖 `bridge.ts`）。 */
export interface InlayProviderContext {
  /** 工作区相对路径（正斜杠归一）。 */
  path: string
  language: string
  /** 当前文档全文。 */
  text: string
  /**
   * 逐行作者（`git.blame` 的口径：`{ line, author }`，行号 0 基；缺 = 这一行没有作者信息）。
   * 没有 git 通道时整项缺失 ⇒ `lineAuthor` 提供者不产任何条目（不写假作者）。
   */
  authors?: readonly InlayAuthorLine[]
}

/** 一行作者（`src/blameAnnotations.ts` 的 `BlameLineInput` 子集）。 */
export interface InlayAuthorLine {
  line: number
  author: string
}

/**
 * 一个本地提供者（上游 `InlayHintsProvider` 的等价物，只保留本仓能兑现的那几格）：
 * `isAvailableFor(ctx)` ↔ 上游 `isLanguageSupported(language)` + 可用性；
 * `collect(ctx)` ↔ `getCollectorFor(...).collect(element, editor, sink)` 的展平结果。
 * `id` 同时是"右键隐藏这一个 provider"的归属键（上游 `CodeVisionEntry.providerId` 同一口径）。
 */
export interface LocalInlayProvider {
  id: string
  /** 适用语言（空 = 全部）。 */
  languages?: readonly string[]
  isAvailableFor: (context: InlayProviderContext) => boolean
  collect: (context: InlayProviderContext) => InlayHintLike[]
}

/** URL 字面量的强特征：带协议、或以 `/` 开头且含一段路径（`/api/users`）。 */
const URL_LITERAL = /(['"`])((?:https?:\/\/|\/)[^\s'"`]*?)\1/g
/** 明显不是 URL 的 `/` 开头串：注释起始、除法、正则字面量（`/^\d/`）、闭合标签。 */
const NOT_A_PATH = /^(?:\/\/|\/\*|\/\/\/|^\/$)/

/**
 * 内置 `urlPath` 提供者（上游 `UrlPathInlayHintsProviderFactory`）：在 URL 字面量**后面**补
 * 一条内联提示，内容是该 URL 的**路径部分**（协议与主机名剥掉）—— 上游那一族做的是
 * "让长 URL 一眼看出打到哪个路径"，同一件事在纯文本层能做到。
 *
 * 只产 `http(s):` 或 `/` 开头的字面量；带模板段（`${…}`）的**原样保留**（动态段是事实，不猜）。
 * 位置 = 字面量结束引号之后（LSP inlay 的惯例是插在 token 之后）。
 */
export function urlPathInlayProvider(): LocalInlayProvider {
  return {
    id: 'urlPath',
    isAvailableFor: context => typeof context.text === 'string' && context.text.includes('/'),
    collect: context => {
      const hints: InlayHintLike[] = []
      const lines = context.text.split(/\r?\n/)
      for (let line = 0; line < lines.length; ++line) {
        const source = lines[line]
        URL_LITERAL.lastIndex = 0
        for (let match = URL_LITERAL.exec(source); match; match = URL_LITERAL.exec(source)) {
          const raw = match[2]
          if (!raw || NOT_A_PATH.test(raw)) continue
          const path = urlPathOf(raw)
          if (!path) continue
          // 提示文本就是路径本身；锚点是**结束引号之后**那一列。
          hints.push({ line, character: match.index + match[0].length, label: path, kind: 0 })
        }
      }
      return hints
    },
  }
}

/**
 * 从 URL 里取路径部分：剥掉 `scheme://host`，保留查询串之前的路径；`/x` 原样。
 * 取不到路径（如 `https://example.com`）时返回**空串** —— 提供者据此不产条目
 * （上游对没有路径的 URL 也不出提示，出一条 `/` 是噪音）。
 */
export function urlPathOf(url: string): string {
  const text = url.trim()
  if (!text) return ''
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/[^/]*/i.exec(text)
  const rest = scheme ? text.slice(scheme[0].length) : text
  if (!rest.startsWith('/') || rest === '/') return ''
  return rest
}

/**
 * 内置 `parameterName` 提供者（`InlayParameterHintsProvider` 那一族）：在**同一文件里能读到
 * 形参名**的调用点，给实参前补形参名。
 *
 * 本仓没有 PSI/签名解析，所以只认最保守的一类：`function f(a, b) {...}` / `const f = (a, b) => ...`
 * 这两种**同文件声明**，调用点是 `f(x, y)`。形参与实参数量不等就整条不产（宁可不出，也不挪错位）。
 * 上游那种"跨文件、重载、默认值"的解析在 `InlayParameterHintsProvider.getParameterHints(PsiElement)`
 * 里，需要 PSI —— 本仓没有，已登记在报告里。
 */
export function parameterNameInlayProvider(): LocalInlayProvider {
  return {
    id: 'parameterName',
    isAvailableFor: context => typeof context.text === 'string' && /=>|\bfunction\b/.test(context.text),
    collect: context => {
      const lines = context.text.split(/\r?\n/)
      const declarations = parameterDeclarations(lines)
      if (!declarations.size) return []
      const hints: InlayHintLike[] = []
      for (let line = 0; line < lines.length; ++line) {
        for (const call of callSites(lines[line], declarations)) {
          const names = declarations.get(call.name)
          if (!names || names.length !== call.arguments.length) continue
          for (let index = 0; index < call.arguments.length; ++index) {
            const label = names[index]
            if (!label) continue
            hints.push({ line, character: call.arguments[index].start, label, kind: 2 })
          }
        }
      }
      return hints
    },
  }
}

/** 声明里抓到的形参名（按顺序）；键 = 函数名。 */
function parameterDeclarations(lines: readonly string[]): Map<string, string[]> {
  const table = new Map<string, string[]>()
  for (const line of lines) {
    // `function f(a, b)` 与 `const f = (a, b) =>`（含 `export`/`async` 前缀）。
    const named = /(?:^|[^.\w])(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/.exec(line)
    const arrow = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/.exec(line)
    const match = named ?? arrow
    if (!match) continue
    const names = parameterNames(match[2])
    if (names.length) table.set(match[1], names)
  }
  return table
}

/** 形参文本 → 名字列表。`{a, b}` 解构与默认值、类型注解都取不出**单个**名字 ⇒ 整条丢掉那一格。 */
function parameterNames(raw: string): string[] {
  const text = raw.trim()
  if (!text) return []
  return text.split(',').map(part => {
    const trimmed = part.trim()
    if (!trimmed || trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('...')) return ''
    const withoutDefault = trimmed.split('=')[0].trim()
    const name = withoutDefault.split(':')[0].trim()
    return /^[A-Za-z_$][\w$]*$/.test(name) ? name : ''
  })
}

/** 一处调用点：函数名 + 每个实参的起止列（括号内按顶层逗号切）。 */
interface CallSite {
  name: string
  arguments: Array<{ start: number; end: number }>
}

/**
 * 找一行里的调用点：`name(` 之后到配对 `)`，括号内按**顶层**逗号切分（嵌套括号/字符串里的逗号
 * 不算分隔符）。声明那一行本身不算调用（`function f(a, b)` 里 `f(` 后面是形参）。
 */
function callSites(line: string, declarations: ReadonlyMap<string, readonly string[]>): CallSite[] {
  const out: CallSite[] = []
  const names = [...declarations.keys()]
  for (const name of names) {
    const pattern = new RegExp(`(?:^|[^.\\w$])${name.replace(/[$]/g, '\\$')}\\s*\\(`, 'g')
    for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
      // 声明行不算调用：`function f(` / `= f(` 前一个词是 function 或等号右边的箭头体。
      const before = line.slice(0, match.index)
      if (/function\s*$/.test(before)) continue
      const open = match.index + match[0].length - 1
      const close = matchingParen(line, open)
      if (close < 0) continue
      const args = splitArguments(line.slice(open + 1, close), open + 1)
      if (!args.length) continue
      out.push({ name, arguments: args })
    }
  }
  return out
}

/** 与 `open` 处 `(` 配对的 `)` 的下标；找不到返回 -1（字符串/模板串里的括号跳过）。 */
function matchingParen(line: string, open: number): number {
  let depth = 0
  let quote = ''
  for (let index = open; index < line.length; ++index) {
    const char = line[index]
    if (quote) {
      if (char === '\\') { ++index; continue }
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue }
    if (char === '(') ++depth
    else if (char === ')') { --depth; if (depth === 0) return index }
  }
  return -1
}

/** 按顶层逗号切实参；空实参（`f()` / `f(,)`）整条丢掉。 */
function splitArguments(body: string, offset: number): Array<{ start: number; end: number }> {
  const parts: Array<{ start: number; end: number }> = []
  let depth = 0
  let quote = ''
  let start = 0
  const flush = (end: number) => {
    const raw = body.slice(start, end)
    const leading = raw.length - raw.trimStart().length
    const trailing = raw.length - raw.trimEnd().length
    const from = start + leading
    const to = end - trailing
    if (to > from) parts.push({ start: offset + from, end: offset + to })
  }
  for (let index = 0; index < body.length; ++index) {
    const char = body[index]
    if (quote) {
      if (char === '\\') { ++index; continue }
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue }
    if (char === '(' || char === '[' || char === '{') ++depth
    else if (char === ')' || char === ']' || char === '}') --depth
    else if (char === ',' && depth === 0) { flush(index); start = index + 1 }
  }
  flush(body.length)
  return parts
}

/**
 * 内置 `lineAuthor` 提供者（上游 `CODE_AUTHOR_GROUP` 那一档 / `VcsCodeVisionProvider` 的
 * blame 面）：在**声明行**行尾补作者。只在 `ctx.authors` 有数据时产条目（没有 git 通道时
 * 一条都不出，不写假作者）。
 *
 * 只对顶层声明行（类/方法/函数）出，不给每行都出 —— 上游那一档是 Code Vision（行上方/行尾
 * 的"这一块是谁写的"），不是逐行 blame 侧栏（那是 `src/blameAnnotations.ts` 的另一条链）。
 */
export function lineAuthorInlayProvider(): LocalInlayProvider {
  return {
    id: 'lineAuthor',
    isAvailableFor: context => Array.isArray(context.authors) && context.authors.length > 0,
    collect: context => {
      const table = new Map<number, string>()
      for (const entry of context.authors ?? [])
        if (Number.isInteger(entry.line) && entry.line >= 0 && typeof entry.author === 'string' && entry.author) table.set(entry.line, entry.author)
      if (!table.size) return []
      const hints: InlayHintLike[] = []
      const lines = context.text.split(/\r?\n/)
      for (let line = 0; line < lines.length; ++line) {
        if (!DECLARATION_LINE.test(lines[line])) continue
        const author = table.get(line)
        if (!author) continue
        hints.push({ line, character: lines[line].length, label: author, kind: 0 })
      }
      return hints
    },
  }
}

/** 顶层声明行（类/接口/方法/函数）—— 与 `codeVisionProviders.ts` 的锚点同一档的文本近似。 */
const DECLARATION_LINE = /^\s*(?:export\s+)?(?:public|private|protected|static|final|abstract|open|internal|async\s+)*\s*(?:class|interface|enum|struct|function|def|fun|void|int|string|boolean|double|float|long|[A-Z][\w$]*\s+[a-z_$])\b/

/** 注册表：按 id 覆盖注册；`collectAll` 展平所有适用提供者的条目并去重。 */
export interface InlayProviderRegistry {
  register: (provider: LocalInlayProvider) => void
  /** 注销一个提供者（EP 侧的 `unregisterExtension` 等价物）。 */
  unregister: (id: string) => boolean
  providers: () => readonly LocalInlayProvider[]
  collectAll: (context: InlayProviderContext) => InlayHintLike[]
}

/** 从**扩展点宿主**取当前的全部提供者（`com.intellij.codeInsight.inlayProvider` EP，
 *  `platform/lang-api/resources/intellij.platform.lang.xml:54`）。内置的三个在注册表构造时
 *  以 bundled 贡献登记进去，所以这里拿到的就是完整集合。 */
export function inlayProvidersFromExtensions(): LocalInlayProvider[] {
  return EXTENSIONS.extensionsOf<LocalInlayProvider>(INLAY_PROVIDER_EP)
}

/** 能当本地提示的语言（`languages` 为空 = 全部）；与上游 `isLanguageSupported` 同一格。 */
export function candidateInlayProviders(providers: readonly LocalInlayProvider[], context: InlayProviderContext): LocalInlayProvider[] {
  return providers.filter(provider => {
    if (provider.languages && provider.languages.length && !provider.languages.includes(context.language)) return false
    return provider.isAvailableFor(context)
  })
}

export function createInlayProviderRegistry(initial: readonly LocalInlayProvider[] = [
  urlPathInlayProvider(), parameterNameInlayProvider(), lineAuthorInlayProvider(),
]): InlayProviderRegistry {
  const table = new Map<string, LocalInlayProvider>()
  // `initial` 只进本注册表，**不**写回全局 EP —— 否则调用方为测试/临时用途造的一组提供者
  // 会永久留在 EP 里，下一次 `createInlayProviderRegistry()` 又会把它们收编回来（跨实例串味）。
  // 全局 EP 里只放随本仓发货的那三个（模块加载时登记的 bundled 贡献，见文件尾）。
  for (const provider of initial) if (provider?.id) table.set(provider.id, provider)
  for (const provider of inlayProvidersFromExtensions()) if (!table.has(provider.id)) table.set(provider.id, provider)
  return {
    register: provider => {
      if (!provider?.id) return
      table.set(provider.id, provider)
      if (EXTENSIONS.hasExtensionPoint(INLAY_PROVIDER_EP))
        EXTENSIONS.registerExtension(INLAY_PROVIDER_EP, provider.id, provider, { source: 'user' })
    },
    unregister: id => {
      const removed = table.delete(id)
      if (removed) EXTENSIONS.unregisterExtension(INLAY_PROVIDER_EP, id)
      return removed
    },
    providers: () => [...table.values()],
    collectAll: context => {
      const seen = new Set<string>()
      const out: InlayHintLike[] = []
      // 候选集 = 本注册表的提供者 + 工厂为**这门语言**给出的提供者（`com.intellij.codeInsight.inlayProviderFactory`）。
      // 按 id 去重：工厂里与注册表同 id 的那条不重复跑。
      const candidates: LocalInlayProvider[] = [...table.values()]
      for (const provider of factoryInlayProvidersFor(context.language)) {
        if (candidates.some(entry => entry.id === provider.id)) continue
        candidates.push(provider as unknown as LocalInlayProvider)
      }
      for (const provider of candidateInlayProviders(candidates, context)) {
        for (const hint of provider.collect(context)) {
          if (!hint || !Number.isInteger(hint.line) || hint.line < 0 || !Number.isInteger(hint.character) || hint.character < 0) continue
          if (typeof hint.label !== 'string' || hint.label === '') continue
          const key = `${hint.line}:${hint.character}:${hint.label}`
          if (seen.has(key)) continue
          seen.add(key)
          out.push(hint)
        }
      }
      return out
    },
  }
}

/**
 * 与服务端提示合流（照 `codeVisionProviders.mergeCodeVisionEntries` 的口径）：
 * **同位置同文本去重、本地优先**，其余全部保留（不同文本的同位置条目由
 * `layoutInlayHints` 的同位置优先级决定留哪条）。
 */
export function mergeInlayHints(local: readonly InlayHintLike[], server: readonly InlayHintLike[]): InlayHintLike[] {
  const seen = new Set(local.map(hint => `${hint.line}:${hint.character}:${hint.label}`))
  const merged = [...local]
  for (const hint of server) {
    const key = `${hint.line}:${hint.character}:${hint.label}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(hint)
  }
  return merged
}

// ── 随本仓发货的三个提供者：作为 **bundled 贡献**登记进全局扩展点宿主 ──────────────────────
// 上游那三个 provider 是在 plugin.xml 里声明的（如 `UrlPathInlayHintsProviderFactory` 注册在
// `intellij.platform.lang.impl.xml:1759` 的 `codeInsight.inlayProviderFactory`）；本仓没有插件
// XML 解析器，所以"声明"这一半在模块加载时用代码完成。登记进 EP 之后
// `inlayProvidersFromExtensions()` 才拿得到完整集合，第三方也能按同一个 EP id 挂自己的提供者。
//
// 只登记**默认那三个**（不是调用方传进来的 initial）：`createInlayProviderRegistry(custom)` 里
// 的 custom 是调用方的私有集合，不该永久留在全局 EP 里（见上面那段注释）。
EXTENSIONS.registerExtension(INLAY_PROVIDER_EP, urlPathInlayProvider().id, urlPathInlayProvider(), { source: 'bundled' })
EXTENSIONS.registerExtension(INLAY_PROVIDER_EP, parameterNameInlayProvider().id, parameterNameInlayProvider(), { source: 'bundled' })
EXTENSIONS.registerExtension(INLAY_PROVIDER_EP, lineAuthorInlayProvider().id, lineAuthorInlayProvider(), { source: 'bundled' })

// ── 工厂那条 EP（`com.intellij.codeInsight.inlayProviderFactory`）的 bundled 贡献 ─────────────
// 上游 `UrlPathInlayHintsProviderFactory` 就是注册在这条 EP 上的工厂
// （`intellij.platform.lang.impl.xml:1759`）。本仓把同一条 urlPath 提供者**按工厂形态**再登记一次
// （provider id 与上面 provider EP 上那条相同 ⇒ `collectAll` 按 id 去重，不重复产条目）；
// 第三方用一个工厂一次给多个语言登记提供者时走同一条链路，由 `factoryInlayProvidersFor` 收编。
export const BUNDLED_INLAY_FACTORY_ID = 'taocode.inlayHintsProviderFactory.urlPath'
registerInlayHintsProviderFactory({
  id: BUNDLED_INLAY_FACTORY_ID,
  getProvidersInfo: () => [{
    language: '*',
    provider: {
      id: urlPathInlayProvider().id,
      isLanguageSupported: () => true,
      collect: context => urlPathInlayProvider().collect(context as InlayProviderContext),
    },
  }],
}, { source: 'bundled' })
