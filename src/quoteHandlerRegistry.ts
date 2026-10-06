// `QuoteHandler` 的**逐语言开关表**与两条「要不要补配对」的判据
// （`lp/editor-actions` 重点②：判决缺项 ① 里「逐语言 `QuoteHandler`」那一半）。
//
// 一、哪些语言**有**引号 handler，是一件按语言注册的事实，不是一条通用规则：
//   · 扩展点两条：`platform/lang-impl/resources/intellij.platform.lang.impl.xml:405`
//     （`com.intellij.quoteHandler`，bean = `QuoteHandlerEP.java:16-27`，按 **fileType** 取）与
//     同文件 `:408`（`com.intellij.lang.quoteHandler`，按 **language** 取，
//     包装类 `platform/lang-impl/src/com/intellij/lang/LanguageQuoteHandling.java:11-16`）。
//   · 取 handler 的**三级顺序**：`platform/lang-impl/src/com/intellij/codeInsight/editorActions/TypedQuoteImpl.java:31-44`
//     —— 先按**注入片段**的 fileType（`:32-33`），没有再按**文件本身**的 fileType（`:35-38`），
//     还没有才按 base language（`:40-41`）。三级都没有 ⇒ 返回 null，
//     `:69-72` 的 `handleQuote` 直接返回 false ⇒ **这门语言不补配对、也不跳过收尾引号**。
//     这一条就是「逐语言开关」的全部含义，也是本表存在的理由。
//   · 哪些字符会触发这条链**不是**按语言定的，是写死的三个字符：`TypedQuoteImpl.java:52`
//     （`'"' == charTyped || '\'' == charTyped || '`' == charTyped`）⇒ 本表的 `quoteChars` 列
//     记的是**这个固定触发集**，各语言的区别只在 handler 内部（它的 token 集认不认这段文本）。
//   · 全树（这份 community 参考树）注册了这一族的一共 **20 条**（覆盖 19 个不同的 `fileType`/`language` 键，
//     XML 那个键两条各挂一个 EP），逐条在下面 `QUOTE_HANDLER_REGISTRATIONS`
//     里给了「注册文件:行号 + 实现类 + 是否 `JavaLikeQuoteHandler` + 是否 `MultiCharQuoteHandler`」。
//     核对方式：按 EP 名在 `--include=*.xml` 里全树搜 `quoteHandler`（除两条 EP 声明与
//     `:458` 那条 `inline.completion.quoteHandlerEx` —— 那是另一个扩展点，不是这一族）。
//     `javaLike` 决定「回车能不能把字面量切开」（`enter/EnterInStringLiteralHandler.java:39-42` 的
//     `instanceof JavaLikeQuoteHandler` 门槛与 `:109-114`）与下面第 (b) 条门槛放不放过这门语言；
//     `multiChar` 决定多字符 face 那一档（`QuoteHandler.java:18-19`，Java 文本块的三条动作在
//     `src/editorQuoteFaces.ts`）。
//
// 二、两条「**已经注册了语言，但这一次不该补配对**」的门槛，是本仓此前漏掉的（本文件实现它们）：
//   (a) 通用，所有注册了 handler 的语言：补配对**之前**先看光标后面那个字符 ——
//       `TypedQuoteImpl.java:104-105`（多字符那一支）与 `:117-118`（普通那一支）都要求
//       「敲完引号之后的那个位置已是文档末尾，或那个字符不是 `Character.isUnicodeIdentifierPart`」。
//       也就是说在 `abc|def` 中间敲引号，IDEA **不补**收尾引号。
//   (b) 只对 `javaLike` 的语言（这份树里就 `JavaQuoteHandler.java:31` 一个）：
//       `TypedQuoteImpl.java:89-97` 在敲之前先问 `isAppropriateElementTypeForLiteral(tokenType)`，
//       那张表在 `java/java-frontback-impl/src/com/intellij/codeInsight/editorActions/JavaQuoteHandler.java:33-36`
//       = javadoc token ∪ 「注释或空白」∪ `TEXT_LITERALS` ∪ `;` `,` `)` `]` `}`。
//       光标后面紧跟的是标识符/运算符/左括号 ⇒ **整条 `handleQuote` 返回 false**（连引号都不额外补）。
//
// 本仓没有 token 流（那两条上游都读高亮迭代器），所以按文本近似，近似的边界写在下面两条函数的注释里；
// 近似不出来的场合一律退回「不接管」（返回 false / 允许），不猜。
// 已知差别（照实记）：(a) 里 `isUnicodeIdentifierPart` 用 `\\p{L}\\p{N}\\p{Mn}\\p{Pc}` 近似
// （JDK 的定义 = 字母 / 数字 / 连接标点 Pc / 组合标记 Mn / 可忽略控制字符，`Character.java` 的
// `isUnicodeIdentifierPart` 那段），差别只会在冷门码位上；(b) 的「注释 token」用「后面是 `//` 或 `/*`」近似，
// 块注释中间的位置（前面才是 `/*`）会被算成不允许 ⇒ 与本仓既有词法一致，不新造规则。

/** 一条注册（XML 里的一行）。 */
export interface QuoteHandlerRegistration {
  /** XML 里 `fileType` / `language` 属性的**原值**（逐字照抄，大小写与空格都算）。 */
  readonly key: string
  /** 注册所在文件与行号。 */
  readonly registration: string
  /** 实现类全名（XML 里 `className` / `implementationClass` 的值）。 */
  readonly className: string
  /** 走的是 `com.intellij.quoteHandler`（按 fileType）还是 `com.intellij.lang.quoteHandler`（按语言）。 */
  readonly via: 'fileType' | 'language'
  readonly javaLike: boolean
  readonly multiChar: boolean
  /** 本仓的语言档里哪一个对得上（`src/fileTypeDetection.ts:244` 只放行 java/cpp/typescript）；对不上为 null。 */
  readonly repoLanguage: string | null
}

/** 触发这条链的三个字符（`TypedQuoteImpl.java:52`，**不按语言变**）。 */
export const QUOTE_TRIGGER_CHARS = ['"', "'", '`'] as const

export const QUOTE_HANDLER_REGISTRATIONS: readonly QuoteHandlerRegistration[] = [
  {
    key: 'JAVA', via: 'fileType', javaLike: true, multiChar: true, repoLanguage: 'java',
    registration: 'java/java-frontback-impl/resource/intellij.java.frontback.impl.xml:74',
    className: 'com.intellij.codeInsight.editorActions.JavaQuoteHandler',
  },
  {
    key: 'JSON', via: 'fileType', javaLike: false, multiChar: true, repoLanguage: null,
    registration: 'json/resources/intellij.json.xml:92',
    className: 'com.intellij.json.JsonQuoteHandler',
  },
  {
    key: 'JSON5', via: 'fileType', javaLike: false, multiChar: true, repoLanguage: null,
    registration: 'json/resources/intellij.json.xml:93',
    className: 'com.intellij.json.JsonQuoteHandler',
  },
  {
    key: 'JSON-lines', via: 'fileType', javaLike: false, multiChar: true, repoLanguage: null,
    registration: 'json/resources/intellij.json.xml:94',
    className: 'com.intellij.json.JsonQuoteHandler',
  },
  {
    key: 'Groovy', via: 'fileType', javaLike: false, multiChar: true, repoLanguage: null,
    registration: 'plugins/groovy/resources/META-INF/plugin.xml:748',
    className: 'org.jetbrains.plugins.groovy.editor.GroovyQuoteHandler',
  },
  {
    key: 'Kotlin', via: 'fileType', javaLike: false, multiChar: false, repoLanguage: null,
    registration: 'plugins/kotlin/base/code-insight/minimal/resource/intellij.kotlin.base.codeInsight.minimal.xml:89',
    className: 'org.jetbrains.kotlin.idea.editor.KotlinQuoteHandler',
  },
  {
    key: 'Markdown', via: 'fileType', javaLike: false, multiChar: false, repoLanguage: null,
    registration: 'plugins/markdown/core/resources/META-INF/plugin.xml:220',
    className: 'org.intellij.plugins.markdown.braces.MarkdownQuoteHandler',
  },
  {
    key: 'Mermaid', via: 'fileType', javaLike: false, multiChar: false, repoLanguage: null,
    registration: 'plugins/mermaid/resources/META-INF/plugin.xml:84',
    className: 'com.intellij.mermaid.editor.MermaidQuoteHandler',
  },
  {
    key: 'XPath', via: 'fileType', javaLike: false, multiChar: false, repoLanguage: null,
    registration: 'plugins/xpath/xpath-lang/resources/META-INF/plugin.xml:122',
    className: 'org.intellij.lang.xpath.XPathQuoteHandler',
  },
  {
    key: 'XPath2', via: 'fileType', javaLike: false, multiChar: false, repoLanguage: null,
    registration: 'plugins/xpath/xpath-lang/resources/META-INF/plugin.xml:123',
    className: 'org.intellij.lang.xpath.XPathQuoteHandler',
  },
  {
    key: 'YAML', via: 'fileType', javaLike: false, multiChar: false, repoLanguage: null,
    registration: 'plugins/yaml/resources/intellij.yaml.xml:56',
    className: 'org.jetbrains.yaml.smart.YamlQuoteHandler',
  },
  {
    key: 'Python', via: 'fileType', javaLike: false, multiChar: false, repoLanguage: null,
    registration: 'python/python-syntax/resources/intellij.python.syntax.xml:32',
    className: 'com.jetbrains.python.editor.PythonQuoteHandler',
  },
  {
    key: 'XML', via: 'fileType', javaLike: false, multiChar: false, repoLanguage: null,
    registration: 'xml/xml-ui-common/resources/intellij.xml.ui.common.xml:69',
    className: 'com.intellij.codeInsight.editorActions.XmlQuoteHandler',
  },
  {
    key: 'HTML', via: 'fileType', javaLike: false, multiChar: false, repoLanguage: null,
    registration: 'xml/xml-ui-common/resources/intellij.xml.ui.common.xml:71',
    className: 'com.intellij.codeInsight.editorActions.HtmlQuoteHandler',
  },
  {
    key: 'XHTML', via: 'fileType', javaLike: false, multiChar: false, repoLanguage: null,
    registration: 'xml/xml-ui-common/resources/intellij.xml.ui.common.xml:72',
    className: 'com.intellij.codeInsight.editorActions.HtmlQuoteHandler',
  },
  {
    // 按 language 注册的那两条（EP `:408`）：纯文本与 Shell/TOML/JSONPath。
    key: 'TEXT', via: 'language', javaLike: false, multiChar: false, repoLanguage: 'other',
    registration: 'platform/lang-impl/resources/intellij.platform.lang.impl.xml:1020',
    className: 'com.intellij.ide.highlighter.custom.impl.CustomFileTypeQuoteHandler',
  },
  {
    key: 'XML', via: 'language', javaLike: false, multiChar: false, repoLanguage: null,
    registration: 'xml/xml-ui-common/resources/intellij.xml.ui.common.xml:70',
    className: 'com.intellij.codeInsight.editorActions.XmlQuoteHandler',
  },
  {
    key: 'Shell Script', via: 'language', javaLike: false, multiChar: false, repoLanguage: null,
    registration: 'plugins/sh/core/resources/intellij.sh.core.xml:47',
    className: 'com.intellij.sh.ShQuoteHandler',
  },
  {
    key: 'TOML', via: 'language', javaLike: false, multiChar: false, repoLanguage: null,
    registration: 'plugins/toml/core/src/main/resources/intellij.toml.core.xml:29',
    className: 'org.toml.ide.TomlQuoteHandler',
  },
  {
    key: 'JSONPath', via: 'language', javaLike: false, multiChar: false, repoLanguage: null,
    registration: 'plugins/jsonpath/resources/META-INF/plugin.xml:41',
    className: 'com.intellij.jsonpath.JsonPathQuoteHandler',
  },
]

/** `Character.isUnicodeIdentifierPart` 的文本层近似（见文件头 (a) 那条）。 */
const IDENTIFIER_PART = /[\p{L}\p{N}\p{Mn}\p{Pc}]/u

/** 上游 `;` `,` `)` `]` `}` 那四个右向括号与两个分隔符（`JavaQuoteHandler.java:35-36`）。 */
const APPROPRIATE_NEXT_CHARS = ';,)]}'

/** 敲完引号之后那个字符会不会挡住补配对（`TypedQuoteImpl.java:104-105` 与 `:117-118`）。 */
export function nextCharBlocksPair(text: string, afterTyped: number): boolean {
  if (afterTyped >= text.length) return false                 // 文档末尾 ⇒ 不挡
  return IDENTIFIER_PART.test(text[afterTyped]!)
}

/**
 * (b) 那条 `javaLike` 独有的门槛（`TypedQuoteImpl.java:89-97` + `JavaQuoteHandler.java:33-36`）的
 * 文本近似：上游问的是「敲之前光标处那个 **token** 属不属于那张表」，迭代器就停在 `offset` 上，
 * **不跳过空白** —— 光标压在空白上算「空白 token」，在那张表里 ⇒ 放过。
 * 于是本仓按 `line[caret]` 那一格直接判：行尾 / 空白 / `;` `,` `)` `]` `}` / 一个引号 / 注释开头 ⇒ 放过，
 * 其余（标识符、数字、`(` `.` `+` 这些运算符）⇒ 整条引号自动配对不接管。
 * 非 javaLike 的语言恒返回 true（那张表只挂在 `instanceof JavaLikeQuoteHandler` 那一支）。
 */
export function appropriateElementForLiteral(line: string, caret: number, javaLike: boolean): boolean {
  if (!javaLike) return true
  if (caret >= line.length) return true                        // 行尾 = 后面没有 token 了
  const char = line[caret]!
  if (char === ' ' || char === '\t') return true               // 空白 token 在那张表里
  if (APPROPRIATE_NEXT_CHARS.includes(char)) return true
  if (char === '"' || char === '\'' || char === '`') return true // 已经在某个字面量旁边（TEXT_LITERALS）
  if (char === '/' && (line[caret + 1] === '/' || line[caret + 1] === '*')) return true  // 注释 token
  return false
}

/** 两条门槛合起来：这一次敲引号要不要**不**补配对。`javaLike` 由语言注册表决定。 */
export function pairInsertionSuppressed(line: string, caret: number, javaLike: boolean): boolean {
  // `caret` 是**敲之前**的行内光标（也就是引号将要落下的位置）。
  // (b) 问的是敲之前光标处那个 token（`TypedQuoteImpl.java:86-97` 在 typeChar **之前**建迭代器）；
  // (a) 问的是敲**完之后**光标后面那个字符 —— 引号占了 `caret` 那一格，所以就是敲之前的 `line[caret]`
  //     （对应上游 `:114-118` 里 `offset = 原 caret + 1` 之后的 `chars.charAt(offset)`）。
  if (!appropriateElementForLiteral(line, caret, javaLike)) return true
  return nextCharBlocksPair(line, caret)
}

/** 本仓的语言档对上表里的哪一条注册（对不上返回 null ⇒ 这门语言在本仓没有引号 handler 的档案）。 */
export function quoteRegistrationForLanguage(language: string | undefined): QuoteHandlerRegistration | null {
  if (language === undefined) return null
  return QUOTE_HANDLER_REGISTRATIONS.find(item => item.repoLanguage === language) ?? null
}

/** 这门语言是不是 `javaLike`（决定门槛 (b) 放不放过它）。 */
export function isJavaLikeQuoteLanguage(language: string | undefined): boolean {
  return quoteRegistrationForLanguage(language)?.javaLike ?? false
}
