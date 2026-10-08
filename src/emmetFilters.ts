// Emmet 过滤器族（|bem / |c / |e / |s / |t / |xsl）的纯函数端口（无 Vue、无宿主状态、无 PSI）。
//
// 上游坐标（参考树逐行核过，2026-10-08；目录 `xml/emmet/src/com/intellij/codeInsight/template/emmet/filters/`）：
//   基类 `ZenCodingFilter.java`    `:17-19` filterText 默认原样、`:21-23` filterNode 默认原样、`:25` getSuffix、
//                                 `:27` isMyContext、`:29-31` isAppliedByDefault（isSystem 或
//                                 EmmetOptions.isFilterEnabledByDefault(suffix)）、`:36-38` isSystem、
//                                 `:42-44` getInstances 读扩展点。六个过滤器各自只覆写其中一部分。
//   `BemEmmetFilter.java`         `:30` SUFFIX=bem、`:32` BLOCK_NAME_PATTERN=`^[A-z]-`（配 :202 matcher.matches()，
//                                 即整串匹配，等价 `^[A-z]-$`）、`:50-70` filterNode（读 class 属性、按生成树建/推进
//                                 每节点 BEM_STATE 用户数据、`:67` 把 class 回写成空格连接的集合）、`:72-110`
//                                 processClassName、`:112-135` extractBemStateFromClassName、`:137-143`
//                                 fillWithBemElements/fillWithBemModifiers、`:154-178` transformClassNameToBemFormat
//                                 （`:160` `while (donor.getParent() != null && depth > 0)` 沿父链爬 depth 层）、
//                                 `:185-192` getCleanStringAndDepth、`:201-207` suggestBlockName、
//                                 `:209-222` normalizeClassName（短前缀换成元素分隔符）。
//   `CommentZenCodingFilter.java` `:15-24` buildCommentString（先 `#id` 再 `.class`）、`:27-38` filterText
//                                 （`tag == null` 或 class/id 皆空 → 原样）、`:40-42`
//                                 getCommentFormat = `%s\n<!-- /%s -->`、`:44-47` SUFFIX=c。
//   `EscapeZenCodingFilter.java`  `:12-17` 依次替 `&` `<` `>`（顺序即语义：先替 `&` 才不会把新实体二次转义）、
//                                 `:19-22` SUFFIX=e。
//   `SingleLineEmmetFilter.java`  `:20-22` filterText = 删 `\n`、`:25-34` filterNode = 关模板 reformat 并递归、
//                                 `:14-17` SUFFIX=s。
//   `TrimZenCodingFilter.java`    `:18` PATTERN、`:36-57` filterText（`:37-53` PSI 半边：遍历生成标签、
//                                 值的整串匹配则清空；`:55` 无标签半边：模板文本前缀修剪）、`:60-73`
//                                 filterNode/doFilter（`:68` 对每个节点的 surroundedText 同一算子）、`:20-23` SUFFIX=t。
//   `XslZenCodingFilter.java`     `:17` SELECT_ATTR_NAME=select、`:20-37` filterNode（缩写自带 select → 不动；
//                                 `with-param`/`variable` 且有子节点 → 删该标签的 select）、`:39-45` isOurTag、
//                                 `:53-56` SUFFIX=xsl。
//   注册与顺序 `xml/emmet/resources/intellij.xml.emmet.xml:34-39`：Xsl→Comment→Escape→SingleLine→Bem→Trim
//                                 （扩展点顺序即过滤器作用顺序）。
//   数据来源     `tokens/TemplateToken.java:46-48` getAttributes、`:54-56` getTemplateText、`:66-68` getXmlTag
//                                 （模板 PSI 里第一个 XmlTag）；
//                `nodes/GenerationNode.java:101-103` getChildren、`:567` getSurroundedText、`:571` setSurroundedText、
//                                 `:575` getParent、`:212` 子节点各自 generate（故每节点都过一次 filterNode）；
//                `psi/impl/source/xml/XmlTagValueImpl.java:57-67` 值文本 = 全部子元素文本拼接、`:104-135`
//                                 setText("") 走 text.delete() 并删掉其余子元素；
//                `xml/xml-parser/src/com/intellij/xml/util/BasicHtmlUtil.java:36-37` id/class 属性名、`:231-234`
//                                 splitClassNames（StringTokenizer 按 ` \t,` 分词、跳过空段）；
//                `application/options/emmet/EmmetOptions.java:30-32` BEM 默认分隔符 `__` / `_` / `-`；
//                `generators/XmlZenCodingGeneratorImpl.java:57-68` 属性串（空格分隔）、`:99-101` 属性渲染
//                                 `name="value"`。
//
// 本仓登记差异（不是上游行为，接线时向用户如实说明）：
//   1. filterNode 一族上游就地改节点树，本仓表达为「调用方按自己的节点逐节点调用本模块」：BEM 的祖先链由
//      bemFilterClassValue 的 ancestorClassValues 传入（上游 `BemEmmetFilter.java:159-163` 沿父链爬），Trim 的
//      围选文本由调用方逐节点调 trimLineMarkers（上游 `TrimZenCodingFilter.java:65-73` 自己递归），XSL 只处理
//      传入片段的根起始标签（上游每个节点各自过一遍，`GenerationNode.java:212`）。
//   2. Trim 的 PSI 半边（上游 `TrimZenCodingFilter.java:37-53`）**无法移植**：它要求把片段解析成 XmlTag 树，对每个
//      有值标签取值文本（XmlTagValueImpl.java:57-67，子标签文本也在内）做整串匹配后清空（:104-135）。本仓无 PSI，
//      纯文本等价改写必须自建标签树，故 trimEmmetFilterText 在 hasXmlTag=true 时原样返回 —— 复现不了
//      `<div>1. </div>` → `<div></div>` 这类上游行为；这是明确缺口，不是近似实现。
//   3. XSL 的 select 属性在上游来自 live 模板（本仓无 live 模板注册表，见 `src/emmetHtml.ts` 差异 1），故本模块只在
//      调用方给出的片段自带 select 时可见效果；删 select 时其余属性按生成器口径重排（空格分隔、双引号）。
//   4. 六个过滤器的 isMyContext / isAppliedByDefault（XML 语言、xsl/xslt 文件、EmmetOptions 默认启用集合）都是宿主
//      门控：本模块不做判断，调用方负责；各文件行号见下面对应函数注释。
//   5. 本仓无 reformat 管线，`SingleLineEmmetFilter.java:25-34` 的 setToReformat(false) 无对应物，只保留 `:21`
//      的删换行本身。
//   6. BEM 的每节点 BEM_STATE（上游用 UserDataHolder 存）在本仓是显式入参/返回值；除此之外算法逐行直译，含上游
//      `:32` 的 `[A-z]`、`:202` 的整串匹配等原样口径。

// ── 公共事实 ───────────────────────────────────────────────────────────────────

/** 上游 BasicHtmlUtil.java:36-37（HtmlUtil.java:87-88 只是转出）。 */
const ID_ATTRIBUTE = 'id'
const CLASS_ATTRIBUTE = 'class'

/** 上游 XslZenCodingFilter.java:17。 */
const SELECT_ATTRIBUTE = 'select'

/**
 * 片段开头的起始标签：`<name ...>` / `<name .../>`（属性值可含空白与 `>`，属性区不跨到别的标签）。
 * 文本端口用它定位「生成节点自己的标签」；上游对应 token.getXmlTag() 拿到的那个标签。
 */
const ROOT_START_TAG = /^<([A-Za-z_:][-\w:.]*)((?:\s[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]*))?)*)\s*\/?>/

/** 起始标签内的单个属性（生成器口径 `name="value"`，`XmlZenCodingGeneratorImpl.java:99-101`）。 */
const START_TAG_ATTRIBUTE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]*)))?/g

// ── Escape（EscapeZenCodingFilter.java）───────────────────────────────────────

/**
 * EscapeZenCodingFilter（suffix `e`，上游 `:19-22`）。
 * 上游 `:13-15` 是 `s = s.replace(...)` 链，依次替 `&` → `&amp;`、`<` → `&lt;`、`>` → `&gt;`：顺序是语义的一部分，
 * 先替 `&` 才不会把后两步产生的实体再转义一次（String.replace 是字面全量替换，非正则）。
 * isMyContext `:25-27` = XML 语言（宿主门控，见文件头差异 4）。
 */
export function escapeEmmetFilterText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ── SingleLine（SingleLineEmmetFilter.java）───────────────────────────────────

/**
 * SingleLineEmmetFilter（suffix `s`，上游 `:14-17`）。
 * 上游 `:21` `return StringUtil.replace(text, "\n", "")` —— 只删换行符，缩进/其余空白不动
 * （StringUtil.replace 字面全量替换，`platform/util/src/com/intellij/openapi/util/text/StringUtil.java:162-164`）。
 * 上游 `:25-34` 的 filterNode（`:28` template.setToReformat(false) + `:30-32` 递归子节点）在本仓无 reformat 管线可关，
 * 见文件头差异 5。isMyContext `:36-39` = XML 语言。
 */
export function singleLineEmmetFilterText(text: string): string {
  return text.replace(/\n/g, '')
}

// ── Comment（CommentZenCodingFilter.java）────────────────────────────────────

/** CommentZenCodingFilter（suffix `c`，上游 `:44-47`）的上下文。 */
export interface CommentFilterContext {
  /** 上游 `:28` `XmlTag tag = token.getXmlTag()` 是否非 null（TemplateToken.java:66-68：模板 PSI 里第一个 XmlTag）。 */
  readonly hasXmlTag: boolean
  /** 上游 `:30-31` `token.getAttributes()`（TemplateToken.java:46-48）：缩写里写的属性。 */
  readonly attributes: Readonly<Record<string, string | undefined>>
}

/**
 * CommentZenCodingFilter（上游 `:27-38`）。
 * 逐条口径：`:29-30` tag 为 null → 原样（`:37` return text）；`:32` class 与 id 皆空（Strings.isEmpty，
 * `platform/util/base/src/com/intellij/openapi/util/text/Strings.java:378-380`）→ 原样；`:33` 注释串由
 * `:15-24` buildCommentString 拼（`:18` 先 `#id`、`:21` 再 `.class`）；`:34` 套 `:40-42` getCommentFormat
 * `%s\n<!-- /%s -->`，两个 `%s` 依次是 text 与注释串 → 文本 + "\n<!-- /" + 注释串 + " -->"。
 * isMyContext `:49-53`：父元素是 XML 语言（宿主门控）。
 */
export function commentEmmetFilterText(text: string, ctx: CommentFilterContext): string {
  if (!ctx.hasXmlTag) return text
  const classAttr = ctx.attributes[CLASS_ATTRIBUTE]
  const idAttr = ctx.attributes[ID_ATTRIBUTE]
  if (!classAttr && !idAttr) return text
  let comment = ''
  if (idAttr) comment += `#${idAttr}`
  if (classAttr) comment += `.${classAttr}`
  return `${text}\n<!-- /${comment} -->`
}

// ── Trim（TrimZenCodingFilter.java）───────────────────────────────────────────

/** TrimZenCodingFilter（suffix `t`，上游 `:20-23`）的上下文。 */
export interface TrimFilterContext {
  /**
   * 上游 `:37` `XmlTag tag = token.getXmlTag()` 是否非 null —— 决定走上游 `:37-53` 的 PSI 半边。
   * 本仓未移植那一半（文件头差异 2）：为 true 时原样返回。
   */
  readonly hasXmlTag: boolean
}

/**
 * 上游 `:18` PATTERN 的直译：`^([\s|\u00a0])?[\d|#|\-|\*|\u2022]+\.?\s*`。
 * 逐点对齐：`\s` 是 Java 默认的 ASCII 空白 `[ \t\n\x0B\f\r]`（不是 JS 的 `\s`，后者含 Unicode 空白）；
 * 字符类里的 `|` `-` `*` 与 `\u00a0`、`\u2022` 都是字面量（上游照抄）；开头最多一个「空白/竖线/nbsp」；
 * 结尾 `[ \t\n\x0B\f\r]*` 是零个或多个空白；模式带 `^` 且无 MULTILINE，故只可能命中下标 0 ——
 * 与 JS 首次替换等价（Java 侧 `replaceAll` 也只可能在 0 位命中）。
 */
const TRIM_MARKER_PATTERN = /^[ \t\n\u000B\f\r|\u00a0]?[\d|#\-*\u2022]+\.?[ \t\n\u000B\f\r]*/

/**
 * 前缀修剪：上游两处同一算子 —— `:55` `return PATTERN.matcher(token.getTemplateText()).replaceAll("")`
 * 与 `:68` `node.setSurroundedText(PATTERN.matcher(surroundedText).replaceAll(""))`。后者上游按节点树递归
 * （`:70-72`），本仓由调用方逐节点调用（文件头差异 1）。
 * 本仓把「展开后的片段文本」当上游的 token.getTemplateText() 用（无标签缩写时二者同形，
 * 见 `src/emmetHtml.ts` 差异 4）。
 */
export function trimLineMarkers(text: string): string {
  return text.replace(TRIM_MARKER_PATTERN, '')
}

/**
 * TrimZenCodingFilter.filterText（上游 `:36-57`）。
 * 上游两条路：`:37-53` 有标签时遍历生成标签树，对每个有值的标签（`:42` `!tag.isEmpty()`）取值文本
 * （XmlTagValueImpl.java:57-67），整串匹配 PATTERN（`:45` `matcher.matches()`）就 `:46` `tagValue.setText("")`
 * 清空值文本（XmlTagValueImpl.java:104-135），最后 `:52` 返回 tag.getText()；`hasXmlTag` 为 true 时本仓**不移植**
 * 这一半（PSI/标签树，文件头差异 2），原样返回；`:38` `tag.getText().isEmpty()` 的短路在此对应空片段原样。
 * `:55` 无标签时对模板文本做前缀修剪 —— 即 trimLineMarkers。
 */
export function trimEmmetFilterText(text: string, ctx: TrimFilterContext): string {
  if (ctx.hasXmlTag) return text
  return trimLineMarkers(text)
}

// ── XSL（XslZenCodingFilter.java）────────────────────────────────────────────

/** XslZenCodingFilter（suffix `xsl`，上游 `:53-56`）的上下文。 */
export interface XslFilterContext {
  /** 上游 `:27` `!node.getChildren().isEmpty()`（GenerationNode.java:101-103）：该节点有子节点。 */
  readonly hasChildren: boolean
  /** 上游 `:24` `token.getAttributes()`（TemplateToken.java:46-48）。 */
  readonly attributes: Readonly<Record<string, string | undefined>>
}

/** 起始标签的属性拆分（上游 XmlTag.getAttributes() 的文本端口）。返回 [属性名, 重排后的属性文本]。 */
function splitStartTagAttributes(attributeText: string): Array<[string, string]> {
  const result: Array<[string, string]> = []
  for (const match of attributeText.matchAll(START_TAG_ATTRIBUTE)) {
    const groups: readonly (string | undefined)[] = match
    const name = groups[1] ?? ''
    if (name === '') continue
    const value = groups[2] ?? groups[3] ?? groups[4] ?? null
    result.push([name, value === null ? name : `${name}="${value}"`])
  }
  return result
}

/**
 * XslZenCodingFilter.filterNode（上游 `:20-37`）的文本端口。
 * 逐条口径：`:22-23` token 为 null 或 token.getXmlTag() 为 null → 原样（无标签可改）；`:24-26` 缩写自带 `select`
 * （getAttributes().containsKey）→ 不动（不覆盖用户显式写的 select）；`:27`+`:39-45` isOurTag = 有子节点且 local name
 * 是 `with-param` 或 `variable`（getLocalName 去命名空间前缀，故 `xsl:variable` 命中；无子节点一律 false）；
 * `:28-33` 取 select 属性（`:29` getAttribute），有则 `:31` `attribute.delete()` 删掉它。
 * 本仓边界（文件头差异 3）：只看片段的根起始标签（上游每节点各过一次 filterNode，GenerationNode.java:212）；
 * 属性按生成器口径重排（空格分隔、双引号，XmlZenCodingGeneratorImpl.java:57-68 + :99-101）。
 * isMyContext `:48-51`（XmlZenCodingGeneratorImpl.java:76-78 与 XslTextContextType.java:25-28）、
 * isAppliedByDefault `:58-61` 是宿主门控。
 */
export function xslEmmetFilterText(text: string, ctx: XslFilterContext): string {
  if (Object.hasOwn(ctx.attributes, SELECT_ATTRIBUTE)) return text
  if (!ctx.hasChildren) return text
  const startTag = ROOT_START_TAG.exec(text)
  if (startTag === null) return text
  const tagName = startTag[1] ?? ''
  const localName = tagName.slice(tagName.lastIndexOf(':') + 1)
  if (localName !== 'with-param' && localName !== 'variable') return text
  const attributes = splitStartTagAttributes(startTag[2] ?? '')
  const kept = attributes.filter(attribute => attribute[0] !== SELECT_ATTRIBUTE)
  if (kept.length === attributes.length) return text // 上游 `:29-30` 属性不存在 → 不改
  const selfClosing = startTag[0].endsWith('/>')
  const head = kept.length > 0 ? `${tagName} ${kept.map(attribute => attribute[1]).join(' ')}` : tagName
  return `<${head}${selfClosing ? '/>' : '>'}` + text.slice(startTag[0].length)
}

// ── BEM（BemEmmetFilter.java）─────────────────────────────────────────────────

/**
 * 上游 `:32` BLOCK_NAME_PATTERN = `^[A-z]-`，配合 `:202` `matcher.matches()`（整串匹配）→ 等价 `^[A-z]-$`。
 * `[A-z]` 是上游原样写法（含 `[ \ ] ^ _ ` 五个非字母字符），照抄不修正。
 */
const BEM_BLOCK_NAME_PATTERN = /^[A-z]-$/

/** 上游 `:204` `Character.isLetter(s.charAt(0))`：Java 的字母 = Unicode L 类（Lu/Ll/Lt/Lm/Lo）。 */
const UNICODE_LETTER = /^\p{L}$/u

/** BEM 三个分隔符；默认值 = 上游 EmmetOptions.java:30-32（`:56-58` 每次读设置）。 */
export interface BemSeparators {
  readonly element: string
  readonly modifier: string
  readonly shortPrefix: string
}

export const EMMET_BEM_SEPARATORS: BemSeparators = { element: '__', modifier: '_', shortPrefix: '-' }

/**
 * 每节点的 BEM 状态（上游 `:224-269` BemState；block/element/modifier 为空用空串，对齐 StringUtil.isEmpty 的
 * 判空口径）。链上用 null 表示「该节点没写 class」——上游此时不设 BEM_STATE（`:55`），后代爬到它时 `:166`
 * `bemState == null` → 原样。
 */
interface BemState {
  block: string
  element: string
  modifier: string
}

/** 上游 `:231-234` splitClassNames（StringTokenizer 按 ` \t,` 分词、跳过空段）。 */
function splitClassNames(classValue: string): string[] {
  return classValue.split(/[ \t,]+/).filter(part => part !== '')
}

/** 上游 `:201-207` suggestBlockName：先找整串匹配 `^[A-z]-$` 的类名，否则第一个以字母开头的类名，都没有则空串。 */
function suggestBemBlockName(classNames: readonly string[]): string {
  const byPattern = classNames.find(name => BEM_BLOCK_NAME_PATTERN.test(name))
  if (byPattern !== undefined) return byPattern
  return classNames.find(name => name !== '' && UNICODE_LETTER.test(name[0] ?? '')) ?? ''
}

/** 上游 `:209-222` normalizeClassName：类名以短前缀开头时，每个前缀换成元素分隔符。 */
function normalizeBemClassName(className: string, elementSeparator: string, shortElementPrefix: string): string {
  if (shortElementPrefix === '' || !className.startsWith(shortElementPrefix)) return className
  let result = ''
  while (className.startsWith(shortElementPrefix)) {
    className = className.substring(shortElementPrefix.length)
    result += elementSeparator
  }
  return result + className
}

/** 上游 `:185-192` getCleanStringAndDepth：数开头的分隔符个数并去掉它们（分隔符为空串时不动，`:187` 先判空）。 */
function cleanStringAndDepth(name: string, separator: string): { name: string; depth: number } {
  let depth = 0
  while (separator !== '' && name.startsWith(separator)) {
    depth++
    name = name.substring(separator.length)
  }
  return { name, depth }
}

/** 上游 `:112-135` extractBemStateFromClassName：按元素/修饰符分隔符拆 block / element / modifier。 */
function extractBemState(className: string, elementSeparator: string, modifierSeparator: string): BemState {
  const state: BemState = { block: '', element: '', modifier: '' }
  const elementIndex = className.indexOf(elementSeparator)
  if (elementIndex >= 0) {
    state.block = className.substring(0, elementIndex)
    state.element = className.substring(elementIndex + elementSeparator.length)
    const lastElementIndex = className.lastIndexOf(elementSeparator)
    // 上游 `:121` 从**最后一个**元素分隔符之后开始找修饰符分隔符（故 name__a__b 的 b 不拆成修饰符）
    const modifierIndex = className.indexOf(modifierSeparator, lastElementIndex + elementSeparator.length)
    if (modifierIndex >= 0) {
      state.modifier = className.substring(modifierIndex + modifierSeparator.length)
      state.element = className.substring(elementIndex + elementSeparator.length, modifierIndex)
    }
  } else {
    const modifierIndex = className.indexOf(modifierSeparator)
    if (modifierIndex >= 0) {
      state.block = className.substring(0, modifierIndex)
      state.modifier = className.substring(modifierIndex + modifierSeparator.length)
    }
  }
  return state
}

/**
 * 上游 `:154-178` transformClassNameToBemFormat：类名开头的分隔符个数 = 要爬的层数，爬到那一层的 block
 * （修饰符还要带上它的 element）拼出全名。`:160-163` 的 donor 从本节点起向上爬 depth 层（爬到根就停在根节点，
 * 无父时 donor 就是本节点 → 读本节点当前状态）；`:166-175` donor 状态缺失或 block 为空则原样返回类名。
 */
function transformBemClassName(className: string, separator: string, nodeState: BemState,
                               ancestorStates: readonly (BemState | null)[], isModifierSeparator: boolean): string {
  const cleaned = cleanStringAndDepth(className, separator)
  if (cleaned.depth > 0) {
    // 祖先链自根到父；爬 depth 层 = 下标 length - depth，爬过头（depth > length）停在根（下标 0）；
    // 链为空时 donor 是本节点自己。
    const level = Math.max(0, ancestorStates.length - cleaned.depth)
    const donorState = level < ancestorStates.length ? ancestorStates[level] : nodeState
    if (donorState !== null) {
      let prefix = donorState.block
      if (prefix !== '') {
        if (isModifierSeparator && donorState.element !== '') prefix = `${prefix}${separator}${donorState.element}`
        return `${prefix}${separator}${cleaned.name}`
      }
    }
  }
  return className
}

/**
 * 上游 `:72-110` processClassName：先按元素分隔符补全（`:74`），再按修饰符分隔符补全（`:75`），拆状态（`:78`）；
 * 状态为空 → 类名原样（`:106-108`，节点状态也不动）；否则拼 `block__element` 与 `block__element_modifier`
 * （`:88-97`），并把节点状态推进成新值（`:99-104`：block 为空时用节点原 block 补上；节点原 block 非空且无修饰符时
 * 回写到新状态）。
 */
function processBemClassName(className: string, nodeState: BemState, ancestorStates: readonly (BemState | null)[],
                             separators: BemSeparators): { classes: string[]; nextState: BemState } {
  const withElements = transformBemClassName(className, separators.element, nodeState, ancestorStates, false)
  const filled = transformBemClassName(withElements, separators.modifier, nodeState, ancestorStates, true)
  const bemState = extractBemState(filled, separators.element, separators.modifier)
  if (bemState.block === '' && bemState.element === '' && bemState.modifier === '') {
    return { classes: [className], nextState: nodeState }
  }
  const nodeBlockValue = nodeState.block
  if (bemState.block === '') bemState.block = nodeBlockValue
  let prefix = bemState.block
  if (bemState.element !== '') prefix += separators.element + bemState.element
  const classes = [prefix]
  if (bemState.modifier !== '') classes.push(prefix + separators.modifier + bemState.modifier)
  const nextState: BemState = { ...bemState }
  if (nodeBlockValue !== '' && bemState.modifier === '') nextState.block = nodeBlockValue
  return { classes, nextState }
}

/**
 * 上游 `:49-70` filterNode 的单节点直译：把 class 属性值按 BEM 口径重写，并返回该节点推进后的状态
 * （上游写进 BEM_STATE 用户数据，`:62` 设初值 = suggestBlockName，`:104` 每次类名处理完更新）。
 * class 集合是 LinkedHashSet（`:63`）：首见顺序去重（`:64-66`），`:67` 空格连接。
 */
function processBemNodeClassValue(classValue: string, ancestorStates: readonly (BemState | null)[],
                                  separators: BemSeparators): { classValue: string; state: BemState } {
  const classNames = splitClassNames(classValue)
    .map(name => normalizeBemClassName(name, separators.element, separators.shortPrefix))
  let state: BemState = { block: suggestBemBlockName(classNames), element: '', modifier: '' }
  const collected: string[] = []
  for (const className of classNames) {
    const processed = processBemClassName(className, state, ancestorStates, separators)
    for (const name of processed.classes) if (!collected.includes(name)) collected.push(name)
    state = processed.nextState
  }
  return { classValue: collected.join(' '), state }
}

/**
 * BEM 的 class 属性重写（上游 `BemEmmetFilter.java:50-70` filterNode 直译；SUFFIX `:30`、isMyContext `:44-47` = XML 语言）。
 * 上游只读写 token 属性与每节点用户数据（BEM_STATE），`token.getXmlTag()` 都没碰，故本仓无需 hasXmlTag 标记。
 * ancestorClassValues = 祖先链自根到父、每层的 class 属性原值（没写 class 用 null），对应上游 `node.getParent()`
 * 链（GenerationNode.java:575）上各节点的 BEM_STATE —— 每层状态由该层自己的 class 值 + 它自己的祖先决定，
 * 所以链上给 class 值就够（本函数内部逐层重算）。
 * 返回重写后的 class 属性值（上游 `:67` `attributes.put(classAttributeName, ...)`）；`:55` class 值为空串时
 * classNames 为空、结果也是空串（上游照写 class=""，不是删属性）。
 */
export function bemFilterClassValue(classValue: string, ancestorClassValues: readonly (string | null)[] = [],
                                    separators: BemSeparators = EMMET_BEM_SEPARATORS): string {
  const ancestorStates: Array<BemState | null> = []
  for (const ancestorValue of ancestorClassValues) {
    ancestorStates.push(ancestorValue === null
      ? null
      : processBemNodeClassValue(ancestorValue, ancestorStates, separators).state)
  }
  return processBemNodeClassValue(classValue, ancestorStates, separators).classValue
}

/** BemEmmetFilter 的上下文（suffix `bem`，上游 `:39-42`）。 */
export interface BemFilterContext {
  /** 上游 `:51-53` `token.getAttributes()`（TemplateToken.java:46-48）：没有 class 键整段跳过（`:55`）。 */
  readonly attributes: Readonly<Record<string, string | undefined>>
  /** 祖先链自根到父的 class 属性原值，见 bemFilterClassValue。 */
  readonly ancestorClassValues?: readonly (string | null)[]
  /** 上游 `:56-58` 从 EmmetOptions 读的三个分隔符（默认 EmmetOptions.java:30-32）。 */
  readonly separators?: BemSeparators
}

/**
 * BemEmmetFilter.filterNode（上游 `:50-70`）的文本端口。
 * 上游改的是 token 的 class 属性（`:67`），标签随后由生成器渲染；本仓输入已是渲染后的片段，故改写根起始标签里
 * 的 class 属性值（生成器口径 `name="value"`，XmlZenCodingGeneratorImpl.java:57-68 + :99-101）。
 * 边界：attributes 里没有 class → 原样（上游 `:55`）；片段没有起始标签、或根标签没写出 class 属性 → 原样
 * （上游渲染时必写出该属性；文本端口只改已存在的属性）。
 */
export function bemEmmetFilterText(text: string, ctx: BemFilterContext): string {
  if (!Object.hasOwn(ctx.attributes, CLASS_ATTRIBUTE)) return text
  const classValue = bemFilterClassValue(ctx.attributes[CLASS_ATTRIBUTE] ?? '',
    ctx.ancestorClassValues ?? [], ctx.separators ?? EMMET_BEM_SEPARATORS)
  const startTag = ROOT_START_TAG.exec(text)
  if (startTag === null) return text
  // 双引号是生成器口径；单引号形也认（文本端口健壮性，上游不会产出）
  const replaced = startTag[0].replace(/(\sclass\s*=\s*)("[^"]*"|'[^']*')/, `$1"${classValue}"`)
  if (replaced === startTag[0]) return text
  return replaced + text.slice(startTag[0].length)
}
