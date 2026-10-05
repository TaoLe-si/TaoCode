// 回车家族（`lp/editor-actions` 判决缺项 ②：`enter/*` 里本仓原本没有的四条语义）。
//
// 上游这一族的注册表与次序：`platform/lang-impl/resources/intellij.platform.lang.impl.xml`
//   `:1159` `EnterInStringLiteralHandler` → `:1160` `EnterInLineCommentHandler` →
//   `:1161-1162` `EnterInBlockCommentHandler`（`id="blockComment"`，带 `order="last"` ⇒ 它在 EP 表里
//     实际排到最后问）→ `:1163-1164` `EnterAfterUnmatchedBraceHandler` →
//   `:1165-1166` `EnterBetweenBracesFinalHandler`（bean id 就叫 `EnterBetweenBracesHandler`）→
//   `:1171` `EnterAfterJavadocTagHandler`。EP 声明在 `:399`；「逐个问、第一个接管的算」就是这张表的
//   列出顺序（`platform/lang-impl/src/com/intellij/codeInsight/editorActions/EnterHandler.java:136-137`
//   的 preprocessEnter 循环；订正 2026-10-06：旧注释抄的是 `:181`，那一处是 postProcessEnter 的循环），
//   返回值的处置（`Result.DefaultForceIndent` / `DefaultSkipIndent`）在 `EnterHandler.java:145-151`。
//   **本仓把注释那两条排在字面量之前**：上游靠 token 类型区分「引号在注释里」和「引号在字面量里」，
//   本仓只有词法扫描，`// 说 "abc` 这种行注释里的引号会被字面量那条误切成 `" + "`，所以先问注释
//   （架构不等价 ⇒ 按本仓架构还原用户可见行为；次序差异留痕在这里，不在代码里偷偷改）。
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

/** 这门语言的注释词法（上游 `Commenter.getLineCommentPrefix` 的一半，由调用方给）。 */
export interface EnterLanguage {
  /** 行注释前缀，如 `//`。没有行注释的语言留空。 */
  line?: string
  /** 块注释那一半（`getBlockCommentPrefix/Suffix`、文档注释 `/**`、续行 `*`）：见 lexicon 的注释。 */
  block?: BlockCommentLexicon
}

const SPACES = ' \t'

/**
 * 宿主侧装配 `EnterLanguage`：把本仓的注释标记（`src/commentToggle.ts` 的 `CommentStyle`）
 * 翻成回车家族要的词法。行前缀直接搬，块前缀走 `blockLexiconFor`（上游那一族的四件套
 * `JavaCommenter.java:27-28`（`/*` 开）、`:32-33`（闭）、`:62-63`（文档前缀）、`:67-68`（续行 `*`）
 * 由它按同一对应关系给；块前缀不是 `/*` 的语言只给 block，续行那一支自己退出）。
 *
 * 这个函数住在模块里而不是写在 `CodeEditor.vue` 里：`CodeEditor.vue` 的登记上限是 1147 行
 * （`tests/module-size.test.mjs` 钉着，只许拆、不许升），装配规则放宿主就是往一个到顶的文件里再塞逻辑。
 */
export function smartEnterLanguageFor(style?: { line?: string; block?: [string, string] } | null): EnterLanguage {
  return { line: style?.line, block: blockLexiconFor(style ?? undefined) }
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

/**
 * 在行注释中间回车（`EnterInLineCommentHandler` 的文本子集）。
 * 返回**先**落地的编辑与之后光标要前进的字符数；不适用返回 null。
 */
export function enterInLineComment(
  lineText: string, caret: number, language: EnterLanguage,
): { edits: ChangeSpec[]; caretAdvance: number } | null {
  const prefix = language.line
  if (!prefix) return null
  const start = lineText.indexOf(prefix)
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
 * 在双引号字符串里回车：插 `" + "`，让原来那个收尾引号变成下一段的开引号
 * （`EnterInStringLiteralHandler.splitString`，`:68-82`）。不适用返回 null。
 */
export function enterInStringLiteral(lineText: string, caret: number): { at: number; insert: string } | null {
  const quote = lineText.indexOf('"')
  // `:46`：光标得在开引号**之后**（`psiAtOffset.getTextOffset() < caretOffset`）。
  if (quote < 0 || caret <= quote + 1) return null
  let escaped = false
  for (let i = quote + 1; i < caret; ++i) {
    if (lineText[i] === '"') return null
    if (lineText[i] === '\\' && !escaped) escaped = true
    else escaped = false
  }
  // 光标落在转义序列里（`skipStringLiteralEscapes` 会推到 token 末尾）时不做：词法层没有
  // token 边界，按经验猜一个转义长度就是瞎编，如实交回默认回车。
  if (escaped) return null
  return { at: caret, insert: '" + "' }
}

/**
 * 回车：按上游那张注册表逐条问（次序差异与理由见文件头），本仓一条都不接管时交回
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
    const caret = selection.head - line.from
    const lineText = line.text
    const lexicon = language()
    // ① 行注释（`EnterInLineCommentHandler`）。
    const inComment = enterInLineComment(lineText, caret, lexicon)
    if (inComment) {
      // `:82` 先把前缀落在光标处，`:88` 再走「默认回车 + 强制缩进」：回车把前缀推到下一行，
      // `:85-87` 的 caretAdvance 让光标停在补出来的前缀之后。少了这一步就等于只复制注释文本、不换行。
      view.dispatch({ changes: inComment.edits, userEvent: 'input' })
      insertNewlineAndIndent(view)
      if (inComment.caretAdvance > 0) {
        view.dispatch({ selection: { anchor: view.state.selection.main.head + inComment.caretAdvance } })
      }
      return true
    }
    // ② 块注释（`EnterInBlockCommentHandler`，判定在 `src/editorEnterBlockComment.ts`）。
    //    只在语言给了块注释词法时才问；上游那两条 `Result.Default*` 在这里都是「补完就普通回车」。
    const block = lexicon.block
    if (block) {
      const inBlock = enterInBlockComment(doc.toString(), selection.head, block)
      if (inBlock) {
        view.dispatch({ changes: inBlock.edits, userEvent: 'input' })
        insertNewlineAndIndent(view)
        if (inBlock.caretAdvance > 0) {
          view.dispatch({ selection: { anchor: view.state.selection.main.head + inBlock.caretAdvance } })
        }
        return true
      }
    }
    // ③ 字符串字面量（`EnterInStringLiteralHandler`）。
    const inString = enterInStringLiteral(lineText, caret)
    if (inString) {
      // `:72` 先落 `" + "`，`:73` 再把切点推到 `" +` 之后（`insertedFragment.length()` = 3，
      // 也就是插入串里收尾那个引号**之前**）—— 换行必须在那里切，否则开引号被留在上一行、
      // 上一行的字面量没闭合。`:74` 的 `caretAdvance = 1` 让光标停在补出来的第二个引号之后。
      // `:81` 的 Result.DefaultForceIndent 就是 `insertNewlineAndIndent`。
      const splitAt = inString.at + inString.insert.length - 2
      view.dispatch({
        changes: { from: line.from + inString.at, insert: inString.insert },
        selection: { anchor: line.from + splitAt },
        userEvent: 'input.type',
      })
      insertNewlineAndIndent(view)
      view.dispatch({ selection: { anchor: view.state.selection.main.head + 1 } })
      return true
    }
    // ④ 未配对的左花括号（`EnterAfterUnmatchedBraceHandler`）。
    const afterBrace = enterAfterUnmatchedBrace(state.doc.toString(), selection.head, /^\s*/.exec(lineText)![0])
    if (afterBrace) {
      // 闭合括号落在光标所在行之后（`:173` 插的是 `"\n" + braces`）。
      const at = afterBrace.at
      view.dispatch({ changes: { from: at, insert: `\n${afterBrace.text}` }, userEvent: 'input.type' })
      return insertNewlineAndIndent(view)
    }
    return false
  }
}
