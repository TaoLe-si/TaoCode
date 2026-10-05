// 快速文档的**渲染模型**（上游 `platform/lang-impl/src/com/intellij/lang/documentation/`：
// `DocumentationManager` 从 `DocumentationTarget` 取 HTML，`DocumentationComponent` 富渲染 ——
// 外部文档链接（`ExternalDocumentationLinkProvider`）与内联图片都在这一层；补全条目的文档走
// `LookupElementPresentation`/`CompletionDocumentation`，是另一条通道）。
//
// 本仓现状（如实）：Ctrl+Q 与补全文档都是把 LSP `hover`/`completionItem/resolve` 的
// markdown/HTML **原文**贴出来（`src/editorFileOps.ts` + CodeEditor.vue），没有区块划分、
// 没有链接识别、没有图片渲染。这个模块只做**纯模型**：把上游给的富内容解析成
// 「区块 + 链接 + 图片」，供渲染层消费（渲染接线在冻结的 CodeEditor.vue，见判决）。
//
// 为什么值得单独落：IDEA 的快速文档里，`{@link Foo#bar(int)}` 与 `<a href="https://…">`
// 是可点的 —— 本仓贴原文时它们是死文本；而「哪些是外部链接」这条规则与渲染无关，可以先测死。

import { filePathFromUri } from './documentLinks.ts'

/** 内容格式：LSP `MarkupContent.kind`（`markdown` / `plaintext`）或 HTML（部分服务器直接给 `<p>`）。 */
export type DocFormat = 'markdown' | 'plaintext' | 'html'

/**
 * 正文里的一段：纯文本，或一条**就地可点**的链接。
 * 上游的正文是一段 HTML，引用就长在句子里（`DocumentationMarkup.CONTENT_START + …`，
 * `LspDocumentationData.kt:91-103`；javadoc 的 `{@link}` 由 `DocMarkdownToHtmlConverter` 转成
 * 内联 `<a href>`，`platform/lsp-impl/src/impl/features/documentation/LspDocumentationData.kt:94`）。
 * 本仓不把 HTML 塞进 DOM（弹层渲染的是数据），所以「句子 + 链接」这一层用分段数组表达，
 * 渲染层按段贴 `<span>`/按钮 —— 链接位置与上游一致。
 */
export type DocPart = { text: string } | { link: DocLink }

/** 文档里的一个块（渲染层按块类型给样式：代码块等宽、标题加粗…）。 */
export interface DocBlock {
  kind: 'text' | 'code' | 'heading'
  text: string
  /** 代码块的语言标注（```java 的 `java`；没有则空串）。 */
  language?: string
  /**
   * 带内联链接的分段（没有链接时是 `undefined`，渲染层直接用 `text`）。
   * `text` 始终是这些分段的纯文本形态（`docPlainText` 与搜索都读它，形状不变）。
   */
  parts?: DocPart[]
}

/** 文档里的一条链接。`external` 决定点击是打开浏览器还是走工作区导航。 */
export interface DocLink {
  label: string
  target: string
  kind: 'external' | 'internal' | 'anchor'
  /** `file:` URI 解出来的行号（1 基；没有就是 0）。 */
  line?: number
}

/** 文档里的一张图片（`<img src>` 或 markdown `![alt](src)`）。 */
export interface DocImage {
  src: string
  alt: string
  /** `http(s):` 图片不在工作区内，渲染层不能走 `file.readBinary`。 */
  external: boolean
}

export interface QuickDocModel {
  blocks: DocBlock[]
  links: DocLink[]
  images: DocImage[]
}

const EXTERNAL_SCHEME = /^(?:https?|mailto|ftp):/i

/**
 * 上游 `XssSafeLinks.kt:8` 的 `UNSAFE_LINK_REGEX`：正文里的链接目标以
 * `vbscript:` / `javascript:` / `data:` / `file:` 开头时，`makeXssSafeDestination`（`:13-15`）
 * 把目标换成 `#` —— 显示效果就是「字还在、点不动」。
 *
 * `file:` 本仓**故意不**按这一条办：内部链接的跳转走 `revealLocation`（IDEA 那条不是 HTML
 * `href`，是它自己的引用解析链），把 `file:` 判死会拆掉已经接好的导航链（`tests/doc-host.test.mjs`
 * 钉着它）。其余三条原样落：它们落到本仓的 `revealLocation` 也只是得到一个不存在的路径，
 * 与其给一句误导性的「打不开」，不如按上游那样留字断链。
 */
const UNSAFE_LINK_SCHEME = /^(?:vbscript|javascript|data):/i

/** 上游 `XssSafeLinks.kt:9` 的 `UNSAFE_LINK_REGEX_IMAGE`（图片比链接多放行 `file:`，少放行 `data:`）。 */
const UNSAFE_IMAGE_SCHEME = /^(?:vbscript|javascript|data):/i

/** 上游 `XssSafeLinks.kt:11` 的 `ALLOWED_DATA_LINK_REGEX`（逐字符照抄）：只有内联图片的 `data:` 被放过。 */
const ALLOWED_DATA_IMAGE = /^data:image\/(?:gif|png|jpeg|webp|svg)[+;=a-z0-9A-Z]*,/i

/** 这条链接目标是不是「该断链」的那种（渲染成正文里的普通字）。 */
export function isUnsafeDocTarget(target: string): boolean {
  return UNSAFE_LINK_SCHEME.test(target.trim())
}

/** 这个图片源能不能用（`XssSafeLinks.kt:13-15`：不安全的一律换掉；`data:` 只认内联图片那一种）。 */
export function isSafeDocImageSource(src: string): boolean {
  const trimmed = src.trim()
  if (!UNSAFE_IMAGE_SCHEME.test(trimmed)) return true
  return ALLOWED_DATA_IMAGE.test(trimmed)
}

/** 内联的 `data:image/…` 源：字节就在源串里，宿主不需要再去读文件。 */
export function isInlineDocImageSource(src: string): boolean {
  return ALLOWED_DATA_IMAGE.test(src.trim())
}

/** 这条目标算外部链接吗（点开走系统浏览器）。 */
export function isExternalDocTarget(target: string): boolean {
  return EXTERNAL_SCHEME.test(target.trim())
}

/** HTML 实体最小解码（IDEA 的 `StringUtil.unescapeXmlEntities` 同口径：五个命名实体 + 数字实体）。 */
export function decodeDocEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'").replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
}

/** 把一条目标分类成链接（`file:` URI 解路径，`https:` 判外部，其余按内部路径）。 */
export function classifyDocLink(label: string, target: string): DocLink {
  const trimmed = target.trim()
  if (isExternalDocTarget(trimmed)) return { label, target: trimmed, kind: 'external' }
  if (trimmed.startsWith('#')) return { label, target: trimmed, kind: 'anchor' }
  // 上游 `makeXssSafeDestination` 换成 `#` 的那一支（`XssSafeLinks.kt:13-15`）：本仓同样落成
  // 不可点的锚点，且**不保留**原目标串，免得它从别的通路再被拿去导航。
  if (isUnsafeDocTarget(trimmed)) return { label, target: '#', kind: 'anchor' }
  if (/^file:/i.test(trimmed)) {
    const resolved = filePathFromUri(trimmed)
    return { label, target: resolved.path, kind: 'internal', line: resolved.line }
  }
  return { label, target: trimmed, kind: 'internal' }
}

/**
 * 链接占位符 `\u0002{下标}\u0003`。两个控制字符不会出现在正文里；**必须**用占位符而不是
 * 直接折回显示名 —— `{@link Bar}` 的显示名 `Bar` 常常在同一句里还以普通词出现一次，
 * 折回文本后再按字找位置会认错（内联链接就贴错了地方）。
 */
const LINK_MARK = /\u0002(\d+)\u0003/g
function linkMark(index: number): string { return `\u0002${String(index)}\u0003` }

/** 占位符 → 分段（渲染层按段贴文本/内联链接，与上游正文里的 `<a>` 同位置）。 */
export function docPartsFromMarks(raw: string, links: DocLink[]): DocPart[] {
  const parts: DocPart[] = []
  let last = 0
  LINK_MARK.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = LINK_MARK.exec(raw))) {
    if (match.index > last) parts.push({ text: raw.slice(last, match.index) })
    const link = links[Number(match[1])]
    if (link) parts.push({ link })
    last = match.index + match[0].length
  }
  if (last < raw.length) parts.push({ text: raw.slice(last) })
  return parts
}

/**
 * 分段 → 带占位符的原文（`docPartsFromMarks` 的**逆**）。
 * 布局层要按字符偏移切一行 javadoc（`@param` 的标签与主题词），而偏移只能在一条连续的字符串上算，
 * 所以先把分段还原成原文、切完再用 `docPartsFromMarks` 还原成分段 —— 链接的位置全程不丢。
 * 不在 `links` 里的链接对象（理论上不该发生）退化成显示名，与 `docTextFromMarks` 同口径。
 */
export function docPartsToMarks(parts: DocPart[], links: DocLink[]): string {
  let out = ''
  for (const part of parts) {
    if (!('link' in part)) { out += part.text; continue }
    const index = links.indexOf(part.link)
    out += index >= 0 ? linkMark(index) : part.link.label
  }
  return out
}

/** 占位符 → 纯文本（显示名原样落回，与 `parts` 之前的形状逐字一致）。 */
export function docTextFromMarks(raw: string, links: DocLink[]): string {
  LINK_MARK.lastIndex = 0
  return LINK_MARK.test(raw)
    ? raw.replace(/\u0002(\d+)\u0003/g, (_, index: string) => links[Number(index)]?.label ?? '')
    : raw
}

/** 正文里有没有内联链接（决定 `parts` 要不要给）。 */
export function hasDocLinkMark(raw: string): boolean {
  return raw.includes('\u0002')
}

/**
 * `{@link Foo#bar(int) 说明}` / `{@code x}` 这类 javadoc 内联标签 → 文本 + 链接。
 * 公开这一个把占位符折回显示名（形状与改动前逐字一致，`docPlainText` 与既有判据读它）；
 * `markJavadocLinks` 留着占位符给 `parseQuickDoc` 拆 `parts`。
 */
export function extractJavadocLinks(text: string, links: DocLink[]): string {
  return docTextFromMarks(markJavadocLinks(text, links), links)
}

function markJavadocLinks(text: string, links: DocLink[]): string {
  return text.replace(/\{@(link|linkplain|code)\s+([^}]+)\}/g, (_, tag: string, body: string) => {
    const trimmed = body.trim()
    if (tag === 'code') return trimmed
    // `Foo#bar(int) 说明`：最后一个空格之后若不像签名的一部分，就是显示名。
    const space = trimmed.lastIndexOf(' ')
    const target = space > 0 && !/[(),]$/.test(trimmed) ? trimmed.slice(0, space) : trimmed
    const label = space > 0 && !/[(),]$/.test(trimmed) ? trimmed.slice(space + 1) : trimmed
    links.push(classifyDocLink(label, target))
    return linkMark(links.length - 1)
  })
}

/** markdown 的 `[label](target)` 与 `![alt](src)`（先图片后链接，避免图片的 `!` 被截掉）。 */
function markMarkdownLinks(text: string, links: DocLink[], images: DocImage[]): string {
  let out = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt: string, src: string) => {
    images.push({ src: src.trim(), alt: alt.trim(), external: EXTERNAL_SCHEME.test(src.trim()) })
    return alt
  })
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label: string, target: string) => {
    links.push(classifyDocLink(label, target.trim()))
    return linkMark(links.length - 1)
  })
  return out
}

/** HTML 片段 → 文本 + 链接 + 图片（白名单思路：`<pre>`/`<code>` 保留内容，`<a>`/`<img>` 记录后保留标签文本）。 */
function markHtml(content: string, links: DocLink[], images: DocImage[], blocks: DocBlock[]): string {
  let out = content.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, body: string) => {
    const language = (/<pre[^>]*class="[^"]*language-([\w-]+)/i.exec(content) ?? [])[1] ?? ''
    blocks.push({ kind: 'code', text: decodeDocEntities(body.replace(/<[^>]+>/g, '')), language })
    return '\n'
  })
  out = out.replace(/<img\b[^>]*>/gi, tag => {
    const src = (/\bsrc\s*=\s*["']([^"']*)["']/i.exec(tag) ?? [])[1] ?? ''
    const alt = (/\balt\s*=\s*["']([^"']*)["']/i.exec(tag) ?? [])[1] ?? ''
    if (src) images.push({ src: src.trim(), alt: alt.trim(), external: EXTERNAL_SCHEME.test(src.trim()) })
    return alt
  })
  out = out.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_, attrs: string, body: string) => {
    const href = (/\bhref\s*=\s*["']([^"']*)["']/i.exec(attrs) ?? [])[1] ?? ''
    const label = decodeDocEntities(body.replace(/<[^>]+>/g, '')).trim()
    if (!href) return label
    links.push(classifyDocLink(label, href))
    return linkMark(links.length - 1)
  })
  // 块级标签 → 换行；`<br>` 也换行。
  out = out.replace(/<\s*(?:br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*\/?>/gi, '\n')
  out = out.replace(/<[^>]+>/g, '')
  return decodeDocEntities(out)
}

/**
 * 一个块的成形：`text` 把占位符折回显示名，`parts` 保留「句子 + 内联链接」的分段。
 * 代码块不拆 `parts`（上游 `<pre>` 里的内容按等宽原样显示，不当链接）；
 * 没有链接的块 `parts` 留空，渲染层直接读 `text`，形状与改动前一致。
 */
export function docBlock(kind: DocBlock['kind'], raw: string, links: DocLink[]): DocBlock {
  const text = docTextFromMarks(raw, links)
  if (kind === 'code' || !hasDocLinkMark(raw)) return { kind, text }
  return { kind, text, parts: docPartsFromMarks(raw, links) }
}

/**
 * 解析快速文档内容。`format` 缺省按内容猜（有 `<p>`/`<code>` 这类标签就当 HTML）——
 * 语言服务器两种都给：LSP `MarkupContent.kind` 是权威，猜只是兜底。
 */
export function parseQuickDoc(content: string, format?: DocFormat): QuickDocModel {
  const links: DocLink[] = []
  const images: DocImage[] = []
  const blocks: DocBlock[] = []
  const input = typeof content === 'string' ? content : ''
  const actual: DocFormat = format ?? (/<(?:p|pre|code|br|a|b|i|div|ul|li)\b/i.test(input) ? 'html' : 'markdown')
  // 全程带着占位符走，最后每个块一次成形：`text` 是纯文本形态（与改动前逐字一致），
  // `parts` 是「句子 + 内联链接」的分段形态（上游正文里的 `<a>` 就长在原句里）。
  let raw = actual === 'html' ? markHtml(input, links, images, blocks) : input
  raw = markJavadocLinks(raw, links)
  raw = markMarkdownLinks(raw, links, images)
  for (const chunk of raw.split(/\n{2,}/)) {
    const trimmed = chunk.trim()
    if (!trimmed) continue
    const heading = /^#{1,6}\s+(.*)$/.exec(trimmed)
    if (heading) blocks.push(docBlock('heading', heading[1].trim(), links))
    else blocks.push(docBlock('text', trimmed, links))
  }
  // markdown 围栏代码块（```）、以及缩进里的 `    code` 不拆：这里只认围栏，避免把正文误判成代码。
  const merged: DocBlock[] = []
  let fence: { language: string; lines: string[] } | null = null
  for (const block of blocks) {
    const match = block.kind === 'text' ? /^```([\w-]*)\n([\s\S]*?)\n?```$/.exec(block.text) : null
    if (match) {
      merged.push({ kind: 'code', text: match[2], language: match[1] })
      continue
    }
    if (block.kind === 'text' && block.text.startsWith('```')) {
      const language = block.text.slice(3).split('\n')[0].trim()
      fence = { language, lines: [block.text.split('\n').slice(1).join('\n')] }
      continue
    }
    if (fence) {
      fence.lines.push(block.text)
      if (block.text.endsWith('```')) {
        const body = fence.lines.join('\n\n').replace(/\n?```$/, '')
        merged.push({ kind: 'code', text: body, language: fence.language })
        fence = null
      }
      continue
    }
    merged.push(block)
  }
  if (fence) merged.push({ kind: 'code', text: fence.lines.join('\n\n'), language: fence.language })
  return { blocks: merged, links, images }
}

/** 外部文档链接（「在浏览器中打开」的候选）：按出现顺序去重。 */
export function externalDocumentationLinks(model: QuickDocModel): DocLink[] {
  const seen = new Set<string>()
  const out: DocLink[] = []
  for (const link of model.links) {
    if (link.kind !== 'external') continue
    if (seen.has(link.target)) continue
    seen.add(link.target)
    out.push(link)
  }
  return out
}

/**
 * 第一条**可导航**的内部链接（`{@link 同工程类}` / `file:`）：做「跳转到声明」的降级目标。
 * 优先带路径/行号的（`file:` 与相对路径能落到工作区文件），纯符号名（`{@link Foo}`）留作兜底 ——
 * 后者本仓没有 PSI 解析不了，但渲染层仍可以拿它显示成可点条目。
 */
export function firstInternalDocLink(model: QuickDocModel): DocLink | undefined {
  const internal = model.links.filter(link => link.kind === 'internal' && link.target !== '')
  return internal.find(link => (link.line ?? 0) > 0 || /[\\/]/.test(link.target)) ?? internal[0]
}

/** 模型里的纯文本（复制文档、搜索高亮等不需要样式的消费者用）。 */
export function docPlainText(model: QuickDocModel): string {
  return model.blocks.map(block => block.text).join('\n\n')
}
