// 「快速定义」（IDEA `QuickImplementations`，Ctrl+Shift+I）—— 在原地看一眼定义，不开新标签页。
//
// 上游形状：`ShowImplementationsAction`（`platform/lang-impl/src/com/intellij/codeInsight/hint/actions/
// ShowImplementationsAction.java:27-49`）挂 `ImplementationViewSession`，弹层标题取
// `implementation.view.title`（`CodeInsightBundle.properties`：`implementation.view.title={0}`），
// 键位在 `$default.xml:162-164`（control shift I），`couldPinPopup()` 为真（弹层里能钉住）。
//
// **为什么这一条对库类型特别有用**：JDT 对**库里**的类型不给 `definition` 位置（真机三个探针 + 一次
// 服务端负载下的原始回包都确认过，见 native/library_sources.hpp 的真机结论），IDEA 那边靠源码附件/
// 反编译照样能看。本仓的等价物分两步：先问 definition（工程内的符号照常给位置），拿不到再用
// hover 的**全限定名**去工程里的 `*-sources.jar` 取源码（宿主那条 `file.librarySource`）。
//
// 这一模块是纯逻辑：hover 文本 → 全限定名、源码摘录、候选名逐级回退，都能单测。
export interface QuickDefinitionRequest {
  path: string
  line: number
  character: number
  /** 光标处的词（标题里用；空串时退到目标那一行的原文）。 */
  word: string
}

/** 弹层里要显示的一份源码。 */
export interface QuickDefinitionSource {
  /** 标题（`implementation.view.title` 的中文写法：「快速定义 {0}」）。 */
  title: string
  /** 显示用路径（工程内相对路径，或库源码的 `jar!/entry`）。 */
  path: string
  content: string
  /** 目标行（0 基，相对 `content`）。 */
  line: number
  /** 来自库源码（宿主解出来的只读副本）时为真，标题上带出来源。 */
  library: boolean
}

export interface QuickDefinitionPorts {
  /** 只读当前工作区已打开的缓冲；null = 没打开。 */
  readBuffer: (path: string) => string | null
  /** 读工程内文件（宿主 `file.read`）。 */
  readFile: (path: string) => Promise<string>
  /** `lsp.request`。 */
  request: <T>(method: 'lsp.request', params: Record<string, unknown>) => Promise<T>
  /** 宿主 `file.librarySource`。 */
  librarySource: (qualifier: string) => Promise<{ available: boolean; path?: string; jar?: string; entry?: string; content?: string }>
}

/**
 * 从 hover 文本里取**全限定名**。
 *
 * JDT 的 hover 第 1..3 行是签名，之后才是 javadoc（真机实测：
 * `net.minecraftforge.common.config.Configuration\n\nThis class offers advanced configurations…`）。
 * 规则：只看前 3 行，取最长的"点分标识符"串，去掉泛型参数、去掉末尾的 `()`；成员引用
 * （`com.example.Greeter.hello()`）也会命中——调用方用 `qualifierCandidates` 逐级回退到所属类型。
 */
export function qualifierFromHoverText(contents: string): string | null {
  const lines = contents.split(/\r?\n/).slice(0, 3)
  let best: string | null = null
  for (const line of lines) {
    // 泛型先削掉：`java.util.Map<K, V>` → `java.util.Map`。
    const text = line.replace(/<[^>]*>/g, '').replace(/\[\]/g, '')
    for (const token of text.split(/[^A-Za-z0-9_$.]+/)) {
      const candidate = token.replace(/^\$+|\$+$/g, '')
      if (!/^[a-z][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)+$/.test(candidate)) continue
      if (!best || candidate.length > best.length) best = candidate
    }
  }
  return best
}

/**
 * 逐级回退的候选：`a.b.C` → `a.b.C`、`a.b`。成员引用（`a.b.C.method`）前几次照原样查（都不命中），
 * 到所属类型那一级才命中 —— 调用方按顺序问宿主，第一个 available 的胜出。
 */
export function qualifierCandidates(qualifier: string): string[] {
  const segments = qualifier.split('.')
  const out: string[] = []
  for (let count = segments.length; count >= 2; --count) out.push(segments.slice(0, count).join('.'))
  return out
}

/** 源码摘录：目标行 ± `context` 行（弹层里不铺整个文件），并给出目标行在摘录里的下标。 */
export function excerptAt(content: string, line: number, context = 10): { from: number; lines: string[]; target: number } {
  const all = content.split(/\r?\n/)
  const from = Math.max(0, line - context)
  const to = Math.min(all.length, line + context + 1)
  return { from, lines: all.slice(from, to), target: Math.max(0, Math.min(line, all.length - 1) - from) }
}

/** 标题：`implementation.view.title` 的中文写法；库源码再把来源（jar 名）带上。 */
export function quickDefinitionTitle(word: string, fallback: string, library: boolean): string {
  const name = word.trim() || fallback.trim() || '定义'
  return library ? `快速定义 ${name}（库源码）` : `快速定义 ${name}`
}

/** 一行里的词（宿主那条语义动作的 `wordAt` 同款规则，这里只给标题用）。 */
export function wordOf(line: string): string {
  return /[A-Za-z_$][A-Za-z0-9_$]*/.exec(line)?.[0] ?? ''
}

/** 光标处的标识符：`wordAt`（src/editorText.ts）在同一条规则上取前后两段，这里只需要给标题。 */
export function wordAtPosition(line: string, character: number): string {
  const head = /[A-Za-z0-9_$]*$/.exec(line.slice(0, Math.max(0, character)))?.[0] ?? ''
  const tail = /^[A-Za-z0-9_$]*/.exec(line.slice(Math.max(0, character)))?.[0] ?? ''
  return head + tail
}

/**
 * 解析一次「快速定义」：
 *   ① `textDocument/definition` 有位置 → 读那个文件（打开的缓冲优先）→ 摘录；
 *   ② 没有 → hover 取全限定名 → 逐级回退问 `file.librarySource` → 摘录库源码（只读副本）。
 * 两路都没有就返回 null（调用方不弹空壳）。
 */
export async function resolveQuickDefinition(
  ports: QuickDefinitionPorts,
  request: QuickDefinitionRequest,
): Promise<QuickDefinitionSource | null> {
  const target = { path: request.path, line: request.line, character: request.character }
  try {
    const definition = await ports.request<{ available: boolean; locations?: { path: string; line: number; character: number }[] }>(
      'lsp.request', { kind: 'definition', ...target })
    const first = definition.available ? definition.locations?.[0] : undefined
    if (first) {
      const content = ports.readBuffer(first.path) ?? await ports.readFile(first.path)
      const lineText = content.split(/\r?\n/)[first.line] ?? ''
      return { title: quickDefinitionTitle(request.word || wordOf(lineText), lineText.trim(), false),
               path: first.path, content, line: first.line, library: false }
    }
  } catch { /* 语言服务没起来时走下面那条库源码的路 */ }

  try {
    const hover = await ports.request<{ available: boolean; contents?: string }>('lsp.request', { kind: 'hover', ...target })
    const qualifier = hover.available && hover.contents ? qualifierFromHoverText(hover.contents) : null
    if (!qualifier) return null
    for (const candidate of qualifierCandidates(qualifier)) {
      const source = await ports.librarySource(candidate)
      if (!source.available || !source.content) continue
      const path = `${(source.jar ?? '').split(/[\\/]/).pop() ?? 'library'}!${source.entry ?? candidate}`
      return { title: quickDefinitionTitle(request.word || candidate.split('.').pop() || '', candidate, true),
               path, content: source.content, line: 0, library: true }
    }
  } catch { /* hover/宿主不可用：没有可看的定义，安静返回 */ }
  return null
}
