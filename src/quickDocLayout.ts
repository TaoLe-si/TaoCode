// 快速文档弹层的**布局模型** —— 上游 `DocumentationMarkup`（`DocumentationResult` 的 HTML 契约）
// 的等价物。上游那条链是：`DocumentationProvider.generateDoc` 吐出 HTML，`DocumentationMarkup`
// 用固定 class 名划分区块，渲染层（`DocumentationHtmlUtil.getDocumentationPaneAdditionalCssRules`）
// 只按这些 class 上样式。本仓的链路是：LSP `hover` → `createHoverDocumentation`（签名/描述）
// → `parseQuickDoc`（区块/链接/图片）→ **这里**（definition / content / sections / bottom）→
// `src/components/QuickDocPopup.vue`。
//
// 上游的四块 class（`platform/analysis-api/src/com/intellij/lang/documentation/DocumentationMarkup.java:13-31`）：
//   · `CLASS_DEFINITION` "definition" —— 签名，`<div class='definition'><pre>…</pre></div>`（:22-23）；
//   · `CLASS_CONTENT`    "content"    —— 正文，`<div class='content'>…</div>`（:24-25）；
//   · `CLASS_SECTIONS`   "sections"   —— 分节表，`<table class='sections'>`（:26-27），
//     每行是「左表头 + 右内容」两格：`<td class='section'>` + `<td valign='top'>`（:28-31）；
//   · `CLASS_BOTTOM`     "bottom"     —— 面板底部那一行（外部文档链接，`ExternalDocumentationHandler.
//     canHandleExternal` 的注释说的就是"面板底部"，`ExternalDocumentationHandler.java:31-40`）。
//
// 两条分节来源，都按上游逐条实现，不猜：
//   1. javadoc 块标签 —— `DocCommentLineDataBuilder.parseLine`
//      （`platform/code-style-impl/src/com/intellij/formatting/comments/DocCommentLineDataBuilder.java:67-107`）：
//      `@` 开头才是标签行（:75）；`@param` 后面跟的是**参数名**（:81-89，`$T` 这种类型参数引用
//      不跳，:84）；`@return`/`@throws` 后面跟的是**一个词**（:91-93）；剩下的才是描述（:101）。
//   2. markdown 的 `**标题**` + `---` 横线 —— `DocComment` 的分节写法，也就是
//      `DocumentationProvider` 手写 `SECTIONS_START` 之前最常见的形态。
//
// 上游还有两条对分节表的**后处理**（`DocumentationHtmlUtil.kt:143-178`），这里一并落：
//   · `removeEmptySections`（:143-149）：分节表里只剩注释/空白的行整节删掉；
//   · `addExternalLinkIcons`（:152-159）：`href` 以 `http` 开头的 `<a>` 末尾追加
//     `AllIcons.Ide.External_link_arrow` 图标（渲染层用 lucide `ExternalLink`）。

import type { DocBlock, DocImage, DocLink, DocPart, QuickDocModel } from './documentationView.ts'
import { docPartsFromMarks, docPartsToMarks, docTextFromMarks, externalDocumentationLinks } from './documentationView.ts'
import type { HoverDocumentation } from './hoverDocumentation.ts'

/**
 * 弹层几何 —— 逐个抄上游 `DocumentationHtmlUtil.kt:44-77`。
 *
 * 本仓 `.quickdoc-popup` 现在的 `width: 460px / max-height: 300px` 与这里的
 * `docPopupPreferredMaxWidth = 500` / `docPopupMaxHeight = 500` **不一致**（见判决），
 * 这里只登记上游真值，不去改 `src/style.css`（共享文件）。
 */
export const DOC_POPUP_METRICS = {
  /** `contentOuterPadding`：`html` 左右内边距（`DocumentationHtmlUtil.kt:46`，用在 :117）。 */
  contentOuterPadding: 14,
  /** `contentInnerPadding`：`definition`/`content`/`sections` 单元格的内边距（`:50`）。 */
  contentInnerPadding: 2,
  /** `spaceBeforeParagraph`（`:53`）→ `JBHtmlPaneStyleConfiguration.kt:349` = 4。 */
  spaceBeforeParagraph: 4,
  /** `spaceAfterParagraph`（`:56`）→ `JBHtmlPaneStyleConfiguration.kt:352` = 4。 */
  spaceAfterParagraph: 4,
  /** `docPopupPreferredMinWidth`（`:59`）。 */
  preferredMinWidth: 300,
  /** `docPopupPreferredMaxWidth`（`:62`）。 */
  preferredMaxWidth: 500,
  /** `docPopupMinWidth`（`:65`）。 */
  minWidth: 300,
  /** `docPopupMaxWidth`（`:68`）。 */
  maxWidth: 900,
  /** `docPopupMaxHeight`（`:71`）。 */
  maxHeight: 500,
  /** `lookupDocPopupWidth`（`:74`）—— 补全弹层那条文档浮层的宽度。 */
  lookupDocPopupWidth: 450,
  /** `lookupDocPopupMinHeight`（`:77`）。 */
  lookupDocPopupMinHeight: 300,
  /**
   * `.section` 的 `padding-right: 4px`（`DocumentationHtmlUtil.kt:135`）。
   * 注意同一句里 DocRenderer 写的是 5（`DocRenderer.java:424`，`scaleFunction.apply(5)`）——
   * 两处不一致，这里取弹层那条（`:135`）的 4。
   */
  sectionPaddingRight: 4,
} as const

/** 上游的 class 名。渲染层照抄这些名字，`style.css` 里同名规则即为对上游 CSS 的翻译。 */
export const DOC_MARKUP_CLASS = {
  definition: 'definition',
  content: 'content',
  sections: 'sections',
  section: 'section',
  bottom: 'bottom',
  grayed: 'grayed',
} as const

/** 一行分节 = 左表头 + 右内容（`DocumentationMarkup.java:28-31` 的两个 `td`）。 */
export interface DocSection {
  /** 左格：`CLASS_SECTION`（灰化、`white-space: nowrap`，`DocumentationHtmlUtil.kt:135`）。 */
  header: string
  /** 右格：`td[valign=top]`，行内内容会被 `addParagraphsIfNeeded` 包成一段（`:162-178`）。 */
  content: string
  /**
   * 右格里的内联链接分段（与 `DocBlock.parts` 同一形态）：这一节里**有**链接才给，
   * 没有就是 `undefined`，渲染层直接读 `content`。
   * `@param` 那类被拆过的行同样带得住 —— 拆标签用的是带占位符的原文
   * （`parseDocCommentLineParts`），链接在句子里的位置一步没丢。
   */
  parts?: DocPart[]
}

export interface QuickDocLayout {
  /** `CLASS_DEFINITION`：签名与它的语言（`LspDocumentationData.definitionCodeBlock/definitionLanguage`）。 */
  definition: { code: string; language: string | null } | null
  /** `CLASS_CONTENT`：第一个分节之前的正文。 */
  content: DocBlock[]
  /** `CLASS_SECTIONS`：分节表，空节已按 `removeEmptySections` 删掉。 */
  sections: DocSection[]
  /**
   * 正文**放不下**的链接（只剩代码块里的 `<a>`：`<pre>` 那一段按等宽原样显示，不做链接）。
   * 能在句子里点掉的已经进 `content[].parts` / `sections[].parts`，这里不重复列 ——
   * 上游的引用就长在正文里（`DocumentationMarkup.java:24` 的 `CONTENT_START` 那段 HTML，
   * 由 `DocMarkdownToHtmlConverter.kt:68` 把 `a` 留在行内标签白名单里），没有第二条「链接清单」。
   */
  links: DocLink[]
  images: DocImage[]
  /** `CLASS_BOTTOM`：底部那一行的外部文档链接（没有就是 `null`）。 */
  external: DocLink | null
}

/** javadoc 一行的解析结果（`DocCommentLineData.parseLine` 的形状）。 */
export interface DocCommentLine {
  /** `@param` 这样的标签名（含 `@`）；不是标签行就是空串（`DocCommentLineDataBuilder.java:79`）。 */
  tag: string
  /** 标签之后**跳过一个词**得到的那个词：参数名 / 异常类型（:81-93）。 */
  subject: string
  /** 剩下的描述（:101 的 `textStartOffset` 起）。 */
  text: string
}

/**
 * javadoc 一行 → 标签 / 主题词 / 描述。逐条照 `DocCommentLineDataBuilder.parseLine`：
 *   · 去掉前导空白与注释的 `*`（`:69-71`）；
 *   · `@` 开头才算标签行（`:75`），标签名取到下一个空白为止（`:77-78`）；
 *   · `@param` 跳一个词当参数名（`:81-89`）—— `$T` 那种类型参数引用上游不当参数名（`:84-88`），
 *     但描述的起点同样在它之后（`:99-101`），所以本仓左格显示的就是 `$T`，两条一致；
 *   · `@throws` 跳一个词（`:91-93`）；`@return` 上游也跳（同一条 `:91-93`），本仓**故意不跳**：
 *     弹层那格的语义是「主题词」，`@return` 没有主题词，跳了会把描述的第一个词当主题吃掉。
 */
export function parseDocCommentLine(line: string): DocCommentLine {
  const offsets = docCommentLineOffsets(line)
  if (!offsets) return { tag: '', subject: '', text: line.trim() }
  return { tag: offsets.tag, subject: offsets.subject, text: line.slice(offsets.headFrom).trim() }
}

/**
 * `parseDocCommentLine` 的**偏移**版：标签/主题词之外再给出「描述从第几个字符起」。
 * 之所以要偏移而不是切好的三段 —— 带内联链接的那一行原文里嵌着占位符
 * （`documentationView.ts` 的 `LINK_MARK`），布局层要按字符切完再把这一段还原成 `parts`
 * 才能把链接留在句子里（上游的分节右格就是 `SECTION_SEPARATOR` 之后那段 HTML，
 * `DocumentationMarkup.java:29`，链接长在里面）。
 * 返回 `null` = 不是标签行（`DocCommentLineDataBuilder.java:75`）。
 */
function docCommentLineOffsets(line: string): { tag: string; subject: string; headFrom: number } | null {
  let offset = /^\s*/.exec(line)?.[0].length ?? 0
  if (line[offset] === '*') ++offset
  const first = offset + (/^\s*/.exec(line.slice(offset))?.[0].length ?? 0)
  if (line[first] !== '@') return null
  const space = line.indexOf(' ', first)
  const tag = space < 0 ? line.slice(first) : line.slice(first, space)
  // 标签后面什么都没有：`@see` 这种，描述起点就是行尾（正文空）。
  if (space < 0 || !line.slice(space).trim()) return { tag, subject: '', headFrom: line.length }
  if (tag === '@param' || tag === '@throws' || tag === '@exception') {
    // 跳过的这一词 = 参数名 / 异常类型（`:81-89`、`:91-93`）。
    // `@param $T …` 的 `$T` 是类型参数引用，上游不把它当参数名跳（`:84-88`），
    // 但描述的起点同样是它之后（`:99-101`），所以左格里显示的就是 `$T`，与本仓一致。
    const gap = /^\s*/.exec(line.slice(space))?.[0].length ?? 0
    const word = /^\S+/.exec(line.slice(space + gap))?.[0] ?? ''
    return { tag, subject: word, headFrom: space + gap + word.length }
  }
  return { tag, subject: '', headFrom: space + (/^\s*/.exec(line.slice(space))?.[0].length ?? 0) }
}

/**
 * 一行带内联链接的标签行 → 标签 / 主题词 / **描述的分段**。
 * 与 `parseDocCommentLine` 同一套偏移（那一条读的是折回显示名之后的 `block.text`，两者不会分叉），
 * 差别只在描述这一段还带着链接，于是 `@param a 见 {@link Foo}` 的 `Foo` 落在分节右格里，
 * 而不是被挤到弹层下方那条「链接清单」上。
 */
export function parseDocCommentLineParts(block: DocBlock, links: DocLink[]): DocCommentLine & { parts: DocPart[] } {
  const raw = docPartsToMarks(block.parts ?? [{ text: block.text }], links)
  const offsets = docCommentLineOffsets(raw)
  const head = offsets ? raw.slice(offsets.headFrom) : raw
  return {
    tag: offsets?.tag ?? '',
    subject: offsets?.subject ?? '',
    // `text` 是**折回显示名**的那一份（与 `parseDocCommentLine` 逐字同形），
    // `parts` 是留着占位符的那一份 —— 两条同出一个 `head`，纯文本里才不会漏出 `\u0002`。
    text: docTextFromMarks(head, links).trim(),
    parts: trimDocParts(docPartsFromMarks(head, links)),
  }
}

/** 只掐掉**首尾**文本段两端的空白：中间的段（含链接之间那个空格）一概不动。 */
function trimDocParts(parts: DocPart[]): DocPart[] {
  const out = parts.slice()
  while (out.length && !('link' in out[0]) && out[0].text.trim() === '') out.shift()
  while (out.length) {
    // 尾部那一条按下标取，TS 收窄不到（下标不是字面量），所以先落到局部变量上再判 `link`。
    const tail = out[out.length - 1]
    if (!tail || 'link' in tail || tail.text.trim() !== '') break
    out.pop()
  }
  const first = out[0]
  if (first && !('link' in first)) out[0] = { text: first.text.replace(/^\s+/, '') }
  const last = out[out.length - 1]
  if (last && !('link' in last)) out[out.length - 1] = { text: last.text.replace(/\s+$/, '') }
  return out
}

/** markdown 分节横线：`---` / `***` / `___`（`DocComment` 的分节写法）。 */
const SECTION_RULE = /^(?:-{3,}|\*{3,}|_{3,})$/

/** 一节还没成形时的样子：表头 + 起点正文（`@tag` 那种被拆出来的）+ 后续并进来的块。 */
interface SectionDraft {
  header: string
  /** `@param x 说明` 里那句「说明」；横线起头的节是 `null`（起点就是第一个块）。 */
  head: string | null
  /** 那句「说明」的**分段**形态（链接留在原句里）；横线起头的节同样是 `null`。 */
  headParts: DocPart[] | null
  blocks: DocBlock[]
}

/**
 * 把一个正文区块拆成「正文 + 分节」。
 *
 * 两种分节都收：`---` 横线（横线**前**那个块是表头，`DocComment` 写法）与
 * `@tag` 标签行（表头按 `parseDocCommentLine` 的 subject / tag 决定）。
 * 标签行的续行（不以 `@` 开头）并进当前节的正文 —— javadoc 里 `@param x` 的说明常常换行续写。
 *
 * 表头那块**只**进节表的左格：上游没有第二处把它留在正文里
 * （`DocumentationMarkup.java:28-31` 的一行就是「左 `td.section` 表头 + 右格内容」）。
 */
function splitSections(blocks: DocBlock[], links: DocLink[]): { content: DocBlock[]; sections: DocSection[] } {
  const content: DocBlock[] = []
  const drafts: SectionDraft[] = []
  let current: SectionDraft | null = null
  for (let index = 0; index < blocks.length; ++index) {
    const block = blocks[index]
    if (block.kind !== 'text') {
      // 代码块/标题不参与分节切分：它们原样留在正文里。
      if (current) current.blocks.push(block)
      else content.push(block)
      continue
    }
    if (SECTION_RULE.test(block.text.trim())) {
      const header = previousHeader(blocks, index)
      if (header) {
        const previous = blocks[index - 1]
        if (current && current.blocks.length && current.blocks[current.blocks.length - 1] === previous) current.blocks.pop()
        else if (!current && content.length && content[content.length - 1] === previous) content.pop()
        current = { header, head: null, headParts: null, blocks: [] }
        drafts.push(current)
        continue
      }
    }
    if (block.text.startsWith('@')) {
      const parsed = parseDocCommentLineParts(block, links)
      // 描述为空时表头就是标签本身（`@return` / `@see` 这类没有主题词的）。
      const header = parsed.subject || parsed.tag
      if (header) {
        current = { header, head: parsed.text, headParts: parsed.parts, blocks: [] }
        drafts.push(current)
        continue
      }
    }
    if (current) current.blocks.push(block)
    else content.push(block)
  }
  return { content, sections: drafts.map(finishSection) }
}

/**
 * 草稿节 → 一行。右格（`DocumentationMarkup.java:29` 的 `SECTION_SEPARATOR` 之后那格）
 * 是**一段 HTML**，链接就长在里面 —— 所以 `parts` 的口径是「这一段里真的有链接就给」，
 * 不再是「起点正文能被分段还原」那种局部条件：起点被 `@param` 拆过的行现在也拆得动
 * （`parseDocCommentLineParts`），给不出 `parts` 的只剩整节都没有链接的那种，那时读 `content`
 * 这条纯文本就够，形状与改动前一致。
 */
function finishSection(draft: SectionDraft): DocSection {
  const segments: DocPart[][] = []
  let text = draft.head ?? ''
  if (draft.head) segments.push(draft.headParts ?? [{ text: draft.head }])
  for (const block of draft.blocks) {
    const gap = text ? '\n\n' : ''
    text += gap + block.text
    if (gap) segments.push([{ text: gap }])
    segments.push(block.parts ?? [{ text: block.text }])
  }
  const parts = segments.flat()
  const section: DocSection = { header: draft.header, content: text }
  if (parts.some(part => 'link' in part)) section.parts = parts
  return section
}

/** 横线之前那一个块，剥掉 `**` 就是表头；不是标题就返回空串（那一横线当普通正文）。 */
function previousHeader(blocks: DocBlock[], ruleIndex: number): string {
  const previous = blocks[ruleIndex - 1]
  if (!previous || previous.kind !== 'text') return ''
  const text = previous.text.trim()
  const bold = /^\*\*(.+)\*\*$/.exec(text)
  return bold ? bold[1].trim() : ''
}

/**
 * `parseQuickDoc` 的模型 + `createHoverDocumentation` 的签名/描述 → 弹层布局。
 *
 * 两块输入正好对上上游的两段：签名进 `CLASS_DEFINITION`（`LspDocumentationData.toQuickDocHtml`
 * 的 `DEFINITION_START + … + DEFINITION_END`，`LspDocumentationData.kt:83-88`），描述的
 * markdown 进 `CLASS_CONTENT`，分节进 `CLASS_SECTIONS`（同文件 `:91-103`）。
 */
export function buildQuickDocLayout(
  documentation: HoverDocumentation,
  model: QuickDocModel,
): QuickDocLayout {
  const { content, sections } = splitSections(model.blocks, model.links)
  const external = externalDocumentationLinks(model)[0] ?? null
  // 已经**长在句子里**的链接不再重复列一行；剩下的是进不了正文的那一种：`<pre>` 里的 `<a>`
  // （代码块按等宽原样显示，上游不在签名里点链接）。
  const inline = new Set<DocLink>()
  for (const block of content) for (const part of block.parts ?? []) if ('link' in part) inline.add(part.link)
  for (const section of sections) for (const part of section.parts ?? []) if ('link' in part) inline.add(part.link)
  return {
    definition: documentation.definitionCodeBlock
      ? { code: documentation.definitionCodeBlock, language: documentation.definitionLanguage }
      : null,
    // `removeEmptySections`（DocumentationHtmlUtil.kt:143-149）：只剩空白的节整节删掉。
    sections: sections.filter(section => section.content.trim() !== ''),
    content,
    links: model.links.filter(link => !inline.has(link)),
    images: model.images,
    external,
  }
}

/**
 * 当前这一页的外部文档 URL —— 上游 `DocumentationBrowser.currentExternalUrl()` 的形状
 * （`DocumentationViewExternalAction.kt:15` 用它决定这个动作是否 `isEnabledAndVisible`）。
 * 只有真的存在 `http`/`https` 链接时才有值。
 */
export function currentExternalUrl(layout: QuickDocLayout): string | null {
  return layout.external && layout.external.kind === 'external' ? layout.external.target : null
}
