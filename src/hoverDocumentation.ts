// hover 文档的整形与缓存 —— 上游 `platform/lsp-impl/src/impl/features/documentation/` 的
// `LspDocumentationData`（把 markdown 开头的代码围栏拆成「签名块 + 语言 + 描述」）
// 与 `HoverResultCache`（按文件缓存 hover 结果、文档变化即失效）。
//
// 本仓现状：Ctrl+Q 每次现取一次 hover 原文（`src/editorFileOps.ts` 的 `showQuickDoc`），
// 服务器给的 ```java … ``` 围栏会连同反引号一起显示在弹层里。这个模块做两件事：
//   · `createHoverDocumentation`/`formatHoverPlainText`：拆出签名与描述、把行分隔符归一，
//     供弹层的纯文本 `<pre>` 使用（签名在前、描述在后，不再显示围栏本身）；
//   · `createHoverCache`：按 (路径, 光标位置, 文档版本+脏标记) 缓存，重复 Ctrl+Q 不再往返；
//     文档版本变化（存盘/外部改动）或转脏时整文件失效。
//
// 与上游的差异（如实）：命中口径已经跟上 —— 见下面 `docHoverRangeContains`，
// 存进去的条目带 hover 的**文本区间**时，同符号内移动光标就命中（上游 `HoverResultCache.kt:11-12`
// 的 `matches = storedValue.textRange.contains(queriedOffset)`）。区间本身由服务器给
// （`LspRequestExecutor.kt:213-221` 把 `hover.range` 映射到宿主文档），服务器没给时上游退化成
// **零长区间**（`TextRangeAndMarkupContent.kt:14-20`：`else TextRange(offset, offset)`），
// 于是只有同一位置命中 —— 本仓一致（`native/lsp_session.cpp` 目前不透传 range，见接线请求）。
// 描述渲染成 HTML 需要弹层宿主（`src/App.vue` 本批冻结），所以这里只给纯文本形态。

/** 上游 `LeadingCodeFence`：开头代码围栏的语言、代码与其余描述。 */
export interface LeadingCodeFence {
  language: string | null
  code: string
  rest: string
}

/** 行分隔符归一（上游 `StringUtilRt.convertLineSeparators`，CRLF/CR → LF）。 */
export function convertLineSeparators(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/**
 * 解析文本**开头**的代码围栏（上游 `parseLeadingCodeFence` 的逐条口径）：
 * 围栏至少三个反引号，闭合围栏的反引号数不少于开围栏，闭合才认；语言是信息行第一个词。
 */
export function parseLeadingCodeFence(contents: string): LeadingCodeFence | null {
  let fence = 0
  while (fence < contents.length && contents[fence] === '`') ++fence
  if (fence < 3) return null
  const infoEnd = contents.indexOf('\n')
  if (infoEnd < 0) return null
  const closing = new RegExp(`^\`{${fence},}[ \\t]*$`, 'm')
  const match = closing.exec(contents.slice(infoEnd + 1))
  if (!match) return null
  const closingStart = infoEnd + 1 + match.index
  const closingEnd = closingStart + match[0].length
  const language = contents.slice(fence, infoEnd).trim().split(' ')[0] || null
  return {
    language,
    code: trimIndent(contents.slice(infoEnd + 1, closingStart)).trimEnd(),
    rest: contents.slice(closingEnd),
  }
}

/** 上游 Kotlin `trimIndent()`：去掉非空行的最小公共缩进，空行原样保留。 */
export function trimIndent(text: string): string {
  const lines = text.split('\n')
  let indent = -1
  for (const line of lines) {
    if (!line.trim()) continue
    const width = /^[ \t]*/.exec(line)?.[0].length ?? 0
    indent = indent < 0 ? width : Math.min(indent, width)
  }
  if (indent <= 0) return text
  return lines.map(line => (line.trim() ? line.slice(indent) : line)).join('\n')
}

export interface HoverDocumentation {
  definitionCodeBlock: string | null
  definitionLanguage: string | null
  description: string
  markup: 'plain' | 'markdown'
}

/** 上游 `createLspDocumentationData` 的等价物（本仓桥接只给字符串，按 markdown 处理）。 */
export function createHoverDocumentation(contents: string): HoverDocumentation {
  const text = convertLineSeparators(contents)
  const fence = parseLeadingCodeFence(text)
  if (!fence) return { definitionCodeBlock: null, definitionLanguage: null, description: text, markup: 'plain' }
  return {
    definitionCodeBlock: fence.code,
    definitionLanguage: fence.language,
    description: fence.rest,
    markup: 'markdown',
  }
}

/**
 * 弹层 `<pre>` 用的纯文本：签名在前、描述在后，都不带围栏。
 * 没有围栏时就是原文 —— 与现在的显示完全一致，不会凭空改写服务器的内容。
 */
export function formatHoverPlainText(documentation: HoverDocumentation): string {
  const signature = documentation.definitionCodeBlock?.trim()
  const description = documentation.description.replace(/^\n+/, '').trimEnd()
  if (!signature) return description
  return description ? `${signature}\n\n${description}` : signature
}

export interface HoverCacheEntry {
  contents: string
  /**
   * 这次 hover 覆盖的**文本区间**（LSP `Hover.range`，0 基行列）。
   * 上游把它存进 `TextRangeAndMarkupContent.textRange`（`TextRangeAndMarkupContent.kt:12`），
   * 缓存命中就按它判（`HoverResultCache.kt:11-12`）—— 同一符号内移动光标不再往返服务器。
   * 服务器没给 range 时这里是 `undefined`，与上游的零长区间同口径：**只有位置完全相同才命中**
   * （`TextRangeAndMarkupContent.kt:16-20`）。
   */
  range?: DocHoverRange
}

/** LSP `Hover.range` / 上游 `TextRange` 在本仓的形状（行列，尾开）。 */
export interface DocHoverRange {
  startLine: number
  startCharacter: number
  endLine: number
  endCharacter: number
}

/** `LspPosition` → 可比较的数（行优先，再按列）。 */
function docRangePoint(line: number, character: number): number {
  return line * 1_000_000 + character
}

/**
 * 位置是否落在区间内 —— 上游 `TextRange.contains(offset)` 的口径是 **左闭右开**
 * （`TextRangeAndMarkupContent.kt:19` 零长区间只含它自己；`LspDocumentationTargetProvider.kt:47`
 * 判 `it.length > 0` 才算有可显示文本）。
 */
export function docHoverRangeContains(range: DocHoverRange, line: number, character: number): boolean {
  const at = docRangePoint(line, character)
  return at >= docRangePoint(range.startLine, range.startCharacter)
    && at < docRangePoint(range.endLine, range.endCharacter)
}

/** `line:character` 位置键（`null` = 不是位置键，比如测试里的任意键）。 */
export function parseHoverPositionKey(position: string): { line: number; character: number } | null {
  const match = /^(\d+):(\d+)$/.exec(position)
  return match ? { line: Number(match[1]), character: Number(match[2]) } : null
}

/** `line:character` 位置键的生成端（与 `parseHoverPositionKey` 成对，避免两处各拼一份）。 */
export function hoverPositionKey(line: number, character: number): string {
  return `${String(line)}:${String(character)}`
}

export interface HoverCache {
  get(path: string, position: string, stamp: string): HoverCacheEntry | undefined
  put(path: string, position: string, stamp: string, entry: HoverCacheEntry): void
  invalidate(path: string): void
  clear(): void
  /** 已缓存的 (文件, 位置) 条数（测试与诊断用）。 */
  size(): number
}

/**
 * 每文件一张位置表 + 文档标记（`版本:脏`）。标记一变整文件失效 ——
 * 对应上游 `LspPerFileCache` 在文档变化时清缓存（`LspPerFileCache.kt:68` 的 `s.stamp == stamp`）。
 *
 * 命中两条：①位置键完全相同；②位置键不同但**某条目的区间包含这个位置**（上游
 * `HoverResultCache.kt:11-12` 的 containment 匹配）。第 ② 条命中后上游把槽位的 key
 * **重锚到最后一次查询的位置**（`LspPerFileCache.kt:71-73`：`s.key = key`），这里同样改键。
 *
 * 与上游的一处差异（如实）：上游是「每类请求一个槽位」的单槽记忆（`LspPerFileCache.kt:56`），
 * 本仓按文件留了一张 LRU 表 —— 同一文件里多个符号的文档都留着，不会一挪光标就丢。
 */
export function createHoverCache(limitPerFile = 32): HoverCache {
  const files = new Map<string, { stamp: string; entries: Map<string, HoverCacheEntry> }>()
  let total = 0
  /** 区间命中：找那条**覆盖了查询位置**的条目（上游 matches 的等价物）。 */
  function containedEntry(file: { entries: Map<string, HoverCacheEntry> }, position: string): string | undefined {
    const at = parseHoverPositionKey(position)
    if (!at) return undefined
    for (const [key, entry] of file.entries) {
      if (key === position) continue
      if (entry.range && docHoverRangeContains(entry.range, at.line, at.character)) return key
    }
    return undefined
  }
  return {
    get(path, position, stamp) {
      const file = files.get(path)
      if (!file || file.stamp !== stamp) return undefined
      const entry = file.entries.get(position)
      if (entry) {
        // 命中的条目提到表尾（LRU）。
        file.entries.delete(position)
        file.entries.set(position, entry)
        return entry
      }
      const covered = containedEntry(file, position)
      if (!covered) return undefined
      const hit = file.entries.get(covered) as HoverCacheEntry
      // 重锚到最后一次查询的位置（上游 `s.key = key`）。
      file.entries.delete(covered)
      file.entries.set(position, hit)
      return hit
    },
    put(path, position, stamp, entry) {
      let file = files.get(path)
      if (!file || file.stamp !== stamp) {
        total -= file?.entries.size ?? 0
        file = { stamp, entries: new Map() }
        files.set(path, file)
      }
      if (!file.entries.has(position)) ++total
      file.entries.delete(position)
      file.entries.set(position, entry)
      while (file.entries.size > limitPerFile) {
        const oldest = file.entries.keys().next().value
        if (oldest === undefined) break
        file.entries.delete(oldest)
        --total
      }
    },
    invalidate(path) {
      const file = files.get(path)
      if (!file) return
      total -= file.entries.size
      files.delete(path)
    },
    clear() {
      files.clear()
      total = 0
    },
    size: () => total,
  }
}
