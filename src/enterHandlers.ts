// 回车家族（`lp/editor-actions` 判决缺项 ②：`enter/*` 里本仓原本没有的四条语义）。
//
// 上游这一族的注册表与次序：`platform/lang-impl/resources/intellij.platform.lang.impl.xml`
//   `:1159` `EnterInStringLiteralHandler` → `:1160` `EnterInLineCommentHandler` →
//   `:1161-1162` `EnterInBlockCommentHandler`（`id="blockComment"`，带 `order="last"`）、
//   `:1163-1164` `EnterAfterUnmatchedBraceHandler` →
//   `:1165-1166` `EnterBetweenBracesFinalHandler`（bean id 就叫 `EnterBetweenBracesHandler`）→
//   `:1167-1170` 它自带的 `InjectedIndentPostProcessor`（也 `order="last"`）→
//   `:1171` `EnterAfterJavadocTagHandler`。EP 声明在 `:399`。「逐个问、第一个接管的算」问的是这张表
//   **排完序之后**的顺序（`platform/lang-impl/src/com/intellij/codeInsight/editorActions/EnterHandler.java:136-137`
//   的 preprocessEnter 循环；订正 2026-10-06：旧注释抄的是 `:181`，那一处是 postProcessEnter 的循环），
//   返回值的处置在 `EnterHandler.java:142-153`（不是 `Continue` 的每一档都 break）。
//   `order="last"` 把块注释那条推到表尾 ⇒ 本仓能还原的那几条的**有效次序**是：
//   ① 字符串字面量 → ② 行注释 → ③ 未配对的左花括号 → ④ 块注释。
//   订正（2026-10-06 复核这四条的次序时逐行对的）：这里原先写「本仓把注释那两条排在字面量之前，
//   否则 `// 说 "abc` 里的引号会被字面量那条误切」—— 那是拿**问法次序**当**词法**用。上游区分这两件事
//   靠 token 类型，不是靠次序：`enter/EnterInStringLiteralHandler.java:39-42` 先问
//   `isInStringLiteral`、`:116-125` 读的是 `offset-1` 那个 token 的类型（注释 token 直接 false），
//   `enter/EnterInLineCommentHandler.java:97` 要求光标前那个 token 是**行注释**类型。
//   本批按上面的有效次序问，并把「这个引号在注释里 / 这个 `//` 在字符串里」交给 `lexUntil` 那份
//   逐字符词法回答 —— 两边都按上游的判据问 ⇒ `String s = "http://x"` 里的那个 `//` 不再被当成注释
//   （改动前本仓会把它当注释续行，这是用户能看见的错）。次序与词法都由 `tests/editor-enter-handlers.test.mjs`
//   钉住（那条次序断言原地改写，理由与上游行号写在那条测试的注释里）。
//
// 三条开关（上游 `platform/analysis-impl/src/com/intellij/codeInsight/CodeInsightSettings.java` 的字段，
// 默认值都是 true）：`:130` `INSERT_BRACE_ON_ENTER` 把关 `enter/EnterAfterUnmatchedBraceHandler.java:84-86`
// （关掉 ⇒ `getMaxRBraceCount` 返回 0 ⇒ 这一条整条不接管）；`:132` `CLOSE_COMMENT_ON_ENTER` 把关
// `enter/EnterInBlockCommentHandler.java:62`（关掉 ⇒ 没闭合的块注释不再补闭尾；`* ` 续行那一支不受它管）；
// `:140` `AUTOINSERT_PAIR_QUOTE` 把关引号那一族（消费方在 `src/editorTyping.ts`，不在这里）。
// **订正**：`src/editorEnterBlockComment.ts` 与本文件之前的注释都写「本仓 `EditorSettings` 里没有这一条对应项」——
// 实际是**有键**（`src/settingsModel.ts:427-431`，默认值 `:223`）**有界面**（`src/components/EditorEnterKeysFields.vue:29-33`）
// **没有消费方**，也就是派单第 3 节禁的假控件。本批把消费链路写在模块侧（`EnterOptions`，不传时按上游默认值 true 走 ⇒
// 现有行为一格不变），宿主把 `props.settings` 递进来的那一行在保留文件里 ⇒ `docs/wiring-requests-2026-10-06-editorinput.md` R1。
//
// 每条的上游坐标（2026-10-06 逐行核对；此前这份头注释里 `:38-46`/`:64-75`/`:68-82` 那几处行号
// 是上一任手抄的，与上游对不上的已就地订正，订正依据都写在下面的行号里）：
//   · `platform/lang-impl/src/com/intellij/codeInsight/editorActions/enter/EnterInLineCommentHandler.java`
//     `:36` 语言没有 commenter / `:39-41` 前缀不在光标之前 ⇒ `Result.Continue`；
//     `:45-46` 光标往后跳空白，**跳到行尾或换行就 `Result.Continue`** —— 「行尾回车不续行注释」是
//     `:46` 的字面意思。`:52-53` `onlyCommentInCaretLine`；`:56-62`「光标后面又是一个行注释」那一支
//     （把光标挪到那个前缀上、缺空格就补一个，`:58-59`）；`:63-83` 普通一支：整行只有注释时沿用
//     本行注释前缀之后的空白当分隔（`:65-67`、`:73-75`），并删掉光标后被跳过的空格（`:76-77`），
//     注释前面还有代码且光标正挨着一个空格时不补分隔（`:80`）；`:82` 落前缀；`:85-87` `caretAdvance`；
//     `:88` `Result.DefaultForceIndent`（**前缀落在光标处、回车把它推到下一行**，不是只插前缀）。
//     `getLineCommentStart` 的门槛在 `:94`（`offset < 1` 直接退出）、`:97`（光标前那个 token 得是行注释
//     类型）、`:103-105`（前缀要在光标之前）。`:68-72` 的 TODO 分支（`TodoConfiguration.isMultiLine()`
//     时分隔再加一个空格）依赖 todo 图案表 —— 本仓 todo 面板归别的桶，这一支**不做**，如实登记。
//   · `enter/EnterInBlockCommentHandler.java:31-101` 的块注释那一支在 `src/editorEnterBlockComment.ts`
//     （没闭合就补 `*/`、`* ` 续行；`:70-84` 的 TODO 额外缩进同样不做）。
//   · `enter/EnterAfterUnmatchedBraceHandler.java:322-378` 数光标之前未配对的左花括号
//     （`:327-329` 要求光标前一个字符就是 `{`；`:369-372` 右括号追平时提前收工；`:51` 只在
//     `maxRBraceCount > 0` 时动手）；`:84-87` 整条由 `CodeInsightSettings.INSERT_BRACE_ON_ENTER`
//     把关（默认 true，`platform/analysis-impl/src/com/intellij/codeInsight/CodeInsightSettings.java:130`）；
//     `:99-114` 数光标前那段连续空白里有几个 `{`，决定插几个 `}`（至少一个，`:113`）；
//     `:135-144` 闭合括号插在哪（跳过空格后不是 `)];,%<?` 就要靠 PSI 找位置，`:139-140`）；
//     `:173` 插的是 `"\n" + braces`；`:230-250` 格式化器没调好缩进时的兜底：把所在行的前导空白
//     补到闭合括号那一行。
//   · `enter/EnterInStringLiteralHandler.java:44-48` 要求光标**不在**字面量的第一个字符上
//     （`psiAtOffset.getTextOffset() < caretOffset`）且那个 token `canBeConcatenated`；
//     `:66-81` 在字符串里插「字面量首字符 + " " + 连接符 + " " + 首字符」（Java 的连接符是 `+`，
//     `java/java-frontback-impl/src/com/intellij/codeInsight/editorActions/JavaQuoteHandler.java:83-86`），
//     `:73-74` 光标停在插进来的第二个引号之后；`:75-77` 是 `BINARY_OPERATION_SIGN_ON_NEXT_LINE`
//     的另一档（连接符挪到下一行、caretAdvance 变 3）—— 本仓没有那张 code-style 表，按默认档做。
//     `:39-42` + `:109-125`：**整条只在「这门语言注册了 `JavaLikeQuoteHandler`」时才问**
//     （`platform/lang-impl/src/com/intellij/codeInsight/editorActions/JavaLikeQuoteHandler.java:15-17`
//     的 `canBeConcatenated` 读 `getConcatenatableStringTokenTypes()`，Java 那份是
//     `JavaQuoteHandler.java:32` 的 `TokenSet.create(JavaTokenType.STRING_LITERAL)` —— **文本块不在里面**
//     ⇒ Java 的三引号文本块里回车不切分）。引号 handler 的注册表不止 Java 一家
//     （`intellij.java.frontback.impl.xml:74`、`plugins/kotlin/base/code-insight/minimal/resource/intellij.kotlin.base.codeInsight.minimal.xml:89`、
//     `plugins/markdown/core/resources/META-INF/plugin.xml:220`、纯文本那条在 `intellij.platform.lang.impl.xml:1020`），
//     但**上面那道 `instanceof JavaLikeQuoteHandler` 的门槛只放过 Java**：全树里实现 `JavaLikeQuoteHandler` 的
//     就 `JavaQuoteHandler.java:31` 一个（`CustomFileTypeQuoteHandler.java:18` 与 `KotlinQuoteHandler.kt:10`
//     都只实现 `QuoteHandler`）⇒ 纯文本 / Kotlin / Markdown 里回车都不切字符串。本仓按这张表收紧
//     （id 从 `src/editorMatchBrace.ts` 的 `editorLanguageId` facet 拿，它的挂载点已经写在
//     `docs/wiring-requests-2026-10-06-bucket5b.md`）；facet 没挂时**保持既有档位**，
//     免得本批把 Java 的切分顺手改没。文本块那一档不用 facet：`lexUntil` 认三引号的形状。
//
// 判不了的场合一律返回 null，让 CodeMirror 自己的 `insertNewlineAndIndent` 接手（= 上游的 `Result.Default`）。
// 它已经承担了「在一对花括号之间回车时多插一个换行」那一条（`insertNewlineAndIndent` → `isBetweenBrackets`，
// `node_modules/@codemirror/commands/dist/index.js:1514-1524`），所以 `EnterBetweenBracesHandler`
// 在本仓**已经有落点**，这里不重复做。三条已知差别照实记着：上游认的括号对只有 `()` 与 `{}`
// （`enter/EnterBetweenBracesDelegate.java:80-81`），CodeMirror 还多认 `[]`；上游要求两侧跳过空白后
// 是同一对且**不在同一个 PSI 元素里**（`enter/EnterBetweenBracesHandler.java:21-26`，该类 `:13` 已
// `@Deprecated`，实体是 `EnterBetweenBracesFinalHandler.java:33+`），CodeMirror 则要求两个括号在同一条
// 语法线上且中间没有非空白（`index.js:1519-1522`）；带空格的 `{   }` 在 CodeMirror 走语法树那条，
// 没有语法树的语言就退回普通回车 —— 不假装有。
import { insertNewlineAndIndent } from '@codemirror/commands'
import type { ChangeSpec } from '@codemirror/state'
import type { Command, EditorView } from '@codemirror/view'
// 块注释里回车（`EnterInBlockCommentHandler`）：词法与那一族判定都在
// `src/editorEnterBlockComment.ts`（本模块拆出来的下半截，行数上限的缘故）。
import { blockLexiconFor, enterInBlockComment, type BlockCommentLexicon } from './editorEnterBlockComment.ts'
// 「这门语言的字符串字面量能不能用回车切开」= 上游那张按语言注册的引号表里有没有连接符
// （门槛是 `EnterInStringLiteralHandler.java:39-42/109-114` 的 `instanceof JavaLikeQuoteHandler`，
// 表在 `src/editorTyping.ts`，同一个来源只留一张）。
import { stringConcatFor } from './editorTyping.ts'
// 「按什么次序问、谁接管了算哪一档」这张表与那个循环本身（`EnterHandler.java:136-153` 的等价物）。
import {
  ENTER_HANDLER_ORDER, enterInsertsNewline, preprocessEnter, type EnterBranch, type EnterHit,
} from './enterHandlerOrder.ts'

/** 这门语言的注释词法（上游 `Commenter.getLineCommentPrefix` 的一半，由调用方给）。 */
export interface EnterLanguage {
  /** 行注释前缀，如 `//`。没有行注释的语言留空。 */
  line?: string
  /** 块注释那一半（getBlockCommentPrefix/Suffix、文档前缀、续行星号）：见 lexicon 的注释。 */
  block?: BlockCommentLexicon
  // 上游 CodeInsightSettings.java:132 的 CLOSE_COMMENT_ON_ENTER（默认 true，本仓
  // settingsModel.ts:429 的 closeCommentOnEnter）；undefined 按上游默认走。
  blockCloseOnEnter?: boolean
  // 上游 CodeInsightSettings.java:130 的 INSERT_BRACE_ON_ENTER（默认 true，本仓
  // settingsModel.ts:431 的 insertBraceOnEnter）；把关 enterAfterUnmatchedBrace 那一条。
  insertBraceOnEnter?: boolean
  // 字符串字面量的连接符：`+` = Java（JavaQuoteHandler.java:83-86）；
  // null = 这门语言在上游没有 JavaLikeQuoteHandler ⇒ 整条不接管；
  // undefined = 宿主没给语言 id ⇒ 按改动前的档位走（连接符 `+`）。
  stringConcat?: string | null
}

const SPACES = ' \t'

/**
 * 宿主侧装配 `EnterLanguage`：把本仓的注释标记（`src/commentToggle.ts` 的 `CommentStyle`）
 * 翻成回车家族要的词法。行前缀直接搬，块前缀走 `blockLexiconFor`（上游那一族的四件套
 * `JavaCommenter.java:27-28`（`/*` 开）、`:32-33`（闭）、`:62-63`（文档前缀）、`:67-68`（续行 `*`）
 * 由它按同一对应关系给；块前缀不是 `/*` 的语言只给 block，续行那一支自己退出）。
 * 第二个实参是编辑器当前的语言 id（宿主那边 `smartQuotes(() => props.language)` 已经在传同一个值，
 * 这里只是把同一条通道接进回车家族）：给了才做「按语言决定能不能切字符串字面量」这一步。
 *
 * 这个函数住在模块里而不是写在 `CodeEditor.vue` 里：`CodeEditor.vue` 的登记上限是 1147 行
 * （`tests/module-size.test.mjs` 钉着，只许拆、不许升），装配规则放宿主就是往一个到顶的文件里再塞逻辑。
 */
export function smartEnterLanguageFor(
  style?: { line?: string; block?: [string, string] } | null, language?: string,
): EnterLanguage {
  return {
    line: style?.line,
    block: blockLexiconFor(style ?? undefined),
    // 没给语言 id ⇒ `undefined`：字面量那一条按改动前的档位走（不因为本批把 Java 的切分顺手改没）。
    stringConcat: language === undefined ? undefined : stringConcatFor(language),
  }
}

// 注释标记的两个取值口（行内语法优先、退回按文件名猜）—— 原来这两次调用写在
// `src/components/CodeEditor.vue` 里，那个文件顶在 1147 行的登记上限（`tests/module-size.test.mjs:135`）
// ⇒ 装配整体搬进本模块，宿主只留一行，两条开关也才递得进来（见 `smartEnterLanguageForView`）。
import { commentStyleFor, commentStyleFromState } from './commentToggle.ts'

/**
 * 宿主的**一行**装配：从当前视图取注释词法（行内语法优先，判不到时按文件名猜）、按语言决定
 * 字面量那一档，再把两条上游开关盖上去。
 *
 * 两条开关的出处（都已在 `EnterLanguage` 上落好字段名，本函数只是把 `EditorSettings` 的键名翻过去）：
 *   · `closeCommentOnEnter`（`src/settingsModel.ts:429`）= `CodeInsightSettings.java:132`
 *     `CLOSE_COMMENT_ON_ENTER`，把关点在 `enter/EnterInBlockCommentHandler.java:62`；
 *   · `insertBraceOnEnter`（`src/settingsModel.ts:431`）= `CodeInsightSettings.java:130`
 *     `INSERT_BRACE_ON_ENTER`，把关点在 `enter/EnterAfterUnmatchedBraceHandler.java:84-86`。
 * 缺省（宿主没给设置）按上游默认 true 走 ⇒ 不接这条也不会把既有行为改坏。
 */
export function smartEnterLanguageForView(
  view: EditorView | null | undefined, path: string, language?: string,
  settings?: { closeCommentOnEnter?: boolean; insertBraceOnEnter?: boolean },
): EnterLanguage {
  const style = view ? commentStyleFromState(view.state, view.state.selection.main.head) : null
  return {
    ...smartEnterLanguageFor(style ?? commentStyleFor(undefined, path), language),
    blockCloseOnEnter: settings?.closeCommentOnEnter ?? true,
    insertBraceOnEnter: settings?.insertBraceOnEnter ?? true,
  }
}

function shiftForward(text: string, from: number, chars: string): number {
  let at = from
  while (at < text.length && chars.includes(text[at]!)) ++at
  return at
}

function shiftBackward(text: string, from: number, chars: string): number {
  let at = from
  while (at >= 0 && chars.includes(text[at]!)) --at
  return at
}

// 词法状态码（`LineLex.kinds` 的取值）。上游这一族问的都是 token 类型
// （`enter/EnterInStringLiteralHandler.java:116-125` 读 `offset-1` 那个 token、
// `enter/EnterInLineCommentHandler.java:97` 要行注释类型、`enter/EnterInBlockCommentHandler.java:103-120`
// 要块注释区间），本仓没有高亮迭代器 ⇒ 自己逐字符扫。
// 0 代码 / 1 字符串 / 2 行注释 / 3 块注释 / 4 三引号文本块（Java 的 `JavaQuoteHandler.java:32` 把
// TEXT_BLOCK 排除在「能连的字符串」之外，所以它是单独一档）。
export const LEX_CODE = 0
export const LEX_STRING = 1
export const LEX_LINE_COMMENT = 2
export const LEX_BLOCK_COMMENT = 3
export const LEX_TEXT_BLOCK = 4

/** 一行里每个字符的词法状态（行内下标）。 */
export interface LineLex {
  // 长度 = 行宽 + 1；多出来的那一格是「光标落在行尾」的哨兵，恒为 LEX_CODE。
  kinds: number[]
  // 该字符所在 token 的行内起始下标；代码位置为 -1。
  starts: number[]
}

/**
 * 从 `text` 的**开头**把状态推到 `upto`（不含），但只把 `[base, upto)` 那一段记进结果数组。
 * 状态必须从头推：块注释与三引号文本块都能跨行（`enter/EnterInBlockCommentHandler.java:103-120` 也是
 * 拿整个注释 token 的区间在判）。记账只记本行那一段 ⇒ 数组是一行的长度，不是全文的长度。
 */
export function lexUntil(text: string, upto: number, language: EnterLanguage, base = 0): LineLex {
  const length = Math.max(0, Math.min(upto, text.length) - base)
  const kinds: number[] = new Array(length + 1).fill(LEX_CODE)
  const starts: number[] = new Array(length + 1).fill(-1)
  const linePrefix = language.line
  const open = language.block?.block?.[0]
  const close = language.block?.block?.[1]
  let kind = LEX_CODE
  let quote = ''
  let tokenStart = 0
  let escaping = false
  // 分隔符（`//`、`/*`、三引号、块注释闭尾）还剩几个字符要按当前 token 记账；`exiting` = 这段分隔符
  // 数完了就回到代码（闭尾是 true，开头部是 false）。
  let pending = 0
  let exiting = false
  const put = (index: number, code: number) => {
    const at = index - base
    if (at < 0 || at > length) return
    kinds[at] = code
    if (code !== LEX_CODE && starts[at] < 0) starts[at] = Math.max(0, tokenStart - base)
  }
  for (let i = 0; i < upto && i < text.length; ++i) {
    const char = text[i]!
    if (pending > 0) {
      put(i, kind)
      if (--pending === 0 && exiting) { kind = LEX_CODE; exiting = false }
      continue
    }
    switch (kind) {
      case LEX_LINE_COMMENT:
        put(i, LEX_LINE_COMMENT)
        if (char === '\n') kind = LEX_CODE
        continue
      case LEX_BLOCK_COMMENT:
        put(i, LEX_BLOCK_COMMENT)
        if (close && text.startsWith(close, i)) {
          pending = close.length - 1; exiting = true
          if (pending === 0) { kind = LEX_CODE; exiting = false }
        }
        continue
      case LEX_TEXT_BLOCK:
        put(i, LEX_TEXT_BLOCK)
        if (escaping) { escaping = false; continue }
        if (char === '\\') { escaping = true; continue }
        // 收尾的三个引号：上游 TEXT_BLOCK 不在 `JavaQuoteHandler.java:32` 那张「能连的字符串」表里，
        // 所以这一段整体算一个 token、不当字面量切。
        if (char === '"' && text[i + 1] === '"' && text[i + 2] === '"') {
          pending = 2; exiting = true
          if (pending === 0) { kind = LEX_CODE; exiting = false }
        }
        continue
      case LEX_STRING:
        put(i, LEX_STRING)
        if (escaping) { escaping = false; continue }
        if (char === '\\') { escaping = true; continue }
        if (char === quote) kind = LEX_CODE
        continue
      default:
        break
    }
    // 代码位置：先认注释前缀（上游 `Commenter` 的两个 getter），再认三引号，最后认单字符引号。
    if (linePrefix && linePrefix.length > 0 && text.startsWith(linePrefix, i)) {
      kind = LEX_LINE_COMMENT; tokenStart = i; pending = linePrefix.length - 1; exiting = false
      put(i, LEX_LINE_COMMENT); continue
    }
    if (open && open.length > 0 && text.startsWith(open, i)) {
      kind = LEX_BLOCK_COMMENT; tokenStart = i; pending = open.length - 1; exiting = false
      put(i, LEX_BLOCK_COMMENT); continue
    }
    if (char === '"' && text[i + 1] === '"' && text[i + 2] === '"') {
      kind = LEX_TEXT_BLOCK; tokenStart = i; pending = 2; exiting = false
      put(i, LEX_TEXT_BLOCK); continue
    }
    if (char === '"' || char === '\'' || char === '`') {
      kind = LEX_STRING; quote = char; tokenStart = i; put(i, LEX_STRING); continue
    }
    put(i, LEX_CODE)
  }
  return { kinds, starts }
}

/**
 * 在行注释中间回车（`EnterInLineCommentHandler` 的文本子集）。
 * 返回**先**落地的编辑与之后光标要前进的字符数；不适用返回 null。
 * `lex` 缺省时按本行自己扫一遍（跨行的块注释状态就不知道了）—— 命令里传的是全文推出来的那份。
 */
export function enterInLineComment(
  lineText: string, caret: number, language: EnterLanguage, lex?: LineLex,
): { edits: ChangeSpec[]; caretAdvance: number } | null {
  const prefix = language.line
  if (!prefix) return null
  const states = lex ?? lexUntil(lineText, lineText.length, language)
  // 前缀得是**一个行注释 token 的开头**：上游 `:97` 要的是「光标前那个 token 是行注释类型」，
  // `String s = "http://x"` 里的那两个字符属于字符串 token ⇒ 不算注释（改动前本仓把它当注释续行），
  // 而注释正文里再出现 `//` 也只是同一个 token（`:56-62` 那一支找的是**下一个**前缀，见下面的 textStart）。
  let start = -1
  for (let i = 0; i + prefix.length <= lineText.length; ++i) {
    if (states.kinds[i] !== LEX_LINE_COMMENT || states.starts[i] !== i) continue
    if (!lineText.startsWith(prefix, i)) continue
    start = i
    break
  }
  // `getLineCommentStart` 的两个门槛（`:103-106`）：前缀要在光标之前；offset 至少为 1。
  if (caret < 1 || start < 0 || start + prefix.length > caret) return null
  // `:45-46`：光标后跳空格；落到底（也就是行尾）就交回默认回车。
  const textStart = shiftForward(lineText, caret, SPACES)
  if (textStart >= lineText.length) return null
  const prefixTrimmed = prefix.trim()
  const onlyCommentInCaretLine = shiftBackward(lineText, start - 1, SPACES) < 0
  // `:55` 的分隔默认一档，`:64-81` 的 else 支里才按本行空白或「挨着空格」改写。
  let spacing = ' '
  // `:56-62`：光标后面紧跟着又一个行注释前缀 —— 另起一行，光标落在那个前缀上。
  if (lineText.startsWith(prefix, textStart)) {
    const edits: ChangeSpec[] = []
    const afterPrefix = textStart + prefixTrimmed.length
    if (afterPrefix < lineText.length && lineText[afterPrefix] !== ' ') {
      edits.push({ from: afterPrefix, insert: spacing })
    }
    // `:61` 把光标推到那个前缀上：本仓交给 `insertNewlineAndIndent` 吞掉光标后的空白，
    // 切点与文档结果一致，所以不再单独搬光标。`:85-87` 在 if/else **之外**，
    // 整行只有注释时这一支同样要按 `prefixTrimmed.length + spacing.length` 前进光标。
    return { edits, caretAdvance: onlyCommentInCaretLine ? prefixTrimmed.length + spacing.length : 0 }
  }
  // `:64-78`：整行只有注释时，分隔沿用本行注释前缀之后的空白，并删掉光标后被跳过的空格。
  const edits: ChangeSpec[] = []
  if (onlyCommentInCaretLine) {
    const gapStart = start + prefixTrimmed.length
    const gap = lineText.slice(gapStart, shiftForward(lineText, gapStart, SPACES))
    if (gap) spacing = gap
    if (textStart > caret) edits.push({ from: caret, to: textStart })
  } else if (lineText[caret] === ' ') {
    // `:79-81`：注释前面还有代码、且光标正挨着一个空格时不再补分隔。
    spacing = ''
  }
  edits.push({ from: caret, insert: prefixTrimmed + spacing })
  return { edits, caretAdvance: onlyCommentInCaretLine ? prefixTrimmed.length + spacing.length : 0 }
}

/**
 * 逐字符扫全文，**只**把代码里的花括号算成结构括号（字符串与注释里的不算），
 * 按 `EnterAfterUnmatchedBraceHandler.java:344-375` 的两个计数器回报。
 */
export function structuralBraceCounts(text: string, caret: number): { left: number; right: number } | null {
  if (caret <= 0 || text[caret - 1] !== '{') return null
  let left = 0
  let right = 0
  let inBlock = false
  let inString = ''
  for (let i = 0; i < text.length; ++i) {
    const char = text[i]!
    const next = text[i + 1]
    if (inString) {
      if (char === '\\') { i++; continue }
      if (char === inString) inString = ''
      continue
    }
    if (inBlock) { if (char === '*' && next === '/') { inBlock = false; i++ } continue }
    if (char === '"' || char === '\'' || char === '`') { inString = char; continue }
    if (char === '/' && next === '/') break
    if (char === '/' && next === '*') { inBlock = true; i++; continue }
    if (char === '{') { if (i < caret) ++left; else --right }
    else if (char === '}') {
      if (i < caret) { if (left > 0) --left }
      else { ++right; if (right === left) return { left: 0, right: 0 } }
    }
  }
  return { left, right }
}

/**
 * 光标紧跟一个未配对左花括号时回车，闭合括号带几个、插在哪
 * （`EnterAfterUnmatchedBraceHandler` 的 `:99-144`）。
 * 返回 `indent` 是要补给闭合括号那一行的前导空白（`:232-250` 的兜底）。
 * 不适用返回 null。
 */
export function enterAfterUnmatchedBrace(
  text: string, caret: number, indent: string,
): { at: number; text: string } | null {
  const counts = structuralBraceCounts(text, caret)
  if (!counts) return null
  const count = counts.left - counts.right
  if (count <= 0) return null
  // `:104-112` `generateStringToInsert`：数光标前那段连续空白里有几个 `{`。
  let braces = 0
  for (let i = caret - 1; i >= 0 && braces < count; --i) {
    const char = text[i]!
    if (char === '{') ++braces
    else if (!' \n\t'.includes(char)) break
  }
  // `:137-143` `getRBraceOffset`：跳过空格后若后面不是 `)];,%<?` 就得靠 PSI 找行尾（`:140`）。
  // 没有 PSI —— 只在「后面就是行尾」这一种能判准的情况下动手，其余交回默认回车。
  const at = shiftForward(text, caret, SPACES)
  if (at < text.length) return null
  return { at: caret, text: `${indent}${'}'.repeat(Math.max(braces, 1))}` }
}

/**
 * 在双引号字符串里回车：插「开引号 + 空格 + 连接符 + 空格 + 开引号」，让原来那个收尾引号变成下一段的
 * 开引号（`EnterInStringLiteralHandler.splitString`，`:61-81`）。不适用返回 null。
 *
 * 「这个引号到底在不在字面量里」由 `lex` 回答（上游用 token 类型：`:116-125` 读 `offset-1` 那个 token，
 * 注释里的引号、三引号文本块里的光标都不算 —— `JavaQuoteHandler.java:32` 的
 * `myConcatenableStrings` 只有 `STRING_LITERAL`）。改动前这一条是拿 `indexOf('"')` 猜的，
 * 所以两个已知的错判都在本批修掉：`// 说 "abc`（注释里的引号）与 `foo("a", "b|")`（第二个字面量看不见）。
 */
export function enterInStringLiteral(
  lineText: string, caret: number, language: EnterLanguage = {}, lex?: LineLex,
): { at: number; insert: string } | null {
  // 整条先过上游那道 `instanceof JavaLikeQuoteHandler` 的门槛（`:39-42`）：宿主给了语言 id、
  // 而那张引号表里没有这门语言的连接符 ⇒ 返回 null（`null` 与 `undefined` 的区别见 EnterLanguage 的注释）。
  if (language.stringConcat === null) return null
  const states = lex ?? lexUntil(lineText, lineText.length, language)
  // 行尾那一格是哨兵 ⇒ 光标在行尾就是「不在任何 token 里」。
  if (states.kinds[caret] !== LEX_STRING) return null
  const open = states.starts[caret]
  // `:46`：光标得在开引号**之后**（`psiAtOffset.getTextOffset() < caretOffset`）。
  if (open < 0 || lineText[open] !== '"' || caret <= open + 1) return null
  // 光标落在转义序列里（`:69` 的 skipStringLiteralEscapes 把切点推到 token 末尾）时不做：词法层没有
  // token 边界，按经验猜一个转义长度就是瞎编，如实交回默认回车。
  let escaped = false
  for (let i = open + 1; i < caret; ++i) {
    if (lineText[i] === '\\' && !escaped) escaped = true
    else escaped = false
  }
  if (escaped) return null
  // Java 的连接符是 `+`（`java/java-frontback-impl/src/com/intellij/codeInsight/editorActions/JavaQuoteHandler.java:83-86`）。
  const concat = language.stringConcat ?? '+'
  return { at: caret, insert: `" ${concat} "` }
}

/** 一条分支被问到时能看到的上下文（都已经在命令里算好，分支自己不再碰 view）。 */
interface EnterContext {
  readonly lineText: string
  /** 光标在**行内**的偏移。 */
  readonly caret: number
  /** 全文文本。 */
  readonly docText: string
  /** 光标的文档偏移（分支里的绝对坐标都从它换算）。 */
  readonly head: number
  /** 光标所在行的行首偏移。 */
  readonly lineFrom: number
  readonly lexicon: EnterLanguage
  readonly lex: LineLex
}

/**
 * 本仓实现了的那几条分支，按 `src/enterHandlerOrder.ts` 里的 `id` 索引（键 = 表里的 `id`，
 * 少一条 = 上游会问、本仓按 `Result.Continue` 处理）。返回 null 就是不接。
 */
const ENTER_IMPLS: Readonly<Record<string, (ctx: EnterContext) => EnterBranch | null>> = {
  // ① 字符串字面量（`EnterInStringLiteralHandler`，注册表 `xml:1159`）。
  EnterInStringLiteralHandler: ctx => {
    const inString = enterInStringLiteral(ctx.lineText, ctx.caret, ctx.lexicon, ctx.lex)
    if (!inString) return null
    // `:72` 先落 `" + "`，`:73` 再把切点推到 `" +` 之后（`insertedFragment.length()` = 3，
    // 也就是插入串里收尾那个引号**之前**）—— 换行必须在那里切，否则开引号被留在上一行、
    // 上一行的字面量没闭合。`:74` 的 `caretAdvance = 1` 让光标停在补出来的第二个引号之后。
    // `:81` 的 Result.DefaultForceIndent 就是「插换行并缩进」。
    const splitAt = ctx.lineFrom + inString.at + inString.insert.length - 2
    return {
      edits: [{ from: ctx.lineFrom + inString.at, insert: inString.insert }],
      breakAt: splitAt, caretAdvance: 1, userEvent: 'input.type',
    }
  },
  // ② 行注释（`EnterInLineCommentHandler`，`xml:1160`）。
  EnterInLineCommentHandler: ctx => {
    const inComment = enterInLineComment(ctx.lineText, ctx.caret, ctx.lexicon, ctx.lex)
    if (!inComment) return null
    // `:82` 先把前缀落在光标处，`:88` 再走「默认回车 + 强制缩进」：回车把前缀推到下一行，
    // `:85-87` 的 caretAdvance 让光标停在补出来的前缀之后。少了这一步就等于只复制注释文本、不换行。
    return { edits: inComment.edits, caretAdvance: inComment.caretAdvance, userEvent: 'input' }
  },
  // ③ 未配对的左花括号（`EnterAfterUnmatchedBraceHandler`，`xml:1163-1164`）。
  //    上游这条由 `INSERT_BRACE_ON_ENTER` 把关（`CodeInsightSettings.java:130`，开关本体问在
  //    `enter/EnterAfterUnmatchedBraceHandler.java:84-86`，返回 0 时 `:50-51` 短路 ⇒ 整条不接管）。
  afterUnmatchedBrace: ctx => {
    if (!(ctx.lexicon.insertBraceOnEnter ?? true)) return null
    const afterBrace = enterAfterUnmatchedBrace(ctx.docText, ctx.head, /^\s*/.exec(ctx.lineText)![0])
    if (!afterBrace) return null
    // 闭合括号落在光标所在行之后（`:173` 插的是 `"\n" + braces`）。
    return { edits: [{ from: afterBrace.at, insert: `\n${afterBrace.text}` }], userEvent: 'input.type' }
  },
  // ④ 块注释（`EnterInBlockCommentHandler`，判定在 `src/editorEnterBlockComment.ts`；
  //    注册表 `xml:1161-1162` 带 `order="last"` ⇒ 上游把它排在整张表的最后问）。
  //    只在语言给了块注释词法时才问；补闭尾那一条由 `CLOSE_COMMENT_ON_ENTER`
  //    （`CodeInsightSettings.java:132`，开关问在 `enter/EnterInBlockCommentHandler.java:62`）把关；
  //    `* ` 续行那一支不受它管。两档各自的上游返回值由载荷带出来（`:67` 是 Default、`:98` 是 DefaultForceIndent）。
  blockComment: ctx => {
    const block = ctx.lexicon.block
    if (!block) return null
    const inBlock = enterInBlockComment(ctx.docText, ctx.head, block, ctx.lexicon.blockCloseOnEnter ?? true)
    if (!inBlock) return null
    return {
      edits: inBlock.edits, caretAdvance: inBlock.caretAdvance, userEvent: 'input',
      result: inBlock.forceIndent ? 'defaultForceIndent' : 'default',
    }
  },
}

/**
 * 把命中那一支落地：先落编辑（= 上游 delegate 在 `preprocessEnter` 里自己动的那些文档改动），
 * 再按那一档决定要不要插换行（`EnterHandler.java:142-153` 里只有 `Stop` 是「什么都不再做」，
 * 其余非 `Continue` 档都会继续跑原 handler = 本仓的 `insertNewlineAndIndent`），
 * 最后按 `caretAdvance` 挪光标（`EnterHandler.java:168` 那一档）。
 * `Default` 与 `DefaultForceIndent` 在本仓**同一个结果**：上游的差别只在 `SMART_INDENT_ON_ENTER`
 * 关掉时才看得出来（`EnterHandler.java:163-174`），而本仓 `EditorSettings` 没有那条键
 * （依据与行号见 `src/enterHandlerOrder.ts` 模块头）⇒ 按上游默认档（true）走。
 */
export function applyEnterHit(view: EditorView, hit: EnterHit): boolean {
  const { branch, result } = hit
  const changes = [...branch.edits]
  if (changes.length > 0) {
    view.dispatch(branch.breakAt === undefined
      ? { changes, userEvent: branch.userEvent ?? 'input' }
      : { changes, selection: { anchor: branch.breakAt }, userEvent: branch.userEvent ?? 'input' })
  }
  if (!enterInsertsNewline(result)) return true
  const indented = insertNewlineAndIndent(view)
  const advance = branch.caretAdvance ?? 0
  if (advance > 0) view.dispatch({ selection: { anchor: view.state.selection.main.head + advance } })
  return advance > 0 || indented
}

/**
 * 回车：按 `src/enterHandlerOrder.ts` 那张表**排完序之后的次序**逐个问（表为什么长那样、
 * `order="last"` 把哪条推到了后面，见本文件头），本仓一条都不接管时返回 false，交回
 * CodeMirror 的 `insertNewlineAndIndent`（= 上游的 `Result.Default`）。
 * 有选区或多个光标时不做主判断（那几条上游处理器都是按单个光标写的）。
 */
export function smartEnterCommand(language: () => EnterLanguage): Command {
  return (view: EditorView) => {
    const { state } = view
    if (state.readOnly) return false
    const selection = state.selection.main
    if (state.selection.ranges.length > 1 || !selection.empty) return false
    const doc = state.doc
    const line = doc.lineAt(selection.head)
    const lexicon = language()
    const docText = doc.toString()
    // 词法状态从全文开头推（块注释与三引号文本块都能跨行），数组只覆盖光标所在那一行。
    const lex = lexUntil(docText, line.to, lexicon, line.from)
    const ctx: EnterContext = {
      lineText: line.text, caret: selection.head - line.from, docText, head: selection.head,
      lineFrom: line.from, lexicon, lex,
    }
    // 循环体与 break 语义 = `EnterHandler.java:136-153`（表驱动的等价物，见那模块的注释）。
    const hit = preprocessEnter(ENTER_HANDLER_ORDER, step => ENTER_IMPLS[step.id]?.(ctx) ?? null)
    return hit ? applyEnterHit(view, hit) : false
  }
}
